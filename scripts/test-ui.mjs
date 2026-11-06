#!/usr/bin/env node
/**
 * Pruebas de interfaz end-to-end (TC-07, TC-08, TC-09 y widget Spot) con Playwright.
 * Requiere: npm i -D playwright && npx playwright install chromium
 * Uso: BASE_URL=http://localhost:8888 node scripts/test-ui.mjs
 */
import { chromium } from 'playwright';
const BASE = (process.env.BASE_URL ?? 'http://localhost:8888').replace(/\/+$/, '');
const browser = await chromium.launch();
const res = [];
const ok = (id, desc, cond, extra = '') => { res.push({ id, desc, ok: !!cond }); console.log(`${cond ? '✓' : '✗'} [${id}] ${desc} ${cond ? '' : extra}`); };

// ---------------- TC-07 / TC-08 desde la interfaz
{
  const page = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`${BASE}/producto/on-creatine-300g`, { waitUntil: 'networkidle' });
  const stockAntes = Number((await page.locator('text=/\\d+ unidades$/').first().innerText()).match(/\d+/)[0]);
  await page.getByRole('button', { name: 'Agregar al carrito' }).click();
  await page.waitForSelector('a[aria-label="Carrito, 1 productos"]');
  ok('TC-07', 'agregar desde la ficha actualiza el contador del navbar', true);
  await page.goto(`${BASE}/carrito`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Aumentar cantidad' }).last().click();
  await page.waitForSelector('a[aria-label="Carrito, 2 productos"]');
  ok('TC-07', 'aumentar cantidad en el carrito (2 unidades)', true);
  await page.getByRole('button', { name: /Eliminar/ }).last().click();
  await page.waitForSelector('text=Tu carrito está vacío');
  ok('TC-07', 'eliminar producto deja el carrito vacío', true);

  await page.goto(`${BASE}/producto/on-creatine-300g`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Aumentar cantidad' }).click();
  await page.getByRole('button', { name: 'Agregar al carrito' }).click();
  await page.waitForSelector('a[aria-label="Carrito, 2 productos"]');
  await page.goto(`${BASE}/checkout`, { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: 'Iniciar sesión', exact: true }).click();
  await page.getByRole('button', { name: 'Rellenar con la cuenta demo' }).click();
  await page.locator('form').getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await page.waitForURL(/\/checkout$/);
  ok('TC-08', 'login desde el checkout vuelve al checkout conservando el carrito', await page.waitForSelector('text=2 × Micronized Creatine Powder', { timeout: 5000 }).then(() => true).catch(() => false));
  await page.fill('#f-direccion', 'Residencial de prueba, casa 12');
  await page.getByLabel('Pago contra entrega (demostración)').check();
  await page.getByRole('button', { name: 'Confirmar pedido' }).click();
  await page.waitForSelector('text=Pedido confirmado');
  const numero = (await page.locator('strong:has-text("#")').first().innerText()).replace('#', '');
  ok('TC-08', `pedido confirmado en la interfaz (#${numero})`, /^\d+$/.test(numero));
  await page.goto(`${BASE}/producto/on-creatine-300g`, { waitUntil: 'networkidle' });
  const stockDespues = Number((await page.locator('text=/\\d+ unidades$/').first().innerText()).match(/\d+/)[0]);
  ok('TC-08', `inventario actualizado en la ficha (${stockAntes} → ${stockDespues})`, stockDespues === stockAntes - 2);
  await page.goto(`${BASE}/pedidos`, { waitUntil: 'networkidle' });
  ok('TC-08', 'el pedido aparece en "Mis pedidos"', await page.locator(`text=#${numero}`).count());
  ok('UI', 'sin errores de JavaScript', errs.length === 0, errs.join('; '));
}

// ---------------- Widget Spot
{
  const page = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Abrir el chat con Spot/ }).click();
  ok('SPOT', 'mensaje de bienvenida y sugerencias visibles', await page.locator('text=Prueba con:').count());
  await page.fill('#spot-input', '¿Tienen disponible la proteína Gold Standard de 5 libras?');
  await page.keyboard.press('Enter');
  const typing = await page.waitForSelector('[aria-label="Spot está escribiendo"]', { timeout: 3000 }).then(() => true).catch(() => false);
  ok('SPOT', 'indicador de escritura mientras responde', typing);
  await page.waitForSelector('text=Ver ficha', { timeout: 30000 });
  ok('SPOT', 'envío con Enter y tarjeta de producto con precio real', await page.locator('section[aria-label="Chat con Spot"] >> text=$62.99').count());
  await page.getByRole('button', { name: 'Iniciar una conversación nueva' }).click();
  ok('SPOT', 'reiniciar conversación vuelve a la bienvenida', await page.locator('text=Prueba con:').count());
}

// ---------------- TC-09 responsive
for (const [nombre, w, h] of [['móvil', 390, 844], ['tablet', 820, 1180], ['escritorio', 1440, 900]]) {
  const page = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage();
  for (const path of ['/', '/productos', '/producto/iso100-5lb', '/carrito', '/checkout', '/pedidos', '/cuenta', '/nosotros', '/contacto']) {
    await page.goto(BASE + path, { waitUntil: 'networkidle' });
    const desborde = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    if (desborde) ok('TC-09', `${nombre} ${path} sin desbordamiento horizontal`, false);
  }
  const navOk = w < 1024 ? await page.getByRole('button', { name: 'Abrir menú' }).isVisible() : await page.getByRole('navigation', { name: 'Principal' }).isVisible();
  ok('TC-09', `${nombre} (${w}px): 9 páginas sin desbordamiento; navegación adecuada`, navOk);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Abrir el chat con Spot/ }).click();
  const box = await page.locator('section[aria-label="Chat con Spot"]').boundingBox();
  ok('TC-09', `${nombre}: el chat cabe en pantalla`, box && box.x >= 0 && box.x + box.width <= w + 1 && box.y >= 0);
}

await browser.close();
const n = res.filter((r) => r.ok).length;
console.log(`\nUI: ${n}/${res.length} verificaciones aprobadas`);
process.exit(n === res.length ? 0 : 1);
