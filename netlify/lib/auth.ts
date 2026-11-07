import { createHash, randomBytes } from 'node:crypto';
import { rpc } from './db';
import { env } from './env';
import { getCookie, HttpError } from './http';

export const SESSION_COOKIE = 'ic_session';
export const CART_COOKIE = 'ic_cart';
export const SESSION_TTL_HOURS = 24 * 7;

export interface Usuario { id: string; nombre: string; email: string; rol: string }

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');

/** Identificador irreversible de la IP (minimización de datos para rate limiting). */
export const ipKey = (ip: string) => sha256(`${env.ipHashSalt}:${ip}`).slice(0, 32);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === 'string' && UUID.test(s);

/** Token de sesión: cabecera x-ic-session (frontend en otro dominio) o cookie HttpOnly (mismo dominio). */
export const sessionToken = (req: Request) => req.headers.get('x-ic-session') || getCookie(req, SESSION_COOKIE);

export async function currentUser(req: Request): Promise<Usuario | null> {
  const token = sessionToken(req);
  if (!token || token.length < 20 || token.length > 100) return null;
  return rpc<Usuario | null>('api_sesion_usuario', { token_hash: sha256(token) });
}

export async function requireUser(req: Request): Promise<Usuario> {
  const u = await currentUser(req);
  if (!u) throw new HttpError(401, 'no_autenticado', 'Inicia sesión para continuar.');
  return u;
}

/** Solo cuentas con rol 'admin'. Sin sesión → 401; con sesión de cliente → 403. */
export async function requireAdmin(req: Request): Promise<Usuario> {
  const u = await requireUser(req);
  if (u.rol !== 'admin') throw new HttpError(403, 'sin_permiso', 'Esta sección es solo para administradores.');
  return u;
}

export function cartIdFromCookie(req: Request): string | null {
  const c = req.headers.get('x-ic-cart') || getCookie(req, CART_COOKIE);
  return isUuid(c) ? c : null;
}

export async function rateLimit(clave: string, limite: number, ventanaSeg: number): Promise<{ permitido: boolean; reinicia_en: number }> {
  return rpc('api_rate_limit', { clave, limite, ventana_seg: ventanaSeg });
}
