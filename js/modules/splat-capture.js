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

  // Capture the composed poster, not only the WebGL canvas. Poster typography
  // and supporting artwork are DOM layers above/around the renderer canvas.
  function createCaptureSurface(sourceCanvas, fps) {
    const stage = sourceCanvas.closest?.('#stageHost, #stage, [data-fumoca-poster-viewport]')
      || document.getElementById('stageHost')
      || document.getElementById('stage');
    const posterRoot = stage?.querySelector?.('[data-fumoca-poster-canvas]')
      || stage?.querySelector?.('#magazineTextLayer, [data-fumoca-poster-assets]')
      || null;
    if (!stage || !posterRoot) {
      return { canvas: sourceCanvas, stop() {} };
    }

    const bounds = stage.getBoundingClientRect();
    const ratio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round((bounds.width || sourceCanvas.clientWidth || sourceCanvas.width) * ratio));
    canvas.height = Math.max(1, Math.round((bounds.height || sourceCanvas.clientHeight || sourceCanvas.height) * ratio));
    const ctx = canvas.getContext('2d');
    if (!ctx) return { canvas: sourceCanvas, stop() {} };

    const relativeRect = (el) => {
      const r = el.getBoundingClientRect();
      return {
        x: (r.left - bounds.left) * ratio,
        y: (r.top - bounds.top) * ratio,
        w: r.width * ratio,
        h: r.height * ratio,
      };
    };
    const visible = (el) => {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity || 1) > 0 && r.width > 0 && r.height > 0;
    };
    const drawImageElement = (el, rect) => {
      if (!(el instanceof HTMLImageElement) || !el.complete || !el.naturalWidth) return;
      const style = getComputedStyle(el);
      const fit = style.objectFit || 'fill';
      if (fit === 'contain' || fit === 'cover') {
        const iw = el.naturalWidth, ih = el.naturalHeight;
        const scale = fit === 'cover' ? Math.max(rect.w / iw, rect.h / ih) : Math.min(rect.w / iw, rect.h / ih);
        const dw = iw * scale, dh = ih * scale;
        ctx.save();
        ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.w, rect.h); ctx.clip();
        ctx.drawImage(el, rect.x + (rect.w - dw) / 2, rect.y + (rect.h - dh) / 2, dw, dh);
        ctx.restore();
      } else {
        ctx.drawImage(el, rect.x, rect.y, rect.w, rect.h);
      }
    };
    const wrapText = (text, maxWidth, font) => {
      ctx.font = font;
      const lines = [];
      for (const paragraph of String(text || '').split(/\\n/)) {
        const words = paragraph.split(/\\s+/).filter(Boolean);
        if (!words.length) { lines.push(''); continue; }
        let line = '';
        for (const word of words) {
          const next = line ? line + ' ' + word : word;
          if (line && ctx.measureText(next).width > maxWidth) { lines.push(line); line = word; }
          else line = next;
        }
        lines.push(line);
      }
      return lines;
    };
    const drawTextElement = (el, rect) => {
      const style = getComputedStyle(el);
      const text = (el.innerText || el.textContent || '').trim();
      if (!text) return;
      const fontSize = Math.max(1, parseFloat(style.fontSize) || 16) * ratio;
      const font = [style.fontStyle, style.fontVariant, style.fontWeight, fontSize + 'px', style.fontFamily].filter(Boolean).join(' ');
      const lineHeightCss = parseFloat(style.lineHeight);
      const lineHeight = (Number.isFinite(lineHeightCss) ? lineHeightCss : fontSize / ratio * 1.2) * ratio;
      const padL = (parseFloat(style.paddingLeft) || 0) * ratio;
      const padR = (parseFloat(style.paddingRight) || 0) * ratio;
      const padT = (parseFloat(style.paddingTop) || 0) * ratio;
      const maxWidth = Math.max(1, rect.w - padL - padR);
      const lines = wrapText(text, maxWidth, font);
      const align = style.textAlign === 'start' ? 'left' : style.textAlign === 'end' ? 'right' : style.textAlign;
      ctx.save();
      ctx.globalAlpha = Number(style.opacity || 1);
      ctx.font = font;
      ctx.fillStyle = style.color || '#fff';
      ctx.textAlign = ['left','right','center'].includes(align) ? align : 'left';
      ctx.textBaseline = 'top';
      const letterSpacing = parseFloat(style.letterSpacing) || 0;
      const totalHeight = lines.length * lineHeight;
      let y = rect.y + padT + Math.max(0, (rect.h - padT - totalHeight) / 2);
      for (const line of lines) {
        const x = ctx.textAlign === 'center' ? rect.x + rect.w / 2 : ctx.textAlign === 'right' ? rect.x + rect.w - padR : rect.x + padL;
        if (letterSpacing && line.length < 240) {
          let cursor = x;
          const chars = [...line];
          if (ctx.textAlign === 'center') cursor -= (ctx.measureText(line).width + letterSpacing * chars.length) / 2;
          if (ctx.textAlign === 'right') cursor -= ctx.measureText(line).width + letterSpacing * chars.length;
          for (const char of chars) { ctx.fillText(char, cursor, y); cursor += ctx.measureText(char).width + letterSpacing * ratio; }
        } else ctx.fillText(line, x, y, maxWidth);
        y += lineHeight;
      }
      ctx.restore();
    };

    let stopped = false;
    let raf = 0;
    const draw = () => {
      if (stopped) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const stageStyle = getComputedStyle(stage);
      ctx.fillStyle = stageStyle.backgroundColor && stageStyle.backgroundColor !== 'rgba(0, 0, 0, 0)' ? stageStyle.backgroundColor : '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Poster background sits behind the live 3D render.
      const bg = stage.querySelector('[data-fumoca-poster-background]');
      if (bg && visible(bg)) {
        const br = relativeRect(bg);
        const bs = getComputedStyle(bg);
        if (bs.backgroundColor && bs.backgroundColor !== 'rgba(0, 0, 0, 0)') {
          ctx.fillStyle = bs.backgroundColor; ctx.fillRect(br.x, br.y, br.w, br.h);
        }
        const bgImg = bg.querySelector('img');
        if (bgImg) drawImageElement(bgImg, relativeRect(bgImg));
      }

      const cr = relativeRect(sourceCanvas);
      try { ctx.drawImage(sourceCanvas, cr.x, cr.y, cr.w, cr.h); } catch (_) {}

      // Draw editorial headline, independent text layers, then supporting images.
      const title = stage.querySelector('[data-fumoca-poster-title]');
      if (title && visible(title)) drawTextElement(title, relativeRect(title));
      stage.querySelectorAll('#magazineTextLayer > *, #magazineTextLayer [data-magazine-text-id]').forEach((el) => {
        if (visible(el) && !el.matches('[data-fpe-control],button,input,textarea,select')) drawTextElement(el, relativeRect(el));
      });
      stage.querySelectorAll('[data-fumoca-poster-assets] img').forEach((img) => {
        const wrapper = img.closest('[data-poster-asset-id]') || img;
        if (visible(wrapper) && visible(img)) drawImageElement(img, relativeRect(img));
      });
      raf = requestAnimationFrame(draw);
    };
    draw();
    return {
      canvas,
      stop() { stopped = true; if (raf) cancelAnimationFrame(raf); },
    };
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

    const surface = createCaptureSurface(canvas, _options.fps);
    const captureCanvas = surface.canvas;
    const mimeType = bestMimeType();
    let stream;
    try {
      stream = captureCanvas.captureStream(_options.fps);
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
      surface.stop();
      try { stream.getTracks().forEach(track => track.stop()); } catch (_) {}
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
    setTimeout(() => { thumbnailDataUrl = captureThumbnail(captureCanvas); }, 80);

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
    const sourceCanvas = findCanvas();
    if (!sourceCanvas) return null;
    const surface = createCaptureSurface(sourceCanvas, 1);
    try {
      const dataUrl = surface.canvas.toDataURL('image/png');
      surface.stop();
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
          await sb.from('nif_files').update({
            meta: { ...(window._fumocaCurrentRecord.meta || {}), preview_video_url: publicUrl }
          }).eq('id', window._fumocaCurrentRecord.id);
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
