import assert from 'node:assert/strict';
import { restoreRigOnViewer, SplatRigDriver, fitTemplate, readRest, normalizeRigState, poseToLocal } from '../js/modules/splat-rig-driver.js';
import { qFromEulerDeg, presetClip, normalizeClip, sampleClip } from '../js/modules/splat-rig.js';

class V3 { constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;} set(x,y,z){this.x=x;this.y=y;this.z=z;return this;} }
class Q { constructor(x=0,y=0,z=0,w=1){this.x=x;this.y=y;this.z=z;this.w=w;} set(x,y,z,w){this.x=x;this.y=y;this.z=z;this.w=w;return this;} }
class C { constructor(){this.r=1;this.g=1;this.b=1;} setRGB(r,g,b){this.r=r;this.g=g;this.b=b;return this;} }
const THREE = { Vector3: V3, Quaternion: Q, Color: C };
globalThis.requestAnimationFrame ??= (f) => setTimeout(() => f(performance.now()), 1);
globalThis.cancelAnimationFrame ??= (id) => clearTimeout(id);

// fake Spark mesh: a vertical column, 0..2 in y
function fakeMesh(n) {
  const data = Array.from({ length: n }, (_, i) => ({ c: [0.05 * Math.sin(i), 2 * i / (n - 1), 0.05 * Math.cos(i)], s: [0.01, 0.02, 0.03], q: [0, 0, 0, 1], a: 0.8, col: [0.2, 0.4, 0.6] }));
  const splats = {
    numSplats: n, writes: 0, needsUpdate: false,
    forEachSplat(cb) { data.forEach((d, i) => cb(i, new V3(...d.c), new V3(...d.s), new Q(...d.q), d.a, Object.assign(new C(), { r: d.col[0], g: d.col[1], b: d.col[2] }))); },
    setSplat(i, c, s, q, a, col) { this.writes++; data[i] = { c: [c.x, c.y, c.z], s: [s.x, s.y, s.z], q: [q.x, q.y, q.z, q.w], a, col: [col.r, col.g, col.b] }; },
  };
  return { packedSplats: splats, data, updateVersion() { this.version = (this.version || 0) + 1; } };
}

const mesh = fakeMesh(1000);
const rest = readRest(mesh);
assert.equal(rest.count, 1000);
assert.equal(rest.rotations[0], 1, 'w first');
const original = mesh.data.map(d => JSON.parse(JSON.stringify(d)));

const rig = fitTemplate('pivot', rest);
const d = new SplatRigDriver(THREE, mesh, rig, { rest });
// first pose writes everything; identical pose writes nothing
assert.equal(d.applyPose({}), 1000);
assert.equal(d.applyPose({}), 0, 'unchanged pose is free');
// bend top: only splats on "top" (and blend zone) are rewritten
const n = d.applyPose({ top: qFromEulerDeg(0, 0, 90) });
assert.ok(n > 300 && n < 1000, 'only moved bone splats rewritten: ' + n);
assert.ok(mesh.data[999].c[0] < -1, 'top swung');
mesh.data[0].s.forEach((v, k) => assert.ok(Math.abs(v - [0.01, 0.02, 0.03][k]) < 1e-7, 'scale kept'));
assert.ok(Math.abs(mesh.data[999].a - 0.8) < 1e-6, 'opacity kept');
assert.ok(mesh.packedSplats.needsUpdate && mesh.version > 0);
// reset restores exactly
d.reset();
mesh.data.forEach((v, i) => v.c.forEach((x, k) => assert.ok(Math.abs(x - original[i].c[k]) < 1e-6, 'reset ' + i)));

// tilted scan: frame rotates local→upright; pose still bends about upright axes
{
  const frame = qFromEulerDeg(90, 0, 0); // local z-up scan shown y-up
  const m2 = fakeMesh(200);
  // rotate fake data so that upright(y) = frame applied to local
  const rig2 = fitTemplate('pivot', readRest(m2), frame);
  assert.equal(rig2.frame, frame);
  const local = poseToLocal({ top: qFromEulerDeg(0, 90, 0) }, frame);
  assert.ok(Math.abs(Math.hypot(...local.top) - 1) < 1e-9);
}

// state normalisation (untrusted meta)
{
  const clip = normalizeClip(presetClip('nod', rig), rig);
  const st = normalizeRigState({ rig, clip, speed: 99, splatCount: 1000 });
  assert.equal(st.speed, 4); assert.ok(st.autoplay); assert.equal(st.splatCount, 1000);
  assert.equal(normalizeRigState({ rig: { bones: 'x' } }), null);
  assert.equal(normalizeRigState(null), null);
}

// playback loop runs and stops
{
  const clip = normalizeClip(presetClip('nod', rig), rig);
  d.setClip(clip, 2);
  let frames = 0; d.onFrame = () => frames++;
  d.play();
  await new Promise(r => setTimeout(r, 120));
  d.stop();
  assert.ok(frames > 3, 'played frames ' + frames);
  d.reset();
}
// viewer restore: saved state from Studio plays on a (re-ordered) published copy
{
  const m3 = fakeMesh(500); m3.data.reverse(); m3.initialized = Promise.resolve();
  const clip = normalizeClip(presetClip('nod', rig), rig);
  const drv = await restoreRigOnViewer(THREE, m3, JSON.parse(JSON.stringify({ rig, clip, speed: 1, autoplay: true, splatCount: 1000 })));
  assert.ok(drv && drv.playing, 'viewer plays saved motion');
  await new Promise(r => setTimeout(r, 80));
  drv.dispose();
  assert.equal(await restoreRigOnViewer(THREE, m3, { rig, clip: null }), null, 'no motion → nothing to play');
  assert.equal(await restoreRigOnViewer(THREE, m3, { rig: { bones: [] } }), null, 'bad rig ignored');
}
// whole-object motion keys + ground collision
{
  const m4 = fakeMesh(400);
  const r4 = fitTemplate('pivot', readRest(m4));
  const d4 = new SplatRigDriver(THREE, m4, r4);
  const clip = normalizeClip({ name: 'slide', duration: 2, loop: true, tracks: {}, root: [{ t: 0, p: [0, 0, 0] }, { t: 1, p: [1, 0, 0] }] }, r4);
  assert.equal(clip.root.length, 2);
  const { sampleRoot } = await import('../js/modules/splat-rig.js');
  assert.ok(Math.abs(sampleRoot(clip, 0.5)[0] - 0.5) < 1e-9, 'root eases to the midpoint');
  d4.applyPose({ __root: [1, 0, 0] });
  assert.ok(Math.abs(m4.data[0].c[0] - (readRest(fakeMesh(400)).positions[0] + 1)) < 1e-5, 'whole object moved +1 x');
  // push it into the floor: with collision on it is lifted back out
  d4.groundCollision = false;
  d4.applyPose({ __root: [0, -0.5, 0] });
  const sunk = Math.min(...m4.data.map(r => r.c[1]));
  assert.ok(sunk < -0.4, 'without collision it sinks');
  d4.groundCollision = true;
  d4.applyPose({ __root: [0, -0.5, 0.0001] });
  const floor = Math.min(...m4.data.map(r => r.c[1]));
  assert.ok(Math.abs(floor - 0) < 0.02, 'ground collision keeps it on the floor: ' + floor);
  d4.applyPose({ __root: [0, 0.7, 0] });
  assert.ok(Math.min(...m4.data.map(r => r.c[1])) > 0.6, 'jumps above the floor are allowed');
  // bending a bone through the floor lifts the object
  d4.applyPose({ top: qFromEulerDeg(0, 0, 179), __root: [0, 0, 0] });
  assert.ok(Math.min(...m4.data.map(r => r.c[1])) > -0.02, 'a bone swung into the floor lifts the body');
  assert.ok(normalizeClip({ duration: 1, tracks: {}, root: [{ t: 0, p: [1e9, 0, 0] }, { t: 'x', p: [0, 0, 0] }] }, r4).root === undefined, 'bad root keys dropped');
}
console.log('splat-rig-driver: all tests passed');
