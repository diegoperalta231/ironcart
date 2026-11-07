/**
 * Cliente mínimo de la API Messages de Anthropic (https://docs.claude.com).
 * Se usa fetch directamente (sin SDK) para mantener las funciones ligeras.
 * La API key solo existe en el servidor (process.env.ANTHROPIC_API_KEY).
 * Soporta uso de herramientas (tool use) para el agente de carrito y de administración.
 */
import { env } from '../env';

export interface ChatTurn { role: 'user' | 'assistant'; content: string }

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

export interface AgentMessage { role: 'user' | 'assistant'; content: string | ContentBlock[] }

export interface ToolDef { name: string; description: string; input_schema: Record<string, unknown> }

type Fail = { ok: false; reason: 'sin_clave' | 'timeout' | 'limite' | 'sobrecarga' | 'auth' | 'error'; status?: number; ms: number };

export type ClaudeResult =
  | { ok: true; text: string; model: string; usage?: { input_tokens: number; output_tokens: number }; ms: number }
  | Fail;

export type ClaudeRawResult =
  | { ok: true; content: ContentBlock[]; stopReason: string; model: string; ms: number }
  | Fail;

export async function callClaudeRaw(args: {
  system: string[]; messages: AgentMessage[]; tools?: ToolDef[]; maxTokens?: number;
}): Promise<ClaudeRawResult> {
  const t0 = Date.now();
  const key = env.anthropicKey;
  if (!key) return { ok: false, reason: 'sin_clave', ms: 0 };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), env.anthropicTimeoutMs);
  try {
    const res = await fetch(`${env.anthropicBaseUrl}/v1/messages`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: env.anthropicModel,
        max_tokens: args.maxTokens ?? env.anthropicMaxTokens,
        system: args.system.map((text) => ({ type: 'text', text })),
        messages: args.messages,
        ...(args.tools?.length ? { tools: args.tools } : {}),
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
    const data = (await res.json()) as { content?: ContentBlock[]; stop_reason?: string; model?: string };
    return { ok: true, content: data.content ?? [], stopReason: data.stop_reason ?? 'end_turn', model: data.model ?? env.anthropicModel, ms };
  } catch (e) {
    const ms = Date.now() - t0;
    console.error('[claude] fallo de red:', (e as Error).message);
    return { ok: false, reason: (e as Error).name === 'AbortError' ? 'timeout' : 'error', ms };
  } finally {
    clearTimeout(timer);
  }
}

export const textOf = (blocks: ContentBlock[]) =>
  blocks.filter((b): b is { type: 'text'; text: string } => b.type === 'text').map((b) => b.text).join('').trim();

export async function callClaude(system: string[], messages: ChatTurn[], maxTokens = env.anthropicMaxTokens): Promise<ClaudeResult> {
  const r = await callClaudeRaw({ system, messages, maxTokens });
  if (!r.ok) return r;
  const text = textOf(r.content);
  if (!text) return { ok: false, reason: 'error', ms: r.ms };
  return { ok: true, text, model: r.model, ms: r.ms };
}
