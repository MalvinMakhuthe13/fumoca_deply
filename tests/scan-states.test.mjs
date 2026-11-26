import assert from 'node:assert/strict';
import { findMovingParts, axisAngleMat } from '../js/modules/scan-states.js';
import { partTransform } from '../js/modules/part-animator.js';

let seed = 5; const R = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const jitter = (p, a = 0.003) => [p[0] + (R() - 0.5) * a, p[1] + (R() - 0.5) * a, p[2] + (R() - 0.5) * a];
const rot = (R9, p, pv) => { const d = [p[0] - pv[0], p[1] - pv[1], p[2] - pv[2]]; return [R9[0] * d[0] + R9[1] * d[1] + R9[2] * d[2] + pv[0], R9[3] * d[0] + R9[4] * d[1] + R9[5] * d[2] + pv[1], R9[6] * d[0] + R9[7] * d[1] + R9[8] * d[2] + pv[2]]; };

// Build closed + open scans of a box-shaped object with one moving panel.
function scenario({ box, panel, move, interior, density = 9000 }) {
  const [L, H, W] = box, pts = [], tag = [];
  const facePts = (n, f) => { for (let i = 0; i < n; i++) pts.push(f()); };
  const surface = () => {
    const out = [];
    const area = { side: L * H, top: L * W, end: W * H };
    const add = (n, f) => { for (let i = 0; i < n; i++) out.push(f()); };
    add(density * area.side, () => [R() * L, R() * H, W]);
    add(density * area.side, () => [R() * L, R() * H, 0]);
    add(density * area.top, () => [R() * L, H, R() * W]);
    add(density * area.top, () => [R() * L, 0, R() * W]);
    add(density * area.end, () => [0, R() * H, R() * W]);
    add(density * area.end, () => [L, R() * H, R() * W]);
    return out;
  };
  const inPanel = panel;
  const closed = surface(), open = surface();
  const P = [], truth = [];
  for (const p of closed) { P.push(...jitter(p)); truth.push(inPanel(p) ? 'part' : 'body'); }
  const nBase = truth.length;
  for (const p of open) {
    if (inPanel(p)) { P.push(...jitter(move(p))); truth.push('openpart'); }
    else { P.push(...jitter(p)); truth.push('openbody'); }
  }
  for (const p of interior()) { P.push(...jitter(p)); truth.push('inside'); }
  const positions = Float32Array.from(P);
  const base = [], link = [];
  for (let i = 0; i < truth.length; i++) (i < nBase ? base : link).push(i);
  return { positions, base, link, truth };
}

function check(name, sc, expect) {
  const t0 = Date.now();
  const res = findMovingParts(sc.positions, sc.base, sc.link, { spacing: 0.02 });
  assert.ok(res.parts.length >= 1, name + ': found a moving part');
  const p = res.parts[0];
  const c = { part: 0, body: 0 }; for (const i of p.closedIdx) c[sc.truth[i]]++;
  const partTotal = sc.truth.filter(t => t === 'part').length;
  assert.equal(p.motion.type, expect.type, name + ': motion type ' + JSON.stringify(p.motion));
  assert.ok(c.part > partTotal * 0.9, `${name}: finds the panel (${c.part}/${partTotal})`);
  assert.ok(c.body < partTotal * 0.05, `${name}: not the body (${c.body})`);
  // the motion reproduces the real move
  const part = { motion: { ...p.motion, distance: p.motion.distance ?? 0, lift: p.motion.lift ?? 0 } };
  const tf = partTransform(part, 1);
  let err = 0, n = 0;
  for (const i of p.closedIdx.slice(0, 400)) { if (sc.truth[i] !== 'part') continue; const q = [sc.positions[i * 3], sc.positions[i * 3 + 1], sc.positions[i * 3 + 2]]; const a = tf.apply(q), b = expect.move(q); err += Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); n++; }
  err /= n;
  assert.ok(err < 0.03, `${name}: animation lands where the open scan has it (mean error ${err.toFixed(4)})`);
  console.log(`${name}: ${p.motion.type} ${p.motion.angle ? p.motion.angle.toFixed(1) + '°' : (p.motion.distance || 0).toFixed(3)}, ${c.part}/${partTotal} panel splats, ${c.body} body, error ${err.toFixed(4)}, ${Date.now() - t0} ms`);
}

// 1. car-like: side door hinged on its front vertical edge, opens 65°
{
  const pv = [0.6, 0, 1.6], Rm = axisAngleMat([0, 1, 0], 65 * Math.PI / 180);
  const move = (p) => rot(Rm, p, pv);
  const sc = scenario({ box: [4, 1.4, 1.6], panel: (p) => p[2] === 1.6 && p[0] > 0.6 && p[0] < 1.6 && p[1] > 0.2 && p[1] < 1.2, move,
    interior: () => { const o = []; for (let i = 0; i < 3000; i++) o.push([0.8 + R() * 0.6, 0.3 + R() * 0.5, 0.4 + R() * 0.8]); return o; } });
  check('car door', sc, { type: 'hinge', move });
}
// 2. cabinet drawer: slides out 0.35 along +z
{
  const move = (p) => [p[0], p[1], p[2] + 0.35];
  const sc = scenario({ box: [1.2, 0.9, 0.6], panel: (p) => p[2] === 0.6 && p[0] > 0.2 && p[0] < 1.0 && p[1] > 0.5 && p[1] < 0.8, move, interior: () => [] });
  check('drawer', sc, { type: 'slide', move });
}
// 3. bin lid: top panel hinged at the back edge, opens 80°
{
  const pv = [0, 0.9, 0], Rm = axisAngleMat([1, 0, 0], -80 * Math.PI / 180);
  const move = (p) => rot(Rm, p, pv);
  const sc = scenario({ box: [0.6, 0.9, 0.6], panel: (p) => p[1] === 0.9, move, interior: () => [] });
  check('bin lid', sc, { type: 'hinge', move });
}
console.log('scan states: all checks passed');
