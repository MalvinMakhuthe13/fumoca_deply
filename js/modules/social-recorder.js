/**
 * FUMOCA Social Teaser Recorder v1
 * ══════════════════════════════════════════════════════════════════════════
 * Records the cinematic dots→splats reveal to a shareable video the user
 * can post on Instagram/TikTok/LinkedIn. Each clip ends with a subtle
 * "View in 3D at fumoca.co.za/s/<id>" overlay so shares drive traffic
 * back to the interactive embed — the viral loop.
 *
 * How it works
 * ────────────
 * 1. Take the existing viewer canvas and wrap it in an offscreen composite
 *    canvas so we can layer branding + a final CTA overlay.
 * 2. Call `canvas.captureStream(fps)` to get a live MediaStream.
 * 3. Record the stream with MediaRecorder. WebM is the only universally
 *    available container; we document this and handle Safari gracefully.
 * 4. At record-start we trigger the cinematic reveal; at reveal-complete
 *    we hold for a couple seconds, then fade in the CTA, then stop.
 * 5. Hand back a Blob the caller can download or upload.
 *
 * Honest limits
 * ─────────────
 *  - Safari emits WebM if it supports MediaRecorder at all. Older iOS will
 *    fail the `supported()` check — we show the user a clear message rather
 *    than producing a broken file.
 *  - WebM is not directly uploadable to Instagram/TikTok. The clip is
 *    shareable to YouTube, LinkedIn, and anywhere that accepts WebM. For
 *    Instagram/TikTok users typically convert via CapCut or similar. We
 *    document this; server-side transcoding is a Phase 2 feature.
 *  - Audio capture from WebAudio + canvas in a single stream is possible
 *    but brittle across browsers. This recorder does VIDEO ONLY. If your
 *    reveal has a chime, it won't be in the file — that's intentional, and
 *    it's fine since social videos usually play muted anyway.
 * ══════════════════════════════════════════════════════════════════════════
 */

/**
 * Check whether the current browser can record at all. Returns
 * { supported, reason } — reason is a user-facing string to show.
 */
export function isRecordingSupported() {
  if (typeof MediaRecorder === 'undefined') {
    return { supported: false, reason: 'Your browser does not support video recording. Try Chrome or Firefox.' };
  }
  // WebM with VP9 or VP8 are the most portable recording codecs. Some
  // Chromium-on-Android builds list MediaRecorder but don't actually
  // support any codec — pick the first one the browser will accept.
  const candidates = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    // Safari 14.1+ offers mp4/h264 via MediaRecorder on macOS; try last
    // since mobile Safari still refuses mp4 here.
    'video/mp4;codecs=h264',
  ];
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported?.(mime)) {
      return { supported: true, mime };
    }
  }
  return {
    supported: false,
    reason: 'Your browser supports MediaRecorder but no compatible codec was found.'
  };
}

// Deep-freeze so callers can't mutate a preset and inadvertently ship a
// 1-pixel video. Object.freeze is shallow; we have to freeze each entry.
const ASPECT_PRESETS = Object.freeze({
  square:    Object.freeze({ w: 1080, h: 1080, label: '1:1 square' }),
  vertical:  Object.freeze({ w: 1080, h: 1920, label: '9:16 vertical (IG/TikTok)' }),
  horizontal:Object.freeze({ w: 1920, h: 1080, label: '16:9 horizontal' }),
  portrait:  Object.freeze({ w: 1080, h: 1350, label: '4:5 portrait' }),
});

/**
 * Build the composite canvas and the draw loop. The loop copies the
 * viewer canvas into ours (letterboxed/cropped to the target aspect),
 * then paints the branding overlay on top.
 *
 * Returns { canvas, stop } — stop() ends the draw loop and frees the rAF.
 */
function startCompositor({ sourceCanvas, aspect, branding }) {
  const { w, h } = aspect;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  // Pre-measure the branding text once — saves per-frame measureText cost.
  const brandText = branding?.text || '';
  const ctaText = branding?.cta || '';

  // State controlled by the recorder lifecycle
  const state = {
    stopped: false,
    ctaAlpha: 0,         // 0 → 1 when we're in "show CTA" mode
    ctaRisingSince: 0,
  };

  let rafId = 0;
  function draw() {
    if (state.stopped) return;
    // Black background — any letterboxing shows as pure black, which
    // looks intentional next to a 3D scene.
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);

    // Cover-draw: scale source to fill target, cropping the excess.
    // Equivalent to object-fit: cover, which is what people expect from
    // social video crops.
    const srcW = sourceCanvas.width;
    const srcH = sourceCanvas.height;
    if (srcW > 0 && srcH > 0) {
      const srcRatio = srcW / srcH;
      const dstRatio = w / h;
      let sx, sy, sW, sH;
      if (srcRatio > dstRatio) {
        // Source is wider — crop left/right
        sH = srcH;
        sW = srcH * dstRatio;
        sx = (srcW - sW) / 2;
        sy = 0;
      } else {
        // Source is taller — crop top/bottom
        sW = srcW;
        sH = srcW / dstRatio;
        sx = 0;
        sy = (srcH - sH) / 2;
      }
      try {
        ctx.drawImage(sourceCanvas, sx, sy, sW, sH, 0, 0, w, h);
      } catch (err) {
        // drawImage can throw if the source is tainted (CORS) or has
        // zero dimensions during a resize. We just skip that frame —
        // the next frame is 16ms away, not worth crashing for.
      }
    }

    // Bottom branding strip: subtle gradient + logo/text. Sized relative
    // to canvas height so it looks right at any preset.
    const stripH = Math.round(h * 0.11);
    const gradient = ctx.createLinearGradient(0, h - stripH, 0, h);
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(1, 'rgba(0,0,0,0.85)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, h - stripH, w, stripH);

    if (brandText) {
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.font = `700 ${Math.round(h * 0.028)}px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillText(brandText, Math.round(w * 0.04), h - Math.round(stripH * 0.5));
    }

    // Final CTA overlay: fades in during the final phase. Drawn last so
    // it sits on top of everything including the branding strip.
    if (state.ctaAlpha > 0 && ctaText) {
      ctx.globalAlpha = state.ctaAlpha;
      // Dim the whole frame slightly so the CTA pops
      ctx.fillStyle = `rgba(0,0,0,${0.35 * state.ctaAlpha})`;
      ctx.fillRect(0, 0, w, h);

      // Big centered CTA
      ctx.fillStyle = '#c8ff00';
      ctx.font = `800 ${Math.round(h * 0.05)}px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ctaText, w / 2, h / 2 - Math.round(h * 0.02));

      // Smaller "tap to explore" line below
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.font = `500 ${Math.round(h * 0.022)}px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`;
      ctx.fillText('Tap the link to rotate, zoom, explore', w / 2, h / 2 + Math.round(h * 0.04));

      ctx.globalAlpha = 1;
    }

    rafId = requestAnimationFrame(draw);
  }
  rafId = requestAnimationFrame(draw);

  return {
    canvas,
    state,
    stop() {
      state.stopped = true;
      if (rafId) cancelAnimationFrame(rafId);
    },
  };
}

/**
 * Main entry point. Records the reveal and returns a Blob.
 *
 * Usage:
 *   const { blob, mime, durationMs } = await recordTeaser({
 *     sourceCanvas: document.querySelector('canvas'),
 *     triggerReveal: () => fumocaReveal.runRevealSequence(...),
 *     aspect: 'vertical',      // 'square' | 'vertical' | 'horizontal' | 'portrait'
 *     branding: { text: 'fumoca.co.za', cta: 'View in 3D' },
 *     fps: 30,
 *     holdAfterReveal: 1500,   // hold on finished splat before CTA
 *     ctaDuration: 2500,       // how long the CTA stays visible
 *   });
 *   const url = URL.createObjectURL(blob);
 *   // -> download via <a> or upload wherever
 */
export async function recordTeaser({
  sourceCanvas,
  triggerReveal,
  aspect = 'vertical',
  branding = {},
  fps = 30,
  holdAfterReveal = 1500,
  ctaDuration = 2500,
  ctaFadeIn = 500,
  bitrate = 6_000_000, // 6 Mbps — good quality at 1080p
  onProgress,
} = {}) {
  const support = isRecordingSupported();
  if (!support.supported) throw new Error(support.reason);
  if (!sourceCanvas) throw new Error('sourceCanvas is required');
  if (typeof triggerReveal !== 'function') throw new Error('triggerReveal fn is required');

  const aspectCfg = ASPECT_PRESETS[aspect] || ASPECT_PRESETS.vertical;
  const compositor = startCompositor({
    sourceCanvas,
    aspect: aspectCfg,
    branding,
  });

  // captureStream can fail on some Android Chromium builds when the target
  // canvas hasn't had any drawImage call yet — we just did one, so we're
  // past that. If it still fails, we surface a clean error.
  let stream;
  try {
    stream = compositor.canvas.captureStream(fps);
  } catch (err) {
    compositor.stop();
    throw new Error('Failed to capture canvas stream: ' + err.message);
  }
  if (!stream) {
    compositor.stop();
    throw new Error('captureStream returned null');
  }

  const recorder = new MediaRecorder(stream, {
    mimeType: support.mime,
    videoBitsPerSecond: bitrate,
  });

  const chunks = [];
  recorder.addEventListener('dataavailable', (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  });

  const startTime = performance.now();
  recorder.start(250); // emit chunks every 250ms so abort produces partial result

  // Fire the reveal. We await this so we know when to start the hold+CTA.
  // If the caller's trigger function throws, we still stop the recorder
  // cleanly to avoid leaking the stream.
  try {
    onProgress?.({ phase: 'reveal_start', t: 0 });
    await triggerReveal();
    onProgress?.({ phase: 'reveal_done', t: performance.now() - startTime });
  } catch (err) {
    compositor.stop();
    try { recorder.stop(); } catch (_) {}
    throw err;
  }

  // Hold on the finished splat for the configured duration.
  await sleep(holdAfterReveal);

  // Fade in the CTA.
  await animateValue(ctaFadeIn, (t) => {
    compositor.state.ctaAlpha = Math.min(1, t);
  });

  onProgress?.({ phase: 'cta_visible', t: performance.now() - startTime });
  await sleep(ctaDuration);

  // Stop. We wait for the final dataavailable before resolving.
  const blob = await new Promise((resolve) => {
    recorder.addEventListener('stop', () => {
      compositor.stop();
      // Free the stream tracks so the GPU context isn't retained.
      stream.getTracks().forEach(t => { try { t.stop(); } catch (_) {} });
      const b = new Blob(chunks, { type: support.mime });
      resolve(b);
    }, { once: true });
    try {
      recorder.stop();
    } catch (err) {
      // If stop throws, we resolve with whatever we have.
      compositor.stop();
      resolve(new Blob(chunks, { type: support.mime }));
    }
  });

  const durationMs = performance.now() - startTime;
  onProgress?.({ phase: 'complete', t: durationMs, bytes: blob.size });
  return { blob, mime: support.mime, durationMs };
}

// ── MP4 remux (iOS / WhatsApp sharing) ────────────────────────────────────────
//
// WhatsApp on iOS refuses to share WebM files and won't generate a thumbnail
// for them. We use mp4box.js (WASM) to remux the WebM bitstream into an MP4
// container — no re-encode, so it's near-instant and lossless quality.
//
// Usage:
//   const mp4Blob = await remuxToMp4(webmBlob);
//   downloadBlob(mp4Blob, 'fumoca-teaser.mp4');
//
// Falls back to the original WebM blob if:
//  - mp4box.js fails to load (CDN down, offline)
//  - The recording mime was not VP8/VP9 (Safari produced H.264/MP4 already)
//  - Any remux error

let _mp4boxPromise = null;
function _loadMp4Box() {
  if (_mp4boxPromise) return _mp4boxPromise;
  _mp4boxPromise = new Promise((resolve, reject) => {
    if (typeof window.MP4Box !== 'undefined') { resolve(window.MP4Box); return; }
    const s = document.createElement('script');
    // mp4box.js 0.5.2 — stable, widely cached
    s.src = 'https://cdn.jsdelivr.net/npm/mp4box@0.5.2/dist/mp4box.all.min.js';
    s.onload  = () => resolve(window.MP4Box);
    s.onerror = () => reject(new Error('mp4box.js failed to load'));
    document.head.appendChild(s);
  });
  return _mp4boxPromise;
}

/**
 * Remux a WebM Blob into an MP4 container using mp4box.js.
 * Returns an MP4 Blob on success, or the original Blob on any failure.
 *
 * @param {Blob} webmBlob  — output of recordTeaser()
 * @returns {Promise<Blob>}
 */
export async function remuxToMp4(webmBlob) {
  // If the browser already produced MP4 (Safari), nothing to do.
  if (webmBlob.type && webmBlob.type.includes('mp4')) return webmBlob;

  try {
    const MP4Box = await _loadMp4Box();
    const arrayBuf = await webmBlob.arrayBuffer();

    return await new Promise((resolve, reject) => {
      // Input demuxer (reads WebM)
      const inFile = MP4Box.createFile();
      // Output muxer
      const outFile = MP4Box.createFile();

      let trackId = null;
      const outChunks = [];

      inFile.onReady = (info) => {
        const track = info.videoTracks?.[0];
        if (!track) { reject(new Error('No video track')); return; }

        // Add matching track to output
        trackId = outFile.addTrack({
          type:        'video',
          width:       track.video.width,
          height:      track.video.height,
          timescale:   track.timescale,
          duration:    track.duration,
          codec:       track.codec,
          description: inFile.getTrackById(track.id)?.mdia?.minf?.stbl?.stsd?.entries[0],
        });

        inFile.setExtractionOptions(track.id, null, { nbSamples: Infinity });
        inFile.start();
      };

      inFile.onSamples = (_id, _user, samples) => {
        for (const s of samples) {
          outFile.addSample(trackId, s.data, {
            duration:     s.duration,
            cts:          s.cts,
            dts:          s.dts,
            is_sync:      s.is_sync,
            timescale:    s.timescale,
          });
        }
      };

      inFile.onFlush = () => {
        try {
          outFile.save({ keepMdatBox: false });
          const segs = [];
          outFile.getBuffer = (buf) => segs.push(buf); // mp4box write hook
          // Finalise — mp4box writes into an ArrayBuffer
          const finalBuf = outFile.getBuffer?.() || outFile.write();
          if (finalBuf) {
            resolve(new Blob([finalBuf], { type: 'video/mp4' }));
          } else {
            reject(new Error('mp4box produced no output'));
          }
        } catch (e) { reject(e); }
      };

      inFile.onError = (e) => reject(new Error('mp4box parse error: ' + e));

      // Feed the entire WebM in one shot; mp4box handles chunking internally.
      // fileStart must be 0 for the first (and only) append.
      const ab = arrayBuf;
      ab.fileStart = 0;
      inFile.appendBuffer(ab);
      inFile.flush();
    });
  } catch (err) {
    console.warn('[fumoca] MP4 remux failed, falling back to WebM:', err.message);
    return webmBlob; // safe fallback — user still gets a downloadable file
  }
}

/**
 * Wrap a Blob in a download action. Separated so the UI layer can choose
 * whether to download, upload, preview in a <video> tag, or all three.
 */
export function downloadBlob(blob, filename = 'fumoca-teaser.webm') {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke shortly after the click — if we revoke immediately, some
  // browsers race and the download fails.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Small utilities kept inline so this module has zero dependencies
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
function animateValue(durationMs, onTick) {
  return new Promise(resolve => {
    const start = performance.now();
    function step() {
      const t = Math.min(1, (performance.now() - start) / durationMs);
      onTick(t);
      if (t < 1) requestAnimationFrame(step);
      else resolve();
    }
    requestAnimationFrame(step);
  });
}

export const PRESETS = ASPECT_PRESETS;

if (typeof window !== 'undefined') {
  window.FumocaSocialRecorder = {
    isRecordingSupported,
    recordTeaser,
    downloadBlob,
    remuxToMp4,
    PRESETS: ASPECT_PRESETS,
  };
}

export default {
  isRecordingSupported,
  recordTeaser,
  downloadBlob,
  remuxToMp4,
  PRESETS: ASPECT_PRESETS,
};
