/**
 * Configuración del servidor. TODAS las credenciales se leen de variables de
 * entorno (Netlify → Site configuration → Environment variables) y nunca se
 * envían al navegador. Ver .env.example.
 */
const read = (k: string): string | undefined => {
  const v = process.env[k];
  return v && v.trim() ? v.trim() : undefined;
};

export const env = {
  get supabaseUrl() { return read('SUPABASE_URL')?.replace(/\/+$/, ''); },
  get supabaseServiceKey() { return read('SUPABASE_SERVICE_ROLE_KEY'); },

  get anthropicKey() { return read('ANTHROPIC_API_KEY'); },
  get anthropicModel() { return read('ANTHROPIC_MODEL') ?? 'claude-haiku-5-5'; },
  /** Solo para pruebas locales con un servidor simulado; en producción no se define. */
  get anthropicBaseUrl() { return (read('ANTHROPIC_API_URL') ?? 'https://api.anthropic.com').replace(/\/+$/, ''); },
  get anthropicMaxTokens() { return Number(read('ANTHROPIC_MAX_TOKENS') ?? 700); },
  get anthropicTimeoutMs() { return Number(read('ANTHROPIC_TIMEOUT_MS') ?? 8500); },

  get voyageKey() { return read('VOYAGE_API_KEY'); },
  get voyageModel() { return read('VOYAGE_MODEL') ?? 'voyage-3.5'; },

  get adminToken() { return read('ADMIN_TOKEN'); },
  get ipHashSalt() { return read('IP_HASH_SALT') ?? 'ironcart-dev-salt'; },
  get allowedOrigins() { return (read('ALLOWED_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter(Boolean); },

  get chatRatePerMinute() { return Number(read('CHAT_RATE_PER_MINUTE') ?? 10); },
  get chatRatePerDay() { return Number(read('CHAT_RATE_PER_DAY') ?? 150); },
  /** Turnos (usuario+asistente) de historial que se envían a Claude. */
  get historyTurns() { return Math.min(Math.max(Number(read('SPOT_HISTORY_TURNS') ?? 5), 1), 8); },
};
