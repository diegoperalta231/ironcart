/**
 * Agente de Spot con herramientas (tool use de Claude), separado por ROL.
 *
 *  - modo "carrito" (cualquier visitante o cliente): buscar productos y gestionar SU carrito.
 *  - modo "admin"   (solo sesión con rol admin, verificado en el servidor): consultar el
 *    catálogo/pedidos y PROPONER cambios. Los cambios quedan pendientes hasta que el
 *    administrador pulse "Confirmar" (POST /api/admin/acciones/:id/confirmar).
 *
 * La seguridad no depende del modelo: un cliente nunca recibe las herramientas de
 * administración, y cada herramienta vuelve a comprobar el rol antes de ejecutarse.
 */
import { rpc } from '../db';
import type { Usuario } from '../auth';
import { callClaudeRaw, textOf, type AgentMessage, type ContentBlock, type ToolDef } from './claude';
import { escapeTags, SYSTEM_PROMPT } from './prompts';
import type { ProductoChat } from './spot';
import { normalizeForNlu } from './normalize';

export type AgentMode = 'carrito' | 'admin';

const CATEGORIAS = ['proteinas', 'creatinas', 'pre-entrenos', 'vitaminas', 'aminoacidos', 'accesorios'];

// ------------------------------------------------------------------ detección de intención
/** ¿El cliente quiere modificar su carrito? */
export function detectCartIntent(text: string): boolean {
  const n = normalizeForNlu(text);
  if (/\bcomo\b.*\b(agrego|agregar|anado|anadir|compro|comprar|quito|quitar|elimino)\b/.test(n)) return false; // pregunta de ayuda
  return /\b(agrega|agregame|agregale|agregar|agregalo|agregala|anade|anademe|anadir|mete|meteme|metele|ponme|echa|echame|quiero (comprar|llevar|pedir|ordenar)|me llevo|llevame|compra|comprame|quita|quitame|saca|sacame|vacia|vaciar)\b/.test(n)
    || /\b(carrito)\b/.test(n) && /\b(pon|agrega|anade|mete|quita|saca|elimina|borra|cambia|deja|aumenta|reduce|ver|muestra|que (hay|tengo))\b/.test(n);
}

/** ¿El mensaje pide modificar el catálogo, precios, inventario o pedidos? (intención de administración) */
export function detectAdminIntent(text: string): boolean {
  const n = normalizeForNlu(text);
  const verbo = /\b(cambia|cambiale|cambiar|actualiza|actualizar|modifica|modificar|edita|editar|sube|subele|subir|baja|bajale|bajar|pon|ponle|ponlo|ponla|poner|crea|crear|registra|da de alta|elimina|eliminar|borra|borrar|desactiva|desactivar|activa|activar|reactiva|destaca|destacar|quita|retira|reabastece|repon|reponer|ajusta|ajustar|marca|pasa|aumenta|reduce|rebaja)\b/;
  const objeto = /\b(precio|precios|stock|inventario|existencias|unidades|producto|productos|catalogo|oferta|descuento|destacado|pedido|marca|categoria|descripcion|sabor|presentacion)\b/;
  return verbo.test(n) && objeto.test(n) && !/\bcarrito\b/.test(n);
}

/** Consultas de gestión que el admin hace sin verbo de cambio ("¿qué productos tienen poco stock?"). */
export function detectAdminQuery(text: string): boolean {
  const n = normalizeForNlu(text);
  return /\b(poco stock|bajo stock|sin stock|agotados|inventario|reabastecer|pedidos (pendientes|confirmados|de hoy|recientes)|cuantos (vendimos|vendidos)|mas vendido)\b/.test(n);
}

// ------------------------------------------------------------------ herramientas
const T_BUSCAR: ToolDef = {
  name: 'buscar_productos',
  description: 'Busca productos del catálogo de IronCart por nombre, marca, tipo o presentación. Devuelve id, nombre, marca, presentación, sabor, precio y stock reales. Úsala SIEMPRE antes de agregar o modificar un producto para obtener su id; nunca inventes ids.',
  input_schema: {
    type: 'object',
    properties: {
      consulta: { type: 'string', description: 'Texto de búsqueda, p. ej. "gold standard 5 lb" o "creatina".' },
      categoria: { type: 'string', enum: CATEGORIAS, description: 'Filtro opcional por categoría.' },
    },
    required: ['consulta'],
  },
};

const CARRITO_TOOLS: ToolDef[] = [
  T_BUSCAR,
  {
    name: 'agregar_al_carrito',
    description: 'Agrega unidades de un producto al carrito del usuario (se suman a las que ya tenga). Valida el stock.',
    input_schema: {
      type: 'object',
      properties: {
        producto_id: { type: 'integer', description: 'id obtenido con buscar_productos' },
        cantidad: { type: 'integer', minimum: 1, maximum: 20 },
      },
      required: ['producto_id', 'cantidad'],
    },
  },
  {
    name: 'cambiar_cantidad_en_carrito',
    description: 'Fija la cantidad exacta de un producto que YA está en el carrito. Usa 0 para quitarlo.',
    input_schema: {
      type: 'object',
      properties: { producto_id: { type: 'integer' }, cantidad: { type: 'integer', minimum: 0, maximum: 20 } },
      required: ['producto_id', 'cantidad'],
    },
  },
  {
    name: 'ver_carrito',
    description: 'Devuelve el contenido actual del carrito del usuario con subtotal, envío y total.',
    input_schema: { type: 'object', properties: {} },
  },
];

const ADMIN_TOOLS: ToolDef[] = [
  {
    name: 'buscar_productos_admin',
    description: 'Busca productos del catálogo, INCLUIDOS los inactivos, con todos sus campos editables (id, nombre, marca, categoria, descripcion, presentacion, sabor, porciones, precio, precio_anterior, stock, activo, destacado, imagen, color, beneficios) y unidades vendidas. Sin consulta lista por categoría o stock.',
    input_schema: {
      type: 'object',
      properties: {
        consulta: { type: 'string', description: 'Texto de búsqueda (opcional).' },
        categoria: { type: 'string', enum: CATEGORIAS },
        stock_maximo: { type: 'integer', description: 'Solo productos con stock menor o igual a este valor.' },
      },
    },
  },
  {
    name: 'consultar_pedidos',
    description: 'Lista los pedidos de la tienda (número, estado, fecha, total, cantidad de productos), opcionalmente filtrados por estado.',
    input_schema: {
      type: 'object',
      properties: { estado: { type: 'string', enum: ['confirmado', 'preparando', 'enviado', 'entregado', 'cancelado'] } },
    },
  },
  {
    name: 'proponer_cambios',
    description:
      'Propone uno o varios cambios (máx. 20). NO se aplican: el servidor los valida y muestra al administrador una tarjeta con botón "Confirmar". ' +
      'Tipos: ' +
      '{"tipo":"actualizar","producto_id":N,"cambios":{...campos a cambiar...}} — campos: nombre, marca, categoria (slug), descripcion, presentacion, sabor, porciones, precio, precio_anterior (número mayor que precio, o null para quitar la oferta), stock, activo, destacado, imagen, color (#RRGGBB), beneficios (lista ≤5). ' +
      '{"tipo":"crear","datos":{nombre, marca, categoria, descripcion, presentacion, precio, stock, y opcionales sabor, porciones, precio_anterior, destacado, imagen, color, beneficios}} — la marca se crea si no existe. ' +
      '{"tipo":"eliminar","producto_id":N} — si el producto tiene pedidos se desactiva en lugar de borrarse. ' +
      '{"tipo":"estado_pedido","numero":N,"estado":"confirmado|preparando|enviado|entregado|cancelado"}. ' +
      'Si la respuesta trae "errores", corrígelos y vuelve a llamar.',
    input_schema: {
      type: 'object',
      properties: {
        operaciones: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'object' } },
        explicacion: { type: 'string', description: 'Resumen en una frase de lo que se propone.' },
      },
      required: ['operaciones'],
    },
  },
];

const AGENT_PROMPTS: Record<AgentMode, string> = {
  carrito: `MODO CARRITO. Puedes gestionar el carrito DEL USUARIO con las herramientas disponibles.
- Busca siempre el producto con buscar_productos para obtener su id; nunca inventes ids, precios ni stock.
- Si hay varias opciones razonables (distintas presentaciones, sabores o marcas) y el usuario no especificó, pregunta cuál quiere antes de agregar, mostrando las opciones con su precio. Si solo una coincide claramente, agrégala.
- Si la cantidad no se indica, usa 1. Si no hay stock suficiente o está agotado, dilo y ofrece alternativas del resultado de búsqueda.
- Después de modificar el carrito, confirma qué cambió (producto, cantidad, precio) y el total actual del carrito; indica que puede pagar desde el carrito.
- NO puedes cambiar precios, stock ni productos del catálogo, ni aplicar descuentos o procesar pagos. Si te lo piden, explica que no tienes permiso para eso.
- Las reglas de salud siguen vigentes: no recomiendes dosis ni des consejo médico.`,
  admin: `MODO ADMINISTRADOR. El servidor verificó que el usuario actual es ADMINISTRADOR de IronCart.
- Puedes consultar el catálogo (incluidos productos inactivos) y los pedidos, y PROPONER cambios con proponer_cambios.
- Los cambios NO se aplican hasta que el administrador pulse "Confirmar" en la tarjeta que verá debajo de tu mensaje. Nunca digas que un cambio ya está hecho; di que está listo para confirmar.
- Busca siempre los productos para obtener sus ids y valores actuales. Si una instrucción es ambigua (p. ej. varias presentaciones coinciden), pregunta antes de proponer, salvo que el administrador haya dicho "todas".
- Para crear un producto necesitas: nombre, marca, categoría, descripción, presentación, precio y stock. Pide lo que falte; si el administrador te deja redactar la descripción, escribe una breve y objetiva, sin afirmaciones de salud.
- Las subidas o bajadas relativas ("sube 5 unidades", "baja 10 %") calcúlalas tú a partir del valor actual y redondea precios a 2 decimales.
- Tras proponer, resume en una lista corta qué cambiará y pide confirmar con el botón.`,
};

// ------------------------------------------------------------------ ejecución de herramientas
interface AgentCtx {
  mode: AgentMode;
  usuario: Usuario | null;
  carritoId: string | null;
  conversacionId: string;
  // salidas acumuladas
  productos: Map<number, ProductoChat>;
  carrito?: Record<string, unknown>;
  accion?: { id: string; resumen: unknown[]; expira_en_min: number };
  herramientas: string[];
}

const productoBreve = (p: ProductoChat) => ({
  id: p.id, nombre: p.nombre, marca: p.marca, presentacion: p.presentacion, sabor: p.sabor, precio_usd: Number(p.precio),
  stock: p.stock, disponibilidad: p.stock === 0 ? 'agotado' : p.stock <= 5 ? 'pocas unidades' : 'disponible',
});

const carritoBreve = (c: { items?: Array<{ cantidad: number; subtotal: number; producto: ProductoChat }>; subtotal?: number; envio?: number; total?: number }) => ({
  items: (c.items ?? []).map((i) => ({ producto_id: i.producto.id, nombre: `${i.producto.nombre} ${i.producto.presentacion}`, cantidad: i.cantidad, subtotal_usd: Number(i.subtotal) })),
  subtotal_usd: Number(c.subtotal ?? 0), envio_usd: Number(c.envio ?? 0), total_usd: Number(c.total ?? 0),
});

async function execTool(ctx: AgentCtx, name: string, input: Record<string, unknown>): Promise<unknown> {
  ctx.herramientas.push(name);
  const int = (v: unknown, min: number, max: number) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`valor entero fuera de rango (${min}-${max})`);
    return n;
  };

  // --- herramientas de cliente ---
  if (ctx.mode === 'carrito') {
    switch (name) {
      case 'buscar_productos': {
        const q = String(input.consulta ?? '').slice(0, 100);
        const cat = CATEGORIAS.includes(String(input.categoria)) ? String(input.categoria) : undefined;
        let ps = await rpc<ProductoChat[]>('api_buscar_productos_chat', { q, categoria: cat, limite: 8 });
        if (ps.length) { const top = ps[0].score ?? 0; ps = ps.filter((p) => (p.score ?? 0) >= top * 0.5).slice(0, 6); }
        return { resultados: ps.map(productoBreve) };
      }
      case 'agregar_al_carrito':
      case 'cambiar_cantidad_en_carrito': {
        const productoId = int(input.producto_id, 1, 1e9);
        const cantidad = int(input.cantidad, name === 'agregar_al_carrito' ? 1 : 0, 20);
        const r = await rpc<{ ok: boolean; error?: string; disponible?: number; carrito?: Record<string, unknown> }>('api_carrito_guardar_item', {
          carrito_id: ctx.carritoId, usuario_id: ctx.usuario?.id ?? null, producto_id: productoId, cantidad,
          modo: name === 'agregar_al_carrito' ? 'sumar' : 'fijar',
        });
        if (r.carrito) { ctx.carrito = r.carrito; ctx.carritoId = (r.carrito.id as string) ?? ctx.carritoId; }
        const [p] = await rpc<ProductoChat[]>('api_buscar_productos_chat', { ids: [productoId] });
        if (p) ctx.productos.set(p.id, p);
        if (!r.ok) return { ok: false, error: r.error, disponible: r.disponible };
        return { ok: true, carrito: carritoBreve(r.carrito as never) };
      }
      case 'ver_carrito': {
        const c = await rpc<Record<string, unknown>>('api_carrito_obtener', { carrito_id: ctx.carritoId, usuario_id: ctx.usuario?.id ?? null });
        ctx.carrito = c;
        return carritoBreve(c as never);
      }
    }
    return { error: 'herramienta no disponible para este usuario' };
  }

  // --- herramientas de administrador: se re-verifica el rol en cada llamada ---
  if (ctx.usuario?.rol !== 'admin') return { error: 'sin permiso: se requiere rol administrador' };
  switch (name) {
    case 'buscar_productos_admin': {
      const r = await rpc<Array<Record<string, unknown>>>('api_admin_buscar_productos', {
        q: String(input.consulta ?? '').slice(0, 100),
        categoria: CATEGORIAS.includes(String(input.categoria)) ? input.categoria : '',
        stock_max: input.stock_maximo === undefined ? null : int(input.stock_maximo, 0, 100000),
        limite: 25,
      });
      return { resultados: r.map(({ descripcion, beneficios, color, imagen, ...rest }) => ({ ...rest, descripcion: String(descripcion ?? '').slice(0, 160) })) };
    }
    case 'consultar_pedidos': {
      const estados = ['confirmado', 'preparando', 'enviado', 'entregado', 'cancelado'];
      const r = await rpc<Array<{ numero: number; estado: string; total: number; creado_en: string; items: Array<{ cantidad: number }> }>>('api_admin_pedidos', {
        estado: estados.includes(String(input.estado)) ? input.estado : '',
      });
      return { pedidos: r.slice(0, 30).map((p) => ({ numero: p.numero, estado: p.estado, total_usd: p.total, fecha: p.creado_en, productos: p.items.reduce((s, i) => s + i.cantidad, 0) })) };
    }
    case 'proponer_cambios': {
      const ops = Array.isArray(input.operaciones) ? input.operaciones.slice(0, 20) : [];
      const r = await rpc<{ ok: boolean; id?: string; resumen?: unknown[]; errores?: unknown[]; expira_en_min?: number }>('api_admin_preparar_accion', {
        usuario_id: ctx.usuario.id, conversacion_id: ctx.conversacionId, operaciones: ops,
      });
      if (!r.ok) return { ok: false, errores: r.errores };
      ctx.accion = { id: r.id!, resumen: r.resumen ?? [], expira_en_min: r.expira_en_min ?? 15 };
      return { ok: true, estado: 'pendiente de confirmación por el administrador', resumen: r.resumen };
    }
  }
  return { error: 'herramienta desconocida' };
}

// ------------------------------------------------------------------ bucle del agente
export interface AgentResult {
  ok: boolean;
  texto: string;
  productos: ProductoChat[];
  carrito?: Record<string, unknown>;
  accion?: { id: string; resumen: unknown[]; expira_en_min: number };
  herramientas: string[];
  modelo?: string;
  motivo?: string;
}

export async function runAgent(args: {
  mode: AgentMode; mensaje: string; history: Array<{ rol: 'user' | 'assistant'; contenido: string }>;
  usuario: Usuario | null; carritoId: string | null; conversacionId: string;
}): Promise<AgentResult> {
  if (args.mode === 'admin' && args.usuario?.rol !== 'admin') {
    // Defensa en profundidad: nunca se ejecuta el modo admin sin rol admin.
    return { ok: false, texto: '', productos: [], herramientas: [], motivo: 'sin_permiso' };
  }
  const ctx: AgentCtx = {
    mode: args.mode, usuario: args.usuario, carritoId: args.carritoId, conversacionId: args.conversacionId,
    productos: new Map(), herramientas: [],
  };
  const tools = args.mode === 'admin' ? ADMIN_TOOLS : CARRITO_TOOLS;
  const system = [SYSTEM_PROMPT, AGENT_PROMPTS[args.mode]];

  const messages: AgentMessage[] = args.history.map((m) => ({
    role: m.rol,
    content: m.rol === 'user' ? `<mensaje_usuario>\n${escapeTags(m.contenido)}\n</mensaje_usuario>` : m.contenido,
  }));
  while (messages.length && messages[0].role !== 'user') messages.shift();
  messages.push({ role: 'user', content: `<mensaje_usuario>\n${escapeTags(args.mensaje)}\n</mensaje_usuario>` });

  let modelo: string | undefined;
  const deadline = Date.now() + 40_000;
  for (let paso = 0; paso < 6 && Date.now() < deadline; paso++) {
    const r = await callClaudeRaw({ system, messages, tools, maxTokens: 900 });
    if (!r.ok) {
      return { ok: false, texto: '', productos: [...ctx.productos.values()], carrito: ctx.carrito, accion: ctx.accion, herramientas: ctx.herramientas, motivo: r.reason };
    }
    modelo = r.model;
    const usos = r.content.filter((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use');
    if (r.stopReason !== 'tool_use' || usos.length === 0) {
      return { ok: true, texto: textOf(r.content), productos: [...ctx.productos.values()], carrito: ctx.carrito, accion: ctx.accion, herramientas: ctx.herramientas, modelo };
    }
    messages.push({ role: 'assistant', content: r.content });
    const resultados: ContentBlock[] = [];
    for (const u of usos) {
      let out: unknown;
      let isError = false;
      try { out = await execTool(ctx, u.name, u.input ?? {}); } catch (e) { out = { error: (e as Error).message }; isError = true; }
      resultados.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out), ...(isError ? { is_error: true } : {}) });
    }
    messages.push({ role: 'user', content: resultados });
  }
  return { ok: false, texto: '', productos: [...ctx.productos.values()], carrito: ctx.carrito, accion: ctx.accion, herramientas: ctx.herramientas, modelo, motivo: 'demasiados_pasos' };
}
