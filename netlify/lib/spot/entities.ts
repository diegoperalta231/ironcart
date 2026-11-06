/**
 * Extracción de entidades (sección 9.3): numero_pedido, marca, categoría,
 * tamaño/presentación, referencias anafóricas ("ese", "el mismo") y la
 * consulta de búsqueda de producto que se enviará a la base de datos.
 */
import { normalizeForNlu, tokenize } from './normalize';

export interface Entities {
  numeroPedido: number | null;
  marca: string | null;      // slug
  categoria: string | null;  // slug
  tamano: { valor: number; unidad: 'lb' | 'kg' | 'g' | 'oz' | 'porciones' } | null;
  referenciaAnterior: boolean;
  consultaProducto: string;  // texto limpio para buscar en el catálogo
}

const BRANDS: Array<[string, RegExp]> = [
  ['optimum-nutrition', /\b(optimum( nutrition)?|\bon\b(?= (gold|creatina|whey))|gold standard|opti ?men|opti ?women|serious mass|amino energy)\b/],
  ['rule-1', /\b(rule ?1|rule one|r1)\b/],
  ['muscletech', /\b(muscle ?tech|nitro ?tech|vapor ?x5|platinum)\b/],
  ['dymatize', /\b(dymatize|dimatize|iso ?100|elite whey)\b/],
  ['bsn', /\b(bsn|syntha ?6)\b/],
  ['cellucor', /\b(cellucor|c4)\b/],
  ['myprotein', /\b(my ?protein|impact whey)\b/],
  ['ghost', /\b(ghost|legend)\b/],
  ['nutrex', /\b(nutrex|outlift)\b/],
  ['now-foods', /\b(now foods|now)\b(?= (foods|vitamina|omega|magnesio|beta))/],
  ['scivation', /\b(scivation|xtend)\b/],
  ['universal-nutrition', /\b(universal|animal pak)\b/],
  ['blenderbottle', /\b(blender ?bottle)\b/],
  ['harbinger', /\b(harbinger)\b/],
];

const CATEGORIES: Array<[string, RegExp]> = [
  ['proteinas', /\b(proteina|whey|caseina|aislado|isolate|ganador|gainer)(s|es)?\b/],
  ['creatinas', /\b(creatina|monohidrato)s?\b/],
  ['pre-entrenos', /\b(preentreno)s?\b/],
  ['vitaminas', /\b(vitamina|multivitaminico|omega ?3?|magnesio|d3)s?\b/],
  ['aminoacidos', /\b(bcaa|eaa|aminoacido|glutamina|beta ?alanina)s?\b/],
  ['accesorios', /\b(shaker|cinturon|strap|guante|accesorio|botella|mezclador)(s|es)?\b/],
];

// Palabras de intención que no ayudan a encontrar el producto en el catálogo.
const QUERY_STOP = new Set(
  ('que cual cuales cuanto cuanta cuantos cuantas como donde cuando tienen tiene hay venden vende disponible disponibles ' +
    'precio precios cuesta cuestan vale valen sale salen stock existencia existencias inventario unidades quedan queda ' +
    'esta estan todavia aun busco buscar quiero quisiera necesito comprar muestrame mostrar ver ensename dame el la los las ' +
    'un una unos unas de del al a en y o para por con sin mi me tu su es son se lo le les favor hola spot ' +
    'diferencia entre mejor compara comparar comparame vs versus recomiendas recomienda recomiendame conviene ' +
    'info informacion detalles detalle sobre acerca trae contiene ingredientes porcion porciones algo alguna alguno ' +
    'ese esa eso este esta mismo misma ademas tambien otra otro y bueno buena sabes puedes podrias').split(' '),
);

const ANAPHORA = /\b(ese|esa|eso|este|esta|esos|esas|el mismo|la misma|ese producto|esa proteina|lo|la anterior|el anterior|el primero|el segundo|la primera|la segunda)\b/;

export function extractEntities(raw: string): Entities {
  const n = normalizeForNlu(raw);

  let numeroPedido: number | null = null;
  const ped = n.match(/\b(?:pedido|orden|compra|order|numero|n|no|nro)\s*(?:numero|no|n|nro)?\s*(\d{4,8})\b/) ?? n.match(/\b(\d{5,8})\b/);
  if (ped) numeroPedido = Number(ped[1]);

  let tamano: Entities['tamano'] = null;
  const t = n.match(/\b(\d+(?:[.,]\d+)?)\s?(lb|kg|g|oz|porciones|servicios|servings)\b/);
  if (t) {
    const unidad = (['porciones', 'servicios', 'servings'].includes(t[2]) ? 'porciones' : t[2]) as NonNullable<Entities['tamano']>['unidad'];
    tamano = { valor: Number(t[1].replace(',', '.')), unidad };
  }

  const marca = BRANDS.find(([, re]) => re.test(n))?.[0] ?? null;
  const categoria = CATEGORIES.find(([, re]) => re.test(n))?.[0] ?? null;

  const consultaProducto = tokenize(n)
    .filter((w) => !QUERY_STOP.has(w))
    .filter((w) => !(numeroPedido && w === String(numeroPedido)))
    .join(' ')
    .trim();

  return { numeroPedido, marca, categoria, tamano, referenciaAnterior: ANAPHORA.test(n), consultaProducto };
}

/** ¿La presentación del producto coincide con el tamaño pedido? (5 lb ≈ 2.27 kg, etc.) */
export function matchesSize(presentacion: string, tamano: Entities['tamano']): boolean {
  if (!tamano) return true;
  const p = normalizeForNlu(presentacion);
  const re = new RegExp(`\\b${String(tamano.valor).replace('.', '[.,]')}\\s?${tamano.unidad === 'porciones' ? '(porciones|servicios)' : tamano.unidad}\\b`);
  if (re.test(p)) return true;
  // Equivalencias aproximadas lb <-> kg
  const toKg = (v: number, u: string) => (u === 'lb' ? v * 0.4536 : u === 'kg' ? v : u === 'g' ? v / 1000 : NaN);
  const want = toKg(tamano.valor, tamano.unidad);
  if (Number.isNaN(want)) return false;
  for (const m of p.matchAll(/(\d+(?:[.,]\d+)?)\s?(lb|kg|g)\b/g)) {
    const have = toKg(Number(m[1].replace(',', '.')), m[2]);
    if (Math.abs(have - want) / want < 0.06) return true;
  }
  return false;
}
