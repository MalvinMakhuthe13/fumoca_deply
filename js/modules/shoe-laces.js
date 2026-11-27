/**
 * Shoe laces — click a shoe's eyelets and Fumoca threads a lace through them
 * (criss-cross), then animates lacing it up and tying it: the ends cross,
 * make a knot and pull into a bow. Plays backwards to untie and unlace.
 * The lace is a soft braided tube that sits on the scan, in the splat's own
 * coordinates, so it moves with the shoe. CPU only, no AI.
 *
 * Openness t:  0 = no lace · LACED (0.6) = laced, ends loose · 1 = tied.
 */
import { normalizeSoundFile, SOUNDS } from './part-animator.js';
import { eig3min } from './scan-link.js';

export const LACED = 0.6;
const finite3 = (v) => Array.isArray(v) && v.length === 3 && v.every(x => Number.isFinite(+x));
const clamp = (v, lo, hi, d) => (v !== null && v !== '' && Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : d);
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a, d = [0, 1, 0]) => { const l = len(a); return l > 1e-12 ? mul(a, 1 / l) : d.slice(); };
const lerp3 = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
const ease = (u) => { u = Math.min(1, Math.max(0, u)); return u * u * (3 - 2 * u); };
export const TIES = ['bow', 'knot', 'none'];
export const STARTS = ['unlaced', 'untied', 'tied'];

export function normalizeLace(l) {
  if (!l || typeof l !== 'object') return null;
  const eyelets = (Array.isArray(l.eyelets) ? l.eyelets : []).filter(e => e && finite3(e.p))
    .map(e => ({ p: e.p.map(Number), n: finite3(e.n) && len(e.n) > 1e-9 ? unit(e.n.map(Number)) : null })).slice(0, 32);
  if (eyelets.length < 2) return null;
  const sf = normalizeSoundFile(l.soundFile);
  return {
    id: String(l.id || 'lace_' + Date.now().toString(36)).slice(0, 40),
    name: String(l.name || 'Laces').replace(/[<>]/g, '').slice(0, 60),
    eyelets,
    color: /^#[0-9a-f]{6}$/i.test(l.color || '') ? l.color : '#f4f1ea',
    width: clamp(l.width, 0.05, 4, 1),          // × auto thickness from eyelet spacing
    bow: clamp(l.bow, 0.3, 3, 1),               // × bow size
    tie: TIES.includes(l.tie) ? l.tie : 'bow',
    start: STARTS.includes(l.start) ? l.start : 'untied',
    duration: clamp(l.duration, 0.4, 20, 3),    // lacing up
    tieDuration: clamp(l.tieDuration, 0.3, 10, 1.8),
    autoplay: !!l.autoplay,
    delay: clamp(l.delay, 0, 30, 0.6),
    sound: SOUNDS.includes(l.sound) ? l.sound : 'whoosh',
    ...(sf ? { soundFile: sf } : {}),
  };
}
export function normalizeLaces(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : []).map(normalizeLace).filter(l => l && !seen.has(l.id) && seen.add(l.id)).slice(0, 12);
}
export const startT = (lace) => ({ unlaced: 0, untied: LACED, tied: 1 }[lace.start] ?? LACED);

/** Surface normal at p from the splats around it, turned toward the viewer. */
export function surfaceNormal(positions, count, p, { radius, toward = null, min = 24 } = {}) {
  let r = radius, idx = [];
  for (let tries = 0; tries < 6; tries++, r *= 1.8) {
    idx = []; const r2 = r * r;
    for (let i = 0; i < count; i++) {
      const dx = positions[i * 3] - p[0], dy = positions[i * 3 + 1] - p[1], dz = positions[i * 3 + 2] - p[2];
      if (dx * dx + dy * dy + dz * dz < r2) { idx.push(i); if (idx.length > 4000) break; }
    }
    if (idx.length >= min) break;
  }
  if (idx.length < 3) return toward ? unit(sub(toward, p)) : [0, 1, 0];
  const c = [0, 0, 0]; for (const i of idx) { c[0] += positions[i * 3]; c[1] += positions[i * 3 + 1]; c[2] += positions[i * 3 + 2]; }
  c[0] /= idx.length; c[1] /= idx.length; c[2] /= idx.length;
  const C = new Array(9).fill(0);
  for (const i of idx) {
    const d = [positions[i * 3] - c[0], positions[i * 3 + 1] - c[1], positions[i * 3 + 2] - c[2]];
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) C[a * 3 + b] += d[a] * d[b];
  }
  let n = unit(eig3min(C).n);
  if (toward && dot(n, sub(toward, p)) < 0) n = mul(n, -1);
  return n;
}

/**
 * Where the lace goes. Eyelets are taken in the order they were clicked:
 * start at the toe, end at the top (either side, any order within a pair).
 */
export function lacePlan(eyelets) {
  const P = eyelets.map(e => e.p);
  const nAvg = unit(eyelets.reduce((s, e) => add(s, e.n || [0, 0, 0]), [0, 0, 0]), [0, 1, 0]);
  const k = Math.min(2, Math.floor(P.length / 2)) || 1;
  const mean = (arr) => mul(arr.reduce(add, [0, 0, 0]), 1 / arr.length);
  const toeC = mean(P.slice(0, k)), topC = mean(P.slice(-k));
  let along = sub(topC, toeC); along = sub(along, mul(nAvg, dot(along, nAvg)));
  if (len(along) < 1e-9) along = cross(nAvg, unit(sub(P[1], P[0])));
  along = unit(along);
  const across = unit(cross(along, nAvg));
  const c = mean(P);
  const left = [], right = [];
  eyelets.forEach((e, i) => ((dot(sub(e.p, c), across) < 0 ? left : right)).push({ ...e, n: e.n || nAvg, i }));
  // a single row (all on one side): split by alternating click order instead
  if (!left.length || !right.length) { left.length = 0; right.length = 0; eyelets.forEach((e, i) => (i % 2 ? right : left).push({ ...e, n: e.n || nAvg, i })); }
  const byAlong = (a, b) => dot(a.p, along) - dot(b.p, along);
  left.sort(byAlong); right.sort(byAlong);
  const m = Math.min(left.length, right.length);
  const L = left.slice(0, m), R = right.slice(0, m);
  const gaps = []; for (let j = 0; j < m; j++) gaps.push(len(sub(L[j].p, R[j].p)));
  for (let j = 1; j < m; j++) gaps.push(len(sub(L[j].p, L[j - 1].p)));
  const spacing = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : len(sub(P[0], P[P.length - 1])) || 0.01;
  // criss-cross: two strands leave the bar at the toe and swap sides each row
  const A = [], B = [];
  for (let j = 0; j < m; j++) { A.push(j % 2 ? L[j] : R[j]); B.push(j % 2 ? R[j] : L[j]); }
  const order = [...A.slice().reverse(), ...B];   // one continuous lace: top-A … toe bar … top-B
  return { L, R, A, B, order, up: nAvg, along, across, spacing, pairs: m };
}

/** The laced body: through every eyelet, arching over the gap between them. */
export function bodyPoints(plan, radius) {
  const pts = [], o = plan.order;
  for (let j = 0; j < o.length; j++) {
    const e = o[j];
    pts.push(add(e.p, mul(e.n, radius * 1.6)));   // clear of the scan's soft surface
    if (j < o.length - 1) {
      const f = o[j + 1], mid = lerp3(e.p, f.p, 0.5), g = len(sub(e.p, f.p));
      pts.push(add(mid, mul(plan.up, radius * 3.2 + g * 0.07)));
    }
  }
  return pts;
}

/** One loose end, the knot, and the bow, sampled as N points. */
export function endShape(plan, which, u, { radius, bow = 1, tie = 'bow', N = 48 } = {}) {
  const strand = which === 'A' ? plan.A : plan.B;
  const T = strand[strand.length - 1], other = (which === 'A' ? plan.B : plan.A).at(-1);
  const up = plan.up, toe = mul(plan.along, -1);
  const side = Math.sign(dot(sub(T.p, other.p), plan.across)) || (which === 'A' ? 1 : -1);
  const top = add(T.p, mul(T.n, radius * 1.6));
  const gapTop = Math.max(len(sub(T.p, other.p)), plan.spacing * 0.6);
  const Lb = gapTop * 0.62 * bow;
  const K = add(lerp3(T.p, other.p, 0.5), mul(up, radius * 4.2));
  const hang = Lb * 2.3;
  const loose = (v) => add(add(top, mul(add(mul(plan.across, side * 0.75), mul(toe, 0.25)), hang * v)), mul(up, -hang * 0.55 * v * v + radius * 2 * Math.sin(Math.PI * Math.min(1, v * 2))));
  const crossed = (v) => v < 0.18 ? lerp3(top, K, v / 0.18) : add(K, add(mul(up, Lb * 1.1 * (v - 0.18) / 0.82), mul(plan.across, -side * Lb * 0.35 * (v - 0.18) / 0.82)));
  const tied = (v) => {
    if (v < 0.14) return lerp3(top, K, v / 0.14);
    if (tie === 'bow' && v < 0.62) {
      const th = ((v - 0.14) / 0.48) * Math.PI * 2;
      return add(K, add(add(mul(plan.across, side * Lb * 0.5 * (1 - Math.cos(th))), mul(toe, Lb * 0.34 * Math.sin(th))), mul(up, Lb * 0.12 * (1 - Math.cos(th)))));
    }
    const s = tie === 'bow' ? (v - 0.62) / 0.38 : (v - 0.14) / 0.86, reach = tie === 'bow' ? Lb * 0.95 : Lb * 1.6;
    return add(K, add(mul(add(mul(plan.across, side * 0.38), toe), reach * s), mul(up, -reach * 0.45 * s * s)));
  };
  const out = [];
  for (let k = 0; k < N; k++) {
    const v = k / (N - 1);
    let p;
    if (tie === 'none' || u <= 0) p = loose(v);
    else if (u < 0.4) p = lerp3(loose(v), crossed(v), ease(u / 0.4));
    else p = lerp3(crossed(v), tied(v), ease((u - 0.4) / 0.6));
    out.push(p);
  }
  return { points: out, knot: K };
}

/** Braided look: a soft stripe texture wrapped along the lace. */
function braidTexture(THREE, hex) {
  if (typeof document === 'undefined') return null;
  try {
    const cv = document.createElement('canvas'); cv.width = 64; cv.height = 32;
    const g = cv.getContext('2d'); if (!g) return null;
    const base = new THREE.Color(hex), dark = base.clone().multiplyScalar(0.72), light = base.clone().lerp(new THREE.Color(1, 1, 1), 0.25);
    g.fillStyle = '#' + base.getHexString(); g.fillRect(0, 0, 64, 32);
    for (let x = -32; x < 96; x += 8) {
      g.strokeStyle = '#' + dark.getHexString(); g.lineWidth = 3; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 16, 32); g.stroke();
      g.strokeStyle = '#' + light.getHexString(); g.lineWidth = 1; g.beginPath(); g.moveTo(x + 4, 0); g.lineTo(x + 20, 32); g.stroke();
    }
    const tex = new THREE.CanvasTexture(cv); tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    if ('colorSpace' in tex && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  } catch (_) { return null; }
}

/** One lace in the scene. parent is the Spark mesh (lace coordinates = splat coordinates). */
export class LaceRig {
  constructor(THREE, parent, lace) {
    this.THREE = THREE; this.parent = parent;
    this.group = new THREE.Group(); this.group.name = 'fumoca-laces';
    this.group.renderOrder = 6;
    parent?.add?.(this.group);
    this.t = 0; this.raf = 0;
    this.set(lace);
  }

  set(lace) {
    const L = normalizeLace(lace); if (!L) return false;
    const keepT = this.lace ? this.t : startT(L);
    this.lace = L;
    this.plan = lacePlan(L.eyelets);
    this.radius = Math.max(1e-5, this.plan.spacing * 0.045 * L.width);
    this._build();
    this.pose(keepT);
    return true;
  }

  _material() {
    const THREE = this.THREE, map = braidTexture(THREE, this.lace.color);
    return new THREE.MeshStandardMaterial({ color: map ? 0xffffff : this.lace.color, map, roughness: 0.88, metalness: 0 });
  }

  _clear() {
    for (const o of [...this.group.children]) { this.group.remove(o); o.geometry?.dispose?.(); }
    this.mat?.map?.dispose?.(); this.mat?.dispose?.(); this.aglMat?.dispose?.();
  }

  _build() {
    const THREE = this.THREE; this._clear();
    this.mat = this._material();
    this.aglMat = new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.35, metalness: 0.1 });
    const pts = bodyPoints(this.plan, this.radius).map(p => new THREE.Vector3(...p));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    this.segs = Math.max(24, (pts.length - 1) * 10);
    this.radial = 8;
    const geo = new THREE.TubeGeometry(curve, this.segs, this.radius, this.radial, false);
    if (this.mat.map) this.mat.map.repeat.set(curve.getLength() / (this.radius * 6), 1);
    this.body = new THREE.Mesh(geo, this.mat); this.body.name = 'lace-body';
    this.group.add(this.body);
    this.tips = [0, 1].map(() => { const m = new THREE.Mesh(new THREE.CylinderGeometry(this.radius * 1.05, this.radius * 1.05, this.radius * 7, 8), this.aglMat); this.group.add(m); return m; });
    this.knot = new THREE.Mesh(new THREE.SphereGeometry(this.radius * 2.1, 12, 10), this.mat); this.knot.scale.set(1, 0.8, 1.3); this.group.add(this.knot);
    this.ends = [null, null];
    this.group.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.renderOrder = 6; o.frustumCulled = false; } });
  }

  _endMesh(k, points, frac) {
    const THREE = this.THREE;
    const old = this.ends[k];
    if (old) { this.group.remove(old); old.geometry.dispose(); }
    const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)), false, 'centripetal');
    const geo = new THREE.TubeGeometry(curve, 48, this.radius, this.radial, false);
    geo.setDrawRange(0, Math.round(48 * frac) * this.radial * 6);
    const m = new THREE.Mesh(geo, this.mat); m.renderOrder = 6; m.frustumCulled = false;
    this.ends[k] = m; this.group.add(m);
    // aglet at the tip
    const tip = this.tips[k], u = Math.min(1, Math.max(0.02, frac));
    const at = curve.getPointAt(u), tan = curve.getTangentAt(Math.max(0, u - 0.01));
    tip.visible = frac > 0.05;
    tip.position.copy(at).addScaledVector(tan, -this.radius * 3.5);
    tip.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tan.normalize());
  }

  /** Put the lace at openness t (0 none, LACED laced, 1 tied). */
  pose(t) {
    this.t = Math.min(1, Math.max(0, t));
    const g = Math.min(1, this.t / LACED), u = Math.max(0, (this.t - LACED) / (1 - LACED));
    // lacing grows out from the toe bar to both top eyelets
    const per = this.radial * 6, total = this.segs, show = Math.round(total * ease(g));
    const start = Math.floor((total - show) / 2);
    this.body.geometry.setDrawRange(start * per, show * per);
    this.body.visible = show > 0;
    const endFrac = g < 0.85 ? 0 : Math.min(1, (g - 0.85) / 0.15);
    for (const [k, w] of [[0, 'A'], [1, 'B']]) {
      if (endFrac <= 0) { if (this.ends[k]) this.ends[k].visible = false; this.tips[k].visible = false; continue; }
      const { points, knot } = endShape(this.plan, w, this.lace.tie === 'none' ? 0 : u, { radius: this.radius, bow: this.lace.bow, tie: this.lace.tie });
      this._endMesh(k, points, endFrac);
      this.knot.position.set(...knot);
    }
    const ks = this.lace.tie === 'none' ? 0 : ease((u - 0.3) / 0.4);
    this.knot.visible = ks > 0.01; this.knot.scale.set(ks, ks * 0.8, ks * 1.3);
    globalThis.dispatchEvent?.(new CustomEvent('fumoca:laceFrame', { detail: { id: this.lace.id, t: this.t } }));
  }

  /** open/tie → tied · close/untie → back to where it starts · lace · unlace · toggle */
  run(to = 'toggle', { by = 'auto' } = {}) {
    const L = this.lace, home = startT(L);
    let target;
    if (to === 'toggle') target = L.tie === 'none' ? (this.t >= LACED - 1e-3 ? 0 : LACED) : this.t > 0.99 ? (home === 1 ? LACED : home) : 1;
    else if (to === 'open' || to === 'tie' || to === 1 || to === true) target = 1;
    else if (to === 'lace') target = LACED;
    else if (to === 'unlace') target = 0;
    else if (to === 'untie') target = Math.min(this.t, LACED);
    else target = home === 1 ? LACED : home;   // close: undo
    if (L.tie === 'none' && target > LACED) target = LACED;
    cancelAnimationFrame(this.raf);
    const from = this.t;
    // time: lacing part runs at `duration`, tying at `tieDuration`
    const span = (a, b) => { const lo = Math.min(a, b), hi = Math.max(a, b); return Math.max(0, Math.min(hi, LACED) - Math.min(lo, LACED)) / LACED * L.duration + Math.max(0, Math.max(hi, LACED) - Math.max(lo, LACED)) / (1 - LACED) * L.tieDuration; };
    const dur = Math.max(0.05, span(from, target)) * 1000;
    globalThis.dispatchEvent?.(new CustomEvent('fumoca:partMove', { detail: { id: L.id, to: target > from ? 'open' : 'closed', by, part: { id: L.id, sound: L.sound, soundFile: L.soundFile }, from, duration: dur / 1000 } }));
    const t0 = performance.now();
    return new Promise((resolve) => {
      const step = (now) => {
        const k = Math.min(1, (now - t0) / dur);
        this.pose(from + (target - from) * k);
        if (k < 1) this.raf = requestAnimationFrame(step); else { this.raf = 0; resolve(true); }
      };
      this.raf = requestAnimationFrame(step);
    });
  }

  get moving() { return !!this.raf; }

  dispose() { cancelAnimationFrame(this.raf); this._clear(); this.group.parent?.remove(this.group); }
}
