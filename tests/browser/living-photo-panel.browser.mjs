// Studio Living photo panel end-to-end in Chromium (stub three.js + stub Studio):
// choose photo → build → PLY handed to Studio → framed + motion → state saved.
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { chromium } from 'playwright';

const root = new URL('../../', import.meta.url);
const stubThree = `
export class Vector3 {
  constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;}
  set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}
  clone(){return new Vector3(this.x,this.y,this.z);} copy(v){this.x=v.x;this.y=v.y;this.z=v.z;return this;}
  sub(v){this.x-=v.x;this.y-=v.y;this.z-=v.z;return this;} length(){return Math.hypot(this.x,this.y,this.z);}
  normalize(){const l=this.length()||1;this.x/=l;this.y/=l;this.z/=l;return this;}
  addScaledVector(v,s){this.x+=v.x*s;this.y+=v.y*s;this.z+=v.z*s;return this;}
  crossVectors(a,b){const x=a.y*b.z-a.z*b.y,y=a.z*b.x-a.x*b.z,z=a.x*b.y-a.y*b.x;this.x=x;this.y=y;this.z=z;return this;}
}
export class Quaternion {} export class Color {}
`;
const fixture = `<!doctype html><meta charset=utf-8>
<script type="importmap">{"imports":{"three":"/stub-three.js"}}</script>
<div id="root"></div>
<script type="module">
import { Vector3 } from 'three';
window.camera = { position: new Vector3(3, 2, 5), up: new Vector3(0, 1, 0), fov: 50, aspect: 16 / 9,
  looks: 0, lookAt() { this.looks++; }, updateProjectionMatrix() {} };
const listeners = {};
window.controls = { target: new Vector3(), update() {}, addEventListener(t, f) { (listeners[t] ||= []).push(f); }, removeEventListener() {},
  fire(t) { (listeners[t] || []).forEach(f => f()); } };
// Studio stand-in: the Spark mesh is identity-placed; localToWorld = identity
window.FumocaSparkGaussian = { getMesh: () => ({ updateMatrixWorld() {}, localToWorld: (v) => v }) };
window.S = {};
window.__loaded = [];
window.__living = [];
window.addEventListener('fumoca:livingChange', e => window.__living.push(e.detail));
window.addEventListener('fumoca:openReconstructedSplat', e => {
  window.__loaded.push(e.detail);
  window.S.reconstructionMeta = { kind: e.detail.kind };
  window.dispatchEvent(new CustomEvent('fumoca:fileLoaded'));
});
const { mountLivingPhotoPanel } = await import('/js/modules/living-photo-panel.js');
window.panel = mountLivingPhotoPanel(document.getElementById('root'));
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

  // A photo: soft background + sharp orange subject
  await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 900; c.height = 600;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, 600); g.addColorStop(0, '#6a8fd0'); g.addColorStop(1, '#8a9a70');
    x.fillStyle = g; x.fillRect(0, 0, 900, 600);
    x.fillStyle = '#e0601c'; x.beginPath(); x.arc(450, 360, 140, 0, 7); x.fill();
    for (let i = 0; i < 400; i++) { x.fillStyle = i % 2 ? '#fff' : '#200'; x.fillRect(330 + (i % 20) * 12, 250 + Math.floor(i / 20) * 12, 5, 5); }
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    const dt = new DataTransfer(); dt.items.add(new File([blob], 'sunset.png', { type: 'image/png' }));
    const input = document.getElementById('lpFile'); input.files = dt.files; input.dispatchEvent(new Event('change'));
  });
  await page.waitForFunction(() => !document.getElementById('lpBuild').disabled, null, { timeout: 10000 });

  await page.click('#lpBuild');
  await page.waitForFunction(() => window.__loaded.length === 1, null, { timeout: 20000 });
  const det = await page.evaluate(() => ({ name: window.__loaded[0].filename, kind: window.__loaded[0].kind, n: window.__loaded[0].bytes.length,
    head: new TextDecoder().decode(window.__loaded[0].bytes.slice(0, 80)) }));
  assert.equal(det.kind, 'living-photo'); assert.equal(det.name, 'sunset-living.ply');
  assert.match(det.head, /^ply\nformat binary_little_endian/);
  assert.ok(det.n > 720 * 480 * 68, 'one Gaussian per pixel at least');

  // Framed in front of the photo and moving
  await page.waitForTimeout(1500);
  const cam1 = await page.evaluate(() => ({ ...window.camera.position }));
  assert.ok(Math.abs(cam1.x) < 0.2 && cam1.z > -1 && cam1.z < 1, 'camera placed at the photo viewpoint: ' + JSON.stringify(cam1));
  await page.waitForTimeout(400);
  const cam2 = await page.evaluate(() => ({ ...window.camera.position }));
  assert.ok(Math.hypot(cam2.x - cam1.x, cam2.y - cam1.y, cam2.z - cam1.z) > 1e-4, 'camera drifting');
  assert.match(await page.textContent('#lpStatus'), /Alive/);

  // Person grabs the view → motion pauses
  await page.evaluate(() => window.controls.fire('start'));
  const p1 = await page.evaluate(() => ({ ...window.camera.position }));
  await page.waitForTimeout(300);
  const p2 = await page.evaluate(() => ({ ...window.camera.position }));
  assert.deepEqual(p1, p2, 'paused while the person is orbiting');

  // Saved state for the viewer
  await page.selectOption('#lpMotion', 'pushin');
  const st = await page.evaluate(() => window.panel.getState());
  assert.equal(st.enabled, true); assert.equal(st.motion, 'pushin');
  assert.ok(st.view && st.view.near === 1 && st.view.fovY > 10, 'framing saved');
  assert.ok((await page.evaluate(() => window.__living.length)) >= 2, 'changes announced for saving');

  // Turning off "play in viewer" stops it being saved as enabled
  await page.click('#lpViewer');
  assert.equal(await page.evaluate(() => window.panel.getState()), null);

  // Loading some other file ends the living photo
  await page.click('#lpViewer');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('fumoca:fileLoaded')));
  assert.equal(await page.evaluate(() => window.panel.getState()), null, 'other file clears it');

  assert.deepEqual(errors, []);
  console.log('living-photo-panel browser: all checks passed');
} finally {
  await browser?.close();
  server.close();
}
