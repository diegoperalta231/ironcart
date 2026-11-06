// Empaqueta netlify/functions/api.ts con esbuild para ejecutarlo localmente.
// (En Netlify el empaquetado lo hace la plataforma automáticamente.)
import { build } from 'esbuild';
await build({ entryPoints: ['netlify/functions/api.ts'], bundle: true, platform: 'node', format: 'esm', target: 'node20', outfile: '.local/api.mjs', logLevel: 'warning' });
console.log('OK .local/api.mjs');
