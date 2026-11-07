/**
 * Panel de administración (solo rol "admin"). Las mismas reglas se aplican en el
 * servidor: cada endpoint /api/admin/* verifica el rol, la interfaz solo las refleja.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../components/Layout';
import ProductArt from '../components/ProductArt';
import { useStore } from '../context/Store';
import { api, ApiError } from '../lib/api';
import { dinero, ESTADOS_PEDIDO, fecha } from '../lib/format';
import { Link, useQuery, useRouter } from '../lib/router';
import type { Pedido } from '../lib/types';

type Tab = 'resumen' | 'productos' | 'pedidos' | 'spot' | 'historial' | 'contacto';
const TABS: Array<[Tab, string]> = [
  ['resumen', 'Resumen'], ['productos', 'Productos'], ['pedidos', 'Pedidos'], ['spot', 'Conversaciones de Spot'],
  ['historial', 'Historial de cambios'], ['contacto', 'Mensajes de contacto'],
];

const RUTAS: Record<string, string> = {
  transaccional: 'Datos (precio y stock)', carrito: 'Carrito por chat', admin: 'Gestión (admin)', sin_permiso: 'Acción sin permiso', pedido: 'Estado de pedido', conocimiento: 'Conocimiento (RAG)',
  conversacion: 'Saludo / despedida', seguridad_medica: 'Seguridad médica', seguridad_inyeccion: 'Intento de inyección',
  seguridad_emergencia: 'Emergencia', fuera_de_dominio: 'Fuera de dominio', aclaracion: 'Pidió aclaración',
};
const esSeguridad = (r: string) => r.startsWith('seguridad') || r === 'fuera_de_dominio' || r === 'sin_permiso';

interface Resumen {
  tienda: { productos_activos: number; productos_inactivos: number; agotados: number; pocas_unidades: number; usuarios: number;
    pedidos: number; ventas_total: number; pedidos_por_estado: Record<string, number>; mensajes_contacto: number };
  spot: { conversaciones: number; mensajes_usuario: number; por_ruta: Array<{ ruta: string; n: number }>; medicas_interceptadas: number;
    inyecciones_detectadas: number; respuestas_claude: number; respuestas_contingencia: number; latencia_media_ms: number | null;
    latencia_p95_ms: number | null; confianza_media: number | null; por_dia: Array<{ dia: string; n: number }> };
}
interface ProdAdmin {
  id: number; slug: string; nombre: string; marca: string; categoria: string; presentacion: string; precio: number;
  precio_anterior: number | null; stock: number; activo: boolean; destacado: boolean; imagen: string; color: string; vendidos: number;
}
interface Turno {
  id: number; creado_en: string; mensaje: string; intent: string; ruta: string; confianza: number | null; fallback: boolean;
  seguridad: { medica: string[]; inyeccion: string[] } | null; respuesta: string | null; generador: string | null;
  latencia_ms: number | null; fuentes: string[] | null; con_sesion: boolean;
}
interface Contacto { id: number; nombre: string; email: string; asunto: string; mensaje: string; creado_en: string }

// ------------------------------------------------------------------ piezas
function Stat({ valor, etiqueta, nota }: { valor: string | number; etiqueta: string; nota?: string }) {
  return (
    <div className="rounded-lg bg-carbon p-4">
      <p className="font-display text-4xl font-extrabold leading-none">{valor}</p>
      <p className="mt-1.5 text-sm text-niebla">{etiqueta}</p>
      {nota && <p className="mt-1 text-xs text-niebla/80">{nota}</p>}
    </div>
  );
}

function Cargando({ error }: { error?: string | null }) {
  return error
    ? <p role="alert" className="rounded-md border border-error/50 bg-[#2a1616] p-4">{error}</p>
    : <p className="py-10 text-niebla" aria-busy="true">Cargando…</p>;
}

/** Barras verticales de una sola serie (mensajes por día) con tooltip por barra. */
function BarrasDia({ datos }: { datos: Array<{ dia: string; n: number }> }) {
  const max = Math.max(1, ...datos.map((d) => d.n));
  const fmt = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('es-NI', { day: 'numeric', month: 'short' });
  return (
    <figure>
      <figcaption className="font-display text-xl font-bold">Mensajes de usuarios por día</figcaption>
      <p className="text-sm text-niebla">Últimos 14 días. Pasa el cursor sobre una barra para ver el valor.</p>
      <div className="mt-4 flex h-40 items-end gap-[2px] border-b border-acero" role="img"
        aria-label={`Mensajes por día: ${datos.map((d) => `${fmt(d.dia)} ${d.n}`).join(', ')}`}>
        {datos.map((d) => (
          <div key={d.dia} className="group relative flex h-full flex-1 items-end" title={`${fmt(d.dia)}: ${d.n} mensajes`}>
            <div className="w-full rounded-t-[4px] bg-naranja transition-opacity group-hover:opacity-80" style={{ height: `${(d.n / max) * 100}%`, minHeight: d.n ? 2 : 0 }} />
            <span className="pointer-events-none absolute -top-7 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-hueso px-1.5 py-0.5 text-xs font-semibold text-black group-hover:block">
              {d.n}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-xs text-niebla">
        <span>{datos[0] && fmt(datos[0].dia)}</span><span>{datos.at(-1) && fmt(datos.at(-1)!.dia)}</span>
      </div>
    </figure>
  );
}

/** Barras horizontales con etiqueta y valor directos (distribución por ruta). */
function BarrasRuta({ datos }: { datos: Array<{ ruta: string; n: number }> }) {
  const total = datos.reduce((s, d) => s + d.n, 0) || 1;
  const max = Math.max(1, ...datos.map((d) => d.n));
  return (
    <figure>
      <figcaption className="font-display text-xl font-bold">Mensajes por ruta del router</figcaption>
      <p className="text-sm text-niebla">Cómo clasificó Spot cada mensaje (datos, RAG o seguridad).</p>
      <ul className="mt-4 space-y-2.5">
        {datos.map((d) => (
          <li key={d.ruta} className="grid grid-cols-[minmax(0,11rem)_1fr_auto] items-center gap-3 text-sm" title={`${RUTAS[d.ruta] ?? d.ruta}: ${d.n} (${Math.round((d.n / total) * 100)} %)`}>
            <span className="truncate text-hueso/90">{RUTAS[d.ruta] ?? d.ruta}</span>
            <span className="h-3 overflow-hidden rounded-sm bg-grafito">
              <span className="block h-full rounded-r-[4px] bg-naranja" style={{ width: `${(d.n / max) * 100}%` }} />
            </span>
            <span className="w-24 whitespace-nowrap text-right tabular-nums text-niebla">{d.n} · {Math.round((d.n / total) * 100)} %</span>
          </li>
        ))}
        {datos.length === 0 && <li className="text-niebla">Aún no hay mensajes.</li>}
      </ul>
    </figure>
  );
}

// ------------------------------------------------------------------ pestañas
function TabResumen() {
  const [r, setR] = useState<Resumen | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api<Resumen>('/admin/resumen').then(setR).catch((e) => setError(e.message)); }, []);
  if (!r) return <Cargando error={error} />;
  const { tienda: t, spot: s } = r;
  const totalResp = s.respuestas_claude + s.respuestas_contingencia;
  return (
    <div className="space-y-12">
      <section aria-labelledby="t-tienda">
        <h2 id="t-tienda" className="text-3xl font-extrabold">Tienda</h2>
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat valor={dinero(t.ventas_total)} etiqueta="Ventas de demostración" nota="Sin pedidos cancelados" />
          <Stat valor={t.pedidos} etiqueta="Pedidos" nota={Object.entries(t.pedidos_por_estado).map(([k, n]) => `${ESTADOS_PEDIDO[k] ?? k}: ${n}`).join(', ') || undefined} />
          <Stat valor={t.usuarios} etiqueta="Cuentas registradas" />
          <Stat valor={t.productos_activos} etiqueta="Productos activos" nota={`${t.agotados} agotados, ${t.pocas_unidades} con 5 o menos${t.productos_inactivos ? `, ${t.productos_inactivos} inactivos` : ''}`} />
        </div>
      </section>
      <section aria-labelledby="t-spot">
        <h2 id="t-spot" className="text-3xl font-extrabold">Spot</h2>
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat valor={s.mensajes_usuario} etiqueta="Mensajes de usuarios" nota={`${s.conversaciones} conversaciones`} />
          <Stat valor={totalResp ? `${Math.round((s.respuestas_claude / totalResp) * 100)} %` : '—'} etiqueta="Respuestas generadas por Claude" nota={`${s.respuestas_contingencia} en modo de contingencia`} />
          <Stat valor={s.medicas_interceptadas} etiqueta="Consultas médicas interceptadas" nota={`${s.inyecciones_detectadas} intentos de inyección detectados`} />
          <Stat valor={s.latencia_media_ms != null ? `${(s.latencia_media_ms / 1000).toFixed(1)} s` : '—'} etiqueta="Latencia media del servidor"
            nota={s.latencia_p95_ms != null ? `p95: ${(s.latencia_p95_ms / 1000).toFixed(1)} s · confianza NLU media ${s.confianza_media ?? '—'}` : undefined} />
        </div>
        <div className="mt-8 grid gap-10 lg:grid-cols-2">
          <div className="rounded-lg bg-carbon p-5"><BarrasDia datos={s.por_dia} /></div>
          <div className="rounded-lg bg-carbon p-5"><BarrasRuta datos={s.por_ruta} /></div>
        </div>
      </section>
    </div>
  );
}

function TabProductos() {
  const { avisar } = useStore();
  const [lista, setLista] = useState<ProdAdmin[] | null>(null);
  const [edit, setEdit] = useState<Record<number, Partial<Record<'precio' | 'precio_anterior' | 'stock', string>> & { activo?: boolean; destacado?: boolean }>>({});
  const [filtro, setFiltro] = useState('');
  const [guardando, setGuardando] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api<ProdAdmin[]>('/admin/productos').then(setLista).catch((e) => setError(e.message)); }, []);

  const visibles = useMemo(() => {
    const f = filtro.trim().toLowerCase();
    return (lista ?? []).filter((p) => !f || `${p.nombre} ${p.marca} ${p.categoria} ${p.presentacion}`.toLowerCase().includes(f));
  }, [lista, filtro]);

  if (!lista) return <Cargando error={error} />;

  const val = (p: ProdAdmin, k: 'precio' | 'precio_anterior' | 'stock') => edit[p.id]?.[k] ?? (p[k] === null ? '' : String(p[k]));
  const setVal = (id: number, k: string, v: string | boolean) => setEdit((e) => ({ ...e, [id]: { ...e[id], [k]: v } }));
  const sucio = (id: number) => !!edit[id] && Object.keys(edit[id]).length > 0;

  const guardar = async (p: ProdAdmin) => {
    const e = edit[p.id] ?? {};
    const body: Record<string, unknown> = {};
    if (e.precio !== undefined) body.precio = Number(e.precio);
    if (e.precio_anterior !== undefined) body.precio_anterior = e.precio_anterior === '' ? null : Number(e.precio_anterior);
    if (e.stock !== undefined) body.stock = Number(e.stock);
    if (e.activo !== undefined) body.activo = e.activo;
    if (e.destacado !== undefined) body.destacado = e.destacado;
    setGuardando(p.id);
    try {
      const nuevo = await api<ProdAdmin>(`/admin/productos/${p.id}`, { method: 'PATCH', body });
      setLista((l) => (l ?? []).map((x) => (x.id === p.id ? nuevo : x)));
      setEdit((ed) => { const c = { ...ed }; delete c[p.id]; return c; });
      avisar(`${p.nombre} (${p.presentacion}) actualizado.`);
    } catch (err) {
      avisar((err as ApiError).message, 'error');
    } finally {
      setGuardando(null);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="adm-filtro" className="sr-only">Filtrar productos</label>
        <input id="adm-filtro" className="campo max-w-xs py-2" placeholder="Filtrar por nombre, marca o categoría" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
        <p className="text-sm text-niebla">{visibles.length} de {lista.length} productos. Los cambios se aplican al catálogo y a Spot al guardar.</p>
      </div>
      <div className="relative mt-4 overflow-x-auto rounded-lg border border-grafito">
        <table className="w-full min-w-[920px] text-left text-sm">
          <thead className="bg-carbon text-niebla">
            <tr>
              <th scope="col" className="px-3 py-2.5 font-medium">Producto</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Precio (USD)</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Precio anterior</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Stock</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Vendidos</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Activo</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Destacado</th>
              <th scope="col" className="px-3 py-2.5"><span className="sr-only">Acciones</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-grafito">
            {visibles.map((p) => (
              <tr key={p.id} className={p.activo ? '' : 'opacity-60'}>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 shrink-0 rounded bg-carbon"><ProductArt imagen={p.imagen} color={p.color} nombre={p.nombre} /></div>
                    <div className="min-w-0">
                      <Link to={`/producto/${p.slug}`} className="font-semibold hover:text-naranja">{p.nombre}</Link>
                      <p className="text-xs text-niebla">{p.marca} · {p.presentacion} · {p.categoria}</p>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2"><input aria-label={`Precio de ${p.nombre} ${p.presentacion}`} type="number" min="0.01" step="0.01" className="campo w-24 px-2 py-1.5" value={val(p, 'precio')} onChange={(e) => setVal(p.id, 'precio', e.target.value)} /></td>
                <td className="px-3 py-2"><input aria-label={`Precio anterior de ${p.nombre} ${p.presentacion}`} type="number" min="0.01" step="0.01" placeholder="—" className="campo w-24 px-2 py-1.5" value={val(p, 'precio_anterior')} onChange={(e) => setVal(p.id, 'precio_anterior', e.target.value)} /></td>
                <td className="px-3 py-2">
                  <input aria-label={`Stock de ${p.nombre} ${p.presentacion}`} type="number" min="0" step="1" className={`campo w-20 px-2 py-1.5 ${Number(val(p, 'stock')) === 0 ? 'border-error/60' : Number(val(p, 'stock')) <= 5 ? 'border-alerta/60' : ''}`} value={val(p, 'stock')} onChange={(e) => setVal(p.id, 'stock', e.target.value)} />
                </td>
                <td className="px-3 py-2 tabular-nums text-niebla">{p.vendidos}</td>
                <td className="px-3 py-2"><input aria-label={`${p.nombre} activo`} type="checkbox" className="h-4 w-4 accent-[#ff5b14]" checked={edit[p.id]?.activo ?? p.activo} onChange={(e) => setVal(p.id, 'activo', e.target.checked)} /></td>
                <td className="px-3 py-2"><input aria-label={`${p.nombre} destacado`} type="checkbox" className="h-4 w-4 accent-[#ff5b14]" checked={edit[p.id]?.destacado ?? p.destacado} onChange={(e) => setVal(p.id, 'destacado', e.target.checked)} /></td>
                <td className="px-3 py-2 text-right">
                  <button type="button" disabled={!sucio(p.id) || guardando === p.id} onClick={() => guardar(p)} className="btn-primario px-3 py-1.5 text-sm">
                    {guardando === p.id ? 'Guardando…' : 'Guardar'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TabPedidos() {
  const { avisar } = useStore();
  const [estado, setEstado] = useState('');
  const [lista, setLista] = useState<Array<Pedido & { cliente: { nombre: string; email: string } }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cargar = useCallback(() => {
    setLista(null);
    api<Array<Pedido & { cliente: { nombre: string; email: string } }>>(`/admin/pedidos${estado ? `?estado=${estado}` : ''}`).then(setLista).catch((e) => setError(e.message));
  }, [estado]);
  useEffect(cargar, [cargar]);

  const cambiar = async (numero: number, nuevo: string) => {
    try {
      const p = await api<Pedido>(`/admin/pedidos/${numero}`, { method: 'PATCH', body: { estado: nuevo } });
      setLista((l) => (l ?? []).map((x) => (x.numero === numero ? { ...x, ...p } : x)));
      avisar(`Pedido #${numero}: ${ESTADOS_PEDIDO[nuevo]}.`);
    } catch (err) {
      avisar((err as ApiError).message, 'error');
    }
  };

  return (
    <div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por estado">
        <button type="button" className="chip-filtro" aria-pressed={!estado} onClick={() => setEstado('')}>Todos</button>
        {Object.entries(ESTADOS_PEDIDO).map(([k, t]) => (
          <button key={k} type="button" className="chip-filtro" aria-pressed={estado === k} onClick={() => setEstado(k)}>{t}</button>
        ))}
      </div>
      <p className="mt-3 text-sm text-niebla">Al cambiar el estado, el cliente lo ve en "Mis pedidos" y Spot lo informa cuando pregunta.</p>
      {!lista ? <Cargando error={error} /> : (
        <div className="relative mt-4 overflow-x-auto rounded-lg border border-grafito">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="bg-carbon text-niebla">
              <tr>
                <th scope="col" className="px-3 py-2.5 font-medium">Pedido</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Cliente</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Productos</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Total</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Envío a</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-grafito">
              {lista.map((p) => (
                <tr key={p.numero}>
                  <td className="px-3 py-2.5"><p className="font-display text-xl font-bold">#{p.numero}</p><p className="text-xs text-niebla">{fecha(p.creado_en)}</p></td>
                  <td className="px-3 py-2.5"><p>{p.cliente.nombre}</p><p className="text-xs text-niebla">{p.cliente.email}</p></td>
                  <td className="px-3 py-2.5 text-niebla">{p.items.map((i) => `${i.cantidad} × ${i.nombre}`).join(', ')}</td>
                  <td className="px-3 py-2.5 tabular-nums">{dinero(p.total)}</td>
                  <td className="px-3 py-2.5 text-niebla">{p.envio_a.ciudad}</td>
                  <td className="px-3 py-2.5">
                    <label className="sr-only" htmlFor={`est-${p.numero}`}>Estado del pedido {p.numero}</label>
                    <select id={`est-${p.numero}`} value={p.estado} onChange={(e) => cambiar(p.numero, e.target.value)} className="campo w-auto py-1.5 text-sm">
                      {Object.entries(ESTADOS_PEDIDO).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
              {lista.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-niebla">No hay pedidos con este estado.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function TabSpot() {
  const [ruta, setRuta] = useState('');
  const [lista, setLista] = useState<Turno[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setLista(null);
    api<Turno[]>(`/admin/conversaciones${ruta ? `?ruta=${ruta}` : ''}`).then(setLista).catch((e) => setError(e.message));
  }, [ruta]);
  return (
    <div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por ruta">
        <button type="button" className="chip-filtro" aria-pressed={!ruta} onClick={() => setRuta('')}>Todas</button>
        {Object.entries(RUTAS).map(([k, t]) => (
          <button key={k} type="button" className="chip-filtro" aria-pressed={ruta === k} onClick={() => setRuta(k)}>{t}</button>
        ))}
      </div>
      <p className="mt-3 text-sm text-niebla">Últimos 150 mensajes. Úsalos para revisar respuestas y ampliar el corpus de intenciones.</p>
      {!lista ? <Cargando error={error} /> : (
        <ul className="mt-4 space-y-3">
          {lista.map((t) => (
            <li key={t.id} className="rounded-lg bg-carbon p-4">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-niebla">
                <span className={`rounded px-2 py-0.5 font-semibold ${esSeguridad(t.ruta) ? 'bg-alerta/15 text-alerta' : 'bg-grafito text-hueso'}`}>{RUTAS[t.ruta] ?? t.ruta}</span>
                <span>Intención: {t.intent} ({t.confianza ?? '—'})</span>
                <span>{t.generador === 'claude' ? 'Claude' : t.generador === 'plantilla_contingencia' ? 'Contingencia (sin IA)' : t.generador ?? '—'}</span>
                {t.latencia_ms != null && <span>{t.latencia_ms} ms</span>}
                <span>{t.con_sesion ? 'Con sesión' : 'Anónimo'}</span>
                <span className="ml-auto">{new Date(t.creado_en).toLocaleString('es-NI')}</span>
              </div>
              <p className="mt-2 font-semibold">“{t.mensaje}”</p>
              {(t.seguridad?.medica?.length || t.seguridad?.inyeccion?.length) ? (
                <p className="mt-1 text-xs text-alerta">Reglas activadas: {[...(t.seguridad?.medica ?? []), ...(t.seguridad?.inyeccion ?? [])].join(', ')}</p>
              ) : null}
              {t.respuesta && (
                <details className="mt-2 text-sm text-hueso/85">
                  <summary className="cursor-pointer text-niebla hover:text-hueso">Ver respuesta de Spot{t.fuentes?.length ? ` (fuentes: ${t.fuentes.join(', ')})` : ''}</summary>
                  <p className="mt-2 whitespace-pre-wrap">{t.respuesta}</p>
                </details>
              )}
            </li>
          ))}
          {lista.length === 0 && <li className="text-niebla">No hay mensajes en esta ruta.</li>}
        </ul>
      )}
    </div>
  );
}

interface Auditoria {
  id: number; creado_en: string; origen: 'spot' | 'panel'; entidad: string; entidad_ref: string; operacion: string;
  antes: Record<string, unknown> | null; despues: Record<string, unknown> | null; usuario: string | null;
}
const OPERACION: Record<string, string> = { crear: 'Creó', actualizar: 'Modificó', eliminar: 'Eliminó', desactivar: 'Desactivó', estado_pedido: 'Cambió estado de' };
const valorCorto = (v: unknown) => v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v).slice(0, 60) : String(v).slice(0, 60);

function TabHistorial() {
  const [lista, setLista] = useState<Auditoria[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api<Auditoria[]>('/admin/auditoria').then(setLista).catch((e) => setError(e.message)); }, []);
  if (!lista) return <Cargando error={error} />;
  if (lista.length === 0) return <p className="py-10 text-niebla">Todavía no hay cambios registrados.</p>;
  return (
    <div className="relative overflow-x-auto rounded-lg border border-grafito">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="bg-carbon text-niebla">
          <tr>
            <th scope="col" className="px-3 py-2.5 font-medium">Fecha</th>
            <th scope="col" className="px-3 py-2.5 font-medium">Origen</th>
            <th scope="col" className="px-3 py-2.5 font-medium">Cambio</th>
            <th scope="col" className="px-3 py-2.5 font-medium">Detalle</th>
            <th scope="col" className="px-3 py-2.5 font-medium">Usuario</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-grafito">
          {lista.map((a) => {
            const campos = a.operacion === 'actualizar' || a.operacion === 'estado_pedido' ? Object.keys(a.despues ?? {}) : [];
            return (
              <tr key={a.id}>
                <td className="whitespace-nowrap px-3 py-2.5 text-niebla">{new Date(a.creado_en).toLocaleString('es-NI')}</td>
                <td className="px-3 py-2.5"><span className={`rounded px-2 py-0.5 text-xs font-semibold ${a.origen === 'spot' ? 'bg-naranja/15 text-naranja' : 'bg-grafito text-hueso'}`}>{a.origen === 'spot' ? 'Spot (IA)' : 'Panel'}</span></td>
                <td className="px-3 py-2.5">{OPERACION[a.operacion] ?? a.operacion} {a.entidad === 'pedido' ? `pedido #${a.entidad_ref}` : a.entidad_ref}</td>
                <td className="px-3 py-2.5 text-niebla">
                  {campos.length ? campos.map((k) => <div key={k}>{k}: {valorCorto(a.antes?.[k])} → <span className="text-hueso">{valorCorto(a.despues?.[k])}</span></div>)
                    : a.operacion === 'crear' ? `Precio ${valorCorto(a.despues?.precio)}, stock ${valorCorto(a.despues?.stock)}` : '—'}
                </td>
                <td className="px-3 py-2.5 text-niebla">{a.usuario ?? '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TabContacto() {
  const [lista, setLista] = useState<Contacto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api<Contacto[]>('/admin/contactos').then(setLista).catch((e) => setError(e.message)); }, []);
  if (!lista) return <Cargando error={error} />;
  if (lista.length === 0) return <p className="py-10 text-niebla">Todavía no hay mensajes del formulario de contacto.</p>;
  return (
    <ul className="space-y-3">
      {lista.map((c) => (
        <li key={c.id} className="rounded-lg bg-carbon p-4">
          <div className="flex flex-wrap justify-between gap-2">
            <p className="font-display text-xl font-bold">{c.asunto}</p>
            <p className="text-xs text-niebla">{new Date(c.creado_en).toLocaleString('es-NI')}</p>
          </div>
          <p className="text-sm text-niebla">{c.nombre} · <a className="underline hover:text-hueso" href={`mailto:${c.email}`}>{c.email}</a></p>
          <p className="mt-2 whitespace-pre-wrap text-hueso/90">{c.mensaje}</p>
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------------ página
export default function Admin() {
  const { usuario, cargandoSesion } = useStore();
  const q = useQuery();
  const { navigate } = useRouter();
  const tab = (TABS.find(([k]) => k === q.get('tab'))?.[0] ?? 'resumen') as Tab;
  useEffect(() => { document.title = 'Administración · IronCart'; }, []);

  if (cargandoSesion) return <div className="contenedor py-24 text-niebla">Cargando…</div>;
  if (!usuario) {
    return (
      <div className="contenedor max-w-xl py-24 text-center">
        <h1 className="text-6xl font-extrabold">Administración</h1>
        <p className="mt-3 text-niebla">Inicia sesión con una cuenta de administrador.</p>
        <Link to="/cuenta?volver=/admin" className="btn-primario mt-8">Iniciar sesión</Link>
      </div>
    );
  }
  if (usuario.rol !== 'admin') {
    return (
      <div className="contenedor max-w-xl py-24 text-center">
        <h1 className="text-6xl font-extrabold">Sin acceso</h1>
        <p className="mt-3 text-niebla">Esta sección es solo para administradores. Tu cuenta ({usuario.email}) es de cliente.</p>
        <Link to="/" className="btn-secundario mt-8">Volver a la tienda</Link>
      </div>
    );
  }

  return (
    <>
      <PageHeader titulo="Administración">Gestiona el catálogo, los pedidos y revisa cómo responde Spot.</PageHeader>
      <div className="contenedor">
        <div className="-mx-1 flex gap-1 overflow-x-auto border-b border-grafito px-1" role="tablist" aria-label="Secciones del panel">
          {TABS.map(([k, t]) => (
            <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => navigate(`/admin?tab=${k}`, { replace: true })}
              className={`whitespace-nowrap border-b-2 px-4 py-3 text-[0.95rem] ${tab === k ? 'border-naranja text-hueso' : 'border-transparent text-niebla hover:text-hueso'}`}>
              {t}
            </button>
          ))}
        </div>
        <div className="py-8" role="tabpanel">
          {tab === 'resumen' && <TabResumen />}
          {tab === 'productos' && <TabProductos />}
          {tab === 'pedidos' && <TabPedidos />}
          {tab === 'spot' && <TabSpot />}
          {tab === 'historial' && <TabHistorial />}
          {tab === 'contacto' && <TabContacto />}
        </div>
      </div>
    </>
  );
}
