import { useEffect, useState } from 'react';
import { PageHeader } from '../components/Layout';
import ProductArt from '../components/ProductArt';
import ProductCard, { ProductGridSkeleton } from '../components/ProductCard';
import { api } from '../lib/api';
import { Link, useQuery, useRouter } from '../lib/router';
import type { Categoria, Marca, Producto } from '../lib/types';
import { ARTE_CATEGORIA } from './Home';

const ORDENES = [
  { v: 'relevancia', t: 'Relevancia' },
  { v: 'precio_asc', t: 'Precio: menor a mayor' },
  { v: 'precio_desc', t: 'Precio: mayor a menor' },
  { v: 'nombre', t: 'Nombre (A–Z)' },
];

export function Catalog() {
  const q = useQuery();
  const { navigate, loc } = useRouter();
  const [cats, setCats] = useState<Categoria[]>([]);
  const [marcas, setMarcas] = useState<Marca[]>([]);
  const [data, setData] = useState<{ items: Producto[]; total: number; pagina: number; paginas: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filtros = {
    q: q.get('q') ?? '', categoria: q.get('categoria') ?? '', marca: q.get('marca') ?? '',
    orden: q.get('orden') ?? 'relevancia', solo_disponibles: q.get('solo_disponibles') === 'true',
    destacados: q.get('destacados') === 'true', pagina: Number(q.get('pagina') ?? 1),
  };

  const set = (cambios: Partial<Record<string, string | boolean | number>>) => {
    const p = new URLSearchParams(loc.search);
    for (const [k, v] of Object.entries(cambios)) {
      if (v === '' || v === false || v === undefined || (k === 'orden' && v === 'relevancia')) p.delete(k); else p.set(k, String(v));
    }
    if (!('pagina' in cambios)) p.delete('pagina');
    navigate(`/productos${p.toString() ? `?${p}` : ''}`, { replace: true });
  };

  useEffect(() => {
    api<Categoria[]>('/categorias').then(setCats).catch(() => {});
    api<Marca[]>('/marcas').then(setMarcas).catch(() => {});
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    setData(null); setError(null);
    const p = new URLSearchParams(loc.search);
    p.set('por_pagina', '12');
    api<{ items: Producto[]; total: number; pagina: number; paginas: number }>(`/productos?${p}`, { signal: ctrl.signal })
      .then(setData).catch((e) => { if (e.name !== 'AbortError') setError(e.message); });
    return () => ctrl.abort();
  }, [loc.search]);

  const catActual = cats.find((c) => c.slug === filtros.categoria);
  useEffect(() => { document.title = `${catActual?.nombre ?? 'Productos'} · IronCart`; }, [catActual]);

  return (
    <>
      <PageHeader titulo={filtros.q ? `“${filtros.q}”` : catActual?.nombre ?? (filtros.destacados ? 'Destacados' : 'Productos')}>
        {catActual?.descripcion ?? (filtros.q ? 'Resultados de búsqueda en el catálogo.' : 'Todo el catálogo de IronCart, con precio y existencias en tiempo real.')}
      </PageHeader>

      <div className="contenedor">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por categoría">
          <button type="button" className="chip-filtro" aria-pressed={!filtros.categoria} onClick={() => set({ categoria: '' })}>Todas</button>
          {cats.map((c) => (
            <button key={c.slug} type="button" className="chip-filtro" aria-pressed={filtros.categoria === c.slug} onClick={() => set({ categoria: c.slug })}>
              {c.nombre}
            </button>
          ))}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3 border-b border-grafito pb-5">
          <label className="flex items-center gap-2 text-sm text-niebla">
            Marca
            <select value={filtros.marca} onChange={(e) => set({ marca: e.target.value })} className="campo w-auto py-2 text-sm">
              <option value="">Todas</option>
              {marcas.map((m) => <option key={m.slug} value={m.slug}>{m.nombre} ({m.productos})</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-niebla">
            Ordenar
            <select value={filtros.orden} onChange={(e) => set({ orden: e.target.value })} className="campo w-auto py-2 text-sm">
              {ORDENES.map((o) => <option key={o.v} value={o.v}>{o.t}</option>)}
            </select>
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" checked={filtros.solo_disponibles} onChange={(e) => set({ solo_disponibles: e.target.checked })} className="h-4 w-4 accent-[#ff5b14]" />
            Solo disponibles
          </label>
          {(filtros.q || filtros.marca || filtros.destacados || filtros.categoria || filtros.solo_disponibles) && (
            <button type="button" onClick={() => navigate('/productos', { replace: true })} className="text-sm text-niebla underline underline-offset-4 hover:text-hueso">
              Quitar filtros
            </button>
          )}
          <p className="ml-auto text-sm text-niebla" aria-live="polite">{data ? `${data.total} ${data.total === 1 ? 'producto' : 'productos'}` : ''}</p>
        </div>

        <div className="mt-8">
          {error && <p className="rounded-md border border-error/50 bg-[#2a1616] p-4">No pudimos cargar el catálogo: {error}</p>}
          {!data && !error && <ProductGridSkeleton />}
          {data && data.items.length === 0 && (
            <div className="py-16 text-center">
              <p className="font-display text-4xl font-bold">Sin resultados</p>
              <p className="mt-2 text-niebla">Prueba con otra palabra, quita filtros o pregúntale a Spot.</p>
              <button type="button" onClick={() => navigate('/productos')} className="btn-secundario mt-6">Ver todo el catálogo</button>
            </div>
          )}
          {data && data.items.length > 0 && (
            <div className="grid grid-cols-2 gap-x-5 gap-y-10 md:grid-cols-3 lg:grid-cols-4">
              {data.items.map((p) => <ProductCard key={p.id} p={p} />)}
            </div>
          )}
          {data && data.paginas > 1 && (
            <nav className="mt-12 flex items-center justify-center gap-2" aria-label="Paginación">
              {Array.from({ length: data.paginas }, (_, i) => i + 1).map((n) => (
                <button key={n} type="button" onClick={() => { set({ pagina: n }); window.scrollTo({ top: 0 }); }}
                  aria-current={n === data.pagina ? 'page' : undefined}
                  className={`h-11 w-11 rounded-md font-display text-lg font-bold ${n === data.pagina ? 'bg-naranja text-black' : 'border border-acero hover:border-hueso'}`}>
                  {n}
                </button>
              ))}
            </nav>
          )}
        </div>
      </div>
    </>
  );
}

export function Categories() {
  const [cats, setCats] = useState<Categoria[] | null>(null);
  useEffect(() => {
    document.title = 'Categorías · IronCart';
    api<Categoria[]>('/categorias').then(setCats).catch(() => setCats([]));
  }, []);
  return (
    <>
      <PageHeader titulo="Categorías">Elige por tipo de suplemento. Cada categoría muestra cuántos productos hay hoy en el catálogo.</PageHeader>
      <div className="contenedor">
        <ul className="divide-y divide-grafito border-y border-grafito">
          {(cats ?? []).map((c) => {
            const a = ARTE_CATEGORIA[c.slug] ?? ARTE_CATEGORIA.proteinas;
            return (
              <li key={c.slug}>
                <Link to={`/productos?categoria=${c.slug}`} className="group grid grid-cols-[88px_1fr] items-center gap-5 py-6 sm:grid-cols-[120px_1fr_auto]">
                  <div className="aspect-square rounded-md bg-carbon p-2"><ProductArt imagen={a.imagen} color={a.color} nombre={a.nombre} /></div>
                  <div>
                    <h2 className="text-4xl font-extrabold group-hover:text-naranja sm:text-5xl">{c.nombre}</h2>
                    <p className="mt-1 max-w-prose text-niebla">{c.descripcion}</p>
                  </div>
                  <p className="col-start-2 font-display text-xl text-niebla sm:col-start-auto">{c.productos} productos</p>
                </Link>
              </li>
            );
          })}
        </ul>
        {!cats && <p className="py-10 text-niebla">Cargando categorías…</p>}
      </div>
    </>
  );
}
