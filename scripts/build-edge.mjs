// Empaqueta la API para Supabase Edge Functions en un solo archivo (supabase/functions/api/index.ts).
// Uso: IC_ORIGINS=https://tu-sitio.netlify.app node scripts/build-edge.mjs
import { build } from 'esbuild';
await build({
  entryPoints: ['supabase/functions/api/entry.ts'], bundle: true, format: 'esm', platform: 'neutral',
  target: 'es2022', minify: true, legalComments: 'none', outfile: 'supabase/functions/api/index.ts', external: ['node:*'], logLevel: 'warning',
  banner: { js: '// @ts-nocheck\n// GENERADO por scripts/build-edge.mjs a partir de netlify/functions/api.ts — no editar.' },
  define: { __IC_DEFAULT_ORIGINS__: JSON.stringify(process.env.IC_ORIGINS ?? '') },
});
console.log('OK supabase/functions/api/index.ts');
