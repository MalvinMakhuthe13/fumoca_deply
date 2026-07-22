/**
 * FUMOCA Motion Analyzer
 * Analyzes video/frames to find the best reconstruction window for moving subjects.
 * Works for people, vehicles, and any moving object.
 * Supports: single phone, multi-camera, slow motion, fast motion.
 */

const MA = (() => {
  // ─── Config ───────────────────────────────────────────────────────────────
  const CFG = {
    sampleRate: 4,           // frames to analyze per second
    windowSec: 2.5,          // ideal reconstruction window in seconds
    minWindowSec: 1.2,       // absolute minimum
    maxWindowSec: 4.0,       // max frames to pass to COLMAP
    motionThreshLow: 0.018,  // stillness threshold (people posing)
    motionThreshMid: 0.055,  // moderate motion (slow walk, vehicle roll)
    motionThreshHigh: 0.14,  // fast motion (running, fast drive)
    blurThresh: 120,          // Laplacian variance — below = blurry frame
    edgePadSec: 0.4,         // skip first/last N seconds of clip
    maxFramesOut: 120,        // hard cap on frames sent to COLMAP
  };

  // ─── Internal state ────────────────────────────────────────────────────────
  let _canvas = null;
  let _ctx = null;
  let _prevPixels = null;

  function _getCanvas(w, h) {
    if (!_canvas) {
      _canvas = document.createElement('canvas');
      _ctx = _canvas.getContext('2d', { willReadFrequently: true });
    }
    _canvas.width = w;
    _canvas.height = h;
    return { canvas: _canvas, ctx: _ctx };
  }

  // ─── Frame sharpness (Laplacian variance proxy) ────────────────────────────
  function _sharpness(pixels, w, h) {
    let sum = 0, count = 0;
    const stride = w * 4;
    for (let y = 1; y < h - 1; y += 4) {
      for (let x = 1; x < w - 1; x += 4) {
        const i = y * stride + x * 4;
        const g = pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114;
        const gU = pixels[(y-1)*stride+x*4]*0.299 + pixels[(y-1)*stride+x*4+1]*0.587 + pixels[(y-1)*stride+x*4+2]*0.114;
        const gD = pixels[(y+1)*stride+x*4]*0.299 + pixels[(y+1)*stride+x*4+1]*0.587 + pixels[(y+1)*stride+x*4+2]*0.114;
        const lap = Math.abs(2*g - gU - gD);
        sum += lap * lap;
        count++;
      }
    }
    return count ? sum / count : 0;
  }

  // ─── Inter-frame motion delta ──────────────────────────────────────────────
  function _motionDelta(pixels, prevPixels, w, h) {
    if (!prevPixels || prevPixels.length !== pixels.length) return 1.0;
    let diff = 0;
    const total = w * h;
    for (let i = 0; i < pixels.length; i += 4 * 8) {
      const dr = pixels[i]   - prevPixels[i];
      const dg = pixels[i+1] - prevPixels[i+1];
      const db = pixels[i+2] - prevPixels[i+2];
      diff += (Math.abs(dr) + Math.abs(dg) + Math.abs(db)) / (3 * 255);
    }
    return Math.min(1.0, diff / (total / 8));
  }

  // ─── Detect motion class ───────────────────────────────────────────────────
  function _classifyMotion(avgDelta) {
    if (avgDelta < CFG.motionThreshLow) return 'still';       // posed, parked
    if (avgDelta < CFG.motionThreshMid) return 'slow';        // walking, slow roll
    if (avgDelta < CFG.motionThreshHigh) return 'moderate';   // jogging, driving
    return 'fast';                                              // running, highway
  }

  // ─── Extract frame pixels from video element ───────────────────────────────
  function _grabFrame(video, scale = 0.25) {
    const w = Math.floor(video.videoWidth * scale);
    const h = Math.floor(video.videoHeight * scale);
    const { ctx } = _getCanvas(w, h);
    ctx.drawImage(video, 0, 0, w, h);
    return { pixels: ctx.getImageData(0, 0, w, h).data, w, h };
  }

  // ─── Score each frame ──────────────────────────────────────────────────────
  async function analyzeVideo(videoFile, onProgress) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(videoFile);
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      video.src = url;

      video.addEventListener('error', () => { URL.revokeObjectURL(url); reject(new Error('Video load failed')); });

      video.addEventListener('loadedmetadata', async () => {
        const duration = video.duration;
        const start = CFG.edgePadSec;
        const end = Math.max(start + CFG.minWindowSec, duration - CFG.edgePadSec);
        const frameInterval = 1 / CFG.sampleRate;
        const frames = [];
        let t = start;
        let prev = null;

        const seekTo = (time) => new Promise(res => {
          video.currentTime = time;
          const onSeeked = () => { video.removeEventListener('seeked', onSeeked); res(); };
          video.addEventListener('seeked', onSeeked);
        });

        while (t <= end) {
          await seekTo(t);
          const { pixels, w, h } = _grabFrame(video);
          const sharp = _sharpness(pixels, w, h);
          const delta = _motionDelta(pixels, prev, w, h);
          frames.push({ time: t, sharp, delta, pixels: new Uint8ClampedArray(pixels), w, h });
          prev = frames[frames.length - 1].pixels;
          if (onProgress) onProgress(Math.min(0.95, (t - start) / (end - start)));
          t += frameInterval;
        }

        URL.revokeObjectURL(url);

        const result = _findBestWindow(frames, duration);
        if (onProgress) onProgress(1.0);
        resolve(result);
      });

      video.load();
    });
  }

  // ─── Find the best reconstruction window ──────────────────────────────────
  function _findBestWindow(frames, totalDuration) {
    if (!frames.length) return null;

    // Compute per-frame score: high sharpness + low motion = good for reconstruction
    const scored = frames.map(f => ({
      ...f,
      score: (f.sharp / (CFG.blurThresh + f.sharp)) * (1 - Math.min(1, f.delta / CFG.motionThreshHigh))
    }));

    // Sliding window search for best continuous segment
    const targetFrames = Math.round(CFG.windowSec * CFG.sampleRate);
    const minFrames = Math.round(CFG.minWindowSec * CFG.sampleRate);
    let bestStart = 0, bestScore = -1;

    for (let i = 0; i <= scored.length - minFrames; i++) {
      const windowEnd = Math.min(scored.length, i + targetFrames);
      const window = scored.slice(i, windowEnd);
      const avgScore = window.reduce((s, f) => s + f.score, 0) / window.length;
      const minSharp = Math.min(...window.map(f => f.sharp));
      const combined = avgScore * 0.7 + (minSharp / CFG.blurThresh) * 0.3;
      if (combined > bestScore) { bestScore = combined; bestStart = i; }
    }

    const windowFrames = scored.slice(bestStart, bestStart + targetFrames);
    const allDeltas = scored.map(f => f.delta);
    const avgDelta = allDeltas.reduce((a, b) => a + b, 0) / allDeltas.length;
    const motionClass = _classifyMotion(avgDelta);

    // For fast motion, recommend multi-moment capture
    const recommendMultiMoment = motionClass === 'fast' || motionClass === 'moderate';
    const moments = recommendMultiMoment ? _detectKeyMoments(scored) : null;

    return {
      motionClass,
      avgMotionDelta: avgDelta,
      bestWindowStart: windowFrames[0]?.time ?? 0,
      bestWindowEnd: windowFrames[windowFrames.length - 1]?.time ?? totalDuration,
      bestWindowScore: bestScore,
      totalFrames: frames.length,
      recommendedFrames: windowFrames.map(f => f.time),
      recommendMultiMoment,
      keyMoments: moments,
      strategy: _getStrategy(motionClass),
      allFrameScores: scored.map(f => ({ time: f.time, score: f.score, delta: f.delta, sharp: f.sharp }))
    };
  }

  // ─── Detect key moments for multi-state capture ────────────────────────────
  function _detectKeyMoments(scored) {
    // Find local minima in motion delta = natural pause points
    const moments = [];
    for (let i = 1; i < scored.length - 1; i++) {
      const prev = scored[i-1].delta;
      const curr = scored[i].delta;
      const next = scored[i+1].delta;
      if (curr < prev && curr < next && scored[i].sharp > CFG.blurThresh * 0.6) {
        moments.push({ time: scored[i].time, score: scored[i].score, delta: curr });
      }
    }
    // Return top 3 moments spaced at least 1 second apart
    const filtered = [];
    for (const m of moments.sort((a, b) => b.score - a.score)) {
      if (!filtered.find(f => Math.abs(f.time - m.time) < 1.0)) {
        filtered.push(m);
        if (filtered.length >= 3) break;
      }
    }
    return filtered.sort((a, b) => a.time - b.time);
  }

  // ─── Strategy advice per motion class ─────────────────────────────────────
  function _getStrategy(motionClass) {
    const s = {
      still: {
        label: 'Standard capture',
        colmapMode: 'exhaustive',
        frameTarget: 80,
        subjectIsolation: true,
        multiMoment: false,
        tip: 'Subject is still — standard COLMAP will produce excellent results.'
      },
      slow: {
        label: 'Freeze-frame extraction',
        colmapMode: 'sequential',
        frameTarget: 60,
        subjectIsolation: true,
        multiMoment: false,
        tip: 'Extract best 60-frame window. Subject isolation recommended to remove background motion.'
      },
      moderate: {
        label: 'Multi-moment + isolation',
        colmapMode: 'sequential',
        frameTarget: 45,
        subjectIsolation: true,
        multiMoment: true,
        tip: 'Reconstruct 2–3 key moments separately. Each becomes a hotspot state in the viewer.'
      },
      fast: {
        label: 'Multi-camera or burst mode required',
        colmapMode: 'sequential',
        frameTarget: 30,
        subjectIsolation: true,
        multiMoment: true,
        tip: 'Fast motion needs either multi-cam rig (simultaneous capture) or slow-motion video (120fps+). Extract best burst windows per moment.'
      }
    };
    return s[motionClass] || s.slow;
  }

  // ─── Multi-camera frame merge ─────────────────────────────────────────────
  // When multiple phones capture simultaneously, merge their frames by timestamp
  function mergeMultiCameraFrames(cameraStreams) {
    // cameraStreams: [{ cameraId, frames: [{time, frameDataUrl}] }]
    const merged = [];
    for (const stream of cameraStreams) {
      for (const frame of stream.frames) {
        merged.push({ ...frame, cameraId: stream.cameraId });
      }
    }
    // Sort by time, then camera angle — gives COLMAP a full 360 at each moment
    return merged.sort((a, b) => a.time - b.time || a.cameraId - b.cameraId);
  }

  // ─── Slow-motion frame decimation ─────────────────────────────────────────
  // 120/240fps video → select 1 in N frames to hit target frame count
  function decimateSlowMo(frames, sourceFps, targetCount = 80) {
    if (!frames.length) return frames;
    const step = Math.max(1, Math.floor(frames.length / targetCount));
    return frames.filter((_, i) => i % step === 0).slice(0, targetCount);
  }

  // ─── Export frame times for pipeline ──────────────────────────────────────
  function exportForPipeline(analysisResult) {
    const { strategy, recommendedFrames, keyMoments, motionClass } = analysisResult;
    const jobs = [];

    if (!analysisResult.recommendMultiMoment) {
      // Single reconstruction job
      jobs.push({
        jobId: `main_${Date.now()}`,
        label: 'Main splat',
        frameTimes: recommendedFrames.slice(0, strategy.frameTarget),
        colmapMode: strategy.colmapMode,
        subjectIsolation: strategy.subjectIsolation,
        motionClass
      });
    } else {
      // One job per key moment
      const moments = keyMoments?.length ? keyMoments : [{ time: recommendedFrames[0] ?? 0 }];
      moments.forEach((m, idx) => {
        const center = m.time;
        const half = CFG.minWindowSec / 2;
        const relevantFrames = analysisResult.allFrameScores
          .filter(f => Math.abs(f.time - center) <= half)
          .sort((a, b) => b.score - a.score)
          .slice(0, strategy.frameTarget)
          .map(f => f.time)
          .sort((a, b) => a - b);
        jobs.push({
          jobId: `moment_${idx}_${Date.now()}`,
          label: `Moment ${idx + 1}`,
          momentTime: center,
          frameTimes: relevantFrames,
          colmapMode: strategy.colmapMode,
          subjectIsolation: strategy.subjectIsolation,
          motionClass
        });
      });
    }

    return { jobs, strategy, motionClass };
  }

  // ─── Public API ───────────────────────────────────────────────────────────
  return { analyzeVideo, mergeMultiCameraFrames, decimateSlowMo, exportForPipeline, CFG };
})();

window.FumocaMotionAnalyzer = MA;
export default MA;
