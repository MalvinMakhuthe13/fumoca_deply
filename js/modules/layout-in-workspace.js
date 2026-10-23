/**
 * Safe layouts. Does NOT move the canvas.
 * Video root stays inside #viewport. Hidden until a video is loaded.
 * Never covers the left panel.
 */
(function () {
  function park() {
    const vp = document.getElementById('viewport');
    const root = document.getElementById('fumocaReviewRoot');
    const controls = document.getElementById('fumocaReviewControls');
    // Remove the broken sections wrapper if a previous version created it
    const bad = document.getElementById('fumocaSections');
    if (bad) {
      const canvas = document.getElementById('viewportCanvas');
      const stageHost = document.getElementById('stageHost');
      if (canvas && canvas.parentElement !== vp && vp) vp.appendChild(canvas);
      if (stageHost && stageHost.parentElement !== vp && vp) vp.appendChild(stageHost);
      bad.remove();
    }
    if (!root) return;
    if (vp && root.parentElement !== vp) vp.appendChild(root);
    if (controls && controls.parentElement !== root) root.appendChild(controls);
    // Hide video section when no source
    const vid = root.querySelector('video');
    const has = vid && vid.src && vid.src !== location.href;
    root.style.display = has ? '' : 'none';
  }
  const obs = new MutationObserver(park);
  obs.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('load', () => setTimeout(park, 150));
  setInterval(park, 1000);
  park();
})();
