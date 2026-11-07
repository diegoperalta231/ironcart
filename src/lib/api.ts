/** Cliente HTTP del frontend. Solo habla con /api (Netlify Functions); nunca con Supabase ni Anthropic. */
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public data?: Record<string, unknown>) {
    super(message);
  }
}

import { local } from './format';

/**
 * Base de la API. En Netlify con funciones: "/api" (mismo dominio, cookies HttpOnly).
 * Si el backend corre en otro dominio (Supabase Edge Functions), VITE_API_URL apunta a él
 * y la sesión/carrito viajan en las cabeceras x-ic-session / x-ic-cart.
 */
const API_BASE = ((import.meta.env.VITE_API_URL as string | undefined) || '/api').replace(/\/+$/, '');
const CROSS_ORIGIN = /^https?:\/\//.test(API_BASE);
export const SESSION_KEY = 'ic_sesion';
export const CART_KEY = 'ic_carrito';

export async function api<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let res: Response;
  try {
    const headers: Record<string, string> = {};
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    if (CROSS_ORIGIN) {
      const s = local.get(SESSION_KEY); const c = local.get(CART_KEY);
      if (s) headers['x-ic-session'] = s;
      if (c) headers['x-ic-cart'] = c;
    }
    res = await fetch(`${API_BASE}${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      credentials: CROSS_ORIGIN ? 'omit' : 'same-origin',
      signal: init.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'sin_conexion', 'No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.');
  }
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* respuesta no JSON */ }
  if (CROSS_ORIGIN && data && typeof data === 'object') {
    // Recordar el carrito asignado por el servidor (equivale a la cookie ic_cart).
    const d = data as { carrito?: { id?: string | null }; sesion_token?: string };
    if (d.carrito && 'id' in d.carrito) { if (d.carrito.id) local.set(CART_KEY, d.carrito.id); }
    if (d.sesion_token) local.set(SESSION_KEY, d.sesion_token);
    if ((d as { error?: string }).error === 'no_autenticado') local.del(SESSION_KEY);
  }
  if (!res.ok) {
    const d = (data ?? {}) as Record<string, unknown>;
    throw new ApiError(res.status, String(d.error ?? 'error'), String(d.mensaje ?? 'Ocurrió un error. Inténtalo de nuevo.'), d);
  }
  return data as T;
}
