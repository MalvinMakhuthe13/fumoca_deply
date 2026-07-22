/**
 * FUMOCA Sound Engine V57
 * ─────────────────────────────────────────────────────────────────────────────
 * Provides:
 *  • Ambient audio layer (background track that plays when viewer opens)
 *  • Spatial / positional audio per hotspot (3D sound that fades with distance)
 *  • Sound attachment UI helpers for the editor
 *  • No autoplay without a user gesture (browser policy compliant)
 *
 * Usage (viewer/editor):
 *   import { SoundEngine } from './sound-engine.js';
 *   const se = new SoundEngine();
 *   se.setAmbient('https://…/ambient.mp3', { volume: 0.4, loop: true });
 *   se.addSpatialSource('hotspot-id-123', 'https://…/sound.mp3', { x:0, y:0, z:0 });
 *   se.updateListenerPosition(camera.position, camera.quaternion);
 *   se.startOnUserGesture(); // call once after first click/touch
 */

export class SoundEngine {
  constructor() {
    this._ctx = null;
    this._masterGain = null;
    this._ambient = null;             // { source, gainNode, buffer, options }
    this._spatials = new Map();       // hotspotId → { source, panner, gainNode, buffer, options, playing }
    this._ready = false;
    this._pendingStart = [];          // calls queued before AudioContext is unlocked
    this._muted = false;
    this._masterVolume = 1.0;
  }

  // ── Bootstrap ───────────────────────────────────────────────────────────────
  _ensureContext() {
    if (this._ctx) return;
    this._ctx = new (window.AudioContext || window.webkitAudioContext)();
    this._masterGain = this._ctx.createGain();
    this._masterGain.gain.value = this._masterVolume;
    this._masterGain.connect(this._ctx.destination);
  }

  /** Call once on the first user gesture (click, tap, keydown) */
  async startOnUserGesture() {
    this._ensureContext();
    if (this._ctx.state === 'suspended') {
      await this._ctx.resume().catch(() => {});
    }
    this._ready = true;
    for (const fn of this._pendingStart) { try { await fn(); } catch (_) {} }
    this._pendingStart = [];
  }

  async _whenReady(fn) {
    if (this._ready && this._ctx?.state === 'running') {
      await fn();
    } else {
      this._pendingStart.push(fn);
    }
  }

  // ── Buffer Loading ──────────────────────────────────────────────────────────
  async _loadBuffer(url) {
    this._ensureContext();
    const res = await fetch(url);
    if (!res.ok) throw new Error(`SoundEngine: failed to fetch ${url} (${res.status})`);
    const arrayBuffer = await res.arrayBuffer();
    return await this._ctx.decodeAudioData(arrayBuffer);
  }

  // ── Ambient Audio ───────────────────────────────────────────────────────────
  /**
   * Set ambient background audio.
   * @param {string} url   - audio file URL (mp3, ogg, wav)
   * @param {object} opts  - { volume:0-1, loop:bool, fadeIn:ms }
   */
  async setAmbient(url, opts = {}) {
    const { volume = 0.5, loop = true, fadeIn = 1500 } = opts;
    this._stopAmbient();
    await this._whenReady(async () => {
      try {
        const buffer = await this._loadBuffer(url);
        const gainNode = this._ctx.createGain();
        gainNode.gain.value = 0;
        gainNode.connect(this._masterGain);

        const source = this._ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = loop;
        source.connect(gainNode);
        source.start(0);

        // Fade in
        gainNode.gain.setValueAtTime(0, this._ctx.currentTime);
        gainNode.gain.linearRampToValueAtTime(volume, this._ctx.currentTime + fadeIn / 1000);

        this._ambient = { source, gainNode, buffer, options: { volume, loop, fadeIn } };
      } catch (err) {
        console.warn('[SoundEngine] ambient load failed:', err);
      }
    });
  }

  _stopAmbient(fadeOut = 500) {
    if (!this._ambient) return;
    const { source, gainNode, options } = this._ambient;
    try {
      gainNode.gain.setValueAtTime(gainNode.gain.value, this._ctx.currentTime);
      gainNode.gain.linearRampToValueAtTime(0, this._ctx.currentTime + fadeOut / 1000);
      setTimeout(() => { try { source.stop(); } catch (_) {} }, fadeOut + 50);
    } catch (_) {}
    this._ambient = null;
  }

  /** Mute / unmute ambient */
  setAmbientVolume(v) {
    if (!this._ambient) return;
    this._ambient.gainNode.gain.setTargetAtTime(v, this._ctx?.currentTime || 0, 0.1);
    this._ambient.options.volume = v;
  }

  // ── Spatial Sources ─────────────────────────────────────────────────────────
  /**
   * Attach a spatial audio source to a hotspot/position in 3D space.
   * @param {string} id        - unique id (hotspot id works well)
   * @param {string} url       - audio file URL
   * @param {{x,y,z}} position - world position of the source
   * @param {object}  opts     - { volume, loop, refDistance, maxDistance, rolloffFactor, autoplay }
   */
  async addSpatialSource(id, url, position, opts = {}) {
    const {
      volume = 1.0,
      loop = false,
      refDistance = 1,
      maxDistance = 20,
      rolloffFactor = 1,
      autoplay = false,
    } = opts;

    if (this._spatials.has(id)) this.removeSpatialSource(id);

    const entry = {
      url, position: { ...position }, options: opts, playing: false,
      source: null, panner: null, gainNode: null, buffer: null,
    };
    this._spatials.set(id, entry);

    await this._whenReady(async () => {
      try {
        const buffer = await this._loadBuffer(url);
        if (!this._spatials.has(id)) return; // removed while loading

        const panner = this._ctx.createPanner();
        panner.panningModel = 'HRTF';
        panner.distanceModel = 'inverse';
        panner.refDistance = refDistance;
        panner.maxDistance = maxDistance;
        panner.rolloffFactor = rolloffFactor;
        panner.setPosition(position.x || 0, position.y || 0, position.z || 0);

        const gainNode = this._ctx.createGain();
        gainNode.gain.value = volume;

        panner.connect(gainNode);
        gainNode.connect(this._masterGain);

        const e = this._spatials.get(id);
        if (!e) return;
        e.buffer = buffer;
        e.panner = panner;
        e.gainNode = gainNode;

        if (autoplay) this.playSpatial(id);
      } catch (err) {
        console.warn(`[SoundEngine] spatial source "${id}" load failed:`, err);
      }
    });
  }

  playSpatial(id) {
    const e = this._spatials.get(id);
    if (!e || !e.buffer || !e.panner) return;
    this._stopSpatialSource(e);
    const source = this._ctx.createBufferSource();
    source.buffer = e.buffer;
    source.loop = e.options.loop || false;
    source.connect(e.panner);
    source.start(0);
    e.source = source;
    e.playing = true;
  }

  stopSpatial(id) {
    const e = this._spatials.get(id);
    if (!e) return;
    this._stopSpatialSource(e);
  }

  _stopSpatialSource(e) {
    if (e.source) {
      try { e.source.stop(); } catch (_) {}
      e.source = null;
    }
    e.playing = false;
  }

  removeSpatialSource(id) {
    const e = this._spatials.get(id);
    if (!e) return;
    this._stopSpatialSource(e);
    try { e.gainNode?.disconnect(); } catch (_) {}
    this._spatials.delete(id);
  }

  updateSpatialPosition(id, position) {
    const e = this._spatials.get(id);
    if (!e || !e.panner) return;
    e.position = { ...position };
    e.panner.setPosition(position.x || 0, position.y || 0, position.z || 0);
  }

  // ── Listener (Camera) ───────────────────────────────────────────────────────
  /**
   * Update the listener position + orientation from a THREE.js camera.
   * Call this every frame (or on camera change).
   * @param {{x,y,z}} position    - camera world position
   * @param {{x,y,z,w}} quaternion - camera quaternion
   */
  updateListenerPosition(position, quaternion) {
    if (!this._ctx || !position) return;
    const listener = this._ctx.listener;
    if (!listener) return;

    if (listener.positionX) {
      listener.positionX.value = position.x || 0;
      listener.positionY.value = position.y || 0;
      listener.positionZ.value = position.z || 0;
    } else {
      listener.setPosition(position.x || 0, position.y || 0, position.z || 0);
    }

    // Derive forward and up vectors from quaternion
    if (quaternion) {
      const { x, y, z, w } = quaternion;
      // Forward vector: (0,0,-1) rotated by quaternion
      const fx = 2*(x*z + w*y), fy = 2*(y*z - w*x), fz = 1 - 2*(x*x + y*y);
      // Up vector: (0,1,0) rotated by quaternion
      const ux = 2*(x*y - w*z), uy = 1 - 2*(x*x + z*z), uz = 2*(y*z + w*x);
      if (listener.forwardX) {
        listener.forwardX.value = fx; listener.forwardY.value = fy; listener.forwardZ.value = fz;
        listener.upX.value = ux; listener.upY.value = uy; listener.upZ.value = uz;
      } else {
        try { listener.setOrientation(fx, fy, fz, ux, uy, uz); } catch (_) {}
      }
    }
  }

  // ── Master Volume / Mute ────────────────────────────────────────────────────
  setMasterVolume(v) {
    this._masterVolume = Math.max(0, Math.min(1, v));
    if (this._masterGain) {
      this._masterGain.gain.setTargetAtTime(this._masterVolume, this._ctx?.currentTime || 0, 0.05);
    }
  }

  toggleMute() {
    this._muted = !this._muted;
    this.setMasterVolume(this._muted ? 0 : this._masterVolume || 1);
    return this._muted;
  }

  // ── Disposal ────────────────────────────────────────────────────────────────
  dispose() {
    this._stopAmbient(0);
    for (const [id] of this._spatials) this.removeSpatialSource(id);
    this._ctx?.close().catch(() => {});
    this._ctx = null;
  }
}

// ── Editor UI Helpers ─────────────────────────────────────────────────────────

/**
 * Build an inline sound-attachment panel for use inside the editor's
 * hotspot/properties panel.
 *
 * @param {object} hotspot   - hotspot data object
 * @param {function} onChange - called with updated hotspot when audio fields change
 * @returns {HTMLElement}
 */
export function buildSoundAttachmentPanel(hotspot, onChange) {
  const panel = document.createElement('div');
  panel.style.cssText = 'margin-top:12px;padding:14px;border-radius:12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);';

  panel.innerHTML = `
    <div style="font-weight:700;font-size:13px;margin-bottom:10px;color:#C8FF00;">🔊 Spatial Audio</div>
    <label style="font-size:12px;color:#aaa;display:block;margin-bottom:4px;">Audio file URL</label>
    <input id="se_audioUrl" type="url" placeholder="https://…/sound.mp3  or .ogg/.wav"
      value="${hotspot.audioUrl || ''}"
      style="width:100%;padding:9px 12px;border-radius:9px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:#FAFAFA;font:inherit;font-size:13px;box-sizing:border-box;">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px;">
      <div>
        <label style="font-size:12px;color:#aaa;display:block;margin-bottom:4px;">Volume</label>
        <input id="se_volume" type="range" min="0" max="1" step="0.05"
          value="${hotspot.audioVolume ?? 0.8}"
          style="width:100%;accent-color:#C8FF00;">
        <span id="se_volumeLabel" style="font-size:11px;color:#aaa;">${((hotspot.audioVolume ?? 0.8)*100).toFixed(0)}%</span>
      </div>
      <div>
        <label style="font-size:12px;color:#aaa;display:block;margin-bottom:4px;">Max Distance</label>
        <input id="se_maxDist" type="number" min="1" max="100" step="1"
          value="${hotspot.audioMaxDistance ?? 15}"
          style="width:100%;padding:6px 10px;border-radius:9px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:#FAFAFA;font:inherit;font-size:13px;box-sizing:border-box;">
      </div>
    </div>
    <div style="display:flex;gap:10px;margin-top:10px;align-items:center;flex-wrap:wrap;">
      <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;">
        <input id="se_loop" type="checkbox" ${hotspot.audioLoop ? 'checked' : ''} style="accent-color:#C8FF00;">
        Loop
      </label>
      <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;">
        <input id="se_autoplay" type="checkbox" ${hotspot.audioAutoplay ? 'checked' : ''} style="accent-color:#C8FF00;">
        Autoplay on enter
      </label>
    </div>
    <button id="se_testBtn" style="margin-top:12px;padding:8px 14px;border-radius:9px;background:rgba(200,255,0,.08);border:1px solid rgba(200,255,0,.2);color:#C8FF00;font:700 13px/1 inherit;cursor:pointer;">▶ Test Sound</button>
    <button id="se_clearBtn" style="margin-top:12px;margin-left:8px;padding:8px 14px;border-radius:9px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:#aaa;font:700 13px/1 inherit;cursor:pointer;">✕ Remove Audio</button>
  `;

  let _testAudio = null;

  function gather() {
    return {
      audioUrl: panel.querySelector('#se_audioUrl').value.trim() || null,
      audioVolume: Number(panel.querySelector('#se_volume').value),
      audioMaxDistance: Number(panel.querySelector('#se_maxDist').value),
      audioLoop: panel.querySelector('#se_loop').checked,
      audioAutoplay: panel.querySelector('#se_autoplay').checked,
    };
  }

  panel.querySelector('#se_volume').addEventListener('input', e => {
    panel.querySelector('#se_volumeLabel').textContent = `${Math.round(e.target.value * 100)}%`;
    onChange?.({ ...hotspot, ...gather() });
  });

  ['#se_audioUrl','#se_maxDist','#se_loop','#se_autoplay'].forEach(sel => {
    panel.querySelector(sel).addEventListener('change', () => onChange?.({ ...hotspot, ...gather() }));
  });

  panel.querySelector('#se_testBtn').addEventListener('click', () => {
    const url = panel.querySelector('#se_audioUrl').value.trim();
    if (!url) return;
    if (_testAudio) { _testAudio.pause(); _testAudio = null; }
    _testAudio = new Audio(url);
    _testAudio.volume = Number(panel.querySelector('#se_volume').value);
    _testAudio.play().catch(err => alert(`Cannot play: ${err.message}`));
  });

  panel.querySelector('#se_clearBtn').addEventListener('click', () => {
    if (_testAudio) { _testAudio.pause(); _testAudio = null; }
    panel.querySelector('#se_audioUrl').value = '';
    onChange?.({ ...hotspot, audioUrl: null, audioVolume: 0.8, audioMaxDistance: 15, audioLoop: false, audioAutoplay: false });
  });

  return panel;
}

/**
 * Build an ambient audio attachment panel for the editor's global settings.
 *
 * @param {object}   settings  - { ambientUrl, ambientVolume, ambientLoop }
 * @param {function} onChange  - called with updated settings
 * @returns {HTMLElement}
 */
export function buildAmbientPanel(settings, onChange) {
  const panel = document.createElement('div');
  panel.style.cssText = 'padding:16px;border-radius:14px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);';

  panel.innerHTML = `
    <div style="font-weight:700;font-size:14px;margin-bottom:12px;color:#C8FF00;">🎵 Ambient Audio</div>
    <p style="font-size:12px;color:#aaa;margin:0 0 12px;">Background track that plays when visitors open this splat.</p>
    <label style="font-size:12px;color:#aaa;display:block;margin-bottom:4px;">Audio file URL</label>
    <input id="amb_url" type="url" placeholder="https://…/ambient.mp3"
      value="${settings.ambientUrl || ''}"
      style="width:100%;padding:9px 12px;border-radius:9px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:#FAFAFA;font:inherit;font-size:13px;box-sizing:border-box;">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px;">
      <div>
        <label style="font-size:12px;color:#aaa;display:block;margin-bottom:4px;">Volume</label>
        <input id="amb_vol" type="range" min="0" max="1" step="0.05"
          value="${settings.ambientVolume ?? 0.35}"
          style="width:100%;accent-color:#C8FF00;">
        <span id="amb_volLabel" style="font-size:11px;color:#aaa;">${((settings.ambientVolume ?? 0.35)*100).toFixed(0)}%</span>
      </div>
      <div style="display:flex;flex-direction:column;justify-content:flex-end;">
        <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;margin-bottom:4px;">
          <input id="amb_loop" type="checkbox" ${settings.ambientLoop !== false ? 'checked' : ''} style="accent-color:#C8FF00;">
          Loop
        </label>
      </div>
    </div>
    <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">
      <button id="amb_testBtn" style="padding:8px 14px;border-radius:9px;background:rgba(200,255,0,.08);border:1px solid rgba(200,255,0,.2);color:#C8FF00;font:700 13px/1 inherit;cursor:pointer;">▶ Preview</button>
      <button id="amb_stopBtn" style="padding:8px 14px;border-radius:9px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:#aaa;font:700 13px/1 inherit;cursor:pointer;">■ Stop</button>
      <button id="amb_clearBtn" style="padding:8px 14px;border-radius:9px;background:rgba(255,60,60,.08);border:1px solid rgba(255,60,60,.2);color:#ff9d9d;font:700 13px/1 inherit;cursor:pointer;">✕ Remove</button>
    </div>
  `;

  let _preview = null;

  function gather() {
    return {
      ambientUrl: panel.querySelector('#amb_url').value.trim() || null,
      ambientVolume: Number(panel.querySelector('#amb_vol').value),
      ambientLoop: panel.querySelector('#amb_loop').checked,
    };
  }

  panel.querySelector('#amb_vol').addEventListener('input', e => {
    panel.querySelector('#amb_volLabel').textContent = `${Math.round(e.target.value * 100)}%`;
    if (_preview) _preview.volume = Number(e.target.value);
    onChange?.(gather());
  });

  ['#amb_url','#amb_loop'].forEach(sel => {
    panel.querySelector(sel).addEventListener('change', () => onChange?.(gather()));
  });

  panel.querySelector('#amb_testBtn').addEventListener('click', () => {
    const url = panel.querySelector('#amb_url').value.trim();
    if (!url) return;
    if (_preview) { _preview.pause(); _preview = null; }
    _preview = new Audio(url);
    _preview.volume = Number(panel.querySelector('#amb_vol').value);
    _preview.loop = panel.querySelector('#amb_loop').checked;
    _preview.play().catch(err => alert(`Cannot play: ${err.message}`));
  });

  panel.querySelector('#amb_stopBtn').addEventListener('click', () => {
    if (_preview) { _preview.pause(); _preview = null; }
  });

  panel.querySelector('#amb_clearBtn').addEventListener('click', () => {
    if (_preview) { _preview.pause(); _preview = null; }
    panel.querySelector('#amb_url').value = '';
    onChange?.({ ambientUrl: null, ambientVolume: 0.35, ambientLoop: true });
  });

  return panel;
}
