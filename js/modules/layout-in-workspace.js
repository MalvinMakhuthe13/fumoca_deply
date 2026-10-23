/**
 * True section layouts like RealityScan.
 * Stack = workspace splits top/bottom. Split = left/right.
 * Video and splat are siblings in separate sections, never overlays.
 */
(function () {
  function ensureSections() {
    const vp = document.getElementById('viewport') || document.getElementById('stage');
    if (!vp) return null;
    let wrap = document.getElementById('fumocaSections');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'fumocaSections';
      // Move existing canvas/stageHost into the splat section
      const splat = document.createElement('div');
      splat.id = 'fumocaSplatSection';
      const vid = document.createElement('div');
      vid.id = 'fumocaVideoSection';
      // Keep canvas and stageHost inside splat section
      const canvas = document.getElementById('viewportCanvas');
      const stageHost = document.getElementById('stageHost');
      if (canvas) splat.appendChild(canvas);
      if (stageHost) splat.appendChild(stageHost);
      wrap.appendChild(vid);
      wrap.appendChild(splat);
      vp.appendChild(wrap);
    }
    return wrap;
  }

  function apply(layout) {
    const wrap = ensureSections();
    if (!wrap) return;
    const root = document.getElementById('fumocaReviewRoot');
    const vid = document.getElementById('fumocaVideoSection');
    const controls = document.getElementById('fumocaReviewControls');
    wrap.dataset.layout = layout || 'off';
    if (root && vid && root.parentElement !== vid) vid.appendChild(root);
    if (controls && root && controls.parentElement !== root) root.appendChild(controls);
    // Resize the WebGL canvas after the section changes
    setTimeout(() => window.dispatchEvent(new Event('resize')), 60);
  }

  function watch() {
    const body = document.body.className;
    let layout = 'off';
    if (body.includes('rv-layout-stack')) layout = 'stack';
    else if (body.includes('rv-layout-split')) layout = 'split';
    else if (body.includes('rv-layout-pip')) layout = 'pip';
    else if (body.includes('rv-layout-full')) layout = 'full';
    else if (body.includes('rv-layout-bg')) layout = 'bg';
    apply(layout);
  }

  const obs = new MutationObserver(watch);
  obs.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('load', () => setTimeout(watch, 200));
  setInterval(watch, 1200);
  watch();
})();
