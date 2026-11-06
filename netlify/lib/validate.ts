import { HttpError } from './http';

const CONTROL = /[\u0000-\u001F\u007F]/g;

export function str(v: unknown, field: string, { min = 1, max = 200, optional = false } = {}): string {
  if (v === undefined || v === null || v === '') {
    if (optional) return '';
    throw new HttpError(400, 'dato_invalido', `El campo "${field}" es obligatorio.`, { campo: field });
  }
  if (typeof v !== 'string') throw new HttpError(400, 'dato_invalido', `El campo "${field}" debe ser texto.`, { campo: field });
  const s = v.normalize('NFC').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
  if (s.length < min || s.length > max) {
    throw new HttpError(400, 'dato_invalido', `El campo "${field}" debe tener entre ${min} y ${max} caracteres.`, { campo: field });
  }
  return s;
}

export function int(v: unknown, field: string, { min = 0, max = 1_000_000 } = {}): number {
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) {
    throw new HttpError(400, 'dato_invalido', `El campo "${field}" debe ser un entero entre ${min} y ${max}.`, { campo: field });
  }
  return n;
}

export function email(v: unknown): string {
  const s = str(v, 'email', { min: 5, max: 120 }).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(s)) throw new HttpError(400, 'dato_invalido', 'El correo no es válido.', { campo: 'email' });
  return s;
}

export function password(v: unknown): string {
  if (typeof v !== 'string' || v.length < 8 || v.length > 72) {
    throw new HttpError(400, 'dato_invalido', 'La contraseña debe tener entre 8 y 72 caracteres.', { campo: 'password' });
  }
  return v;
}

export function oneOf<T extends string>(v: unknown, field: string, allowed: readonly T[]): T {
  if (typeof v !== 'string' || !allowed.includes(v as T)) {
    throw new HttpError(400, 'dato_invalido', `Valor no permitido para "${field}".`, { campo: field });
  }
  return v as T;
}

export const slug = (v: unknown, field = 'slug') => {
  const s = str(v, field, { max: 80 });
  if (!/^[a-z0-9-]+$/.test(s)) throw new HttpError(400, 'dato_invalido', `"${field}" no es válido.`);
  return s;
};
