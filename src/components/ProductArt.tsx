/**
 * Ilustración vectorial de envase genérico (no reproduce el diseño de ninguna marca).
 * Si `imagen` es una URL (http/https o /ruta), se usa esa imagen en su lugar.
 */
import { useId, type ReactNode } from 'react';

interface Props { imagen: string; color: string; nombre: string; marca?: string; className?: string; grande?: boolean }

function shade(hex: string, amt: number) {
  const n = parseInt(hex.replace('#', ''), 16);
  const c = (s: number) => Math.max(0, Math.min(255, ((n >> s) & 255) + amt));
  return `rgb(${c(16)},${c(8)},${c(0)})`;
}

function etiqueta(nombre: string) {
  const palabras = nombre.replace(/\(.*?\)/g, '').split(' ').filter(Boolean);
  const lineas: string[] = [];
  let actual = '';
  for (const p of palabras) {
    if ((actual + ' ' + p).trim().length > 12 && actual) { lineas.push(actual); actual = p; } else actual = (actual + ' ' + p).trim();
  }
  if (actual) lineas.push(actual);
  return lineas.slice(0, 3);
}

export default function ProductArt({ imagen, color, nombre, marca, className = '', grande = false }: Props) {
  const id = useId().replace(/:/g, '');
  if (/^(https?:)?\//.test(imagen)) {
    return <img src={imagen} alt={nombre} loading="lazy" className={`h-full w-full object-contain ${className}`} />;
  }
  const tipo = imagen;
  const lineas = etiqueta(nombre);
  const oscuro = ['#1A1A1A', '#5A3E2B', '#4A5568', '#7A1F2B'].includes(color.toUpperCase());
  const txt = oscuro ? '#ece9e2' : '#0d0e0f';

  const ancho = { tub: 104, jar: 80, bag: 78, can: 76, bottle: 64, caps: 64 }[tipo as 'tub'] ?? 70;
  const ajustar = (l: string, size: number) => (l.length * size * 0.5 > ancho ? { textLength: ancho, lengthAdjust: 'spacingAndGlyphs' as const } : {});
  const textoEtiqueta = (x: number, y: number, size: number) => (
    <g fontFamily="Barlow Condensed, Arial Narrow, sans-serif" fontWeight={800} fontStyle="italic" textAnchor="middle" fill={txt}>
      {marca && <text x={x} y={y - size * 1.25} fontSize={size * 0.42} fontStyle="normal" fontWeight={600} opacity={0.75} {...ajustar(marca, size * 0.42)}>{marca.toUpperCase()}</text>}
      {lineas.map((l, i) => <text key={i} x={x} y={y + i * size} fontSize={size} {...ajustar(l, size)}>{l}</text>)}
    </g>
  );

  let cuerpo: ReactNode;
  switch (tipo) {
    case 'jar':
      cuerpo = (<>
        <rect x="62" y="40" width="76" height="22" rx="5" fill="#26292d" />
        <rect x="56" y="58" width="88" height="112" rx="14" fill={`url(#c${id})`} />
        <rect x="56" y="88" width="88" height="56" fill={color} />
        {textoEtiqueta(100, 112, 13)}
      </>);
      break;
    case 'bag':
      cuerpo = (<>
        <path d="M52 44h96l-6 16 10 104a8 8 0 0 1-8 8H56a8 8 0 0 1-8-8l10-104z" fill={`url(#c${id})`} />
        <rect x="52" y="44" width="96" height="10" fill="#26292d" />
        <rect x="58" y="86" width="84" height="62" rx="4" fill={color} />
        {textoEtiqueta(100, 112, 14)}
      </>);
      break;
    case 'can':
      cuerpo = (<>
        <rect x="60" y="34" width="80" height="16" rx="4" fill="#26292d" />
        <rect x="58" y="46" width="84" height="126" rx="10" fill={`url(#c${id})`} />
        <rect x="58" y="72" width="84" height="76" fill={color} />
        <path d="M58 72l84 22v54H58z" fill="#000" opacity="0.12" />
        {textoEtiqueta(100, 106, 15)}
      </>);
      break;
    case 'bottle':
    case 'caps':
      cuerpo = (<>
        <rect x="74" y="30" width="52" height="22" rx="4" fill="#26292d" />
        <rect x="80" y="48" width="40" height="10" fill="#3a3e44" />
        <rect x="64" y="56" width="72" height="116" rx="16" fill={`url(#c${id})`} />
        <rect x="64" y="86" width="72" height="62" fill={color} />
        {textoEtiqueta(100, 110, 12)}
        {tipo === 'caps' && <ellipse cx="146" cy="160" rx="9" ry="5" fill="#e3b341" opacity="0.9" />}
      </>);
      break;
    case 'shaker':
      cuerpo = (<>
        <rect x="70" y="28" width="60" height="24" rx="6" fill={color} />
        <rect x="92" y="18" width="16" height="14" rx="3" fill={color} />
        <path d="M66 52h68l-8 118a6 6 0 0 1-6 6H80a6 6 0 0 1-6-6z" fill={`url(#c${id})`} />
        {[80, 100, 120, 140].map((y) => <rect key={y} x="74" y={y} width="10" height="2" fill="#ece9e2" opacity="0.5" />)}
        <circle cx="100" cy="150" r="9" fill="none" stroke="#ece9e2" strokeWidth="2" opacity="0.5" />
      </>);
      break;
    case 'belt':
      cuerpo = (<>
        <path d="M24 92c40-22 112-22 152 0v34c-40-22-112-22-152 0z" fill={`url(#c${id})`} />
        <path d="M24 100c40-20 112-20 152 0" stroke={color} strokeWidth="3" fill="none" />
        <rect x="88" y="84" width="28" height="40" rx="4" fill="none" stroke="#c9ccd1" strokeWidth="5" />
      </>);
      break;
    case 'strap':
    case 'glove':
      cuerpo = (<>
        <path d="M40 70c30-14 90-14 120 6l-10 26c-28-16-76-16-100-4z" fill={`url(#c${id})`} />
        <path d="M44 120c30-14 90-14 120 6l-10 26c-28-16-76-16-100-4z" fill={`url(#c${id})`} />
        <rect x="56" y="76" width="22" height="14" rx="3" fill={color} />
        <rect x="60" y="126" width="22" height="14" rx="3" fill={color} />
      </>);
      break;
    default: // tub
      cuerpo = (<>
        <rect x="44" y="34" width="112" height="26" rx="6" fill="#26292d" />
        <rect x="44" y="34" width="112" height="6" rx="3" fill="#3a3e44" />
        <path d="M40 58h120l-6 108a10 10 0 0 1-10 9H56a10 10 0 0 1-10-9z" fill={`url(#c${id})`} />
        <path d="M41.5 84h117l-3.6 66H45.1z" fill={color} />
        <path d="M41.5 84h117l-1 18H42.5z" fill="#000" opacity="0.12" />
        {textoEtiqueta(100, 114, 17)}
      </>);
  }

  return (
    <svg viewBox="0 0 200 200" role="img" aria-label={`Ilustración de ${nombre}`} className={`h-full w-full ${className}`}>
      <defs>
        <linearGradient id={`c${id}`} x1="0" x2="1">
          <stop offset="0" stopColor="#101113" />
          <stop offset="0.35" stopColor="#2b2e33" />
          <stop offset="0.6" stopColor="#1c1e21" />
          <stop offset="1" stopColor="#0b0c0d" />
        </linearGradient>
        <radialGradient id={`s${id}`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor={shade(color, 0)} stopOpacity={grande ? 0.35 : 0.22} />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="100" cy="110" r="92" fill={`url(#s${id})`} />
      <ellipse cx="100" cy="180" rx="62" ry="7" fill="#000" opacity="0.5" />
      {cuerpo}
    </svg>
  );
}
