import assert from 'node:assert/strict';
import { similarityFromPairs, applyT, refineAlignment, estimateSpacing, transformSplats, findDoubles, colourMatch, applyColourMatch,
  findPartOpening, attachToPart, maskToRanges, rangesToIndices, normalizeLinks, looseSplats, matToQuat } from '../js/modules/scan-link.js';
import { partTransform, normalizePart } from '../js/modules/part-animator.js';

let seed = 1; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const rotY = (a) => [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)];
const rotX = (a) => [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
const mm = (A, B) => { const o = []; for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o.push(A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c]); return o; };

// 1) pairs → similarity
const truth = { R: mm(rotY(0.7), rotX(-0.3)), s: 1.8, t: [3, -1, 2] };
const src = Array.from({ length: 5 }, () => [rnd() * 4 - 2, rnd() * 2, rnd() * 3]);
const dst = src.map(p => applyT(truth, p));
const T = similarityFromPairs(src, dst);
assert.ok(Math.abs(T.s - 1.8) < 1e-6, 'scale ' + T.s);
for (const p of src) { const a = applyT(T, p), b = applyT(truth, p); assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-6); }
assert.throws(() => similarityFromPairs(src.slice(0, 2), dst.slice(0, 2)), /at least 3/);

// 2) a "car": exterior shell (base) + an interior scan that also saw the sills/frame
const P = [], add = (p) => P.push(...p);
const shell = (n) => { for (let i = 0; i < n; i++) { const f = Math.floor(rnd() * 6), u = rnd() * 2 - 1, v = rnd() * 2 - 1; const p = [[1, u, v], [-1, u, v], [u, 1, v], [u, -1, v], [u, v, 1], [u, v, -1]][f]; add([p[0] * 2, p[1] * 0.7 + 0.7, p[2] * 0.9]); } };
shell(40000);
const nBase = P.length / 3;
// interior scan, in its own coordinates: seats + the lower shell (overlap)
const inner = [];
for (let i = 0; i < 15000; i++) inner.push([rnd() * 2.4 - 1.2, rnd() * 0.5 + 0.2, rnd() * 1.2 - 0.6]);       // seats
for (let i = 0; i < 12000; i++) {   // what both scans saw: sills, floor, the ends (overlap)
  const u = rnd() * 2 - 1, w = rnd() * 2 - 1, f = rnd() < 0.5 ? 1 : -1, k = rnd();
  inner.push(k < 0.4 ? [u * 2, rnd() * 0.5, f * 0.9] : k < 0.75 ? [u * 2, 0, w * 0.9] : [f * 2, rnd() * 0.6, w * 0.9]);
}
const linkTruth = { R: mm(rotY(-0.4), rotX(0.1)), s: 0.5, t: [10, 2, -3] };   // second scan sits elsewhere, half size
for (const p of inner) add(applyT(linkTruth, p).map(v => v + (rnd() - 0.5) * 0.002));
const positions = Float32Array.from(P), N = positions.length / 3;
const baseIdx = Array.from({ length: nBase }, (_, i) => i), linkIdx = Array.from({ length: N - nBase }, (_, i) => nBase + i);
// user clicks 4 rough pairs on the overlap (with a few mm of click error)
const pick = [[2, 0.2, 0.9], [-2, 0.3, 0.9], [1.5, 0.1, -0.9], [-1, 0.4, -0.9]];
const inv = (p) => { // second-scan coordinates of a base point
  const q = [(p[0] - linkTruth.t[0]) / linkTruth.s, (p[1] - linkTruth.t[1]) / linkTruth.s, (p[2] - linkTruth.t[2]) / linkTruth.s], R = linkTruth.R;
  return [R[0] * q[0] + R[3] * q[1] + R[6] * q[2], R[1] * q[0] + R[4] * q[1] + R[7] * q[2], R[2] * q[0] + R[5] * q[1] + R[8] * q[2]];
};
const linkPicks = pick.map(p => applyT(linkTruth, p).map(v => v + (rnd() - 0.5) * 0.04));
const T0 = similarityFromPairs(linkPicks, pick.map(p => p.map(v => v + (rnd() - 0.5) * 0.04)));
const sp = estimateSpacing(positions, baseIdx);
assert.ok(sp > 0.005 && sp < 0.1, 'spacing ' + sp);
const t0 = Date.now();
const fit = refineAlignment(positions, baseIdx, linkIdx, T0, { spacing: sp });
const err = (Tx) => { let e = 0; for (const p of pick) { const a = applyT(Tx, applyT(linkTruth, p)); e = Math.max(e, Math.hypot(a[0] - p[0], a[1] - p[1], a[2] - p[2])); } return e; };
console.log(`  rough pick error ${err(T0).toFixed(4)} → after snap ${err(fit.T).toFixed(4)} (spacing ${sp.toFixed(4)}, overlap ${(fit.overlap * 100).toFixed(0)} %, ${Date.now() - t0} ms)`);
assert.ok(err(fit.T) < err(T0) && err(fit.T) < sp * 0.8, 'snap tightens the line-up');

// apply to S
const S = { positions: positions.slice(), rotation: new Float32Array(N * 4), scaleXYZ: new Float32Array(N * 3).fill(0.01), alive: new Uint8Array(N).fill(1),
  colors: new Float32Array(N * 3), opacity: new Float32Array(N).fill(0.9) };
for (let i = 0; i < N; i++) S.rotation[i * 4] = 1;
transformSplats(S, linkIdx, fit.T);
assert.ok(Math.abs(S.scaleXYZ[linkIdx[0] * 3] - 0.01 * fit.T.s) < 1e-7, 'sizes follow the scale');
const qq = matToQuat(fit.T.R); assert.ok(Math.abs(Math.abs(S.rotation[linkIdx[0] * 4]) - Math.abs(qq[0])) < 1e-5, 'rotations follow');
// doubles: the overlap (lower sides) but not the seats
const dbl = findDoubles(S.positions, baseIdx, linkIdx, sp * 2.5);
const dblSet = new Set(dbl);
const seatHit = linkIdx.slice(0, 15000).filter(i => dblSet.has(i)).length / 15000, sideHit = linkIdx.slice(15000).filter(i => dblSet.has(i)).length / 12000;
assert.ok(sideHit > 0.85 && seatHit < 0.05, `doubles: sides ${sideHit.toFixed(2)}, seats ${seatHit.toFixed(2)}`);

// colour match: second scan is darker and warmer
for (let i = 0; i < N; i++) { const g = 0.3 + 0.4 * ((S.positions[i * 3] + 2) / 4); S.colors[i * 3] = g; S.colors[i * 3 + 1] = g; S.colors[i * 3 + 2] = g; }
for (const i of linkIdx) { S.colors[i * 3] = S.colors[i * 3] * 0.7 + 0.05; S.colors[i * 3 + 1] *= 0.6; S.colors[i * 3 + 2] *= 0.5; }
const cm = colourMatch(S.positions, S.colors, baseIdx, linkIdx, sp * 1.5);
applyColourMatch(S, linkIdx, cm);
let ce = 0, cn = 0;
for (const i of linkIdx.slice(15000)) { const g = 0.3 + 0.4 * ((S.positions[i * 3] + 2) / 4); ce += Math.abs(S.colors[i * 3 + 1] - g); cn++; }
assert.ok(ce / cn < 0.02, 'colours match after: ' + (ce / cn));

// 3) door: closed in the base, open (55° of a 70° part) in the second scan, with its inner panel
const door = normalizePart({ id: 'door', box: { min: [0, 0.2, 0.88], max: [1, 1.2, 0.92] }, motion: { type: 'hinge', axis: [0, 1, 0], pivot: [1, 0.7, 0.9], angle: 70 } });
const D = [], closed = [], opened = [];
for (let i = 0; i < 3000; i++) { closed.push(D.length / 3); D.push(rnd(), 0.2 + rnd(), 0.91); }                           // outer skin (base)
const openTf = partTransform(door, 55 / 70);
for (let i = 0; i < 3000; i++) { opened.push(D.length / 3); D.push(...openTf.apply([rnd(), 0.2 + rnd(), 0.91])); }     // outer skin, seen open
const innerStart = D.length / 3;
for (let i = 0; i < 2500; i++) { opened.push(D.length / 3); D.push(...openTf.apply([rnd(), 0.2 + rnd(), 0.86])); }     // inner panel, only seen open
const SD = { positions: Float32Array.from(D), rotation: new Float32Array(D.length / 3 * 4).map((_, k) => (k % 4 ? 0 : 1)), alive: new Uint8Array(D.length / 3).fill(1) };
const dsp = 0.02;
const found = findPartOpening(SD.positions, door, closed, opened, dsp * 1.5);
assert.ok(Math.abs(found.t * 70 - 55) < 1.5, 'opening angle found: ' + (found.t * 70).toFixed(1) + '°');
const res = attachToPart(SD, door, closed, opened, found.t, dsp * 1.5);
assert.ok(res.removed.length > 2700 && res.removed.length < 3300, 'outer skin doubles removed: ' + res.removed.length);
const innerKept = res.attached.filter(i => i >= innerStart).length;
assert.ok(innerKept > 2400, 'inner panel kept: ' + innerKept);
const zs = res.attached.filter(i => i >= innerStart).map(i => SD.positions[i * 3 + 2]);
assert.ok(zs.every(z => Math.abs(z - 0.86) < 0.01), 'inner panel back in the closed door');

// loose splats
const L = { positions: new Float32Array(0), alive: null, opacity: null, scaleXYZ: null };
{ const p = [], o = [], s = []; for (let i = 0; i < 2000; i++) { p.push(rnd(), rnd(), 0); o.push(0.9); s.push(0.01, 0.01, 0.01); }
  for (let i = 0; i < 30; i++) { p.push(rnd(), rnd(), 0.3 + rnd() * 0.4); o.push(0.2); s.push(0.05, 0.05, 0.05); }
  L.positions = Float32Array.from(p); L.opacity = Float32Array.from(o); L.scaleXYZ = Float32Array.from(s); }
const loose = looseSplats(L, Array.from({ length: 2030 }, (_, i) => i), 0.02);
assert.ok(loose.length >= 27 && loose.every(i => i >= 2000), 'fizz found: ' + loose.length);

// ranges survive saving (dead splats dropped)
const mask = new Uint8Array(10), alive = new Uint8Array(10).fill(1);
mask.set([0, 0, 1, 1, 1, 0, 1, 1, 0, 0]); alive[3] = 0;
const ranges = maskToRanges(mask, alive);
assert.deepEqual(ranges, [[2, 2], [5, 2]]);
assert.deepEqual([...rangesToIndices(ranges)], [2, 3, 5, 6]);
assert.deepEqual(normalizeLinks([{ ranges: [[1, 2], [-1, 3], 'x'], revealWith: ['door<>'], reveal: 'bad' }])[0], { id: 'link0', name: 'Inside', kind: 'inside', reveal: 'opened', revealWith: ['door'], ranges: [[1, 2]] });
console.log('scan-link: all tests passed');
