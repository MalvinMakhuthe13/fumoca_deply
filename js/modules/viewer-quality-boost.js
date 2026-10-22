/**
 * FUMOCA Viewer Quality Boost
 * Stops "sparse blob" look: brighter, slightly larger Gaussians, full transition.
 * Safe no-op if gaussian renderer is missing.
 */
(function () {
  const TARGET = {
    brightness: 1.65,
    contrast: 1.12,
    saturation: 1.08,
    sharpness: 0.68,
    scale: 1.22,
    bloom: 0.08,
  };

  function applyGaussian() {
    const G = window.FumocaGaussianRenderer;
    if (!G?.setQuality) return false;
    try {
      G.setQuality({
        brightness: TARGET.brightness,
        contrast: TARGET.contrast,
        saturation: TARGET.saturation,
        sharpness: TARGET.sharpness,
        bloom: TARGET.bloom,
      });
      // Force solid splat end-state if transition API exists
      if (typeof G.setTransition === 'function') G.setTransition(1);
      if (typeof G.getTransition === 'function' && G.getTransition() < 0.99) {
        G.setTransition?.(1);
      }
      return true;
    } catch (e) {
      console.warn('[viewer-quality-boost] gaussian', e);
      return false;
    }
  }

  function applyMaterialUniforms() {
    const mats = [];
    const pts = window.S?.points;
    if (pts?.material?.uniforms) mats.push(pts.material);
    const nif = window._fumocaNifMesh || window.S?.nifMesh;
    if (nif?.material?.uniforms) mats.push(nif.material);
    // Scan scene
    const scene = window._fumocaScene || window.S?.scene;
    scene?.traverse?.((obj) => {
      if (obj.material?.uniforms?.uBrightness) mats.push(obj.material);
    });

    let n = 0;
    mats.forEach((m) => {
      const u = m.uniforms;
      if (u.uBrightness) { u.uBrightness.value = TARGET.brightness; n++; }
      if (u.uContrast) u.uContrast.value = TARGET.contrast;
      if (u.uSaturation) u.uSaturation.value = TARGET.saturation;
      if (u.uSharpness) u.uSharpness.value = TARGET.sharpness;
      if (u.uScale) u.uScale.value = Math.max(u.uScale.value || 1, TARGET.scale);
      if (u.uTransition) u.uTransition.value = 1;
    });
    return n > 0;
  }

  function applyRenderer() {
    const r =
      window._fumocaRenderer ||
      window.S?.renderer ||
      window._fumocaViewer?.renderer;
    if (!r?.setPixelRatio) return;
    try {
      r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      // Mild tone lift on clear color if pure black
      if (r.getClearColor && r.setClearColor) {
        const c = new (window.THREE || { Color: function(){ this.r=0;this.g=0;this.b=0; } }).Color();
        try { r.getClearColor(c); } catch (_) {}
        // keep black bg but ensure no accidental dark grey crush
      }
    } catch (_) {}
  }

  function applyCssStage() {
    // Subtle lift so dark products read better without washing out
    const shell = document.getElementById('viewerShell') || document.getElementById('stage');
    if (shell) {
      shell.style.filter = shell.style.filter || '';
      // Avoid stacking filters — only set if empty
      if (!shell.style.filter) {
        shell.style.filter = 'contrast(1.06) saturate(1.05) brightness(1.08)';
      }
    }
  }

  function boost() {
    applyRenderer();
    applyGaussian();
    applyMaterialUniforms();
    applyCssStage();
  }

  // Run several times: NIF/PLY often finish after first paint
  function schedule() {
    boost();
    [400, 1200, 2500, 5000].forEach((ms) => setTimeout(boost, ms));
  }

  window.FumocaViewerQualityBoost = { boost, TARGET, schedule };

  if (document.readyState === 'complete') schedule();
  else window.addEventListener('load', schedule);

  // When splat finishes loading
  window.addEventListener('fumoca:splatLoaded', schedule);
  window.addEventListener('fumoca:nifLoaded', schedule);
  document.addEventListener('fumoca:sceneReady', schedule);
})();
