import assert from 'node:assert/strict';
import { normalizeClip, pinPose, falloff, deformPoint, eulerQuat, pinReach, FreeMover } from '../js/modules/free-move.js';
import { normalizeLace, lacePlan, bodyPoints, endShape, surfaceNormal, startT, LACED } from '../js/modules/shoe-laces.js';

const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

// ── free move ──
// keys flow through every keyframe, hold at the ends
const clip = normalizeClip({ id: 'c', duration: 2, pins: [{ id: 'p', at: [0, 0, 0], radius: 1, soft: 0.5, keys: [{ t: 0, move: [0, 0, 0] }, { t: 1, move: [1, 0, 0] }, { t: 2, move: [0, 1, 0] }] }] });
const pin = clip.pins[0];
assert.deepEqual(pinPose(pin, 0).move, [0, 0, 0]);
assert.ok(near(pinPose(pin, 1).move[0], 1) && near(pinPose(pin, 1).move[1], 0), 'passes through the key');
assert.deepEqual(pinPose(pin, 5).move, [0, 1, 0], 'holds the last key');
assert.ok(pinPose(pin, 1.5).move[1] > 0 && pinPose(pin, 1.5).move[0] > 0, 'blends between keys');
// junk is cleaned up
assert.equal(normalizeClip({ pins: [{ at: [0, 'x', 0] }] }).pins.length, 0);
assert.equal(normalizeClip({ duration: 999 }).duration, 60);
assert.equal(normalizeClip({ soundFile: { name: 'x', dataUrl: 'data:text/html;base64,AA==' } }).soundFile, undefined, 'only audio recordings');
assert.equal(normalizeClip({ pins: [{ at: [0, 0, 0], hold: true, keys: [{ t: 0, move: [1, 1, 1] }] }] }).pins[0].keys.length, 0, 'hold pins never move');

// soft brush
assert.equal(falloff(0, 1, 0.5), 1); assert.equal(falloff(1, 1, 0.5), 0); assert.equal(falloff(2, 1, 0.5), 0);
assert.ok(falloff(0.75, 1, 0.5) > 0 && falloff(0.75, 1, 0.5) < 1);

// a moving pin carries what is near it; a hold pin keeps its area still
const pins = [{ at: [0, 0, 0], hold: false }, { at: [2, 0, 0], hold: true }];
const poses = [{ move: [0, 1, 0], q: [0, 0, 0, 1] }, { move: [0, 0, 0], q: [0, 0, 0, 1] }];
assert.ok(near(deformPoint([0, 0, 0], [1, 0], pins, poses).p[1], 1), 'full pull');
assert.ok(near(deformPoint([0.5, 0, 0], [0.5, 0], pins, poses).p[1], 0.5), 'half pull');
assert.ok(near(deformPoint([2, 0, 0], [0.4, 1], pins, poses).p[1], 0), 'held still');
// turning about the pin
const turned = deformPoint([1, 0, 0], [1], [{ at: [0, 0, 0] }], [{ move: [0, 0, 0], q: eulerQuat([0, 0, 90]) }]);
assert.ok(near(turned.p[0], 0, 1e-6) && near(turned.p[1], 1, 1e-6), 'turns 90° about the pin');

// reach only covers splats inside the pins
const pos = new Float32Array([0, 0, 0, 0.5, 0, 0, 5, 0, 0]);
const r = pinReach(pos, 3, [{ at: [0, 0, 0], radius: 1, soft: 0.5 }]);
assert.deepEqual([...r.idx], [0, 1]);

// FreeMover writes in place to a Spark-like mesh and goes home after
class V { constructor() { this.x = this.y = this.z = 0; this.w = 1; } set(x, y, z, w) { this.x = x; this.y = y; this.z = z; if (w !== undefined) this.w = w; return this; } setRGB(r, g, b) { this.r = r; this.g = g; this.b = b; return this; } }
const FAKE = { Vector3: V, Quaternion: V, Color: V };
const N = 50, pts = [];
for (let i = 0; i < N; i++) pts.push([i * 0.1, 0, 0]);
const written = new Map();
const mesh = { packedSplats: {
  numSplats: N,
  forEachSplat(cb) { pts.forEach((p, i) => cb(i, { x: p[0], y: p[1], z: p[2] }, { x: 0.01, y: 0.01, z: 0.01 }, { x: 0, y: 0, z: 0, w: 1 }, 1, { r: 1, g: 1, b: 1 })); },
  setSplat(i, c) { written.set(i, [c.x, c.y, c.z]); },
}, updateVersion() {} };
globalThis.requestAnimationFrame = (f) => setTimeout(() => f(performance.now()), 4);
globalThis.cancelAnimationFrame = (h) => clearTimeout(h);
const fm = new FreeMover(FAKE, mesh, [{ id: 'wave', duration: 0.2, pins: [{ id: 'a', at: [0, 0, 0], radius: 0.35, soft: 0.5, keys: [{ t: 0, move: [0, 0, 0] }, { t: 0.2, move: [0, 1, 0] }] }] }]);
assert.ok(fm.reachCount('wave') >= 3 && fm.reachCount('wave') < 6, 'only the pinned area moves');
fm.pose('wave', 0.2);
assert.ok(near(written.get(0)[1], 1), 'pinned splat lifted');
assert.ok(!written.has(20), 'far splat untouched');
await fm.run('wave', 'close');
assert.ok(near(written.get(0)[1], 0), 'back to the start');
await fm.run('wave', 'open');
assert.ok(near(written.get(0)[1], 1), 'played to the end');
assert.deepEqual(fm.list(), [{ id: 'wave', name: 'Free move', kind: 'free' }]);
fm.dispose();
assert.ok(near(written.get(0)[1], 0), 'dispose puts splats back');

// ── shoe laces ──
// a shoe top: two rows of eyelets along +z, the surface faces +y
const eye = [];
for (let j = 0; j < 5; j++) for (const x of [-0.2, 0.2]) eye.push({ p: [x, 0, j * 0.15], n: [0, 1, 0] });
const lace = normalizeLace({ id: 'l', eyelets: eye, start: 'unlaced' });
assert.ok(lace && lace.eyelets.length === 10 && lace.tie === 'bow');
assert.equal(normalizeLace({ eyelets: [{ p: [0, 0, 0] }] }), null, 'needs at least two eyelets');
assert.equal(startT(lace), 0); assert.equal(startT({ start: 'tied' }), 1); assert.equal(startT({ start: 'untied' }), LACED);
const plan = lacePlan(lace.eyelets);
assert.equal(plan.pairs, 5);
{ const sL = Math.sign(plan.L[0].p[0]); assert.ok(plan.L.every(e => Math.sign(e.p[0]) === sL) && plan.R.every(e => Math.sign(e.p[0]) === -sL), 'rows split left / right'); }
assert.ok(near(plan.along[2], 1, 1e-6), 'runs toe → top');
// criss-cross: each strand swaps sides every row
for (let j = 1; j < 5; j++) assert.notEqual(Math.sign(plan.A[j].p[0]), Math.sign(plan.A[j - 1].p[0]));
assert.equal(plan.order.length, 10, 'one lace through every eyelet');
const body = bodyPoints(plan, 0.01);
assert.equal(body.length, 19);
assert.ok(body.every(p => p[1] > 0), 'lace sits on top of the shoe');
// the ends: loose → tied bow above the knot, both sides
const loose = endShape(plan, 'A', 0, { radius: 0.01 }), tied = endShape(plan, 'A', 1, { radius: 0.01 }), tiedB = endShape(plan, 'B', 1, { radius: 0.01 });
assert.ok(near(tied.knot[0], 0, 1e-6), 'knot in the middle');
assert.ok(tied.points.every(p => p.every(Number.isFinite)) && loose.points.length === 48);
const reachSide = (pts) => Math.max(...pts.map(p => p[0])) + Math.min(...pts.map(p => p[0]));
assert.ok(Math.sign(reachSide(tied.points)) === -Math.sign(reachSide(tiedB.points)), 'loops go to opposite sides');
// normals from a flat patch point toward the viewer
const flat = new Float32Array(3000);
for (let i = 0; i < 1000; i++) { flat[i * 3] = (i % 40) / 40 - 0.5; flat[i * 3 + 1] = 0; flat[i * 3 + 2] = Math.floor(i / 40) / 25 - 0.5; }
const nUp = surfaceNormal(flat, 1000, [0, 0, 0], { radius: 0.1, toward: [0, 5, 0] });
assert.ok(near(Math.abs(nUp[1]), 1, 1e-6) && nUp[1] > 0);
const nDown = surfaceNormal(flat, 1000, [0, 0, 0], { radius: 0.1, toward: [0, -5, 0] });
assert.ok(nDown[1] < 0);

// the real lace in three.js: grows, ties, unties; never breaks at the ends of the timeline
const THREE = await import('../vendor/three/0.180.0/build/three.module.js');
const { LaceRig } = await import('../js/modules/shoe-laces.js');
const holder = new THREE.Group();
const rig = new LaceRig(THREE, holder, { id: 'r', eyelets: eye, start: 'unlaced' });
assert.equal(rig.t, 0); assert.equal(rig.body.visible, false, 'no lace yet');
for (const t of [0, 0.1, 0.3, 0.59, LACED, 0.61, 0.8, 0.999, 1]) rig.pose(t);   // every stage, incl. the exact ends
assert.ok(rig.body.visible && rig.knot.visible && rig.ends.every(e => e.visible), 'tied: body, ends and knot');
rig.pose(LACED); assert.ok(!rig.knot.visible, 'untied: no knot');
await rig.run('unlace'); assert.equal(rig.t, 0);
rig.set({ ...lace, tie: 'none' }); await rig.run('toggle'); assert.equal(rig.t, LACED, 'loose ends: toggle laces up only');
rig.dispose(); assert.equal(holder.children.length, 0, 'removed cleanly');
console.log('free move + shoe laces: all checks passed');
