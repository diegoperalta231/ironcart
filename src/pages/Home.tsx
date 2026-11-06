import { useEffect, useState } from 'react';
import ProductArt from '../components/ProductArt';
import ProductCard, { ProductGridSkeleton } from '../components/ProductCard';
import { IconCamion, IconCaja, IconEscudo, SpotMark } from '../components/Icons';
import { useStore } from '../context/Store';
import { api } from '../lib/api';
import { Link } from '../lib/router';
import type { Categoria, Marca, Producto } from '../lib/types';

/** Ilustración representativa por categoría (envases genéricos). */
export const ARTE_CATEGORIA: Record<string, { imagen: string; color: string; nombre: string }> = {
  proteinas: { imagen: 'tub', color: '#E3B341', nombre: 'Whey' },
  creatinas: { imagen: 'jar', color: '#ece9e2', nombre: 'Creatina' },
  'pre-entrenos': { imagen: 'can', color: '#ff5b14', nombre: 'Pre' },
  vitaminas: { imagen: 'bottle', color: '#2F855A', nombre: 'Multi' },
  aminoacidos: { imagen: 'can', color: '#38B2AC', nombre: 'BCAA' },
  accesorios: { imagen: 'shaker', color: '#c8f031', nombre: 'Shaker' },
};

const HERO_IMG = import.meta.env.VITE_HERO_IMAGE_URL as string | undefined;

function Hero({ categorias, marcas, total }: { categorias: Categoria[]; marcas: Marca[]; total: number | null }) {
  const { abrirSpot } = useStore();
  return (
    <section className="relative overflow-hidden border-b border-grafito">
      {HERO_IMG && (
        <img src={HERO_IMG} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover opacity-30" />
      )}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_75%_40%,rgba(255,91,20,0.22),transparent_55%)]" aria-hidden="true" />
      <div className="contenedor relative grid items-center gap-10 py-14 sm:py-20 lg:grid-cols-[1.15fr_1fr] lg:py-24">
        <div className="hero-entrada">
          <p className="text-lg text-niebla">Suplementos deportivos en Nicaragua</p>
          <h1 className="mt-3 text-[3.1rem] font-extrabold italic leading-[0.9] sm:text-[5rem] xl:text-[6.2rem]">
            Entrena fuerte.<br />Compra con datos claros.
          </h1>
          <p className="mt-6 max-w-xl text-lg text-hueso/80">
            Proteínas, creatinas, pre-entrenos y vitaminas de las marcas que ya conoces, con el precio y las existencias a la vista.
            ¿Dudas? Spot, nuestro asistente con IA, responde con los datos reales del catálogo.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/productos" className="btn-primario px-7 py-3.5 text-xl">Explorar productos</Link>
            <button type="button" className="btn-secundario px-6 py-3.5 text-xl" onClick={() => abrirSpot()}>
              <SpotMark size={24} /> Preguntar a Spot
            </button>
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-lg lg:max-w-none">
          <div className="relative aspect-[6/5]">
            <div className="absolute left-[8%] top-0 w-[60%] -rotate-[5deg] sm:left-0">
              <ProductArt imagen="tub" color="#ff5b14" nombre="Iron Whey" marca="IronCart" grande />
            </div>
            <div className="absolute bottom-0 left-[2%] w-[30%] rotate-[4deg] sm:bottom-[-4%] sm:left-[30%]">
              <ProductArt imagen="jar" color="#c8f031" nombre="Creatina" grande />
            </div>
          </div>
          {/* Panel tipo "Supplement Facts" con datos reales de la tienda */}
          <aside className="facts relative mt-4 shadow-2xl shadow-black sm:absolute sm:-bottom-6 sm:right-0 sm:mt-0 sm:w-[52%] sm:min-w-[240px]" aria-label="Datos de la tienda">
            <p className="facts-titulo">Datos de la tienda</p>
            <p className="text-sm">Actualizados desde la base de datos</p>
            <div className="facts-regla-gruesa" />
            <div className="facts-fila"><span className="font-semibold">Productos</span><span className="font-display text-xl font-bold">{total ?? '—'}</span></div>
            <div className="facts-fila"><span className="font-semibold">Marcas</span><span className="font-display text-xl font-bold">{marcas.length || '—'}</span></div>
            <div className="facts-fila"><span className="font-semibold">Categorías</span><span className="font-display text-xl font-bold">{categorias.length || '—'}</span></div>
            <div className="facts-regla-media" />
            <div className="facts-fila"><span>Asistente Spot</span><span className="font-semibold">24 h</span></div>
            <div className="flex items-baseline justify-between gap-4 pt-1.5"><span>Envío gratis desde</span><span className="font-semibold">$75</span></div>
          </aside>
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  const { abrirSpot } = useStore();
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [marcas, setMarcas] = useState<Marca[]>([]);
  const [destacados, setDestacados] = useState<Producto[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'IronCart · Suplementos deportivos';
    Promise.all([
      api<Categoria[]>('/categorias').then(setCategorias),
      api<Marca[]>('/marcas').then(setMarcas),
      api<{ items: Producto[]; total: number }>('/productos?destacados=true&por_pagina=8').then((r) => setDestacados(r.items)),
      api<{ total: number }>('/productos?por_pagina=1').then((r) => setTotal(r.total)),
    ]).catch((e) => setError(e.message));
  }, []);

  return (
    <>
      <Hero categorias={categorias} marcas={marcas} total={total} />

      <section className="contenedor pt-20" aria-labelledby="t-categorias">
        <div className="flex items-end justify-between gap-4">
          <h2 id="t-categorias" className="text-5xl font-extrabold sm:text-6xl">Categorías</h2>
          <Link to="/categorias" className="text-niebla underline-offset-4 hover:text-hueso hover:underline">Ver todas</Link>
        </div>
        <ul className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {(categorias.length ? categorias : Object.keys(ARTE_CATEGORIA).map((slug) => ({ slug, nombre: '', descripcion: '', productos: 0 }))).map((c) => {
            const a = ARTE_CATEGORIA[c.slug] ?? ARTE_CATEGORIA.proteinas;
            return (
              <li key={c.slug}>
                <Link to={`/productos?categoria=${c.slug}`} className="group flex h-full flex-col rounded-md bg-carbon p-4 ring-1 ring-transparent transition hover:ring-naranja">
                  <div className="mx-auto aspect-square w-4/5 transition-transform duration-300 group-hover:-translate-y-1">
                    <ProductArt imagen={a.imagen} color={a.color} nombre={a.nombre} />
                  </div>
                  <p className="mt-2 font-display text-2xl font-bold leading-none">{c.nombre || '…'}</p>
                  <p className="mt-1 text-sm text-niebla">{c.productos ? `${c.productos} productos` : ' '}</p>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="contenedor pt-20" aria-labelledby="t-destacados">
        <div className="flex items-end justify-between gap-4">
          <h2 id="t-destacados" className="text-5xl font-extrabold sm:text-6xl">Destacados</h2>
          <Link to="/productos" className="text-niebla underline-offset-4 hover:text-hueso hover:underline">Todo el catálogo</Link>
        </div>
        <div className="mt-8">
          {error && <p className="rounded-md border border-error/50 bg-[#2a1616] p-4">No pudimos cargar los productos: {error}</p>}
          {!destacados && !error && <ProductGridSkeleton />}
          {destacados && (
            <div className="grid grid-cols-2 gap-x-5 gap-y-10 md:grid-cols-3 lg:grid-cols-4">
              {destacados.map((p) => <ProductCard key={p.id} p={p} />)}
            </div>
          )}
        </div>
      </section>

      <section className="contenedor pt-24" aria-labelledby="t-por-que">
        <div className="grid gap-12 lg:grid-cols-[1fr_1.1fr]">
          <div>
            <h2 id="t-por-que" className="text-5xl font-extrabold sm:text-6xl">Por qué comprar en IronCart</h2>
            <dl className="mt-10 space-y-8">
              {[
                { I: IconCaja, t: 'Catálogo claro', d: 'Cada producto muestra presentación, porciones, precio por porción y existencias actualizadas. Si algo se agota, lo verás antes de pagar.' },
                { I: IconCamion, t: 'Envío gratis desde $75', d: 'Entregas en Managua en 1 a 2 días hábiles y de 2 a 5 días en el resto del país. Envíos de demostración.' },
                { I: IconEscudo, t: 'Información responsable', d: 'Explicamos qué es cada suplemento con fuentes citadas. No damos diagnósticos ni dosis personalizadas: eso le corresponde a tu médico o nutricionista.' },
              ].map(({ I, t, d }) => (
                <div key={t} className="flex gap-4">
                  <I size={28} className="mt-1 shrink-0 text-naranja" />
                  <div>
                    <dt className="font-display text-2xl font-bold">{t}</dt>
                    <dd className="mt-1 max-w-prose text-niebla">{d}</dd>
                  </div>
                </div>
              ))}
            </dl>
          </div>

          <div className="rounded-xl bg-carbon p-6 sm:p-8">
            <div className="flex items-center gap-3">
              <SpotMark size={44} />
              <div>
                <h3 className="text-4xl font-extrabold">Atención con IA</h3>
                <p className="text-niebla">Spot está disponible las 24 horas.</p>
              </div>
            </div>
            <p className="mt-5 max-w-prose text-hueso/85">
              Spot usa Claude para conversar contigo, pero no inventa: los precios, el stock y tus pedidos los consulta en la base de datos,
              y las explicaciones salen de nuestra base de conocimiento curada. Toca una pregunta para probarlo.
            </p>
            <div className="mt-6 flex flex-col gap-2.5">
              {[
                '¿Qué diferencia hay entre ISO100 y Gold Standard?',
                '¿Qué es la creatina y es segura?',
                '¿Qué pre-entreno tienen disponible?',
                '¿Cómo puedo pagar mi pedido?',
              ].map((q) => (
                <button key={q} type="button" onClick={() => abrirSpot(q)}
                  className="rounded-lg border border-acero bg-hierro px-4 py-3 text-left transition-colors hover:border-naranja">
                  {q}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="contenedor pt-24" aria-labelledby="t-tienda">
        <div className="grid gap-8 border-y border-grafito py-12 md:grid-cols-[1fr_2fr]">
          <h2 id="t-tienda" className="text-4xl font-extrabold">Sobre la tienda</h2>
          <div className="max-w-prose space-y-4 text-niebla">
            <p>
              IronCart nació como un proyecto académico de comercio electrónico con inteligencia artificial: una tienda completa con carrito,
              pedidos y un asistente que separa los datos que cambian (precio, inventario, pedidos) del conocimiento estable (políticas y
              guías de suplementos).
            </p>
            <p>
              Los productos y precios son ficticios y no se realizan cobros, pero todo el flujo funciona de verdad. <Link to="/nosotros" className="text-hueso underline underline-offset-4 hover:text-naranja">Conoce más sobre IronCart</Link>.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
