/**
 * IRONCART · API REST serverless (Netlify Functions v2)
 * Una sola función atiende /api/* y despacha a los manejadores.
 *
 *  GET    /api/salud
 *  GET    /api/categorias | /api/marcas
 *  GET    /api/productos?q=&categoria=&marca=&orden=&solo_disponibles=&destacados=&pagina=&por_pagina=
 *  GET    /api/productos/:slug
 *  GET    /api/carrito
 *  POST   /api/carrito/items            {producto_id, cantidad}
 *  PATCH  /api/carrito/items/:id        {cantidad}
 *  DELETE /api/carrito/items/:id
 *  DELETE /api/carrito
 *  POST   /api/auth/registro            {nombre, email, password}
 *  POST   /api/auth/login               {email, password}
 *  POST   /api/auth/logout
 *  GET    /api/auth/yo
 *  GET    /api/pedidos | /api/pedidos/:numero          (requiere sesión)
 *  POST   /api/pedidos                  {envio:{nombre,direccion,ciudad,telefono?}, metodo_pago}
 *  POST   /api/chatbot/mensaje          {mensaje, conversacion_id?}
 *  GET    /api/chatbot/historial?conversacion_id=
 *  POST   /api/contacto                 {nombre, email, asunto, mensaje}
 *  POST   /api/admin/embeddings         (cabecera x-admin-token)
 */
import { rpc } from '../lib/db';
import { env } from '../lib/env';
import {
  assertSameOrigin, clearCookie, clientIp, corsHeaders, errorResponse, HttpError, json, readJson, setCookie,
} from '../lib/http';
import {
  CART_COOKIE, cartIdFromCookie, currentUser, ipKey, isUuid, newToken, rateLimit, requireUser,
  SESSION_COOKIE, SESSION_TTL_HOURS, sha256, type Usuario,
} from '../lib/auth';
import * as v from '../lib/validate';
import { handleSpotMessage } from '../lib/spot/spot';
import { sanitizeUserText } from '../lib/spot/normalize';
import { embed } from '../lib/spot/retrieval';

type Ctx = { ip?: string };
type Handler = (req: Request, params: string[], ctx: Ctx) => Promise<Response>;
const routes: Array<[string, RegExp, Handler]> = [];
const on = (method: string, pattern: RegExp, h: Handler) => routes.push([method, pattern, h]);

// --------------------------------------------------------------- utilidades
async function limitOrThrow(clave: string, limite: number, ventanaSeg: number, mensaje: string) {
  const r = await rateLimit(clave, limite, ventanaSeg);
  if (!r.permitido) {
    throw new HttpError(429, 'demasiadas_solicitudes', mensaje, { reintentar_en: r.reinicia_en });
  }
}

function cartResponse(req: Request, body: Record<string, unknown>, status = 200): Response {
  const carrito = body.carrito as { id?: string } | undefined;
  const headers: HeadersInit = carrito?.id ? { 'set-cookie': setCookie(req, CART_COOKIE, carrito.id, 60 * 60 * 24 * 30) } : {};
  return json(body, status, headers);
}

// ------------------------------------------------------------------ catálogo
on('GET', /^\/api\/salud$/, async () => {
  let db: unknown = null;
  try { db = await rpc('api_salud'); } catch { db = null; }
  return json({
    ok: db !== null,
    base_de_datos: db ? 'conectada' : 'no_disponible',
    ia: env.anthropicKey ? 'configurada' : 'sin_clave',
    modelo: env.anthropicModel,
    rag: env.voyageKey ? 'hibrido (pgvector + FTS)' : 'texto (FTS PostgreSQL)',
    detalle: db,
  });
});

on('GET', /^\/api\/categorias$/, async () => json(await rpc('api_categorias'), 200, { 'cache-control': 'public, max-age=60' }));
on('GET', /^\/api\/marcas$/, async () => json(await rpc('api_marcas'), 200, { 'cache-control': 'public, max-age=60' }));

on('GET', /^\/api\/productos$/, async (req) => {
  const u = new URL(req.url).searchParams;
  const porPagina = Math.min(Math.max(Number(u.get('por_pagina')) || 12, 1), 48);
  const pagina = Math.max(Number(u.get('pagina')) || 1, 1);
  const orden = u.get('orden') ?? 'relevancia';
  const p = {
    q: (u.get('q') ?? '').slice(0, 80),
    categoria: /^[a-z0-9-]{0,40}$/.test(u.get('categoria') ?? '') ? u.get('categoria') : '',
    marca: /^[a-z0-9-]{0,40}$/.test(u.get('marca') ?? '') ? u.get('marca') : '',
    orden: ['relevancia', 'precio_asc', 'precio_desc', 'nombre', 'nuevos'].includes(orden) ? orden : 'relevancia',
    solo_disponibles: u.get('solo_disponibles') === 'true',
    destacados: u.get('destacados') === 'true',
    limite: porPagina,
    offset: (pagina - 1) * porPagina,
  };
  const r = await rpc<{ total: number; items: unknown[] }>('api_catalogo', p);
  return json({ ...r, pagina, por_pagina: porPagina, paginas: Math.max(1, Math.ceil(r.total / porPagina)) });
});

on('GET', /^\/api\/productos\/([a-z0-9-]{1,80})$/, async (_req, [slug]) => {
  const p = await rpc('api_producto', { slug });
  if (!p) throw new HttpError(404, 'no_encontrado', 'Producto no encontrado.');
  return json(p);
});

// ------------------------------------------------------------------- carrito
on('GET', /^\/api\/carrito$/, async (req) => {
  const user = await currentUser(req);
  const carrito = await rpc<{ id: string | null }>('api_carrito_obtener', { carrito_id: cartIdFromCookie(req), usuario_id: user?.id ?? null });
  return cartResponse(req, { carrito });
});

async function saveItem(req: Request, productoId: number, cantidad: number, modo: 'sumar' | 'fijar') {
  const user = await currentUser(req);
  const r = await rpc<{ ok: boolean; error?: string; disponible?: number; carrito?: unknown }>('api_carrito_guardar_item', {
    carrito_id: cartIdFromCookie(req), usuario_id: user?.id ?? null, producto_id: productoId, cantidad, modo,
  });
  if (!r.ok) {
    const msg: Record<string, string> = {
      stock_insuficiente: `Solo hay ${r.disponible ?? 0} unidades disponibles de este producto.`,
      limite_por_producto: 'El máximo por producto es de 20 unidades.',
      producto_no_encontrado: 'El producto no existe o ya no está disponible.',
      cantidad_invalida: 'Cantidad inválida.',
    };
    return cartResponse(req, { ...r, mensaje: msg[r.error ?? ''] ?? 'No se pudo actualizar el carrito.' }, 409);
  }
  return cartResponse(req, r);
}

on('POST', /^\/api\/carrito\/items$/, async (req) => {
  const b = await readJson(req);
  return saveItem(req, v.int(b.producto_id, 'producto_id', { min: 1 }), v.int(b.cantidad ?? 1, 'cantidad', { min: 1, max: 20 }), 'sumar');
});
on('PATCH', /^\/api\/carrito\/items\/(\d{1,9})$/, async (req, [id]) => {
  const b = await readJson(req);
  return saveItem(req, Number(id), v.int(b.cantidad, 'cantidad', { min: 0, max: 20 }), 'fijar');
});
on('DELETE', /^\/api\/carrito\/items\/(\d{1,9})$/, async (req, [id]) => saveItem(req, Number(id), 0, 'fijar'));
on('DELETE', /^\/api\/carrito$/, async (req) => {
  const user = await currentUser(req);
  return cartResponse(req, await rpc('api_carrito_vaciar', { carrito_id: cartIdFromCookie(req), usuario_id: user?.id ?? null }));
});

// ---------------------------------------------------------------- auth
async function startSession(req: Request, email: string, password: string) {
  const token = newToken();
  const r = await rpc<{ ok: boolean; usuario?: Usuario }>('api_login', { email, password, token_hash: sha256(token), ttl_horas: SESSION_TTL_HOURS });
  if (!r.ok || !r.usuario) throw new HttpError(401, 'credenciales_invalidas', 'Correo o contraseña incorrectos.');
  // Asociar/fusionar el carrito de invitado con el del usuario.
  const carrito = await rpc<{ id: string | null }>('api_carrito_obtener', { carrito_id: cartIdFromCookie(req), usuario_id: r.usuario.id });
  const headers = new Headers();
  headers.append('set-cookie', setCookie(req, SESSION_COOKIE, token, SESSION_TTL_HOURS * 3600));
  if (carrito.id) headers.append('set-cookie', setCookie(req, CART_COOKIE, carrito.id, 60 * 60 * 24 * 30));
  return json({ usuario: r.usuario, carrito }, 200, headers);
}

on('POST', /^\/api\/auth\/registro$/, async (req, _p, ctx) => {
  await limitOrThrow(`registro:${ipKey(clientIp(req, ctx.ip))}`, 5, 3600, 'Demasiados registros desde esta conexión. Intenta más tarde.');
  const b = await readJson(req);
  const nombre = v.str(b.nombre, 'nombre', { min: 2, max: 80 });
  const email = v.email(b.email);
  const password = v.password(b.password);
  const r = await rpc<{ ok: boolean; error?: string }>('api_registro', { nombre, email, password });
  if (!r.ok) throw new HttpError(409, 'email_existente', 'Ya existe una cuenta con ese correo.');
  return startSession(req, email, password);
});

on('POST', /^\/api\/auth\/login$/, async (req, _p, ctx) => {
  await limitOrThrow(`login:${ipKey(clientIp(req, ctx.ip))}`, 10, 900, 'Demasiados intentos de inicio de sesión. Espera unos minutos.');
  const b = await readJson(req);
  return startSession(req, v.email(b.email), v.password(b.password));
});

on('POST', /^\/api\/auth\/logout$/, async (req) => {
  const token = req.headers.get('cookie')?.match(/(?:^|;\s*)ic_session=([^;]+)/)?.[1];
  if (token) await rpc('api_sesion_cerrar', { token_hash: sha256(decodeURIComponent(token)) });
  const headers = new Headers();
  headers.append('set-cookie', clearCookie(req, SESSION_COOKIE));
  headers.append('set-cookie', clearCookie(req, CART_COOKIE));
  return json({ ok: true }, 200, headers);
});

on('GET', /^\/api\/auth\/yo$/, async (req) => json({ usuario: await currentUser(req) }));

// -------------------------------------------------------------- pedidos
on('GET', /^\/api\/pedidos$/, async (req) => {
  const u = await requireUser(req);
  return json(await rpc('api_pedidos_usuario', { usuario_id: u.id }));
});

on('GET', /^\/api\/pedidos\/(\d{1,9})$/, async (req, [numero]) => {
  const u = await requireUser(req);
  const p = await rpc('api_pedido_detalle', { usuario_id: u.id, numero: Number(numero) });
  // Mismo 404 tanto si no existe como si es de otro usuario (no se filtra información).
  if (!p) throw new HttpError(404, 'no_encontrado', 'No encontramos ese pedido en tu cuenta.');
  return json(p);
});

on('POST', /^\/api\/pedidos$/, async (req) => {
  const u = await requireUser(req);
  const b = await readJson(req);
  const e = (b.envio ?? {}) as Record<string, unknown>;
  const envio = {
    nombre: v.str(e.nombre, 'nombre', { min: 3, max: 80 }),
    direccion: v.str(e.direccion, 'direccion', { min: 5, max: 160 }),
    ciudad: v.str(e.ciudad, 'ciudad', { min: 2, max: 60 }),
    telefono: v.str(e.telefono, 'telefono', { min: 7, max: 20, optional: true }),
  };
  if (envio.telefono && !/^[+\d][\d\s-]{6,19}$/.test(envio.telefono)) throw new HttpError(400, 'dato_invalido', 'Teléfono inválido.', { campo: 'telefono' });
  const metodo_pago = v.oneOf(b.metodo_pago, 'metodo_pago', ['tarjeta_demo', 'transferencia_demo', 'contra_entrega_demo'] as const);
  const r = await rpc<{ ok: boolean; error?: string; productos?: unknown; pedido?: unknown }>('api_checkout', {
    usuario_id: u.id, carrito_id: cartIdFromCookie(req), envio, metodo_pago,
  });
  if (!r.ok) {
    const map: Record<string, [number, string]> = {
      carrito_vacio: [400, 'Tu carrito está vacío.'],
      stock_insuficiente: [409, 'Algunos productos ya no tienen existencias suficientes. Ajusta las cantidades.'],
    };
    const [status, msg] = map[r.error ?? ''] ?? [400, 'No se pudo completar el pedido.'];
    throw new HttpError(status, r.error ?? 'checkout_error', msg, { productos: r.productos });
  }
  return json(r, 201, { 'set-cookie': clearCookie(req, CART_COOKIE) });
});

// -------------------------------------------------------------- chatbot Spot
on('POST', /^\/api\/chatbot\/mensaje$/, async (req, _p, ctx) => {
  const ipk = ipKey(clientIp(req, ctx.ip));
  await limitOrThrow(`chat:min:${ipk}`, env.chatRatePerMinute, 60, 'Estás enviando mensajes muy rápido. Espera unos segundos e inténtalo de nuevo.');
  await limitOrThrow(`chat:dia:${ipk}`, env.chatRatePerDay, 86400, 'Alcanzaste el límite diario de mensajes con Spot. Vuelve mañana.');
  const b = await readJson(req, 8192);
  if (typeof b.mensaje !== 'string') throw new HttpError(400, 'dato_invalido', 'El mensaje es obligatorio.');
  const mensaje = sanitizeUserText(b.mensaje, 800);
  if (!mensaje) throw new HttpError(400, 'dato_invalido', 'El mensaje está vacío.');
  if (b.mensaje.length > 1200) throw new HttpError(400, 'mensaje_largo', 'El mensaje es demasiado largo (máximo 800 caracteres).');
  const conversacionId = isUuid(b.conversacion_id) ? b.conversacion_id : null;
  const usuario = await currentUser(req);
  return json(await handleSpotMessage({ mensaje, conversacionId, usuario }));
});

on('GET', /^\/api\/chatbot\/historial$/, async (req) => {
  const id = new URL(req.url).searchParams.get('conversacion_id');
  if (!isUuid(id)) return json({ conversacion_id: null, mensajes: [] });
  const usuario = await currentUser(req);
  const r = await rpc<{ conversacion_id: string; mensajes: Array<Record<string, unknown>> }>('api_chat_contexto', {
    conversacion_id: id, usuario_id: usuario?.id ?? null, limite: 30,
  });
  // Si la conversación no pertenecía a este actor, api_chat_contexto crea una nueva (vacía).
  return json({
    conversacion_id: r.conversacion_id,
    mensajes: r.mensajes.map((m) => ({ rol: m.rol, contenido: m.contenido, creado_en: m.creado_en })),
  });
});

// -------------------------------------------------------------- contacto
on('POST', /^\/api\/contacto$/, async (req, _p, ctx) => {
  await limitOrThrow(`contacto:${ipKey(clientIp(req, ctx.ip))}`, 5, 3600, 'Has enviado demasiados mensajes. Intenta más tarde.');
  const b = await readJson(req);
  const r = await rpc('api_contacto', {
    nombre: v.str(b.nombre, 'nombre', { min: 2, max: 80 }),
    email: v.email(b.email),
    asunto: v.str(b.asunto, 'asunto', { min: 3, max: 120 }),
    mensaje: v.str(b.mensaje, 'mensaje', { min: 10, max: 2000 }),
  });
  return json(r, 201);
});

// -------------------------------------------------------------- admin: embeddings RAG
on('POST', /^\/api\/admin\/embeddings$/, async (req) => {
  const token = req.headers.get('x-admin-token') ?? '';
  if (!env.adminToken || token.length < 16 || sha256(token) !== sha256(env.adminToken)) {
    throw new HttpError(401, 'no_autorizado', 'No autorizado.');
  }
  if (!env.voyageKey) throw new HttpError(400, 'sin_proveedor', 'Configura VOYAGE_API_KEY para generar embeddings.');
  const pend = await rpc<Array<{ id: number; texto: string }>>('api_conocimiento_pendientes', { modelo: env.voyageModel, limite: 32 });
  if (pend.length === 0) return json({ ok: true, procesados: 0, estado: await rpc('api_conocimiento_estado_vectorial') });
  const vectors = await embed(pend.map((p) => p.texto), 'document');
  for (let i = 0; i < pend.length; i++) {
    await rpc('api_conocimiento_guardar_embedding', { id: pend[i].id, embedding: JSON.stringify(vectors[i]), modelo: env.voyageModel });
  }
  return json({ ok: true, procesados: pend.length, estado: await rpc('api_conocimiento_estado_vectorial') });
});

// -------------------------------------------------------------- despacho
export default async (req: Request, context: Ctx = {}): Promise<Response> => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  try {
    assertSameOrigin(req);
    // Acepta la ruta pública (/api/...) y la interna de Netlify (/.netlify/functions/api/...).
    const path = new URL(req.url).pathname.replace(/^\/\.netlify\/functions\/api(?=\/|$)/, '/api').replace(/\/+$/, '') || '/';
    let pathMatched = false;
    for (const [method, re, handler] of routes) {
      const m = path.match(re);
      if (!m) continue;
      pathMatched = true;
      if (method !== req.method) continue;
      const res = await handler(req, m.slice(1), context);
      for (const [k, val] of Object.entries(cors)) res.headers.set(k, val);
      return res;
    }
    throw pathMatched
      ? new HttpError(405, 'metodo_no_permitido', 'Método no permitido.')
      : new HttpError(404, 'ruta_no_encontrada', 'Ruta no encontrada.');
  } catch (e) {
    const res = errorResponse(e);
    for (const [k, val] of Object.entries(cors)) res.headers.set(k, val);
    return res;
  }
};

// El enrutamiento /api/* → esta función se define en netlify.toml (antes del fallback SPA).
