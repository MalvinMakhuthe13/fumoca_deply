import assert from 'node:assert/strict';
import { sitFlat, findBase, quatFromTo, rotateVec } from '../js/modules/sit-flat.js';
let seed = 9; const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const norm = (v) => { const l = Math.hypot(...v); return v.map(x => x / l); };
function scene({ table = true, haze = 400 } = {}) {
  const P = [], kind = [];
  for (let i = 0; i < 12000; i++) { const z = r(), t = r() * 6.283, s = Math.sqrt(1 - z * z); P.push([0.1 * s * Math.cos(t), 0.08 * z, 0.1 * s * Math.sin(t)]); kind.push('dome'); }
  for (let i = 0; i < 3000; i++) { const t = r() * 6.283; P.push([0.1 * Math.cos(t), 0, 0.1 * Math.sin(t)]); kind.push('rim'); }
  for (let i = 0; i < 3000; i++) { const rr = 0.1 + r() * 0.07, a = -1 + r() * 2; P.push([rr * Math.cos(a), 0.002, rr * Math.sin(a)]); kind.push('brim'); }
  if (table) for (let i = 0; i < 10000; i++) { P.push([r() * 0.5 - 0.25, -0.004, r() * 0.5 - 0.25]); kind.push('table'); }
  for (let i = 0; i < haze; i++) { P.push([r() * 0.8 - 0.4, r() * 0.6 - 0.3, r() * 0.8 - 0.4]); kind.push('haze'); }
  return { P, kind };
}
function place({ P, kind }, axis, deg, offset) {
  const q = quatFromTo([0, 1, 0], norm(axis));   // object's up → axis
  const a = deg * Math.PI / 180, qq = [Math.sin(a / 2) * 0, Math.sin(a / 2) * 1, 0, Math.cos(a / 2)];   // spin about its own up first
  const pos = new Float32Array(P.length * 3), rot = new Float32Array(P.length * 4), op = new Float32Array(P.length);
  P.forEach((p, i) => { const v = rotateVec(q, rotateVec(qq, p)); pos.set([v[0] + offset[0], v[1] + offset[1], v[2] + offset[2]], i * 3); rot[i * 4] = 1; op[i] = kind[i] === 'haze' ? 0.1 : 0.9; });
  return { positions: pos, rotation: rot, alive: new Uint8Array(P.length).fill(1), opacity: op, selected: new Uint8Array(P.length), kind };
}
const check = (S, label, tol = 0.006) => {
  const ys = { dome: [], table: [], rim: [] };
  S.kind.forEach((k, i) => { if (ys[k]) ys[k].push(S.positions[i * 3 + 1]); });
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length, spread = (a) => Math.max(...a) - Math.min(...a);
  const base = ys.table.length ? ys.table : ys.rim;
  assert.ok(spread(base) < tol, `${label}: base is flat (spread ${spread(base).toFixed(4)})`);
  assert.ok(Math.abs(mean(base)) < tol, `${label}: base on the grid (y ${mean(base).toFixed(4)})`);
  assert.ok(mean(ys.dome) > mean(base) + 0.02, `${label}: object is on top, not upside down`);
  let cx = 0, cz = 0; S.kind.forEach((k, i) => { if (k === 'dome') { cx += S.positions[i * 3]; cz += S.positions[i * 3 + 2]; } });
  assert.ok(Math.hypot(cx / ys.dome.length, cz / ys.dome.length) < 0.03, `${label}: centred over the origin`);
};
// 1) cap on a table, tilted 25°, off-centre
let S = scene(); S = place(S, [0, Math.cos(0.436), Math.sin(0.436)], 40, [0.3, 0.5, -0.2]);
let res = sitFlat(S); console.log(`  table, tilted: turned ${res.angleDeg.toFixed(1)}° (${res.base.source})`); check(S, 'tilted on a table');
// 2) upside down and tilted (a scan that came in flipped)
S = place(scene(), [0.3, -1, 0.2], 10, [1, 2, 3]); res = sitFlat(S); console.log(`  upside down: turned ${res.angleDeg.toFixed(1)}°`); check(S, 'upside down');
// 3) cap alone (no table) on its side
S = place(scene({ table: false }), [1, 0.2, 0], 0, [0, 0, 0]); res = sitFlat(S); console.log(`  cap alone on its side: turned ${res.angleDeg.toFixed(1)}°`); check(S, 'cap alone', 0.01);
// 4) using a selection of the base
S = place(scene(), [0.2, 0.9, -0.4], 0, [0, 0, 0]); S.kind.forEach((k, i) => { if (k === 'table') S.selected[i] = 1; });
res = sitFlat(S); assert.equal(res.base.source, 'selection'); check(S, 'from selection');
// 5) already flat: tiny or no change
S = place(scene(), [0, 1, 0], 0, [0, 0, 0]); res = sitFlat(S); assert.ok(res.angleDeg < 1, 'already flat: ' + res.angleDeg);
console.log('sit-flat: all tests passed');
