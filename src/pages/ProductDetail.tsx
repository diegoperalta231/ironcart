import { useEffect, useState } from 'react';
import { IconAtras, IconCarrito, IconCheck, IconMas, IconMenos, SpotMark } from '../components/Icons';
import ProductArt from '../components/ProductArt';
import ProductCard, { Disponibilidad } from '../components/ProductCard';
import { useStore } from '../context/Store';
import { api, ApiError } from '../lib/api';
import { dinero } from '../lib/format';
import { Link } from '../lib/router';
import type { Producto } from '../lib/types';

export function Stepper({ valor, min = 1, max, onChange, etiqueta }: { valor: number; min?: number; max: number; onChange: (n: number) => void; etiqueta: string }) {
  return (
    <div className="inline-flex items-center rounded-md border border-acero" role="group" aria-label={etiqueta}>
      <button type="button" className="grid h-11 w-11 place-items-center disabled:opacity-40" onClick={() => onChange(valor - 1)} disabled={valor <= min} aria-label="Disminuir cantidad">
        <IconMenos size={18} />
      </button>
      <span className="w-10 text-center font-display text-xl font-bold" aria-live="polite">{valor}</span>
      <button type="button" className="grid h-11 w-11 place-items-center disabled:opacity-40" onClick={() => onChange(valor + 1)} disabled={valor >= max} aria-label="Aumentar cantidad">
        <IconMas size={18} />
      </button>
    </div>
  );
}

export default function ProductDetail({ slug }: { slug: string }) {
  const { agregar, abrirSpot } = useStore();
  const [p, setP] = useState<Producto | null>(null);
  const [error, setError] = useState<{ status: number; msg: string } | null>(null);
  const [cant, setCant] = useState(1);
  const [agregado, setAgregado] = useState(false);

  useEffect(() => {
    setP(null); setError(null); setCant(1); setAgregado(false);
    api<Producto>(`/productos/${encodeURIComponent(slug)}`)
      .then((x) => { setP(x); document.title = `${x.nombre} ${x.presentacion} · IronCart`; })
      .catch((e: ApiError) => setError({ status: e.status, msg: e.message }));
  }, [slug]);

  if (error) {
    return (
      <div className="contenedor py-24 text-center">
        <h1 className="text-6xl font-extrabold">{error.status === 404 ? 'Producto no encontrado' : 'No se pudo cargar'}</h1>
        <p className="mt-3 text-niebla">{error.status === 404 ? 'Puede que ya no esté en el catálogo.' : error.msg}</p>
        <Link to="/productos" className="btn-primario mt-8">Ver el catálogo</Link>
      </div>
    );
  }
  if (!p) return <div className="contenedor py-24 text-niebla" aria-busy="true">Cargando producto…</div>;

  const agotado = p.stock <= 0;
  const porPorcion = p.porciones ? p.precio / p.porciones : null;

  return (
    <div className="contenedor pt-8">
      <Link to={`/productos?categoria=${p.categoria_slug}`} className="inline-flex items-center gap-1 text-niebla hover:text-hueso">
        <IconAtras size={18} /> {p.categoria}
      </Link>

      <div className="mt-6 grid gap-10 lg:grid-cols-2 lg:gap-16">
        <div className="relative aspect-square h-fit rounded-xl bg-carbon p-6 sm:p-12 lg:sticky lg:top-24">
          <ProductArt imagen={p.imagen} color={p.color} nombre={p.nombre} marca={p.marca} grande />
        </div>

        <div>
          <p className="text-lg text-niebla">{p.marca}</p>
          <h1 className="mt-1 text-5xl font-extrabold sm:text-7xl">{p.nombre}</h1>
          <p className="mt-2 text-lg text-hueso/80">{p.presentacion}{p.sabor ? `, sabor ${p.sabor.toLowerCase()}` : ''}</p>

          <div className="mt-6 flex flex-wrap items-end gap-x-5 gap-y-2">
            <p className="font-display text-6xl font-extrabold leading-none">{dinero(p.precio)}</p>
            {p.precio_anterior && <p className="pb-1 text-xl text-niebla line-through">{dinero(p.precio_anterior)}</p>}
            <Disponibilidad stock={p.stock} className="pb-1.5 text-base" />
          </div>
          {p.stock > 0 && p.stock <= 5 && <p className="mt-2 text-alerta">Quedan pocas unidades: {p.stock} en inventario.</p>}

          <div className="mt-8 flex flex-wrap items-center gap-3">
            {!agotado && <Stepper valor={cant} max={Math.min(p.stock, 20)} onChange={setCant} etiqueta="Cantidad" />}
            <button type="button" className="btn-primario flex-1 py-3.5 text-xl sm:flex-none sm:px-10" disabled={agotado}
              onClick={async () => { if (await agregar(p.id, cant, p.nombre)) { setAgregado(true); window.setTimeout(() => setAgregado(false), 2500); } }}>
              {agregado ? <><IconCheck size={22} /> Agregado</> : agotado ? 'Agotado' : <><IconCarrito size={22} /> Agregar al carrito</>}
            </button>
          </div>
          <button type="button" onClick={() => abrirSpot(`Cuéntame más sobre ${p.nombre} de ${p.marca} (${p.presentacion})`)}
            className="mt-4 inline-flex items-center gap-2 text-niebla hover:text-hueso">
            <SpotMark size={22} /> Preguntar a Spot sobre este producto
          </button>

          <p className="mt-8 max-w-prose text-lg text-hueso/85">{p.descripcion}</p>
          {!!p.beneficios?.length && (
            <ul className="mt-5 space-y-2">
              {p.beneficios.map((b) => <li key={b} className="flex gap-2"><IconCheck size={20} className="mt-0.5 shrink-0 text-lima" />{b}</li>)}
            </ul>
          )}

          <section className="facts mt-10 max-w-md" aria-label="Ficha del producto">
            <p className="facts-titulo">Ficha del producto</p>
            <div className="facts-regla-gruesa" />
            <div className="facts-fila"><span className="font-semibold">Presentación</span><span>{p.presentacion}</span></div>
            {p.porciones && <div className="facts-fila"><span className="font-semibold">Porciones por envase</span><span>{p.porciones}</span></div>}
            {porPorcion && <div className="facts-fila"><span className="font-semibold">Precio por porción</span><span>{dinero(porPorcion)}</span></div>}
            {p.sabor && <div className="facts-fila"><span className="font-semibold">Sabor</span><span>{p.sabor}</span></div>}
            <div className="facts-regla-media" />
            <div className="facts-fila"><span>Categoría</span><span>{p.categoria}</span></div>
            <div className="facts-fila"><span>Marca</span><span>{p.marca}</span></div>
            <div className="flex justify-between pt-1.5"><span>Existencias</span><span>{p.stock} unidades</span></div>
            <p className="mt-3 border-t-4 border-hueso pt-2 text-xs leading-snug">
              Producto y precio de demostración. Lee siempre la etiqueta del fabricante. Si tienes una condición de salud, consulta a un profesional antes de usar suplementos.
            </p>
          </section>
        </div>
      </div>

      {!!p.relacionados?.length && (
        <section className="mt-24" aria-labelledby="t-rel">
          <h2 id="t-rel" className="text-5xl font-extrabold">También en {p.categoria.toLowerCase()}</h2>
          <div className="mt-8 grid grid-cols-2 gap-x-5 gap-y-10 md:grid-cols-4">
            {p.relacionados.map((r) => <ProductCard key={r.id} p={r} />)}
          </div>
        </section>
      )}
    </div>
  );
}
