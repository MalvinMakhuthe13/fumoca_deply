// Studio Look tab in Chromium (stub three + stub Spark): lighting + shadow,
// start view / zoom limits / spin preview, and saved state.
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { chromium } from 'playwright';

const root = new URL('../../', import.meta.url);
const stubThree = `
export class Vector3 { constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;}
  set(x,y,z){this.x=x;this.y=y;this.z=z;return this;} copy(v){return this.set(v.x,v.y,v.z);} clone(){return new Vector3(this.x,this.y,this.z);}
  sub(v){this.x-=v.x;this.y-=v.y;this.z-=v.z;return this;} add(v){this.x+=v.x;this.y+=v.y;this.z+=v.z;return this;}
  normalize(){const l=Math.hypot(this.x,this.y,this.z)||1;this.x/=l;this.y/=l;this.z/=l;return this;}
  distanceTo(v){return Math.hypot(this.x-v.x,this.y-v.y,this.z-v.z);}
  applyAxisAngle(a,t){const c=Math.cos(t),s=Math.sin(t),d=a.x*this.x+a.y*this.y+a.z*this.z;const cx=a.y*this.z-a.z*this.y,cy=a.z*this.x-a.x*this.z,cz=a.x*this.y-a.y*this.x;return this.set(this.x*c+cx*s+a.x*d*(1-c),this.y*c+cy*s+a.y*d*(1-c),this.z*c+cz*s+a.z*d*(1-c));} }
export class Quaternion { set(x,y,z,w){this.x=x;this.y=y;this.z=z;this.w=w;return this;} }
class Obj { constructor(){this.children=[];this.position=new Vector3();this.scale=new Vector3(1,1,1);this.rotation={};this.visible=true;} add(o){o.parent=this;this.children.push(o);} remove(o){this.children=this.children.filter(c=>c!==o);} }
export class Group extends Obj {}
export class Mesh extends Obj { constructor(g,m){super();this.geometry=g;this.material=m;} }
export class PlaneGeometry { dispose(){} }
export class MeshBasicMaterial { constructor(o){Object.assign(this,o);} dispose(){} }
export class DataTexture { constructor(d,w,h){this.image={data:d,width:w,height:h};} dispose(){} }
export const RGBAFormat = 1, LinearFilter = 1;
export class Color { constructor(h){ this.hex = h; } setRGB(r,g,b){this.r=r;this.g=g;this.b=b;return this;} }
`;
const fixture = `<!doctype html><meta charset=utf-8>
<script type="importmap">{"imports":{"three":"/stub-three.js"}}</script>
<div id="root"></div>
<script type="module">
import * as T from 'three';
const N = 2000, rows = [];
for (let i = 0; i < N; i++) {           // a little standing column on a floor
  const floor = i < 1000, a = i * 2.4;
  rows.push(floor ? { c: [Math.cos(a) * Math.sqrt(i / 1000), 0, Math.sin(a) * Math.sqrt(i / 1000)], s: [0.04, 0.04, 0.002], q: [Math.SQRT1_2, 0, 0, Math.SQRT1_2], a: 0.9, col: [0.5, 0.5, 0.5] }
                  : { c: [0.1 * Math.cos(a), (i - 1000) / 1000, 0.1 * Math.sin(a)], s: [0.03, 0.03, 0.03], q: [0, 0, 0, 1], a: 0.9, col: [0.5, 0.5, 0.5] });
}
class M extends T.Group {}
const mesh = new M(); mesh.initialized = Promise.resolve();
mesh.packedSplats = { numSplats: N, needsUpdate: false,
  forEachSplat(cb) { rows.forEach((r, i) => cb(i, { x: r.c[0], y: r.c[1], z: r.c[2] }, { x: r.s[0], y: r.s[1], z: r.s[2] }, { x: r.q[0], y: r.q[1], z: r.q[2], w: r.q[3] }, r.a, { r: r.col[0], g: r.col[1], b: r.col[2] })); },
  setSplat(i, c, s, q, a, col) { rows[i] = { c: [c.x, c.y, c.z], s: [s.x, s.y, s.z], q: [q.x, q.y, q.z, q.w], a, col: [col.r, col.g, col.b] }; } };
window.rows = rows; window.mesh = mesh;
window.FumocaSparkGaussian = { isEnabled: () => true, getMesh: () => mesh };
window.scene = { background: 'orig' };
window.renderer = { domElement: Object.assign(document.createElement('canvas'), {}) };
document.body.appendChild(Object.assign(document.createElement('div'), { id: 'host' })).appendChild(window.renderer.domElement);
window.camera = { position: new T.Vector3(0, 1, 4), up: new T.Vector3(0, 1, 0), fov: 50, lookAt() {}, updateProjectionMatrix() {} };
window.controls = { target: new T.Vector3(0, 0.5, 0), enableZoom: true, enableRotate: true, enablePan: false, minDistance: 0, maxDistance: Infinity, update() {}, domElement: document.body };
window.__changes = 0; window.addEventListener('fumoca:lookChange', () => window.__changes++);
const { mountLookPanel } = await import('/js/modules/look-panel.js');
window.panel = mountLookPanel(document.getElementById('root'));
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

  // Lighting on: floor lit from overhead, shadow plane appears under the splat
  await page.evaluate(() => { const el = document.getElementById('lkEl'); el.value = '80'; el.dispatchEvent(new Event('input')); });
  await page.click('#lkOn');
  await page.waitForFunction(() => window.mesh.children.some(c => c.name === 'fumoca-splat-shadow' && c.visible), null, { timeout: 5000 });
  const lit = await page.evaluate(() => ({ floor: window.rows[900].col[0], under: window.rows[10].col[0], shadowY: window.mesh.children.find(c => c.name === 'fumoca-splat-shadow').position.y }));
  assert.ok(lit.floor > 0.6, 'open floor lit by the overhead light: ' + lit.floor);
  assert.ok(lit.under < lit.floor - 0.15, `floor under the column is in its shadow: ${lit.under.toFixed(2)} vs ${lit.floor.toFixed(2)}`);
  assert.ok(Math.abs(lit.shadowY) < 0.01, 'shadow on the floor');
  // move the light to a low angle: shadow stretches, floor dims
  await page.evaluate(() => { const el = document.getElementById('lkEl'); el.value = '15'; el.dispatchEvent(new Event('input')); });
  await page.waitForTimeout(300);
  const low = await page.evaluate(() => ({ floor: window.rows[10].col[0], w: window.mesh.children.find(c => c.name === 'fumoca-splat-shadow').scale.x }));
  assert.ok(low.floor < lit.floor, 'lower light, darker floor');
  assert.ok(low.w > 1.5, 'long shadow from a low light: ' + low.w);
  // off restores the scan colours exactly
  await page.click('#lkOn');
  await page.waitForTimeout(300);
  assert.ok(await page.evaluate(() => window.rows.every(r => Math.abs(r.col[0] - 0.5) < 1e-6)), 'lighting off restores colours');
  assert.equal(await page.evaluate(() => window.panel.getLighting()), null);
  await page.click('#lkOn');
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.panel.getLighting().enabled), true);

  // Moods: Neon tints, sets background + vignette; Natural restores everything
  await page.click('[data-mood="neon"]');
  await page.waitForTimeout(400);
  const neon = await page.evaluate(() => ({ bg: window.scene.background?.hex, vig: document.querySelector('.fumoca-vignette')?.style.opacity, on: document.getElementById('lkOn').checked,
    pinkSide: window.rows.slice(1000).some(r => r.col[0] > r.col[1] + 0.05), preset: window.panel.getLighting()?.preset }));
  assert.deepEqual([neon.bg, neon.vig, neon.on, neon.preset], ['#0b0614', '1', true, 'neon'], JSON.stringify(neon));
  assert.ok(neon.pinkSide, 'neon pink key light visible');
  await page.evaluate(() => { const el = document.getElementById('lkExp'); el.value = '0.5'; el.dispatchEvent(new Event('input')); });
  assert.equal(await page.evaluate(() => window.panel.getLighting().preset), 'custom', 'tweaking makes it your own');
  await page.click('[data-mood="natural"]');
  await page.waitForTimeout(400);
  const nat = await page.evaluate(() => ({ bg: window.scene.background, vig: document.querySelector('.fumoca-vignette')?.style.opacity,
    clean: window.rows.every(r => Math.abs(r.col[0] - 0.5) < 1e-6) }));
  assert.deepEqual(nat, { bg: 'orig', vig: '0', clean: true }, 'Natural restores scan colours, background and no vignette');
  await page.click('#lkOn'); await page.waitForTimeout(200);

  // Lamps: add one at the view centre (a room light), switch it off/on like a hotspot would
  await page.click('#lkLampView');
  await page.waitForTimeout(300);
  const lampId = await page.evaluate(() => window.panel.lamps()[0].id);
  const nearLamp = await page.evaluate(() => window.rows.findIndex(r => Math.hypot(r.c[0], r.c[1] - 0.5, r.c[2]) < 0.12));
  const onCol = await page.evaluate(i => window.rows[i].col[0], nearLamp);
  await page.evaluate(id => window.panel.setLamp(id, 'off'), lampId);
  const offCol = await page.evaluate(i => window.rows[i].col[0], nearLamp);
  assert.ok(onCol > offCol + 0.02, `light switch dims the room ${onCol} → ${offCol}`);
  assert.equal(await page.evaluate(() => window.panel.lamps()[0].on), false);
  await page.evaluate(id => window.panel.setLamp(id, 'on'), lampId);
  assert.ok(Math.abs((await page.evaluate(i => window.rows[i].col[0], nearLamp)) - onCol) < 1e-6, 'and back on');
  assert.equal(await page.evaluate(() => window.panel.getLighting().lamps.length), 1, 'lamp saved with the look');

  // View: capture start, zoom limits, spin, steady; preview applies to the Studio camera
  await page.click('#vwCapture');
  await page.evaluate(() => { const s = document.getElementById('vwSpin'); s.value = '30'; s.dispatchEvent(new Event('input'));
    const m = document.getElementById('vwMax'); m.value = '2'; m.dispatchEvent(new Event('input')); });
  const view = await page.evaluate(() => window.panel.getView());
  assert.deepEqual(view.startView.position, [0, 1, 4]); assert.equal(view.spin, 30); assert.equal(view.zoomMax, 2);
  await page.click('#vwPreview');
  await page.waitForTimeout(300);
  const pv = await page.evaluate(() => ({ max: window.controls.maxDistance, x: window.camera.position.x }));
  assert.ok(Math.abs(pv.max - 2 * Math.hypot(0, 0.5, 4)) < 1e-6, 'zoom limit applied in preview');
  assert.ok(pv.x !== 0, 'spinning in preview');
  await page.click('#vwPreview');
  assert.equal(await page.evaluate(() => window.controls.maxDistance), Infinity, 'stopping preview gives Studio its controls back');
  assert.ok(await page.evaluate(() => window.__changes) >= 2, 'changes announced for saving');

  // Reopening a NIF restores both
  await page.evaluate((v) => { window._fumocaCurrentRecord = { meta: { present: { lighting: { enabled: true, azimuth: 120, elevation: 33, color: '#ff8800' }, view: { ...v, fixed: true } } } }; window.dispatchEvent(new CustomEvent('fumoca:fileLoaded')); }, view);
  const restored = await page.evaluate(() => ({ az: +document.getElementById('lkAz').value, fixed: document.getElementById('vwFixed').checked, col: document.getElementById('lkCol').value }));
  assert.deepEqual(restored, { az: 120, fixed: true, col: '#ff8800' });
  assert.deepEqual(errors, []);
  console.log('look-panel browser: all checks passed');
} finally {
  await browser?.close();
  server.close();
}
