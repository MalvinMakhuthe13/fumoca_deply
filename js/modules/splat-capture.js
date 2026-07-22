import r2 from '../r2Client.js';
/**
 * FUMOCA SplatCapture Engine
 * Records the Gaussian Splat "resolve" transition — from particle cloud
 * to sharp solid — and exports it as a shareable video.
 *
 * This is the hook that makes FUMOCA stand out: you see the splat materialise.
 * Like Luma AI's preview videos but driven by the LIVE viewer, not a pre-baked clip.
 *
 * Usage:
 *   SplatCapture.start(options)  → begins recording the canvas
 *   SplatCapture.stop()          → stops, returns Blob/URL + triggers events
 *   SplatCapture.capture()       → still-frame PNG
 *
 * Events emitted on window:
 *   fumoca:captureStarted  { fps, duration }
 *   fumoca:captureStopped  { videoUrl, videoBlob, duration, frames }
 *   fumoca:captureProgress { percent, elapsed }
 *   fumoca:captureReady    { videoUrl, thumbnailUrl, videoBlob }
 *   fumoca:captureError    { error }
 */

const SplatCapture = (() => {
  let recorder = null;
  let chunks = [];
  let startTime = 0;
  let progressTimer = null;
  let _options = {};
  let _resolveBlob = null;
  let _rejectBlob = null;
  let thumbnailDataUrl = null;

  function emit(name, detail = {}) {
    try { window.dispatchEvent(new CustomEvent(name, { detail })); } catch (_) {}
  }

  function findCanvas() {
    // 1. Try the dedicated capture canvas (if set by viewer)
    if (window._fumocaCaptureCanvas instanceof HTMLCanvasElement) return window._fumocaCaptureCanvas;

    // 2. Try the GaussianSplats3D renderer canvas
    const viewerInstance = window._fumocaViewerInstance || window._fumocaViewer?.viewer;
    if (viewerInstance?.renderer?.domElement instanceof HTMLCanvasElement) {
      return viewerInstance.renderer.domElement;
    }

    // 3. Try stageHost canvas
    const stage = document.getElementById('stageHost') || document.getElementById('stage');
    if (stage) {
      const found = stage.querySelector('canvas');
      if (found) return found;
    }

    // 4. Last resort: first canvas on page
    return document.querySelector('canvas');
  }

  function bestMimeType() {
    const types = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
      'video/mp4',
    ];
    return types.find(t => MediaRecorder.isTypeSupported(t)) || '';
  }

  function captureThumbnail(canvas) {
    try {
      return canvas.toDataURL('image/jpeg', 0.85);
    } catch (_) {
      return null;
    }
  }

  /**
   * Start recording the live viewer canvas.
   * @param {object} opts
   *   fps          {number}  — frames per second (default 30)
   *   duration     {number}  — max duration ms (default 5000 = 5s)
   *   videoBitrate {number}  — bits/s (default 4_000_000)
   *   captureOnLoad {bool}   — auto-capture when viewer fires fumoca:viewerReady
   */
  async function start(opts = {}) {
    if (recorder && recorder.state === 'recording') {
      console.warn('[SplatCapture] already recording');
      return;
    }

    _options = {
      fps: opts.fps || 30,
      duration: opts.duration || 5000,
      videoBitrate: opts.videoBitrate || 4_000_000,
      loop: !!opts.loop,
      ...opts,
    };

    const canvas = findCanvas();
    if (!canvas) {
      emit('fumoca:captureError', { error: 'No canvas found to capture.' });
      return Promise.reject(new Error('No canvas found'));
    }

    const mimeType = bestMimeType();
    let stream;
    try {
      stream = canvas.captureStream(_options.fps);
    } catch (err) {
      emit('fumoca:captureError', { error: err.message });
      return Promise.reject(err);
    }

    chunks = [];
    thumbnailDataUrl = null;

    try {
      recorder = new MediaRecorder(stream, {
        mimeType: mimeType || undefined,
        videoBitsPerSecond: _options.videoBitrate,
      });
    } catch (err) {
      emit('fumoca:captureError', { error: err.message });
      return Promise.reject(err);
    }

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType || 'video/webm' });
      const videoUrl = URL.createObjectURL(blob);
      const duration = Date.now() - startTime;
      const frameCount = Math.round(duration / 1000 * _options.fps);
      clearInterval(progressTimer);
      emit('fumoca:captureStopped', { videoUrl, videoBlob: blob, duration, frames: frameCount });
      emit('fumoca:captureReady', {
        videoUrl,
        videoBlob: blob,
        thumbnailUrl: thumbnailDataUrl,
        duration,
        mimeType: mimeType || 'video/webm',
      });
      if (_resolveBlob) _resolveBlob({ videoUrl, videoBlob: blob, thumbnailUrl: thumbnailDataUrl });
      window._fumocaLastCapture = { videoUrl, videoBlob: blob, thumbnailUrl: thumbnailDataUrl, duration, mimeType };
    };

    recorder.onerror = (e) => {
      emit('fumoca:captureError', { error: e?.error?.message || 'MediaRecorder error' });
      if (_rejectBlob) _rejectBlob(e?.error || new Error('MediaRecorder error'));
    };

    startTime = Date.now();

    // Grab thumbnail at start
    setTimeout(() => { thumbnailDataUrl = captureThumbnail(canvas); }, 80);

    recorder.start(200); // collect chunks every 200ms
    emit('fumoca:captureStarted', { fps: _options.fps, duration: _options.duration });

    // Progress events
    progressTimer = setInterval(() => {
      if (!recorder || recorder.state !== 'recording') return;
      const elapsed = Date.now() - startTime;
      const percent = Math.min(100, Math.round((elapsed / _options.duration) * 100));
      emit('fumoca:captureProgress', { percent, elapsed });
    }, 300);

    // Auto-stop after duration
    return new Promise((resolve, reject) => {
      _resolveBlob = resolve;
      _rejectBlob = reject;
      setTimeout(() => {
        if (recorder && recorder.state === 'recording') stop();
      }, _options.duration);
    });
  }

  function stop() {
    if (!recorder) return;
    try {
      if (recorder.state === 'recording') recorder.stop();
    } catch (_) {}
    clearInterval(progressTimer);
  }

  /** Capture a single PNG frame */
  function capture() {
    const canvas = findCanvas();
    if (!canvas) return null;
    try {
      const dataUrl = canvas.toDataURL('image/png');
      window._fumocaLastSnapshot = dataUrl;
      emit('fumoca:snapshotReady', { dataUrl });
      return dataUrl;
    } catch (_) {
      return null;
    }
  }

  /** Download the last captured video */
  function downloadLastVideo(filename = 'fumoca-splat.webm') {
    const last = window._fumocaLastCapture;
    if (!last?.videoUrl) return false;
    const a = document.createElement('a');
    a.href = last.videoUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    return true;
  }

  /** Upload captured video blob to Supabase storage */
  async function uploadToSupabase(bucketName = 'preview-videos', recordId = null) {
    const last = window._fumocaLastCapture;
    const sb = window._fumocaSupabase;
    if (!last?.videoBlob || !sb) return null;
    const ext = last.mimeType?.includes('mp4') ? 'mp4' : 'webm';
    const id = recordId || window._fumocaCurrentRecord?.id || Date.now();
    const path = `${id}/preview.${ext}`;
    try {
      const { publicUrl, error } = await r2.from(bucketName).upload(path, last.videoBlob, {
        contentType: last.mimeType || 'video/webm',
      });
      if (error) throw new Error(error.message);

      // Update splat record with preview video URL
      if (publicUrl && window._fumocaCurrentRecord?.id) {
        try {
          await sb.from('splats').update({ preview_video_url: publicUrl }).eq('id', window._fumocaCurrentRecord.id);
          if (window._fumocaCurrentRecord) window._fumocaCurrentRecord.preview_video_url = publicUrl;
        } catch (_) {}
      }
      emit('fumoca:captureUploaded', { publicUrl, path, bucketName });
      return publicUrl;
    } catch (err) {
      emit('fumoca:captureError', { error: err?.message || 'upload failed' });
      return null;
    }
  }

  /** Auto-capture: waits for viewer ready, then records */
  function autoCaptureOnLoad(opts = {}) {
    const handler = () => {
      setTimeout(() => {
        start({ duration: 6000, fps: 30, ...opts });
      }, opts.delay || 800);
    };
    window.addEventListener('fumoca:viewerReady', handler, { once: true });
  }

  return {
    start,
    stop,
    capture,
    downloadLastVideo,
    uploadToSupabase,
    autoCaptureOnLoad,
    get isRecording() { return !!(recorder && recorder.state === 'recording'); },
    get lastCapture() { return window._fumocaLastCapture || null; },
  };
})();

window._fumocaSplatCapture = SplatCapture;
export default SplatCapture;
