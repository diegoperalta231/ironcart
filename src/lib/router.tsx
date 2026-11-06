/** Enrutador mínimo basado en History API (sin dependencias). Netlify sirve index.html para todas las rutas. */
import { createContext, useCallback, useContext, useEffect, useState, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from 'react';

interface Loc { pathname: string; search: string }
const RouterCtx = createContext<{ loc: Loc; navigate: (to: string, opts?: { replace?: boolean }) => void }>({
  loc: { pathname: '/', search: '' }, navigate: () => {},
});

const current = (): Loc => ({ pathname: window.location.pathname, search: window.location.search });

export function RouterProvider({ children }: { children: ReactNode }) {
  const [loc, setLoc] = useState<Loc>(current);
  useEffect(() => {
    const onPop = () => setLoc(current());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const navigate = useCallback((to: string, opts?: { replace?: boolean }) => {
    if (to === window.location.pathname + window.location.search) return;
    window.history[opts?.replace ? 'replaceState' : 'pushState'](null, '', to);
    setLoc(current());
    if (!to.includes('#')) window.scrollTo({ top: 0 });
  }, []);
  return <RouterCtx.Provider value={{ loc, navigate }}>{children}</RouterCtx.Provider>;
}

export const useRouter = () => useContext(RouterCtx);
export const useQuery = () => new URLSearchParams(useRouter().loc.search);

export function Link({ to, children, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  const { navigate } = useRouter();
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
  return <a href={to} onClick={handle} {...rest}>{children}</a>;
}

/** Devuelve los parámetros si la ruta coincide con el patrón (p. ej. "/producto/:slug"). */
export function match(pattern: string, pathname: string): Record<string, string> | null {
  const p = pattern.split('/').filter(Boolean);
  const a = pathname.split('/').filter(Boolean);
  if (p.length !== a.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(':')) params[p[i].slice(1)] = decodeURIComponent(a[i]);
    else if (p[i] !== a[i]) return null;
  }
  return params;
}
