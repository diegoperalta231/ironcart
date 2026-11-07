import { useEffect, useState, type FormEvent } from 'react';
import { IconCamion, IconCheck, IconPapelera } from '../components/Icons';
import { PageHeader } from '../components/Layout';
import ProductArt from '../components/ProductArt';
import { useStore } from '../context/Store';
import { api, ApiError, CART_KEY } from '../lib/api';
import { local } from '../lib/format';
import { dinero, ESTADOS_PEDIDO, fecha, METODOS_PAGO } from '../lib/format';
import { Link, useRouter } from '../lib/router';
import type { Pedido } from '../lib/types';
import { Stepper } from './ProductDetail';

// ============================================================== Carrito
export function Cart() {
  const { carrito, fijarCantidad, quitar, refrescarCarrito } = useStore();
  useEffect(() => { document.title = 'Carrito · IronCart'; refrescarCarrito(); }, [refrescarCarrito]);

  if (!carrito) return <div className="contenedor py-24 text-niebla" aria-busy="true">Cargando carrito…</div>;
  if (carrito.items.length === 0) {
    return (
      <div className="contenedor py-24 text-center">
        <h1 className="text-6xl font-extrabold">Tu carrito está vacío</h1>
        <p className="mt-3 text-niebla">Agrega productos desde el catálogo o pídele una recomendación a Spot.</p>
        <Link to="/productos" className="btn-primario mt-8">Explorar productos</Link>
      </div>
    );
  }
  const falta = Math.max(0, carrito.envio_gratis_desde - carrito.subtotal);
  const hayProblema = carrito.items.some((i) => !i.stock_suficiente);

  return (
    <>
      <PageHeader titulo="Carrito" />
      <div className="contenedor grid gap-10 lg:grid-cols-[1fr_380px]">
        <ul className="h-fit divide-y divide-grafito border-y border-grafito">
          {carrito.items.map((it) => (
            <li key={it.producto_id} className="grid grid-cols-[84px_1fr] gap-4 py-5 sm:grid-cols-[110px_1fr_auto]">
              <Link to={`/producto/${it.producto.slug}`} className="aspect-square rounded-md bg-carbon p-1.5">
                <ProductArt imagen={it.producto.imagen} color={it.producto.color} nombre={it.producto.nombre} />
              </Link>
              <div className="min-w-0">
                <p className="text-sm text-niebla">{it.producto.marca}</p>
                <Link to={`/producto/${it.producto.slug}`} className="font-display text-2xl font-bold leading-tight hover:text-naranja">{it.producto.nombre}</Link>
                <p className="text-sm text-niebla">{it.producto.presentacion} · {dinero(it.producto.precio)} c/u</p>
                {!it.stock_suficiente && (
                  <p className="mt-1 text-sm text-error">Solo quedan {it.producto.stock} unidades. Ajusta la cantidad para continuar.</p>
                )}
                <div className="mt-3 flex items-center gap-3 sm:hidden">
                  <Stepper valor={it.cantidad} max={Math.min(20, Math.max(it.producto.stock, 1))} onChange={(n) => fijarCantidad(it.producto_id, n)} etiqueta={`Cantidad de ${it.producto.nombre}`} />
                  <button type="button" onClick={() => quitar(it.producto_id)} className="rounded-md p-2.5 text-niebla hover:text-error" aria-label={`Eliminar ${it.producto.nombre}`}><IconPapelera /></button>
                  <span className="ml-auto font-display text-2xl font-bold">{dinero(it.subtotal)}</span>
                </div>
              </div>
              <div className="hidden flex-col items-end justify-between sm:flex">
                <span className="font-display text-3xl font-bold">{dinero(it.subtotal)}</span>
                <div className="flex items-center gap-2">
                  <Stepper valor={it.cantidad} max={Math.min(20, Math.max(it.producto.stock, 1))} onChange={(n) => fijarCantidad(it.producto_id, n)} etiqueta={`Cantidad de ${it.producto.nombre}`} />
                  <button type="button" onClick={() => quitar(it.producto_id)} className="rounded-md p-2.5 text-niebla hover:text-error" aria-label={`Eliminar ${it.producto.nombre}`}><IconPapelera /></button>
                </div>
              </div>
            </li>
          ))}
        </ul>

        <aside className="h-fit rounded-xl bg-carbon p-6 lg:sticky lg:top-24" aria-label="Resumen del pedido">
          <h2 className="text-3xl font-extrabold">Resumen</h2>
          <dl className="mt-5 space-y-2.5">
            <div className="flex justify-between"><dt className="text-niebla">Subtotal ({carrito.cantidad_total} productos)</dt><dd>{dinero(carrito.subtotal)}</dd></div>
            <div className="flex justify-between"><dt className="text-niebla">Envío</dt><dd>{carrito.envio === 0 ? 'Gratis' : dinero(carrito.envio)}</dd></div>
            <div className="flex justify-between border-t border-acero pt-3 font-display text-3xl font-extrabold"><dt>Total</dt><dd>{dinero(carrito.total)}</dd></div>
          </dl>
          <div className="mt-5 flex gap-2 text-sm text-niebla">
            <IconCamion size={20} className="shrink-0 text-naranja" />
            {falta > 0 ? <span>Te faltan <strong className="text-hueso">{dinero(falta)}</strong> para el envío gratis.</span> : <span>Tu pedido tiene envío gratis.</span>}
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-grafito" aria-hidden="true">
            <div className="h-full bg-naranja transition-all" style={{ width: `${Math.min(100, (carrito.subtotal / carrito.envio_gratis_desde) * 100)}%` }} />
          </div>
          <Link to="/checkout" aria-disabled={hayProblema} onClick={(e) => { if (hayProblema) e.preventDefault(); }}
            className={`btn-primario mt-6 w-full py-3.5 text-xl ${hayProblema ? 'pointer-events-none opacity-50' : ''}`}>
            Ir al checkout
          </Link>
          <Link to="/productos" className="btn-fantasma mt-2 w-full text-base">Seguir comprando</Link>
        </aside>
      </div>
    </>
  );
}

// ============================================================== Checkout
export function Checkout() {
  const { usuario, cargandoSesion, carrito, setCarrito, refrescarCarrito } = useStore();
  const { navigate } = useRouter();
  const [form, setForm] = useState({ nombre: '', direccion: '', ciudad: 'Managua', telefono: '' });
  const [metodo, setMetodo] = useState('tarjeta_demo');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pedido, setPedido] = useState<Pedido | null>(null);

  useEffect(() => { document.title = 'Checkout · IronCart'; refrescarCarrito(); }, [refrescarCarrito]);
  useEffect(() => { if (usuario) setForm((f) => ({ ...f, nombre: f.nombre || usuario.nombre })); }, [usuario]);

  if (pedido) {
    return (
      <div className="contenedor max-w-2xl py-20">
        <div className="grid h-16 w-16 place-items-center rounded-full bg-lima text-black"><IconCheck size={34} /></div>
        <h1 className="mt-6 text-6xl font-extrabold">Pedido confirmado</h1>
        <p className="mt-3 text-lg text-niebla">Tu número de pedido es <strong className="font-display text-2xl text-hueso">#{pedido.numero}</strong>. El inventario ya se actualizó.</p>
        <div className="mt-8 rounded-xl bg-carbon p-6">
          <ul className="space-y-2">{pedido.items.map((i) => <li key={i.producto_id} className="flex justify-between gap-4"><span>{i.cantidad} × {i.nombre}</span><span>{dinero(i.subtotal)}</span></li>)}</ul>
          <p className="mt-4 flex justify-between border-t border-acero pt-3 font-display text-2xl font-bold"><span>Total</span><span>{dinero(pedido.total)}</span></p>
          <p className="mt-3 text-sm text-niebla">{METODOS_PAGO[pedido.metodo_pago]}. Simulación académica: no se realizó ningún cobro.</p>
        </div>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link to={`/pedidos/${pedido.numero}`} className="btn-primario">Ver mi pedido</Link>
          <Link to="/productos" className="btn-secundario">Seguir comprando</Link>
        </div>
      </div>
    );
  }

  if (cargandoSesion || !carrito) return <div className="contenedor py-24 text-niebla" aria-busy="true">Cargando…</div>;

  if (!usuario) {
    return (
      <div className="contenedor max-w-xl py-24 text-center">
        <h1 className="text-6xl font-extrabold">Inicia sesión para continuar</h1>
        <p className="mt-3 text-niebla">Necesitas una cuenta para confirmar el pedido y consultarlo después. Tu carrito se conserva.</p>
        <div className="mt-8 flex justify-center gap-3">
          <Link to="/cuenta?volver=/checkout" className="btn-primario">Iniciar sesión</Link>
          <Link to="/cuenta?modo=registro&volver=/checkout" className="btn-secundario">Crear cuenta</Link>
        </div>
      </div>
    );
  }

  if (carrito.items.length === 0) {
    return (
      <div className="contenedor py-24 text-center">
        <h1 className="text-6xl font-extrabold">No hay productos para pagar</h1>
        <Link to="/productos" className="btn-primario mt-8">Explorar productos</Link>
      </div>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setEnviando(true); setError(null);
    try {
      const r = await api<{ pedido: Pedido }>('/pedidos', { method: 'POST', body: { envio: form, metodo_pago: metodo } });
      setPedido(r.pedido);
      local.del(CART_KEY);
      setCarrito({ ...carrito, id: null, items: [], cantidad_total: 0, subtotal: 0, envio: 0, total: 0 });
      window.scrollTo({ top: 0 });
    } catch (err) {
      const ae = err as ApiError;
      setError(ae.message);
      if (ae.code === 'stock_insuficiente') refrescarCarrito();
      if (ae.status === 401) navigate('/cuenta?volver=/checkout');
    } finally {
      setEnviando(false);
    }
  };

  const campo = (k: keyof typeof form, label: string, props: Record<string, unknown> = {}) => (
    <div>
      <label htmlFor={`f-${k}`} className="etiqueta">{label}</label>
      <input id={`f-${k}`} className="campo" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} {...props} />
    </div>
  );

  return (
    <>
      <PageHeader titulo="Checkout">
        <span className="inline-block rounded-md border border-alerta/60 bg-alerta/10 px-3 py-2 text-base text-hueso">
          Simulación académica: no se solicitan ni se procesan datos bancarios y no se realiza ningún cobro.
        </span>
      </PageHeader>
      <form onSubmit={submit} className="contenedor grid gap-10 lg:grid-cols-[1fr_380px]">
        <div className="space-y-10">
          <fieldset>
            <legend className="font-display text-3xl font-extrabold">Datos de envío</legend>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">{campo('nombre', 'Nombre de quien recibe', { required: true, minLength: 3, maxLength: 80, autoComplete: 'name' })}</div>
              <div className="sm:col-span-2">{campo('direccion', 'Dirección', { required: true, minLength: 5, maxLength: 160, autoComplete: 'street-address', placeholder: 'Barrio, calle, referencia' })}</div>
              {campo('ciudad', 'Ciudad', { required: true, minLength: 2, maxLength: 60, autoComplete: 'address-level2' })}
              {campo('telefono', 'Teléfono (opcional)', { type: 'tel', maxLength: 20, autoComplete: 'tel', pattern: '[+0-9][0-9 \\-]{6,19}', placeholder: '+505 8888 8888' })}
            </div>
          </fieldset>
          <fieldset>
            <legend className="font-display text-3xl font-extrabold">Método de pago</legend>
            <div className="mt-5 grid gap-3">
              {Object.entries(METODOS_PAGO).map(([v, t]) => (
                <label key={v} className={`flex cursor-pointer items-center gap-3 rounded-md border p-4 ${metodo === v ? 'border-naranja bg-naranja/5' : 'border-acero'}`}>
                  <input type="radio" name="metodo" value={v} checked={metodo === v} onChange={() => setMetodo(v)} className="h-4 w-4 accent-[#ff5b14]" />
                  {t}
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        <aside className="h-fit rounded-xl bg-carbon p-6 lg:sticky lg:top-24">
          <h2 className="text-3xl font-extrabold">Tu pedido</h2>
          <ul className="mt-4 space-y-2 text-[0.95rem]">
            {carrito.items.map((i) => <li key={i.producto_id} className="flex justify-between gap-3"><span className="text-niebla">{i.cantidad} × {i.producto.nombre}</span><span>{dinero(i.subtotal)}</span></li>)}
          </ul>
          <dl className="mt-4 space-y-2 border-t border-acero pt-4">
            <div className="flex justify-between"><dt className="text-niebla">Subtotal</dt><dd>{dinero(carrito.subtotal)}</dd></div>
            <div className="flex justify-between"><dt className="text-niebla">Envío</dt><dd>{carrito.envio === 0 ? 'Gratis' : dinero(carrito.envio)}</dd></div>
            <div className="flex justify-between font-display text-3xl font-extrabold"><dt>Total</dt><dd>{dinero(carrito.total)}</dd></div>
          </dl>
          {error && <p role="alert" className="mt-4 rounded-md border border-error/50 bg-[#2a1616] p-3 text-sm">{error}</p>}
          <button type="submit" disabled={enviando} className="btn-primario mt-6 w-full py-3.5 text-xl">
            {enviando ? 'Confirmando…' : 'Confirmar pedido'}
          </button>
          <p className="mt-3 text-xs text-niebla">Al confirmar se verifica el stock de cada producto y se descuenta del inventario.</p>
        </aside>
      </form>
    </>
  );
}

// ============================================================== Pedidos
function EstadoPedido({ estado }: { estado: string }) {
  const pasos = ['confirmado', 'preparando', 'enviado', 'entregado'];
  const idx = pasos.indexOf(estado);
  if (estado === 'cancelado') return <p className="text-error">Pedido cancelado</p>;
  return (
    <ol className="grid grid-cols-4 gap-1.5" aria-label={`Estado: ${ESTADOS_PEDIDO[estado]}`}>
      {pasos.map((s, i) => (
        <li key={s}>
          <div className={`h-1.5 rounded-full ${i <= idx ? 'bg-lima' : 'bg-grafito'}`} />
          <p className={`mt-1.5 text-xs ${i === idx ? 'text-hueso' : 'text-niebla'}`}>{ESTADOS_PEDIDO[s]}</p>
        </li>
      ))}
    </ol>
  );
}

function RequiereSesion({ volver }: { volver: string }) {
  return (
    <div className="contenedor max-w-xl py-24 text-center">
      <h1 className="text-6xl font-extrabold">Tus pedidos</h1>
      <p className="mt-3 text-niebla">Inicia sesión para ver el historial y el estado de tus pedidos.</p>
      <Link to={`/cuenta?volver=${encodeURIComponent(volver)}`} className="btn-primario mt-8">Iniciar sesión</Link>
    </div>
  );
}

export function Orders() {
  const { usuario, cargandoSesion } = useStore();
  const [pedidos, setPedidos] = useState<Pedido[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    document.title = 'Mis pedidos · IronCart';
    if (usuario) api<Pedido[]>('/pedidos').then(setPedidos).catch((e) => setError(e.message));
  }, [usuario]);

  if (cargandoSesion) return <div className="contenedor py-24 text-niebla">Cargando…</div>;
  if (!usuario) return <RequiereSesion volver="/pedidos" />;
  return (
    <>
      <PageHeader titulo="Mis pedidos">Historial de pedidos de {usuario.nombre}.</PageHeader>
      <div className="contenedor">
        {error && <p className="rounded-md border border-error/50 bg-[#2a1616] p-4">{error}</p>}
        {!pedidos && !error && <p className="text-niebla">Cargando pedidos…</p>}
        {pedidos?.length === 0 && (
          <div className="py-12">
            <p className="font-display text-3xl font-bold">Aún no tienes pedidos</p>
            <Link to="/productos" className="btn-primario mt-6">Hacer mi primer pedido</Link>
          </div>
        )}
        <ul className="space-y-4">
          {pedidos?.map((p) => (
            <li key={p.numero}>
              <Link to={`/pedidos/${p.numero}`} className="grid gap-4 rounded-xl bg-carbon p-5 ring-1 ring-transparent hover:ring-naranja sm:grid-cols-[1fr_1.4fr_auto] sm:items-center">
                <div>
                  <p className="font-display text-3xl font-extrabold">#{p.numero}</p>
                  <p className="text-sm text-niebla">{fecha(p.creado_en)} · {p.items.reduce((s, i) => s + i.cantidad, 0)} productos</p>
                </div>
                <EstadoPedido estado={p.estado} />
                <p className="font-display text-2xl font-bold sm:text-right">{dinero(p.total)}</p>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

export function OrderDetail({ numero }: { numero: string }) {
  const { usuario, cargandoSesion } = useStore();
  const [p, setP] = useState<Pedido | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    document.title = `Pedido #${numero} · IronCart`;
    if (usuario) api<Pedido>(`/pedidos/${encodeURIComponent(numero)}`).then(setP).catch((e) => setError(e.message));
  }, [usuario, numero]);

  if (cargandoSesion) return <div className="contenedor py-24 text-niebla">Cargando…</div>;
  if (!usuario) return <RequiereSesion volver={`/pedidos/${numero}`} />;
  if (error) {
    return (
      <div className="contenedor py-24 text-center">
        <h1 className="text-6xl font-extrabold">Pedido no encontrado</h1>
        <p className="mt-3 text-niebla">{error}</p>
        <Link to="/pedidos" className="btn-primario mt-8">Ver mis pedidos</Link>
      </div>
    );
  }
  if (!p) return <div className="contenedor py-24 text-niebla">Cargando pedido…</div>;
  return (
    <div className="contenedor max-w-4xl pt-12">
      <Link to="/pedidos" className="text-niebla hover:text-hueso">Mis pedidos</Link>
      <h1 className="mt-2 text-6xl font-extrabold sm:text-7xl">Pedido #{p.numero}</h1>
      <p className="mt-2 text-niebla">Realizado el {fecha(p.creado_en)}. Última actualización: {fecha(p.actualizado_en)}.</p>
      <div className="mt-8 max-w-xl"><EstadoPedido estado={p.estado} /></div>
      <div className="mt-10 grid gap-8 md:grid-cols-[1.5fr_1fr]">
        <ul className="divide-y divide-grafito border-y border-grafito">
          {p.items.map((i) => (
            <li key={i.producto_id} className="flex items-center gap-4 py-4">
              <div className="h-16 w-16 shrink-0 rounded bg-carbon p-1"><ProductArt imagen={i.imagen} color={i.color} nombre={i.nombre} /></div>
              <div className="min-w-0 flex-1">
                <Link to={`/producto/${i.slug}`} className="font-display text-xl font-bold hover:text-naranja">{i.nombre}</Link>
                <p className="text-sm text-niebla">{i.cantidad} × {dinero(i.precio_unitario)}</p>
              </div>
              <span className="font-display text-xl font-bold">{dinero(i.subtotal)}</span>
            </li>
          ))}
        </ul>
        <div className="space-y-6">
          <dl className="space-y-2 rounded-xl bg-carbon p-5">
            <div className="flex justify-between"><dt className="text-niebla">Subtotal</dt><dd>{dinero(p.subtotal)}</dd></div>
            <div className="flex justify-between"><dt className="text-niebla">Envío</dt><dd>{Number(p.envio) === 0 ? 'Gratis' : dinero(p.envio)}</dd></div>
            <div className="flex justify-between border-t border-acero pt-2 font-display text-2xl font-bold"><dt>Total</dt><dd>{dinero(p.total)}</dd></div>
          </dl>
          <div className="text-[0.95rem]">
            <h2 className="font-display text-xl font-bold">Envío a</h2>
            <p className="text-niebla">{p.envio_a.nombre}<br />{p.envio_a.direccion}<br />{p.envio_a.ciudad}</p>
            <h2 className="mt-4 font-display text-xl font-bold">Pago</h2>
            <p className="text-niebla">{METODOS_PAGO[p.metodo_pago]}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
