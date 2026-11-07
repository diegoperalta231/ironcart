import { env } from './env';

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public extra?: Record<string, unknown>) {
    super(message);
  }
}

export const isHttps = (req: Request) =>
  new URL(req.url).protocol === 'https:' || req.headers.get('x-forwarded-proto') === 'https';

const BASE_HEADERS: Record<string, string> = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

export function json(data: unknown, status = 200, extra: HeadersInit = {}): Response {
  const headers = new Headers(BASE_HEADERS);
  new Headers(extra).forEach((v, k) => headers.append(k, v));
  return new Response(JSON.stringify(data), { status, headers });
}

export function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) {
    return json({ error: e.code, mensaje: e.message, ...(e.extra ?? {}) }, e.status);
  }
  // Nunca se devuelven detalles internos (claves, SQL, stack) al cliente.
  console.error('[api] error no controlado:', e instanceof Error ? e.message : e);
  return json({ error: 'error_interno', mensaje: 'Ocurrió un error inesperado. Intenta de nuevo en unos segundos.' }, 500);
}

// ----------------------------- Cookies ------------------------------------
export function getCookie(req: Request, name: string): string | null {
  const raw = req.headers.get('cookie') ?? '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function setCookie(req: Request, name: string, value: string, maxAgeSec: number): string {
  const secure = isHttps(req) ? '; Secure' : '';
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`;
}

export const clearCookie = (req: Request, name: string) => setCookie(req, name, '', 0);

// ------------------------- CORS / origen ----------------------------------
/** Admite entradas exactas o con comodín de subdominio: "https://*.netlify.app". */
export function originAllowed(origin: string): boolean {
  return env.allowedOrigins.some((o) => {
    if (o === origin) return true;
    const m = o.match(/^(https?:\/\/)\*\.(.+)$/);
    return !!m && origin.startsWith(m[1]) && origin.endsWith('.' + m[2]) && !origin.slice(m[1].length).includes('/');
  });
}
/** Bloquea peticiones que modifican estado desde orígenes ajenos (CSRF). */
export function assertSameOrigin(req: Request): void {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return;
  const origin = req.headers.get('origin');
  if (!origin) return; // clientes no-navegador (sin cookies de sesión de terceros)
  const host = req.headers.get('x-forwarded-host') ?? new URL(req.url).host;
  let originHost = '';
  try { originHost = new URL(origin).host; } catch { /* origen inválido */ }
  if (originHost === host || originAllowed(origin)) return;
  throw new HttpError(403, 'origen_no_permitido', 'Origen no permitido.');
}

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin');
  if (origin && originAllowed(origin)) {
    return {
      'access-control-allow-origin': origin,
      'access-control-allow-credentials': 'true',
      'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'access-control-allow-headers': 'content-type, x-ic-session, x-ic-cart',
      'access-control-expose-headers': 'content-type',
      'access-control-max-age': '600',
      vary: 'Origin',
    };
  }
  return {};
}

export async function readJson<T = Record<string, unknown>>(req: Request, maxBytes = 16_384): Promise<T> {
  const ct = req.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) throw new HttpError(415, 'tipo_no_soportado', 'Se esperaba JSON.');
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, 'cuerpo_muy_grande', 'La solicitud es demasiado grande.');
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
    return v as T;
  } catch {
    throw new HttpError(400, 'json_invalido', 'El cuerpo de la solicitud no es JSON válido.');
  }
}

export function clientIp(req: Request, ctxIp?: string): string {
  return ctxIp ?? req.headers.get('x-nf-client-connection-ip') ?? req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? '0.0.0.0';
}
