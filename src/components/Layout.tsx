import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useStore } from '../context/Store';
import { Link, useRouter } from '../lib/router';
import {
  IconBuscar, IconCarrito, IconCerrar, IconFacebook, IconInstagram, IconMail, IconMenu, IconReloj, IconTiktok,
  IconUbicacion, IconUsuario, Logo,
} from './Icons';

const NAV = [
  { to: '/', label: 'Inicio' },
  { to: '/productos', label: 'Productos' },
  { to: '/categorias', label: 'Categorías' },
  { to: '/nosotros', label: 'Nosotros' },
  { to: '/contacto', label: 'Contacto' },
];

function Buscador({ onDone, autoFocus = false }: { onDone?: () => void; autoFocus?: boolean }) {
  const { navigate, loc } = useRouter();
  const [q, setQ] = useState(() => (loc.pathname === '/productos' ? new URLSearchParams(loc.search).get('q') ?? '' : ''));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    navigate(q.trim() ? `/productos?q=${encodeURIComponent(q.trim())}` : '/productos');
    onDone?.();
  };
  return (
    <form role="search" onSubmit={submit} className="relative w-full">
      <label htmlFor="buscar" className="sr-only">Buscar productos</label>
      <input
        id="buscar" type="search" value={q} onChange={(e) => setQ(e.target.value)} autoFocus={autoFocus}
        placeholder="Buscar proteína, creatina, marca…" maxLength={80}
        className="w-full rounded-md border border-acero bg-carbon py-2.5 pl-10 pr-3 text-[0.95rem] placeholder:text-niebla/70 focus:border-naranja focus:outline-none"
      />
      <IconBuscar size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-niebla" />
    </form>
  );
}

function Cuenta() {
  const { usuario, logout } = useStore();
  const [abierto, setAbierto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const cerrar = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setAbierto(false); };
    document.addEventListener('click', cerrar);
    return () => document.removeEventListener('click', cerrar);
  }, []);
  if (!usuario) {
    return (
      <Link to="/cuenta" className="flex items-center gap-2 rounded-md p-2 text-hueso hover:text-naranja" aria-label="Iniciar sesión o crear cuenta">
        <IconUsuario /> <span className="hidden text-[0.95rem] xl:inline">Cuenta</span>
      </Link>
    );
  }
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setAbierto((v) => !v)} aria-expanded={abierto} aria-haspopup="menu"
        className="flex items-center gap-2 rounded-md p-2 hover:text-naranja">
        <span className="grid h-7 w-7 place-items-center rounded-full bg-naranja font-display font-bold text-black">{usuario.nombre[0]?.toUpperCase()}</span>
        <span className="hidden max-w-28 truncate text-[0.95rem] xl:inline">{usuario.nombre.split(' ')[0]}</span>
      </button>
      {abierto && (
        <div role="menu" className="absolute right-0 top-12 z-50 w-56 rounded-md border border-acero bg-carbon p-1.5 shadow-2xl shadow-black/60">
          <p className="truncate px-3 py-2 text-sm text-niebla">{usuario.email}</p>
          {usuario.rol === 'admin' && (
            <Link role="menuitem" to="/admin" onClick={() => setAbierto(false)} className="block rounded px-3 py-2 font-semibold text-naranja hover:bg-grafito">Panel de administración</Link>
          )}
          <Link role="menuitem" to="/pedidos" onClick={() => setAbierto(false)} className="block rounded px-3 py-2 hover:bg-grafito">Mis pedidos</Link>
          <button role="menuitem" type="button" onClick={() => { setAbierto(false); logout(); }} className="block w-full rounded px-3 py-2 text-left hover:bg-grafito">Cerrar sesión</button>
        </div>
      )}
    </div>
  );
}

export function Navbar() {
  const { carrito, usuario } = useStore();
  const { loc } = useRouter();
  const [menu, setMenu] = useState(false);
  const n = carrito?.cantidad_total ?? 0;
  useEffect(() => setMenu(false), [loc.pathname]);
  const activo = (to: string) => (to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(to));

  return (
    <header className="sticky top-0 z-40 border-b border-grafito bg-hierro/90 backdrop-blur-md">
      <div className="contenedor flex h-16 items-center gap-4 lg:gap-8">
        <button type="button" className="-ml-2 rounded-md p-2 lg:hidden" onClick={() => setMenu(true)} aria-label="Abrir menú">
          <IconMenu />
        </button>
        <Link to="/" aria-label="IronCart, inicio" className="shrink-0"><Logo /></Link>
        <nav aria-label="Principal" className="hidden lg:block">
          <ul className="flex items-center gap-6">
            {NAV.map((l) => (
              <li key={l.to}>
                <Link to={l.to} aria-current={activo(l.to) ? 'page' : undefined}
                  className={`text-[0.95rem] transition-colors ${activo(l.to) ? 'text-hueso underline decoration-naranja decoration-2 underline-offset-[10px]' : 'text-niebla hover:text-hueso'}`}>
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="ml-auto hidden w-full max-w-xs md:block"><Buscador /></div>
        <div className="ml-auto flex items-center gap-1 md:ml-0">
          <Cuenta />
          <Link to="/carrito" className="relative rounded-md p-2 hover:text-naranja" aria-label={`Carrito, ${n} productos`}>
            <IconCarrito />
            {n > 0 && (
              <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-naranja px-1 font-display text-xs font-bold text-black">
                {n > 99 ? '99+' : n}
              </span>
            )}
          </Link>
        </div>
      </div>
      <div className="contenedor pb-3 md:hidden"><Buscador /></div>

      {menu && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menú">
          <button type="button" className="absolute inset-0 bg-black/70" onClick={() => setMenu(false)} aria-label="Cerrar menú" />
          <div className="absolute inset-y-0 left-0 flex w-[82%] max-w-sm flex-col bg-carbon p-5">
            <div className="flex items-center justify-between">
              <Logo />
              <button type="button" onClick={() => setMenu(false)} className="rounded-md p-2" aria-label="Cerrar menú"><IconCerrar /></button>
            </div>
            <nav className="mt-8" aria-label="Principal móvil">
              {NAV.map((l) => (
                <Link key={l.to} to={l.to} className={`block border-b border-grafito py-3.5 font-display text-3xl font-bold ${activo(l.to) ? 'text-naranja' : ''}`}>{l.label}</Link>
              ))}
              <Link to="/pedidos" className="block border-b border-grafito py-3.5 font-display text-3xl font-bold">Mis pedidos</Link>
              {usuario?.rol === 'admin' && <Link to="/admin" className="block border-b border-grafito py-3.5 font-display text-3xl font-bold text-naranja">Administración</Link>}
            </nav>
          </div>
        </div>
      )}
    </header>
  );
}

export function Footer() {
  const { abrirSpot } = useStore();
  return (
    <footer className="mt-24 border-t border-grafito bg-carbon">
      <div className="contenedor grid gap-10 py-14 md:grid-cols-[1.4fr_1fr_1fr_1.2fr]">
        <div>
          <Logo />
          <p className="mt-4 max-w-sm text-niebla">
            Tienda online de suplementos deportivos con un asistente de IA que responde con precios y existencias reales del catálogo.
          </p>
          <div className="mt-5 flex gap-2" aria-label="Redes sociales (demostración)">
            {[{ I: IconInstagram, n: 'Instagram' }, { I: IconFacebook, n: 'Facebook' }, { I: IconTiktok, n: 'TikTok' }].map(({ I, n }) => (
              <a key={n} href="https://example.com" target="_blank" rel="noreferrer noopener" aria-label={`${n} (perfil de demostración)`}
                className="grid h-10 w-10 place-items-center rounded-md border border-acero text-niebla hover:border-naranja hover:text-naranja">
                <I size={19} />
              </a>
            ))}
          </div>
        </div>
        <div>
          <h2 className="font-display text-xl font-bold">Tienda</h2>
          <ul className="mt-3 space-y-2 text-niebla">
            <li><Link to="/productos" className="hover:text-hueso">Todos los productos</Link></li>
            <li><Link to="/categorias" className="hover:text-hueso">Categorías</Link></li>
            <li><Link to="/productos?destacados=true" className="hover:text-hueso">Destacados</Link></li>
            <li><Link to="/carrito" className="hover:text-hueso">Carrito</Link></li>
          </ul>
        </div>
        <div>
          <h2 className="font-display text-xl font-bold">Ayuda</h2>
          <ul className="mt-3 space-y-2 text-niebla">
            <li><Link to="/pedidos" className="hover:text-hueso">Mis pedidos</Link></li>
            <li><Link to="/nosotros?seccion=politicas" className="hover:text-hueso">Envíos y devoluciones</Link></li>
            <li><Link to="/contacto" className="hover:text-hueso">Contacto</Link></li>
            <li><button type="button" onClick={() => abrirSpot()} className="hover:text-hueso">Hablar con Spot</button></li>
          </ul>
        </div>
        <div>
          <h2 className="font-display text-xl font-bold">Contacto</h2>
          <ul className="mt-3 space-y-2.5 text-niebla">
            <li className="flex gap-2"><IconMail size={20} className="mt-0.5 shrink-0" /> soporte@ironcart.dev</li>
            <li className="flex gap-2"><IconUbicacion size={20} className="mt-0.5 shrink-0" /> Managua, Nicaragua</li>
            <li className="flex gap-2"><IconReloj size={20} className="mt-0.5 shrink-0" /> Lun–vie 8:00–18:00, sáb 9:00–13:00</li>
          </ul>
        </div>
      </div>
      <div className="border-t border-grafito">
        <div className="contenedor flex flex-col gap-2 py-5 text-sm text-niebla md:flex-row md:justify-between">
          <p>© {new Date().getFullYear()} IronCart. Todos los derechos reservados.</p>
          <p>Proyecto académico: productos, precios, existencias y pedidos son datos ficticios de demostración. No se realizan cobros.</p>
        </div>
      </div>
    </footer>
  );
}

export function Toaster() {
  const { toasts } = useStore();
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:left-6 sm:right-auto sm:items-start">
      {toasts.map((t) => (
        <div key={t.id} className={`panel-spot pointer-events-auto max-w-sm rounded-md border px-4 py-3 text-[0.95rem] shadow-2xl shadow-black/60 ${t.tono === 'error' ? 'border-error/60 bg-[#2a1616]' : 'border-acero bg-carbon'}`}>
          {t.texto}
        </div>
      ))}
    </div>
  );
}

export function PageHeader({ titulo, children }: { titulo: string; children?: ReactNode }) {
  return (
    <div className="contenedor pb-8 pt-12 sm:pt-16">
      <h1 className="text-[2.6rem] font-extrabold [overflow-wrap:anywhere] sm:text-7xl">{titulo}</h1>
      {children && <div className="mt-3 max-w-2xl text-lg text-niebla">{children}</div>}
    </div>
  );
}
