// Punto de entrada para Supabase Edge Functions (Deno). Reutiliza el mismo
// manejador que la Netlify Function (netlify/functions/api.ts).
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los provee Supabase automáticamente;
// ANTHROPIC_API_KEY se configura como secreto de Edge Functions.
import handler from '../../../netlify/functions/api';

declare const Deno: { serve(h: (req: Request) => Response | Promise<Response>): void };
Deno.serve((req) => handler(req, {}));
