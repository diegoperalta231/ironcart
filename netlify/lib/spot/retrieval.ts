/**
 * Ruta 2 — Recuperación documental (RAG).
 *  - Si hay VOYAGE_API_KEY y pgvector está aplicado: búsqueda vectorial
 *    (embeddings de Voyage AI) combinada con la textual mediante Reciprocal
 *    Rank Fusion → modo "hibrido".
 *  - Si no: búsqueda de texto completo de PostgreSQL en español (FTS) → modo "texto".
 * Nunca se simula una búsqueda vectorial: el modo usado se informa en la respuesta.
 */
import { rpc } from '../db';
import { env } from '../env';

export interface Doc {
  id: number; slug: string; titulo: string; categoria: string; contenido: string;
  fuente: string; actualizado: string; score: number; cobertura?: number;
}
export type RagMode = 'hibrido' | 'texto' | 'vectorial';

export async function embed(texts: string[], inputType: 'query' | 'document'): Promise<number[][]> {
  const key = env.voyageKey;
  if (!key) throw new Error('VOYAGE_API_KEY no configurada');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ input: texts, model: env.voyageModel, input_type: inputType }),
    });
    if (!res.ok) throw new Error(`Voyage HTTP ${res.status}`);
    const data = (await res.json()) as { data: Array<{ embedding: number[]; index: number }> };
    return data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  } finally {
    clearTimeout(timer);
  }
}

// Calibrado con consultas de prueba relevantes / no relevantes (ver README › Pruebas › RAG).
const TEXT_MIN_SCORE = 0.12;
const TEXT_MIN_COVERAGE = 0.3;   // fracción mínima de términos de la consulta presentes en el documento
const TEXT_SUFFICIENT_SCORE = 0.2;
const VECTOR_MIN_SCORE = 0.45;

const textOk = (d: Doc) => d.score >= TEXT_MIN_SCORE && (d.cobertura ?? 1) >= TEXT_MIN_COVERAGE;

export async function retrieve(query: string, k = 4): Promise<{ docs: Doc[]; mode: RagMode; suficiente: boolean }> {
  const textP = rpc<Doc[]>('api_conocimiento_buscar_texto', { q: query, limite: k + 2 });

  let vector: Doc[] | null = null;
  if (env.voyageKey) {
    try {
      const [e] = await embed([query], 'query');
      vector = await rpc<Doc[]>('api_conocimiento_buscar_vector', { embedding: JSON.stringify(e), limite: k + 2 });
    } catch (err) {
      console.warn('[rag] búsqueda vectorial no disponible, se usa FTS:', (err as Error).message);
    }
  }
  const text = await textP;

  if (!vector || vector.length === 0) {
    const docs = text.filter(textOk).slice(0, k);
    return { docs, mode: 'texto', suficiente: docs.some((d) => d.score >= TEXT_SUFFICIENT_SCORE) };
  }

  // Reciprocal Rank Fusion (k=60) entre resultados vectoriales y textuales.
  const fused = new Map<number, { doc: Doc; rrf: number }>();
  const add = (list: Doc[], valid: (d: Doc) => boolean) =>
    list.forEach((d, i) => {
      if (!valid(d)) return;
      const cur = fused.get(d.id) ?? { doc: d, rrf: 0 };
      cur.rrf += 1 / (60 + i + 1);
      fused.set(d.id, cur);
    });
  add(vector, (d) => d.score >= VECTOR_MIN_SCORE);
  add(text, textOk);
  const docs = [...fused.values()].sort((a, b) => b.rrf - a.rrf).slice(0, k).map((x) => x.doc);
  return { docs, mode: 'hibrido', suficiente: docs.length > 0 };
}
