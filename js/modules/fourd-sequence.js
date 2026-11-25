/**
 * FUMOCA 4D Gaussian sequence contract and playback clock (v1).
 *
 * A dynamic Gaussian capture is a time-indexed sequence of reconstructed
 * Gaussian frames. This module owns timing and frame lifecycle only; a
 * renderer adapter owns decoding, GPU upload, and presentation.
 *
 * IMPORTANT: Do not interpolate unrelated Gaussian arrays. Linear blending is
 * allowed only when adjacent frames declare identical topologyId and
 * gaussianCount and the adapter explicitly supports attribute interpolation.
 */
const Fumoca4DSequence = (() => {
  const FORMATS = new Set(['ply', 'splat', 'nif']);
  const MODES = new Set(['hold', 'linear']);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function validateManifest(input) {
    const errors = [];
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return { ok: false, errors: ['manifest must be an object'] };
    }
    if (input.schema !== 'fumoca.4d.sequence' || input.version !== 1) {
      errors.push('unsupported sequence schema/version');
    }
    if (!input.id || typeof input.id !== 'string') errors.push('id is required');
    if (!Number.isFinite(input.duration) || input.duration <= 0) errors.push('duration must be positive seconds');
    if (!Number.isFinite(input.frameRate) || input.frameRate <= 0 || input.frameRate > 240) errors.push('frameRate must be between 0 and 240');
    if (!Array.isArray(input.frames) || input.frames.length < 2) errors.push('at least two frames are required');
    const frames = Array.isArray(input.frames) ? input.frames : [];
    let previous = -Infinity;
    frames.forEach((frame, index) => {
      if (!frame || typeof frame !== 'object') { errors.push(`frames[${index}] must be an object`); return; }
      if (!Number.isFinite(frame.time) || frame.time < 0) errors.push(`frames[${index}].time must be non-negative seconds`);
      else {
        if (frame.time <= previous) errors.push(`frames[${index}].time must be strictly increasing`);
        previous = frame.time;
      }
      if (typeof frame.url !== 'string' || !frame.url.trim() || /^(javascript|data):/i.test(frame.url)) {
        errors.push(`frames[${index}].url must be a safe asset URL`);
      }
      if (!FORMATS.has(frame.format)) errors.push(`frames[${index}].format must be ply, splat, or nif`);
      if (!Number.isInteger(frame.gaussianCount) || frame.gaussianCount < 1) errors.push(`frames[${index}].gaussianCount must be a positive integer`);
      if (typeof frame.topologyId !== 'string' || !frame.topologyId) errors.push(`frames[${index}].topologyId is required`);
      if (frame.byteLength != null && (!Number.isInteger(frame.byteLength) || frame.byteLength < 1)) errors.push(`frames[${index}].byteLength must be a positive integer`);
      if (frame.sha256 != null && !/^[a-f0-9]{64}$/i.test(frame.sha256)) errors.push(`frames[${index}].sha256 must be a SHA-256 hex digest`);
    });
    if (frames.length && Number.isFinite(input.duration) && previous > input.duration + 1e-6) {
      errors.push('last frame time must not exceed duration');
    }
    if (input.interpolation != null && !MODES.has(input.interpolation)) errors.push('interpolation must be hold or linear');
    if (input.interpolation === 'linear') {
      for (let i = 1; i < frames.length; i++) {
        const a = frames[i - 1], b = frames[i];
        if (a?.topologyId !== b?.topologyId || a?.gaussianCount !== b?.gaussianCount) {
          errors.push(`linear interpolation requires matching topologyId and gaussianCount at frames ${i - 1}/${i}`);
        }
      }
    }
    return { ok: errors.length === 0, errors };
  }

  function locateFrames(frames, time) {
    if (!Array.isArray(frames) || !frames.length) return null;
    if (time <= frames[0].time) return { a: 0, b: 0, alpha: 0 };
    const last = frames.length - 1;
    if (time >= frames[last].time) return { a: last, b: last, alpha: 0 };
    let lo = 0, hi = last;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (frames[mid].time <= time) lo = mid;
      else hi = mid;
    }
    const span = frames[hi].time - frames[lo].time;
    return { a: lo, b: hi, alpha: span > 0 ? (time - frames[lo].time) / span : 0 };
  }

  function create(manifest, adapter, options = {}) {
    const checked = validateManifest(manifest);
    if (!checked.ok) throw new TypeError('Invalid FUMOCA 4D sequence: ' + checked.errors.join('; '));
    if (!adapter || typeof adapter.loadFrame !== 'function' || typeof adapter.presentFrame !== 'function') {
      throw new TypeError('renderer adapter must implement loadFrame(frame) and presentFrame(handle, context)');
    }
    const frames = manifest.frames;
    const duration = manifest.duration;
    let loop = options.loop !== false;
    let time = 0, speed = 1, playing = false, disposed = false;
    let lastTick = null, raf = null, activeHandle = null, activeIndex = -1;
    let pending = new Map();
    const cache = new Map();
    let generation = 0;
    const requestFrame = options.requestAnimationFrame || globalThis.requestAnimationFrame?.bind(globalThis);
    const cancelFrame = options.cancelAnimationFrame || globalThis.cancelAnimationFrame?.bind(globalThis);
    const now = options.now || (() => (globalThis.performance?.now?.() ?? Date.now()));

    async function load(index) {
      if (cache.has(index)) return { handle: cache.get(index), index };
      if (pending.has(index)) return pending.get(index);
      const promise = Promise.resolve(adapter.loadFrame(frames[index], index))
        .then(handle => { cache.set(index, handle); return { handle, index }; })
        .finally(() => pending.delete(index));
      pending.set(index, promise);
      return promise;
    }

    async function renderAt(targetTime, token = generation) {
      const location = locateFrames(frames, targetTime);
      if (!location) return false;
      const useLinear = manifest.interpolation === 'linear' && location.a !== location.b && adapter.interpolateFrames === true;
      const index = useLinear && location.alpha >= 0.5 ? location.b : location.a;
      const loaded = await load(index);
      if (disposed || token !== generation) {
        if (loaded.handle && adapter.disposeFrame) adapter.disposeFrame(loaded.handle);
        return false;
      }
      if (activeIndex !== index) {
        const previous = activeHandle;
        activeHandle = loaded.handle;
        activeIndex = index;
        await adapter.presentFrame(activeHandle, {
          time: targetTime, frameIndex: index, nextFrameIndex: useLinear ? location.b : index,
          alpha: useLinear ? location.alpha : 0, interpolation: useLinear ? 'linear' : 'hold'
        });
        if (previous && previous !== activeHandle) adapter.disposeFrame?.(previous);
      } else {
        await adapter.presentFrame(activeHandle, {
          time: targetTime, frameIndex: index, nextFrameIndex: useLinear ? location.b : index,
          alpha: useLinear ? location.alpha : 0, interpolation: useLinear ? 'linear' : 'hold'
        });
      }
      // Prefetch the next frame without blocking the render clock.
      const next = Math.min(frames.length - 1, index + 1);
      if (next !== index) load(next).catch(error => adapter.onError?.(error));
      return true;
    }

    function tick(stamp) {
      if (!playing || disposed) return;
      if (lastTick == null) lastTick = stamp;
      const delta = Math.max(0, Math.min(0.1, (stamp - lastTick) / 1000));
      lastTick = stamp;
      time += delta * speed;
      if (time >= duration) {
        if (loop) time %= duration;
        else { time = duration; playing = false; }
      }
      renderAt(time).catch(error => adapter.onError?.(error));
      if (playing && requestFrame) raf = requestFrame(tick);
      else raf = null;
    }

    return {
      play() {
        if (disposed || playing) return false;
        playing = true; lastTick = null;
        if (!requestFrame) throw new Error('requestAnimationFrame is unavailable; pass a scheduler in options');
        raf = requestFrame(tick);
        return true;
      },
      pause() {
        if (!playing) return false;
        playing = false;
        if (raf != null) cancelFrame?.(raf);
        raf = null; lastTick = null;
        return true;
      },
      async seek(seconds) {
        if (disposed || !Number.isFinite(seconds)) return false;
        time = clamp(seconds, 0, duration);
        generation++;
        return renderAt(time, generation);
      },
      setSpeed(value) {
        if (!Number.isFinite(value) || value < 0.1 || value > 4) throw new RangeError('speed must be between 0.1x and 4x');
        speed = value; return speed;
      },
      setLoop(value) { loop = !!value; return loop; },
      async dispose() {
        this.pause(); disposed = true; generation++;
        for (const promise of pending.values()) promise.then(x => adapter.disposeFrame?.(x.handle)).catch(() => {});
        pending.clear();
        for (const handle of cache.values()) adapter.disposeFrame?.(handle);
        cache.clear();
        activeHandle = null; activeIndex = -1;
        await adapter.dispose?.();
      },
      get time() { return time; },
      get duration() { return duration; },
      get playing() { return playing; },
      get activeFrame() { return activeIndex; },
      get manifest() { return manifest; }
    };
  }

  return { validateManifest, locateFrames, create };
})();

if (typeof window !== 'undefined') window.Fumoca4DSequence = Fumoca4DSequence;
export default Fumoca4DSequence;
