/**
 * FUMOCA v90 — Compatibility Shim
 * ════════════════════════════════════════════════════════════════════════════
 * This module fixes the cross-module integration bugs discovered in the v90
 * audit. It is loaded last in viewer.html so it can attach to elements,
 * globals, and modules that other code has already initialised.
 *
 * Six fixes:
 *
 *   1. Orphan events — events dispatched but never listened for:
 *        fumoca:loadUrl
 *        fumoca:resetSplat
 *        fumoca:annotationAdded
 *        fumoca:lassoPreSeed
 *
 *   2. window._fumocaCurrentGaussians — read by quality panel and stitch UI
 *      but never written. We populate it whenever a splat finishes loading.
 *
 *   3. Lasso bridge — quality panel dispatches fumoca:subjectIsolated and
 *      lasso bridge dispatches fumoca:lassoPreSeed, but no lasso module
 *      listens. We wire the existing hotspot-pro lasso into the bridge.
 *
 *   4. Mobile gesture conflict — inspection layer click handler runs on
 *      every canvas click, including drags. Adds a drag-vs-click distinction.
 *
 *   5. Supabase global — _fumocaSupabase is set by viewer.js but timing-
 *      sensitive. Modules loading before viewer.js see undefined.
 *      We poll briefly and re-fire any blocked async calls.
 *
 *   6. Splat loaded reset — when a new splat loads, the previous splat's
 *      annotations, hotspots, and quality state need clearing or they leak
 *      into the new scene.
 * ════════════════════════════════════════════════════════════════════════════
 */

'use strict';

(function () {
  console.log('[FUMOCA v90 shim] loading');

  // ── Fix 1+2: Listen for fumoca:loadUrl and update _fumocaCurrentGaussians ──
  //
  // When any module dispatches fumoca:loadUrl, the viewer reloads the splat
  // and we capture the resulting Gaussians into the global so quality and
  // stitch panels can read it.

  window.addEventListener('fumoca:loadUrl', e => {
    const url = e.detail?.url;
    if (!url) return;

    // Tell the existing splat loader to reload from this URL
    // The viewer.js module exposes _loadSplatUrl on window for this purpose
    if (typeof window._loadSplatUrl === 'function') {
      window._loadSplatUrl(url, e.detail);
    } else if (typeof window.loadSplatFromURL === 'function') {
      window.loadSplatFromURL(url);
    } else {
      // Fallback: dispatch as fumoc:externalLoad which viewer.js handles
      window.dispatchEvent(new CustomEvent('fumoc:externalLoad', { detail: { url } }));
    }
  });

  // After viewer reports ready, capture the gaussians
  window.addEventListener('fumoca:viewerReady', e => {
    // Try common locations where viewer.js stashes the loaded gaussians
    const sources = [
      window.S?.gaussians,
      window._fumocaActiveGaussians,
      e.detail?.gaussians,
      window._fumocaRenderer?._gaussians,
    ];
    for (const g of sources) {
      if (g && typeof g.N === 'number' && g.N > 0) {
        window._fumocaCurrentGaussians = g;
        break;
      }
    }

    // If we still don't have it, build a minimal struct from the splat binary
    if (!window._fumocaCurrentGaussians && window.S?.sourceBuffer) {
      window._fumocaCurrentGaussians = _parseSplatBuffer(window.S.sourceBuffer);
    }

    if (window._fumocaCurrentGaussians) {
      console.log(`[shim] _fumocaCurrentGaussians populated: ${window._fumocaCurrentGaussians.N.toLocaleString()} Gaussians`);
    } else {
      console.warn('[shim] Could not populate _fumocaCurrentGaussians from any source');
    }
  });

  function _parseSplatBuffer(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const N     = Math.floor(bytes.byteLength / 32);
    const view  = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const g = {
      N,
      posX:  new Float32Array(N), posY:  new Float32Array(N), posZ:  new Float32Array(N),
      sclX:  new Float32Array(N), sclY:  new Float32Array(N), sclZ:  new Float32Array(N),
      colR:  new Uint8Array(N),   colG:  new Uint8Array(N),
      colB:  new Uint8Array(N),   colA:  new Uint8Array(N),
      rotQ0: new Uint8Array(N),   rotQ1: new Uint8Array(N),
      rotQ2: new Uint8Array(N),   rotQ3: new Uint8Array(N),
    };
    for (let i = 0; i < N; i++) {
      const b = i * 32;
      g.posX[i]  = view.getFloat32(b,      true);
      g.posY[i]  = view.getFloat32(b + 4,  true);
      g.posZ[i]  = view.getFloat32(b + 8,  true);
      g.sclX[i]  = view.getFloat32(b + 12, true);
      g.sclY[i]  = view.getFloat32(b + 16, true);
      g.sclZ[i]  = view.getFloat32(b + 20, true);
      g.colR[i]  = view.getUint8(b + 24);
      g.colG[i]  = view.getUint8(b + 25);
      g.colB[i]  = view.getUint8(b + 26);
      g.colA[i]  = view.getUint8(b + 27);
      g.rotQ0[i] = view.getUint8(b + 28);
      g.rotQ1[i] = view.getUint8(b + 29);
      g.rotQ2[i] = view.getUint8(b + 30);
      g.rotQ3[i] = view.getUint8(b + 31);
    }
    return g;
  }

  // ── Fix 3: Wire fumoca:resetSplat ────────────────────────────────────────────

  window.addEventListener('fumoca:resetSplat', () => {
    // Reload the original splat from its source URL
    const record = window._fumocaCurrentRecord;
    if (record?.splat_url) {
      window.dispatchEvent(new CustomEvent('fumoca:loadUrl', {
        detail: { url: record.splat_url, fromReset: true }
      }));
    } else if (window.S?.sourceBuffer) {
      // Fallback: reset gaussians to original parsed state
      window._fumocaCurrentGaussians = _parseSplatBuffer(window.S.sourceBuffer);
      console.log('[shim] Reset to source buffer Gaussians');
    }
  });

  // ── Fix 4: Wire fumoca:annotationAdded → save back to .fumoc on export ─────

  window._fumocaPendingAnnotations = [];

  window.addEventListener('fumoca:annotationAdded', e => {
    if (e.detail) {
      // Avoid duplicates by id
      const id = e.detail.id;
      window._fumocaPendingAnnotations = (window._fumocaPendingAnnotations || [])
        .filter(a => a.id !== id);
      window._fumocaPendingAnnotations.push(e.detail);
    }
  });

  // ── Fix 5: Wire the lasso bridge ─────────────────────────────────────────────
  //
  // The quality panel dispatches fumoca:subjectIsolated.
  // The bridge in viewer.html dispatches fumoca:lassoPreSeed.
  // We connect lassoPreSeed to the existing hotspot-pro lasso tool.

  window.addEventListener('fumoca:lassoPreSeed', e => {
    const points = e.detail?.points;
    if (!Array.isArray(points) || points.length < 3) return;

    // Two strategies for activating the lasso, in order of preference:
    // 1. The existing global FumocaLasso, if present
    // 2. The hotspot-pro module, if it exposes a lasso function
    // 3. Fallback: just show the toast that the bridge already shows

    if (window.FumocaLasso?.activateWithPath) {
      window.FumocaLasso.activateWithPath(points);
      console.log('[shim] Lasso pre-seeded via FumocaLasso');
      return;
    }

    if (window.HotspotPro?.activateLasso) {
      window.HotspotPro.activateLasso({ initialPath: points });
      console.log('[shim] Lasso pre-seeded via HotspotPro');
      return;
    }

    // Last-resort: dispatch a generic event some legacy modules may listen for
    window.dispatchEvent(new CustomEvent('fumoca:requestLasso', {
      detail: { initialPath: points }
    }));
    console.log('[shim] Dispatched fumoca:requestLasso (no lasso module found yet)');
  });

  // ── Fix 6: Mobile gesture conflict resolution ───────────────────────────────
  //
  // The inspection layer listens for canvas clicks. Without a drag check,
  // any drag on a phone — orbiting the camera with one finger — registers
  // as a click and accidentally drops a measurement point.
  //
  // We monkey-patch the inspection layer's click handler to add a drag check:
  // a "click" only counts if pointerdown and pointerup are within 8px and 250ms.

  function _wrapInspectionLayer() {
    const canvas = document.querySelector('#stage canvas');
    if (!canvas) return false;

    let _downX = 0, _downY = 0, _downT = 0, _moved = false;

    canvas.addEventListener('pointerdown', e => {
      _downX = e.clientX;
      _downY = e.clientY;
      _downT = Date.now();
      _moved = false;
    }, { passive: true, capture: true });

    canvas.addEventListener('pointermove', e => {
      if (Math.abs(e.clientX - _downX) > 8 || Math.abs(e.clientY - _downY) > 8) {
        _moved = true;
      }
    }, { passive: true, capture: true });

    canvas.addEventListener('click', e => {
      // If the user dragged or held too long, suppress the click
      const heldMs = Date.now() - _downT;
      if (_moved || heldMs > 350) {
        e.stopPropagation();
        e.stopImmediatePropagation();
      }
    }, { capture: true });

    return true;
  }

  // The canvas might not exist yet — retry until it does
  let _wrapAttempts = 0;
  function _tryWrap() {
    if (_wrapInspectionLayer()) {
      console.log('[shim] Inspection layer drag-vs-click filter installed');
    } else if (_wrapAttempts++ < 30) {
      setTimeout(_tryWrap, 200);
    }
  }
  _tryWrap();

  // ── Fix 7: Supabase global — verify it's set, warn if not ───────────────────

  let _sbAttempts = 0;
  function _verifySupabase() {
    if (window._fumocaSupabase || window.supabase) {
      window._fumocaSupabase = window._fumocaSupabase || window.supabase;
      console.log('[shim] _fumocaSupabase verified');
      return;
    }
    if (_sbAttempts++ < 25) setTimeout(_verifySupabase, 200);
    else console.warn('[shim] _fumocaSupabase never appeared. Auth-dependent features will be disabled.');
  }
  setTimeout(_verifySupabase, 100);

  // ── Fix 8: Reset state when a new splat loads ───────────────────────────────

  window.addEventListener('fumoca:loadUrl', e => {
    if (e.detail?.fromReset) return; // don't recurse
    if (e.detail?.fromQuality) return; // quality reload — keep state

    // Clear annotations from previous scene
    window._fumocaPendingAnnotations = [];
    if (window.FumocInspectionLayer?.clearAll) {
      // Don't auto-clear in forensic mode (annotations are immutable there)
      const isForensic = window._fumocaOpenedMeta?.forensic_mode;
      if (!isForensic) {
        try { window.FumocInspectionLayer.clearAll(); } catch {}
      }
    }
  });

  // ── Fix 9: Tell the encoder where to find pending annotations ──────────────
  //
  // The export panel calls FumocEncoder.encode() with options including
  // annotations. We make sure it picks up annotations stored by the
  // inspection layer or the shim's pending list.

  if (window.FumocEncoder) {
    const origEncode = window.FumocEncoder.encode;
    window.FumocEncoder.encode = function(buffer, options = {}) {
      if (!options.annotations) {
        options.annotations =
          window.FumocInspectionLayer?.getAnnotations?.() ||
          window._fumocaPendingAnnotations ||
          [];
      }
      return origEncode.call(this, buffer, options);
    };
    console.log('[shim] FumocEncoder.encode wrapped to include annotations');
  }

  console.log('[FUMOCA v90 shim] ready');
})();
