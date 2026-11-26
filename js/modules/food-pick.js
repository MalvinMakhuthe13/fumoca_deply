/**
 * Food that reacts when it is picked up — a slice of pizza lifted with its
 * cheese stretching, a pie or cake slice raised on a server, a piece of meat
 * or salad taken with chopsticks or a fork, noodles drooping.
 *
 * CPU deformation of the scan's own splats (no AI, no GPU work):
 *   piece    rises, pulls away from the rest and tips; it droops under its own
 *            weight the further a splat is from where it is held
 *   strands  splats of the rest along the cut (cheese, filling, sauce) are
 *            pulled out with the piece, stretch, then let go and settle back
 *   utensil  chopsticks close on it, a fork pierces it or a server slides
 *            under it before the lift (simple 3D props)
 */

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (v) => Math.hypot(v[0], v[1], v[2]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (v) => { const l = len(v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };

// ─── region: the piece's outline (top view) + height, so a wedge is a wedge ──
/** Convex hull of 2D points (monotone chain), counter-clockwise. */
export function hull2(pts) {
  const p = pts.map(q => [q[0], q[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const c = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const q of p) { while (lo.length >= 2 && c(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (hi.length >= 2 && c(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}

export function inPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function normalizeRegion(r) {
  if (!r || !Array.isArray(r.poly) || r.poly.length < 3 || r.poly.length > 256) return null;
  const poly = r.poly.filter(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)).map(p => [+p[0], +p[1]]);
  if (poly.length < 3 || !Number.isFinite(+r.ymin) || !Number.isFinite(+r.ymax)) return null;
  return { poly, ymin: Math.min(+r.ymin, +r.ymax), ymax: Math.max(+r.ymin, +r.ymax) };
}

/** Region from selected splat centres: outline in x–z, plus the height range. */
export function regionFromPoints(positions, indices) {
  const step = Math.max(1, Math.floor(indices.length / 20000));
  const pts = [], ys = [];
  for (let k = 0; k < indices.length; k += step) { const i = indices[k]; pts.push([positions[i * 3], positions[i * 3 + 2]]); ys.push(positions[i * 3 + 1]); }
  ys.sort((a, b) => a - b);
  const h = hull2(pts);
  // simplify to ≤ 64 points
  const poly = h.length > 64 ? h.filter((_, i) => i % Math.ceil(h.length / 64) === 0) : h;
  const pad = (ys[ys.length - 1] - ys[0]) * 0.08 + 1e-6;
  return { poly, ymin: ys[0] - pad, ymax: ys[ys.length - 1] + pad };
}

export function regionMembers(positions, count, region) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const y = positions[i * 3 + 1];
    if (y < region.ymin || y > region.ymax) continue;
    if (inPoly(positions[i * 3], positions[i * 3 + 2], region.poly)) out.push(i);
  }
  return Int32Array.from(out);
}

// ─── strands: what stretches out of the cut ─────────────────────────────────
function grid(positions, idx, cell) {
  const m = new Map();
  for (const i of idx) {
    const k = `${Math.floor(positions[i * 3] / cell)},${Math.floor(positions[i * 3 + 1] / cell)},${Math.floor(positions[i * 3 + 2] / cell)}`;
    let a = m.get(k); if (!a) m.set(k, (a = [])); a.push(i);
  }
  return m;
}

/**
 * Splats of the rest (not the piece) within `zone` of the piece: each gets
 * the nearest piece splat and how strongly it follows (1 at the cut → 0 at
 * the edge of the zone).
 */
export function findStrands(positions, count, members, zone) {
  if (!(zone > 0) || !members.length) return { idx: new Int32Array(0), near: new Int32Array(0), w: new Float32Array(0) };
  const isMember = new Uint8Array(count); for (const i of members) isMember[i] = 1;
  const g = grid(positions, members, zone);
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const i of members) for (let k = 0; k < 3; k++) { const v = positions[i * 3 + k]; if (v < lo[k]) lo[k] = v; if (v > hi[k]) hi[k] = v; }
  const idx = [], near = [], w = [];
  for (let i = 0; i < count; i++) {
    if (isMember[i]) continue;
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    if (x < lo[0] - zone || x > hi[0] + zone || y < lo[1] - zone || y > hi[1] + zone || z < lo[2] - zone || z > hi[2] + zone) continue;
    const cx = Math.floor(x / zone), cy = Math.floor(y / zone), cz = Math.floor(z / zone);
    let best = -1, bd = zone * zone;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const a = g.get(`${cx + dx},${cy + dy},${cz + dz}`); if (!a) continue;
      for (const j of a) { const ex = positions[j * 3] - x, ey = positions[j * 3 + 1] - y, ez = positions[j * 3 + 2] - z, d2 = ex * ex + ey * ey + ez * ez; if (d2 < bd) { bd = d2; best = j; } }
    }
    if (best < 0) continue;
    idx.push(i); near.push(best); w.push((1 - Math.sqrt(bd) / zone) ** 1.5);
  }
  return { idx: Int32Array.from(idx), near: Int32Array.from(near), w: Float32Array.from(w) };
}

// ─── the motion ─────────────────────────────────────────────────────────────
/** 0…1 openness → utensil phase and lift progress. */
export function pickPhases(t) {
  return { grip: smooth(t / 0.2), lift: smooth((t - 0.18) / 0.82) };
}

/** How much the strands are pulled at lift progress u: stretch, then let go. */
export function strandPull(u) {
  if (u <= 0.5) return smooth(u / 0.5);
  if (u <= 0.72) return 1 - smooth((u - 0.5) / 0.22);
  return 0;
}

function axisQuat(axis, rad) { const s = Math.sin(rad / 2); return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(rad / 2)]; }
function rot(q, v) {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}

/**
 * The piece at lift progress u: returns { q, apply(p) } where apply moves a
 * splat centre (rise, pull away, tip, droop).
 *   motion: { pivot (where it is held), dir (pull-away, level), lift, distance (reach),
 *             angle (tip, deg), droop (0…1), size (piece length) }
 */
export function pickTransform(m, u) {
  const up = [0, 1, 0], dir = norm([m.dir[0], 0, m.dir[2]]);
  const tipAxis = norm(cross(dir, up));                       // tips the far end down
  const q = axisQuat(tipAxis, (m.angle * Math.PI / 180) * u);
  const move = [up[0] * m.lift * u + dir[0] * m.distance * u, up[1] * m.lift * u, up[2] * m.lift * u + dir[2] * m.distance * u];
  const size = Math.max(1e-6, m.size || 1), droop = m.droop * size * u;
  return {
    q, move,
    apply: (p) => {
      const r = sub(p, m.pivot);
      const h = Math.hypot(r[0], r[2]) / size;                  // how far from where it is held
      const rr = rot(q, r);
      return [rr[0] + m.pivot[0] + move[0], rr[1] + m.pivot[1] + move[1] - droop * h * h, rr[2] + m.pivot[2] + move[2]];
    },
  };
}

// ─── utensils ───────────────────────────────────────────────────────────────
export const UTENSILS = ['none', 'chopsticks', 'fork', 'server'];

/**
 * Simple props that do the picking. Built in the splat's own space (add to
 * the splat mesh). update(t, motion) poses them.
 */
export function makeUtensil(THREE, kind, size) {
  if (!THREE || kind === 'none' || !UTENSILS.includes(kind)) return null;
  const g = new THREE.Group(); g.name = 'fumoca-utensil';
  const wood = new THREE.MeshStandardMaterial({ color: 0xc8a06a, roughness: 0.6, metalness: 0 });
  const steel = new THREE.MeshStandardMaterial({ color: 0xd8dbe0, roughness: 0.22, metalness: 0.9 });
  const L = size;
  if (kind === 'chopsticks') {
    for (const s of [-1, 1]) {
      const geo = new THREE.CylinderGeometry(L * 0.022, L * 0.008, L * 1.7, 10); geo.translate(0, L * 0.85, 0);   // tip at the origin
      const stick = new THREE.Mesh(geo, wood); stick.userData.side = s; g.add(stick);
    }
  } else if (kind === 'fork') {
    const handle = new THREE.Mesh(new THREE.BoxGeometry(L * 0.08, L * 1.0, L * 0.025), steel); handle.position.y = L * 0.85; g.add(handle);
    const neck = new THREE.Mesh(new THREE.BoxGeometry(L * 0.16, L * 0.08, L * 0.025), steel); neck.position.y = L * 0.32; g.add(neck);
    for (let k = 0; k < 4; k++) { const tine = new THREE.Mesh(new THREE.BoxGeometry(L * 0.022, L * 0.3, L * 0.02), steel); tine.position.set((k - 1.5) * L * 0.045, L * 0.15, 0); g.add(tine); }
  } else if (kind === 'server') {
    const shape = new THREE.Shape(); shape.moveTo(0, 0); shape.lineTo(-L * 0.32, L * 0.9); shape.lineTo(L * 0.32, L * 0.9); shape.lineTo(0, 0);
    const blade = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshStandardMaterial({ color: 0xd8dbe0, roughness: 0.25, metalness: 0.9, side: THREE.DoubleSide }));
    blade.rotation.x = -Math.PI / 2; g.add(blade);
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(L * 0.04, L * 0.05, L * 0.9, 10), wood); handle.rotation.x = Math.PI / 2; handle.position.set(0, L * 0.03, L * 0.45); g.add(handle);
  }
  g.traverse(o => { if (o.isMesh) { o.castShadow = false; o.renderOrder = 5; } });
  g.userData.kind = kind; g.userData.size = size;
  g.visible = false;
  return g;
}

/** Pose a utensil for openness t. */
export function poseUtensil(THREE, g, m, t) {
  if (!g) return;
  const { grip, lift } = pickPhases(t);
  g.visible = t > 0.001;
  if (!g.visible) return;
  const tf = pickTransform(m, lift), kind = g.userData.kind, L = g.userData.size;
  const hold = tf.apply(m.pivot);                                 // where it is held now
  const dir = norm([m.dir[0], 0, m.dir[2]]), side = norm(cross([0, 1, 0], dir));
  g.position.set(hold[0], hold[1], hold[2]);
  const q = new THREE.Quaternion(tf.q[0], tf.q[1], tf.q[2], tf.q[3]);
  // utensils come from the visitor's side (along the pull-away direction)
  const face = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(
    new THREE.Vector3(...side), new THREE.Vector3(0, 1, 0), new THREE.Vector3(...dir)));
  if (kind === 'chopsticks') {
    const lean = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.7);   // held at an angle
    g.quaternion.copy(q).multiply(face).multiply(lean);
    const spread = L * 0.18 * (1 - grip), drop = L * 0.5 * (1 - grip);
    g.children.forEach(st => { st.position.set(st.userData.side * (L * 0.03 + spread), drop, 0); st.rotation.z = -st.userData.side * 0.06 * (1 - grip); });
  } else if (kind === 'fork') {
    const lean = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.35);
    g.quaternion.copy(q).multiply(face).multiply(lean);
    g.position.y += L * 0.6 * (1 - grip) - L * 0.06 * grip;        // comes down and pierces
  } else if (kind === 'server') {
    g.quaternion.copy(q).multiply(face);
    // slides in under the piece from the visitor's side, then lifts with it
    const under = (m.bottom ?? m.pivot[1]) - m.pivot[1];
    g.position.set(hold[0] + dir[0] * L * 0.9 * (1 - grip), hold[1] + under - L * 0.01, hold[2] + dir[2] * L * 0.9 * (1 - grip));
    g.children[0].scale.setScalar(1);
  }
}
