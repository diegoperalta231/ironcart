/**
 * Acceso a datos: SOLO a través de funciones RPC de Postgres expuestas por
 * PostgREST (Supabase). No se construye SQL en el servidor, por lo que no hay
 * superficie de inyección SQL: los datos viajan como JSON y las funciones
 * usan parámetros tipados. Se usa la clave service_role (solo en servidor).
 */
import { env } from './env';
import { HttpError } from './http';

export async function rpc<T = unknown>(fn: string, p: Record<string, unknown> = {}, timeoutMs = 8000): Promise<T> {
  const url = env.supabaseUrl;
  const key = env.supabaseServiceKey;
  if (!url || !key) {
    throw new HttpError(503, 'bd_no_configurada', 'La base de datos no está configurada (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).');
  }
  if (!/^api_[a-z_]+$/.test(fn)) throw new Error(`RPC no permitida: ${fn}`);

  const headers: Record<string, string> = { apikey: key, 'content-type': 'application/json', accept: 'application/json' };
  // Claves "legacy" (JWT) van también en Authorization; las nuevas sb_secret_ solo en apikey.
  if (key.startsWith('eyJ')) headers.authorization = `Bearer ${key}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${url}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify({ p }), signal: ctrl.signal });
  } catch (e) {
    console.error(`[db] ${fn} sin respuesta:`, (e as Error).message);
    throw new HttpError(503, 'bd_no_disponible', 'No pudimos conectar con la base de datos. Intenta de nuevo.');
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error(`[db] ${fn} -> HTTP ${res.status}: ${detail.slice(0, 300)}`);
    throw new HttpError(502, 'bd_error', 'La base de datos devolvió un error.');
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}
