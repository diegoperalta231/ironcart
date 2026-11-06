/** Cliente HTTP del frontend. Solo habla con /api (Netlify Functions); nunca con Supabase ni Anthropic. */
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public data?: Record<string, unknown>) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: init.method ?? 'GET',
      headers: init.body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      credentials: 'same-origin',
      signal: init.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'sin_conexion', 'No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.');
  }
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* respuesta no JSON */ }
  if (!res.ok) {
    const d = (data ?? {}) as Record<string, unknown>;
    throw new ApiError(res.status, String(d.error ?? 'error'), String(d.mensaje ?? 'Ocurrió un error. Inténtalo de nuevo.'), d);
  }
  return data as T;
}
