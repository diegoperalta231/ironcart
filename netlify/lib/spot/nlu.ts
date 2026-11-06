/**
 * Clasificador de intención (sustituye al microservicio Python del informe).
 *
 * Modelo: TF-IDF sobre palabras, bigramas y n-gramas de caracteres (3-4) —
 * los n-gramas de caracteres toleran errores ortográficos— y una puntuación
 * híbrida por intención = 0.6·(similitud con el ejemplo más cercano)
 *                       + 0.4·(similitud con el centroide de la intención).
 * Se "entrena" al cargar el módulo (≈300 ejemplos, unos milisegundos) y es
 * evaluable de forma independiente con scripts/eval-nlu.ts.
 */
import { TRAIN, type Intent } from './intents-data';
import { normalizeForNlu, tokenize } from './normalize';

type Vec = Map<string, number>;

const STOP = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'de', 'del', 'y', 'o', 'a', 'en', 'me', 'mi', 'por', 'favor', 'es', 'lo', 'se', 'al']);

function features(text: string): string[] {
  const toks = tokenize(normalizeForNlu(text));
  const feats: string[] = [];
  const content = toks.filter((t) => !STOP.has(t));
  for (const t of content) feats.push('w:' + t);
  for (let i = 0; i < toks.length - 1; i++) feats.push('b:' + toks[i] + '_' + toks[i + 1]);
  for (const t of content) {
    const p = `#${t}#`;
    for (const n of [3, 4]) for (let i = 0; i + n <= p.length; i++) feats.push(`c${n}:` + p.slice(i, i + n));
  }
  return feats;
}

function tf(feats: string[]): Vec {
  const m: Vec = new Map();
  for (const f of feats) m.set(f, (m.get(f) ?? 0) + 1);
  return m;
}

function normalizeVec(v: Vec): Vec {
  let n = 0;
  for (const x of v.values()) n += x * x;
  n = Math.sqrt(n) || 1;
  for (const [k, x] of v) v.set(k, x / n);
  return v;
}

function cosine(a: Vec, b: Vec): number {
  const [s, l] = a.size < b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [k, x] of s) {
    const y = l.get(k);
    if (y) dot += x * y;
  }
  return dot;
}

export interface Model {
  idf: Map<string, number>;
  examples: Array<{ intent: Intent; vec: Vec; text: string }>;
  centroids: Map<Intent, Vec>;
}

export function train(data: Record<Intent, string[]> = TRAIN): Model {
  const docs: Array<{ intent: Intent; feats: string[]; text: string }> = [];
  for (const [intent, examples] of Object.entries(data) as Array<[Intent, string[]]>) {
    for (const text of examples) docs.push({ intent, feats: features(text), text });
  }
  const df = new Map<string, number>();
  for (const d of docs) for (const f of new Set(d.feats)) df.set(f, (df.get(f) ?? 0) + 1);
  const N = docs.length;
  const idf = new Map<string, number>();
  for (const [f, c] of df) idf.set(f, Math.log((N + 1) / (c + 1)) + 1);

  const examples = docs.map((d) => ({ intent: d.intent, text: d.text, vec: weigh(tf(d.feats), idf) }));
  const centroids = new Map<Intent, Vec>();
  for (const ex of examples) {
    const c = centroids.get(ex.intent) ?? new Map<string, number>();
    for (const [k, x] of ex.vec) c.set(k, (c.get(k) ?? 0) + x);
    centroids.set(ex.intent, c);
  }
  for (const c of centroids.values()) normalizeVec(c);
  return { idf, examples, centroids };
}

function weigh(v: Vec, idf: Map<string, number>): Vec {
  const out: Vec = new Map();
  for (const [k, x] of v) {
    const w = idf.get(k);
    if (w) out.set(k, (1 + Math.log(x)) * w); // características desconocidas se ignoran
  }
  return normalizeVec(out);
}

export interface Prediction {
  intent: Intent;
  confidence: number; // 0..1
  margin: number;     // diferencia con la segunda intención
  ranking: Array<{ intent: Intent; score: number }>;
}

let MODEL: Model | null = null;
export function getModel(): Model {
  return (MODEL ??= train());
}

export function classify(text: string, model: Model = getModel()): Prediction {
  const vec = weigh(tf(features(text)), model.idf);
  const best = new Map<Intent, number>();
  for (const ex of model.examples) {
    const s = cosine(vec, ex.vec);
    if (s > (best.get(ex.intent) ?? 0)) best.set(ex.intent, s);
  }
  const ranking: Array<{ intent: Intent; score: number }> = [];
  for (const [intent, c] of model.centroids) {
    ranking.push({ intent, score: 0.6 * (best.get(intent) ?? 0) + 0.4 * cosine(vec, c) });
  }
  ranking.sort((a, b) => b.score - a.score);
  const [first, second] = ranking;
  return {
    intent: first.intent,
    confidence: Number(first.score.toFixed(3)),
    margin: Number((first.score - (second?.score ?? 0)).toFixed(3)),
    ranking: ranking.slice(0, 3).map((r) => ({ intent: r.intent, score: Number(r.score.toFixed(3)) })),
  };
}

/** Umbral de confianza fijado con el conjunto de validación (ver scripts/eval-nlu.ts). */
export const CONFIDENCE_THRESHOLD = 0.3;
