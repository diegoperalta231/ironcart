/**
 * Evaluación del clasificador de intención sobre el conjunto de VALIDACIÓN
 * (separado del de entrenamiento). Reporta exactitud, F1 por intención, F1 macro,
 * y la exactitud de enrutamiento de seguridad (reglas + NLU).
 * Uso: npx tsx scripts/eval-nlu.ts   (escribe docs/metricas-nlu.json)
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { classify, CONFIDENCE_THRESHOLD } from '../netlify/lib/spot/nlu';
import { VALIDATION as VAL, TEST, TRAIN, type Intent } from '../netlify/lib/spot/intents-data';
import { detectSafety } from '../netlify/lib/spot/safety';
import { decideRoute, MEDICAL_NLU_THRESHOLD } from '../netlify/lib/spot/spot';
import { extractEntities } from '../netlify/lib/spot/entities';

const SET = process.argv.includes('--test') ? 'test' : 'validacion';
const VALIDATION = SET === 'test' ? TEST : VAL;
const intents = Object.keys(TRAIN) as Intent[];
const conf: Record<string, Record<string, number>> = {};
for (const a of intents) { conf[a] = {}; for (const b of intents) conf[a][b] = 0; }

let ok = 0;
const errores: Array<{ texto: string; esperado: string; obtenido: string; confianza: number }> = [];
const t0 = performance.now();
for (const [text, gold] of VALIDATION) {
  const p = classify(text);
  conf[gold][p.intent]++;
  if (p.intent === gold) ok++; else errores.push({ texto: text, esperado: gold, obtenido: p.intent, confianza: p.confidence });
}
const msPorConsulta = (performance.now() - t0) / VALIDATION.length;

const perIntent = intents.map((i) => {
  const tp = conf[i][i];
  const fp = intents.reduce((s, g) => s + (g !== i ? conf[g][i] : 0), 0);
  const fn = intents.reduce((s, o) => s + (o !== i ? conf[i][o] : 0), 0);
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { intent: i, soporte: tp + fn, precision: +precision.toFixed(3), recall: +recall.toFixed(3), f1: +f1.toFixed(3) };
});
const macroF1 = perIntent.reduce((s, x) => s + x.f1, 0) / perIntent.length;

// Seguridad: ¿se intercepta la consulta médica (reglas o NLU)?
const sensibles = VALIDATION.filter(([, g]) => g === 'consulta_medica_sensible').map(([t]) => t);
const noSensibles = VALIDATION.filter(([, g]) => g !== 'consulta_medica_sensible').map(([t]) => t);
const intercepta = (t: string) => detectSafety(t).medical || (classify(t).intent === 'consulta_medica_sensible' && classify(t).confidence >= MEDICAL_NLU_THRESHOLD);
const tpSeg = sensibles.filter(intercepta).length;
const fpSeg = noSensibles.filter(intercepta);

// Exactitud de ENRUTAMIENTO (lo que realmente determina la respuesta): reglas + NLU + entidades.
const ROUTE_OF: Record<Intent, string> = {
  saludo: 'conversacion', despedida: 'conversacion', ayuda: 'conocimiento',
  info_producto: 'transaccional', buscar_producto: 'transaccional', precio_disponibilidad: 'transaccional',
  comparar_productos: 'transaccional', recomendacion_general: 'transaccional',
  info_categoria_suplemento: 'conocimiento', metodos_pago: 'conocimiento', envios: 'conocimiento', horarios: 'conocimiento',
  politicas: 'conocimiento', contacto: 'conocimiento', proceso_compra: 'conocimiento', info_entrenamiento: 'conocimiento',
  info_nutricion_deportiva: 'conocimiento', estado_pedido: 'pedido', consulta_medica_sensible: 'seguridad_medica',
  fuera_de_dominio: 'fuera_de_dominio',
};
const rutaErr: Array<{ texto: string; esperada: string; obtenida: string }> = [];
let rutaOk = 0;
for (const [text, gold] of VALIDATION) {
  const r = decideRoute(text, detectSafety(text), classify(text), extractEntities(text), false);
  const okr = r === ROUTE_OF[gold] || (gold === 'consulta_medica_sensible' && r.startsWith('seguridad'));
  if (okr) rutaOk++; else rutaErr.push({ texto: text, esperada: ROUTE_OF[gold], obtenida: r });
}

const result = {
  conjunto: SET,
  fecha: new Date().toISOString(),
  ejemplos_entrenamiento: Object.values(TRAIN).reduce((s, x) => s + x.length, 0),
  ejemplos_validacion: VALIDATION.length,
  intenciones: intents.length,
  exactitud: +(ok / VALIDATION.length).toFixed(4),
  f1_macro: +macroF1.toFixed(4),
  umbral_confianza: CONFIDENCE_THRESHOLD,
  latencia_media_ms: +msPorConsulta.toFixed(3),
  exactitud_enrutamiento: +(rutaOk / VALIDATION.length).toFixed(4),
  errores_enrutamiento: rutaErr,
  seguridad_medica: { interceptadas: tpSeg, total: sensibles.length, falsos_positivos: fpSeg },
  por_intencion: perIntent,
  errores,
};
mkdirSync('docs', { recursive: true });
writeFileSync(`docs/metricas-nlu-${SET}.json`, JSON.stringify(result, null, 2));
console.log(`Conjunto: ${SET}`);
console.log(`Exactitud: ${(result.exactitud * 100).toFixed(1)} %  (${ok}/${VALIDATION.length})`);
console.log(`F1 macro:  ${result.f1_macro}`);
console.log(`Seguridad médica: ${tpSeg}/${sensibles.length} interceptadas; falsos positivos: ${fpSeg.length}`, fpSeg);
console.log(`Enrutamiento correcto: ${(100 * rutaOk / VALIDATION.length).toFixed(1)} %`, rutaErr);
console.log('Errores:'); for (const e of errores) console.log(`  "${e.texto}"  esperado=${e.esperado}  obtenido=${e.obtenido} (${e.confianza})`);
