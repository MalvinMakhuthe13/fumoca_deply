/**
 * FUMOCA Ad Player v85
 * ════════════════════════════════════════════════════════════════════════════
 * The video-first interactive player. This is the core of the ad format.
 *
 * What it does:
 *   1. Plays the VIDP video like a normal video (no friction, no opt-in)
 *   2. At each IPTS pause point, either:
 *      a. Auto-pauses (trigger: 'auto') and activates the splat
 *      b. Shows a drag hint (trigger: 'hint') and activates on first drag
 *      c. Waits for a gesture (trigger: 'gesture') and activates on drag
 *   3. The video canvas crossfades with the splat renderer canvas
 *      — the transition is imperceptible because the splat is already
 *        positioned to match the paused video frame exactly
 *   4. The viewer can orbit, zoom, inspect freely
 *   5. A "Resume" control appears. On tap/click, crossfades back to video.
 *   6. For 4D captures: each pause point loads a different frozen moment
 *      from the splat sequence — the viewer orbits that specific instant.
 *
 * Zero-friction design:
 *   The video starts immediately. No "click to play". No "enter 3D mode".
 *   The hint appears subtly after 2 seconds at a pause point.
 *   First drag gesture activates the splat — no button press required.
 *   On mobile: touch drag. On desktop: mouse drag or scroll.
 *
 * Platform behaviour:
 *   No FUMOCA support (YouTube/TikTok/IG native players):
 *     The VIDP video plays as a normal video ad. Full reach.
 *   FUMOCA embed widget on a website:
 *     Full video-to-interactive experience.
 *   FUMOCA PWA (installed app):
 *     Full experience + .fumoc file handling.
 *   Any app licensing the FUMOCA decoder:
 *     Full experience if they implement the ad player spec.
 *
 * ════════════════════════════════════════════════════════════════════════════
 */

import * as THREE from 'three';

// ── State ─────────────────────────────────────────────────────────────────────

const _s = {
  // Media
  video:          null,   // HTMLVideoElement
  videoBlob:      null,   // Blob (from VIDP section)
  videoUrl:       null,   // blob URL

  // Splat
  splats:         [],     // array of Uint8Array (one per 4D frame, or [0] for static)
  currentSplatIdx: 0,
  splatLoaded:    false,
  gaussians:      null,   // decoded gaussians for current splat

  // Pause points
  pausePoints:    [],
  currentPause:   null,
  pauseActive:    false,

  // Rendering
  renderer:       null,   // THREE renderer
  camera:         null,   // THREE camera
  controls:       null,   // OrbitControls
  scene:          null,

  // State machine
  mode:           'video',  // 'video' | 'transitioning' | 'interactive' | 'resuming'
  adMeta:         {},

  // Interaction tracking
  dragStartX:     0,
  dragStartY:     0,
  isDragging:     false,
  hasDragged:     false,

  // Timing
  hintTimer:      null,
  resumeTimer:    null,
  pauseCheckInterval: null,

  // Callbacks
  onInteract:     null,
  onResume:       null,
  onComplete:     null,
  onCTA:          null,
};

// ── DOM ───────────────────────────────────────────────────────────────────────

function _buildPlayerDOM(container) {
  container.style.cssText += ';position:relative;overflow:hidden;background:#000;';

  // Video element
  const video = document.createElement('video');
  video.style.cssText = `
    position:absolute;inset:0;width:100%;height:100%;object-fit:cover;
    z-index:2;transition:opacity 400ms ease;
  `;
  video.playsInline = true;
  video.muted       = true;  // required for autoplay on mobile
  video.preload     = 'auto';
  container.appendChild(video);

  // Splat canvas (sits behind video, becomes visible during interactive mode)
  const splatCanvas = document.createElement('canvas');
  splatCanvas.style.cssText = `
    position:absolute;inset:0;width:100%;height:100%;
    z-index:1;opacity:0;transition:opacity 400ms ease;
  `;
  container.appendChild(splatCanvas);

  // Drag hint overlay
  const hint = document.createElement('div');
  hint.id = 'fumocAdHint';
  hint.style.cssText = `
    position:absolute;bottom:20px;left:50%;transform:translateX(-50%) translateY(20px);
    z-index:10;background:rgba(5,7,11,.82);border:1px solid rgba(255,255,255,.15);
    backdrop-filter:blur(12px);border-radius:999px;
    padding:9px 20px;font-family:'DM Sans',system-ui;font-size:13px;font-weight:700;
    color:#fff;white-space:nowrap;pointer-events:none;
    opacity:0;transition:opacity .4s ease, transform .4s ease;
    display:flex;align-items:center;gap:8px;
  `;
  hint.innerHTML = `
    <span id="fumocAdHintIcon" style="font-size:16px;">↔</span>
    <span id="fumocAdHintText">Drag to explore</span>
  `;
  container.appendChild(hint);

  // Interactive mode overlay (controls during splat mode)
  const interactiveUI = document.createElement('div');
  interactiveUI.id = 'fumocAdInteractUI';
  interactiveUI.style.cssText = `
    position:absolute;inset:0;z-index:10;pointer-events:none;
    opacity:0;transition:opacity .3s ease;
  `;
  interactiveUI.innerHTML = `
    <style>
      #fumocAdResumeBtn {
        position:absolute;bottom:20px;right:16px;pointer-events:auto;
        background:rgba(200,255,0,.9);border:none;border-radius:999px;
        padding:10px 20px;font-family:'DM Sans',system-ui;font-size:13px;
        font-weight:800;color:#05070b;cursor:pointer;
        transition:transform .15s, background .15s;
      }
      #fumocAdResumeBtn:hover { background:#c8ff00; transform:scale(1.04); }
      #fumocAdCTABtn {
        position:absolute;bottom:20px;left:16px;pointer-events:auto;
        background:rgba(5,7,11,.85);border:1px solid rgba(255,255,255,.2);
        border-radius:999px;padding:10px 20px;font-family:'DM Sans',system-ui;
        font-size:13px;font-weight:700;color:#fff;cursor:pointer;
        transition:background .15s;backdrop-filter:blur(8px);
        display:none;
      }
      #fumocAdCTABtn:hover { background:rgba(255,255,255,.15); }
      #fumocAdModeLabel {
        position:absolute;top:12px;left:12px;
        background:rgba(200,255,0,.15);border:1px solid rgba(200,255,0,.3);
        border-radius:8px;padding:4px 10px;
        font-family:'DM Sans',system-ui;font-size:10px;font-weight:800;
        color:#c8ff00;letter-spacing:.06em;text-transform:uppercase;
      }
      #fumocAd4DLabel {
        position:absolute;top:12px;right:12px;
        background:rgba(5,7,11,.7);border:1px solid rgba(255,255,255,.1);
        border-radius:8px;padding:4px 10px;
        font-family:'DM Sans',system-ui;font-size:10px;color:rgba(255,255,255,.6);
        display:none;
      }
    </style>
    <div id="fumocAdModeLabel">INTERACTIVE</div>
    <div id="fumocAd4DLabel" id="fumocAd4DLabel"></div>
    <button id="fumocAdResumeBtn">▶ Resume</button>
    <button id="fumocAdCTABtn"></button>
  `;
  container.appendChild(interactiveUI);

  // Progress bar (video only, hides in interactive mode)
  const progress = document.createElement('div');
  progress.style.cssText = `
    position:absolute;bottom:0;left:0;right:0;height:3px;
    z-index:8;background:rgba(255,255,255,.15);
  `;
  const progressFill = document.createElement('div');
  progressFill.id = 'fumocAdProgress';
  progressFill.style.cssText = `
    height:100%;width:0%;background:#c8ff00;transition:width .1s linear;
  `;
  progress.appendChild(progressFill);
  container.appendChild(progress);

  return { video, splatCanvas, hint, interactiveUI };
}

// ── Transition: video → interactive ──────────────────────────────────────────

async function _activateInteractive(pausePoint) {
  if (_s.mode !== 'video') return;
  _s.mode        = 'transitioning';
  _s.currentPause = pausePoint;
  _s.pauseActive  = true;

  // Pause video
  _s.video.pause();

  // Snap camera to the exact position matching the pause point
  if (_s.camera && pausePoint.camera) {
    const pos    = pausePoint.camera.position;
    const lookAt = pausePoint.camera.lookAt;
    _s.camera.position.set(pos[0], pos[1], pos[2]);
    if (_s.controls) {
      _s.controls.target.set(lookAt[0], lookAt[1], lookAt[2]);
      _s.controls.update();
    } else {
      _s.camera.lookAt(lookAt[0], lookAt[1], lookAt[2]);
    }
  }

  // For 4D: load the correct splat index
  if (pausePoint.splatIndex !== undefined && pausePoint.splatIndex !== _s.currentSplatIdx) {
    await _loadSplatIndex(pausePoint.splatIndex);
  }

  // Crossfade: video fades out, splat canvas fades in
  const ms = pausePoint.transitionMs || 400;

  // Start rendering the splat
  _startSplatRender();

  // After one frame, begin the crossfade
  await new Promise(r => requestAnimationFrame(r));

  _s.video.style.opacity     = '0';
  _s.splatCanvas.style.opacity = '1';

  // Show interactive UI
  const iui = document.getElementById('fumocAdInteractUI');
  if (iui) {
    iui.style.opacity      = '1';
    iui.style.pointerEvents = 'auto';
  }

  // Show 4D label if relevant
  if (_s.splats.length > 1) {
    const label = document.getElementById('fumocAd4DLabel');
    if (label) {
      label.style.display   = 'block';
      label.textContent     = `Moment ${pausePoint.splatIndex + 1} of ${_s.splats.length}`;
    }
  }

  // Show CTA if configured
  const ctaBtn = document.getElementById('fumocAdCTABtn');
  if (ctaBtn && _s.adMeta.cta_url) {
    ctaBtn.textContent    = _s.adMeta.cta_text || 'Learn more';
    ctaBtn.style.display  = 'block';
    ctaBtn.onclick        = () => {
      _s.onCTA?.(_s.adMeta.cta_url);
      window.open(_s.adMeta.cta_url, '_blank', 'noopener');
    };
  }

  // Enable orbit controls
  if (_s.controls) _s.controls.enabled = true;

  _s.mode = 'interactive';
  _s.onInteract?.(pausePoint);
  window.dispatchEvent(new CustomEvent('fumoca:adInteract', { detail: { pausePoint } }));

  _hideHint();

  // Auto-resume after duration (if set)
  if (pausePoint.duration > 0) {
    _s.resumeTimer = setTimeout(() => resumeVideo(), pausePoint.duration * 1000);
  }
}

// ── Transition: interactive → video ──────────────────────────────────────────

async function resumeVideo() {
  if (_s.mode !== 'interactive') return;
  _s.mode = 'resuming';

  clearTimeout(_s.resumeTimer);

  // Disable orbit controls
  if (_s.controls) _s.controls.enabled = false;

  // Crossfade back to video
  _s.video.style.opacity      = '1';
  _s.splatCanvas.style.opacity = '0';

  // Hide interactive UI
  const iui = document.getElementById('fumocAdInteractUI');
  if (iui) {
    iui.style.opacity       = '0';
    iui.style.pointerEvents = 'none';
  }
  const label = document.getElementById('fumocAd4DLabel');
  if (label) label.style.display = 'none';

  // Stop splat render loop
  _stopSplatRender();

  _s.pauseActive = false;
  _s.currentPause = null;

  // Resume video after crossfade
  await new Promise(r => setTimeout(r, 450));
  _s.video.play().catch(() => {});
  _s.mode = 'video';
  _s.onResume?.();
  window.dispatchEvent(new CustomEvent('fumoca:adResume'));
}

// ── Hint system ───────────────────────────────────────────────────────────────

function _showHint(pausePoint) {
  const hint = document.getElementById('fumocAdHint');
  if (!hint) return;
  document.getElementById('fumocAdHintText').textContent = pausePoint.hintText || 'Drag to explore';
  hint.style.opacity   = '1';
  hint.style.transform = 'translateX(-50%) translateY(0)';
}

function _hideHint() {
  const hint = document.getElementById('fumocAdHint');
  if (!hint) return;
  hint.style.opacity   = '0';
  hint.style.transform = 'translateX(-50%) translateY(20px)';
}

// ── 4D splat loading ──────────────────────────────────────────────────────────

async function _loadSplatIndex(index) {
  if (!_s.splats[index]) return;
  _s.currentSplatIdx = index;

  const FumocDecoder = window.FumocDecoder;
  if (!FumocDecoder) return;

  // Decode the splat for this 4D frame
  const splatBytes = _s.splats[index];
  const blob       = new Blob([splatBytes], { type: 'application/octet-stream' });
  const url        = URL.createObjectURL(blob);

  // Dispatch to viewer's load system
  window.dispatchEvent(new CustomEvent('fumoca:loadUrl', {
    detail: { url, splatIndex: index }
  }));

  // Give the renderer a moment to swap the splat
  await new Promise(r => setTimeout(r, 200));
  URL.revokeObjectURL(url);
}

// ── Splat render loop ─────────────────────────────────────────────────────────

let _renderRafId = null;

function _startSplatRender() {
  if (_renderRafId) return;
  const tick = () => {
    if (_s.mode === 'interactive' || _s.mode === 'transitioning') {
      _s.controls?.update();
      _s.renderer?.render(_s.scene, _s.camera);
      _renderRafId = requestAnimationFrame(tick);
    } else {
      _renderRafId = null;
    }
  };
  _renderRafId = requestAnimationFrame(tick);
}

function _stopSplatRender() {
  if (_renderRafId) { cancelAnimationFrame(_renderRafId); _renderRafId = null; }
}

// ── Pause point monitor ───────────────────────────────────────────────────────

function _startPauseMonitor() {
  _s.pauseCheckInterval = setInterval(() => {
    if (_s.mode !== 'video' || !_s.video || _s.video.paused) return;

    const t = _s.video.currentTime;

    for (const pp of _s.pausePoints) {
      // Already shown this one in this playthrough? Skip.
      if (pp._shown) continue;

      const delta = t - pp.timestamp;

      // Hint zone: 1.5s before the pause point
      if (delta >= -1.5 && delta < 0 && pp.trigger !== 'auto') {
        if (!pp._hintShown) {
          _showHint(pp);
          pp._hintShown = true;
        }
      }

      // Activation zone: within 0.15s of the pause point
      if (Math.abs(delta) < 0.15) {
        pp._shown = true;
        if (pp.trigger === 'auto') {
          _activateInteractive(pp);
        } else if (pp.trigger === 'hint') {
          _showHint(pp);
          // Gesture activates — handled by drag listener
          _s._pendingPausePoint = pp;
        }
      }
    }

    // Update progress bar
    if (_s.video.duration) {
      const pct = (_s.video.currentTime / _s.video.duration) * 100;
      const bar = document.getElementById('fumocAdProgress');
      if (bar) bar.style.width = pct + '%';
    }

  }, 100);
}

// ── Gesture handling ──────────────────────────────────────────────────────────

function _installGestureListeners(container) {
  // Touch
  container.addEventListener('touchstart', e => {
    if (_s.mode === 'interactive') return; // pass to OrbitControls
    _s.dragStartX  = e.touches[0].clientX;
    _s.dragStartY  = e.touches[0].clientY;
    _s.isDragging  = true;
    _s.hasDragged  = false;
  }, { passive: true });

  container.addEventListener('touchmove', e => {
    if (!_s.isDragging) return;
    const dx = Math.abs(e.touches[0].clientX - _s.dragStartX);
    const dy = Math.abs(e.touches[0].clientY - _s.dragStartY);
    if (dx > 8 || dy > 8) {
      _s.hasDragged = true;
      if (_s.mode === 'video' && _s._pendingPausePoint) {
        _activateInteractive(_s._pendingPausePoint);
        _s._pendingPausePoint = null;
      }
    }
  }, { passive: true });

  container.addEventListener('touchend', () => { _s.isDragging = false; }, { passive: true });

  // Mouse
  container.addEventListener('mousedown', e => {
    if (_s.mode === 'interactive') return;
    _s.dragStartX = e.clientX;
    _s.dragStartY = e.clientY;
    _s.isDragging = true;
  });

  container.addEventListener('mousemove', e => {
    if (!_s.isDragging || _s.mode === 'interactive') return;
    const dx = Math.abs(e.clientX - _s.dragStartX);
    const dy = Math.abs(e.clientY - _s.dragStartY);
    if (dx > 8 || dy > 8) {
      if (_s._pendingPausePoint) {
        _activateInteractive(_s._pendingPausePoint);
        _s._pendingPausePoint = null;
      }
    }
  });

  container.addEventListener('mouseup', () => { _s.isDragging = false; });

  // Resume button
  container.addEventListener('click', e => {
    const btn = e.target.closest('#fumocAdResumeBtn');
    if (btn) resumeVideo();
  });
}

// ── Main init ─────────────────────────────────────────────────────────────────

/**
 * Initialise the ad player in a container element.
 *
 * @param {HTMLElement} container  — the div that will contain the player
 * @param {object}      decoded    — from FumocDecoder.decode()
 *   decoded.videoPayload          — VIDP section (Uint8Array)
 *   decoded.pausePoints           — IPTS section
 *   decoded.splats                — array of splat binaries (4D) or single
 *   decoded.header                — file header
 * @param {object}      options
 *   camera:    THREE.Camera
 *   controls:  OrbitControls
 *   renderer:  THREE.WebGLRenderer
 *   scene:     THREE.Scene
 *   onInteract: function
 *   onResume:   function
 *   onComplete: function
 *   onCTA:      function
 */
function init(container, decoded, options = {}) {
  _s.camera   = options.camera   || window._fumocaCamera;
  _s.controls = options.controls || window._fumocaControls;
  _s.renderer = options.renderer || window._fumocaRenderer?._renderer;
  _s.scene    = options.scene    || window._fumocaScene;

  _s.onInteract = options.onInteract || null;
  _s.onResume   = options.onResume   || null;
  _s.onComplete = options.onComplete || null;
  _s.onCTA      = options.onCTA      || null;

  // Parse pause points
  _s.pausePoints = (decoded.pausePoints?.pause_points || []).map(pp => ({ ...pp }));
  _s.adMeta      = decoded.pausePoints?.ad_meta || {};

  // Parse splat(s) — support both single and 4D sequence
  if (Array.isArray(decoded.splats)) {
    _s.splats = decoded.splats;
  } else if (decoded.splatBinary) {
    _s.splats = [decoded.splatBinary];
  } else {
    _s.splats = [];
  }

  // Build DOM
  const { video, splatCanvas } = _buildPlayerDOM(container);
  _s.video       = video;
  _s.splatCanvas = splatCanvas;

  // Point THREE renderer at the splat canvas
  if (_s.renderer) {
    _s.renderer.setSize(container.offsetWidth, container.offsetHeight);
    splatCanvas.replaceWith(_s.renderer.domElement);
    _s.renderer.domElement.style.cssText = splatCanvas.style.cssText;
    _s.splatCanvas = _s.renderer.domElement;
  }

  // Load video
  if (decoded.videoPayload?.length) {
    const mimeType = decoded.header?.video_mime_type || 'video/webm';
    _s.videoBlob   = new Blob([decoded.videoPayload], { type: mimeType });
    _s.videoUrl    = URL.createObjectURL(_s.videoBlob);
    video.src      = _s.videoUrl;
    video.play().catch(() => {});
  }

  // Disable orbit controls initially (video mode)
  if (_s.controls) _s.controls.enabled = false;

  // Install gesture listeners
  _installGestureListeners(container);

  // Start pause point monitor
  _startPauseMonitor();

  // Video end handler
  video.addEventListener('ended', () => {
    _s.onComplete?.();
    // Loop by default
    video.currentTime = 0;
    _s.pausePoints.forEach(pp => { pp._shown = false; pp._hintShown = false; });
    video.play().catch(() => {});
  });

  console.log(`[FumocAdPlayer] Initialised — ${_s.pausePoints.length} pause points, ${_s.splats.length} splat(s)`);
}

/**
 * Programmatically trigger a pause point by index.
 * Useful for demo/preview purposes.
 */
function triggerPausePoint(index) {
  const pp = _s.pausePoints[index];
  if (pp) _activateInteractive(pp);
}

/**
 * Destroy the player and clean up.
 */
function destroy() {
  clearInterval(_s.pauseCheckInterval);
  clearTimeout(_s.resumeTimer);
  clearTimeout(_s.hintTimer);
  _stopSplatRender();
  if (_s.videoUrl) URL.revokeObjectURL(_s.videoUrl);
  _s.video?.pause();
}

/**
 * Get the current player state.
 */
function getState() {
  return {
    mode:           _s.mode,
    currentTime:    _s.video?.currentTime || 0,
    duration:       _s.video?.duration    || 0,
    currentSplat:   _s.currentSplatIdx,
    totalSplats:    _s.splats.length,
    pausePoints:    _s.pausePoints.length,
    adMeta:         _s.adMeta,
  };
}

const FumocAdPlayer = {
  init, resumeVideo, triggerPausePoint, destroy, getState,
};

window.FumocAdPlayer = FumocAdPlayer;
export default FumocAdPlayer;
