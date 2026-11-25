// Spark must never take the Studio viewport down with it.
// Runs js/modules/spark-gaussian-view.js in Chromium against a stub Spark
// module whose loads can be made to fail, and checks that:
//  - the previous splat stays visible while an edit re-decodes (no blank flash),
//  - one failed sync is retried and recovers,
//  - repeated failures fall back to the editor renderer (never an empty view),
//  - a lost WebGL context falls back the same way,
//  - Spark failing to load at all leaves the editor view on.
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { chromium } from 'playwright';

const moduleSource = await readFile(new URL('../../js/modules/spark-gaussian-view.js', import.meta.url), 'utf8');

const stubSpark = `
export class SparkRenderer { constructor(o){ this.opts=o; this.name=''; } dispose(){} }
export class SplatMesh {
  constructor({ fileBytes }) {
    this.bytes = fileBytes.length; this.visible = true; this.parent = null; this.disposed = false;
    window.__loads = (window.__loads || 0) + 1;
    const mode = window.__sparkMode || 'ok';
    let release;
    const gate = new Promise(r => { release = r; });
    window.__releaseLoad = release;
    this.initialized = (window.__holdLoads ? gate : Promise.resolve()).then(() => {
      if (mode === 'fail' || (mode === 'fail-once' && !window.__failedOnce && (window.__failedOnce = true))) {
        throw new Error('stub decode failure');
      }
      this.ready = true; // real Spark draws nothing until the splat has decoded
      return this;
    });
  }
  dispose(){ this.disposed = true; }
}`;

const fixture = `<!doctype html>
<script type="importmap">{"imports":{"@sparkjsdev/spark":"/stub-spark.js"}}</script>
<canvas id="c"></canvas>
<script>
// Minimal three-like scene graph.
class Obj { constructor(){ this.children=[]; this.parent=null; } add(o){ o.parent=this; this.children.push(o); } remove(o){ this.children=this.children.filter(c=>c!==o); o.parent=null; } }
Object.prototype.removeFromParent;
const scene = new Obj();
window._fumocaScene = scene;
window._fumocaGlRenderer = { domElement: document.getElementById('c') };
class Geo { setAttribute(){} dispose(){} }
window.THREE = { BufferGeometry: Geo, Float32BufferAttribute: class { constructor(){} }, PointsMaterial: class { dispose(){} }, Points: class extends Obj { constructor(g,m){ super(); this.geometry=g; this.material=m; } } };
// Patch remove-from-parent used by the module (obj.parent.remove(obj)).
// Build a 3-splat binary little-endian PLY with x,y,z,rot_0..3.
function ply(n){
  const header = 'ply\\nformat binary_little_endian 1.0\\nelement vertex '+n+'\\nproperty float x\\nproperty float y\\nproperty float z\\nproperty float rot_0\\nproperty float rot_1\\nproperty float rot_2\\nproperty float rot_3\\nend_header\\n';
  const h = new TextEncoder().encode(header); const out = new Uint8Array(h.length + n*28); out.set(h);
  const dv = new DataView(out.buffer, h.length); for (let i=0;i<n;i++){ dv.setFloat32(i*28, i, true); dv.setFloat32(i*28+12, 1, true); }
  return out;
}
window.S = { isGaussianPly:true, fileName:'t.ply', gaussianSourceBytes: ply(3),
  positions: new Float32Array([0,0,0, 1,0,0, 2,0,0]), alive: new Uint8Array([1,1,1]), selected: new Uint8Array(3),
  rotation: new Float32Array([1,0,0,0, 1,0,0,0, 1,0,0,0]), points: { visible: true } };
window.__events = [];
window.addEventListener('fumoca:sparkFallback', e => window.__events.push(e.detail));
window.showToast = (t) => { window.__toast = t; };
window.sparkMeshes = () => scene.children.filter(c => c.name === 'fumoca-spark-splat');
window.visibleSpark = () => window.sparkMeshes().filter(m => m.visible && m.ready && !m.disposed).length;
</script>
<script type="module">
import view from '/spark-gaussian-view.js';
window.view = view;
window.ready = true;
</script>`;

const server = http.createServer((req, res) => {
  if (req.url === '/' ) { res.writeHead(200, { 'content-type': 'text/html' }); res.end(fixture); return; }
  if (req.url === '/spark-gaussian-view.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(moduleSource); return; }
  if (req.url === '/stub-spark.js') {
    if (globalThis.__breakSpark) { res.writeHead(500); res.end('down'); return; }
    res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(stubSpark); return;
  }
  res.writeHead(404); res.end();
});
const probe = createServer();
await new Promise(r => probe.listen(0, '127.0.0.1', r));
const port = probe.address().port;
await new Promise(r => probe.close(r));
server.listen(port, '127.0.0.1');
await new Promise(r => server.once('listening', r));

const settle = page => page.waitForTimeout(120);
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const open = async () => {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.waitForFunction(() => window.ready);
    return page;
  };

  // 1. Enable, then edit with a slow decode: the old splat must stay on screen.
  let page = await open();
  assert.equal(await page.evaluate(() => window.view.enable()), true, 'Spark enables from PLY bytes');
  assert.equal(await page.evaluate(() => window.visibleSpark()), 1, 'one visible Spark splat after enable');
  assert.equal(await page.evaluate(() => window.S.points.visible), false, 'editor points hidden while Spark is active');
  await page.evaluate(() => { window.__holdLoads = true; window.S.positions[0] = 5; window.view.refreshEditorState(window.S); });
  await page.waitForFunction(() => window.__loads >= 2);
  assert.equal(await page.evaluate(() => window.visibleSpark()), 1, 'previous splat stays visible while the edit decodes (no blank flash)');
  await page.evaluate(() => { window.__holdLoads = false; window.__releaseLoad(); });
  await settle(page);
  assert.equal(await page.evaluate(() => window.sparkMeshes().length), 1, 'old splat is removed only after the new one is ready');
  assert.equal(await page.evaluate(() => window.visibleSpark()), 1, 'edited splat is visible');

  // 2. A single failed sync is retried and recovers without falling back.
  await page.evaluate(() => { window.__sparkMode = 'fail-once'; window.S.positions[3] = 7; window.view.refreshEditorState(window.S); });
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => window.view.isEnabled()), true, 'one failed sync does not abandon Spark');
  assert.equal(await page.evaluate(() => window.visibleSpark()), 1, 'last good splat stays visible through a failed sync');
  assert.equal(await page.evaluate(() => window.__events.length), 0, 'no fallback for a recovered failure');

  // 3. Repeated failures fall back to the editor view, never a blank viewport.
  await page.evaluate(() => { window.__sparkMode = 'fail'; window.S.positions[6] = 9; window.view.refreshEditorState(window.S); });
  await page.waitForFunction(() => window.__events.length > 0, null, { timeout: 5000 });
  assert.equal(await page.evaluate(() => window.view.isEnabled()), false, 'Spark disables after repeated failures');
  assert.equal(await page.evaluate(() => window.S.points.visible), true, 'editor view is shown instead');
  assert.equal(await page.evaluate(() => window.sparkMeshes().length), 0, 'no stale Spark splat left behind');
  assert.equal(await page.evaluate(() => window.__toast), 'Photoreal paused', 'user is told what happened');
  await page.close();

  // 4. GPU context loss falls back.
  page = await open();
  await page.evaluate(() => window.view.enable());
  await page.evaluate(() => document.getElementById('c').dispatchEvent(new Event('webglcontextlost')));
  assert.equal(await page.evaluate(() => window.view.isEnabled()), false, 'context loss disables Spark');
  assert.equal(await page.evaluate(() => window.S.points.visible), true, 'context loss shows the editor view');
  await page.close();

  // 5. Spark itself cannot be downloaded (CDN down): Studio keeps working.
  globalThis.__breakSpark = true;
  page = await open();
  assert.equal(await page.evaluate(() => window.view.enable()), false, 'enable reports failure');
  assert.equal(await page.evaluate(() => window.S.points.visible), true, 'editor view remains visible when Spark is unreachable');
  assert.equal(await page.evaluate(() => window.__events.at(-1)?.phase), 'enable', 'failure is announced');
  await page.close();
  console.log('Spark fallback browser test passed: no blank flash, retry, editor fallback, context loss, CDN outage.');
} finally {
  if (browser) await browser.close();
  await new Promise(r => server.close(r));
}
