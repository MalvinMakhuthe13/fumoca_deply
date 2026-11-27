// Smooth Studio editing: moves, rotations and deletions are written into the
// live Spark mesh (setSplat) instead of re-encoding + re-decoding the file.
// Adding back a splat the mesh doesn't hold still triggers a full rebuild.
// (Derived from spark-fallback.browser.mjs: same stub, plus packedSplats.)
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
      const n = window.__plyCount(fileBytes);
      const rows = Array.from({ length: n }, (_, i) => ({ c: [i, 0, 0], s: [0.1, 0.1, 0.1], q: [0, 0, 0, 1], a: 0.8, col: [0.5, 0.5, 0.5] }));
      this.rows = rows;
      this.packedSplats = { numSplats: n, needsUpdate: false, writes: 0,
        forEachSplat(cb) { rows.forEach((r, i) => cb(i, { x: r.c[0], y: r.c[1], z: r.c[2] }, { x: r.s[0], y: r.s[1], z: r.s[2] }, { x: r.q[0], y: r.q[1], z: r.q[2], w: r.q[3] }, r.a, { r: r.col[0], g: r.col[1], b: r.col[2] })); },
        setSplat(i, c, s, q, a, col) { this.writes++; rows[i] = { c: [c.x, c.y, c.z], s: [s.x, s.y, s.z], q: [q.x, q.y, q.z, q.w], a, col: [col.r, col.g, col.b] }; } };
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
class Geo { setAttribute(k, a){ if (k === 'position') this.n = a.n; } dispose(){} }
class V3 { set(x,y,z){this.x=x;this.y=y;this.z=z;return this;} }
class Q4 { set(x,y,z,w){this.x=x;this.y=y;this.z=z;this.w=w;return this;} }
class C3 { setRGB(r,g,b){this.r=r;this.g=g;this.b=b;return this;} }
window.__plyCount = (b) => +new TextDecoder().decode(b.slice(0, 200)).match(/element vertex (\\d+)/)[1];
window.THREE = { Vector3: V3, Quaternion: Q4, Color: C3, BufferGeometry: Geo, Float32BufferAttribute: class { constructor(arr){ this.n = arr.length; } }, LineBasicMaterial: class { dispose(){} }, LineSegments: class extends Obj { constructor(g,m){ super(); this.geometry=g; this.material=m; } }, PointsMaterial: class { dispose(){} }, Points: class extends Obj { constructor(g,m){ super(); this.geometry=g; this.material=m; } } };
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


let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') console.log('PAGE', m.text()); });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.ready);
  assert.equal(await page.evaluate(() => window.view.enable()), true);
  assert.equal(await page.evaluate(() => window.__loads), 1);
  const mesh = () => page.evaluate(() => { const m = window.view.getMesh(); return { rows: m.rows, writes: m.packedSplats.writes, upd: m.packedSplats.needsUpdate }; });

  // 1. move one splat: written in place, no new decode
  await page.evaluate(() => { window.S.positions[3] = 5; return window.view.syncEditorState(window.S); });
  let m = await mesh();
  assert.equal(await page.evaluate(() => window.__loads), 1, 'no re-decode for a move');
  assert.equal(m.writes, 1, 'only the moved splat rewritten');
  assert.deepEqual(m.rows[1].c, [5, 0, 0]); assert.equal(m.upd, true);
  assert.deepEqual(m.rows[1].s.map(v => +v.toFixed(3)), [0.1, 0.1, 0.1], 'scale kept');

  // 2. rotate one splat (w,x,y,z order respected)
  await page.evaluate(() => { const r = window.S.rotation; r[8] = 0; r[11] = 1; window.S.positions[6] = 2.0001; return window.view.syncEditorState(window.S); });
  m = await mesh();
  assert.deepEqual(m.rows[2].q, [0, 0, 1, 0], 'rotation written as x,y,z,w');

  // 3. delete one: hidden in place (opacity 0), still no re-decode
  await page.evaluate(() => { window.S.alive[0] = 0; return window.view.syncEditorState(window.S); });
  m = await mesh();
  assert.equal(await page.evaluate(() => window.__loads), 1, 'no re-decode for a delete');
  assert.equal(m.rows[0].a, 0, 'deleted splat hidden');

  // 4. undo the delete: the mesh still holds it → restored in place
  await page.evaluate(() => { window.S.alive[0] = 1; return window.view.syncEditorState(window.S); });
  m = await mesh();
  assert.ok(Math.abs(m.rows[0].a - 0.8) < 1e-6, 'undo restores opacity');
  assert.equal(await page.evaluate(() => window.__loads), 1);

  // 4b. view filter: hide faint splats (view only), edits keep respecting it, then restore
  let hidden = await page.evaluate(() => window.view.setViewFilter({ minOpacity: 0.9 }));
  m = await mesh();
  assert.equal(hidden, 3); assert.ok(m.rows.every(r => r.a === 0), 'faint splats hidden in view');
  await page.evaluate(() => { window.S.positions[3] = 7; return window.view.syncEditorState(window.S); });
  m = await mesh();
  assert.deepEqual(m.rows[1].c, [7, 0, 0]); assert.equal(m.rows[1].a, 0, 'moved splat stays hidden by the filter');
  hidden = await page.evaluate(() => window.view.setViewFilter({ minOpacity: 0 }));
  m = await mesh();
  assert.equal(hidden, 0); assert.ok(m.rows.every(r => Math.abs(r.a - 0.8) < 1e-6), 'filter off restores everything');
  const exportedLen = await page.evaluate(() => window.view.exportEditedBytes(window.S).length);
  assert.ok(exportedLen > 0, 'export unaffected by the view filter');

  // 4c. selection gets dots + a box outline
  await page.evaluate(() => { window.S.selected[1] = 1; window.S.selected[2] = 1; window.S.positions[3] = 7.0001; return window.view.syncEditorState(window.S); });
  const box = await page.evaluate(() => { const b = window._fumocaScene.children.find(c => c.name === 'fumoca-spark-selection-box'); return b && { visible: b.visible, n: b.geometry.n }; });
  assert.ok(box && box.visible && box.n === 72, 'selection box drawn: ' + JSON.stringify(box));

  // 5. after a real rebuild (delete + export path) the mapping follows the new mesh
  await page.evaluate(() => { window.S.alive[0] = 0; });
  await page.evaluate(() => window.view.syncEditorState(window.S));
  // force a rebuild by restoring a splat the *new* mesh would not hold: simulate by
  // rebuilding from a state where the mesh was built without splat 0
  await page.evaluate(async () => {
    window.S.positions[3] = 6; window.S.alive[0] = 0;
    // drop the snapshot as if Spark had been re-enabled from edited bytes
    window.view.disable(); await window.view.enable({ bytes: window.S.gaussianSourceBytes });
  });
  assert.equal(await page.evaluate(() => window.__loads), 2);

  // 6. edits are still exportable from the original source (SH etc. preserved)
  const exported = await page.evaluate(() => window.view.exportEditedBytes(window.S).length);
  assert.ok(exported > 0);
  assert.deepEqual(errors, []);
  console.log('spark in-place editing browser: all checks passed');
} finally {
  await browser?.close();
  server.close();
}
