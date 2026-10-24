/**
 * FUMOCA Viewer Quality Boost v3 — safe (no black-out)
 */
(function () {
  function boost() {
    try {
      const G = window.FumocaGaussianRenderer;
      if (G?.setQuality) {
        G.setQuality({ brightness: 1.45, contrast: 1.08, saturation: 1.05, sharpness: 0.7 });
        G.setTransition?.(1);
      }
    } catch (_) {}
    try {
      const shell = document.getElementById("stageHost") || document.getElementById("viewerShell");
      if (shell && !shell.dataset.qboost) {
        shell.dataset.qboost = "1";
        shell.style.filter = "brightness(1.12) contrast(1.05)";
      }
    } catch (_) {}
  }
  function schedule() {
    boost();
    [500, 1500, 3500].forEach((t) => setTimeout(boost, t));
  }
  window.FumocaViewerQualityBoost = { boost, schedule };
  // Do not recolor or refilter the splat on load. That wash hid the product.
})();
