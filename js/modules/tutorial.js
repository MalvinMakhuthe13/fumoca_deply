/**
 * Product tutorials on a scan — "how to use it", step by step.
 *
 *   screens  flat areas of the scan (a phone or laptop screen, a car's
 *            infotainment, a TV) fitted from a selection; each step can put
 *            an image, GIF or screen-recording video on them
 *   steps    title + short text, a camera view, an optional highlight ring on
 *            a point (the power button, a port), an optional action (open a
 *            part, switch a lamp, change the mood) and an optional voice-over
 *
 * The player flies the camera between steps, rings the highlight, plays the
 * screen media and the narration, and waits for it before moving on.
 */
import { safeMediaUrl } from './safe-url.js';

const finite3 = (v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
const num = (v, lo, hi, d) => (Number.isFinite(+v) && v !== '' && v !== null ? Math.min(hi, Math.max(lo, +v)) : d);
const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');

// ─── screens ─────────────────────────────────────────────────────────────────
/**
 * Fit a rectangle to selected splat centres (PCA): centre, half-extent
 * vectors u (long side) and v (short side), and the normal.
 */
export function fitScreenQuad(positions, indices) {
  const n = indices.length;
  if (n < 12) throw new Error('Select the screen first (a few hundred splats on it).');
  let c = [0, 0, 0];
  for (const i of indices) for (let k = 0; k < 3; k++) c[k] += positions[i * 3 + k];
  c = c.map(v => v / n);
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const i of indices) {
    const d = [0, 1, 2].map(k => positions[i * 3 + k] - c[k]);
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) C[a][b] += d[a] * d[b];
  }
  // power iteration for the two largest eigenvectors
  const mul = (M, v) => [0, 1, 2].map(r => M[r][0] * v[0] + M[r][1] * v[1] + M[r][2] * v[2]);
  const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map(x => x / l); };
  let e1 = norm([1, 0.3, 0.2]);
  for (let k = 0; k < 60; k++) e1 = norm(mul(C, e1));
  const l1 = Math.hypot(...mul(C, e1));
  const C2 = C.map((row, r) => row.map((x, s) => x - l1 * e1[r] * e1[s]));
  let e2 = norm([0.2, 1, 0.3]);
  for (let k = 0; k < 60; k++) { e2 = mul(C2, e2); const d = e2[0] * e1[0] + e2[1] * e1[1] + e2[2] * e1[2]; e2 = norm(e2.map((x, i) => x - d * e1[i])); }
  const normal = norm([e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]);
  // extents along each axis (robust 2–98 %)
  const proj = (e) => { const p = indices.map(i => (positions[i * 3] - c[0]) * e[0] + (positions[i * 3 + 1] - c[1]) * e[1] + (positions[i * 3 + 2] - c[2]) * e[2]).sort((a, b) => a - b); return [p[Math.floor(n * 0.02)], p[Math.floor(n * 0.98)]]; };
  const [a0, a1] = proj(e1), [b0, b1] = proj(e2);
  const mid = c.map((v, k) => v + e1[k] * (a0 + a1) / 2 + e2[k] * (b0 + b1) / 2);
  return { center: mid, u: e1.map(x => x * (a1 - a0) / 2), v: e2.map(x => x * (b1 - b0) / 2), normal };
}

export function normalizeScreen(s, i = 0) {
  if (!s || !finite3(s.center) || !finite3(s.u) || !finite3(s.v)) return null;
  return {
    id: String(s.id || 'screen' + i).replace(/[^\w-]/g, '').slice(0, 32) || 'screen' + i,
    name: str(s.name, 40) || 'Screen ' + (i + 1),
    center: s.center.map(Number), u: s.u.map(Number), v: s.v.map(Number),
    flip: !!s.flip, offset: num(s.offset, -0.2, 0.2, 0.002),
  };
}

// ─── tutorial data ───────────────────────────────────────────────────────────
export function normalizeStep(s, i = 0) {
  if (!s || typeof s !== 'object') return null;
  const view = s.view && finite3(s.view.position) && finite3(s.view.target) ? { position: s.view.position.map(Number), target: s.view.target.map(Number) } : null;
  const action = s.action && typeof s.action === 'object' && ['part', 'lighting'].includes(s.action.type)
    ? { type: s.action.type, partId: str(s.action.partId, 40) || undefined, lampId: str(s.action.lampId, 32) || undefined, mood: str(s.action.mood, 24) || undefined, to: ['open', 'close', 'toggle', 'on', 'off'].includes(s.action.to) ? s.action.to : undefined }
    : null;
  return {
    id: String(s.id || 'step' + i).replace(/[^\w-]/g, '').slice(0, 32) || 'step' + i,
    title: str(s.title, 80) || `Step ${i + 1}`,
    text: str(s.text, 600),
    view,
    highlight: finite3(s.highlight) ? s.highlight.map(Number) : null,
    screenId: str(s.screenId, 32),
    media: safeMediaUrl(s.media) ? s.media : '',
    action,
    narration: safeMediaUrl(s.narration) ? s.narration : '',
    seconds: num(s.seconds, 1, 120, 6),
  };
}

export function normalizeTutorial(t) {
  if (!t || typeof t !== 'object') return null;
  const screens = (Array.isArray(t.screens) ? t.screens : []).slice(0, 8).map(normalizeScreen).filter(Boolean);
  const steps = (Array.isArray(t.steps) ? t.steps : []).slice(0, 60).map(normalizeStep).filter(Boolean);
  if (!steps.length && !screens.length) return null;
  return { version: 1, title: str(t.title, 80) || 'How it works', screens, steps, autoplay: !!t.autoplay };
}

// ─── screens in the 3D scene ────────────────────────────────────────────────
export class ScreenOverlays {
  constructor(THREE, parent) {
    this.THREE = THREE; this.parent = parent; this.meshes = new Map(); this.videos = new Map();
  }

  setScreens(screens) {
    for (const id of [...this.meshes.keys()]) if (!screens.some(s => s.id === id)) this._remove(id);
    for (const s of screens) {
      let m = this.meshes.get(s.id);
      if (!m) {
        const T = this.THREE;
        m = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: T.DoubleSide, toneMapped: false, depthWrite: false }));
        m.name = 'fumoca-tutorial-screen'; m.renderOrder = 30; m.visible = false;
        this.parent.add(m); this.meshes.set(s.id, m);
      }
      this._place(m, s);
    }
  }

  _place(m, s) {
    const T = this.THREE;
    const u = new T.Vector3(...s.u), v = new T.Vector3(...s.v);
    let nrm = new T.Vector3().crossVectors(u, v).normalize();
    if (s.flip) nrm.negate();
    const x = u.clone().normalize(), y = s.flip ? v.clone().normalize().negate() : v.clone().normalize();
    const z = new T.Vector3().crossVectors(x, y).normalize();
    m.quaternion.setFromRotationMatrix(new T.Matrix4().makeBasis(x, y, z));
    m.scale.set(u.length() * 2, v.length() * 2, 1);
    m.position.set(...s.center).addScaledVector(nrm, s.offset);
    m.userData.screen = s;
  }

  /** Show an image / GIF / video on a screen ('' hides it, showing the scan again). */
  async show(screenId, url) {
    const m = this.meshes.get(screenId);
    if (!m) return false;
    const safe = url ? safeMediaUrl(url) : '';
    this.videos.get(screenId)?.pause?.();
    if (!safe) { m.visible = false; return true; }
    const T = this.THREE;
    let tex;
    if (/\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(safe)) {
      const vid = document.createElement('video');
      Object.assign(vid, { src: safe, crossOrigin: 'anonymous', muted: true, loop: true, playsInline: true });
      await vid.play().catch(() => {});
      this.videos.set(screenId, vid);
      tex = new T.VideoTexture(vid);
    } else {
      tex = await new T.TextureLoader().setCrossOrigin('anonymous').loadAsync(safe);
    }
    tex.colorSpace = T.SRGBColorSpace ?? tex.colorSpace;
    m.material.map?.dispose?.();
    m.material.map = tex; m.material.opacity = 1; m.material.needsUpdate = true;
    m.visible = true;
    return true;
  }

  hideAll() { for (const id of this.meshes.keys()) this.show(id, ''); }
  _remove(id) { const m = this.meshes.get(id); m?.parent?.remove(m); m?.geometry.dispose(); m?.material.map?.dispose?.(); m?.material.dispose(); this.meshes.delete(id); this.videos.get(id)?.pause?.(); this.videos.delete(id); }
  dispose() { for (const id of [...this.meshes.keys()]) this._remove(id); }
}

// ─── player ──────────────────────────────────────────────────────────────────
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class TutorialPlayer {
  /**
   * opts: { THREE, camera, controls, host (element over the 3D view), parent (Object3D for screens),
   *         runAction (action → Promise), project (vec3 → {x,y,visible} in host px) }
   */
  constructor(tutorial, opts) {
    this.t = normalizeTutorial(tutorial);
    if (!this.t?.steps.length) throw new Error('This tutorial has no steps yet.');
    Object.assign(this, opts);
    this.index = -1; this.playing = false; this.timer = 0; this.audio = null; this.raf = 0;
    this.screens = opts.parent ? new ScreenOverlays(opts.THREE, opts.parent) : null;
    this.screens?.setScreens(this.t.screens);
    this._ui();
  }

  _ui() {
    const h = this.host;
    if (getComputedStyle(h).position === 'static') h.style.position = 'relative';
    this.root = document.createElement('div');
    this.root.className = 'fumoca-tutorial';
    this.root.innerHTML = `
      <div class="ft-ring" style="position:absolute;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:2px solid #c8ff00;box-shadow:0 0 0 6px rgba(200,255,0,.18);pointer-events:none;display:none;animation:ftPulse 1.4s ease-out infinite;z-index:41"></div>
      <div class="ft-card" role="dialog" aria-live="polite" style="position:absolute;left:50%;bottom:18px;transform:translateX(-50%);width:min(520px,calc(100% - 24px));z-index:42;
        background:rgba(10,12,16,.9);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.12);border-radius:16px;color:#fff;font:500 14px/1.5 system-ui,sans-serif;padding:14px 16px;display:none">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><span class="ft-count" style="font-size:11px;color:#c8ff00;font-weight:700"></span><span class="ft-title" style="font-weight:800"></span>
          <button class="ft-close" aria-label="Close tutorial" style="margin-left:auto;background:none;border:0;color:#fff;opacity:.6;font-size:18px;cursor:pointer">×</button></div>
        <div class="ft-text" style="opacity:.85"></div>
        <div style="display:flex;align-items:center;gap:8px;margin-top:10px">
          <button class="ft-prev" style="background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);color:#fff;border-radius:10px;padding:7px 12px;cursor:pointer">‹ Back</button>
          <div class="ft-dots" style="flex:1;display:flex;gap:4px;justify-content:center"></div>
          <button class="ft-play" style="background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);color:#fff;border-radius:10px;padding:7px 12px;cursor:pointer">❚❚</button>
          <button class="ft-next" style="background:#c8ff00;border:0;color:#000;font-weight:800;border-radius:10px;padding:7px 14px;cursor:pointer">Next ›</button>
        </div>
      </div>
      <style>@keyframes ftPulse{0%{transform:scale(.7);opacity:1}100%{transform:scale(1.6);opacity:0}}</style>`;
    h.appendChild(this.root);
    this.ring = this.root.querySelector('.ft-ring');
    this.card = this.root.querySelector('.ft-card');
    this.root.querySelector('.ft-next').addEventListener('click', () => this.next());
    this.root.querySelector('.ft-prev').addEventListener('click', () => this.go(this.index - 1));
    this.root.querySelector('.ft-close').addEventListener('click', () => this.stop());
    this.root.querySelector('.ft-play').addEventListener('click', () => (this.playing ? this.pause() : this.play()));
  }

  start(autoplay = true) {
    this.card.style.display = 'block';
    globalThis._fumocaViewController && (globalThis._fumocaViewController.idleUntil = Infinity);   // stop any spin
    this.playing = autoplay;
    this.go(0);
    this._track();
  }

  play() { this.playing = true; this._schedule(); this._syncButtons(); }
  pause() { this.playing = false; clearTimeout(this.timer); this.audio?.pause(); this._syncButtons(); }
  next() { if (this.index >= this.t.steps.length - 1) { this.stop(); globalThis.dispatchEvent?.(new CustomEvent('fumoca:tutorialComplete')); } else this.go(this.index + 1); }

  async go(i) {
    if (i < 0 || i >= this.t.steps.length) return;
    clearTimeout(this.timer); this.audio?.pause();
    this.index = i;
    const s = this.t.steps[i];
    this.root.querySelector('.ft-count').textContent = `${i + 1} / ${this.t.steps.length}`;
    this.root.querySelector('.ft-title').textContent = s.title;
    this.root.querySelector('.ft-text').innerHTML = esc(s.text).replace(/\n/g, '<br>');
    this.root.querySelector('.ft-dots').innerHTML = this.t.steps.map((_, k) => `<span style="width:6px;height:6px;border-radius:50%;background:${k === i ? '#c8ff00' : 'rgba(255,255,255,.25)'}"></span>`).join('');
    this.root.querySelector('.ft-prev').disabled = i === 0;
    this.root.querySelector('.ft-next').textContent = i === this.t.steps.length - 1 ? 'Finish ✓' : 'Next ›';
    this._syncButtons();
    // screens: this step's media (others back to the scan)
    if (this.screens) for (const sc of this.t.screens) this.screens.show(sc.id, sc.id === s.screenId ? s.media : '');
    if (s.view) await this._fly(s.view);
    if (s.action && this.runAction) { try { await this.runAction(s.action); } catch (_) {} }
    if (s.narration) {
      try { this.audio = new Audio(safeMediaUrl(s.narration)); this.audio.onended = () => { if (this.playing && this.index === i) this.timer = setTimeout(() => this.next(), 700); }; await this.audio.play(); }
      catch (_) { this.audio = null; }
    }
    this._schedule();
    globalThis.dispatchEvent?.(new CustomEvent('fumoca:tutorialStep', { detail: { index: i, id: s.id } }));
  }

  _schedule() {
    clearTimeout(this.timer);
    if (!this.playing) return;
    const s = this.t.steps[this.index];
    if (s?.narration && this.audio && !this.audio.ended) return;    // narration's onended moves on
    this.timer = setTimeout(() => this.next(), (s?.seconds || 6) * 1000);
  }

  _syncButtons() { this.root.querySelector('.ft-play').textContent = this.playing ? '❚❚' : '▶'; }

  _fly(view, ms = 1100) {
    const { THREE, camera, controls } = this;
    if (!camera || !controls) return Promise.resolve();
    const p0 = camera.position.clone(), t0 = controls.target.clone();
    const p1 = new THREE.Vector3(...view.position), t1 = new THREE.Vector3(...view.target);
    const start = performance.now();
    return new Promise((resolve) => {
      const step = (now) => {
        const k = Math.min(1, (now - start) / ms), e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
        camera.position.lerpVectors(p0, p1, e); controls.target.lerpVectors(t0, t1, e);
        camera.lookAt(controls.target); controls.update?.();
        if (k < 1) requestAnimationFrame(step); else resolve();
      };
      requestAnimationFrame(step);
    });
  }

  _track() {
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      const s = this.t.steps[this.index];
      if (!s?.highlight || !this.project) { this.ring.style.display = 'none'; return; }
      const p = this.project(s.highlight);
      if (!p?.visible) { this.ring.style.display = 'none'; return; }
      this.ring.style.display = 'block'; this.ring.style.left = p.x + 'px'; this.ring.style.top = p.y + 'px';
    };
    loop();
  }

  stop() {
    clearTimeout(this.timer); cancelAnimationFrame(this.raf); this.audio?.pause();
    this.card.style.display = 'none'; this.ring.style.display = 'none'; this.playing = false;
    this.screens?.hideAll();
    globalThis._fumocaViewController && (globalThis._fumocaViewController.idleUntil = performance.now() + 1500);
    globalThis.dispatchEvent?.(new CustomEvent('fumoca:tutorialStopped'));
  }

  dispose() { this.stop(); this.screens?.dispose(); this.root.remove(); }
}

/** Project a 3D point to host pixel coordinates. */
export function makeProjector(THREE, camera, host) {
  const v = new THREE.Vector3();
  return (p) => {
    v.set(p[0], p[1], p[2]).project(camera);
    const r = host.getBoundingClientRect();
    return { x: (v.x * 0.5 + 0.5) * r.width, y: (-v.y * 0.5 + 0.5) * r.height, visible: v.z > -1 && v.z < 1 && Math.abs(v.x) <= 1.05 && Math.abs(v.y) <= 1.05 };
  };
}

/** Public viewer: a "How it works" button that opens the tutorial. */
export function mountTutorialOnViewer(THREE, tutorial, { camera, controls, host, parent, runAction, label } = {}) {
  const t = normalizeTutorial(tutorial);
  if (!t?.steps.length || !host || !camera) return null;
  const player = new TutorialPlayer(t, { THREE, camera, controls, host, parent, runAction, project: makeProjector(THREE, camera, host) });
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'fumoca-tutorial-launch';
  btn.textContent = '▶ ' + (label || t.title);
  Object.assign(btn.style, { position: 'absolute', left: '14px', bottom: '14px', zIndex: 40, background: '#c8ff00', color: '#000', border: '0', borderRadius: '999px', padding: '9px 16px', font: '800 13px system-ui,sans-serif', cursor: 'pointer', boxShadow: '0 8px 24px rgba(0,0,0,.35)' });
  btn.addEventListener('click', () => { btn.style.display = 'none'; player.start(true); });
  globalThis.addEventListener?.('fumoca:tutorialStopped', () => { btn.style.display = ''; });
  host.appendChild(btn);
  if (t.autoplay) setTimeout(() => btn.click(), 1200);
  return { player, button: btn };
}
