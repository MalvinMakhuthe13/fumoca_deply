/**
 * FUMOCA Viewer Quality Boost v2
 * Targets @mkkellogg/gaussian-splats-3d instance + CSS stage lift.
 * Fixes sparse "blob" look on dark backgrounds.
 */
(function () {
  const CSS_FILTER = 'contrast(1.1) saturate(1.12) brightness(1.22)';

  function stageEl() {
    return (
      document.getElementById('stageHost') ||
      document.getElementById('viewerShell') ||
      document.getElementById('stage') ||
      document.querySelector('#stageHost canvas')?.parentElement
    );
  }

  function applyCss() {
    const el = stageEl();
    if (!el) return;
    // Stronger lift for dark product captures
    el.style.filter = CSS_FILTER;
    const canvas = el.querySelector?.('canvas') || document.querySelector('#stageHost canvas, #viewerShell canvas, canvas');
    if (canvas && canvas.style) {
      // slight unsharp via image-rendering default
      canvas.style.imageRendering = 'auto';
    }
  }

  function applyGs3d() {
    const v =
      window.viewerInstance ||
      window._fumocaGsViewer ||
      window._fumocaViewer;
    if (!v) return false;
    try {
      // Some builds expose splat mesh scale
      if (v.splatMesh?.material?.uniforms) {
        const u = v.splatMesh.material.uniforms;
        if (u.devicePixelRatio) u.devicePixelRatio.value = Math.min(window.devicePixelRatio || 1, 2);
      }
      if (typeof v.setRenderMode === 'function') {
        // 0 = full if available
      }
      if (v.renderer?.setPixelRatio) {
        v.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      }
      return true;
    } catch (e) {
      console.warn('[quality-boost] gs3d', e);
      return false;
    }
  }

  function applyGaussianModule() {
    const G = window.FumocaGaussianRenderer;
    if (!G?.setQuality) return false;
    try {
      G.setQuality({
        brightness: 1.75,
        contrast: 1.15,
        saturation: 1.1,
        sharpness: 0.62,
        bloom: 0.06,
      });
      G.setTransition?.(1);
      return true;
    } catch {
      return false;
    }
  }

  function applyMaterialUniforms() {
    const scene = window._fumocaScene || window.S?.scene;
    let n = 0;
    scene?.traverse?.((obj) => {
      const u = obj.material?.uniforms;
      if (!u) return;
      if (u.uBrightness) { u.uBrightness.value = Math.max(u.uBrightness.value || 1, 1.7); n++; }
      if (u.uScale) u.uScale.value = Math.max(u.uScale.value || 1, 1.25);
      if (u.uTransition) u.uTransition.value = 1;
      if (u.uContrast) u.uContrast.value = 1.12;
    });
    return n > 0;
  }

  function boost() {
    applyCss();
    applyGs3d();
    applyGaussianModule();
    applyMaterialUniforms();
  }

  function schedule() {
    boost();
    [300, 800, 1600, 3200, 6000].forEach((ms) => setTimeout(boost, ms));
  }

  window.FumocaViewerQualityBoost = { boost, schedule };
  window.viewerInstance = window.viewerInstance || null;

  // Expose hook when viewer.js sets instance
  const _desc = Object.getOwnPropertyDescriptor(window, 'viewerInstance');
  // Poll for viewerInstance from module scope via custom event
  window.addEventListener('fumoca:viewerReady', schedule);
  window.addEventListener('fumoca:splatLoaded', schedule);
  document.addEventListener('fumoca:sceneReady', schedule);

  if (document.readyState === 'complete') schedule();
  else window.addEventListener('load', schedule);
})();
