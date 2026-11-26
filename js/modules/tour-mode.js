/**
 * House / building tours (Matterport-style) for splat scans.
 *
 * A building never flips, spins or rolls. Three ways to look at it:
 *   dollhouse   orbit from above — never below the floor, never tilted
 *   floor plan  straight down, turn and zoom only
 *   walk        at eye height inside: drag to look, click the floor (or a
 *               tour dot) to walk there, scroll / W S to step, A D to turn
 *
 * Saved as meta.present.tour = { enabled, floorY, ceilingY, eyeHeight,
 * stops:[{id,name,position,yaw,pitch}], start }.
 */
import { pickSplat } from './scan-link.js';
import { readRest } from './splat-rig-driver.js';

const finite3 = (v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
const num = (v, lo, hi, d) => (Number.isFinite(+v) && v !== null && v !== '' ? Math.min(hi, Math.max(lo, +v)) : d);
const clampPitch = (p) => Math.max(-1.4, Math.min(1.4, p));

export function normalizeStop(s, i = 0) {
  if (!s || !finite3(s.position)) return null;
  return {
    id: String(s.id || 'stop' + i).replace(/[^\w-]/g, '').slice(0, 32) || 'stop' + i,
    name: String(s.name || 'Stop ' + (i + 1)).slice(0, 60),
    position: s.position.map(Number),
    yaw: num(s.yaw, -Math.PI * 4, Math.PI * 4, 0),
    pitch: clampPitch(num(s.pitch, -2, 2, 0)),
  };
}

export function normalizeTour(t) {
  if (!t || typeof t !== 'object') return null;
  const floorY = num(t.floorY, -1e6, 1e6, 0), ceilingY = num(t.ceilingY, -1e6, 1e6, floorY + 2.6);
  return {
    version: 1,
    enabled: !!t.enabled,
    floorY, ceilingY: Math.max(ceilingY, floorY + 1e-3),
    eyeHeight: num(t.eyeHeight, 1e-4, 1e5, Math.max(1e-3, (ceilingY - floorY) * 0.6)),
    stops: (Array.isArray(t.stops) ? t.stops : []).slice(0, 100).map(normalizeStop).filter(Boolean),
    start: ['dollhouse', 'walk', 'plan'].includes(t.start) ? t.start : 'dollhouse',
  };
}

/**
 * Floor and ceiling from the splats (the scan should be level first —
 * "Sit flat on the grid"). Uses solid splats only; returns heights and a
 * suggested eye height (≈1.6 m in a 2.6 m room).
 */
export function detectFloor(positions, alive, opacity) {
  const ys = [], xs = [], zs = [];
  const n = alive ? alive.length : positions.length / 3, st = Math.max(1, Math.floor(n / 80000));
  for (let i = 0; i < n; i += st) {
    if (alive && !alive[i]) continue;
    if (opacity && opacity[i] < 0.3) continue;
    xs.push(positions[i * 3]); ys.push(positions[i * 3 + 1]); zs.push(positions[i * 3 + 2]);
  }
  if (ys.length < 20) throw new Error('Not enough of the scan to find the floor.');
  const sorted = Float32Array.from(ys).sort();
  const q = (p) => sorted[Math.floor(p * (sorted.length - 1))];
  // the floor is the densest height near the bottom; the ceiling near the top
  const lo = q(0.005), hi = q(0.995), span = Math.max(1e-6, hi - lo), bins = 120, hist = new Uint32Array(bins);
  for (const y of sorted) hist[Math.min(bins - 1, Math.floor((y - lo) / span * bins))]++;
  let fb = 0; for (let b = 0; b < bins * 0.35; b++) if (hist[b] > hist[fb]) fb = b;
  let cb = bins - 1; for (let b = bins - 1; b > bins * 0.6; b--) if (hist[b] > hist[cb]) cb = b;
  const floorY = lo + (fb + 0.5) / bins * span;
  // a ceiling is a dense layer; if none (an open scan), use the top
  const ceilingY = hist[cb] > hist[fb] * 0.15 ? lo + (cb + 0.5) / bins * span : hi;
  const room = Math.max(1e-4, ceilingY - floorY);
  const sx = Float32Array.from(xs).sort(), sz = Float32Array.from(zs).sort();
  const qq = (a, p) => a[Math.floor(p * (a.length - 1))];
  return {
    floorY, ceilingY, eyeHeight: room * 0.6,
    bounds: { min: [qq(sx, 0.01), floorY, qq(sz, 0.01)], max: [qq(sx, 0.99), ceilingY, qq(sz, 0.99)] },
  };
}

/** Is a picked point on the floor (walkable), or on a wall / furniture? */
export function isFloorPoint(p, tour) {
  return Math.abs(p[1] - tour.floorY) < Math.max(tour.eyeHeight * 0.18, (tour.ceilingY - tour.floorY) * 0.06);
}

/** Where to stand to look at a wall point: back off towards the camera, on the floor. */
export function standingSpotFor(point, from, tour, back = 0.55) {
  const dx = from[0] - point[0], dz = from[2] - point[2], l = Math.hypot(dx, dz) || 1;
  const d = Math.min(l * 0.8, tour.eyeHeight * back * 2);
  return [point[0] + dx / l * d, tour.floorY, point[2] + dz / l * d];
}

const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);

export class TourController {
  /**
   * opts: { THREE, camera, controls, dom (canvas), parent (Object3D for markers),
   *         positions, count, accept (i → bool, optional), host (overlay element) }
   */
  constructor(tour, opts) {
    this.t = normalizeTour(tour);
    Object.assign(this, opts);
    this.mode = null; this.yaw = 0; this.pitch = 0; this.anim = 0;
    this.saved = { minPolar: this.controls?.minPolarAngle, maxPolar: this.controls?.maxPolarAngle, enablePan: this.controls?.enablePan, enableRotate: this.controls?.enableRotate, enabled: this.controls?.enabled };
    this.markers = this._markers();
    this._ui();
    this._bind();
    this._onLit = () => { if (this._cut?.on) { this._cut.on = false; this.setCutaway(true); } };
    globalThis.addEventListener?.('fumoca:lightingApplied', this._onLit);
  }

  // ── markers on the floor (tour dots) ──
  _markers() {
    const T = this.THREE, g = new T.Group(); g.name = 'fumoca-tour-dots';
    const r = this.t.eyeHeight * 0.16;
    for (const s of this.t.stops) {
      const ring = new T.Mesh(new T.RingGeometry(r * 0.62, r, 40), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, side: T.DoubleSide, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(s.position[0], this.t.floorY + r * 0.05, s.position[2]);
      ring.userData.stop = s; ring.renderOrder = 20;
      const dot = new T.Mesh(new T.CircleGeometry(r * 0.35, 24), new T.MeshBasicMaterial({ color: 0xc8ff00, transparent: true, opacity: 0.9, side: T.DoubleSide, depthWrite: false }));
      dot.rotation.x = -Math.PI / 2; dot.position.copy(ring.position); dot.userData.stop = s; dot.renderOrder = 21;
      g.add(ring, dot);
    }
    (this.parent || this.camera.parent)?.add?.(g);
    return g;
  }

  // ── dollhouse cutaway: hide the ceiling (and anything above the cut) ──
  _cutList() {
    if (this._cut !== undefined) return this._cut;
    this._cut = null;
    const mesh = this.mesh; if (!mesh) return null;
    try {
      const rest = readRest(mesh); mesh.updateMatrixWorld?.(true);
      const e = mesh.matrixWorld?.elements, cutY = this.t.floorY + (this.t.ceilingY - this.t.floorY) * 0.88, idx = [];
      for (let i = 0; i < rest.count; i++) {
        const x = rest.positions[i * 3], y = rest.positions[i * 3 + 1], z = rest.positions[i * 3 + 2];
        const wy = e ? e[1] * x + e[5] * y + e[9] * z + e[13] : y;
        if (wy > cutY) idx.push(i);
      }
      this._cut = { rest, idx: Int32Array.from(idx), on: false };
    } catch (_) { this._cut = null; }
    return this._cut;
  }

  setCutaway(on) {
    const c = this._cutList(); if (!c || c.on === on) return;
    const splats = this.mesh.packedSplats || this.mesh.splats; if (!splats?.setSplat) return;
    const T = this.THREE, r = c.rest, v = new T.Vector3(), sc = new T.Vector3(), q = new T.Quaternion(), col = new T.Color();
    const lit = globalThis._fumocaLightingByMesh?.get?.(this.mesh), C = lit?.settings?.enabled && lit.lit?.length === r.colors.length ? lit.lit : r.colors;
    for (const i of c.idx) {
      v.set(r.positions[i * 3], r.positions[i * 3 + 1], r.positions[i * 3 + 2]);
      sc.set(r.scales[i * 3], r.scales[i * 3 + 1], r.scales[i * 3 + 2]);
      q.set(r.rotations[i * 4 + 1], r.rotations[i * 4 + 2], r.rotations[i * 4 + 3], r.rotations[i * 4]);
      col.setRGB(C[i * 3], C[i * 3 + 1], C[i * 3 + 2]);
      splats.setSplat(i, v, sc, q, on ? 0 : r.opacity[i], col);
    }
    splats.needsUpdate = true; this.mesh.updateVersion?.();
    c.on = on;
  }

  // ── on-screen buttons ──
  _ui() {
    if (!this.host) return;
    if (getComputedStyle(this.host).position === 'static') this.host.style.position = 'relative';
    const bar = document.createElement('div');
    bar.className = 'fumoca-tour-bar';
    bar.innerHTML = `
      <button data-m="dollhouse" title="See the whole building from above">⌂ Dollhouse</button>
      <button data-m="plan" title="Floor plan from straight above">▦ Floor plan</button>
      <button data-m="walk" title="Walk through at eye height">🚶 Walk</button>
      <span class="ft-sep"></span>
      <button data-s="-1" title="Previous stop">‹</button><span class="ft-stop"></span><button data-s="1" title="Next stop">›</button>`;
    Object.assign(bar.style, { position: 'absolute', left: '50%', bottom: (this.barBottom ?? 16) + 'px', transform: 'translateX(-50%)', display: 'flex', gap: '6px', alignItems: 'center', zIndex: 45,
      background: 'rgba(10,12,16,.82)', backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,.12)', borderRadius: '999px', padding: '6px 8px', font: '700 12px system-ui,sans-serif', color: '#fff' });
    bar.querySelectorAll('button').forEach(b => Object.assign(b.style, { background: 'rgba(255,255,255,.08)', color: '#fff', border: '1px solid rgba(255,255,255,.14)', borderRadius: '999px', padding: '7px 12px', cursor: 'pointer', font: '700 12px/1 system-ui,sans-serif', whiteSpace: 'nowrap', height: '32px', minWidth: '0', display: 'inline-flex', alignItems: 'center', gap: '4px' }));
    bar.style.whiteSpace = 'nowrap';
    bar.querySelector('.ft-sep').style.cssText = 'width:1px;height:20px;background:rgba(255,255,255,.18)';
    bar.querySelector('.ft-stop').style.cssText = 'min-width:90px;text-align:center;opacity:.85;font-weight:600';
    if (!this.t.stops.length) bar.querySelectorAll('[data-s], .ft-stop, .ft-sep').forEach(e => { e.style.display = 'none'; });
    bar.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.m) this.setMode(b.dataset.m);
      if (b.dataset.s) this.nextStop(+b.dataset.s);
    });
    this.host.appendChild(bar);
    this.bar = bar;
  }

  _syncUi() {
    if (!this.bar) return;
    this.bar.querySelectorAll('[data-m]').forEach(b => { const on = b.dataset.m === this.mode; b.style.background = on ? '#c8ff00' : 'rgba(255,255,255,.08)'; b.style.color = on ? '#000' : '#fff'; });
    const s = this.t.stops[this.stopIndex ?? -1];
    const lbl = this.bar.querySelector('.ft-stop'); if (lbl) lbl.textContent = s ? s.name : `${this.t.stops.length} stops`;
  }

  // ── modes ──
  centre() { const b = this.bounds || this._bounds(); return [(b.min[0] + b.max[0]) / 2, (this.t.floorY + this.t.ceilingY) / 2, (b.min[2] + b.max[2]) / 2]; }
  _bounds() {
    const P = this.positions, n = this.count, st = Math.max(1, Math.floor(n / 40000)), xs = [], zs = [];
    for (let i = 0; i < n; i += st) { if (this.accept && !this.accept(i)) continue; xs.push(P[i * 3]); zs.push(P[i * 3 + 2]); }
    const sx = Float32Array.from(xs).sort(), sz = Float32Array.from(zs).sort(), q = (a, p) => a[Math.floor(p * (a.length - 1))];
    this.bounds = { min: [q(sx, 0.02), this.t.floorY, q(sz, 0.02)], max: [q(sx, 0.98), this.t.ceilingY, q(sz, 0.98)] };
    return this.bounds;
  }
  size() { const b = this.bounds || this._bounds(); return Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2], this.t.ceilingY - this.t.floorY); }

  /** While walking, the orbit controls must not move the camera at all
   *  (even disabled, their update() still pulls it around their target). */
  _holdControls(on) {
    const c = this.controls; if (!c) return;
    if (on && !this._held) {
      this._held = { update: c.update, damping: c.enableDamping, enabled: c.enabled };
      c.enabled = false; c.enableDamping = false; c.update = () => false;
    } else if (!on && this._held) {
      c.update = this._held.update; c.enableDamping = this._held.damping; c.enabled = true;
      this._held = null;
    }
  }

  setMode(mode) {
    const c = this.controls, T = this.THREE;
    this.mode = mode;
    this._holdControls(mode === 'walk');
    this.camera.up.set(0, 1, 0);
    const ctr = this.centre(), sz = this.size();
    if (mode === 'walk') {
      const s = this.t.stops[this.stopIndex ?? 0];
      const at = s ? s.position : [ctr[0], this.t.floorY, ctr[2]];
      if (s) this.stopIndex = this.stopIndex ?? 0;
      this.walkTo(at, s ? { yaw: s.yaw, pitch: s.pitch } : null);
    } else {
      if (c) {
        c.target?.copy?.(this.camera.position.clone().add(new T.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)).multiplyScalar(this.t.eyeHeight)));
        c.enabled = true; c.enableRotate = true; c.enablePan = false; c.screenSpacePanning = false;
        if ('minPolarAngle' in c) {
          c.minPolarAngle = mode === 'plan' ? 0 : 0.15;
          c.maxPolarAngle = mode === 'plan' ? 0.0001 : Math.PI * 0.44;   // never below the floor
        }
        if ('maxDistance' in c) { c.minDistance = sz * 0.25; c.maxDistance = sz * 3.5; }
      }
      const to = mode === 'plan'
        ? new T.Vector3(ctr[0] + 1e-3, this.t.floorY + sz * 1.6, ctr[2])
        : new T.Vector3(ctr[0] + sz * 0.9, this.t.floorY + sz * 1.05, ctr[2] + sz * 0.9);
      this._fly(to, new T.Vector3(ctr[0], this.t.floorY, ctr[2]));
    }
    this.markers.visible = true;
    this.setCutaway(mode !== 'walk');
    this._syncUi();
    globalThis.dispatchEvent?.(new CustomEvent('fumoca:tourMode', { detail: { mode } }));
  }

  nextStop(dir = 1) {
    if (!this.t.stops.length) return;
    this.stopIndex = ((this.stopIndex ?? -1) + dir + this.t.stops.length) % this.t.stops.length;
    const s = this.t.stops[this.stopIndex];
    if (this.mode !== 'walk') { this.mode = 'walk'; this._holdControls(true); this.setCutaway(false); }
    this.walkTo(s.position, { yaw: s.yaw, pitch: s.pitch });
    this._syncUi();
  }

  /** Walk (glide) to a floor point at eye height, optionally turning to yaw / pitch. */
  walkTo(floorPoint, look = null) {
    const T = this.THREE;
    const to = new T.Vector3(floorPoint[0], this.t.floorY + this.t.eyeHeight, floorPoint[2]);
    const from = this.camera.position.clone();
    const yaw0 = this.yaw, pitch0 = this.pitch;
    if (this.mode === 'walk' && !this._walking) { const d = new T.Vector3(); this.camera.getWorldDirection(d); this.yaw = Math.atan2(d.x, d.z); this.pitch = Math.asin(Math.max(-1, Math.min(1, d.y))); }
    const yaw1 = look ? look.yaw : this.yaw, pitch1 = look ? clampPitch(look.pitch) : this.pitch;
    const ys = this.yaw, ps = this.pitch;
    let dy = yaw1 - ys; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
    const dist = from.distanceTo(to), ms = Math.min(1600, 500 + dist / Math.max(1e-6, this.t.eyeHeight) * 300);
    const t0 = performance.now();
    cancelAnimationFrame(this.anim); this._walking = true;
    return new Promise((resolve) => {
      const step = (now) => {
        const k = Math.min(1, (now - t0) / ms), e = ease(k);
        this.camera.position.lerpVectors(from, to, e);
        this.yaw = ys + dy * e; this.pitch = ps + (pitch1 - ps) * e;
        this._look();
        if (k < 1) this.anim = requestAnimationFrame(step); else { this._walking = false; resolve(); }
      };
      this.anim = requestAnimationFrame(step);
    }).finally(() => { void yaw0; void pitch0; });
  }

  _look() {
    const T = this.THREE, d = new T.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
    const target = this.camera.position.clone().add(d);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(target);
    if (this.controls?.target) this.controls.target.copy(this.camera.position.clone().add(d.multiplyScalar(this.t.eyeHeight * 0.5)));
  }

  _fly(pos, target, ms = 900) {
    const p0 = this.camera.position.clone(), t0v = (this.controls?.target || new this.THREE.Vector3()).clone(), t0 = performance.now();
    cancelAnimationFrame(this.anim);
    const step = (now) => {
      const k = Math.min(1, (now - t0) / ms), e = ease(k);
      this.camera.position.lerpVectors(p0, pos, e);
      if (this.controls?.target) { this.controls.target.lerpVectors(t0v, target, e); this.camera.lookAt(this.controls.target); this.controls.update?.(); }
      else this.camera.lookAt(target);
      if (k < 1) this.anim = requestAnimationFrame(step);
    };
    this.anim = requestAnimationFrame(step);
  }

  // ── input in walk mode ──
  _bind() {
    const el = this.dom; if (!el) return;
    let down = null, moved = 0;
    // presses anywhere over the 3D view count (overlays like hint bars sit on
    // top of the canvas), but not on buttons, inputs or panels
    const inView = (e) => {
      const r = el.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return false;
      return !e.target?.closest?.('button, input, select, textarea, a, label, .fumoca-tour-bar, .section, .panel-body, [role=dialog]');
    };
    this._onDown = (e) => {
      if (this.mode !== 'walk' || e.button !== 0 || !inView(e)) return;
      down = { x: e.clientX, y: e.clientY, yaw: this.yaw, pitch: this.pitch }; moved = 0;
      e.preventDefault(); e.stopPropagation();
    };
    this._onMove = (e) => {
      if (!down || this.mode !== 'walk') return;
      const dx = e.clientX - down.x, dy = e.clientY - down.y; moved = Math.max(moved, Math.hypot(dx, dy));
      // drag to look around (like turning your head)
      this.yaw = down.yaw + dx * 0.005; this.pitch = clampPitch(down.pitch + dy * 0.005);
      this._look();
    };
    this._onUp = (e) => {
      if (!down) return;
      const wasClick = moved < 5; down = null;
      if (wasClick && this.mode === 'walk') this.clickAt(e.clientX, e.clientY);
    };
    this._onClickOther = (e) => { if (this.mode && this.mode !== 'walk' && e.button === 0) this._maybeDot(e); };
    this._onWheel = (e) => {
      if (this.mode !== 'walk') return;
      e.preventDefault();
      this.step(-Math.sign(e.deltaY) * this.t.eyeHeight * 0.35);
    };
    this._onKey = (e) => {
      if (this.mode !== 'walk' || /input|textarea|select/i.test(e.target?.tagName || '')) return;
      const s = this.t.eyeHeight * 0.25;
      if (['w', 'ArrowUp'].includes(e.key)) this.step(s);
      else if (['s', 'ArrowDown'].includes(e.key)) this.step(-s);
      else if (['a', 'ArrowLeft'].includes(e.key)) { this.yaw += 0.12; this._look(); }
      else if (['d', 'ArrowRight'].includes(e.key)) { this.yaw -= 0.12; this._look(); }
      else return;
      e.preventDefault();
    };
    globalThis.addEventListener('pointerdown', this._onDown, true);
    el.addEventListener('pointerup', this._onClickOther);
    globalThis.addEventListener('pointermove', this._onMove);
    globalThis.addEventListener('pointerup', this._onUp);
    el.addEventListener('wheel', this._onWheel, { passive: false });
    globalThis.addEventListener('keydown', this._onKey);
  }

  /** Step forward / back on the floor, staying inside the building. */
  step(d) {
    const b = this.bounds || this._bounds(), p = this.camera.position;
    const nx = p.x + Math.sin(this.yaw) * d, nz = p.z + Math.cos(this.yaw) * d;
    p.set(Math.min(b.max[0], Math.max(b.min[0], nx)), this.t.floorY + this.t.eyeHeight, Math.min(b.max[2], Math.max(b.min[2], nz)));
    this._look();
  }

  _maybeDot(e) {
    const hit = this._dotAt(e.clientX, e.clientY);
    if (hit) { this.mode = 'walk'; this._holdControls(true); this.setCutaway(false); this.stopIndex = this.t.stops.indexOf(hit); this.walkTo(hit.position, { yaw: hit.yaw, pitch: hit.pitch }); this._syncUi(); }
  }

  _dotAt(x, y) {
    const r = this.dom.getBoundingClientRect(), T = this.THREE;
    let best = null, bd = 28;
    for (const s of this.t.stops) {
      const p = new T.Vector3(s.position[0], this.t.floorY, s.position[2]).project(this.camera);
      if (p.z > 1) continue;
      const d = Math.hypot((p.x * 0.5 + 0.5) * r.width + r.left - x, (-p.y * 0.5 + 0.5) * r.height + r.top - y);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  /** Click in walk mode: a tour dot, the floor (walk there) or a wall (walk up to it). */
  clickAt(x, y) {
    const dot = this._dotAt(x, y);
    if (dot) { this.stopIndex = this.t.stops.indexOf(dot); this.walkTo(dot.position, { yaw: dot.yaw, pitch: dot.pitch }); this._syncUi(); return 'dot'; }
    const r = this.dom.getBoundingClientRect();
    this.camera.updateMatrixWorld(); this.camera.matrixWorldInverse.copy(this.camera.matrixWorld).invert();
    const hit = pickSplat(this.positions, this.count, this.accept || (() => true), this.camera, x - r.left, y - r.top, r.width, r.height, 10);
    if (!hit) return null;
    const p = hit.point, from = [this.camera.position.x, this.camera.position.y, this.camera.position.z];
    const b = this.bounds || this._bounds();
    const stand = isFloorPoint(p, this.t) ? [p[0], this.t.floorY, p[2]] : standingSpotFor(p, from, this.t);
    stand[0] = Math.min(b.max[0], Math.max(b.min[0], stand[0])); stand[2] = Math.min(b.max[2], Math.max(b.min[2], stand[2]));
    this.walkTo(stand);
    return isFloorPoint(p, this.t) ? 'floor' : 'wall';
  }

  dispose() {
    cancelAnimationFrame(this.anim);
    this.setCutaway(false);
    globalThis.removeEventListener?.('fumoca:lightingApplied', this._onLit);
    const el = this.dom;
    globalThis.removeEventListener('pointerdown', this._onDown, true); el?.removeEventListener('pointerup', this._onClickOther); el?.removeEventListener('wheel', this._onWheel);
    globalThis.removeEventListener('pointermove', this._onMove); globalThis.removeEventListener('pointerup', this._onUp); globalThis.removeEventListener('keydown', this._onKey);
    this.markers?.parent?.remove(this.markers);
    this.markers?.traverse?.(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
    this.bar?.remove();
    this._holdControls(false);
    const c = this.controls;
    if (c) { c.enabled = this.saved.enabled ?? true; if ('minPolarAngle' in c) { c.minPolarAngle = this.saved.minPolar ?? 0; c.maxPolarAngle = this.saved.maxPolar ?? Math.PI; } c.enablePan = this.saved.enablePan ?? true; c.enableRotate = this.saved.enableRotate ?? true; }
  }
}
