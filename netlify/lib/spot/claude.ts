/**
 * Cliente mínimo de la API Messages de Anthropic (https://docs.claude.com).
 * Se usa fetch directamente (sin SDK) para mantener las funciones ligeras.
 * La API key solo existe en el servidor (process.env.ANTHROPIC_API_KEY).
 */
import { env } from '../env';

export interface ChatTurn { role: 'user' | 'assistant'; content: string }

export type ClaudeResult =
  | { ok: true; text: string; model: string; usage?: { input_tokens: number; output_tokens: number }; ms: number }
  | { ok: false; reason: 'sin_clave' | 'timeout' | 'limite' | 'sobrecarga' | 'auth' | 'error'; status?: number; ms: number };

export async function callClaude(system: string[], messages: ChatTurn[], maxTokens = env.anthropicMaxTokens): Promise<ClaudeResult> {
  const t0 = Date.now();
  const key = env.anthropicKey;
  if (!key) return { ok: false, reason: 'sin_clave', ms: 0 };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), env.anthropicTimeoutMs);
  try {
    const res = await fetch(`${env.anthropicBaseUrl}/v1/messages`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: env.anthropicModel,
        max_tokens: maxTokens,
        system: system.map((text) => ({ type: 'text', text })),
        messages,
      }),
    });
    const ms = Date.now() - t0;
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[claude] HTTP ${res.status}: ${body.slice(0, 300)}`);
      const reason = res.status === 429 ? 'limite' : res.status === 529 || res.status >= 500 ? 'sobrecarga'
        : res.status === 401 || res.status === 403 ? 'auth' : 'error';
      return { ok: false, reason, status: res.status, ms };
    }
    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>; model?: string;
      usage?: { input_tokens: number; output_tokens: number };
    };
    const text = (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('').trim();
    if (!text) return { ok: false, reason: 'error', ms };
    return { ok: true, text, model: data.model ?? env.anthropicModel, usage: data.usage, ms };
  } catch (e) {
    const ms = Date.now() - t0;
    const aborted = (e as Error).name === 'AbortError';
    console.error('[claude] fallo de red:', (e as Error).message);
    return { ok: false, reason: aborted ? 'timeout' : 'error', ms };
  } finally {
    clearTimeout(timer);
  }
}
