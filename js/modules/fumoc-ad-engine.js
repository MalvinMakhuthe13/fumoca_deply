/**
 * FUMOCA Ad Format Engine v85
 * ════════════════════════════════════════════════════════════════════════════
 * Adds two new sections to the .fumoc format:
 *
 *   VIDP — Video payload
 *     A pre-rendered video of the splat (MP4/WebM), baked from a camera
 *     path through the scene. This is what plays on platforms that don't
 *     support interactive 3D (YouTube, TikTok, Instagram, X pre-roll).
 *     Generated automatically from existing tour stops or a custom path.
 *
 *   IPTS — Interactive pause points
 *     An array of authored pause points — timestamps in the video where
 *     the format offers interactivity. Each pause point specifies:
 *       - timestamp (seconds into the video)
 *       - camera position + lookAt at that moment (for splat alignment)
 *       - splat index (for 4D captures — which frozen moment to show)
 *       - trigger mode: 'auto' (pause automatically) | 'hint' (show hint, user pauses)
 *       - hint text: "Drag to explore" | "Rotate the car" | "Walk inside"
 *       - duration: how long the interactive mode stays open before resuming
 *
 * The key insight:
 *   Gaussian splats are frozen moments. A video of a splat is just a guided
 *   tour through that frozen scene. When the video pauses at an authored
 *   point, the viewer is already looking at the splat from the right angle —
 *   so the transition from video to interactive is instantaneous and invisible.
 *   There is no "loading" moment. The splat is already there. The video stops,
 *   the canvas appears underneath, and the viewer can grab and rotate.
 *
 * 4D support:
 *   A 4D capture is a sequence of splats across time. The IPTS section
 *   can reference different splat indices for different pause points —
 *   e.g. pause at t=5s shows splat[0] (morning light), pause at t=15s
 *   shows splat[3] (golden hour). The viewer orbits each frozen moment
 *   independently, then the video advances to the next one.
 *
 * ════════════════════════════════════════════════════════════════════════════
 */

'use strict';

// ── Pause point schema ────────────────────────────────────────────────────────

/**
 * Create a pause point definition.
 *
 * @param {object} opts
 *   timestamp:    number   — seconds into the video (required)
 *   camera:       object   — { position: [x,y,z], lookAt: [x,y,z] }
 *   splatIndex:   number   — which splat in a 4D sequence (default 0)
 *   trigger:      string   — 'auto' | 'hint' | 'gesture'
 *   hintText:     string   — overlay text shown to viewer
 *   duration:     number   — seconds before auto-resuming (0 = wait for user)
 *   label:        string   — internal label for the creator
 *   transitionMs: number   — crossfade duration video→splat in ms (default 400)
 */
function definePausePoint(opts) {
  return {
    timestamp:    opts.timestamp    ?? 0,
    camera:       opts.camera       ?? { position: [0, 1, 5], lookAt: [0, 0, 0] },
    splatIndex:   opts.splatIndex   ?? 0,
    trigger:      opts.trigger      ?? 'auto',
    hintText:     opts.hintText     ?? 'Drag to explore',
    duration:     opts.duration     ?? 0,
    label:        opts.label        ?? `Pause at ${opts.timestamp}s`,
    transitionMs: opts.transitionMs ?? 400,
  };
}

// ── Video baking from tour stops ──────────────────────────────────────────────
//
// Takes the existing tour stops (camera positions + durations) and renders
// the viewer canvas to a video using the MediaRecorder API.
// The result is an MP4/WebM blob that becomes the VIDP section.
//
// This runs in the browser — no server, no ffmpeg, no external tools.
// The viewer canvas is the video source. We record it frame by frame.

/**
 * Bake a video from tour stops using MediaRecorder.
 *
 * @param {object[]} tourStops    — from tour-engine-v80.js
 * @param {object}   options
 *   canvas:       HTMLCanvasElement — the renderer canvas
 *   fps:          number            — target framerate (default 30)
 *   quality:      number            — MediaRecorder bitrate in bps (default 4_000_000 = 4Mbps)
 *   onProgress:   function          — (pct, label) => void
 *   onFrame:      function          — called each frame so the viewer can render
 *
 * @returns Promise<{ blob: Blob, duration: number, pausePoints: object[] }>
 */
async function bakeVideoFromTour(tourStops, options = {}) {
  const {
    canvas,
    fps        = 30,
    quality    = 4_000_000,
    onProgress = null,
    onFrame    = null,
  } = options;

  if (!canvas) throw new Error('[AdEngine] No canvas provided for video baking');
  if (!tourStops?.length) throw new Error('[AdEngine] No tour stops provided');

  // Calculate total duration
  const totalDuration = tourStops.reduce((sum, s) => sum + (s.duration || 3000), 0) / 1000;
  onProgress?.(2, 'Setting up video recorder…');

  // Choose best supported codec
  const mimeTypes = [
    'video/mp4;codecs=h264',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  const mimeType = mimeTypes.find(m => MediaRecorder.isTypeSupported(m)) || 'video/webm';

  const stream   = canvas.captureStream(fps);
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: quality,
  });

  const chunks = [];
  recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

  // Auto-generated pause points (one per tour stop, at the camera arrival moment)
  const pausePoints = [];
  let elapsed = 0;

  recorder.start(100); // collect chunks every 100ms

  // Drive the tour manually so we control timing precisely
  for (let i = 0; i < tourStops.length; i++) {
    const stop    = tourStops[i];
    const stopDur = (stop.duration || 3000) / 1000; // seconds

    onProgress?.(
      5 + Math.round((i / tourStops.length) * 85),
      `Recording stop ${i + 1} of ${tourStops.length}: ${stop.title || ''}`
    );

    // Navigate camera to this stop (tells the viewer to render this angle)
    if (onFrame) {
      await onFrame({
        type:      'navigateTo',
        stop,
        duration:  Math.min(stopDur * 0.4, 1.5), // 40% of stop duration for travel
      });
    }

    // Record the dwell time at this stop
    const dwellStart = performance.now();
    const dwellDur   = stopDur * 0.6 * 1000; // 60% of stop duration dwelling

    await new Promise(resolve => {
      const tick = () => {
        const t = performance.now() - dwellStart;
        onFrame?.({ type: 'render' });
        if (t < dwellDur) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });

    // Record the pause point at the midpoint of the dwell
    pausePoints.push(definePausePoint({
      timestamp:  elapsed + stopDur * 0.5,
      camera:     {
        position: stop.position || [0, 1, 5],
        lookAt:   stop.lookAt   || [0, 0, 0],
      },
      splatIndex: stop.splatIndex ?? 0,
      trigger:    stop.pauseTrigger || 'hint',
      hintText:   stop.hintText    || _defaultHintText(stop),
      duration:   stop.interactiveDuration ?? 0,
      label:      stop.title || `Stop ${i + 1}`,
    }));

    elapsed += stopDur;
  }

  onProgress?.(92, 'Finalising video…');
  recorder.stop();

  const blob = await new Promise(resolve => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
  });

  onProgress?.(100, `Video baked — ${(blob.size / 1048576).toFixed(1)} MB, ${totalDuration.toFixed(1)}s`);

  return { blob, duration: totalDuration, pausePoints, mimeType };
}

function _defaultHintText(stop) {
  const mode = stop.mode || '';
  if (mode === 'vehicle' || mode === 'car')  return 'Drag to rotate the car';
  if (mode === 'real_estate')               return 'Drag to explore the room';
  if (mode === 'product')                   return 'Drag to inspect';
  if (mode === 'person')                    return 'Drag to view from any angle';
  return 'Drag to explore in 3D';
}

/**
 * Build VIDP and IPTS sections from a baked video.
 * These are passed to fumoc-encoder.js alongside the splat data.
 *
 * @param {Blob}     videoBlob    — from bakeVideoFromTour()
 * @param {object[]} pausePoints  — from bakeVideoFromTour()
 * @param {object}   adMeta       — { brand, campaign, cta, ctaUrl, duration }
 *
 * @returns { vidpBytes: Uint8Array, iptsJson: object }
 */
async function buildAdSections(videoBlob, pausePoints, adMeta = {}) {
  const vidpBytes = new Uint8Array(await videoBlob.arrayBuffer());

  const iptsJson = {
    pause_points: pausePoints,
    ad_meta: {
      brand:      adMeta.brand    || null,
      campaign:   adMeta.campaign || null,
      cta_text:   adMeta.ctaText  || 'Learn more',
      cta_url:    adMeta.ctaUrl   || null,
      duration:   adMeta.duration || null,
      created:    new Date().toISOString(),
      format:     'fumoc-ad-v85',
    },
  };

  return { vidpBytes, iptsJson };
}

// ── Encode helper (extends fumoc-encoder) ─────────────────────────────────────

/**
 * Convenience: encode a splat with video ad sections included.
 * Wraps FumocEncoder.encode() and adds VIDP + IPTS.
 */
async function encodeAdFumoc(splatBuffer, videoBlob, pausePoints, options = {}) {
  const FumocEncoder = window.FumocEncoder;
  if (!FumocEncoder) throw new Error('[AdEngine] FumocEncoder not loaded');

  const { vidpBytes, iptsJson } = await buildAdSections(videoBlob, pausePoints, options.adMeta || {});

  return FumocEncoder.encode(splatBuffer, {
    ...options,
    videoPayload: vidpBytes,
    pausePoints:  iptsJson,
  });
}

// ── Public API ─────────────────────────────────────────────────────────────────

const FumocAdEngine = {
  definePausePoint,
  bakeVideoFromTour,
  buildAdSections,
  encodeAdFumoc,
};

window.FumocAdEngine = FumocAdEngine;
export default FumocAdEngine;
