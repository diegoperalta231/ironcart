// SOLO PRUEBAS DE INTEGRACIÓN LOCALES — NO ES IA.
// Servidor que imita el FORMATO de la API Messages de Anthropic para verificar
// que el backend envía el prompt, el historial y el contexto correctos cuando no
// hay una ANTHROPIC_API_KEY real disponible. Devuelve un eco estructurado del
// contexto recibido (prefijo "[STUB]") y guarda la última petición en disco.
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
const PORT = Number(process.env.MOCK_PORT ?? 8787);
createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;
  if (req.url !== '/v1/messages' || req.headers['x-api-key'] !== 'test-key') {
    res.writeHead(401, { 'content-type': 'application/json' }).end('{"type":"error","error":{"type":"authentication_error"}}');
    return;
  }
  const b = JSON.parse(body);
  writeFileSync('/tmp/ironcart-last-claude-request.json', JSON.stringify(b, null, 2));
  const ctx = b.system?.[1]?.text ?? '';
  const ruta = ctx.match(/ruta="([^"]+)"/)?.[1];
  const nombres = [...ctx.matchAll(/"nombre": "([^"]+)"/g)].map((m) => m[1]);
  const precios = [...ctx.matchAll(/"precio_usd": ([\d.]+)/g)].map((m) => m[1]);
  const docs = [...ctx.matchAll(/titulo="([^"]+)"/g)].map((m) => m[1]);
  const text = `[STUB] ruta=${ruta}; turnos=${b.messages.length}; productos=${nombres.map((n, i) => `${n} $${precios[i] ?? '?'}`).join(' | ') || '-'}; documentos=${docs.join(' | ') || '-'}`;
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
    id: 'msg_stub', type: 'message', role: 'assistant', model: 'stub-local',
    content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 0, output_tokens: 0 },
  }));
}).listen(PORT, () => console.log(`[mock-anthropic] http://127.0.0.1:${PORT}`));
