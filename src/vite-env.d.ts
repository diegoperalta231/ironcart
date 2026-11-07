/// <reference types="vite/client" />
interface ImportMetaEnv {
  /** URL opcional de una fotografía con licencia para el fondo del hero. */
  readonly VITE_HERO_IMAGE_URL?: string;
  /** URL absoluta del backend si está en otro dominio (p. ej. Supabase Edge Function). */
  readonly VITE_API_URL?: string;
  /** 'hash' para usar rutas #/… en hosting estático sin reescrituras. */
  readonly VITE_ROUTER?: string;
}
