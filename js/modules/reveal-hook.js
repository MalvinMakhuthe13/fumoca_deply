/**
 * FUMOCA Reveal Integration Hook
 * ══════════════════════════════════════════════════════════════════════════
 * Glue layer between the PLY-loading code in viewer.js and the cinematic
 * reveal module. This exists as a separate file so wiring it up is a single
 * import + single function call in viewer.js — reducing the diff to that
 * large file and making the feature easy to disable by commenting one line.
 *
 * Call site, to be added inside viewerPLY() in viewer.js:
 *
 *     import { triggerRevealForViewer } from './reveal-hook.js';
 *     ...
 *     // after: const pts = new THREE.Points(geo, mat); _plyScene.add(pts);
 *     // after: boundingSphere, camera fitting, hideLoading();
 *     triggerRevealForViewer({ material: mat, pointsMesh: pts });
 * ══════════════════════════════════════════════════════════════════════════
 */

import { runRevealSequence, readRevealConfig } from './cinematic-reveal.js';

/**
 * Fire the reveal for the currently loaded PLY. Safe to call multiple times
 * — the reveal module handles re-entry by clamping and by tracking the
 * patched flag on the material.
 */
export async function triggerRevealForViewer({ material, pointsMesh } = {}) {
  if (!material) {
    console.warn('[FumocaReveal] No material passed to triggerRevealForViewer — skipping');
    return;
  }

  const config = readRevealConfig();
  if (!config.enabled) {
    // Reveal disabled (explicit ?reveal=off or prefers-reduced-motion).
    // Leave the material untouched so clients see the splat immediately.
    return;
  }

  // Find the video element for the video-morph stage. We look for the
  // standard #previewVideo used by teaser-video.js, but the user can
  // point at a different element via ?reveal_video_el=<id> if they want
  // to reveal from a hero video outside the usual preview overlay.
  const params = new URLSearchParams(window.location.search);
  const videoElId = params.get('reveal_video_el') || 'previewVideo';
  const videoEl = document.getElementById(videoElId);

  // Hide the points mesh for the first few frames so the reveal can ramp
  // from zero opacity without a jarring flash. We use `visible=false` so
  // it does not pay the draw cost either.
  if (pointsMesh) {
    pointsMesh.visible = false;
    // Next animation frame, make visible and let the shader handle the rest.
    requestAnimationFrame(() => { pointsMesh.visible = true; });
  }

  try {
    const result = await runRevealSequence({
      material,
      videoEl: config.videoUrl || (videoEl && videoEl.src) ? videoEl : null,
      config,
      splatId: config.splatId,
    });
    console.log('%c[FumocaReveal]', 'color:#c8ff00;font-weight:800',
      'Reveal complete:', result);
  } catch (err) {
    // A broken reveal must never break the viewer. If anything in the
    // reveal throws, we force the material to fully-resolved state and
    // swallow the error. Client sees splat — worst case, no animation.
    console.warn('[FumocaReveal] Reveal sequence failed:', err);
    if (material.uniforms?.uReveal) material.uniforms.uReveal.value = 1;
  }
}

export default { triggerRevealForViewer };
