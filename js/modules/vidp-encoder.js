/**
 * vidp-encoder.js — FUMOC VIDP Section Encoder
 * ═══════════════════════════════════════════════════════════════════════════
 * Records an orbital fly-around of the 3D scene directly from the viewer
 * canvas using the MediaRecorder API, then packages the result as a VIDP
 * section that can be written into a .fumoc file.
 *
 * The VIDP section makes a .fumoc file play as a video on WhatsApp, iMessage,
 * email — any platform that doesn't know about 3D. FUMOC-aware apps detect
 * the fumoc1 ftyp brand and switch to full interactive mode.
 *
 * Architecture:
 *   1. Take the live viewer canvas and composite it with branding overlay
 *   2. Drive the camera through a smooth orbital path (azimuth sweep)
 *   3. Record via MediaRecorder → WebM chunks → single Blob
 *   4. Package as VIDP section bytes
 *   5. Return { vidpBytes, duration, mimeType, stats }
 *
 * Usage:
 *   import { VidpEncoder } from './vidp-encoder.js';
 *   const result = await VidpEncoder.record({ duration: 6, fps: 30, quality: 'high' });
 *   // result.vidpBytes → Uint8Array ready for fumoc-encoder.js videoPayload
 * ═══════════════════════════════════════════════════════════════════════════
 */

export const VidpEncoder = (() => {

  // ── Browser capability check ─────────────────────────────────────────────
  function isSupported() {
    if (typeof MediaRecorder === 'undefined') return { ok: false, reason: 'MediaRecorder not available. Use Chrome or Firefox.' };
    const candidates = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
      'video/mp4;codecs=h264',
      'video/mp4',
    ];
    for (const mime of candidates) {
      if (MediaRecorder.isTypeSupported?.(mime)) return { ok: true, mime };
    }
    return { ok: false, reason: 'No supported video codec found. Try Chrome.' };
  }

  // ── Pick best recording MIME ─────────────────────────────────────────────
  function bestMime() {
    const candidates = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
      'video/mp4;codecs=h264',
      'video/mp4',
    ];
    for (const mime of candidates) {
      if (MediaRecorder.isTypeSupported?.(mime)) return mime;
    }
    return 'video/webm';
  }

  // ── Get viewer canvas ────────────────────────────────────────────────────
  function getViewerCanvas() {
    // Try Three.js renderer canvas first
    const threeCanvas = document.querySelector('canvas[data-engine], canvas.three-canvas');
    if (threeCanvas) return threeCanvas;
    // Fall back to any canvas in the viewer
    const canvases = document.querySelectorAll('canvas');
    for (const c of canvases) {
      if (c.width > 200 && c.height > 200) return c;
    }
    return null;
  }

  // ── Build composite canvas with branding overlay ─────────────────────────
  function buildCompositeCanvas(sourceCanvas, opts) {
    const W = opts.width  || sourceCanvas.width  || 1280;
    const H = opts.height || sourceCanvas.height || 720;
    const composite = document.createElement('canvas');
    composite.width  = W;
    composite.height = H;
    const ctx = composite.getContext('2d');

    function drawFrame() {
      // Draw viewer frame
      ctx.drawImage(sourceCanvas, 0, 0, W, H);

      // Subtle vignette
      const vign = ctx.createRadialGradient(W/2, H/2, H*0.3, W/2, H/2, H*0.8);
      vign.addColorStop(0, 'rgba(0,0,0,0)');
      vign.addColorStop(1, 'rgba(0,0,0,0.35)');
      ctx.fillStyle = vign;
      ctx.fillRect(0, 0, W, H);

      // .fumoc badge bottom-left
      ctx.font = `bold ${Math.round(H*0.022)}px system-ui, sans-serif`;
      ctx.fillStyle = 'rgba(200,255,0,0.75)';
      ctx.fillText('.fumoc', H*0.025, H - H*0.025);

      // FUMOCA watermark bottom-right
      ctx.font = `${Math.round(H*0.018)}px system-ui, sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      const brand = 'fumoca.pages.dev';
      const bw = ctx.measureText(brand).width;
      ctx.fillText(brand, W - bw - H*0.025, H - H*0.025);
    }

    return { composite, drawFrame };
  }

  // ── Orbital camera driver ────────────────────────────────────────────────
  // Drives the viewer camera through a smooth azimuth sweep using the
  // same eye/target/theta state exposed by FumocaGaussianRenderer or
  // the GaussianSplats3D viewer instance.
  function buildOrbitalDriver(durationMs, opts = {}) {
    const startTheta = opts.startTheta ?? Math.PI * 0.25;
    const sweepAngle = opts.sweepAngle ?? (Math.PI * 1.8); // 324° sweep
    const elevationWave = opts.elevationWave ?? true;
    let startTime = null;

    function tick(now) {
      if (!startTime) startTime = now;
      const t = Math.min(1, (now - startTime) / durationMs);
      // Ease in/out
      const eased = t < 0.5 ? 2*t*t : -1 + (4 - 2*t)*t;
      const theta = startTheta + sweepAngle * eased;
      // Gentle elevation wave
      const phi = elevationWave
        ? Math.PI/2 - Math.sin(t * Math.PI) * 0.28
        : Math.PI/2;
      return { theta, phi, t };
    }

    function applyToRenderer(theta, phi) {
      // Try standalone fumoc-player renderer
      if (window._fumocPlayerRenderer) {
        window._fumocPlayerRenderer._theta = theta;
        window._fumocPlayerRenderer._phi   = phi;
        window._fumocPlayerRenderer._updateEye();
        return true;
      }
      // Try FumocaGaussianRenderer exposed controls
      if (window._fumocaViewerControls) {
        const ctrl = window._fumocaViewerControls;
        // OrbitControls: set spherical coords
        if (ctrl.setAzimuthalAngle && ctrl.setPolarAngle) {
          ctrl.setAzimuthalAngle(theta);
          ctrl.setPolarAngle(phi);
          ctrl.update?.();
          return true;
        }
        // GaussianSplats3D viewer — set theta/phi directly
        if (typeof ctrl.theta !== 'undefined') {
          ctrl.theta = theta;
          ctrl.phi   = phi;
          return true;
        }
      }
      // Try GaussianSplats3D viewer instance
      if (window.viewerInstance?.orbitControls) {
        const oc = window.viewerInstance.orbitControls;
        if (oc.setAzimuthalAngle) {
          oc.setAzimuthalAngle(theta);
          oc.setPolarAngle(phi);
          oc.update?.();
          return true;
        }
      }
      return false;
    }

    return { tick, applyToRenderer };
  }

  // ── Main record function ─────────────────────────────────────────────────
  /**
   * Record an orbital fly-around and return VIDP section bytes.
   *
   * @param {object} opts
   *   duration    {number}   seconds — default 6
   *   fps         {number}   frames per second — default 30
   *   width       {number}   output width — default 720 (portrait for social)
   *   height      {number}   output height — default 1280
   *   quality     {string}   'low'|'medium'|'high' — default 'medium'
   *   sweepAngle  {number}   radians to sweep — default Math.PI*1.8
   *   onProgress  {function} (pct, label) callback
   *   onFrame     {function} called each frame with t (0-1)
   *
   * @returns Promise<{ vidpBytes: Uint8Array, duration: number, mimeType: string, stats: object }>
   */
  async function record(opts = {}) {
    const {
      duration    = 6,
      fps         = 30,
      width       = 720,
      height      = 1280,
      quality     = 'medium',
      sweepAngle  = Math.PI * 1.8,
      onProgress  = null,
      onFrame     = null,
    } = opts;

    const cap = isSupported();
    if (!cap.ok) throw new Error(cap.reason);

    const sourceCanvas = getViewerCanvas();
    if (!sourceCanvas) throw new Error('No viewer canvas found — viewer must be open and rendering');

    onProgress?.(2, 'Preparing recording…');

    const { composite, drawFrame } = buildCompositeCanvas(sourceCanvas, { width, height });

    // Bitrate by quality
    const bitrateMap = { low: 1_500_000, medium: 4_000_000, high: 8_000_000 };
    const videoBitsPerSecond = bitrateMap[quality] || bitrateMap.medium;
    const mime = bestMime();

    // Capture stream from composite canvas
    const stream = composite.captureStream(fps);
    const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond });

    const chunks = [];
    recorder.ondataavailable = e => { if (e.data?.size > 0) chunks.push(e.data); };

    const durationMs = duration * 1000;
    const driver = buildOrbitalDriver(durationMs, { sweepAngle });

    onProgress?.(5, 'Recording orbital fly-around…');

    return new Promise((resolve, reject) => {
      recorder.onerror = e => reject(new Error('MediaRecorder error: ' + (e.error?.message || e)));

      recorder.onstop = async () => {
        try {
          onProgress?.(88, 'Assembling video…');
          const blob   = new Blob(chunks, { type: mime });
          const vidBuf = await blob.arrayBuffer();
          const vidpBytes = buildVidpSection(new Uint8Array(vidBuf), {
            duration, width, height, fps, mime,
          });
          onProgress?.(98, 'VIDP section ready');
          resolve({
            vidpBytes,
            duration,
            mimeType: mime,
            blobUrl: URL.createObjectURL(blob),
            stats: {
              bytes:    vidBuf.byteLength,
              duration,
              mime,
              width, height, fps,
            },
          });
        } catch (e) { reject(e); }
      };

      recorder.start(200); // 200ms chunks for smooth progress

      let frameNum  = 0;
      const totalFrames = Math.ceil(durationMs / (1000 / fps));

      function renderFrame(now) {
        const { theta, phi, t } = driver.tick(now);
        driver.applyToRenderer(theta, phi);
        drawFrame();
        onFrame?.(t);

        frameNum++;
        const pct = 5 + Math.round(t * 80);
        if (frameNum % 15 === 0) onProgress?.(pct, `Recording… ${Math.round(t*100)}%`);

        if (t >= 1) {
          // Hold last frame for 0.5s then stop
          setTimeout(() => recorder.stop(), 500);
        } else {
          requestAnimationFrame(renderFrame);
        }
      }

      requestAnimationFrame(renderFrame);
    });
  }

  // ── Build VIDP section bytes ─────────────────────────────────────────────
  function buildVidpSection(videoBytes, meta) {
    // VIDP section: JSON meta header + raw video bytes
    // Decoder checks for meta to understand codec/dimensions
    const metaObj = {
      codec:    meta.mime?.includes('mp4') ? 'h264' : 'vp9',
      container: meta.mime?.includes('mp4') ? 'mp4' : 'webm',
      duration: meta.duration,
      width:    meta.width,
      height:   meta.height,
      fps:      meta.fps,
      ftype:    'fumoc1',  // custom ftyp brand for FUMOC-aware apps
    };
    const metaJson = new TextEncoder().encode(JSON.stringify(metaObj));
    const buf = new Uint8Array(4 + metaJson.length + videoBytes.length);
    const dv  = new DataView(buf.buffer);
    dv.setUint32(0, metaJson.length, true);
    buf.set(metaJson,  4);
    buf.set(videoBytes, 4 + metaJson.length);
    return buf;
  }

  // ── Embed VIDP into existing .fumoc file ─────────────────────────────────
  /**
   * Takes an existing .fumoc ArrayBuffer and adds/replaces the VIDP section.
   * Returns a new ArrayBuffer with the VIDP section appended.
   */
  async function embedInFumoc(fumocBuffer, vidpBytes) {
    const bytes = new Uint8Array(fumocBuffer);
    const dv    = new DataView(fumocBuffer);

    // Parse header length
    const magic = new TextDecoder().decode(bytes.slice(0, 6));
    if (!magic.startsWith('FUMOC')) throw new Error('Not a .fumoc file');
    const headerLen = dv.getUint32(10, true);

    // Find and remove existing VIDP section if present
    let writeEnd = 14 + headerLen;
    const keepSections = [];
    let off = 14 + headerLen;
    while (off + 13 <= bytes.length) {
      const id      = new TextDecoder().decode(bytes.slice(off, off+4));
      const flags   = bytes[off+4];
      const compLen = dv.getUint32(off+5, true);
      if (id !== 'VIDP') {
        keepSections.push(bytes.slice(off, off + 13 + compLen));
      }
      off += 13 + compLen;
    }

    // Build VIDP section header
    const vidpId    = new TextEncoder().encode('VIDP');
    const vidpFlags = new Uint8Array([0x04]); // raw, not deflated
    const vidpComp  = new Uint8Array(4); new DataView(vidpComp.buffer).setUint32(0, vidpBytes.length, true);
    const vidpRaw   = new Uint8Array(4); new DataView(vidpRaw.buffer).setUint32(0, vidpBytes.length, true);
    const vidpSection = concat([vidpId, vidpFlags, vidpComp, vidpRaw, vidpBytes]);

    // Update file-level flags to set bit 0x0001 (has video)
    const newBytes = new Uint8Array(fumocBuffer);
    const fileFlagsOld = dv.getUint16(8, true);
    new DataView(newBytes.buffer).setUint16(8, fileFlagsOld | 0x0001, true);

    // Reassemble
    const header = newBytes.slice(0, 14 + headerLen);
    const parts  = [header, ...keepSections, vidpSection];
    return concat(parts).buffer;
  }

  function concat(arrays) {
    const total = arrays.reduce((s,a)=>s+a.length,0);
    const out   = new Uint8Array(total);
    let   off   = 0;
    for (const a of arrays) { out.set(a, off); off+=a.length; }
    return out;
  }

  // ── VIDP Playback helper ─────────────────────────────────────────────────
  /**
   * Extract VIDP bytes from a .fumoc buffer and return a blob URL for playback.
   */
  function extractVideoUrl(fumocBuffer) {
    const bytes = new Uint8Array(fumocBuffer);
    const dv    = new DataView(fumocBuffer);
    if (!new TextDecoder().decode(bytes.slice(0,6)).startsWith('FUMOC')) return null;
    const headerLen = dv.getUint32(10, true);
    let off = 14 + headerLen;
    while (off + 13 <= bytes.length) {
      const id      = new TextDecoder().decode(bytes.slice(off, off+4));
      const compLen = dv.getUint32(off+5, true);
      if (id === 'VIDP') {
        const payload  = bytes.slice(off+13, off+13+compLen);
        const metaLen  = new DataView(payload.buffer, payload.byteOffset, 4).getUint32(0, true);
        const metaJson = JSON.parse(new TextDecoder().decode(payload.slice(4, 4+metaLen)));
        const vidBytes = payload.slice(4+metaLen);
        const mime     = metaJson.container === 'mp4' ? 'video/mp4' : 'video/webm';
        const blob     = new Blob([vidBytes], { type: mime });
        return { url: URL.createObjectURL(blob), meta: metaJson };
      }
      off += 13 + compLen;
    }
    return null;
  }

  return { isSupported, record, embedInFumoc, extractVideoUrl, buildVidpSection };

})();

export default VidpEncoder;
