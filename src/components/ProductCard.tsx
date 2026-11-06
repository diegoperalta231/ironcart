import { useState } from 'react';
import { useStore } from '../context/Store';
import { dinero, disponibilidad } from '../lib/format';
import { Link } from '../lib/router';
import type { Producto } from '../lib/types';
import { IconCarrito } from './Icons';
import ProductArt from './ProductArt';

export function Disponibilidad({ stock, className = '' }: { stock: number; className?: string }) {
  const d = disponibilidad(stock);
  const color = d.tono === 'ok' ? 'bg-lima' : d.tono === 'pocas' ? 'bg-alerta' : 'bg-acero';
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm ${d.tono === 'agotado' ? 'text-niebla' : 'text-hueso'} ${className}`}>
      <span className={`h-2 w-2 rounded-full ${color}`} aria-hidden="true" />
      {d.texto}
    </span>
  );
}

export default function ProductCard({ p }: { p: Producto }) {
  const { agregar } = useStore();
  const [enviando, setEnviando] = useState(false);
  const agotado = p.stock <= 0;
  return (
    <article className="group relative flex flex-col border-t-2 border-grafito pt-4 transition-colors hover:border-naranja">
      <Link to={`/producto/${p.slug}`} className="relative block aspect-square overflow-hidden rounded-md bg-carbon" aria-label={`Ver ${p.nombre} ${p.presentacion}`}>
        <ProductArt imagen={p.imagen} color={p.color} nombre={p.nombre} marca={p.marca} className="p-3 transition-transform duration-300 group-hover:scale-[1.04]" />
        {p.precio_anterior && !agotado && (
          <span className="absolute left-3 top-3 rounded-sm bg-naranja px-2 py-0.5 font-display text-sm font-bold text-black">
            −{Math.round((1 - p.precio / p.precio_anterior) * 100)} %
          </span>
        )}
      </Link>
      <div className="mt-3 flex flex-1 flex-col">
        <p className="text-sm text-niebla">{p.marca}</p>
        <h3 className="mt-0.5 font-display text-2xl font-bold leading-tight">
          <Link to={`/producto/${p.slug}`} className="hover:text-naranja">{p.nombre}</Link>
        </h3>
        <p className="text-sm text-niebla">{p.presentacion}{p.sabor ? `, ${p.sabor.toLowerCase()}` : ''}</p>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-x-2 gap-y-1">
          <div>
            <p className="font-display text-[1.7rem] font-extrabold leading-none sm:text-3xl">{dinero(p.precio)}</p>
            {p.precio_anterior && <p className="text-sm text-niebla line-through">{dinero(p.precio_anterior)}</p>}
          </div>
          <Disponibilidad stock={p.stock} />
        </div>
        <div className="mt-4 grid grid-cols-[1fr_auto] gap-2">
          <Link to={`/producto/${p.slug}`} className="btn-secundario px-2 py-2 text-base">Ver detalles</Link>
          <button
            type="button"
            className="btn-primario px-3.5 py-2"
            disabled={agotado || enviando}
            onClick={async () => { setEnviando(true); await agregar(p.id, 1, p.nombre); setEnviando(false); }}
            aria-label={agotado ? `${p.nombre} agotado` : `Agregar ${p.nombre} al carrito`}
            title={agotado ? 'Agotado' : 'Agregar al carrito'}
          >
            <IconCarrito size={20} />
          </button>
        </div>
      </div>
    </article>
  );
}

export function ProductGridSkeleton({ n = 8 }: { n?: number }) {
  return (
    <div className="grid grid-cols-2 gap-x-5 gap-y-10 md:grid-cols-3 lg:grid-cols-4" aria-busy="true" aria-label="Cargando productos">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="border-t-2 border-grafito pt-4">
          <div className="aspect-square animate-pulse rounded-md bg-carbon" />
          <div className="mt-3 h-4 w-1/3 animate-pulse rounded bg-carbon" />
          <div className="mt-2 h-6 w-3/4 animate-pulse rounded bg-carbon" />
        </div>
      ))}
    </div>
  );
}
