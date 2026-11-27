// Studio Parts tab + hotspot "part"/"lighting" actions in Chromium (stub three + stub Spark).
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { chromium } from 'playwright';

const root = new URL('../../', import.meta.url);
const stubThree = `
export class Vector3 { constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;} set(x,y,z){this.x=x;this.y=y;this.z=z;return this;} }
export class Quaternion { set(x,y,z,w){this.x=x;this.y=y;this.z=z;this.w=w;return this;} }
export class Color { setRGB(r,g,b){this.r=r;this.g=g;this.b=b;return this;} }
`;
const fixture = `<!doctype html><meta charset=utf-8>
<script type="importmap">{"imports":{"three":"/stub-three.js"}}</script>
<div id="root"></div>
<script type="module">
const rows = [], P = [];
for (let i = 0; i < 1500; i++) { const c = [Math.random() * 2 - 1, Math.random(), Math.random() * 0.9]; rows.push({ c, s: [0.02,0.02,0.02], q: [0,0,0,1], a: 0.9, col: [0.4,0.4,0.4] }); P.push(...c); }
const doorStart = rows.length;
for (let i = 0; i < 400; i++) { const c = [(i % 20) / 20, Math.floor(i / 20) / 20, 1.0]; rows.push({ c, s: [0.02,0.02,0.002], q: [0,0,0,1], a: 0.9, col: [0.8,0.1,0.1] }); P.push(...c); }
const n = rows.length;
window.S = { positions: Float32Array.from(P), alive: new Uint8Array(n).fill(1), selected: new Uint8Array(n) };
const mesh = { initialized: Promise.resolve(), packedSplats: { numSplats: n, needsUpdate: false,
  forEachSplat(cb) { rows.forEach((r, i) => cb(i, { x: r.c[0], y: r.c[1], z: r.c[2] }, { x: r.s[0], y: r.s[1], z: r.s[2] }, { x: r.q[0], y: r.q[1], z: r.q[2], w: r.q[3] }, r.a, { r: r.col[0], g: r.col[1], b: r.col[2] })); },
  setSplat(i, c, s, q, a, col) { rows[i] = { c: [c.x, c.y, c.z], s: [s.x, s.y, s.z], q: [q.x, q.y, q.z, q.w], a, col: [col.r, col.g, col.b] }; } } };
window.rows = rows; window.doorStart = doorStart;
window.FumocaSparkGaussian = { isEnabled: () => true, getMesh: () => mesh };
window.__changes = [];
window.addEventListener('fumoca:partsChange', e => window.__changes.push(e.detail));
const { mountPartsPanel } = await import('/js/modules/parts-panel.js');
window.panel = mountPartsPanel(document.getElementById('root'));
window.actions = await import('/js/modules/hotspot-actions.js');
window.ready = true;
</script>`;

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(fixture); return; }
  if (url === '/stub-three.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(stubThree); return; }
  if (/^\/js\/modules\/[\w.-]+\.js$/.test(url)) {
    try { const body = await readFile(new URL('.' + url, root)); res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(body); return; } catch {}
  }
  res.writeHead(404); res.end();
});
const probe = createServer();
await new Promise(r => probe.listen(0, '127.0.0.1', r));
const port = probe.address().port;
await new Promise(r => probe.close(r));
server.listen(port, '127.0.0.1');
await new Promise(r => server.once('listening', r));

let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.ready, null, { timeout: 10000 });

  // nothing selected → helpful message
  await page.click('#ptMake');
  assert.match(await page.textContent('#ptStatus'), /Select the part first/);

  // lasso the door, call it a car door, make the part
  await page.evaluate(() => { for (let i = window.doorStart; i < window.rows.length; i++) window.S.selected[i] = 1; });
  await page.selectOption('#ptKind', 'carDoor');
  await page.click('#ptMake');
  assert.match(await page.textContent('#ptStatus'), /Driver door made from 400/);
  assert.match(await page.textContent('#ptList'), /400 splats/);

  // hinge on the left edge, swing it open with the slider, then play to close
  await page.selectOption('#ptSide', 'left');
  await page.evaluate(() => { const a = document.getElementById('ptAngle'); a.value = '-90'; a.dispatchEvent(new Event('input')); a.dispatchEvent(new Event('change')); });
  await page.evaluate(() => { const o = document.getElementById('ptOpen'); o.value = '1'; o.dispatchEvent(new Event('input')); });
  const open = await page.evaluate(() => window.rows[window.doorStart + 19].c);
  assert.ok(open[2] > 1.8, 'door swung out: ' + open);
  assert.ok(await page.evaluate(() => window.rows.slice(0, window.doorStart).every(r => r.c[2] <= 0.9 + 1e-9)), 'car body untouched');
  // other way
  await page.click('#ptFlip');
  const flipped = await page.evaluate(() => window.rows[window.doorStart + 19].c);
  assert.ok(flipped[2] < 0.2, 'reversed swing: ' + flipped);
  await page.click('#ptFlip');

  // saved for the viewer
  const saved = await page.evaluate(() => window.panel.getParts());
  assert.equal(saved.length, 1); assert.equal(saved[0].name, 'Driver door'); assert.equal(saved[0].motion.angle, -90);
  assert.ok((await page.evaluate(() => window.__changes.length)) >= 1);

  // hotspot action drives it (what the published viewer does)
  const id = saved[0].id;
  await page.evaluate(() => { const o = document.getElementById('ptOpen'); o.value = '0'; o.dispatchEvent(new Event('input')); });
  await page.evaluate((pid) => window.actions.runAction({ type: 'part', partId: pid, to: 'open' }), id);
  assert.ok((await page.evaluate(() => window.rows[window.doorStart + 19].c[2])) > 1.8, 'hotspot opened the door smoothly');
  await page.evaluate((pid) => window.actions.runAction({ type: 'part', partId: pid }), id);
  assert.ok(Math.abs((await page.evaluate(() => window.rows[window.doorStart + 19].c[2])) - 1) < 1e-6, 'hotspot toggled it closed');

  // lighting actions: light switch + mood, via the Look API stand-in
  await page.evaluate(() => { window.__light = []; window.FumocaLook = { setLamp: (id, to) => window.__light.push(['lamp', id, to]), setMood: m => window.__light.push(['mood', m]) }; });
  await page.evaluate(() => window.actions.runAction({ type: 'lighting', lampId: 'kitchen', to: 'on' }));
  await page.evaluate(() => window.actions.runAction({ type: 'lighting', mood: 'night' }));
  assert.deepEqual(await page.evaluate(() => window.__light), [['lamp', 'kitchen', 'on'], ['mood', 'night']]);
  const v = await page.evaluate(() => window.actions.validateActions([{ label: 'x', action: { type: 'part' } }, { label: 'y', action: { type: 'lighting' } }]));
  assert.equal(v.valid, false); assert.equal(v.errors.length, 2);

  // delete
  await page.click('#ptDelete');
  assert.match(await page.textContent('#ptList'), /No parts yet/);
  assert.deepEqual(errors, []);
  console.log('parts-panel browser: all checks passed');
} finally {
  await browser?.close();
  server.close();
}
