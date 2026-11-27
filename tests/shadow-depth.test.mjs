import assert from 'node:assert/strict';
import { ambientOcclusion, bakedShadowLift, shadowMap, normalizeLighting, DEFAULT_LIGHTING } from '../js/modules/splat-lighting.js';

let seed = 9; const R = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
// a box (0.6 m) standing on a 3 m floor; normals point out of each surface
const P = [], N = [], tag = [];
for (let i = 0; i < 60000; i++) { const x = R() * 3 - 1.5, z = R() * 3 - 1.5; if (Math.abs(x) < 0.3 && Math.abs(z) < 0.3) continue; P.push(x, 0, z); N.push(0, 1, 0); tag.push(Math.max(Math.abs(x), Math.abs(z)) < 0.36 ? 'crease' : Math.max(Math.abs(x), Math.abs(z)) > 1.0 ? 'open' : 'floor'); }
for (let i = 0; i < 30000; i++) {
  const f = Math.floor(R() * 5), u = R() * 0.6 - 0.3, v = R() * 0.6;
  if (f === 4) { P.push(u, 0.6, R() * 0.6 - 0.3); N.push(0, 1, 0); tag.push('top'); continue; }
  const [x, z, nx, nz] = [[0.3, u, 1, 0], [-0.3, u, -1, 0], [u, 0.3, 0, 1], [u, -0.3, 0, -1]][f];
  P.push(x, v, z); N.push(nx, 0, nz); tag.push(v < 0.06 ? 'crease' : 'side');
}
const pos = Float32Array.from(P), nor = Float32Array.from(N), n = tag.length;
const occ = ambientOcclusion(pos, n, nor, null);
const mean = (t) => { let s = 0, c = 0; for (let i = 0; i < n; i++) if (tag[i] === t) { s += occ[i]; c++; } return s / c; };
assert.ok(mean('crease') > mean('open') + 0.2, `creases are deeper than open floor (${mean('crease').toFixed(2)} vs ${mean('open').toFixed(2)})`);
assert.ok(mean('crease') > mean('top') + 0.2, `creases are deeper than the open top (${mean('crease').toFixed(2)} vs ${mean('top').toFixed(2)})`);

// baked shadow: a broad dark patch on the floor is lifted; lit floor and a thin dark stripe are left alone
const col = new Float32Array(n * 3).fill(0.7);
for (let i = 0; i < n; i++) {
  if (tag[i] === 'top' || tag[i] === 'side' || tag[i] === 'crease') continue;
  const x = pos[i * 3], z = pos[i * 3 + 2];
  if (x > 0.6 && z > 0.6) col.fill(0.25, i * 3, i * 3 + 3);                 // shadow baked in
  if (x < -0.6 && Math.abs(z) < 0.01) col.fill(0.1, i * 3, i * 3 + 3);      // a painted line
}
const lift = bakedShadowLift(col, pos, n, null);
const liftAt = (fn) => { let s = 0, c = 0; for (let i = 0; i < n; i++) if (fn(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], i)) { s += lift[i]; c++; } return s / c; };
const shadowed = liftAt((x, y, z) => y === 0 && x > 0.75 && x < 1.05 && z > 0.75 && z < 1.05);
const lit = liftAt((x, y, z) => y === 0 && x < -0.6 && z < -0.6);
const stripe = liftAt((x, y, z) => y === 0 && x < -0.6 && Math.abs(z) < 0.01);
assert.ok(shadowed > 1.4, 'baked shadow is lifted: ' + shadowed.toFixed(2));
assert.ok(Math.abs(lit - 1) < 0.05, 'lit floor unchanged: ' + lit.toFixed(2));
assert.ok(stripe < 1.35, 'a thin painted line keeps most of its darkness: ' + stripe.toFixed(2));

// contact shadow: darker right under the box with it on
const on = shadowMap(pos, n, null, { ...normalizeLighting({ ...DEFAULT_LIGHTING, enabled: true, elevation: 80, contactShadow: 0.9, shadowOpacity: 0.4 }) }, { size: 128 });
const off = shadowMap(pos, n, null, { ...normalizeLighting({ ...DEFAULT_LIGHTING, enabled: true, elevation: 80, contactShadow: 0, shadowOpacity: 0.4 }) }, { size: 128 });
const at = (m, x, z) => { const u = Math.floor((x - m.bounds.x0) / (m.bounds.x1 - m.bounds.x0) * m.size), v = Math.floor((z - m.bounds.z0) / (m.bounds.z1 - m.bounds.z0) * m.size); return m.data[v * m.size + u]; };
assert.ok(at(on, 0.29, 0) > at(off, 0.29, 0) + 0.1, `contact shadow at the box's foot (${at(on, 0.29, 0).toFixed(2)} vs ${at(off, 0.29, 0).toFixed(2)})`);
assert.equal(normalizeLighting({}).ao, 0.5); assert.equal(normalizeLighting({ delight: 7 }).delight, 1);
console.log('shadow depth (creases, baked shadows, contact): all checks passed');
