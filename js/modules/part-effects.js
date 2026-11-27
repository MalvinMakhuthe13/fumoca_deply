/**
 * The experience around moving parts — sounds and effects, no audio files,
 * no AI: everything is synthesised in the browser.
 *
 *  Sounds:  click (clasps, latches, buttons) · zip (zip pull, timed to the
 *           motion) · spray (perfume / aerosol hiss) · thunk (doors closing)
 *           · whoosh (big lids and doors)
 *  Effects: mist — a fine spray of soft droplets that leaves the nozzle,
 *           spreads, drifts and fades (perfume, aerosols, humidifiers).
 *
 * Listens to 'fumoca:partMove' (Studio and the published viewer alike).
 */

let ctx = null, muted = false;
function audio() {
  if (muted) return null;
  try {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  } catch (_) { return null; }
}
function noise(a, seconds) {
  const n = Math.max(1, Math.floor(a.sampleRate * seconds)), buf = a.createBuffer(1, n, a.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  const src = a.createBufferSource(); src.buffer = buf; return src;
}
function chain(a, ...nodes) { for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]); nodes[nodes.length - 1].connect(a.destination); }

export const sounds = {
  click(at = 0, gain = 0.5) {
    const a = audio(); if (!a) return;
    for (const [dt, f, g] of [[0, 3200, gain], [0.055, 2400, gain * 0.7]]) {
      const t = a.currentTime + at + dt, src = noise(a, 0.03), bp = a.createBiquadFilter(), v = a.createGain();
      bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 4;
      v.gain.setValueAtTime(g, t); v.gain.exponentialRampToValueAtTime(0.001, t + 0.025);
      chain(a, src, bp, v); src.start(t); src.stop(t + 0.04);
    }
  },
  zip(seconds = 1.2, gain = 0.35) {
    const a = audio(); if (!a) return;
    const t = a.currentTime, dur = Math.max(0.2, seconds), src = noise(a, dur + 0.1), bp = a.createBiquadFilter(), v = a.createGain(), teeth = a.createGain(), lfo = a.createOscillator(), depth = a.createGain();
    bp.type = 'bandpass'; bp.frequency.setValueAtTime(2200, t); bp.frequency.linearRampToValueAtTime(3000, t + dur); bp.Q.value = 2.5;
    // the teeth: a fast tremolo, faster as the pull speeds up
    lfo.type = 'square'; lfo.frequency.setValueAtTime(28, t); lfo.frequency.linearRampToValueAtTime(46, t + dur * 0.6); lfo.frequency.linearRampToValueAtTime(30, t + dur);
    depth.gain.value = 0.5; teeth.gain.value = 0.5; lfo.connect(depth); depth.connect(teeth.gain);
    v.gain.setValueAtTime(0.0001, t); v.gain.exponentialRampToValueAtTime(gain, t + 0.06); v.gain.setValueAtTime(gain, t + dur - 0.08); v.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    chain(a, src, bp, teeth, v); src.start(t); lfo.start(t); src.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
  },
  spray(seconds = 0.9, gain = 0.4) {
    const a = audio(); if (!a) return;
    const t = a.currentTime, src = noise(a, seconds + 0.1), hp = a.createBiquadFilter(), lp = a.createBiquadFilter(), v = a.createGain();
    hp.type = 'highpass'; hp.frequency.value = 1800; lp.type = 'lowpass'; lp.frequency.setValueAtTime(9000, t); lp.frequency.exponentialRampToValueAtTime(4000, t + seconds);
    v.gain.setValueAtTime(0.0001, t); v.gain.exponentialRampToValueAtTime(gain, t + 0.02); v.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    chain(a, src, hp, lp, v); src.start(t); src.stop(t + seconds + 0.05);
  },
  thunk(at = 0, gain = 0.6) {
    const a = audio(); if (!a) return;
    const t = a.currentTime + at, o = a.createOscillator(), v = a.createGain(), src = noise(a, 0.08), lp = a.createBiquadFilter(), nv = a.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.18);
    v.gain.setValueAtTime(gain, t); v.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    lp.type = 'lowpass'; lp.frequency.value = 700; nv.gain.setValueAtTime(gain * 0.5, t); nv.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    chain(a, o, v); chain(a, src, lp, nv); o.start(t); o.stop(t + 0.25); src.start(t); src.stop(t + 0.1);
  },
  whoosh(seconds = 1, gain = 0.25) {
    const a = audio(); if (!a) return;
    const t = a.currentTime, src = noise(a, seconds + 0.1), bp = a.createBiquadFilter(), v = a.createGain();
    bp.type = 'bandpass'; bp.Q.value = 1.2; bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(1400, t + seconds * 0.5); bp.frequency.exponentialRampToValueAtTime(400, t + seconds);
    v.gain.setValueAtTime(0.0001, t); v.gain.exponentialRampToValueAtTime(gain, t + seconds * 0.4); v.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    chain(a, src, bp, v); src.start(t); src.stop(t + seconds + 0.05);
  },
};

// ── your own recordings ──────────────────────────────────────────────────────
const decoded = new Map();   // dataUrl → Promise<AudioBuffer>
function decode(a, dataUrl) {
  if (!decoded.has(dataUrl)) decoded.set(dataUrl, (async () => {
    const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1), bin = atob(b64), u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return a.decodeAudioData(u8.buffer);
  })());
  return decoded.get(dataUrl);
}
/** Play an uploaded recording. Returns a promise for when it has started. */
export async function playRecording(file, { volume = file?.volume ?? 0.9, at = 0 } = {}) {
  const a = audio(); if (!a || !file?.dataUrl) return false;
  try {
    const buf = await decode(a, file.dataUrl), src = a.createBufferSource(), g = a.createGain();
    src.buffer = buf; g.gain.value = volume; src.connect(g); g.connect(a.destination);
    src.start(a.currentTime + at);
    return true;
  } catch (e) { console.warn('[sound] could not play', file.name, e); return false; }
}

/** Play a part's sound for a move that has just started. */
export function playPartSound(part, to, duration) {
  // your own recording wins over the built-in sounds
  const f = part?.soundFile;
  if (f) {
    if (f.on === 'both' || (f.on === 'open' && to === 'open') || (f.on === 'close' && to !== 'open')) playRecording(f);
    return;
  }
  const s = part?.sound; if (!s || s === 'none') return;
  if (s === 'click') sounds.click(to === 'open' ? 0 : Math.max(0, duration - 0.05));
  else if (s === 'zip') sounds.zip(duration);
  else if (s === 'spray') { if (to === 'open') sounds.spray(0.9); }
  else if (s === 'thunk') { if (to === 'closed') sounds.thunk(Math.max(0, duration - 0.03)); }
  else if (s === 'whoosh') sounds.whoosh(Math.max(0.4, duration));
}

// ── mist ─────────────────────────────────────────────────────────────────────
let dotTex = null;
function dot(THREE) {
  if (dotTex) return dotTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.35, 'rgba(255,255,255,.55)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  dotTex = new THREE.CanvasTexture(c);
  return dotTex;
}

/**
 * A puff of mist from a nozzle. origin/dir are in the mesh's own (splat)
 * coordinates; reach is how far it carries. Returns a promise for when it's gone.
 */
export function sprayMist(THREE, mesh, effect, { seconds = 0.45 } = {}) {
  if (!THREE || !mesh || !effect) return Promise.resolve();
  let scene = mesh; while (scene.parent) scene = scene.parent;
  mesh.updateMatrixWorld?.(true);
  const origin = mesh.localToWorld(new THREE.Vector3(...effect.origin));
  const dir = new THREE.Vector3(...effect.dir).transformDirection(mesh.matrixWorld).normalize();
  const reach = effect.reach * (mesh.matrixWorld.getMaxScaleOnAxis?.() || 1);
  const N = Math.round(300 + 900 * effect.amount), life = 1.6;
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 4), vel = new Float32Array(N * 3), born = new Float32Array(N), size0 = reach * 0.05;
  const base = new THREE.Color(effect.color);
  // a cone around the spray direction
  const up = Math.abs(dir.y) < 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(dir, up).normalize(), w = new THREE.Vector3().crossVectors(dir, u).normalize();
  const spread = Math.tan(effect.spread * Math.PI / 180);
  for (let i = 0; i < N; i++) {
    born[i] = Math.random() * seconds;
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * spread, speed = reach * (1.6 + Math.random() * 1.4);
    const v = dir.clone().addScaledVector(u, Math.cos(a) * r).addScaledVector(w, Math.sin(a) * r).normalize().multiplyScalar(speed);
    vel[i * 3] = v.x; vel[i * 3 + 1] = v.y; vel[i * 3 + 2] = v.z;
    pos[i * 3] = origin.x; pos[i * 3 + 1] = origin.y; pos[i * 3 + 2] = origin.z;
    const tint = 0.9 + Math.random() * 0.1;
    col[i * 4] = base.r * tint; col[i * 4 + 1] = base.g * tint; col[i * 4 + 2] = base.b * tint; col[i * 4 + 3] = 0;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
  const mat = new THREE.PointsMaterial({ size: size0, map: dot(THREE), vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true, opacity: 0.85 });
  const pts = new THREE.Points(geo, mat);
  pts.name = 'fumoca-mist'; pts.frustumCulled = false; pts.renderOrder = 999;
  scene.add(pts);
  const t0 = performance.now();
  let last = t0;
  return new Promise((resolve) => {
    const step = (now) => {
      const t = (now - t0) / 1000, dt = Math.min(0.05, (now - last) / 1000); last = now;
      let alive = 0;
      for (let i = 0; i < N; i++) {
        const age = t - born[i];
        if (age < 0) continue;
        if (age > life) { col[i * 4 + 3] = 0; continue; }
        alive++;
        const drag = Math.exp(-3.2 * dt);   // droplets slow quickly in air
        vel[i * 3] *= drag; vel[i * 3 + 1] = vel[i * 3 + 1] * drag + reach * 0.05 * dt; vel[i * 3 + 2] *= drag;   // and drift up a touch
        vel[i * 3] += (Math.random() - 0.5) * reach * 0.6 * dt; vel[i * 3 + 2] += (Math.random() - 0.5) * reach * 0.6 * dt;   // eddies
        pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
        const k = age / life;
        col[i * 4 + 3] = (k < 0.1 ? k / 0.1 : 1 - (k - 0.1) / 0.9) ** 1.4 * 0.75;
      }
      mat.size = size0 * (1 + Math.min(1, t / life) * 2.2);   // the cloud billows out
      geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true;
      window.dispatchEvent(new CustomEvent('fumoca:effectFrame'));
      if (alive || t < seconds) requestAnimationFrame(step);
      else { scene.remove(pts); geo.dispose(); mat.dispose(); resolve(); }
    };
    requestAnimationFrame(step);
  });
}

// ── wiring ───────────────────────────────────────────────────────────────────
if (typeof window !== 'undefined' && !window.__fumocaPartEffects) {
  window.__fumocaPartEffects = true;
  window.addEventListener('fumoca:partMove', (e) => {
    const d = e.detail || {}, part = d.part;
    if (!part) return;
    try { playPartSound(part, d.to, d.duration || part.motion?.duration || 1); } catch (_) {}
    if (d.to === 'open' && part.effect?.type === 'mist' && d.THREE && d.mesh) sprayMist(d.THREE, d.mesh, part.effect).catch?.(() => {});
  });
  window.FumocaPartEffects = { sounds, sprayMist, playRecording, mute(v = true) { muted = !!v; } };
}
