import assert from 'node:assert/strict';
import * as R from '../js/modules/splat-rig.js';

const near = (a, b, e = 1e-4, msg) => assert.ok(Math.abs(a - b) < e, `${msg || ''} ${a} vs ${b}`);

// 1. quaternion basics
{
  const q = R.qFromEulerDeg(0, 0, 90);
  near(q[2], Math.SQRT1_2, 1e-6, 'z90'); near(q[3], Math.SQRT1_2, 1e-6);
  const s = R.qSlerp([0,0,0,1], q, 0.5);
  near(s[2], Math.sin(Math.PI / 8), 1e-6, 'slerp half');
}

// 2. pivot rig: rotating "top" 90° about Z moves its points around the joint
const bounds = { min: [-1, 0, -1], max: [1, 2, 1] };
const rig = R.rigFromTemplate('pivot', bounds);
assert.equal(rig.bones.length, 2);
assert.ok(R.normalizeRig(rig), 'template rig normalizes');
const joint = rig.bones[1].head; // [0, 0.7, 0]
{
  const solved = R.solvePose(rig, { top: R.qFromEulerDeg(0, 0, 90) });
  const j = R.posedJoints(rig, solved);
  near(j[1].head[0], joint[0], 1e-9, 'joint stays'); near(j[1].head[1], joint[1], 1e-9);
  // tail at [0,2,0] → rotate 90° about Z around joint → [-1.3, 0.7, 0]
  near(j[1].tail[0], -(2 - joint[1]), 1e-9, 'tail x'); near(j[1].tail[1], joint[1], 1e-9, 'tail y');
}

// 3. weights + skinning on a synthetic column of points
const N = 2000, pos = new Float32Array(N * 3), rot = new Float32Array(N * 4);
for (let i = 0; i < N; i++) { pos[i*3] = (Math.random()-0.5)*0.2; pos[i*3+1] = (i / (N-1)) * 2; pos[i*3+2] = (Math.random()-0.5)*0.2; rot[i*4] = 1; }
const W = R.computeWeights(pos, N, rig);
for (let i = 0; i < N; i++) { let s = 0; for (let k = 0; k < 4; k++) s += W.weights[i*4+k]; near(s, 1, 1e-4, 'weights sum'); }
// bottom point firmly on base, top point firmly on top
assert.equal(W.indices[0], 0); assert.ok(W.weights[0] > 0.99);
assert.equal(W.indices[(N-1)*4], 1); assert.ok(W.weights[(N-1)*4] > 0.99);

{
  const out = { positions: new Float32Array(N*3), rotations: new Float32Array(N*4) };
  R.skin({ positions: pos, rotations: rot }, N, W, R.solvePose(rig, {}), out);
  for (let i = 0; i < N*3; i++) near(out.positions[i], pos[i], 1e-5, 'rest pose identity');
  R.skin({ positions: pos, rotations: rot }, N, W, R.solvePose(rig, { top: R.qFromEulerDeg(0, 0, 90) }), out);
  const t = N - 1;
  near(out.positions[t*3+1], joint[1] + pos[t*3], 0.02, 'top point swung to joint height');
  assert.ok(out.positions[t*3] < -1.2, 'top point swung left');
  near(out.positions[1], pos[1], 1e-5, 'base point unmoved');
  // gaussian orientation rotated too (w,x,y,z)
  near(out.rotations[t*4+3], Math.SQRT1_2, 1e-3, 'gaussian rotated z');
  for (let i = 0; i < N*3; i++) assert.ok(Number.isFinite(out.positions[i]));
}

// 4. human template + every preset clip samples to valid quats
for (const name of Object.keys(R.TEMPLATES)) {
  const r = R.rigFromTemplate(name, bounds);
  for (const p of R.PRESETS_FOR[name]) {
    const clip = R.normalizeClip(R.presetClip(p, r), r);
    assert.ok(clip && Object.keys(clip.tracks).length, `${name}/${p} has tracks`);
    for (let t = 0; t < clip.duration * 2; t += 0.07) {
      const pose = R.sampleClip(clip, t);
      for (const q of Object.values(pose)) near(Math.hypot(...q), 1, 1e-6, `${name}/${p} unit`);
      const sv = R.solvePose(r, pose);
      sv.mats.flat().forEach(v => assert.ok(Number.isFinite(v)));
    }
  }
}
// loop continuity: wave at t≈duration matches t=0
{
  const r = R.rigFromTemplate('human', bounds);
  const clip = R.normalizeClip(R.presetClip('wave', r), r);
  const a = R.sampleClip(clip, 0), b = R.sampleClip(clip, clip.duration - 1e-4);
  for (const k of Object.keys(a)) near(Math.abs(a[k].reduce((s, v, i) => s + v * b[k][i], 0)), 1, 1e-3, 'loop seam ' + k);
}

// 5. untrusted input rejected
assert.equal(R.normalizeRig({ bones: [{ name: 'a', parent: 'missing', head: [0,0,0], tail: [0,1,0] }] }), null);
assert.equal(R.normalizeRig({ bones: [{ name: 'a', head: [0,0,NaN], tail: [0,1,0] }] }), null);
assert.equal(R.normalizeRig({ bones: Array.from({ length: 65 }, (_, i) => ({ name: 'b' + i, head: [0,0,0], tail: [0,1,0] })) }), null);
{
  const c = R.normalizeClip({ duration: 1e9, tracks: { top: [{ t: 0, q: [0,0,0,2] }, { t: 'x', q: [0,0,0,1] }], evil: [{ t: 0, q: [0,0,0,1] }] } }, rig);
  assert.equal(c.duration, 120); assert.deepEqual(Object.keys(c.tracks), ['top']); assert.equal(c.tracks.top.length, 1);
  near(c.tracks.top[0].q[3], 1, 1e-9);
}

// 6. perf: 300k gaussians × 12 bones
{
  const n = 300000, p = new Float32Array(n*3).map(() => Math.random()*2-1), q = new Float32Array(n*4);
  const r = R.rigFromTemplate('human', bounds);
  let t0 = performance.now(); const w = R.computeWeights(p, n, r); const tw = performance.now() - t0;
  const out = { positions: new Float32Array(n*3), rotations: new Float32Array(n*4) };
  t0 = performance.now(); R.skin({ positions: p, rotations: q }, n, w, R.solvePose(r, R.sampleClip(R.normalizeClip(R.presetClip('walk', r), r), 0.3)), out);
  const ts = performance.now() - t0;
  console.log(`  weights 300k: ${tw.toFixed(0)} ms, skin frame: ${ts.toFixed(0)} ms`);
}
console.log('splat-rig: all tests passed');
