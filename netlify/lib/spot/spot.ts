/**
 * Orquestador de Spot (sección 13.3 / 13.5 del informe).
 *
 *  mensaje → saneamiento → reglas de seguridad (prioritarias) → NLU + entidades
 *          → router:  Ruta 1 datos (PostgreSQL) | Ruta 2 RAG | Ruta 3 seguridad/fallback
 *          → Claude redacta SOLO con el contexto autorizado → filtro de salida
 *          → se guarda el turno → respuesta + tarjetas de producto + metadatos
 */
import { rpc } from '../db';
import { env } from '../env';
import type { Usuario } from '../auth';
import { callClaude, type ChatTurn } from './claude';
import { extractEntities, matchesSize, type Entities } from './entities';
import { classify, CONFIDENCE_THRESHOLD, type Prediction } from './nlu';
import { buildContextBlock, escapeTags, SYSTEM_PROMPT, SYSTEM_PROMPT_VERSION, type Route } from './prompts';
import { retrieve, type Doc, type RagMode } from './retrieval';
import { detectSafety, EMERGENCY_MESSAGE, guardOutput, MEDICAL_DISCLAIMER, type SafetyResult } from './safety';
import { normalizeForNlu, tokenize } from './normalize';
import { detectAdminIntent, detectAdminQuery, detectCartIntent, runAgent, type AgentMode } from './agent';

export interface ProductoChat {
  id: number; slug: string; nombre: string; marca: string; categoria: string; categoria_slug: string;
  presentacion: string; sabor: string | null; porciones: number | null; precio: number;
  precio_anterior: number | null; stock: number; estado_disponibilidad: string;
  imagen: string; color: string; descripcion?: string; score?: number;
}

export interface SpotReply {
  conversacion_id: string;
  respuesta: string;
  productos: ProductoChat[];
  fuentes: Array<{ titulo: string; slug: string; categoria: string }>;
  meta: {
    intent: string; confianza: number; ruta: Route; fallback: boolean;
    generador: 'claude' | 'plantilla_contingencia' | 'seguridad';
    motivo_contingencia?: string; rag_modo?: RagMode; modelo?: string; latencia_ms: number;
    seguridad?: { medica: string[]; inyeccion: string[] }; filtros_salida?: string[];
    coincidencia_exacta?: boolean | null; pedido_encontrado?: boolean | null; autenticado?: boolean;
    herramientas?: string[];
  };
  /** Carrito actualizado cuando Spot lo modificó (modo carrito). */
  carrito?: Record<string, unknown>;
  /** Cambios propuestos por Spot que el administrador debe confirmar (modo admin). */
  accion?: { id: string; resumen: unknown[]; expira_en_min: number };
}

const PRODUCT_INTENTS = new Set(['info_producto', 'buscar_producto', 'precio_disponibilidad', 'comparar_productos', 'recomendacion_general']);
const KNOWLEDGE_INTENTS = new Set(['info_categoria_suplemento', 'info_entrenamiento', 'info_nutricion_deportiva', 'metodos_pago', 'envios', 'horarios', 'politicas', 'contacto', 'proceso_compra', 'ayuda']);
const CONVERSATION_INTENTS = new Set(['saludo', 'despedida']);

interface HistoryMsg { rol: 'user' | 'assistant'; contenido: string; ruta?: string; metadatos?: { productos_ids?: number[] } }

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
/** Umbral para interceptar solo por NLU (las reglas deterministas no dependen de él). */
export const MEDICAL_NLU_THRESHOLD = 0.45;
// ---------------------------------------------------------------------------
export function decideRoute(text: string, safety: SafetyResult, nlu: Prediction, ent: Entities, hasPrevProducts: boolean): Route {
  if (safety.emergency) return 'seguridad_emergencia';
  if (safety.medical || (nlu.intent === 'consulta_medica_sensible' && nlu.confidence >= MEDICAL_NLU_THRESHOLD)) return 'seguridad_medica';
  if (safety.injection) return 'seguridad_inyeccion';

  const n = normalizeForNlu(text);
  const mentionsOrder = /\b(pedido|pedidos|orden|ordenes|compra|paquete|rastrear|seguimiento)\b/.test(n);
  if (nlu.intent === 'estado_pedido' && (nlu.confidence >= CONFIDENCE_THRESHOLD || mentionsOrder)) return 'pedido';
  if (ent.numeroPedido && mentionsOrder) return 'pedido';

  // Mensajes muy cortos que solo hacen referencia a algo ("y eso?", "ese") sin contexto previo.
  const tokens = n.split(' ').filter(Boolean);
  const noEntities = !ent.marca && !ent.categoria && !ent.numeroPedido && !ent.tamano;
  if (tokens.length <= 3 && ent.referenciaAnterior && noEntities) return hasPrevProducts ? 'transaccional' : 'aclaracion';

  const confident = nlu.confidence >= CONFIDENCE_THRESHOLD && (nlu.margin >= 0.04 || nlu.confidence >= 0.45);
  if (confident) {
    if (PRODUCT_INTENTS.has(nlu.intent)) return 'transaccional';
    if (KNOWLEDGE_INTENTS.has(nlu.intent)) return 'conocimiento';
    if (CONVERSATION_INTENTS.has(nlu.intent)) return 'conversacion';
    if (nlu.intent === 'fuera_de_dominio') return 'fuera_de_dominio';
    if (nlu.intent === 'estado_pedido') return 'pedido';
  }
  // Confianza baja: usar señales de entidades antes de pedir aclaración.
  if (ent.marca || (ent.categoria && ent.consultaProducto.split(' ').length <= 4)) return 'transaccional';
  if (ent.referenciaAnterior && hasPrevProducts) return 'transaccional';
  if (nlu.intent === 'fuera_de_dominio' && nlu.margin >= 0.05) return 'fuera_de_dominio';
  return 'aclaracion';
}

// ---------------------------------------------------------------------------
// Ruta 1: datos transaccionales
// ---------------------------------------------------------------------------
const cleanProduct = (p: ProductoChat): ProductoChat => ({
  id: p.id, slug: p.slug, nombre: p.nombre, marca: p.marca, categoria: p.categoria, categoria_slug: p.categoria_slug,
  presentacion: p.presentacion, sabor: p.sabor, porciones: p.porciones, precio: Number(p.precio),
  precio_anterior: p.precio_anterior === null ? null : Number(p.precio_anterior), stock: p.stock,
  estado_disponibilidad: p.estado_disponibilidad, imagen: p.imagen, color: p.color,
});

async function searchProducts(text: string, nlu: Prediction, ent: Entities, prevIds: number[]) {
  const n = normalizeForNlu(text);
  let candidates: ProductoChat[] = [];
  let origen = 'busqueda';

  const wantsCheap = /\b(barat[oa]s?|economic[oa]s?|menor precio|mas accesible)\b/.test(n);
  const wantsExpensive = /\b(mas car[oa]s?|mayor precio|premium)\b/.test(n);
  // Palabras de la consulta que identifican un producto (sin números ni unidades).
  const productWords = ent.consultaProducto.split(' ').filter((w) => w && !/^\d/.test(w) && !['lb', 'kg', 'g', 'oz', 'porciones'].includes(w));
  const isFollowUp = prevIds.length > 0 && !ent.marca && productWords.length === 0;
  const useAnaphora = isFollowUp && !ent.tamano;

  if (isFollowUp && ent.tamano) {
    // "¿y la de 2 libras?" → misma línea de producto que antes, con otra presentación.
    const [prev] = await rpc<ProductoChat[]>('api_buscar_productos_chat', { ids: prevIds.slice(0, 1) });
    candidates = prev ? await rpc<ProductoChat[]>('api_buscar_productos_chat', { q: `${prev.nombre} ${prev.marca}`, limite: 8 }) : [];
    candidates = candidates.filter((p) => p.nombre === prev?.nombre || p.marca === prev?.marca);
    origen = 'referencia_conversacion';
  } else if (useAnaphora) {
    candidates = await rpc<ProductoChat[]>('api_buscar_productos_chat', { ids: prevIds.slice(0, 4) });
    origen = 'referencia_conversacion';
  } else if ((wantsCheap || wantsExpensive) && ent.categoria) {
    const r = await rpc<{ items: ProductoChat[] }>('api_catalogo', {
      categoria: ent.categoria, orden: wantsCheap ? 'precio_asc' : 'precio_desc', limite: 4, solo_disponibles: true,
    });
    candidates = r.items;
    origen = wantsCheap ? 'orden_precio_ascendente' : 'orden_precio_descendente';
  } else if (nlu.intent === 'comparar_productos' && /\b(vs|versus|o|y|con|contra|entre)\b/.test(ent.consultaProducto + ' ' + n)) {
    const parts = ent.consultaProducto.split(/\b(?:vs|versus|o|y|con|contra|entre)\b/).map((s) => s.trim()).filter((s) => s.length >= 2);
    const lists = await Promise.all((parts.length >= 2 ? parts : [ent.consultaProducto]).slice(0, 3)
      .map((q) => rpc<ProductoChat[]>('api_buscar_productos_chat', { q, limite: 2 })));
    const seen = new Set<number>();
    for (const l of lists) for (const p of l.slice(0, parts.length >= 2 ? 1 : 4)) if (!seen.has(p.id)) { seen.add(p.id); candidates.push(p); }
    origen = 'comparacion';
  } else {
    const q = ent.consultaProducto || ent.categoria || '';
    if (q) {
      candidates = await rpc<ProductoChat[]>('api_buscar_productos_chat', { q, limite: 8 });
    }
    if (candidates.length === 0 && ent.categoria) {
      const r = await rpc<{ items: ProductoChat[] }>('api_catalogo', { categoria: ent.categoria, limite: 4 });
      candidates = r.items;
      origen = 'categoria';
    }
  }

  // Relevancia: conservar los cercanos al mejor puntaje y priorizar la marca mencionada.
  if (origen === 'busqueda' && candidates.length) {
    const top = candidates[0].score ?? 0;
    candidates = candidates.filter((p) => (p.score ?? 0) >= top * 0.6);
    if (ent.marca) {
      const brandName = ent.marca.replace(/-/g, ' ');
      const same = candidates.filter((p) => p.marca.toLowerCase().replace(/-/g, ' ').includes(brandName.split(' ')[0]));
      if (same.length) candidates = same;
    }
  }

  let coincidenciaExacta: boolean | null = null;
  if (ent.tamano && candidates.length) {
    const exact = candidates.filter((p) => matchesSize(p.presentacion, ent.tamano));
    coincidenciaExacta = exact.length > 0;
    if (exact.length) {
      // Si se pidió una presentación concreta y existe, se muestran solo esas coincidencias.
      candidates = nlu.intent === 'comparar_productos' ? [...exact, ...candidates.filter((p) => !exact.includes(p))] : exact;
    } else {
      // No existe ese tamaño: se ofrecen las presentaciones disponibles de la misma línea.
      const line = candidates[0].nombre;
      candidates = [...candidates.filter((p) => p.nombre === line), ...candidates.filter((p) => p.nombre !== line)];
    }
  }
  const productos = candidates.slice(0, 4).map(cleanProduct);
  return { productos, origen, coincidenciaExacta };
}

function productFacts(productos: ProductoChat[]) {
  return productos.map((p) => ({
    nombre: p.nombre, marca: p.marca, categoria: p.categoria, presentacion: p.presentacion, sabor: p.sabor,
    porciones: p.porciones, precio_usd: p.precio, precio_anterior_usd: p.precio_anterior,
    precio_por_porcion_usd: p.porciones ? Number((p.precio / p.porciones).toFixed(2)) : null,
    stock_unidades: p.stock,
    disponibilidad: p.estado_disponibilidad === 'agotado' ? 'agotado' : p.estado_disponibilidad === 'pocas_unidades' ? 'pocas unidades' : 'disponible',
  }));
}

// ---------------------------------------------------------------------------
// Respuestas de contingencia (cuando Claude no está disponible) — deterministas,
// construidas solo con datos reales; la interfaz las señala como tales.
// ---------------------------------------------------------------------------
const money = (n: number) => `$${n.toFixed(2)}`;
const dispo = (p: ProductoChat) =>
  p.stock === 0 ? 'agotado' : p.stock <= 5 ? `¡solo ${p.stock} unidades!` : `${p.stock} unidades disponibles`;

function contingency(route: Route, data: Record<string, unknown>, docs: Doc[]): string {
  switch (route) {
    case 'transaccional': {
      const ps = (data.productos as ProductoChat[]) ?? [];
      if (!ps.length) return 'No encontré ese producto en nuestro catálogo. Puedes buscarlo por categoría o marca en la sección Productos.';
      const head = data.coincidencia_exacta === false ? 'No tenemos exactamente esa presentación, pero encontré estas opciones:' : 'Esto es lo que encontré en el catálogo:';
      return [head, ...ps.map((p) => `- **${p.nombre}** (${p.presentacion}) — ${money(p.precio)} · ${dispo(p)}`)].join('\n');
    }
    case 'pedido': {
      if (data.autenticado === false) return 'Por seguridad, para consultar un pedido necesito que inicies sesión con la cuenta con la que realizaste la compra.';
      const p = data.pedido as { numero: number; estado: string; total_usd: number } | null | undefined;
      if (data.pedido === null) return 'No encontré un pedido con ese número asociado a tu cuenta. Revisa el número o consulta la sección "Mis pedidos".';
      if (p) return `Tu pedido **#${p.numero}** está en estado **${p.estado}**. Total: ${money(Number(p.total_usd))}.`;
      const list = (data.pedidos_recientes as Array<{ numero: number; estado: string }>) ?? [];
      return list.length ? `Tus pedidos recientes:\n${list.map((x) => `- #${x.numero}: ${x.estado}`).join('\n')}` : 'Aún no tienes pedidos registrados en tu cuenta.';
    }
    case 'conocimiento': {
      if (!docs.length) return 'No tengo información sobre eso en mi base de conocimiento. ¿Quieres que te ayude con productos, envíos o pagos?';
      const d = docs[0];
      const resumen = d.contenido.split(/(?<=\.)\s+/).slice(0, 3).join(' ');
      return `Según nuestra información (**${d.titulo}**): ${resumen}`;
    }
    case 'seguridad_medica':
      return `${MEDICAL_DISCLAIMER} Sí puedo darte información general sobre los suplementos o ayudarte con algo de la tienda.`;
    case 'seguridad_inyeccion':
      return 'Mis reglas de funcionamiento no se pueden cambiar ni revelar. Con gusto te ayudo con productos, precios, envíos, pagos o tus pedidos de IronCart.';
    case 'fuera_de_dominio':
      return 'Eso está fuera de lo que puedo ayudarte. Soy Spot, el asistente de IronCart: puedo buscar productos, darte precios y disponibilidad, comparar suplementos o explicarte envíos y pagos.';
    case 'conversacion':
      return '¡Hola! Soy Spot, el asistente de IronCart. Puedo buscar productos, darte precios y stock, comparar suplementos, explicarte envíos y pagos o consultar tus pedidos.';
    default:
      return '¿Podrías darme un poco más de detalle? Por ejemplo, puedo mostrarte el precio y stock de un producto, comparar dos productos o explicarte un tipo de suplemento.';
  }
}

// ---------------------------------------------------------------------------
// Punto de entrada
// ---------------------------------------------------------------------------
export async function handleSpotMessage(input: { mensaje: string; conversacionId: string | null; usuario: Usuario | null; carritoId?: string | null }): Promise<SpotReply> {
  const t0 = Date.now();
  const { mensaje, usuario } = input;

  const ctx = await rpc<{ conversacion_id: string; mensajes: HistoryMsg[] }>('api_chat_contexto', {
    conversacion_id: input.conversacionId, usuario_id: usuario?.id ?? null, limite: env.historyTurns * 2,
  });
  const history = ctx.mensajes;
  // Productos mencionados en las dos últimas respuestas (para "ese", "las dos", "ambos"...).
  const prevIds = [...new Set([...history].reverse().filter((m) => m.rol === 'assistant' && m.metadatos?.productos_ids?.length)
    .slice(0, 2).flatMap((m) => m.metadatos?.productos_ids ?? []))].slice(0, 4);

  const safety = detectSafety(mensaje);
  const nlu = classify(mensaje);
  const ent = extractEntities(mensaje);
  let route = decideRoute(mensaje, safety, nlu, ent, prevIds.length > 0);

  // ----- Acciones (agente con herramientas), separadas por rol verificado en el servidor -----
  // Las rutas de seguridad siempre tienen prioridad: un mensaje médico o de inyección nunca llega al agente.
  let agentMode: AgentMode | null = null;
  if (!route.startsWith('seguridad')) {
    const esAdmin = usuario?.rol === 'admin';
    const rutaAnterior = [...history].reverse().find((m) => m.rol === 'assistant')?.ruta;
    const seguimiento = tokenize(normalizeForNlu(mensaje)).length <= 8
      && !(KNOWLEDGE_INTENTS.has(nlu.intent) && nlu.confidence >= 0.45);
    const quiereAdministrar = detectAdminIntent(mensaje);
    const quiereCarrito = detectCartIntent(mensaje);
    if (esAdmin && (quiereAdministrar || detectAdminQuery(mensaje) || (rutaAnterior === 'admin' && seguimiento))) agentMode = 'admin';
    else if (!esAdmin && quiereAdministrar && !quiereCarrito) route = 'sin_permiso'; // el permiso se evalúa antes que el seguimiento
    else if (quiereCarrito || (rutaAnterior === 'carrito' && seguimiento)) agentMode = 'carrito';
  }
  if (agentMode) route = agentMode;

  let datos: Record<string, unknown> | undefined;
  let docs: Doc[] = [];
  let ragMode: RagMode | undefined;
  let suficiente = false;
  let productos: ProductoChat[] = [];

  // ----- Obtención de contexto autorizado según la ruta -----
  if (route === 'transaccional') {
    const r = await searchProducts(mensaje, nlu, ent, prevIds);
    productos = r.productos;
    datos = { consulta_interpretada: ent.consultaProducto || ent.categoria, tamano_solicitado: ent.tamano,
      coincidencia_exacta: r.coincidenciaExacta, origen: r.origen, productos: productFacts(productos) };
    if (['comparar_productos', 'recomendacion_general', 'info_producto'].includes(nlu.intent)) {
      const rr = await retrieve(mensaje, 2);
      docs = rr.docs; ragMode = rr.mode; suficiente = rr.suficiente;
    }
  } else if (route === 'pedido') {
    if (!usuario) {
      datos = { autenticado: false };
    } else if (ent.numeroPedido) {
      const p = await rpc<{ numero: number; estado: string; total: number; creado_en: string; actualizado_en: string;
        items: Array<{ nombre: string; cantidad: number }> } | null>('api_pedido_detalle', { usuario_id: usuario.id, numero: ent.numeroPedido });
      // Minimización: a Claude solo llega lo necesario (sin nombre ni dirección de envío).
      const pedido = p && { numero: p.numero, estado: p.estado, total_usd: p.total, fecha: p.creado_en,
        ultima_actualizacion: p.actualizado_en, productos: p.items.map((i) => ({ nombre: i.nombre, cantidad: i.cantidad })) };
      datos = { autenticado: true, numero_consultado: ent.numeroPedido, pedido };
    } else {
      const all = await rpc<Array<Record<string, unknown>>>('api_pedidos_usuario', { usuario_id: usuario.id });
      datos = { autenticado: true, pedidos_recientes: all.slice(0, 3).map((p) => ({ numero: p.numero, estado: p.estado, total: p.total, fecha: p.creado_en })) };
    }
  } else if (route === 'conocimiento' || route === 'seguridad_medica' || route === 'aclaracion') {
    const rr = await retrieve(mensaje, route === 'conocimiento' ? 4 : 2);
    docs = rr.docs; ragMode = rr.mode; suficiente = rr.suficiente;
    if (route === 'aclaracion' && suficiente && docs[0].score >= 0.4) route = 'conocimiento';
  }

  // ----- Generación -----
  let respuesta: string;
  let generador: SpotReply['meta']['generador'] = 'claude';
  let motivo: string | undefined;
  let modelo: string | undefined;
  let filtros: string[] = [];

  let herramientas: string[] | undefined;
  let carritoActualizado: Record<string, unknown> | undefined;
  let accion: SpotReply['accion'];

  if (route === 'seguridad_emergencia') {
    respuesta = EMERGENCY_MESSAGE;
    generador = 'seguridad';
  } else if (route === 'sin_permiso') {
    respuesta = 'Solo un administrador de IronCart puede crear, modificar o eliminar productos, cambiar precios o inventario, o actualizar pedidos. Con gusto te ayudo a buscar productos, compararlos o agregarlos a tu carrito.';
    generador = 'seguridad';
  } else if (agentMode) {
    const a = await runAgent({
      mode: agentMode, mensaje, history: history.map((m) => ({ rol: m.rol, contenido: m.contenido })),
      usuario, carritoId: input.carritoId ?? null, conversacionId: ctx.conversacion_id,
    });
    herramientas = a.herramientas;
    carritoActualizado = a.carrito;
    accion = a.accion;
    productos = a.productos.map(cleanProduct);
    modelo = a.modelo;
    if (a.ok && a.texto) {
      respuesta = guardOutput(a.texto, route).text;
    } else {
      generador = 'plantilla_contingencia';
      motivo = a.motivo;
      respuesta = agentMode === 'admin'
        ? 'No pude procesar esa gestión con el asistente en este momento. Puedes hacer el cambio desde el Panel de administración.'
        : carritoActualizado
          ? 'Actualicé tu carrito, pero no pude terminar de redactar la respuesta. Revisa el carrito para ver los cambios.'
          : 'No pude modificar tu carrito desde el chat en este momento. Puedes agregar productos desde su ficha con el botón "Agregar al carrito".';
    }
  } else {
    const contextBlock = buildContextBlock({
      route, intent: nlu.intent, confidence: nlu.confidence, datos,
      documentos: docs.length || ['conocimiento', 'seguridad_medica'].includes(route) ? docs : undefined,
      suficiente,
      avisosSeguridad: [...safety.medicalReasons, ...safety.injectionReasons],
    });
    const turns: ChatTurn[] = history.map((m) => ({
      role: m.rol,
      content: m.rol === 'user' ? `<mensaje_usuario>\n${escapeTags(m.contenido)}\n</mensaje_usuario>` : m.contenido,
    }));
    // La API exige alternancia y empezar por "user": se recorta el historial si hace falta.
    while (turns.length && turns[0].role !== 'user') turns.shift();
    turns.push({ role: 'user', content: `<mensaje_usuario>\n${escapeTags(mensaje)}\n</mensaje_usuario>` });

    const maxTokens = route === 'fuera_de_dominio' || route === 'conversacion' || route === 'seguridad_inyeccion' ? 300 : undefined;
    const r = await callClaude([SYSTEM_PROMPT, contextBlock], turns, maxTokens);
    if (r.ok) {
      respuesta = r.text;
      modelo = r.model;
    } else {
      respuesta = contingency(route, { ...(datos ?? {}), productos }, docs);
      generador = 'plantilla_contingencia';
      motivo = r.reason;
    }
    const g = guardOutput(respuesta, route);
    respuesta = g.text;
    filtros = g.blocked;
  }

  // En rutas de seguridad o fuera de dominio no se muestran productos.
  if (route !== 'transaccional' && route !== 'carrito' && route !== 'admin') productos = [];

  const fallback = ['seguridad_medica', 'seguridad_inyeccion', 'seguridad_emergencia', 'fuera_de_dominio', 'aclaracion', 'sin_permiso'].includes(route);
  const fuentes = docs.map((d) => ({ titulo: d.titulo, slug: d.slug, categoria: d.categoria }));
  const reply: SpotReply = {
    conversacion_id: ctx.conversacion_id,
    respuesta,
    productos,
    fuentes,
    meta: {
      intent: nlu.intent, confianza: nlu.confidence, ruta: route, fallback, generador,
      motivo_contingencia: motivo, rag_modo: ragMode, modelo, latencia_ms: Date.now() - t0,
      seguridad: safety.medical || safety.injection ? { medica: safety.medicalReasons, inyeccion: safety.injectionReasons } : undefined,
      filtros_salida: filtros.length ? filtros : undefined,
      coincidencia_exacta: route === 'transaccional' ? (datos?.coincidencia_exacta as boolean | null) : undefined,
      pedido_encontrado: route === 'pedido' && datos && 'pedido' in datos ? datos.pedido !== null : undefined,
      autenticado: route === 'pedido' ? Boolean(usuario) : undefined,
      herramientas,
    },
    ...(carritoActualizado ? { carrito: carritoActualizado } : {}),
    ...(accion ? { accion } : {}),
  };

  await rpc('api_chat_guardar', {
    conversacion_id: ctx.conversacion_id,
    mensajes: [
      { rol: 'user', contenido: mensaje, intent: nlu.intent, ruta: route, confianza: nlu.confidence, fallback,
        metadatos: { entidades: ent, ranking: nlu.ranking, seguridad: reply.meta.seguridad ?? null } },
      { rol: 'assistant', contenido: respuesta, intent: nlu.intent, ruta: route, fallback,
        metadatos: { productos_ids: productos.map((p) => p.id), fuentes: fuentes.map((f) => f.slug), generador,
                     motivo_contingencia: motivo ?? null, modelo: modelo ?? null, prompt: SYSTEM_PROMPT_VERSION,
                     rag_modo: ragMode ?? null, filtros_salida: filtros, latencia_ms: reply.meta.latencia_ms,
                     herramientas: herramientas ?? null, accion_id: accion?.id ?? null } },
    ],
  }).catch((e) => console.error('[spot] no se pudo guardar el turno:', (e as Error).message));

  return reply;
}
