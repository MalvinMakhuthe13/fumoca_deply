/**
 * FUMOCA Splat Rig — skeleton + skinning for Gaussian splats (CPU, no AI).
 *
 *   rig      = bones with rest joints (head → tail) in the splat's own space
 *   weights  = each Gaussian bound to up to 4 bones (distance to bone
 *              segments, smooth falloff, deterministic → recomputed on load,
 *              never stored)
 *   pose     = per-bone local rotation (quaternion) about its head joint,
 *              plus an optional root offset
 *   skinning = linear blend of bone matrices for positions; the Gaussian's
 *              own orientation is rotated by the blended bone rotation
 *   clips    = per-bone rotation keyframes with easing, looped playback
 *
 * Plain arrays and numbers only, so it runs in Studio, the public viewer,
 * Web Workers and Node tests alike.
 */

// ─── quaternions [x,y,z,w] and 3×4 matrices ───────────────────────────────
export const qIdentity = () => [0, 0, 0, 1];
export function qNormalize(q) { const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]; }
export function qMul(a, b) {
  return [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
}
export function qFromEulerDeg(x = 0, y = 0, z = 0) {
  const [cx, sx, cy, sy, cz, sz] = [x, x, y, y, z, z].map((v, i) => (i % 2 ? Math.sin : Math.cos)(v * Math.PI / 360));
  return qNormalize([sx * cy * cz + cx * sy * sz, cx * sy * cz - sx * cy * sz, cx * cy * sz + sx * sy * cz, cx * cy * cz - sx * sy * sz]); // XYZ order
}
export function qSlerp(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let bb = b;
  if (d < 0) { d = -d; bb = [-b[0], -b[1], -b[2], -b[3]]; }
  if (d > 0.9995) return qNormalize(a.map((v, i) => v + (bb[i] - v) * t));
  const th = Math.acos(d), s = Math.sin(th);
  const wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s;
  return [a[0] * wa + bb[0] * wb, a[1] * wa + bb[1] * wb, a[2] * wa + bb[2] * wb, a[3] * wa + bb[3] * wb];
}
function qRotate(q, v) {
  const [x, y, z, w] = q, [vx, vy, vz] = v;
  const ix = w * vx + y * vz - z * vy, iy = w * vy + z * vx - x * vz, iz = w * vz + x * vy - y * vx, iw = -x * vx - y * vy - z * vz;
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
}
function qToMat3(q) {
  const [x, y, z, w] = q;
  return [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
}

// ─── templates (proportions of the splat's bounding box; y up) ────────────
// Each bone: [name, parent, headFraction[x,y,z], tailFraction[x,y,z]] in 0..1 of bounds.
export const TEMPLATES = {
  human: { label: 'Person', bones: [
    ['hips', null, [0.5, 0.50, 0.5], [0.5, 0.60, 0.5]],
    ['spine', 'hips', [0.5, 0.60, 0.5], [0.5, 0.76, 0.5]],
    ['neck', 'spine', [0.5, 0.80, 0.5], [0.5, 0.86, 0.5]],
    ['head', 'neck', [0.5, 0.86, 0.5], [0.5, 1.00, 0.5]],
    ['upperarm.L', 'spine', [0.66, 0.80, 0.5], [0.80, 0.64, 0.5]],
    ['forearm.L', 'upperarm.L', [0.80, 0.64, 0.5], [0.88, 0.48, 0.5]],
    ['upperarm.R', 'spine', [0.34, 0.80, 0.5], [0.20, 0.64, 0.5]],
    ['forearm.R', 'upperarm.R', [0.20, 0.64, 0.5], [0.12, 0.48, 0.5]],
    ['thigh.L', 'hips', [0.58, 0.50, 0.5], [0.59, 0.26, 0.5]],
    ['shin.L', 'thigh.L', [0.59, 0.26, 0.5], [0.60, 0.02, 0.5]],
    ['thigh.R', 'hips', [0.42, 0.50, 0.5], [0.41, 0.26, 0.5]],
    ['shin.R', 'thigh.R', [0.41, 0.26, 0.5], [0.40, 0.02, 0.5]],
  ] },
  quadruped: { label: 'Animal (4 legs)', bones: [
    ['body', null, [0.5, 0.62, 0.30], [0.5, 0.64, 0.72]],
    ['neck', 'body', [0.5, 0.66, 0.72], [0.5, 0.82, 0.86]],
    ['head', 'neck', [0.5, 0.82, 0.86], [0.5, 0.84, 1.00]],
    ['tail', 'body', [0.5, 0.64, 0.28], [0.5, 0.72, 0.00]],
    ['frontleg.L', 'body', [0.64, 0.56, 0.70], [0.64, 0.02, 0.72]],
    ['frontleg.R', 'body', [0.36, 0.56, 0.70], [0.36, 0.02, 0.72]],
    ['backleg.L', 'body', [0.64, 0.56, 0.32], [0.64, 0.02, 0.30]],
    ['backleg.R', 'body', [0.36, 0.56, 0.32], [0.36, 0.02, 0.30]],
  ] },
  chain: { label: 'Tail / tentacle (5 joints)', bones: [0, 1, 2, 3, 4].map(i => [
    'seg' + i, i ? 'seg' + (i - 1) : null, [0.5, i / 5, 0.5], [0.5, (i + 1) / 5, 0.5]]) },
  pivot: { label: 'Single pivot (nod / swing)', bones: [
    ['base', null, [0.5, 0.0, 0.5], [0.5, 0.35, 0.5]],
    ['top', 'base', [0.5, 0.35, 0.5], [0.5, 1.0, 0.5]],
  ] },
};

/** Create a rig from a template fitted to bounds {min:[x,y,z], max:[x,y,z]}. */
export function rigFromTemplate(name, bounds) {
  const t = TEMPLATES[name];
  if (!t) throw new Error('Unknown rig template: ' + name);
  const size = [0, 1, 2].map(k => bounds.max[k] - bounds.min[k]);
  const at = (f) => [0, 1, 2].map(k => bounds.min[k] + f[k] * size[k]);
  return { version: 1, template: name, bones: t.bones.map(([n, p, h, tl]) => ({ name: n, parent: p, head: at(h), tail: at(tl) })) };
}

/** Validate a rig loaded from (untrusted) NIF metadata. */
export function normalizeRig(input) {
  if (!input || !Array.isArray(input.bones) || !input.bones.length || input.bones.length > 64) return null;
  const names = new Set();
  const vec = (v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite) ? v.map(Number) : null;
  const bones = [];
  for (const b of input.bones) {
    const name = String(b?.name || '').slice(0, 40);
    const head = vec(b?.head), tail = vec(b?.tail);
    if (!name || names.has(name) || !head || !tail) return null;
    const parent = b.parent == null ? null : String(b.parent);
    if (parent !== null && !names.has(parent)) return null; // parents must come first
    names.add(name);
    bones.push({ name, parent, head, tail });
  }
  return { version: 1, template: String(input.template || 'custom').slice(0, 20), bones };
}

function segDist2(p, a, b) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const L = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2] || 1e-12;
  const t = Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / L));
  const d = [ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t];
  return d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
}

/**
 * Automatic skin weights: up to 4 nearest bones per Gaussian, weight ∝
 * exp(−d²/σ²) relative to the nearest bone, so each point belongs firmly to
 * its own bone and blends only near joints.
 */
export function computeWeights(positions, count, rig, { blend = 0.2 } = {}) {
  const B = rig.bones.length;
  const lengths = rig.bones.map(b => Math.hypot(b.tail[0] - b.head[0], b.tail[1] - b.head[1], b.tail[2] - b.head[2]));
  const scale = Math.max(1e-6, lengths.reduce((s, v) => s + v, 0) / B);
  const sigma2 = (blend * scale) ** 2;
  const indices = new Uint8Array(count * 4), weights = new Float32Array(count * 4);
  const d2 = new Float64Array(B);
  const p = [0, 0, 0];
  for (let i = 0; i < count; i++) {
    p[0] = positions[i * 3]; p[1] = positions[i * 3 + 1]; p[2] = positions[i * 3 + 2];
    for (let b = 0; b < B; b++) d2[b] = segDist2(p, rig.bones[b].head, rig.bones[b].tail);
    // pick 4 smallest
    const best = [-1, -1, -1, -1];
    for (let b = 0; b < B; b++) {
      for (let k = 0; k < 4; k++) {
        if (best[k] < 0 || d2[b] < d2[best[k]]) { best.splice(k, 0, b); best.length = 4; break; }
      }
    }
    const dMin = d2[best[0]];
    let sum = 0;
    for (let k = 0; k < 4; k++) {
      const b = best[k];
      const w = b < 0 ? 0 : Math.exp(-(d2[b] - dMin) / sigma2);
      indices[i * 4 + k] = Math.max(0, b); weights[i * 4 + k] = w; sum += w;
    }
    // drop negligible influences and renormalise so skinning can skip them exactly
    let kept = 0;
    for (let k = 0; k < 4; k++) {
      const w = weights[i * 4 + k] / (sum || 1);
      weights[i * 4 + k] = w < 1e-3 ? 0 : w; kept += weights[i * 4 + k];
    }
    for (let k = 0; k < 4; k++) weights[i * 4 + k] /= kept || 1;
  }
  return { indices, weights };
}

/**
 * Forward kinematics. pose = { [boneName]: quat [x,y,z,w] }, rootOffset [x,y,z].
 * Returns per-bone world rotation and a function mapping rest → posed points.
 * Each bone rotates about its own rest head joint, after its parent's motion.
 */
export function solvePose(rig, pose = {}, rootOffset = [0, 0, 0]) {
  const index = new Map(rig.bones.map((b, i) => [b.name, i]));
  const rot = [], trans = [];            // world transform: p' = R p + t
  rig.bones.forEach((b, i) => {
    const local = qNormalize(pose[b.name] || qIdentity());
    const pi = b.parent == null ? -1 : index.get(b.parent);
    // local motion about the rest head: p ↦ L (p − h) + h
    const Lh = qRotate(local, b.head);
    let R = local, t = [b.head[0] - Lh[0], b.head[1] - Lh[1], b.head[2] - Lh[2]];
    if (pi >= 0) {               // compose with parent's world transform: P ∘ L
      const PR = rot[pi], Pt = trans[pi];
      const Rt = qRotate(PR, t);
      R = qMul(PR, local); t = [Rt[0] + Pt[0], Rt[1] + Pt[1], Rt[2] + Pt[2]];
    } else {
      t = [t[0] + rootOffset[0], t[1] + rootOffset[1], t[2] + rootOffset[2]];
    }
    rot.push(qNormalize(R)); trans.push(t);
  });
  return { rot, trans, mats: rot.map((q, i) => [...qToMat3(q), ...trans[i]]) };
}

/** Posed joint positions (for drawing the skeleton). */
export function posedJoints(rig, solved) {
  return rig.bones.map((b, i) => {
    const h = qRotate(solved.rot[i], b.head), t = qRotate(solved.rot[i], b.tail), tr = solved.trans[i];
    return { name: b.name, head: [h[0] + tr[0], h[1] + tr[1], h[2] + tr[2]], tail: [t[0] + tr[0], t[1] + tr[1], t[2] + tr[2]] };
  });
}

/**
 * Linear blend skinning into `out` arrays.
 * rest: { positions (n*3), rotations (n*4, Gaussian [w,x,y,z]) }
 */
export function skin(rest, count, skinWeights, solved, out) {
  const { indices, weights } = skinWeights;
  const M = solved.mats, R = solved.rot;
  for (let i = 0; i < count; i++) {
    const px = rest.positions[i * 3], py = rest.positions[i * 3 + 1], pz = rest.positions[i * 3 + 2];
    let x = 0, y = 0, z = 0;
    let qx = 0, qy = 0, qz = 0, qw = 0;
    const ref = R[indices[i * 4]];
    for (let k = 0; k < 4; k++) {
      const w = weights[i * 4 + k];
      if (w === 0) continue;
      const b = indices[i * 4 + k], m = M[b];
      x += w * (m[0] * px + m[1] * py + m[2] * pz + m[9]);
      y += w * (m[3] * px + m[4] * py + m[5] * pz + m[10]);
      z += w * (m[6] * px + m[7] * py + m[8] * pz + m[11]);
      const q = R[b], s = (q[0] * ref[0] + q[1] * ref[1] + q[2] * ref[2] + q[3] * ref[3]) < 0 ? -w : w;
      qx += s * q[0]; qy += s * q[1]; qz += s * q[2]; qw += s * q[3];
    }
    out.positions[i * 3] = x; out.positions[i * 3 + 1] = y; out.positions[i * 3 + 2] = z;
    if (rest.rotations && out.rotations) {
      const l = Math.hypot(qx, qy, qz, qw) || 1;
      const b = [qx / l, qy / l, qz / l, qw / l];
      // Gaussian quaternion stored as [w,x,y,z]
      const g = [rest.rotations[i * 4 + 1], rest.rotations[i * 4 + 2], rest.rotations[i * 4 + 3], rest.rotations[i * 4]];
      const r = qMul(b, g);
      out.rotations[i * 4] = r[3]; out.rotations[i * 4 + 1] = r[0]; out.rotations[i * 4 + 2] = r[1]; out.rotations[i * 4 + 3] = r[2];
    }
  }
  return out;
}

// ─── animation clips ───────────────────────────────────────────────────────
const EASE = {
  linear: t => t,
  'ease-in-out': t => t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2,
  'ease-in': t => t * t,
  'ease-out': t => 1 - (1 - t) ** 2,
};

/** clip = { name, duration, loop, tracks: { bone: [{t, q:[x,y,z,w], ease}] } } */
export function normalizeClip(input, rig) {
  if (!input || typeof input !== 'object') return null;
  const names = new Set(rig.bones.map(b => b.name));
  const duration = Math.min(120, Math.max(0.1, Number(input.duration) || 1));
  const tracks = {};
  for (const [bone, keys] of Object.entries(input.tracks || {})) {
    if (!names.has(bone) || !Array.isArray(keys)) continue;
    const clean = keys.filter(k => Number.isFinite(k?.t) && Array.isArray(k.q) && k.q.length === 4 && k.q.every(Number.isFinite))
      .map(k => ({ t: Math.min(duration, Math.max(0, k.t)), q: qNormalize(k.q), ease: EASE[k.ease] ? k.ease : 'ease-in-out' }))
      .sort((a, b) => a.t - b.t).slice(0, 240);
    if (clean.length) tracks[bone] = clean;
  }
  return { name: String(input.name || 'Clip').slice(0, 40), duration, loop: input.loop !== false, tracks };
}

export function sampleClip(clip, time) {
  const t = clip.loop ? ((time % clip.duration) + clip.duration) % clip.duration : Math.min(clip.duration, Math.max(0, time));
  const pose = {};
  for (const [bone, keys] of Object.entries(clip.tracks)) {
    if (t <= keys[0].t) { pose[bone] = keys[0].q; continue; }
    const last = keys[keys.length - 1];
    if (t >= last.t) {
      // Looping clips blend from the last key back to the first.
      if (clip.loop && keys.length > 1 && keys[0].t === 0) {
        const span = clip.duration - last.t;
        pose[bone] = span > 1e-6 ? qSlerp(last.q, keys[0].q, EASE[keys[0].ease]((t - last.t) / span)) : last.q;
      } else pose[bone] = last.q;
      continue;
    }
    let k = 0; while (keys[k + 1].t < t) k++;
    const a = keys[k], b = keys[k + 1];
    pose[bone] = qSlerp(a.q, b.q, EASE[b.ease]((t - a.t) / (b.t - a.t)));
  }
  return pose;
}

/** Ready-made motions for each template. */
export function presetClip(name, rig) {
  const has = (n) => rig.bones.some(b => b.name === n);
  const E = qFromEulerDeg, I = qIdentity();
  const loop = (duration, tracks) => ({ name, duration, loop: true, tracks });
  const k = (pairs) => pairs.map(([t, q]) => ({ t, q, ease: 'ease-in-out' }));
  switch (name) {
    case 'wave': return loop(2, Object.fromEntries([
      has('upperarm.L') && ['upperarm.L', k([[0, I], [0.4, E(0, 0, 110)], [1.6, E(0, 0, 110)]])],
      has('forearm.L') && ['forearm.L', k([[0, I], [0.4, E(0, 0, 20)], [0.7, E(0, 0, 55)], [1.0, E(0, 0, 15)], [1.3, E(0, 0, 55)], [1.6, E(0, 0, 20)]])],
    ].filter(Boolean)));
    case 'walk': return loop(1.2, Object.fromEntries([
      ['thigh.L', k([[0, E(25, 0, 0)], [0.6, E(-25, 0, 0)]])], ['thigh.R', k([[0, E(-25, 0, 0)], [0.6, E(25, 0, 0)]])],
      ['shin.L', k([[0, I], [0.3, E(-40, 0, 0)], [0.6, I]])], ['shin.R', k([[0.6, I], [0.9, E(-40, 0, 0)], [0, I]])],
      ['upperarm.L', k([[0, E(-20, 0, 0)], [0.6, E(20, 0, 0)]])], ['upperarm.R', k([[0, E(20, 0, 0)], [0.6, E(-20, 0, 0)]])],
    ].filter(([b]) => has(b)).map(([b, keys]) => [b, keys.sort((x, y) => x.t - y.t)])));
    case 'nod': return loop(2, Object.fromEntries([[has('head') ? 'head' : rig.bones[rig.bones.length - 1].name, k([[0, I], [0.5, E(-22, 0, 0)], [1, I], [1.5, E(-22, 0, 0)]])]]));
    case 'breathe': return loop(3.2, Object.fromEntries([[has('spine') ? 'spine' : rig.bones[0].name, k([[0, I], [1.6, E(-4, 0, 0)]])]]));
    case 'wag': return loop(0.8, Object.fromEntries(rig.bones.filter(b => /tail|seg/.test(b.name)).map((b, i) => [b.name, k([[0, E(0, 18 + i * 4, 0)], [0.4, E(0, -18 - i * 4, 0)]])])));
    case 'spin': return loop(4, { [rig.bones[0].name]: k([[0, I], [1, E(0, 90, 0)], [2, E(0, 180, 0)], [3, E(0, 270, 0)]]) });
    default: throw new Error('Unknown motion: ' + name);
  }
}

export const PRESETS_FOR = { human: ['wave', 'walk', 'nod', 'breathe', 'spin'], quadruped: ['wag', 'nod', 'breathe', 'spin'], chain: ['wag', 'spin'], pivot: ['nod', 'spin'] };

export default { TEMPLATES, rigFromTemplate, normalizeRig, computeWeights, solvePose, posedJoints, skin, normalizeClip, sampleClip, presetClip, qFromEulerDeg, PRESETS_FOR };
