/**
 * video-interactive.js — FUMOC Video ↔ Interactive Bridge
 * ═══════════════════════════════════════════════════════════════════════════
 * Manages the transition between video playback mode and full interactive
 * 3D mode. Also handles time-synced hotspots that appear at specific
 * timestamps during video playback.
 *
 * Flow:
 *   1. .fumoc file loaded — if VIDP section present, show video player
 *   2. Video plays orbital preview with time-synced hotspot overlays
 *   3. User taps anywhere on video → smooth crossfade to interactive 3D
 *   4. Camera picks up at the exact position the video was at
 *   5. Hotspots continue to work in interactive mode
 *
 * Video hotspot schema (stored in HOTS section, videoTime field):
 *   {
 *     id: "hs_001",
 *     label: "Kitchen",
 *     type: "info",
 *     videoTime: 2.4,          ← appears at 2.4s in video
 *     videoEndTime: 4.0,       ← disappears at 4.0s (optional)
 *     worldPos: [x, y, z],     ← 3D position for interactive mode
 *     screenX: 0.45,           ← 0-1 normalized screen position in video
 *     screenY: 0.38,
 *     description: "...",
 *     link: "https://...",
 *   }
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { VidpEncoder } from './vidp-encoder.js';

const VideoInteractive = (() => {

  // ── State ─────────────────────────────────────────────────────────────────
  let _state = {
    mode:          'idle',    // 'idle' | 'video' | 'transitioning' | 'interactive'
    videoEl:       null,
    fumocBuffer:   null,
    hotspots:      [],        // all hotspots (video-timed + interactive)
    videoMeta:     null,
    overlayEl:     null,
    videoContainer:null,
    onEnterInteractive: null,
  };

  // ── Initialise ─────────────────────────────────────────────────────────────
  function init(opts = {}) {
    _state.onEnterInteractive = opts.onEnterInteractive || null;

    // Listen for fumoc file loaded events
    window.addEventListener('fumoca:viewerReady', e => {
      const buffer = window._fumocaRawBuffer;
      if (buffer) _checkForVidp(buffer);
    });

    // Listen for direct buffer load
    window.addEventListener('fumoca:bufferLoaded', e => {
      if (e.detail?.buffer) {
        _state.fumocBuffer = e.detail.buffer;
        _checkForVidp(e.detail.buffer);
      }
    });
  }

  // ── Check for VIDP section ─────────────────────────────────────────────────
  function _checkForVidp(buffer) {
    const result = VidpEncoder.extractVideoUrl(buffer);
    if (!result) return;
    _state.videoMeta   = result.meta;
    _state.fumocBuffer = buffer;
    _showVideoMode(result.url, result.meta);
  }

  // ── Build video player UI ──────────────────────────────────────────────────
  function _showVideoMode(videoUrl, meta) {
    // Remove existing if any
    document.getElementById('fumoca-video-shell')?.remove();

    const shell = document.createElement('div');
    shell.id = 'fumoca-video-shell';
    Object.assign(shell.style, {
      position: 'fixed', inset: '0', zIndex: '200',
      background: '#000', display: 'flex',
      flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    });

    // Video element
    const video = document.createElement('video');
    video.src      = videoUrl;
    video.autoplay = true;
    video.loop     = true;
    video.muted    = true;
    video.playsInline = true;
    video.preload  = 'auto';
    Object.assign(video.style, {
      width: '100%', height: '100%', objectFit: 'contain',
      cursor: 'pointer',
    });
    _state.videoEl = video;

    // Hotspot overlay
    const overlay = document.createElement('div');
    overlay.id = 'fumoca-video-hotspot-overlay';
    Object.assign(overlay.style, {
      position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '5',
    });
    _state.overlayEl = overlay;

    // "Tap for interactive" hint
    const hint = document.createElement('div');
    Object.assign(hint.style, {
      position: 'absolute', bottom: '32px', left: '50%',
      transform: 'translateX(-50%)',
      background: 'rgba(5,7,11,0.75)',
      border: '1px solid rgba(200,255,0,0.4)',
      borderRadius: '99px', padding: '10px 20px',
      color: '#c8ff00', fontSize: '13px', fontWeight: '700',
      fontFamily: 'system-ui,sans-serif',
      letterSpacing: '.06em', textTransform: 'uppercase',
      pointerEvents: 'none', backdropFilter: 'blur(8px)',
      animation: 'vidHintPulse 2s ease-in-out infinite',
    });
    hint.textContent = '↑ Tap anywhere to explore in 3D';

    // Inject CSS animation
    if (!document.getElementById('fumoca-video-css')) {
      const style = document.createElement('style');
      style.id = 'fumoca-video-css';
      style.textContent = `
        @keyframes vidHintPulse {
          0%,100% { opacity:.6; transform:translateX(-50%) translateY(0); }
          50%     { opacity:1;  transform:translateX(-50%) translateY(-4px); }
        }
        @keyframes vidHotspotPop {
          0%   { opacity:0; transform:translate(-50%,-50%) scale(.5); }
          70%  { transform:translate(-50%,-50%) scale(1.12); }
          100% { opacity:1; transform:translate(-50%,-50%) scale(1); }
        }
        @keyframes vidHotspotOut {
          to { opacity:0; transform:translate(-50%,-50%) scale(.7); }
        }
        .fumoca-vid-hs {
          position:absolute; transform:translate(-50%,-50%);
          background:rgba(5,7,11,.82); border:2px solid rgba(200,255,0,.9);
          border-radius:999px; padding:6px 14px;
          color:#fff; font-size:12px; font-weight:700;
          font-family:system-ui,sans-serif; white-space:nowrap;
          cursor:pointer; pointer-events:auto;
          box-shadow:0 0 0 6px rgba(200,255,0,.12);
          animation:vidHotspotPop .35s ease forwards;
        }
        .fumoca-vid-hs::before {
          content:''; position:absolute; inset:-8px; border-radius:999px;
          border:1px solid rgba(200,255,0,.3);
          animation:vidHotspotPulse 1.6s ease-out infinite;
        }
        @keyframes vidHotspotPulse {
          from { transform:scale(.8); opacity:.7; }
          to   { transform:scale(1.6); opacity:0; }
        }
        .fumoca-vid-hs[data-type="link"] { border-color:rgba(255,184,0,.9); }
        .fumoca-vid-hs[data-type="audio"]{ border-color:rgba(0,255,200,.9); }
        #fumoca-video-shell .crossfade-out {
          animation:vidCrossfade .6s ease forwards;
        }
        @keyframes vidCrossfade {
          to { opacity:0; transform:scale(1.04); }
        }
      `;
      document.head.appendChild(style);
    }

    // Tap anywhere → switch to interactive
    shell.addEventListener('click', _enterInteractive);

    shell.appendChild(video);
    shell.appendChild(overlay);
    shell.appendChild(hint);
    document.body.appendChild(shell);
    _state.videoContainer = shell;
    _state.mode = 'video';

    // Start hotspot time-sync loop
    _startHotspotSync();

    // Attempt play (browsers may block autoplay with sound — already muted)
    video.play().catch(() => {});
  }

  // ── Time-synced hotspot rendering ──────────────────────────────────────────
  function _startHotspotSync() {
    const video   = _state.videoEl;
    const overlay = _state.overlayEl;
    if (!video || !overlay) return;

    // Get hotspots that have videoTime set
    const vidHotspots = _state.hotspots.filter(h => typeof h.videoTime === 'number');
    const activeHsEls = new Map(); // id → DOM element

    function sync() {
      if (_state.mode !== 'video') return;
      const t = video.currentTime;

      for (const h of vidHotspots) {
        const start = h.videoTime;
        const end   = h.videoEndTime ?? (start + 2.5);
        const visible = t >= start && t <= end;

        if (visible && !activeHsEls.has(h.id)) {
          // Create hotspot marker
          const el = document.createElement('div');
          el.className    = 'fumoca-vid-hs';
          el.dataset.type = h.type || 'info';
          el.textContent  = h.label || h.title || '●';
          el.style.left   = (h.screenX ?? 0.5) * 100 + '%';
          el.style.top    = (h.screenY ?? 0.5) * 100 + '%';
          el.addEventListener('click', ev => {
            ev.stopPropagation();
            _enterInteractiveAtHotspot(h);
          });
          overlay.appendChild(el);
          activeHsEls.set(h.id, el);
        } else if (!visible && activeHsEls.has(h.id)) {
          // Fade out and remove
          const el = activeHsEls.get(h.id);
          el.style.animation = 'vidHotspotOut .25s ease forwards';
          setTimeout(() => el.remove(), 280);
          activeHsEls.delete(h.id);
        }
      }

      requestAnimationFrame(sync);
    }

    requestAnimationFrame(sync);
  }

  // ── Load hotspots from .fumoc buffer ───────────────────────────────────────
  async function loadHotspots(buffer) {
    const bytes = new Uint8Array(buffer);
    const dv    = new DataView(buffer);
    if (!new TextDecoder().decode(bytes.slice(0,6)).startsWith('FUMOC')) return;
    const headerLen = dv.getUint32(10, true);
    let off = 14 + headerLen;
    while (off + 13 <= bytes.length) {
      const id      = new TextDecoder().decode(bytes.slice(off, off+4));
      const flags   = bytes[off+4];
      const compLen = dv.getUint32(off+5, true);
      if (id === 'HOTS') {
        let data = bytes.slice(off+13, off+13+compLen);
        if (flags & 0x01) {
          const ds = new DecompressionStream('deflate');
          const w  = ds.writable.getWriter(); w.write(data); w.close();
          const chunks = []; const r = ds.readable.getReader();
          for (;;) { const {done,value} = await r.read(); if (done) break; chunks.push(value); }
          const total = chunks.reduce((n,c)=>n+c.length,0);
          data = new Uint8Array(total); let o=0;
          for (const c of chunks) { data.set(c,o); o+=c.length; }
        }
        try {
          _state.hotspots = JSON.parse(new TextDecoder().decode(data));
        } catch(_) {}
      }
      off += 13 + compLen;
    }
  }

  // ── Enter interactive mode ─────────────────────────────────────────────────
  function _enterInteractive(e) {
    if (_state.mode !== 'video') return;
    _state.mode = 'transitioning';

    // Get current video time for camera position estimation
    const videoTime   = _state.videoEl?.currentTime || 0;
    const duration    = _state.videoMeta?.duration || 6;
    const t           = videoTime / duration;
    const startTheta  = Math.PI * 0.25;
    const sweepAngle  = Math.PI * 1.8;
    const theta       = startTheta + sweepAngle * t;

    // Crossfade animation
    _state.videoContainer.classList.add('crossfade-out');

    setTimeout(() => {
      _state.videoContainer.remove();
      _state.videoContainer = null;
      _state.mode = 'interactive';

      // Set viewer camera to match video position
      _applyCameraTheta(theta);

      // Notify caller
      _state.onEnterInteractive?.({ theta, t });

      // Dispatch global event
      window.dispatchEvent(new CustomEvent('fumoca:enteredInteractive', { detail: { theta, t } }));

      // Render hotspots in interactive mode
      window.dispatchEvent(new CustomEvent('fumoca:renderHotspots', {
        detail: { hotspots: _state.hotspots }
      }));
    }, 600);
  }

  function _enterInteractiveAtHotspot(hotspot) {
    if (_state.mode !== 'video') return;
    _state.mode = 'transitioning';
    _state.videoContainer.classList.add('crossfade-out');
    setTimeout(() => {
      _state.videoContainer?.remove();
      _state.videoContainer = null;
      _state.mode = 'interactive';
      // Fly to the hotspot's world position
      if (hotspot.worldPos) {
        window.dispatchEvent(new CustomEvent('fumoca:flyToPosition', {
          detail: { pos: hotspot.worldPos, label: hotspot.label }
        }));
      }
      _state.onEnterInteractive?.({ hotspot });
      window.dispatchEvent(new CustomEvent('fumoca:enteredInteractive', { detail: { hotspot } }));
    }, 600);
  }

  function _applyCameraTheta(theta) {
    if (window._fumocPlayerRenderer) {
      window._fumocPlayerRenderer._theta = theta;
      window._fumocPlayerRenderer._updateEye?.();
    }
    if (window._fumocaViewerControls?.setAzimuthalAngle) {
      window._fumocaViewerControls.setAzimuthalAngle(theta);
      window._fumocaViewerControls.update?.();
    }
  }

  // ── Public: manually trigger video mode ───────────────────────────────────
  function showVideo(fumocBuffer) {
    _state.fumocBuffer = fumocBuffer;
    loadHotspots(fumocBuffer);
    _checkForVidp(fumocBuffer);
  }

  // ── Public: set hotspots ──────────────────────────────────────────────────
  function setHotspots(hotspots) {
    _state.hotspots = Array.isArray(hotspots) ? hotspots : [];
  }

  // ── Public: get current mode ──────────────────────────────────────────────
  function getMode() { return _state.mode; }

  return { init, showVideo, setHotspots, getMode, loadHotspots };
})();

export default VideoInteractive;
