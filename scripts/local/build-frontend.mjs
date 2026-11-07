// SOLO LOCAL (sin acceso a npm): compila el frontend con esbuild + el compilador
// de Tailwind v4 para poder probar la interfaz. En Netlify el build real es `vite build`.
import { build } from 'esbuild';
import { compile } from 'tailwindcss';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, cpSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const out = 'dist';
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'assets'), { recursive: true });
cpSync('public', out, { recursive: true });

await build({
  entryPoints: ['src/main.tsx'], bundle: true, minify: true, format: 'esm', target: 'es2020',
  outfile: join(out, 'assets/app.js'), jsx: 'automatic', loader: { '.css': 'empty' },
  define: {
    'process.env.NODE_ENV': '"production"',
    'import.meta.env.VITE_HERO_IMAGE_URL': JSON.stringify(process.env.VITE_HERO_IMAGE_URL ?? ''),
    'import.meta.env.VITE_API_URL': JSON.stringify(process.env.VITE_API_URL ?? ''),
    'import.meta.env.VITE_ROUTER': JSON.stringify(process.env.VITE_ROUTER ?? ''),
  },
  logLevel: 'warning',
});

// Candidatos de clases a partir del código fuente
const files = [];
const walk = (d) => readdirSync(d).forEach((f) => { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : /\.(tsx?|html)$/.test(f) && files.push(p); });
walk('src'); files.push('index.html');
const candidates = new Set();
for (const f of files) for (const t of readFileSync(f, 'utf8').split(/[\s"'`{}]+/)) if (t && t.length < 120) candidates.add(t.replace(/^[(,]+|[),;]+$/g, ''));

const twDir = dirname(require.resolve('tailwindcss/package.json'));
const compiler = await compile(readFileSync('src/index.css', 'utf8'), {
  base: 'src',
  loadStylesheet: async (id, base) => {
    const path = id === 'tailwindcss' ? join(twDir, 'index.css') : join(base, id);
    return { content: readFileSync(path, 'utf8'), base: dirname(path), path };
  },
});
writeFileSync(join(out, 'assets/app.css'), compiler.build([...candidates]));

const html = readFileSync('index.html', 'utf8')
  .replace('<script type="module" src="/src/main.tsx"></script>', '<script type="module" src="/assets/app.js"></script>')
  .replace('</head>', '  <link rel="stylesheet" href="/assets/app.css" />\n  </head>');
writeFileSync(join(out, 'index.html'), html);
console.log('OK dist/', statSync(join(out, 'assets/app.js')).size, 'bytes JS,', statSync(join(out, 'assets/app.css')).size, 'bytes CSS');

// --single: un único HTML autocontenido (JS, CSS y favicon en línea) para hosting de un archivo.
if (process.argv.includes('--single')) {
  const js = readFileSync(join(out, 'assets/app.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
  const css = readFileSync(join(out, 'assets/app.css'), 'utf8');
  const fav = 'data:image/svg+xml;base64,' + Buffer.from(readFileSync('public/favicon.svg')).toString('base64');
  const single = html
    .replace('<link rel="icon" href="/favicon.svg" type="image/svg+xml" />', `<link rel="icon" href="${fav}" type="image/svg+xml" />`)
    .replace('  <link rel="stylesheet" href="/assets/app.css" />\n', `  <style>${css}</style>\n`)
    .replace('<script type="module" src="/assets/app.js"></script>', () => `<script type="module">${js}</script>`);
  mkdirSync('dist-single', { recursive: true });
  writeFileSync('dist-single/index.html', single);
  console.log('OK dist-single/index.html', Buffer.byteLength(single), 'bytes');
}
