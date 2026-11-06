/**
 * Ruta 3 — Seguridad (prioritaria). Reglas deterministas en el backend que se
 * aplican ANTES de consultar datos o llamar a Claude, y un filtro de salida
 * que se aplica DESPUÉS. Complementan (no sustituyen) las reglas del prompt.
 */
import { normalizeForNlu } from './normalize';

export interface SafetyResult {
  medical: boolean;
  medicalReasons: string[];
  injection: boolean;
  injectionReasons: string[];
  emergency: boolean;
}

// Condiciones de salud, medicamentos, poblaciones sensibles (texto normalizado, sin tildes).
const MEDICAL_PATTERNS: Array<[string, RegExp]> = [
  ['condicion_renal', /\b(rinon|renal|nefr\w*|dialisis|insuficiencia renal|calculos? renal\w*|creatinina alta)\b/],
  ['condicion_hepatica', /\b(higado|hepat\w*|cirrosis)\b/],
  ['diabetes', /\b(diabet\w*|insulina|glucosa alta|azucar alta)\b/],
  ['cardiovascular', /\b(corazon|cardiac\w*|cardiopat\w*|cardiovascular\w*|arritmia|taquicardia|infarto|hipertens\w*|presion (alta|arterial)|marcapasos)\b/],
  ['embarazo_lactancia', /\b(embarazad\w*|embarazo|lactan\w*|amamant\w*)\b/],
  ['medicamentos', /\b(medicament\w*|medicina|pastillas?|farmaco\w*|antidepresiv\w*|anticoagulant\w*|warfarina|tratamiento medico|me receto|recetad\w*)\b/],
  ['enfermedad', /\b(enfermedad\w*|enferm[oa]|cancer|tumor|tiroides|hipotiroid\w*|hipertiroid\w*|anemia|gastritis|ulcera|colesterol|epilepsia|asma|alergi\w*|celiac\w*|lupus|artritis|gota|vih|covid)\b/],
  ['salud_mental', /\b(ansiedad|depresion|bipolar|trastorno|anorexia|bulimia|atracon\w*)\b/],
  ['sintomas', /\b(me duele|dolor (de|en) (pecho|rinon|cabeza)|sintoma\w*|mareo\w*|desmay\w*|palpitaciones|orina con sangre|lesion\w*|lesione)\b/],
  ['menor_de_edad', /\b(tengo (1[0-7]|[5-9]) anos|soy menor|mi hij[oa] de (1[0-7]|[1-9]) anos|adolescente)\b/],
  ['cirugia', /\b(cirugia|operaron|operacion reciente|postoperatori\w*)\b/],
  ['curar', /\b(cura|curar|curan|trata[rn]?|sana[rn]?|previene[n]?) (la|el|mi|las|los)? ?(enfermedad|anemia|diabetes|cancer|ansiedad|depresion|presion|colesterol|lesion|dolor)\b/],
  ['dosis_personalizada', /\b(dosis|cuant[oa]s? (gramos|mg|miligramos|g|cucharadas|scoops?|medidas|tomas)\b.*\b(debo|deberia|tengo que|me tomo|tomo yo|tomar yo|necesito yo|para mi)|cuant[oa] (creatina|proteina|cafeina|preentreno)\b.*\b(debo|deberia|me tomo|tomo yo|para mi|si peso)|si peso \d+\s?(kg|lb)?.*\b(cuant|dosis|tomar|tomo))/],
];

const INJECTION_PATTERNS: Array<[string, RegExp]> = [
  ['ignorar_reglas', /\b(ignora|ignorar|olvida|olvidate|omite|salta(te)?|desactiva|anula|rompe)\b.{0,40}\b(regla|reglas|instruccion\w*|restriccion\w*|limite\w*|politica\w*|filtro\w*|prompt)\b/],
  ['revelar_prompt', /\b(revela|muestra|muestrame|dime|ensena|repite|imprime|copia|cual es)\b.{0,40}\b(prompt|instrucciones (internas|del sistema|ocultas|iniciales)|mensaje (del|de) sistema|system prompt|tus reglas|tu configuracion)\b/],
  ['cambio_rol', /\b(ahora eres|a partir de ahora (eres|seras|actua\w*)|actua como|finge (ser|que)|haz de cuenta|modo (desarrollador|developer|dios|sin restricciones|dan)|jailbreak|\bdan\b|sin (filtros|restricciones|limites))\b/],
  ['marcado_sistema', /(\bsystem\s*:|\[\s*system\s*\]|\bassistant\s*:|<\s*\/?\s*(system|instrucciones|contexto)\b)/],
  ['en_ingles', /\b(ignore (all|previous|your)|disregard (all|previous|the)|you are now|developer mode|reveal (your|the) (system )?prompt)\b/],
];

const EMERGENCY = /\b(me quiero morir|quiero morir|suicid\w*|hacerme dano|quitarme la vida|sobredosis|no puedo respirar|dolor (fuerte )?en el pecho|me estoy desmayando|convulsion\w*)\b/;

export function detectSafety(raw: string): SafetyResult {
  const n = normalizeForNlu(raw);
  // Para inyección se evalúa también el texto crudo en minúsculas (marcado tipo <system>).
  const lowerRaw = raw.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const medicalReasons = MEDICAL_PATTERNS.filter(([, re]) => re.test(n)).map(([k]) => k);
  const injectionReasons = INJECTION_PATTERNS.filter(([, re]) => re.test(n) || re.test(lowerRaw)).map(([k]) => k);
  return {
    medical: medicalReasons.length > 0,
    medicalReasons,
    injection: injectionReasons.length > 0,
    injectionReasons,
    emergency: EMERGENCY.test(n),
  };
}

// ---------------------------------------------------------------------------
// Mensajes de seguridad fijos (no dependen del LLM)
// ---------------------------------------------------------------------------
export const MEDICAL_DISCLAIMER =
  'No puedo darte una recomendación médica personalizada, y menos si hay una condición de salud, medicamentos o una dosis de por medio. Te recomiendo consultarlo con tu médico o nutricionista.';

export const EMERGENCY_MESSAGE =
  'Lo que describes puede ser una emergencia. Por favor busca ayuda de inmediato: llama a los servicios de emergencia de tu país (en Nicaragua, 128 Cruz Roja o 118 Policía) o acude al centro de salud más cercano. Si estás pensando en hacerte daño, habla ahora con alguien de confianza o con un servicio de ayuda en crisis. Spot es un asistente de tienda y no puede atender emergencias.';

// Patrones de dosis/posología que nunca deben salir en una respuesta de la ruta médica.
const DOSE_OUTPUT = /(\d+(?:[.,]\d+)?\s?(?:g|gr|gramos|mg|miligramos|ml|ui|cucharadas?|scoops?|c[aá]psulas?|tabletas?)\b[^.\n]{0,40}\b(al d[ií]a|diari[oa]s?|por d[ií]a|por kilo|por kg|\/kg|cada \d+ horas))|(\d+(?:[.,]\d+)?\s?(?:g|mg)\s?\/\s?kg)/i;
const CURE_CLAIM = /\b(cura|curar[aá]?|trata|previene|elimina)\s+(la|el|tu|las|los)?\s?(enfermedad|anemia|diabetes|c[aá]ncer|insuficiencia|ansiedad|depresi[oó]n)/i;
const PRO_REFERRAL = /(m[eé]dic|nutricionista|profesional de (la )?salud|profesional)/i;

/**
 * Filtro de salida. En rutas de seguridad garantiza que haya derivación a un
 * profesional y bloquea cualquier posología. En todas las rutas bloquea
 * afirmaciones de curación.
 */
export function guardOutput(text: string, route: string): { text: string; blocked: string[] } {
  const blocked: string[] = [];
  let out = text;
  if (CURE_CLAIM.test(out)) blocked.push('afirmacion_curativa');
  if ((route === 'seguridad_medica' || route === 'seguridad_inyeccion') && DOSE_OUTPUT.test(out)) blocked.push('posologia');
  if (blocked.length) {
    out = `${MEDICAL_DISCLAIMER} Sí puedo darte información general sobre los suplementos o ayudarte con algo de la tienda.`;
  } else if (route === 'seguridad_medica' && !PRO_REFERRAL.test(out)) {
    out = `${MEDICAL_DISCLAIMER}\n\n${out}`;
    blocked.push('derivacion_agregada');
  }
  return { text: out, blocked };
}
