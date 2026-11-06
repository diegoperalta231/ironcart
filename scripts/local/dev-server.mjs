// Servidor local: sirve dist/ (SPA) y despacha /api/* a la función empaquetada.
// Equivalente simplificado a `netlify dev` para pruebas sin Netlify CLI.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
const PORT = Number(process.env.PORT ?? 8888);
const DIST = process.env.DIST ?? 'dist';
const { default: handler } = await import(process.env.FN_BUNDLE ?? '../../.local/api.mjs');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json', '.txt': 'text/plain', '.woff2': 'font/woff2' };

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith('/api/')) {
    let body = '';
    for await (const c of req) body += c;
    const request = new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body });
    const r = await handler(request, { ip: req.socket.remoteAddress });
    const headers = {};
    r.headers.forEach((v, k) => { if (k !== 'set-cookie') headers[k] = v; });
    const cookies = r.headers.getSetCookie?.() ?? [];
    if (cookies.length) headers['set-cookie'] = cookies;
    res.writeHead(r.status, headers).end(Buffer.from(await r.arrayBuffer()));
    return;
  }
  let file = normalize(join(DIST, decodeURIComponent(url.pathname)));
  if (!file.startsWith(normalize(DIST))) { res.writeHead(403).end(); return; }
  try { if ((await stat(file)).isDirectory()) file = join(file, 'index.html'); } catch { file = join(DIST, 'index.html'); }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(data);
  } catch { res.writeHead(404).end('not found'); }
}).listen(PORT, () => console.log(`[dev] http://localhost:${PORT}`));
