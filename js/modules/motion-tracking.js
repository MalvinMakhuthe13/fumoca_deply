/**
 * FUMOCA Motion Tracking Layer
 * Lightweight step/trace extraction for learning flows such as dance tutorials,
 * fitness demos, sports drills, and gesture-led event captures.
 *
 * Uses browser-side frame differencing and centroid tracking so it works now,
 * and can be upgraded later to MediaPipe / server-side pose estimation without
 * changing the stored metadata shape.
 */

const MotionTracking = (() => {
  let _record = null;
  let _overlay = null;
  let _lastTracking = null;

  function init(record = null) {
    _record = record || window._fumocaCurrentRecord || null;
    _ensureOverlay();
    const stored = _record?.metadata?.motion_tracking;
    if (stored?.steps?.length) {
      _lastTracking = stored;
      renderTracking(stored);
    }
  }

  async function analyzeVideo(file, analysisResult = null, onProgress = null) {
    const video = document.createElement('video');
    video.playsInline = true;
    video.muted = true;
    video.preload = 'auto';
    video.src = URL.createObjectURL(file);
    await _waitFor(video, 'loadedmetadata');

    const duration = Number(video.duration) || 0;
    const start = Math.max(0, analysisResult?.bestWindowStart ?? 0);
    const resolvedEnd = analysisResult?.bestWindowEnd ?? duration;
    const end = Math.min(duration || resolvedEnd || 0, resolvedEnd || duration || 0);
    const activeSpan = Math.max(1, (end - start) || duration || 2);
    const sampleCount = Math.max(24, Math.min(90, Math.round(activeSpan * 12)));
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const w = 240;
    const h = Math.max(135, Math.round((video.videoHeight / Math.max(1, video.videoWidth)) * w));
    canvas.width = w;
    canvas.height = h;

    const samples = [];
    let prevGray = null;
    for (let i = 0; i < sampleCount; i++) {
      const t = start + (activeSpan * (i / Math.max(1, sampleCount - 1)));
      await _seek(video, t);
      ctx.drawImage(video, 0, 0, w, h);
      const img = ctx.getImageData(0, 0, w, h);
      const gray = new Uint8Array(w * h);
      let sx = 0;
      let sy = 0;
      let sw = 0;
      let motionEnergy = 0;
      for (let p = 0, px = 0; p < img.data.length; p += 4, px++) {
        const g = (img.data[p] * 0.299 + img.data[p + 1] * 0.587 + img.data[p + 2] * 0.114) | 0;
        gray[px] = g;
        if (!prevGray) continue;
        const diff = Math.abs(g - prevGray[px]);
        if (diff <= 18) continue;
        const x = px % w;
        const y = (px / w) | 0;
        const centerBias = 1.25 - (Math.abs((x / w) - 0.5) + Math.abs((y / h) - 0.5));
        const weight = Math.max(0.15, centerBias) * diff;
        sx += x * weight;
        sy += y * weight;
        sw += weight;
        motionEnergy += weight;
      }
      const cx = sw ? sx / sw : w / 2;
      const cy = sw ? sy / sw : h / 2;
      samples.push({
        t,
        x: +(cx / w).toFixed(4),
        y: +(cy / h).toFixed(4),
        motion: +motionEnergy.toFixed(1)
      });
      prevGray = gray;
      if (onProgress) onProgress((i + 1) / sampleCount);
    }

    const smoothed = _smooth(samples);
    const steps = _extractSteps(smoothed, analysisResult);
    const motionCurve = smoothed.map((s) => ({
      t: +s.t.toFixed(3),
      x: s.x,
      y: s.y,
      motion: +s.motion.toFixed(1)
    }));
    const result = {
      type: 'centroid_trace_v1',
      created_at: new Date().toISOString(),
      source_name: file.name,
      window: { start, end },
      motion_class: analysisResult?.motionClass || 'unknown',
      curve: motionCurve,
      steps,
      hints: _buildHints(steps, analysisResult)
    };
    _lastTracking = result;
    URL.revokeObjectURL(video.src);
    return result;
  }

  function renderTracking(tracking = _lastTracking) {
    _ensureOverlay();
    if (!_overlay || !tracking?.steps?.length) {
      if (_overlay) _overlay.style.display = 'none';
      return;
    }
    _overlay.style.display = 'block';
    _overlay.innerHTML = '';
    for (const step of tracking.steps) {
      const n = document.createElement('div');
      n.className = 'fumocaTrackNode';
      n.style.left = `${(step.x * 100).toFixed(2)}%`;
      n.style.top = `${(step.y * 100).toFixed(2)}%`;
      n.innerHTML = `<span>${step.label}</span>`;
      _overlay.appendChild(n);
    }
  }

  async function persistToRecord(tracking = _lastTracking, record = _record) {
    if (!tracking || !record?.id || !window._fumocaSupabase) return false;
    try {
      const metadata = { ...(record.metadata || {}), motion_tracking: tracking };
      await window._fumocaSupabase.from('splats').update({ metadata }).eq('id', record.id);
      if (window._fumocaCurrentRecord?.id === record.id) {
        window._fumocaCurrentRecord.metadata = metadata;
      }
      return true;
    } catch (err) {
      console.warn('[MotionTracking] persist failed', err);
      return false;
    }
  }

  function applyToMotionStates(tracking = _lastTracking) {
    if (!tracking?.steps?.length || !window.FumocaMotionStates) return [];
    const states = window.FumocaMotionStates.getStates();
    if (!states.length) return [];
    const mapped = [];
    tracking.steps.forEach((step, idx) => {
      const state = states[Math.min(idx, states.length - 1)];
      if (!state) return;
      state.poseData = {
        ...(state.poseData || {}),
        tracking_step: step.label,
        tracking_hint: step.hint,
        tracking_time: step.time,
        viewport_anchor: { x: step.x, y: step.y }
      };
      mapped.push({ stateId: state.id, step: step.label });
    });
    window.dispatchEvent(new CustomEvent('fumoca:motionTrackingMapped', { detail: { mapped, tracking } }));
    return mapped;
  }

  function _extractSteps(samples, analysisResult) {
    if (!samples.length) return [];
    const candidates = [];
    for (let i = 1; i < samples.length - 1; i++) {
      const prev = samples[i - 1];
      const cur = samples[i];
      const next = samples[i + 1];
      const localMin = cur.motion <= prev.motion && cur.motion <= next.motion;
      const directionalShift = Math.hypot(next.x - prev.x, next.y - prev.y);
      if (localMin || directionalShift > 0.08) {
        candidates.push({ ...cur, score: (1 / Math.max(1, cur.motion)) + directionalShift * 8 });
      }
    }
    if (!candidates.length) {
      const mid = samples[Math.floor(samples.length / 2)];
      return [{
        label: 'Step 1',
        time: +mid.t.toFixed(2),
        x: mid.x,
        y: mid.y,
        hint: 'Hold this position and match the silhouette.'
      }];
    }
    candidates.sort((a, b) => b.score - a.score);
    const maxSteps = Math.max(3, Math.min(6, analysisResult?.keyMoments?.length || 4));
    const picked = [];
    for (const c of candidates) {
      if (picked.every((p) => Math.abs(p.t - c.t) > 0.35)) picked.push(c);
      if (picked.length >= maxSteps) break;
    }
    picked.sort((a, b) => a.t - b.t);
    return picked.map((p, i) => ({
      label: `Step ${i + 1}`,
      time: +p.t.toFixed(2),
      x: +p.x.toFixed(4),
      y: +p.y.toFixed(4),
      hint: i === 0
        ? 'Start here and match the opening posture.'
        : (i === picked.length - 1
          ? 'Finish here and hold the final shape.'
          : 'Transition through this beat before moving on.')
    }));
  }

  function _buildHints(steps, analysisResult) {
    const motion = analysisResult?.motionClass || 'moderate';
    return {
      mode: motion === 'fast'
        ? 'Use slower demo playback + pause on each step.'
        : 'Use trace mode + step hold prompts.',
      tracking: 'This pass uses viewport trace anchors now and can upgrade to body-joint tracking later without changing your saved data.',
      replay: 'Pair the teaser video with the step dots so users can watch then rotate and study the pose.'
    };
  }

  function _smooth(samples) {
    return samples.map((s, i, arr) => {
      const prev = arr[Math.max(0, i - 1)];
      const next = arr[Math.min(arr.length - 1, i + 1)];
      return {
        ...s,
        x: +((prev.x + s.x + next.x) / 3).toFixed(4),
        y: +((prev.y + s.y + next.y) / 3).toFixed(4),
        motion: +((prev.motion + s.motion + next.motion) / 3).toFixed(1)
      };
    });
  }

  function _ensureOverlay() {
    if (_overlay) return _overlay;
    const ov = document.createElement('div');
    ov.id = 'fumocaMotionTraceOverlay';
    ov.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:12;display:none;';
    const style = document.createElement('style');
    style.id = 'fumocaMotionTraceStyles';
    style.textContent = `
#fumocaMotionTraceOverlay .fumocaTrackNode{position:absolute;transform:translate(-50%,-50%);min-width:18px;min-height:18px;border-radius:999px;background:rgba(200,255,0,.14);border:1px solid rgba(200,255,0,.45);box-shadow:0 0 0 6px rgba(200,255,0,.05);display:grid;place-items:center}
#fumocaMotionTraceOverlay .fumocaTrackNode span{position:absolute;top:22px;left:50%;transform:translateX(-50%);white-space:nowrap;font:700 10px/1 var(--font-body,Arial);color:#dfff7a;background:rgba(5,7,11,.78);border:1px solid rgba(200,255,0,.18);padding:5px 8px;border-radius:999px;backdrop-filter:blur(10px)}
`;
    if (!document.getElementById(style.id)) document.head.appendChild(style);
    document.body.appendChild(ov);
    _overlay = ov;
    return ov;
  }

  function _waitFor(el, ev) {
    return new Promise((resolve, reject) => {
      const ok = () => { cleanup(); resolve(); };
      const bad = () => { cleanup(); reject(new Error(`Video ${ev} failed`)); };
      const cleanup = () => {
        el.removeEventListener(ev, ok);
        el.removeEventListener('error', bad);
      };
      el.addEventListener(ev, ok, { once: true });
      el.addEventListener('error', bad, { once: true });
    });
  }

  function _seek(video, t) {
    return new Promise((resolve, reject) => {
      const onSeek = () => { cleanup(); resolve(); };
      const onErr = () => { cleanup(); reject(new Error('Seek failed')); };
      const cleanup = () => {
        video.removeEventListener('seeked', onSeek);
        video.removeEventListener('error', onErr);
      };
      video.addEventListener('seeked', onSeek, { once: true });
      video.addEventListener('error', onErr, { once: true });
      video.currentTime = Math.max(0, Math.min(video.duration || t, t));
    });
  }

  return {
    init,
    analyzeVideo,
    renderTracking,
    persistToRecord,
    applyToMotionStates,
    getLastTracking: () => _lastTracking
  };
})();

window.FumocaMotionTracking = MotionTracking;
export default MotionTracking;
