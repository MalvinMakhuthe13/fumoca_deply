// Photo → 3D end-to-end in Chromium with the AI model, three.js and Spark
// stubbed (no network): photo → depth → moving 3D poster → splat PLY →
// Open in Studio hand-off.
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

const root = new URL('../../', import.meta.url).pathname;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' };
const server = http.createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  try {
    const body = await readFile(join(root, path === '/' ? 'index.html' : path));
    res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream' }); res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
const probe = createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r));
const port = probe.address().port; await new Promise(r => probe.close(r));
server.listen(port, '127.0.0.1'); await new Promise(r => server.once('listening', r));

const stubTransformers = `
export const env = {};
export class RawImage { static async fromBlob(b) { const bm = await createImageBitmap(b); return { width: bm.width, height: bm.height }; } }
export async function pipeline(task, model, opts) {
  window.__pipelineArgs = { task, model, device: opts.device };
  return async (img) => {
    const w = img.width, h = img.height, data = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dx = x / w - 0.5, dy = y / h - 0.5;
      data[y * w + x] = Math.max(0, 1 - Math.hypot(dx, dy) * 2.4) * 10 + 1; // near bump in the middle
    }
    return { predicted_depth: { dims: [h, w], data } };
  };
}`;
const stubThree = `
export class Color { constructor(){} }
export class Scene { constructor(){ this.children=[]; } add(o){ this.children.push(o); } remove(o){ this.children=this.children.filter(c=>c!==o); } }
export class PerspectiveCamera { constructor(f){ this.fov=f; this.position={ set(){} }; } updateProjectionMatrix(){} }
export class WebGLRenderer { constructor(){} setPixelRatio(){} setSize(){} render(){ window.__renders=(window.__renders||0)+1; } dispose(){} }
export class Vector3 { constructor(){ this.x=1; this.y=1; this.z=1; } }
export class Box3 { setFromObject(){ return this; } getSize(v){ return v; } }
export const MathUtils = { degToRad: d => d * Math.PI / 180 };`;
const stubControls = `export class OrbitControls { constructor(){ this.target={ set(){} }; } update(){} }`;
const stubSpark = `
if (window.__failSpark) throw new Error('Simulated Spark preview failure');
export class SparkRenderer { constructor(){} }
export class SplatMesh { constructor({ fileBytes }) { window.__splatBytes = fileBytes.length; this.initialized = Promise.resolve(this); } dispose(){} }`;

let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route(/cdn\.jsdelivr\.net\/npm\/@huggingface\/transformers/, r => r.fulfill({ contentType: 'text/javascript', body: stubTransformers }));
  await page.route(/\/vendor\/three\/0\\.180\\.0\/build\/three\\.module\\.js$/, r => r.fulfill({ contentType: 'text/javascript', body: stubThree }));
  await page.route(/\/vendor\/three\/0\\.180\\.0\/examples\/jsm\/controls\/OrbitControls\\.js$/, r => r.fulfill({ contentType: 'text/javascript', body: stubControls }));
  await page.route(/\/vendor\/sparkjsdev-spark\/2\\.4\\.0\/dist\/spark\\.module\\.js$/, r => r.fulfill({ contentType: 'text/javascript', body: stubSpark }));
  await page.route(/fonts\.googleapis|fonts\.gstatic/, r => r.fulfill({ body: '' }));

  await page.goto(`http://127.0.0.1:${port}/photo-to-3d.html`);
  await page.waitForFunction(() => window.FumocaPhoto3D);
  // Make a 320×240 test photo: orange circle on teal.
  await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 320; c.height = 240;
    const x = c.getContext('2d'); x.fillStyle = '#0a8f8f'; x.fillRect(0, 0, 320, 240);
    x.fillStyle = '#ff8800'; x.beginPath(); x.arc(160, 120, 60, 0, Math.PI * 2); x.fill();
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    await window.FumocaPhoto3D.handleFile(new File([blob], 'my photo.png', { type: 'image/png' }));
  });
  assert.equal(await page.evaluate(() => window.__pipelineArgs.model), 'onnx-community/depth-anything-v2-small', 'uses Depth Anything V2 Small (Apache-2.0)');
  assert.equal(await page.isVisible('#p3Poster'), true, '3D poster is shown after depth');
  assert.equal(await page.isVisible('#p3Drop'), false, 'drop zone hides');

  // The poster actually renders the photo and moves with the pointer.
  const box = await page.locator('#p3Poster').boundingBox();
  await page.mouse.move(box.x + 10, box.y + box.height / 2);
  await page.waitForTimeout(600);
  const left = await page.evaluate(() => document.getElementById('p3Poster').toDataURL());
  await page.mouse.move(box.x + box.width - 10, box.y + box.height / 2);
  await page.waitForTimeout(600);
  const right = await page.evaluate(() => document.getElementById('p3Poster').toDataURL());
  assert.ok(left.length > 2000, 'poster canvas has rendered content');
  assert.notEqual(left, right, 'moving the pointer changes the 3D view (parallax)');
  const centre = await page.evaluate(() => {
    const c = document.getElementById('p3Poster'), g = document.createElement('canvas');
    g.width = c.width; g.height = c.height; const x = g.getContext('2d'); x.drawImage(c, 0, 0);
    return Array.from(x.getImageData(c.width / 2, c.height / 2, 1, 1).data);
  });
  assert.ok(centre[0] > 200 && centre[2] < 80, 'the photo (orange subject) is drawn, not a blank canvas: ' + centre);

  // Splat tab builds a real PLY and previews it.
  await page.click('[data-tab="splat"]');
  await page.waitForFunction(() => !document.getElementById('p3OpenStudio').disabled, null, { timeout: 15000 });
  const header = await page.evaluate(() => new TextDecoder().decode(window.FumocaPhoto3D.plyBytes.subarray(0, 300)));
  assert.match(header, /element vertex \d+/);
  assert.match(header, /property float f_dc_0/);
  assert.ok(await page.evaluate(() => window.__splatBytes > 10000), 'Spark received the generated splat');

  // Remove background rebuilds a smaller subject-only splat.
  const before = await page.evaluate(() => window.FumocaPhoto3D.plyBytes.length);
  await page.evaluate(() => { const r = document.getElementById('p3Background'); r.value = '0.5'; r.dispatchEvent(new Event('change')); });
  await page.waitForFunction(b => window.FumocaPhoto3D.plyBytes && window.FumocaPhoto3D.plyBytes.length < b, before, { timeout: 15000 });

  // Open in Studio hands the PLY over through IndexedDB.
  await page.route(/edit\.html/, r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>studio</title>' }));
  await Promise.all([page.waitForURL(/edit\.html\?handoff=/), page.click('#p3OpenStudio')]);
  const id = new URL(page.url()).searchParams.get('handoff');
  const handed = await page.evaluate(async (id) => {
    const { takeHandoff } = await import('/js/modules/handoff-store.js');
    const item = await takeHandoff(id); const again = await takeHandoff(id);
    return { name: item?.filename, size: item?.bytes?.byteLength, again };
  }, id);
  assert.equal(handed.name, 'my_photo-3d.ply');
  assert.ok(handed.size > 1000, 'Studio receives the PLY bytes');
  assert.equal(handed.again, null, 'hand-off is one-time');
  assert.deepEqual(errors, [], 'no uncaught page errors');

  // Spark is an optional preview. If it cannot load, the generated PLY must
  // still be downloadable and transferable to Studio.
  const fallbackPage = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  fallbackPage.on('pageerror', e => errors.push(e.message));
  await fallbackPage.route(/cdn\\.jsdelivr\\.net\/npm\/@huggingface\/transformers/, r => r.fulfill({ contentType: 'text/javascript', body: stubTransformers }));
  await fallbackPage.route(/\/vendor\/three\/0\\.180\\.0\/build\/three\\.module\\.js$/, r => r.fulfill({ contentType: 'text/javascript', body: stubThree }));
  await fallbackPage.route(/\/vendor\/three\/0\\.180\\.0\/examples\/jsm\/controls\/OrbitControls\\.js$/, r => r.fulfill({ contentType: 'text/javascript', body: stubControls }));
  await fallbackPage.route(/\/vendor\/sparkjsdev-spark\/2\\.4\\.0\/dist\/spark\\.module\\.js$/, r => r.fulfill({ contentType: 'text/javascript', body: stubSpark }));
  await fallbackPage.route(/fonts\\.googleapis|fonts\\.gstatic/, r => r.fulfill({ body: '' }));
  await fallbackPage.goto(`http://127.0.0.1:${port}/photo-to-3d.html`);
  await fallbackPage.waitForFunction(() => window.FumocaPhoto3D);
  await fallbackPage.evaluate(async () => {
    window.__failSpark = true;
    const c = document.createElement('canvas'); c.width = 160; c.height = 120;
    const x = c.getContext('2d'); x.fillStyle = '#0a8f8f'; x.fillRect(0, 0, 160, 120);
    x.fillStyle = '#ff8800'; x.beginPath(); x.arc(80, 60, 30, 0, Math.PI * 2); x.fill();
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    await window.FumocaPhoto3D.handleFile(new File([blob], 'fallback.png', { type: 'image/png' }));
  });
  await fallbackPage.click('[data-tab="splat"]');
  await fallbackPage.waitForFunction(() => !document.getElementById('p3DownloadPly').disabled && !document.getElementById('p3OpenStudio').disabled, null, { timeout: 15000 });
  assert.ok(await fallbackPage.evaluate(() => window.FumocaPhoto3D.plyBytes?.byteLength > 1000), 'PLY remains available without Spark');
  assert.match(await fallbackPage.locator('#p3Status').textContent(), /preview is unavailable/i);
  assert.deepEqual(errors, [], 'no uncaught errors when Spark preview is unavailable');
  await fallbackPage.close();
  console.log('Photo → 3D browser test passed: depth, moving poster, splat PLY, background removal, Studio hand-off and Spark-preview fallback.');
} finally {
  if (browser) await browser.close();
  await new Promise(r => server.close(r));
}
