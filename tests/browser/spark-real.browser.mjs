// Real Spark (self-hosted copy in vendor/) in Chromium: the in-place APIs our
// rig, lighting, parts and editing rely on, plus a real render.
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { extname } from 'node:path';
import { chromium } from 'playwright';

const root = new URL('../../', import.meta.url);
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html', '.json': 'application/json' };
const fixture = `<!doctype html><meta charset=utf-8><body style="margin:0;background:#000">
<script type="importmap">{"imports":{"three":"/vendor/three/0.180.0/build/three.module.js","three/addons/":"/vendor/three/0.180.0/examples/jsm/","@sparkjsdev/spark":"/vendor/sparkjsdev-spark/2.4.0/dist/spark.module.js"}}</script>
<canvas id="c" width="320" height="240"></canvas>
<script type="module">
try {
  const THREE = await import('three');
  window.THREE = THREE;
  const { SparkRenderer, SplatMesh, PackedSplats } = await import('@sparkjsdev/spark');
  const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('c'), antialias: false, preserveDrawingBuffer: true });
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 320 / 240, 0.01, 100);
  camera.position.set(0, 0, 3); camera.lookAt(0, 0, 0);
  scene.add(new SparkRenderer({ renderer }));
  // a binary 3DGS PLY: 400 orange splats on a disc
  const props = ['x','y','z','nx','ny','nz','f_dc_0','f_dc_1','f_dc_2','opacity','scale_0','scale_1','scale_2','rot_0','rot_1','rot_2','rot_3'];
  const n = 400, head = new TextEncoder().encode('ply\\nformat binary_little_endian 1.0\\nelement vertex ' + n + '\\n' + props.map(p => 'property float ' + p).join('\\n') + '\\nend_header\\n');
  const buf = new Uint8Array(head.length + n * props.length * 4); buf.set(head);
  const dv = new DataView(buf.buffer, head.length);
  for (let i = 0; i < n; i++) {
    const a = i * 2.4, r = Math.sqrt(i / n) * 0.8;
    const v = [r * Math.cos(a), r * Math.sin(a), 0, 0, 0, 1, (0.9 - 0.5) / 0.2821, (0.5 - 0.5) / 0.2821, (0.1 - 0.5) / 0.2821, 4, Math.log(0.04), Math.log(0.04), Math.log(0.04), 1, 0, 0, 0];
    v.forEach((x, k) => dv.setFloat32((i * props.length + k) * 4, x, true));
  }
  const mesh = new SplatMesh({ fileBytes: buf.buffer });
  await mesh.initialized;
  scene.add(mesh);
  window.mesh = mesh; window.scene = scene; window.camera = camera; window.renderer = renderer;
  window.renderOnce = () => { renderer.render(scene, camera); const g = renderer.getContext(); const px = new Uint8Array(320 * 240 * 4); g.readPixels(0, 0, 320, 240, g.RGBA, g.UNSIGNED_BYTE, px); let lit = 0, red = 0; for (let i = 0; i < px.length; i += 4) { if (px[i] + px[i+1] + px[i+2] > 60) lit++; red += px[i]; } return { lit, red }; };
  window.ready = true;
} catch (e) { window.failed = String(e && e.stack || e); }
</script>`;

const server = http.createServer(async (req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(fixture); return; }
  if (/^\/(vendor|js\/modules)\//.test(url) && !url.includes('..')) {
    try { const body = await readFile(new URL('.' + url, root)); res.writeHead(200, { 'content-type': TYPES[extname(url)] || 'application/octet-stream' }); res.end(body); return; } catch {}
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
  browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.ready || window.failed, null, { timeout: 60000 });
  const failed = await page.evaluate(() => window.failed);
  assert.equal(failed, undefined, 'Spark loaded from vendor/: ' + failed);

  const api = await page.evaluate(() => ({ n: window.mesh.packedSplats.numSplats, set: typeof window.mesh.packedSplats.setSplat, each: typeof window.mesh.packedSplats.forEachSplat, ver: typeof window.mesh.updateVersion }));
  assert.equal(api.n, 400); assert.equal(api.set, 'function'); assert.equal(api.each, 'function');

  // forEachSplat gives back what we wrote (position, colour, scale, opacity)
  const first = await page.evaluate(() => { let out; window.mesh.packedSplats.forEachSplat((i, c, s, q, a, col) => { if (i === 5) out = { c: [c.x, c.y, c.z], s: [s.x, s.y, s.z], a, col: [col.r, col.g, col.b] }; }); return out; });
  assert.ok(Math.abs(first.col[0] - 0.9) < 0.02 && Math.abs(first.col[2] - 0.1) < 0.02, 'colour decoded: ' + first.col);
  assert.ok(Math.abs(first.s[0] - 0.04) < 0.004, 'scale decoded'); assert.ok(first.a > 0.9, 'opacity decoded');

  // it renders
  // Spark sorts in a worker: render a few frames until splats show up
  const settle = (want) => page.evaluate(async (wantLit) => {
    let best = null;
    for (let k = 0; k < 40; k++) { const r = window.renderOnce(); if (!best || (wantLit ? r.lit > best.lit : r.lit < best.lit)) best = r; if (wantLit ? r.lit > 500 : r.lit < 50) return r; await new Promise(x => setTimeout(x, 100)); }
    return best;
  }, want);
  let px = await settle(true);
  assert.ok(px.lit > 500, 'splats visible on screen: ' + px.lit);

  // in-place update with setSplat + needsUpdate (what rig / lighting / parts / editing use)
  const moved = await page.evaluate(() => {
    const T = window.THREE, ps = window.mesh.packedSplats;
    ps.forEachSplat((i, c, s, q, a, col) => {
      ps.setSplat(i, new T.Vector3(c.x + 5, c.y, c.z), s.clone(), q.clone(), a, new T.Color(0, 0, 1));   // move everything off-screen, make blue
    });
    ps.needsUpdate = true; window.mesh.updateVersion?.();
    let back; ps.forEachSplat((i, c, s, q, a, col) => { if (i === 5) back = { x: c.x, b: col.b }; });
    return back;
  });
  assert.ok(Math.abs(moved.x - (first.c[0] + 5)) < 0.01 && moved.b > 0.9, 'setSplat wrote position + colour');
  px = await settle(false);
  assert.ok(px.lit < 50, 'moved splats left the view (in-place update reached the GPU): ' + px.lit);

  // Our modules on the real Spark mesh: lighting, moving parts, rig
  const real = await page.evaluate(async () => {
    const T = window.THREE, ps = window.mesh.packedSplats;
    // put splats back where they were (centred, orange) first
    ps.forEachSplat((i, c, s, q, a, col) => ps.setSplat(i, new T.Vector3(c.x - 5, c.y, c.z), s.clone(), q.clone(), a, new T.Color(0.9, 0.5, 0.1)));
    ps.needsUpdate = true;
    const out = {};
    const L = await import('/js/modules/splat-lighting.js');
    const light = new L.SplatLighting(T, window.mesh, null, { scene: window.scene });
    light.apply(L.moodSettings('noir'));
    let c5; ps.forEachSplat((i, c, s, q, a, col) => { if (i === 5) c5 = [col.r, col.g, col.b]; });
    out.noirGrey = Math.abs(c5[0] - c5[1]) < 0.02 && Math.abs(c5[1] - c5[2]) < 0.02;
    out.shadow = !!window.mesh.children.find(x => x.name === 'fumoca-splat-shadow');
    out.background = window.scene.background?.getHexString?.();
    light.reset();
    ps.forEachSplat((i, c, s, q, a, col) => { if (i === 5) c5 = [col.r, col.g, col.b]; });
    out.restored = Math.abs(c5[0] - 0.9) < 0.02 && Math.abs(c5[2] - 0.1) < 0.02;
    light.dispose();
    const P = await import('/js/modules/part-animator.js');
    const parts = new P.PartAnimator(T, window.mesh, [{ id: 'right', name: 'Right half', box: { min: [0, -1, -0.1], max: [1, 1, 0.1] }, motion: { type: 'hinge', pivot: [0, 0, 0], axis: [0, 1, 0], angle: -90, duration: 0.1 } }]);
    out.members = parts.list()[0].members;
    // light from the side (+x): the closed half faces ±z (side-lit), the open half faces x
    const side = new L.SplatLighting(T, window.mesh, null, { scene: window.scene });
    side.apply({ enabled: true, azimuth: 90, elevation: 5, intensity: 1.5, ambient: 0.05, color: '#ffffff', shadow: true });
    const member = parts.parts.get('right').members[0];
    const colourOf = (k) => { let v; ps.forEachSplat((i, c, s, q, a, col) => { if (i === k) v = col.r + col.g + col.b; }); return v; };
    const shadowBounds = () => { const pl = window.mesh.children.find(x => x.name === 'fumoca-splat-shadow'); return pl && [pl.position.x, pl.position.z, pl.scale.x, pl.scale.y].map(v => +v.toFixed(3)).join(','); };
    const closedLit = colourOf(member), closedShadow = shadowBounds();
    await parts.run('right', 'open');
    await new Promise(r => setTimeout(r, 200));
    let maxZ = 0; ps.forEachSplat((i, c) => { if (c.z > maxZ) maxZ = c.z; });
    out.swungZ = maxZ;
    out.relitOpen = Math.abs(colourOf(member) - closedLit) > 0.05;
    out.shadowFollowed = shadowBounds() !== closedShadow;
    side.dispose();
    parts.dispose();
    const R = await import('/js/modules/splat-rig-driver.js');
    const rest = R.readRest(window.mesh);
    const rig = R.fitTemplate('pivot', rest);
    const drv = new R.SplatRigDriver(T, window.mesh, rig, { rest });
    const { qFromEulerDeg } = await import('/js/modules/splat-rig.js');
    out.rigWritten = drv.applyPose({ top: qFromEulerDeg(0, 0, 60) });
    drv.reset();
    return out;
  });
  assert.equal(real.noirGrey, true, 'Noir mood greys the real splats');
  assert.equal(real.shadow, true, 'shadow plane under the real mesh');
  assert.equal(real.background, '050505', 'mood background');
  assert.equal(real.restored, true, 'lighting off restores scan colours');
  assert.ok(real.members > 150 && real.members < 250, 'part region picked half the disc: ' + real.members);
  assert.ok(real.swungZ > 0.5, 'part swung open in the real mesh: ' + real.swungZ);
  assert.ok(real.rigWritten > 0, 'rig posed the real mesh');
  assert.equal(real.relitOpen, true, 'an opened part is relit as it now faces');
  assert.equal(real.shadowFollowed, true, 'the shadow follows the opened part');

  assert.deepEqual(errors, []);
  console.log('real Spark (self-hosted) browser: all checks passed');
} finally {
  await browser?.close();
  server.close();
}
