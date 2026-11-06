/**
 * Widget del asistente Spot. Toda la inteligencia vive en el backend
 * (POST /api/chatbot/mensaje → router + BD + RAG + Claude). Aquí solo hay UI.
 */
import { Fragment, useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useStore } from '../context/Store';
import { api, ApiError } from '../lib/api';
import { dinero, local } from '../lib/format';
import { Link } from '../lib/router';
import type { Producto, SpotRespuesta } from '../lib/types';
import { IconCarrito, IconCerrar, IconEnviar, IconReiniciar, SpotMark } from './Icons';
import ProductArt from './ProductArt';
import { Disponibilidad } from './ProductCard';

interface Msg {
  id: string;
  rol: 'user' | 'assistant';
  texto: string;
  productos?: Producto[];
  fuentes?: SpotRespuesta['fuentes'];
  contingencia?: boolean;
  error?: boolean;
}

const CONV_KEY = 'ic_spot_conversacion';
const SUGERENCIAS = [
  '¿Tienen disponible la proteína Gold Standard de 5 libras?',
  '¿Cuál es la diferencia entre whey y caseína?',
  '¿Qué creatina es más barata?',
  '¿Cuánto cuesta el envío?',
];
const BIENVENIDA: Msg = {
  id: 'bienvenida',
  rol: 'assistant',
  texto: '¡Hola! Soy **Spot**, el asistente de IronCart. Puedo buscar productos con su precio y existencias reales, compararlos, explicarte diferencias entre suplementos, contarte cómo funcionan los envíos y pagos o revisar el estado de tus pedidos.\n\nNo doy consejos médicos ni dosis personalizadas: para eso, tu médico o nutricionista.',
};

const uid = () => Math.random().toString(36).slice(2);

/** Markdown mínimo y seguro: **negritas**, listas con "- " y saltos de línea. Sin HTML. */
function Rico({ texto }: { texto: string }) {
  const inline = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? <strong key={i} className="font-semibold text-hueso">{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>);
  const bloques: ReactNode[] = [];
  let lista: string[] = [];
  const flush = () => {
    if (lista.length) {
      bloques.push(<ul key={bloques.length} className="my-1.5 list-disc space-y-1 pl-5 marker:text-naranja">{lista.map((l, i) => <li key={i}>{inline(l)}</li>)}</ul>);
      lista = [];
    }
  };
  for (const linea of texto.split('\n')) {
    const m = linea.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)$/);
    if (m) { lista.push(m[1]); continue; }
    flush();
    if (linea.trim()) bloques.push(<p key={bloques.length} className="my-1">{inline(linea)}</p>);
  }
  flush();
  return <>{bloques}</>;
}

function TarjetaProducto({ p, onNavegar }: { p: Producto; onNavegar: () => void }) {
  const { agregar } = useStore();
  const [ok, setOk] = useState(false);
  return (
    <div className="flex gap-3 rounded-md border border-acero bg-hierro p-2.5">
      <div className="h-16 w-16 shrink-0 rounded bg-carbon"><ProductArt imagen={p.imagen} color={p.color} nombre={p.nombre} /></div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-lg font-bold leading-tight">{p.nombre}</p>
        <p className="truncate text-xs text-niebla">{p.marca}, {p.presentacion}</p>
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="font-display text-lg font-extrabold">{dinero(p.precio)}</span>
          <Disponibilidad stock={p.stock} className="text-xs" />
        </div>
        <div className="mt-1.5 flex gap-2">
          <Link to={`/producto/${p.slug}`} onClick={onNavegar} className="rounded border border-acero px-2.5 py-1 text-xs hover:border-hueso">Ver ficha</Link>
          <button type="button" disabled={p.stock <= 0 || ok}
            onClick={async () => { if (await agregar(p.id, 1, p.nombre)) setOk(true); }}
            className="inline-flex items-center gap-1 rounded bg-naranja px-2.5 py-1 text-xs font-semibold text-black disabled:opacity-50">
            <IconCarrito size={14} /> {ok ? 'Agregado' : p.stock <= 0 ? 'Agotado' : 'Agregar'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SpotWidget() {
  const { spotAbierto, abrirSpot, cerrarSpot, preguntaPendiente, consumirPregunta, usuario } = useStore();
  const [msgs, setMsgs] = useState<Msg[]>([BIENVENIDA]);
  const [texto, setTexto] = useState('');
  const [pensando, setPensando] = useState(false);
  const [estadoIA, setEstadoIA] = useState<'desconocido' | 'en_linea' | 'limitado'>('desconocido');
  const conv = useRef<string | null>(local.get(CONV_KEY));
  const cargado = useRef(false);
  const lista = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  // Al abrir por primera vez: estado del servicio + historial de la conversación guardada.
  useEffect(() => {
    if (!spotAbierto || cargado.current) return;
    cargado.current = true;
    api<{ ia: string; ok: boolean }>('/salud').then((s) => setEstadoIA(s.ok && s.ia === 'configurada' ? 'en_linea' : 'limitado')).catch(() => setEstadoIA('limitado'));
    if (conv.current) {
      api<{ conversacion_id: string | null; mensajes: Array<{ rol: 'user' | 'assistant'; contenido: string }> }>(`/chatbot/historial?conversacion_id=${conv.current}`)
        .then((h) => {
          if (h.mensajes.length) setMsgs([BIENVENIDA, ...h.mensajes.map((m) => ({ id: uid(), rol: m.rol, texto: m.contenido }))]);
          else { conv.current = null; local.del(CONV_KEY); }
        })
        .catch(() => {});
    }
  }, [spotAbierto]);

  // La sesión cambió: la conversación anterior pertenece a otro actor.
  const usuarioId = usuario?.id ?? null;
  const prevUsuario = useRef(usuarioId);
  useEffect(() => {
    if (prevUsuario.current !== usuarioId && prevUsuario.current !== null) {
      conv.current = null; local.del(CONV_KEY); setMsgs([BIENVENIDA]);
    }
    prevUsuario.current = usuarioId;
  }, [usuarioId]);

  useEffect(() => {
    lista.current?.scrollTo({ top: lista.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, pensando]);

  useEffect(() => {
    if (spotAbierto) window.setTimeout(() => input.current?.focus(), 50);
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') cerrarSpot(); };
    if (spotAbierto) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [spotAbierto, cerrarSpot]);

  const enviar = useCallback(async (contenido: string) => {
    const mensaje = contenido.trim();
    if (!mensaje || pensando) return;
    setTexto('');
    setMsgs((m) => [...m, { id: uid(), rol: 'user', texto: mensaje }]);
    setPensando(true);
    try {
      const r = await api<SpotRespuesta>('/chatbot/mensaje', { method: 'POST', body: { mensaje, conversacion_id: conv.current } });
      conv.current = r.conversacion_id;
      local.set(CONV_KEY, r.conversacion_id);
      setMsgs((m) => [...m, {
        id: uid(), rol: 'assistant', texto: r.respuesta, productos: r.productos, fuentes: r.fuentes,
        contingencia: r.meta.generador === 'plantilla_contingencia',
      }]);
      if (r.meta.generador === 'plantilla_contingencia') setEstadoIA('limitado');
      else if (r.meta.generador === 'claude') setEstadoIA('en_linea');
    } catch (e) {
      const err = e as ApiError;
      const texto = err.status === 429 ? err.message
        : err.status === 0 ? 'No pude conectarme. Revisa tu conexión a internet y vuelve a intentarlo.'
        : 'Tuve un problema para responder en este momento. Inténtalo de nuevo en unos segundos.';
      setMsgs((m) => [...m, { id: uid(), rol: 'assistant', texto, error: true }]);
    } finally {
      setPensando(false);
    }
  }, [pensando]);

  useEffect(() => {
    if (spotAbierto && preguntaPendiente) { enviar(preguntaPendiente); consumirPregunta(); }
  }, [spotAbierto, preguntaPendiente, enviar, consumirPregunta]);

  const reiniciar = () => {
    conv.current = null;
    local.del(CONV_KEY);
    setMsgs([BIENVENIDA]);
    setTexto('');
    input.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); enviar(texto); }
  };

  const soloBienvenida = msgs.length === 1;
  const cerrarEnMovil = () => { if (window.matchMedia('(max-width: 639px)').matches) cerrarSpot(); };

  return (
    <>
      {!spotAbierto && (
        <button type="button" onClick={() => abrirSpot()}
          className="fixed bottom-5 right-5 z-50 flex items-center gap-2.5 rounded-full bg-carbon py-2 pl-2 pr-5 shadow-2xl shadow-black/70 ring-1 ring-acero transition-transform hover:-translate-y-0.5 hover:ring-naranja"
          aria-label="Abrir el chat con Spot, asistente virtual">
          <SpotMark size={38} />
          <span className="text-left leading-tight">
            <span className="block font-display text-lg font-bold">Pregúntale a Spot</span>
            <span className="block text-xs text-niebla">Precios y stock en tiempo real</span>
          </span>
        </button>
      )}

      {spotAbierto && (
        <section role="dialog" aria-label="Chat con Spot" aria-modal="false"
          className="panel-spot fixed inset-0 z-50 flex flex-col bg-carbon sm:inset-auto sm:bottom-5 sm:right-5 sm:h-[min(680px,calc(100vh-2.5rem))] sm:w-[400px] sm:rounded-xl sm:shadow-2xl sm:shadow-black/80 sm:ring-1 sm:ring-acero">
          <header className="flex items-center gap-3 border-b border-grafito px-4 py-3">
            <SpotMark size={34} />
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-2xl font-extrabold leading-none">Spot</h2>
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-niebla">
                <span className={`h-2 w-2 rounded-full ${estadoIA === 'limitado' ? 'bg-alerta' : 'bg-lima'}`} aria-hidden="true" />
                {estadoIA === 'limitado' ? 'Modo limitado: respuestas sin IA' : 'En línea, asistente con IA (Claude)'}
              </p>
            </div>
            <button type="button" onClick={reiniciar} className="rounded-md p-2 text-niebla hover:bg-grafito hover:text-hueso" title="Nueva conversación" aria-label="Iniciar una conversación nueva">
              <IconReiniciar size={20} />
            </button>
            <button type="button" onClick={cerrarSpot} className="rounded-md p-2 text-niebla hover:bg-grafito hover:text-hueso" aria-label="Cerrar chat">
              <IconCerrar size={20} />
            </button>
          </header>

          <div ref={lista} className="flex-1 space-y-4 overflow-y-auto px-4 py-4" aria-live="polite">
            {msgs.map((m) => (
              <div key={m.id} className={m.rol === 'user' ? 'flex justify-end' : 'flex gap-2.5'}>
                {m.rol === 'assistant' && <div className="mt-1 shrink-0"><SpotMark size={24} /></div>}
                <div className={m.rol === 'user'
                  ? 'max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-naranja px-3.5 py-2 text-[0.95rem] text-black'
                  : `max-w-[88%] rounded-2xl rounded-tl-sm px-3.5 py-2 text-[0.95rem] text-hueso/90 ${m.error ? 'border border-error/50 bg-[#2a1616]' : 'bg-grafito'}`}>
                  {m.rol === 'assistant' ? <Rico texto={m.texto} /> : m.texto}
                  {!!m.productos?.length && (
                    <div className="mt-2.5 space-y-2">{m.productos.map((p) => <TarjetaProducto key={p.id} p={p} onNavegar={cerrarEnMovil} />)}</div>
                  )}
                  {!!m.fuentes?.length && (
                    <p className="mt-2 border-t border-acero pt-1.5 text-xs text-niebla">
                      Basado en: {m.fuentes.map((f) => f.titulo).join('; ')}
                    </p>
                  )}
                  {m.contingencia && <p className="mt-1.5 text-xs text-alerta">El servicio de IA no respondió; te muestro los datos directamente del catálogo.</p>}
                </div>
              </div>
            ))}
            {pensando && (
              <div className="flex gap-2.5" role="status" aria-label="Spot está escribiendo">
                <SpotMark size={24} />
                <div className="escribiendo flex items-center gap-1 rounded-2xl rounded-tl-sm bg-grafito px-4 py-3">
                  <span className="h-2 w-2 rounded-full bg-niebla" /><span className="h-2 w-2 rounded-full bg-niebla" /><span className="h-2 w-2 rounded-full bg-niebla" />
                </div>
              </div>
            )}
            {soloBienvenida && !pensando && (
              <div className="pl-9">
                <p className="mb-2 text-xs text-niebla">Prueba con:</p>
                <div className="flex flex-col items-start gap-2">
                  {SUGERENCIAS.map((s) => (
                    <button key={s} type="button" onClick={() => enviar(s)}
                      className="rounded-xl border border-acero px-3 py-1.5 text-left text-sm text-hueso/90 hover:border-naranja hover:text-hueso">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <form className="border-t border-grafito p-3" onSubmit={(e) => { e.preventDefault(); enviar(texto); }}>
            <div className="flex items-end gap-2 rounded-xl border border-acero bg-hierro p-1.5 focus-within:border-naranja">
              <label htmlFor="spot-input" className="sr-only">Escribe tu mensaje para Spot</label>
              <textarea
                id="spot-input" ref={input} rows={1} value={texto} maxLength={800}
                onChange={(e) => { setTexto(e.target.value); e.target.style.height = 'auto'; e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`; }}
                onKeyDown={onKeyDown}
                placeholder="Escribe tu pregunta…"
                className="max-h-[120px] flex-1 resize-none bg-transparent px-2 py-2 text-[0.95rem] placeholder:text-niebla/70 focus:outline-none"
              />
              <button type="submit" disabled={!texto.trim() || pensando} aria-label="Enviar mensaje"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-naranja text-black disabled:opacity-40">
                <IconEnviar size={20} />
              </button>
            </div>
            <p className="mt-1.5 px-1 text-[0.7rem] text-niebla">Spot puede equivocarse. Información general, no consejo médico. Enter para enviar, Shift+Enter para salto de línea.</p>
          </form>
        </section>
      )}
    </>
  );
}
