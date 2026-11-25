// The solid-mesh worker runs as a real module Web Worker in Chromium and
// returns a valid .glb without touching the page (no GPU, no network).
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

const root = new URL('../../', import.meta.url).pathname;
const server = http.createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  if (path === '/test.html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>t</title>'); return; }
  try { const body = await readFile(join(root, path)); res.writeHead(200, { 'content-type': extname(path) === '.js' ? 'text/javascript' : 'application/octet-stream' }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
});
const probe = createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r));
const port = probe.address().port; await new Promise(r => probe.close(r));
server.listen(port, '127.0.0.1'); await new Promise(r => server.once('listening', r));

let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/test.html`);
  const result = await page.evaluate(() => new Promise((resolve) => {
    const N = 16000, g = { count: N, positions: new Float32Array(N * 3), colors: new Float32Array(N * 3), opacities: new Float32Array(N).fill(0.95), scales: new Float32Array(N * 3), rotations: new Float32Array(N * 4) };
    for (let i = 0; i < N; i++) {
      const y = 1 - 2 * (i + 0.5) / N, r = Math.sqrt(1 - y * y), phi = i * Math.PI * (3 - Math.sqrt(5));
      const n = [Math.cos(phi) * r, y, Math.sin(phi) * r];
      g.positions.set(n, i * 3); g.colors.set([0.8, 0.5, 0.2], i * 3);
      const w = 1 + n[2]; const q = w < 1e-6 ? [0, 1, 0, 0] : [w, -n[1], n[0], 0]; const l = Math.hypot(...q);
      g.rotations.set(q.map(v => v / l), i * 4); g.scales.set([0.04, 0.04, 0.003], i * 3);
    }
    const worker = new Worker('/js/modules/solid-mesh-worker.js', { type: 'module' });
    let progress = 0;
    worker.onmessage = (e) => {
      if (e.data.type === 'progress') { progress++; return; }
      if (e.data.type === 'error') { resolve({ error: e.data.message }); return; }
      const glb = new Uint8Array(e.data.glb);
      resolve({ magic: new TextDecoder().decode(glb.subarray(0, 4)), bytes: glb.length, tris: e.data.mesh.indices.length / 3, progress });
    };
    worker.onerror = (e) => resolve({ error: e.message });
    worker.postMessage({ gaussians: g, options: { views: 18, viewSize: 192, resolution: 80, atlasSize: 1024 } });
  }));
  assert.equal(result.error, undefined, 'worker error: ' + result.error);
  assert.equal(result.magic, 'glTF');
  assert.ok(result.tris > 1000 && result.progress > 10, JSON.stringify(result));
  assert.deepEqual(errors, []);
  console.log('Solid mesh worker browser test passed:', result.tris, 'triangles,', (result.bytes / 1024).toFixed(0), 'KB .glb');
} finally {
  if (browser) await browser.close();
  await new Promise(r => server.close(r));
}
