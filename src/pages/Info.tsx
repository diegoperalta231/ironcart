import { useEffect, useState, type FormEvent } from 'react';
import { IconCheck, IconMail, IconReloj, IconUbicacion, SpotMark } from '../components/Icons';
import { PageHeader } from '../components/Layout';
import { useStore } from '../context/Store';
import { api, ApiError } from '../lib/api';
import { Link, useQuery, useRouter } from '../lib/router';

// ============================================================== Cuenta
export function Account() {
  const { usuario, login, registro, logout } = useStore();
  const q = useQuery();
  const { navigate } = useRouter();
  const [modo, setModo] = useState<'login' | 'registro'>(q.get('modo') === 'registro' ? 'registro' : 'login');
  const [f, setF] = useState({ nombre: '', email: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const volver = q.get('volver');
  const destino = volver && volver.startsWith('/') && !volver.startsWith('//') ? volver : '/pedidos';

  useEffect(() => { document.title = (modo === 'login' ? 'Iniciar sesión' : 'Crear cuenta') + ' · IronCart'; }, [modo]);

  if (usuario) {
    return (
      <div className="contenedor max-w-lg py-24">
        <h1 className="text-6xl font-extrabold">Hola, {usuario.nombre.split(' ')[0]}</h1>
        <p className="mt-2 text-niebla">Sesión iniciada como {usuario.email}.</p>
        <div className="mt-8 flex gap-3">
          <Link to="/pedidos" className="btn-primario">Mis pedidos</Link>
          <button type="button" onClick={logout} className="btn-secundario">Cerrar sesión</button>
        </div>
      </div>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setEnviando(true); setError(null);
    try {
      if (modo === 'login') await login(f.email, f.password); else await registro(f.nombre, f.email, f.password);
      navigate(destino, { replace: true });
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="contenedor grid max-w-5xl gap-12 py-16 md:grid-cols-2">
      <div>
        <h1 className="text-6xl font-extrabold">{modo === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}</h1>
        <div className="mt-6 inline-flex rounded-md border border-acero p-1" role="tablist">
          {(['login', 'registro'] as const).map((m) => (
            <button key={m} role="tab" type="button" aria-selected={modo === m} onClick={() => { setModo(m); setError(null); }}
              className={`rounded px-4 py-2 text-[0.95rem] ${modo === m ? 'bg-hueso text-black' : 'text-niebla hover:text-hueso'}`}>
              {m === 'login' ? 'Ya tengo cuenta' : 'Soy nuevo'}
            </button>
          ))}
        </div>
        <form onSubmit={submit} className="mt-8 space-y-4">
          {modo === 'registro' && (
            <div>
              <label htmlFor="a-nombre" className="etiqueta">Nombre</label>
              <input id="a-nombre" className="campo" required minLength={2} maxLength={80} autoComplete="name" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} />
            </div>
          )}
          <div>
            <label htmlFor="a-email" className="etiqueta">Correo electrónico</label>
            <input id="a-email" type="email" className="campo" required maxLength={120} autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          </div>
          <div>
            <label htmlFor="a-pass" className="etiqueta">Contraseña</label>
            <input id="a-pass" type="password" className="campo" required minLength={8} maxLength={72}
              autoComplete={modo === 'login' ? 'current-password' : 'new-password'} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
            {modo === 'registro' && <p className="mt-1 text-sm text-niebla">Mínimo 8 caracteres.</p>}
          </div>
          {error && <p role="alert" className="rounded-md border border-error/50 bg-[#2a1616] p-3 text-sm">{error}</p>}
          <button type="submit" disabled={enviando} className="btn-primario w-full py-3.5 text-xl">
            {enviando ? 'Un momento…' : modo === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}
          </button>
        </form>
      </div>
      <aside className="facts h-fit self-center">
        <p className="facts-titulo">Cuenta de demostración</p>
        <div className="facts-regla-gruesa" />
        <p className="text-sm">Para probar el historial y el estado de pedidos (incluido el pedido #12345) puedes usar:</p>
        <div className="facts-fila mt-2"><span className="font-semibold">Correo</span><span>demo@ironcart.dev</span></div>
        <div className="facts-fila"><span className="font-semibold">Contraseña</span><span>IronCart2026!</span></div>
        <button type="button" className="mt-4 w-full rounded-md bg-hueso py-2.5 font-display text-lg font-bold text-black hover:bg-white"
          onClick={() => { setModo('login'); setF({ nombre: '', email: 'demo@ironcart.dev', password: 'IronCart2026!' }); }}>
          Rellenar con la cuenta demo
        </button>
        <p className="mt-3 text-xs">Tu contraseña se guarda cifrada con bcrypt. Solo pedimos nombre y correo.</p>
      </aside>
    </div>
  );
}

// ============================================================== Nosotros
export function About() {
  const { abrirSpot } = useStore();
  useEffect(() => { document.title = 'Nosotros · IronCart'; }, []);
  const politicas = [
    { t: 'Envíos', d: 'Costo de $5.99 por pedido y gratis desde $75. De 1 a 2 días hábiles en Managua y de 2 a 5 en el resto de Nicaragua (envíos de demostración).' },
    { t: 'Pagos', d: 'Tarjeta, transferencia o contra entrega, todos simulados. Nunca pedimos datos bancarios y no se realizan cobros.' },
    { t: 'Cambios y devoluciones', d: 'Hasta 30 días después de la entrega con el producto cerrado y sellado. Si llega dañado, vencido o equivocado, avísanos en 7 días y lo reponemos.' },
    { t: 'Salud', d: 'Nuestra información es general. Spot no diagnostica, no prescribe ni recomienda dosis personalizadas: consulta a tu médico o nutricionista.' },
    { t: 'Privacidad', d: 'Solo guardamos los datos mínimos para tu cuenta y tus envíos. Los pedidos solo los ve la cuenta que los realizó.' },
  ];
  return (
    <>
      <PageHeader titulo="Nosotros">
        IronCart es una tienda de suplementos deportivos pensada para que compres con información clara y una atención disponible a cualquier hora.
      </PageHeader>
      <div className="contenedor grid gap-14 lg:grid-cols-2">
        <div className="max-w-prose space-y-5 text-lg text-hueso/85">
          <p>
            Comprar suplementos en línea suele implicar fichas incompletas, foros contradictorios y nadie a quien preguntar.
            IronCart reúne el catálogo, el carrito y los pedidos en un solo lugar, y suma a Spot, un asistente con inteligencia artificial.
          </p>
          <p>
            Spot sigue una arquitectura híbrida: cuando preguntas por precios, existencias o pedidos, consulta la base de datos;
            cuando preguntas qué es la creatina o cómo funcionan los envíos, busca en una base de conocimiento curada con fuentes citadas;
            y cuando la pregunta es médica o está fuera de su alcance, te lo dice con claridad. Claude, de Anthropic, solo redacta la respuesta final.
          </p>
          <p className="rounded-md border border-acero p-4 text-base text-niebla">
            IronCart es un proyecto académico. Los productos, precios, existencias y pedidos son ficticios; las marcas pertenecen a sus dueños y se usan solo como ejemplo de catálogo.
          </p>
          <button type="button" onClick={() => abrirSpot('¿Qué puedes hacer, Spot?')} className="btn-secundario"><SpotMark size={22} /> Conocer a Spot</button>
        </div>
        <section id="politicas" aria-labelledby="t-pol" className="scroll-mt-24">
          <h2 id="t-pol" className="text-5xl font-extrabold">Políticas de la tienda</h2>
          <dl className="mt-6 divide-y divide-grafito border-y border-grafito">
            {politicas.map((p) => (
              <div key={p.t} className="py-5">
                <dt className="font-display text-2xl font-bold">{p.t}</dt>
                <dd className="mt-1 text-niebla">{p.d}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </>
  );
}

// ============================================================== Contacto
export function Contact() {
  const [f, setF] = useState({ nombre: '', email: '', asunto: '', mensaje: '' });
  const [estado, setEstado] = useState<'idle' | 'enviando' | 'ok'>('idle');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { document.title = 'Contacto · IronCart'; }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setEstado('enviando'); setError(null);
    try {
      await api('/contacto', { method: 'POST', body: f });
      setEstado('ok');
      setF({ nombre: '', email: '', asunto: '', mensaje: '' });
    } catch (err) {
      setError((err as ApiError).message); setEstado('idle');
    }
  };

  return (
    <>
      <PageHeader titulo="Contacto">¿Tienes una consulta sobre un pedido o un producto? Escríbenos y te respondemos en un máximo de 24 horas hábiles.</PageHeader>
      <div className="contenedor grid gap-12 lg:grid-cols-[1.4fr_1fr]">
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="c-nombre" className="etiqueta">Nombre</label>
            <input id="c-nombre" className="campo" required minLength={2} maxLength={80} value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} />
          </div>
          <div>
            <label htmlFor="c-email" className="etiqueta">Correo electrónico</label>
            <input id="c-email" type="email" className="campo" required maxLength={120} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="c-asunto" className="etiqueta">Asunto</label>
            <input id="c-asunto" className="campo" required minLength={3} maxLength={120} value={f.asunto} onChange={(e) => setF({ ...f, asunto: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="c-msg" className="etiqueta">Mensaje</label>
            <textarea id="c-msg" className="campo min-h-40" required minLength={10} maxLength={2000} value={f.mensaje} onChange={(e) => setF({ ...f, mensaje: e.target.value })} />
          </div>
          {error && <p role="alert" className="rounded-md border border-error/50 bg-[#2a1616] p-3 text-sm sm:col-span-2">{error}</p>}
          {estado === 'ok' && (
            <p role="status" className="flex items-center gap-2 rounded-md border border-lima/50 bg-lima/10 p-3 sm:col-span-2">
              <IconCheck size={20} className="text-lima" /> Mensaje enviado. Te responderemos pronto.
            </p>
          )}
          <div className="sm:col-span-2">
            <button type="submit" disabled={estado === 'enviando'} className="btn-primario px-8">{estado === 'enviando' ? 'Enviando…' : 'Enviar mensaje'}</button>
          </div>
        </form>
        <ul className="space-y-6 text-lg">
          <li className="flex gap-3"><IconMail className="mt-1 shrink-0 text-naranja" /><div><p className="font-display text-2xl font-bold">Correo</p><p className="text-niebla">soporte@ironcart.dev (demostración)</p></div></li>
          <li className="flex gap-3"><IconReloj className="mt-1 shrink-0 text-naranja" /><div><p className="font-display text-2xl font-bold">Horario</p><p className="text-niebla">Lunes a viernes de 8:00 a 18:00 y sábados de 9:00 a 13:00. Spot responde las 24 horas.</p></div></li>
          <li className="flex gap-3"><IconUbicacion className="mt-1 shrink-0 text-naranja" /><div><p className="font-display text-2xl font-bold">Ubicación</p><p className="text-niebla">Managua, Nicaragua. Tienda solo en línea.</p></div></li>
        </ul>
      </div>
    </>
  );
}

export function NotFound() {
  useEffect(() => { document.title = 'Página no encontrada · IronCart'; }, []);
  return (
    <div className="contenedor py-28 text-center">
      <p className="font-display text-[8rem] font-extrabold italic leading-none text-naranja">404</p>
      <h1 className="text-5xl font-extrabold">Esta página no existe</h1>
      <p className="mt-3 text-niebla">Revisa la dirección o vuelve al catálogo.</p>
      <Link to="/" className="btn-primario mt-8">Ir al inicio</Link>
    </div>
  );
}
