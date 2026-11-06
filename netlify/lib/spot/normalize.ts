/**
 * Preprocesamiento de texto (sección 12 del informe).
 * - minúsculas, limpieza de espacios y caracteres de control
 * - para MATCHING se eliminan tildes (proteína -> proteina) porque los usuarios
 *   escriben con y sin ellas; el texto original se conserva para Claude.
 * - corrección de errores ortográficos frecuentes y unificación de unidades.
 */

const TYPO_MAP: Record<string, string> = {
  q: 'que', k: 'que', ke: 'que', xq: 'porque', pq: 'porque', porq: 'porque', xk: 'porque',
  tb: 'tambien', tmb: 'tambien', xfa: 'por favor', porfa: 'por favor', pls: 'por favor',
  d: 'de', x: 'por', grax: 'gracias', grs: 'gracias', thx: 'gracias',
  protein: 'proteina', proteinas: 'proteina', protenia: 'proteina', porteina: 'proteina',
  proteyna: 'proteina', protena: 'proteina', proteinna: 'proteina',
  creatin: 'creatina', creatine: 'creatina', creatna: 'creatina', cretina: 'creatina', creattina: 'creatina',
  creatinas: 'creatina', kreatina: 'creatina',
  wey: 'whey', guey: 'whey', huey: 'whey', whei: 'whey',
  cacseina: 'caseina', caceina: 'caseina', casseina: 'caseina',
  preworkout: 'preentreno', preentrenos: 'preentreno', prentreno: 'preentreno', preentreno: 'preentreno',
  rinones: 'rinon', rinion: 'rinon', rinyon: 'rinon', rinon: 'rinon', renales: 'renal',
  libras: 'lb', libra: 'lb', lbs: 'lb', kilos: 'kg', kilo: 'kg', kgs: 'kg', gramos: 'g', gr: 'g', grs_: 'g',
  vitaminas: 'vitamina', aminoacidos: 'aminoacido', suplementos: 'suplemento',
  tenes: 'tienen', tenés: 'tienen', tienes: 'tienen', hay: 'hay', vale: 'vale',
  envios: 'envio', enviosgratis: 'envio gratis',
};

/** Quita tildes/diacríticos (incluye ñ -> n) solo para comparar texto. */
export function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Limpieza segura del mensaje del usuario (se guarda y se envía a Claude). */
export function sanitizeUserText(input: string, maxLen = 800): string {
  return input
    .normalize('NFC')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maxLen);
}

/** Normalización para NLU / reglas: minúsculas, sin tildes, typos corregidos. */
export function normalizeForNlu(input: string): string {
  let s = stripAccents(input.toLowerCase());
  s = s.replace(/pre[\s-]?(entreno|workout|entrenamiento)s?/g, 'preentreno');
  s = s.replace(/(\d)\s*(libras?|lbs?)\b/g, '$1 lb').replace(/(\d)\s*(kilos?|kgs?)\b/g, '$1 kg');
  s = s.replace(/[¿?¡!.,;:()"“”'`´*_#\[\]{}<>|\\/=+~^]/g, ' ');
  s = s.replace(/([a-z])\1{2,}/g, '$1'); // holaaaa -> hola
  const tokens = s.split(/\s+/).filter(Boolean).map((t) => TYPO_MAP[t] ?? t);
  return tokens.join(' ').trim();
}

export function tokenize(normalized: string): string[] {
  return normalized.split(/\s+/).filter(Boolean);
}
