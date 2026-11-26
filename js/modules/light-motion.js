/**
 * Light animation for splat scenes: the light moves, warms, dims and changes
 * colour over time — an orbiting sun, a sunrise, a product sweep, a pulse —
 * or your own keyframes. Plays in Studio and the public viewer.
 *
 * A key holds the light values to reach at time t (0…1 of the loop); values
 * between keys ease smoothly. Azimuth is not wrapped, so a key going from 0°
 * to 360° makes a full orbit.
 */

const NUM_KEYS = ['azimuth', 'elevation', 'intensity', 'ambient', 'azimuth2', 'elevation2', 'intensity2', 'exposure', 'contrast', 'saturation', 'warmth', 'tint', 'vignette'];
const COLOUR_KEYS = ['color', 'ambientColor', 'color2'];
const LIMITS = {
  azimuth: [-720, 720], elevation: [2, 90], intensity: [0, 3], ambient: [0, 2],
  azimuth2: [-720, 720], elevation2: [-30, 90], intensity2: [0, 3],
  exposure: [-2, 2], contrast: [-1, 1], saturation: [-1, 1], warmth: [-1, 1], tint: [-1, 1], vignette: [0, 1],
};
const isHex = (v) => /^#[0-9a-f]{6}$/i.test(v || '');

export function normalizeLightKey(k) {
  if (!k || typeof k !== 'object') return null;
  const out = { t: Math.min(1, Math.max(0, Number.isFinite(+k.t) ? +k.t : 0)) };
  for (const key of NUM_KEYS) if (Number.isFinite(+k[key]) && k[key] !== null && k[key] !== '') { const [lo, hi] = LIMITS[key]; out[key] = Math.min(hi, Math.max(lo, +k[key])); }
  for (const key of COLOUR_KEYS) if (isHex(k[key])) out[key] = k[key].toLowerCase();
  return out;
}

export function normalizeLightMotion(m) {
  if (!m || typeof m !== 'object') return null;
  const keys = (Array.isArray(m.keys) ? m.keys : []).slice(0, 24).map(normalizeLightKey).filter(Boolean).sort((a, b) => a.t - b.t);
  return {
    enabled: !!m.enabled && keys.length >= 2,
    preset: String(m.preset || 'custom').replace(/[^\w-]/g, '').slice(0, 24) || 'custom',
    duration: Math.min(120, Math.max(1, Number.isFinite(+m.duration) ? +m.duration : 8)),
    loop: ['loop', 'pingpong', 'once'].includes(m.loop) ? m.loop : 'loop',
    autoplay: m.autoplay !== false,
    keys,
  };
}

/** Ready-made light animations, relative to the current light. */
export const LIGHT_MOTIONS = {
  orbit: { label: 'Orbit', duration: 10, loop: 'loop', keys: (b) => [{ t: 0, azimuth: b.azimuth }, { t: 1, azimuth: b.azimuth + 360 }] },
  sweep: { label: 'Product sweep', duration: 5, loop: 'pingpong', keys: (b) => [{ t: 0, azimuth: b.azimuth - 75, elevation: 18 }, { t: 1, azimuth: b.azimuth + 75, elevation: 18 }] },
  sunrise: { label: 'Sunrise → sunset', duration: 14, loop: 'loop', keys: (b) => [
    { t: 0, azimuth: b.azimuth - 90, elevation: 3, intensity: 0.5, color: '#ff8a3d', ambient: 0.25, ambientColor: '#5a6a9a', warmth: 0.4 },
    { t: 0.5, azimuth: b.azimuth, elevation: 70, intensity: 1.0, color: '#fff6e8', ambient: 0.6, ambientColor: '#ffffff', warmth: 0 },
    { t: 1, azimuth: b.azimuth + 90, elevation: 3, intensity: 0.5, color: '#ff6a2a', ambient: 0.25, ambientColor: '#4a5a8a', warmth: 0.4 }] },
  pulse: { label: 'Pulse', duration: 3, loop: 'pingpong', keys: (b) => [{ t: 0, intensity: Math.max(0.2, b.intensity * 0.4) }, { t: 1, intensity: Math.min(3, b.intensity * 1.5 + 0.2) }] },
  neon: { label: 'Neon shift', duration: 6, loop: 'loop', keys: (b) => [
    { t: 0, color: '#ff2bd6', color2: '#22e6ff', azimuth: b.azimuth }, { t: 0.5, color: '#22e6ff', color2: '#ff2bd6', azimuth: b.azimuth + 180 }, { t: 1, color: '#ff2bd6', color2: '#22e6ff', azimuth: b.azimuth + 360 }],
    base: { light2: true, intensity2: 0.8 } },
  reveal: { label: 'Dark reveal', duration: 4, loop: 'once', keys: (b) => [{ t: 0, intensity: 0, ambient: 0.05, exposure: -1 }, { t: 1, intensity: b.intensity, ambient: b.ambient, exposure: b.exposure || 0 }] },
};

export function motionFromPreset(name, base) {
  const p = LIGHT_MOTIONS[name];
  if (!p) return null;
  return normalizeLightMotion({ enabled: true, preset: name, duration: p.duration, loop: p.loop, autoplay: true, keys: p.keys(base) });
}

const ease = (x) => x * x * (3 - 2 * x);
const rgb = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const hex = (c) => '#' + c.map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');

/** Loop phase 0…1 for a time in seconds. */
export function phaseAt(motion, seconds) {
  const d = motion.duration, x = Math.max(0, seconds) / d;
  if (motion.loop === 'once') return Math.min(1, x);
  if (motion.loop === 'pingpong') { const f = x % 2; return f <= 1 ? f : 2 - f; }
  return x % 1;
}

/** Light settings at phase p: base values overridden by the eased keys. */
export function sampleMotion(motion, base, p) {
  const out = { ...base, enabled: true };
  const keys = motion.keys;
  for (const key of [...NUM_KEYS, ...COLOUR_KEYS]) {
    const ks = keys.filter(k => k[key] !== undefined);
    if (!ks.length) continue;
    let a = ks[0], b = ks[ks.length - 1];
    if (p <= a.t) { out[key] = a[key]; continue; }
    if (p >= b.t) { out[key] = b[key]; continue; }
    for (let i = 0; i < ks.length - 1; i++) if (p >= ks[i].t && p <= ks[i + 1].t) { a = ks[i]; b = ks[i + 1]; break; }
    const f = ease((p - a.t) / Math.max(1e-6, b.t - a.t));
    out[key] = COLOUR_KEYS.includes(key) ? hex(rgb(a[key]).map((v, i) => v + (rgb(b[key])[i] - v) * f)) : a[key] + (b[key] - a[key]) * f;
  }
  return out;
}

/** Plays a light animation on a SplatLighting, as fast as the scan allows. */
export class LightAnimator {
  constructor(lighting, getBase, motion) {
    this.lighting = lighting; this.getBase = getBase; this.motion = normalizeLightMotion(motion);
    this.raf = 0; this.playing = false; this.t0 = 0; this.frame = 0; this.offset = 0;
  }
  setMotion(m) { this.motion = normalizeLightMotion(m); }
  play(fromSeconds = 0) {
    if (!this.motion || this.motion.keys.length < 2) return false;
    this.stop(false);
    this.playing = true; this.offset = fromSeconds; this.t0 = performance.now(); this.frame = 0;
    const tick = (now) => {
      if (!this.playing) return;
      const sec = this.offset + (now - this.t0) / 1000;
      const p = phaseAt(this.motion, sec);
      const s = sampleMotion(this.motion, this.getBase(), p);
      const started = performance.now();
      // colours every frame; the shadow (heavier) every few frames
      try { this.lighting.apply(s, { fast: true, shadow: this.frame % 4 === 0 }); } catch (e) { this.stop(false); return; }
      this.frame++;
      this.lastMs = performance.now() - started;
      globalThis.dispatchEvent?.(new CustomEvent('fumoca:lightMotionFrame', { detail: { phase: p, settings: s } }));
      if (this.motion.loop === 'once' && p >= 1) { this.stop(false); this.lighting.apply(s); return; }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
    return true;
  }
  stop(restore = true) {
    this.playing = false; cancelAnimationFrame(this.raf);
    if (restore) { try { this.lighting.apply(this.getBase()); } catch (_) {} }
  }
}

/**
 * Turn a point the user dragged to (around the subject) into a light
 * direction: azimuth / elevation in degrees, like the Look sliders.
 */
export function directionToAngles(dx, dy, dz) {
  const l = Math.hypot(dx, dy, dz) || 1;
  const elevation = Math.asin(Math.max(-1, Math.min(1, dy / l))) * 180 / Math.PI;
  const azimuth = Math.atan2(dx, dz) * 180 / Math.PI;
  return { azimuth, elevation };
}

/** Where a camera ray (origin o, unit dir d) meets a sphere (centre c, radius r); the near hit, or the closest point. */
export function raySphere(o, d, c, r) {
  const oc = [o[0] - c[0], o[1] - c[1], o[2] - c[2]];
  const b = oc[0] * d[0] + oc[1] * d[1] + oc[2] * d[2];
  const cc = oc[0] * oc[0] + oc[1] * oc[1] + oc[2] * oc[2] - r * r;
  const disc = b * b - cc;
  const t = disc >= 0 ? -b - Math.sqrt(disc) : -b;
  const p = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
  if (disc >= 0) return p;
  // missed: push the closest point out to the sphere
  const v = [p[0] - c[0], p[1] - c[1], p[2] - c[2]], l = Math.hypot(...v) || 1;
  return [c[0] + v[0] / l * r, c[1] + v[1] / l * r, c[2] + v[2] / l * r];
}
