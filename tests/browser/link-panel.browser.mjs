// Inside tab in Chromium with real three.js: link a second scan of a "car"
// (cabin + open driver door), pick matching points by clicking the canvas,
// line up, remove doubles, attach the opened door's inner panel to its part,
// then the inside fades in on a live mesh as the door opens.
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { extname } from 'node:path';
import { chromium } from 'playwright';
import { applyT } from '../../js/modules/scan-link.js';
import { partTransform, normalizePart } from '../../js/modules/part-animator.js';

let seed = 3; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const rotY = (a) => [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)];
// base: car shell 4 × 1.4 × 1.8, with the driver door on the +z side (x 0..1)
const P = [];
for (let i = 0; i < 50000; i++) { const f = Math.floor(rnd() * 6), u = rnd() * 2 - 1, v = rnd() * 2 - 1;
  const p = [[1, u, v], [-1, u, v], [u, 1, v], [u, -1, v], [u, v, 1], [u, v, -1]][f]; P.push(p[0] * 2, p[1] * 0.7 + 0.7, p[2] * 0.9); }
const nBase = P.length / 3;
const door = normalizePart({ id: 'door', name: 'Driver door', box: { min: [0, 0.2, 0.86], max: [1, 1.2, 0.95] }, motion: { type: 'hinge', axis: [0, 1, 0], pivot: [1, 0.7, 0.9], angle: 70 } });
// second scan (own coordinates = car coords, then moved away and turned)
const T2 = { R: rotY(0.5), s: 1, t: [9, 0.3, -2] };
const second = [], kinds = [];
for (let i = 0; i < 14000; i++) { second.push([rnd() * 2.4 - 1.2, rnd() * 0.5 + 0.25, rnd() * 1.2 - 0.6]); kinds.push('seat'); }
for (let i = 0; i < 12000; i++) { const u = rnd() * 2 - 1, w = rnd() * 2 - 1, f = rnd() < 0.5 ? 1 : -1, k = rnd();
  const p = k < 0.4 ? [u * 2, rnd() * 0.5, f * 0.9] : k < 0.75 ? [u * 2, 0, w * 0.9] : [f * 2, rnd() * 0.6, w * 0.9];
  if (p[2] > 0.85 && p[0] >= 0 && p[0] <= 1 && p[1] >= 0.2) continue;      // the door is open in this scan
  second.push(p); kinds.push('shell'); }
const open = partTransform(door, 50 / 70);
for (let i = 0; i < 2500; i++) { second.push(open.apply([rnd(), 0.2 + rnd(), 0.9])); kinds.push('doorOuter'); }
for (let i = 0; i < 2500; i++) { second.push(open.apply([rnd(), 0.2 + rnd(), 0.84])); kinds.push('doorInner'); }
for (const p of second) P.push(...applyT(T2, p));
const N = P.length / 3;
// matching spots (car coords) the user would click: corners / features on the shell
const spots = [[1.9, 0.3, 0.9], [-1.9, 0.4, 0.9], [-1.5, 0.0, -0.5], [1.2, 0.0, 0.4]];

const root = new URL('../../', import.meta.url);
const fixture = `<!doctype html><meta charset=utf-8><body style="margin:0">
<script type="importmap">{"imports":{"three":"/vendor/three/0.180.0/build/three.module.js","three/addons/":"/vendor/three/0.180.0/examples/jsm/"}}</script>
<canvas id="c" width="800" height="500" style="display:block;width:800px;height:500px"></canvas><div id="root"></div>
<script type="module">
try {
  const THREE = await import('three'); window.THREE = THREE;
  window.renderer = { domElement: document.getElementById('c') };
  window.scene = new THREE.Scene();
  window.camera = new THREE.PerspectiveCamera(45, 800 / 500, 0.01, 200);
  window.__commits = 0; window.__history = [];
  window.FumocaStudioHooks = { pushHistory: (l) => window.__history.push(l), setMode() {}, async commit() { window.__commits++; window.dispatchEvent(new CustomEvent('fumoca:splatsEdited')); } };
  window.__parts = [];
  window.FumocaParts = { list: () => window.__parts.map(p => ({ id: p.id, name: p.name })), get: (id) => JSON.parse(JSON.stringify(window.__parts.find(p => p.id === id) || null)),
    updatePart(id, patch) { const p = window.__parts.find(x => x.id === id); Object.assign(p, patch); return true; }, animator: null };
  const { mountLinkPanel } = await import('/js/modules/link-panel.js');
  window.panel = mountLinkPanel(document.getElementById('root'));
  window.ready = true;
} catch (e) { window.failed = String(e && e.stack || e); }
</script>`;
const server = http.createServer(async (req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(fixture); return; }
  if (/^\/(vendor|js\/modules)\//.test(url) && !url.includes('..')) {
    try { const body = await readFile(new URL('.' + url, root)); res.writeHead(200, { 'content-type': extname(url) === '.js' ? 'text/javascript' : 'application/octet-stream' }); res.end(body); return; } catch {}
  }
  res.writeHead(404); res.end();
});
const probe = createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r)); const port = probe.address().port; await new Promise(r => probe.close(r));
server.listen(port, '127.0.0.1'); await new Promise(r => server.once('listening', r));

let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 800, height: 900 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.ready || window.failed, null, { timeout: 30000 });
  assert.equal(await page.evaluate(() => window.failed), undefined);

  await page.evaluate(({ P, nBase, door }) => {
    const n = P.length / 3, S = window.S = { positions: Float32Array.from(P), alive: new Uint8Array(n).fill(1), selected: new Uint8Array(n),
      rotation: new Float32Array(n * 4), scaleXYZ: new Float32Array(n * 3).fill(0.01), colors: new Float32Array(n * 3).fill(0.6), opacity: new Float32Array(n).fill(0.9) };
    for (let i = 0; i < n; i++) S.rotation[i * 4] = 1;
    const base = new Uint8Array(n), link = new Uint8Array(n); base.fill(1, 0, nBase); link.fill(1, nBase);
    S.layers = [{ id: 'L0', name: 'car closed', mask: base, visible: true }, { id: 'L1', name: 'car inside.ply', mask: link, visible: true }];
    window.__parts.push({ ...door });
    window.dispatchEvent(new CustomEvent('fumoca:splatAdded'));
  }, { P, nBase, door });
  assert.match(await page.textContent('#lnStatus'), /linked/);

  // pick 4 pairs by clicking the canvas centre after aiming the camera at each spot
  await page.click('#lnPick');
  const aim = (target, normal) => page.evaluate(([t, nrm]) => { window.camera.position.set(t[0] + nrm[0] * 3, t[1] + nrm[1] * 3, t[2] + nrm[2] * 3); window.camera.lookAt(t[0], t[1], t[2]); window.camera.updateMatrixWorld(); }, [target, normal]);
  for (const sp of spots) {
    const nrm = sp[1] === 0 ? [0.3, -1, 0.2] : sp[2] > 0 ? [0.2, 0.1, 1] : [0.2, 0.1, -1];
    await aim(sp, nrm); await page.mouse.click(400, 250);
    await aim(applyT(T2, sp), [Math.cos(0.5) * nrm[0] + Math.sin(0.5) * nrm[2], nrm[1], -Math.sin(0.5) * nrm[0] + Math.cos(0.5) * nrm[2]]); await page.mouse.click(400, 250);
  }
  const pairs = await page.evaluate(() => window.panel.pairs.filter(p => p.base && p.link).length);
  assert.equal(pairs, 4, 'four pairs picked by clicking');

  await page.click('#lnAlign');
  await page.waitForFunction(() => /Lined up/.test(document.querySelector('#lnStatus').textContent), null, { timeout: 60000 });
  const lined = await page.evaluate(({ nBase }) => { const S = window.S; return Array.from({ length: 6 }, (_, k) => nBase + k * 997).map(i => [S.positions[i * 3], S.positions[i * 3 + 1], S.positions[i * 3 + 2]]); }, { nBase });
  const want = [0, 1, 2, 3, 4, 5].map(k => second[k * 997]);
  const worst = Math.max(...lined.map((p, k) => Math.hypot(p[0] - want[k][0], p[1] - want[k][1], p[2] - want[k][2])));
  console.log('  ' + await page.textContent('#lnStatus') + ` (worst error ${worst.toFixed(4)})`);
  assert.ok(worst < 0.01, 'second scan lined up onto the car: ' + worst);

  await page.click('#lnDoubles');
  await page.waitForFunction(() => /Removed/.test(document.querySelector('#lnStatus').textContent), null, { timeout: 60000 });
  const dead = await page.evaluate(({ nBase, kinds }) => { const c = {}; kinds.forEach((k, j) => { c[k] = c[k] || [0, 0]; c[k][1]++; if (!window.S.alive[nBase + j]) c[k][0]++; }); return c; }, { nBase, kinds });
  assert.ok(dead.shell[0] / dead.shell[1] > 0.8 && dead.seat[0] / dead.seat[1] < 0.05, 'doubles: shell removed, seats kept ' + JSON.stringify(dead));

  // select the opened door in the second scan, attach to the part
  await page.evaluate(({ nBase, kinds }) => { kinds.forEach((k, j) => { if (k.startsWith('door')) window.S.selected[nBase + j] = 1; }); }, { nBase, kinds });
  await page.click('#lnAttach');
  await page.waitForFunction(() => /It was open|Could not|Select|Make/.test(document.querySelector('#lnStatus').textContent), null, { timeout: 60000 });
  const att = await page.textContent('#lnStatus');
  console.log('  ' + att);
  assert.match(att, /It was open (4[89]|5[012])°/);
  const doorCheck = await page.evaluate(({ nBase, kinds }) => {
    const S = window.S, inner = [], outerAlive = [];
    kinds.forEach((k, j) => { const i = nBase + j; if (k === 'doorInner' && S.alive[i]) inner.push(S.positions[i * 3 + 2]); if (k === 'doorOuter') outerAlive.push(S.alive[i]); });
    return { inner: inner.length, innerZ: inner.reduce((a, b) => a + b, 0) / inner.length, outerGone: outerAlive.filter(a => !a).length / outerAlive.length, box: window.__parts[0].box };
  }, { nBase, kinds });
  assert.ok(doorCheck.inner > 2300 && Math.abs(doorCheck.innerZ - 0.84) < 0.01, 'inner panel kept and closed: ' + JSON.stringify(doorCheck));
  assert.ok(doorCheck.outerGone > 0.85, 'outer skin doubles dropped');
  assert.ok(doorCheck.box.min[2] <= 0.845, 'part box grew to hold the inner panel');

  // saved links: the inside's ranges, reveal with the door
  const links = await page.evaluate(() => window.panel.getLinks());
  assert.equal(links.length, 1); assert.deepEqual(links[0].revealWith, ['door']);
  const insideCount = links[0].ranges.reduce((a, r) => a + r[1], 0);
  assert.ok(insideCount > 13000 && insideCount < 17000, 'inside = seats + leftovers: ' + insideCount);

  // reveal on a live (stub) mesh: inside hidden when closed, shown when open
  const rev = await page.evaluate(async (links) => {
    const { InsideReveal } = await import('/js/modules/scan-link.js');
    const n = window.S.alive.reduce((a, v) => a + v, 0), ops = new Float32Array(n).fill(-1);
    const rest = { count: n, positions: new Float32Array(n * 3), rotations: new Float32Array(n * 4), scales: new Float32Array(n * 3).fill(0.01), opacity: new Float32Array(n).fill(0.8), colors: new Float32Array(n * 3).fill(0.5) };
    const mesh = { packedSplats: { setSplat: (i, c, s, q, a) => { ops[i] = a; } }, updateVersion() {} };
    const animator = { parts: new Map([['door', { t: 0, members: new Int32Array([0, 1, 2]) }]]), anims: new Map(), rest };
    const r = new InsideReveal(window.THREE, mesh, animator, links, rest);
    const first = links[0].ranges[0][0];
    const closed = ops[first];
    animator.parts.get('door').t = 0.3; r.update(); const half = ops[first];
    animator.parts.get('door').t = 1; r.update(); const full = ops[first];
    return { closed, half, full, untouched: ops[first > 0 ? first - 1 : n - 1] };
  }, links);
  assert.equal(rev.closed, 0, 'inside hidden while the door is shut');
  assert.ok(rev.half > 0.3 && rev.half < 0.5, 'fading in: ' + rev.half);
  assert.ok(Math.abs(rev.full - 0.8) < 1e-6, 'fully shown when open');
  assert.deepEqual(errors, []);
  console.log('link-panel browser: all checks passed');
} finally { await browser?.close(); server.close(); }
