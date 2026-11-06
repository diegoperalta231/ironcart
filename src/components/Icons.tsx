/** Iconografía propia, trazo de 1.75 px, rejilla de 24. */
import type { ReactNode, SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = (size = 22): SVGProps<SVGSVGElement> => ({
  width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
});
const mk = (d: ReactNode) => ({ size, ...p }: P) => <svg {...base(size)} {...p}>{d}</svg>;

export const IconCarrito = mk(<><path d="M3 4h2.2l2.1 10.2a1.5 1.5 0 0 0 1.5 1.2h8.4a1.5 1.5 0 0 0 1.5-1.1L20.5 8H6.1" /><circle cx="9.5" cy="19.5" r="1.3" /><circle cx="17" cy="19.5" r="1.3" /></>);
export const IconBuscar = mk(<><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></>);
export const IconUsuario = mk(<><circle cx="12" cy="8.5" r="3.8" /><path d="M4.5 20c1.2-3.6 4-5.3 7.5-5.3s6.3 1.7 7.5 5.3" /></>);
export const IconMenu = mk(<path d="M4 7h16M4 12h16M4 17h10" />);
export const IconCerrar = mk(<path d="m6 6 12 12M18 6 6 18" />);
export const IconEnviar = mk(<path d="M4.5 12h13M12.5 6l6 6-6 6" />);
export const IconReiniciar = mk(<><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" /><path d="M4.5 4.5v3.7h3.7" /></>);
export const IconMas = mk(<path d="M12 5v14M5 12h14" />);
export const IconMenos = mk(<path d="M5 12h14" />);
export const IconPapelera = mk(<><path d="M5 7h14M10 7V5h4v2M7 7l.8 12h8.4L17 7" /></>);
export const IconCamion = mk(<><path d="M3 6.5h10.5v9H3zM13.5 10h4l3 3v2.5h-7" /><circle cx="7" cy="17.5" r="1.6" /><circle cx="17" cy="17.5" r="1.6" /></>);
export const IconEscudo = mk(<path d="M12 3.5 5 6v5.5c0 4.2 2.9 7.7 7 9 4.1-1.3 7-4.8 7-9V6z" />);
export const IconChispa = mk(<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" />);
export const IconCaja = mk(<><path d="M4 7.5 12 4l8 3.5v9L12 20l-8-3.5z" /><path d="M4 7.5 12 11l8-3.5M12 11v9" /></>);
export const IconFlecha = mk(<path d="M9 5l7 7-7 7" />);
export const IconAtras = mk(<path d="M15 5l-7 7 7 7" />);
export const IconCheck = mk(<path d="m5 12.5 4.5 4.5L19 7.5" />);
export const IconMail = mk(<><rect x="3.5" y="5.5" width="17" height="13" rx="1.5" /><path d="m4 6.5 8 6 8-6" /></>);
export const IconUbicacion = mk(<><path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.3" /></>);
export const IconReloj = mk(<><circle cx="12" cy="12" r="8" /><path d="M12 7.5V12l3 2" /></>);
export const IconInstagram = mk(<><rect x="4" y="4" width="16" height="16" rx="4.5" /><circle cx="12" cy="12" r="3.6" /><circle cx="17" cy="7" r="0.6" fill="currentColor" /></>);
export const IconFacebook = mk(<path d="M14.5 8.5H13a1.5 1.5 0 0 0-1.5 1.5v10M9 13h5.5M14.5 4.5H13a5 5 0 0 0-5 5" />);
export const IconTiktok = mk(<path d="M13.5 4v10.5a3.5 3.5 0 1 1-3.5-3.5M13.5 4c.4 2.4 2 4 4.5 4.3" />);

/** Marca de Spot: una "chispa" dentro de un visor, en lugar del robot genérico. */
export function SpotMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="2" y="5" width="28" height="22" rx="7" fill="#ff5b14" />
      <rect x="6.5" y="10.5" width="19" height="11" rx="5.5" fill="#0d0e0f" />
      <circle cx="12.5" cy="16" r="2.1" fill="#c8f031" />
      <circle cx="19.5" cy="16" r="2.1" fill="#c8f031" />
      <path d="M16 1.5v3.5" stroke="#ff5b14" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

/** Logotipo IRONCART: monograma de disco olímpico + logotipo condensado. */
export function Logo({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true">
        <circle cx="16" cy="16" r="14" fill="none" stroke="#ff5b14" strokeWidth="4" />
        <circle cx="16" cy="16" r="5.5" fill="none" stroke="#ece9e2" strokeWidth="3" />
        <path d="M16 2v6M16 24v6" stroke="#0d0e0f" strokeWidth="3" />
      </svg>
      <span className="font-display text-[1.65rem] font-extrabold italic leading-none tracking-tight">
        IRON<span className="text-naranja">CART</span>
      </span>
    </span>
  );
}
