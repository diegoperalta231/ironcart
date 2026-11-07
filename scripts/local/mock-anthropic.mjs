// SOLO PRUEBAS DE INTEGRACIÓN LOCALES — NO ES IA.
// Imita el FORMATO de la API Messages de Anthropic para verificar el cableado del
// backend sin una ANTHROPIC_API_KEY real:
//  - sin herramientas: devuelve un eco estructurado del contexto recibido ("[STUB] ...").
//  - con herramientas: sigue un guion fijo (buscar -> actuar -> responder) para probar
//    el bucle de tool use, la ejecución en el servidor y los permisos por rol.
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
const PORT = Number(process.env.MOCK_PORT ?? 8787);

const reply = (content, stop = 'end_turn') => ({
  id: 'msg_stub', type: 'message', role: 'assistant', model: 'stub-local', content, stop_reason: stop,
  usage: { input_tokens: 0, output_tokens: 0 },
});
const toolUse = (name, input) => reply([{ type: 'tool_use', id: 'toolu_' + Math.random().toString(36).slice(2, 10), name, input }], 'tool_use');
const text = (t) => reply([{ type: 'text', text: '[STUB] ' + t }]);
const strip = (s) => s.replace(/<\/?mensaje_usuario>/g, '').trim();

function agent(b) {
  const names = b.tools.map((t) => t.name);
  const msgs = b.messages;
  const last = msgs.at(-1);
  const userText = strip([...msgs].reverse().find((m) => m.role === 'user' && typeof m.content === 'string')?.content ?? '');
  const lower = userText.toLowerCase();
  if (typeof last.content === 'string') {
    const consulta = userText.replace(/\b(agrega|agregame|añade|mete|quita|al|del|carrito|mi|sube|baja|el|la|stock|de|unidades|precio|elimina|crea|a|\d+)\b/gi, ' ').replace(/[¿?,.]/g, ' ').replace(/\s+/g, ' ').trim() || 'creatina';
    return names.includes('proponer_cambios') ? toolUse('buscar_productos_admin', { consulta }) : toolUse('buscar_productos', { consulta });
  }
  const prevAssistant = msgs.at(-2);
  const prevTool = Array.isArray(prevAssistant?.content) ? prevAssistant.content.find((c) => c.type === 'tool_use')?.name : null;
  const result = JSON.parse(last.content[0].content);
  if (prevTool === 'buscar_productos') {
    const p = (result.resultados ?? []).find((x) => x.stock > 0);
    if (!p) return text('no encontré productos disponibles');
    const n = Number(userText.match(/\d+/)?.[0] ?? 1);
    return /quita|saca/.test(lower) ? toolUse('cambiar_cantidad_en_carrito', { producto_id: p.id, cantidad: 0 })
      : toolUse('agregar_al_carrito', { producto_id: p.id, cantidad: n });
  }
  if (prevTool === 'buscar_productos_admin') {
    const p = (result.resultados ?? [])[0];
    if (/crea/.test(lower)) {
      return toolUse('proponer_cambios', { operaciones: [{ tipo: 'crear', datos: { nombre: 'Proteína Stub Test', marca: 'Marca Stub', categoria: 'proteinas', descripcion: 'Producto creado en una prueba automática.', presentacion: '1 lb', precio: 19.99, stock: 7 } }] });
    }
    if (!p) return text('no encontré el producto');
    if (/elimina|borra/.test(lower)) return toolUse('proponer_cambios', { operaciones: [{ tipo: 'eliminar', producto_id: p.id }] });
    return toolUse('proponer_cambios', { operaciones: [{ tipo: 'actualizar', producto_id: p.id, cambios: { stock: p.stock + Number(userText.match(/\d+/)?.[0] ?? 5) } }] });
  }
  if (result.error) return text('herramienta rechazada: ' + result.error);
  if (result.errores) return text('errores de validación: ' + JSON.stringify(result.errores));
  return text(`${prevTool} -> ${JSON.stringify(result).slice(0, 200)}`);
}

createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;
  if (req.url !== '/v1/messages' || req.headers['x-api-key'] !== 'test-key') {
    res.writeHead(401, { 'content-type': 'application/json' }).end('{"type":"error","error":{"type":"authentication_error"}}');
    return;
  }
  const b = JSON.parse(body);
  writeFileSync('/tmp/ironcart-last-claude-request.json', JSON.stringify(b, null, 2));
  let out;
  if (b.tools?.length) {
    out = agent(b);
  } else {
    const ctx = b.system?.[1]?.text ?? '';
    const ruta = ctx.match(/ruta="([^"]+)"/)?.[1];
    const nombres = [...ctx.matchAll(/"nombre": "([^"]+)"/g)].map((m) => m[1]);
    const precios = [...ctx.matchAll(/"precio_usd": ([\d.]+)/g)].map((m) => m[1]);
    const docs = [...ctx.matchAll(/titulo="([^"]+)"/g)].map((m) => m[1]);
    out = text(`ruta=${ruta}; turnos=${b.messages.length}; productos=${nombres.map((n, i) => `${n} $${precios[i] ?? '?'}`).join(' | ') || '-'}; documentos=${docs.join(' | ') || '-'}`);
  }
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out));
}).listen(PORT, () => console.log(`[mock-anthropic] http://127.0.0.1:${PORT}`));
