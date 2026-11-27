import assert from 'node:assert/strict';
import { analyzePhoto, photoToLivingSplat, motionAt, normalizeLivingState, guidedFilter, inpaint, fitImage } from '../js/modules/living-photo.js';

// Synthetic portrait: sharp, colourful, textured disc (subject) in the lower-middle,
// over a soft blurred sky→ground gradient (background).
function portrait(w = 320, h = 240) {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, t = y / h;
    let r = 90 + 60 * t, g = 120 + 40 * t, b = 170 - 70 * t;           // smooth background
    const dx = x - w * 0.5, dy = y - h * 0.58;
    if (dx * dx + dy * dy < (h * 0.22) ** 2) {                          // subject
      const tex = ((x >> 2) + (y >> 2)) & 1 ? 40 : -40;                 // sharp texture
      r = 220 + tex * 0.5; g = 90 + tex; b = 40 + tex * 0.3;
    }
    rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = 255;
  }
  return { rgba, w, h };
}

const { rgba, w, h } = portrait();
const a = analyzePhoto(rgba, w, h);
assert.equal(a.hasSubject, true, 'subject found');
const at = (x, y) => y * w + x;
const subjIn = a.subject[at(w / 2, Math.round(h * 0.58))], subjOut = a.subject[at(10, 10)];
assert.ok(subjIn > 0.7 && subjOut < 0.1, `subject mask ${subjIn} / ${subjOut}`);
const dSubject = a.depth[at(w / 2, Math.round(h * 0.58))];
const dSkyTop = a.depth[at(20, 5)], dGroundBottom = a.depth[at(20, h - 5)];
assert.ok(dSubject < dSkyTop - 0.3, `subject nearer than sky ${dSubject} vs ${dSkyTop}`);
assert.ok(dGroundBottom < dSkyTop, 'lower background nearer than top');
for (const v of a.depth) assert.ok(v >= 0 && v <= 1 && Number.isFinite(v));

// Depth follows the subject's edge (guided filter keeps the boundary crisp)
const edgeIn = a.depth[at(Math.round(w / 2 + h * 0.2), Math.round(h * 0.58))];
const edgeOut = a.depth[at(Math.round(w / 2 + h * 0.25), Math.round(h * 0.58))];
assert.ok(edgeOut - edgeIn > 0.15, `edge kept ${edgeIn} → ${edgeOut}`);

// Full build: PLY valid, extra hidden layer behind the subject, sane geometry
const t0 = performance.now();
const big = portrait(1600, 1200);
const res = photoToLivingSplat(big.rgba, big.w, big.h);
const ms = performance.now() - t0;
assert.equal(res.width, 720); assert.equal(res.height, 540);
const g = res.gaussians;
assert.ok(g.count > 720 * 540 && g.count < 720 * 540 * 1.5, 'background fill layer added: ' + g.count);
const text = new TextDecoder().decode(res.ply.slice(0, 600));
assert.match(text, /element vertex \d+/); assert.match(text, /property float f_dc_0/); assert.match(text, /property float rot_3/);
const headerEnd = text.indexOf('end_header\n') + 'end_header\n'.length;
assert.equal(res.ply.length, headerEnd + g.count * 17 * 4, 'binary size matches');
const dv = new DataView(res.ply.buffer, headerEnd);
for (let i = 0; i < g.count; i += 997) {
  const z = dv.getFloat32(i * 68 + 8, true), s0 = dv.getFloat32(i * 68 + 40, true), op = dv.getFloat32(i * 68 + 36, true);
  assert.ok(z < -0.99 && z > -1.6, 'z in range ' + z);
  assert.ok(Number.isFinite(s0) && s0 < 0, 'log scale');
  assert.ok(op > 2, 'opaque');
}
// Hidden layer sits behind the subject (further from the camera on average)
{
  const N = 720 * 540;
  let zs = 0, zn = 0, zb = 0, bn = 0;
  for (let i = 0; i < N; i++) if (res.analysis.subject[i] > 0.9) { zs += g.positions[i * 3 + 2]; zn++; }
  for (let i = N; i < g.count; i++) { zb += g.positions[i * 3 + 2]; bn++; }
  assert.ok(zb / bn < zs / zn - 0.05, `fill layer behind subject ${zb / bn} vs ${zs / zn}`);
}
console.log(`  1600×1200 photo → ${g.count.toLocaleString()} Gaussians in ${Math.round(ms)} ms`);

// Helpers
{
  const I = new Float32Array(100).map((_, i) => (i % 10 < 5 ? 0 : 1));
  const p = new Float32Array(100).map((_, i) => (i % 10 < 5 ? 0.2 : 0.8) + (i % 3) * 0.05);
  const q = guidedFilter(I, p, 10, 10, 2, 1e-4);
  assert.ok(Math.abs(q[2] - 0.25) < 0.08 && Math.abs(q[7] - 0.85) < 0.08, 'guided filter keeps the step');
  const img = new Uint8ClampedArray(25 * 4).fill(200); const mask = new Uint8Array(25); mask[12] = 1; img[48] = 0;
  const filled = inpaint(img, 5, 5, mask);
  assert.ok(filled[48] > 150, 'hole painted from surroundings');
  const f = fitImage(new Uint8ClampedArray(4000 * 10 * 4).fill(9), 4000, 10, 100);
  assert.equal(f.w, 100); assert.ok(f.h >= 2);
}

// Motion: smooth, small, looping
for (const m of ['drift', 'pushin', 'sway', 'float']) {
  const p0 = motionAt(m, 0, { amount: 1, period: 8 }), p8 = motionAt(m, 8, { amount: 1, period: 8 });
  for (const k of ['x', 'y', 'z']) {
    assert.ok(Math.abs(p0[k] - p8[k]) < 0.02, `${m} loops on ${k}`);
    for (let t = 0; t < 16; t += 0.25) assert.ok(Math.abs(motionAt(m, t, { amount: 1 })[k]) <= 0.13, `${m} stays small`);
  }
}
assert.equal(normalizeLivingState({ enabled: false }), null);
assert.deepEqual(normalizeLivingState({ enabled: true, motion: 'evil', amount: 9, period: -1 }), { enabled: true, motion: 'drift', amount: 1, period: 3, version: 1 });
console.log('living-photo: all tests passed');
