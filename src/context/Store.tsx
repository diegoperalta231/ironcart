/** Estado global: sesión, carrito, avisos (toasts) y apertura del asistente Spot. */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, CART_KEY, SESSION_KEY } from '../lib/api';
import { local } from '../lib/format';
import type { Carrito, Usuario } from '../lib/types';

interface Toast { id: number; texto: string; tono: 'ok' | 'error' }

interface StoreValue {
  usuario: Usuario | null;
  cargandoSesion: boolean;
  carrito: Carrito | null;
  login: (email: string, password: string) => Promise<void>;
  registro: (nombre: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  agregar: (productoId: number, cantidad?: number, nombre?: string) => Promise<boolean>;
  fijarCantidad: (productoId: number, cantidad: number) => Promise<void>;
  quitar: (productoId: number) => Promise<void>;
  refrescarCarrito: () => Promise<void>;
  setCarrito: (c: Carrito | null) => void;
  avisar: (texto: string, tono?: Toast['tono']) => void;
  toasts: Toast[];
  spotAbierto: boolean;
  abrirSpot: (pregunta?: string) => void;
  cerrarSpot: () => void;
  preguntaPendiente: string | null;
  consumirPregunta: () => void;
}

const Ctx = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [cargandoSesion, setCargandoSesion] = useState(true);
  const [carrito, setCarrito] = useState<Carrito | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [spotAbierto, setSpotAbierto] = useState(false);
  const [preguntaPendiente, setPregunta] = useState<string | null>(null);
  const tid = useRef(0);

  const avisar = useCallback((texto: string, tono: Toast['tono'] = 'ok') => {
    const id = ++tid.current;
    setToasts((t) => [...t.slice(-2), { id, texto, tono }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3800);
  }, []);

  const refrescarCarrito = useCallback(async () => {
    try { setCarrito((await api<{ carrito: Carrito }>('/carrito')).carrito); } catch { /* el carrito se reintenta al interactuar */ }
  }, []);

  useEffect(() => {
    (async () => {
      try { setUsuario((await api<{ usuario: Usuario | null }>('/auth/yo')).usuario); } catch { setUsuario(null); }
      setCargandoSesion(false);
      refrescarCarrito();
    })();
  }, [refrescarCarrito]);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api<{ usuario: Usuario; carrito: Carrito }>('/auth/login', { method: 'POST', body: { email, password } });
    setUsuario(r.usuario); setCarrito(r.carrito);
  }, []);

  const registro = useCallback(async (nombre: string, email: string, password: string) => {
    const r = await api<{ usuario: Usuario; carrito: Carrito }>('/auth/registro', { method: 'POST', body: { nombre, email, password } });
    setUsuario(r.usuario); setCarrito(r.carrito);
  }, []);

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST', body: {} }).catch(() => {});
    local.del(SESSION_KEY); local.del(CART_KEY);
    setUsuario(null); setCarrito(null);
    avisar('Cerraste sesión.');
  }, [avisar]);

  const manejarError = useCallback((e: unknown) => {
    const err = e as ApiError;
    if (err.data?.carrito) setCarrito(err.data.carrito as Carrito);
    avisar(err.message ?? 'No se pudo actualizar el carrito.', 'error');
  }, [avisar]);

  const agregar = useCallback(async (productoId: number, cantidad = 1, nombre?: string) => {
    try {
      const r = await api<{ carrito: Carrito }>('/carrito/items', { method: 'POST', body: { producto_id: productoId, cantidad } });
      setCarrito(r.carrito);
      avisar(nombre ? `${nombre} se agregó al carrito.` : 'Producto agregado al carrito.');
      return true;
    } catch (e) { manejarError(e); return false; }
  }, [avisar, manejarError]);

  const fijarCantidad = useCallback(async (productoId: number, cantidad: number) => {
    try {
      setCarrito((await api<{ carrito: Carrito }>(`/carrito/items/${productoId}`, { method: 'PATCH', body: { cantidad } })).carrito);
    } catch (e) { manejarError(e); }
  }, [manejarError]);

  const quitar = useCallback(async (productoId: number) => {
    try {
      setCarrito((await api<{ carrito: Carrito }>(`/carrito/items/${productoId}`, { method: 'DELETE' })).carrito);
      avisar('Producto eliminado del carrito.');
    } catch (e) { manejarError(e); }
  }, [avisar, manejarError]);

  const value = useMemo<StoreValue>(() => ({
    usuario, cargandoSesion, carrito, login, registro, logout, agregar, fijarCantidad, quitar, refrescarCarrito, setCarrito,
    avisar, toasts, spotAbierto,
    abrirSpot: (pregunta?: string) => { if (pregunta) setPregunta(pregunta); setSpotAbierto(true); },
    cerrarSpot: () => setSpotAbierto(false),
    preguntaPendiente, consumirPregunta: () => setPregunta(null),
  }), [usuario, cargandoSesion, carrito, login, registro, logout, agregar, fijarCantidad, quitar, refrescarCarrito, avisar, toasts, spotAbierto, preguntaPendiente]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStore fuera de StoreProvider');
  return v;
}
