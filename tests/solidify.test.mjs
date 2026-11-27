import assert from 'node:assert/strict';
import { solidify } from '../js/modules/solidify.js';
import { snapPointToPlane, estimateSpacing, applyT } from '../js/modules/scan-link.js';

// Solidify
const n = 1000, op = new Float32Array(n), sc = new Float32Array(n * 3), alive = new Uint8Array(n).fill(1);
for (let i = 0; i < n; i++) { op[i] = i / n; sc[i * 3] = 0.01; sc[i * 3 + 1] = 0.01; sc[i * 3 + 2] = i % 10 === 0 ? 0.2 : 0.01 * (1 + (i % 3)); }
alive[5] = 0;
const r = solidify({ opacity: op, scaleXYZ: sc }, alive, { strength: 0.7 });
assert.ok(r.remove.reduce((a, b) => a + b, 0) > 0, 'haze removed');
for (let i = 0; i < n; i++) {
  if (!alive[i]) { assert.equal(r.edited[i], 0); assert.equal(r.remove[i], 0); continue; }
  if (r.remove[i]) { assert.ok(op[i] < 0.2); continue; }
  assert.ok(r.opacity[i] >= op[i] - 1e-6, 'never fainter');
  const v = [r.scaleXYZ[i * 3], r.scaleXYZ[i * 3 + 1], r.scaleXYZ[i * 3 + 2]].sort((a, b) => a - b);
  assert.ok(v[2] <= v[1] * 4.6 + 1e-9, 'streaks capped');
}
assert.deepEqual(Array.from(solidify({ opacity: op, scaleXYZ: sc }, alive, { strength: 0 }).opacity), Array.from(op), 'strength 0 changes nothing');
assert.equal(op[500], 0.5, 'originals untouched');

// Point-to-plane snap recovers a turn + shift on plain flat panels (a box)
let seed = 3; const R = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const box = () => { const o = []; for (let i = 0; i < 30000; i++) { const f = Math.floor(R() * 6), u = R(), v = R(); const p = [u * 2, v * 1, 0]; if (f === 1) p[2] = 1; if (f === 2) { p[0] = u * 2; p[1] = 0; p[2] = v; } if (f === 3) { p[0] = u * 2; p[1] = 1; p[2] = v; } if (f === 4) { p[0] = 0; p[1] = u; p[2] = v; } if (f === 5) { p[0] = 2; p[1] = u; p[2] = v; } o.push(...p); } return o; };
const A = box(), B = box(), a = 1.5 * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
for (let i = 0; i < B.length; i += 3) { const x = B[i], z = B[i + 2]; B[i] = c * x + s * z + 0.03; B[i + 1] += 0.01; B[i + 2] = -s * x + c * z - 0.02; }
const P = Float32Array.from([...A, ...B]), base = [], link = [];
for (let i = 0; i < P.length / 3; i++) (i < A.length / 3 ? base : link).push(i);
const sp = estimateSpacing(P, base);
const fit = snapPointToPlane(P, base, link, { R: [1, 0, 0, 0, 1, 0, 0, 0, 1], s: 1, t: [0, 0, 0], q: [1, 0, 0, 0] }, { spacing: sp, startRadius: 0.07 });
// a corner of the moved box should land back on the original corner
const back = applyT(fit.T, [c * 2 + s * 1 + 0.03, 1.01, -s * 2 + c * 1 - 0.02]);
assert.ok(Math.hypot(back[0] - 2, back[1] - 1, back[2] - 1) < 0.006, 'snap undoes 1.5° + 3 cm: corner error ' + Math.hypot(back[0] - 2, back[1] - 1, back[2] - 1).toFixed(4));
console.log('solidify + point-to-plane snap: all checks passed');
