// SOLO PRUEBAS LOCALES. Emula el endpoint RPC de PostgREST/Supabase
// (POST /rest/v1/rpc/<fn> con body {"p": {...}}) ejecutando la función real
// en un PostgreSQL local mediante psql. Permite probar el backend sin Supabase.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

const PORT = Number(process.env.SHIM_PORT ?? 54321);
const KEY = process.env.SHIM_KEY ?? 'local-service-key';
const PG = ['-h', process.env.PGHOST ?? '/tmp', '-p', process.env.PGPORT ?? '5433', '-U', 'postgres', '-d', process.env.PGDATABASE ?? 'ironcart'];

function run(fn, p) {
  return new Promise((resolve, reject) => {
    const ps = spawn('psql', [...PG, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-v', `p=${JSON.stringify(p ?? {})}`]);
    let out = '', err = '';
    ps.stdout.on('data', (d) => (out += d));
    ps.stderr.on('data', (d) => (err += d));
    ps.on('close', (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(err.trim()))));
    ps.stdin.end(`select public.${fn}(p => :'p'::jsonb);\n`);
  });
}

createServer(async (req, res) => {
  const m = req.url.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/);
  if (req.method !== 'POST' || !m) { res.writeHead(404).end('{}'); return; }
  if (req.headers.apikey !== KEY) { res.writeHead(401).end('{"message":"Invalid API key"}'); return; }
  let body = '';
  for await (const c of req) body += c;
  try {
    const { p } = JSON.parse(body || '{}');
    const out = await run(m[1], p);
    res.writeHead(200, { 'content-type': 'application/json' }).end(out === '' ? 'null' : out);
  } catch (e) {
    res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ message: e.message }));
  }
}).listen(PORT, () => console.log(`[shim] PostgREST local en http://127.0.0.1:${PORT}`));
