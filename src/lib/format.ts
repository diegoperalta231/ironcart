const usd = new Intl.NumberFormat('es-NI', { style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol', minimumFractionDigits: 2 });
export const dinero = (n: number | string) => usd.format(Number(n));

export const fecha = (iso: string) =>
  new Date(iso).toLocaleDateString('es-NI', { day: 'numeric', month: 'long', year: 'numeric' });

export const ESTADOS_PEDIDO: Record<string, string> = {
  confirmado: 'Confirmado', preparando: 'Preparando', enviado: 'Enviado', entregado: 'Entregado', cancelado: 'Cancelado',
};

export const METODOS_PAGO: Record<string, string> = {
  tarjeta_demo: 'Tarjeta (demostración)',
  transferencia_demo: 'Transferencia bancaria (demostración)',
  contra_entrega_demo: 'Pago contra entrega (demostración)',
};

export function disponibilidad(stock: number): { texto: string; tono: 'ok' | 'pocas' | 'agotado' } {
  if (stock <= 0) return { texto: 'Agotado', tono: 'agotado' };
  if (stock <= 5) return { texto: `Quedan ${stock}`, tono: 'pocas' };
  return { texto: 'Disponible', tono: 'ok' };
}

/** Almacenamiento local tolerante a fallos (modo privado, iframes, etc.). */
export const local = {
  get(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } },
  del(k: string) { try { localStorage.removeItem(k); } catch { /* sin almacenamiento */ } },
};
