// Studio Rig tab end-to-end in Chromium with a stub three.js and a stub
// Spark mesh: add skeleton → move a joint → pose → preset motion plays →
// keyframe → state persists and restores → remove puts splats back.
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { chromium } from 'playwright';

const root = new URL('../../', import.meta.url);
const stubThree = `
export class Vector3 { constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;} set(x,y,z){this.x=x;this.y=y;this.z=z;return this;} }
export class Quaternion { constructor(x=0,y=0,z=0,w=1){this.x=x;this.y=y;this.z=z;this.w=w;} set(x,y,z,w){this.x=x;this.y=y;this.z=z;this.w=w;return this;} }
export class Color { constructor(){this.r=1;this.g=1;this.b=1;} setRGB(r,g,b){this.r=r;this.g=g;this.b=b;return this;} }
class Obj { constructor(){this.children=[];this.parent=null;this.visible=true;} add(...c){c.forEach(x=>{x.parent?.remove(x);x.parent=this;this.children.push(x);});return this;} remove(c){this.children=this.children.filter(x=>x!==c);c.parent=null;return this;} }
export class Group extends Obj {}
export class BufferGeometry { constructor(){this.attributes={};} setAttribute(n,a){this.attributes[n]=a;return this;} }
export class Float32BufferAttribute { constructor(a,k){this.array=Float32Array.from(a);this.itemSize=k;this.count=a.length/k;} }
export class LineBasicMaterial { constructor(o){Object.assign(this,o);} }
export class PointsMaterial { constructor(o){Object.assign(this,o);} }
export class LineSegments extends Obj { constructor(g,m){super();this.geometry=g;this.material=m;} }
export class Points extends Obj { constructor(g,m){super();this.geometry=g;this.material=m;} }
export class Object3D extends Obj {}
`;
const fixture = `<!doctype html><meta charset=utf-8>
<script type="importmap">{"imports":{"three":"/stub-three.js"}}</script>
<div id="tab-rig"></div>
<script type="module">
import * as THREE from 'three';
// Stub Spark mesh: a standing "person" column 0..2 in y, arms out along x at y≈1.6
const N = 3000, data = [];
for (let i = 0; i < N; i++) {
  const arm = i % 5 === 0;
  const y = arm ? 1.6 + (Math.random() - 0.5) * 0.05 : 2 * Math.random();
  const x = arm ? (Math.random() * 2 - 1) * 0.9 : (Math.random() - 0.5) * 0.3;
  data.push({ c: [x, y, (Math.random() - 0.5) * 0.2], s: [0.01, 0.01, 0.01], q: [0, 0, 0, 1], a: 0.9, col: [0.5, 0.5, 0.5] });
}
window.restCopy = JSON.parse(JSON.stringify(data));
class Mesh extends THREE.Group {}
const mesh = new Mesh();
mesh.name = 'fumoca-spark-splat';
mesh.initialized = Promise.resolve();
mesh.packedSplats = { numSplats: N, needsUpdate: false, writes: 0,
  forEachSplat(cb) { data.forEach((d, i) => cb(i, new THREE.Vector3(...d.c), new THREE.Vector3(...d.s), new THREE.Quaternion(...d.q), d.a, Object.assign(new THREE.Color(), { r: d.col[0], g: d.col[1], b: d.col[2] }))); },
  setSplat(i, c, s, q, a, col) { this.writes++; data[i] = { c: [c.x, c.y, c.z], s: [s.x, s.y, s.z], q: [q.x, q.y, q.z, q.w], a, col: [col.r, col.g, col.b] }; } };
window.meshData = data; window.mesh = mesh;
window.FumocaSparkGaussian = { isEnabled: () => true, getMesh: () => mesh };
window.__events = [];
window.addEventListener('fumoca:rigChange', e => window.__events.push(e.detail));
const { mountSplatRigPanel } = await import('/js/modules/splat-rig-panel.js');
window.panel = mountSplatRigPanel(document.getElementById('tab-rig'));
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
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.ready, null, { timeout: 10000 });

  // 1. add a human skeleton
  await page.selectOption('#rigTemplate', 'human');
  await page.click('#rigFit');
  assert.match(await page.textContent('#rigStatus'), /12 bones/, 'skeleton added');
  assert.equal(await page.evaluate(() => document.getElementById('rigBonesSection').style.display), '', 'bone controls shown');
  assert.equal(await page.evaluate(() => window.mesh.children.some(c => c.name === 'fumoca-rig-overlay')), true, 'bones drawn inside the splat');
  assert.equal(await page.evaluate(() => window.__events.length > 0 && window.__events.at(-1).rig.bones.length), 12, 'rig change emitted');

  // 2. move the left upper arm joint; connected bones follow
  await page.selectOption('#rigBone', { label: 'upperarm.L' });
  const before = await page.evaluate(() => window.panel.getState().rig.bones.find(b => b.name === 'upperarm.L').head[1]);
  await page.evaluate(() => { const s = document.getElementById('rigJY'); s.value = String(+s.value - 0.1); s.dispatchEvent(new Event('input')); });
  await page.waitForTimeout(450);
  const st = await page.evaluate(() => window.panel.getState().rig.bones);
  const ua = st.find(b => b.name === 'upperarm.L');
  assert.ok(Math.abs(ua.head[1] - (before - 0.1)) < 0.006, 'joint moved ' + ua.head[1] + ' vs ' + before);
  assert.ok(st.filter(b => Math.abs(b.tail[1] - ua.head[1]) < 1e-9 || Math.abs(b.head[1] - ua.head[1]) < 1e-9).length >= 1, 'connected ends follow');

  await page.selectOption('#rigBone', { label: 'spine' });
  await page.evaluate(() => { const s = document.getElementById('rigJY'); s.value = String(+s.value + 0.05); s.dispatchEvent(new Event('input')); });
  await page.waitForTimeout(450);
  const b2 = await page.evaluate(() => Object.fromEntries(window.panel.getState().rig.bones.map(b => [b.name, b])));
  assert.deepEqual(b2.hips.tail, b2.spine.head, 'hips stays connected to spine when the joint moves');
  await page.selectOption('#rigBone', { label: 'upperarm.L' });

  // 3. pose the arm: arm splats move, leg splats stay
  await page.evaluate(() => { window.mesh.packedSplats.writes = 0; const s = document.getElementById('rigPZ'); s.value = '80'; s.dispatchEvent(new Event('input')); });
  const moved = await page.evaluate(() => {
    let armMoved = 0, legMoved = 0;
    window.meshData.forEach((d, i) => {
      const r = window.restCopy[i], dist = Math.hypot(d.c[0] - r.c[0], d.c[1] - r.c[1], d.c[2] - r.c[2]);
      if (r.c[0] > 0.5 && r.c[1] > 1.5) armMoved += dist > 0.05; if (r.c[1] < 0.6) legMoved += dist > 1e-4;
    });
    return { armMoved, legMoved, writes: window.mesh.packedSplats.writes, upd: window.mesh.packedSplats.needsUpdate };
  });
  assert.ok(moved.armMoved > 50, 'left arm splats follow the bone: ' + moved.armMoved);
  assert.equal(moved.legMoved, 0, 'legs unaffected');
  assert.ok(moved.writes > 0 && moved.writes < 3000, 'only affected splats rewritten: ' + moved.writes);
  assert.equal(moved.upd, true, 'Spark told to re-upload');

  // 4. preset motion plays
  await page.selectOption('#rigPreset', 'walk');
  await page.click('#rigUsePreset');
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => window.panel.driver.playing), true, 'walk plays');
  const t1 = await page.evaluate(() => +document.getElementById('rigTime').value);
  await page.waitForTimeout(300);
  assert.notEqual(await page.evaluate(() => +document.getElementById('rigTime').value), t1, 'time advances');
  await page.click('#rigPlay');
  assert.equal(await page.evaluate(() => window.panel.driver.playing), false, 'pause works');

  // 5. keyframe: scrub, pose head, add key
  await page.evaluate(() => { const t = document.getElementById('rigTime'); t.value = '0.5'; t.dispatchEvent(new Event('input')); });
  await page.selectOption('#rigBone', { label: 'head' });
  await page.evaluate(() => { const s = document.getElementById('rigPX'); s.value = '-30'; s.dispatchEvent(new Event('input')); });
  await page.click('#rigKey');
  const saved = await page.evaluate(() => window.panel.getState());
  assert.ok(saved.clip.tracks.head?.some(k => Math.abs(k.t - 0.5) < 1e-6), 'head key stored at 0.5 s');
  assert.ok(saved.clip.tracks['thigh.L'], 'walk tracks kept');
  assert.ok(JSON.stringify(saved).length < 60000, 'saved state is small');

  // 6. restore from saved state (as when reopening the NIF)
  await page.click('#rigRemove');
  const restored = await page.evaluate(() => window.meshData.every((d, i) => d.c.every((v, k) => Math.abs(v - window.restCopy[i].c[k]) < 1e-5)));
  assert.equal(restored, true, 'remove puts every splat back');
  assert.equal(await page.evaluate(() => window.panel.getState()), null);
  assert.equal(await page.evaluate(s => window.panel.setState(s), saved), true, 'saved rig restores');
  assert.equal(await page.evaluate(() => window.panel.getState().clip.tracks.head.length >= 2), true, 'motion restored');

  // 7. hostile saved state is refused
  assert.equal(await page.evaluate(() => window.panel.setState({ rig: { bones: [{ name: '<img src=x onerror=alert(1)>', head: [0, 0, 0], tail: [0, 1, 0], parent: 'nope' }] } })), false);
  assert.equal(await page.evaluate(() => document.querySelector('#tab-rig img')), null, 'no injected markup');

  assert.deepEqual(errors, [], 'no page errors');
  console.log('splat-rig-panel browser: all checks passed');
} finally {
  await browser?.close();
  server.close();
}
