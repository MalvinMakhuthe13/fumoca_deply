// Product guide in Chromium with the real (self-hosted) three.js: Studio Guide
// tab → screen from selection, steps, then the player: camera flies, ring on
// the button, screenshot on the phone screen, part action, finish.
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { extname } from 'node:path';
import { chromium } from 'playwright';

const root = new URL('../../', import.meta.url);
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.png': 'image/png' };
const fixture = `<!doctype html><meta charset=utf-8><body style="margin:0">
<script type="importmap">{"imports":{"three":"/vendor/three/0.180.0/build/three.module.js","three/addons/":"/vendor/three/0.180.0/examples/jsm/"}}</script>
<div id="viewport" style="position:relative;width:640px;height:400px"><canvas id="c" width="640" height="400"></canvas></div>
<div id="root"></div>
<script type="module">
try {
  const THREE = await import('three');
  window.THREE = THREE;
  window.renderer = { domElement: document.getElementById('c') };
  window.scene = new THREE.Scene();
  window.camera = new THREE.PerspectiveCamera(50, 640 / 400, 0.01, 100); camera.position.set(0, 0, 3); camera.lookAt(0, 0, 0);
  window.controls = { target: new THREE.Vector3(), update() {} };
  // a "phone": screen splats on z=0 (0.07 × 0.15), body behind, power button on the right edge
  const P = [];
  for (let i = 0; i < 1200; i++) P.push((Math.random() - 0.5) * 0.07, (Math.random() - 0.5) * 0.15, 0);
  for (let i = 0; i < 300; i++) P.push((Math.random() - 0.5) * 0.075, (Math.random() - 0.5) * 0.155, -0.004);
  for (let i = 0; i < 20; i++) P.push(0.038, 0.03 + i * 0.001, -0.002);
  const n = P.length / 3;
  window.S = { positions: Float32Array.from(P), alive: new Uint8Array(n).fill(1), selected: new Uint8Array(n) };
  window.__partRuns = [];
  window.FumocaParts = { list: () => [{ id: 'tray', name: 'SIM tray' }], run: (id, to) => { window.__partRuns.push([id, to]); return Promise.resolve(true); } };
  const { mountTutorialPanel } = await import('/js/modules/tutorial-panel.js');
  window.panel = mountTutorialPanel(document.getElementById('root'));
  window.__changes = 0; window.addEventListener('fumoca:tutorialChange', () => window.__changes++);
  window.ready = true;
} catch (e) { window.failed = String(e && e.stack || e); }
</script>`;

const server = http.createServer(async (req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(fixture); return; }
  if (url === '/battery.png') { res.writeHead(200, { 'content-type': 'image/png', 'access-control-allow-origin': '*' }); res.end(await readFile(new URL('./fixtures-battery.png', import.meta.url))); return; }
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
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.ready || window.failed, null, { timeout: 30000 });
  assert.equal(await page.evaluate(() => window.failed), undefined);

  // screen from the selected screen splats
  await page.evaluate(() => { for (let i = 0; i < 1200; i++) window.S.selected[i] = 1; });
  await page.click('#tgScreen');
  assert.match(await page.textContent('#tgStatus'), /Screen fitted to 1,200 splats/);

  // step 1: front view, show the battery screenshot on the screen
  await page.click('#tgAdd');
  await page.fill('[data-f="title"]', 'Check battery health');
  await page.fill('[data-f="text"]', 'Settings → Battery → Battery Health');
  await page.selectOption('[data-f="screenId"]', { index: 1 });
  await page.fill('[data-f="media"]', `http://127.0.0.1:${port}/battery.png`);
  // step 2: side view, ring the power button, open the SIM tray
  await page.evaluate(() => { window.camera.position.set(1.5, 0, 0.5); window.controls.target.set(0.038, 0.04, 0); });
  await page.click('#tgAdd');
  await page.fill('[data-f="title"]', 'Switch it on');
  await page.evaluate(() => { window.S.selected.fill(0); for (let i = 1500; i < 1520; i++) window.S.selected[i] = 1; });
  await page.click('[data-do="ring"]');
  await page.selectOption('[data-f="action"]', 'part:tray');
  const saved = await page.evaluate(() => window.panel.getTutorial());
  assert.equal(saved.steps.length, 2); assert.equal(saved.screens.length, 1);
  assert.ok(Math.abs(saved.steps[1].highlight[0] - 0.038) < 1e-3, 'ring on the power button');
  assert.equal(saved.steps[0].media, `http://127.0.0.1:${port}/battery.png`);
  assert.ok(await page.evaluate(() => window.__changes) > 3);

  // play it
  await page.evaluate(() => window.camera.position.set(0, 0, 5));
  await page.click('#tgPreview');
  await page.waitForTimeout(1500);
  const s1 = await page.evaluate(() => ({
    cam: window.camera.position.toArray().map(v => +v.toFixed(2)),
    title: document.querySelector('.ft-title').textContent,
    screen: (() => { const m = window.scene.children.find(c => c.name === 'fumoca-tutorial-screen'); return m && { visible: m.visible, tex: !!m.material.map, w: +(m.scale.x).toFixed(3), h: +(m.scale.y).toFixed(3) }; })(),
  }));
  assert.equal(s1.title, 'Check battery health');
  assert.deepEqual(s1.cam, [0, 0, 3], 'camera flew to the step view');
  assert.ok(s1.screen?.visible && s1.screen.tex, 'battery screenshot on the phone screen: ' + JSON.stringify(s1.screen));
  assert.ok(Math.abs(Math.max(s1.screen.w, s1.screen.h) - 0.15) < 0.015, 'screen sized to the phone');
  await page.click('.ft-next');
  await page.waitForTimeout(1500);
  const s2 = await page.evaluate(() => ({ title: document.querySelector('.ft-title').textContent, ring: getComputedStyle(document.querySelector('.ft-ring')).display,
    screenHidden: !window.scene.children.find(c => c.name === 'fumoca-tutorial-screen').visible, runs: window.__partRuns }));
  assert.equal(s2.title, 'Switch it on'); assert.equal(s2.ring, 'block', 'ring shown on the button');
  assert.equal(s2.screenHidden, true, 'screen back to the scan on steps without media');
  assert.deepEqual(s2.runs, [['tray', 'toggle']], 'step action ran');
  await page.click('.ft-next');      // Finish
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.ft-card')).display), 'none', 'guide closes at the end');

  // viewer launcher
  const launcher = await page.evaluate(async (t) => {
    const m = await import('/js/modules/tutorial.js');
    const host = document.getElementById('viewport');
    const r = m.mountTutorialOnViewer(window.THREE, { ...t, title: 'Getting started' }, { camera: window.camera, controls: window.controls, host, parent: window.scene, runAction: async () => {} });
    return r.button.textContent;
  }, saved);
  assert.equal(launcher, '▶ Getting started');
  assert.deepEqual(errors, []);
  console.log('tutorial browser: all checks passed');
} finally {
  await browser?.close();
  server.close();
}
