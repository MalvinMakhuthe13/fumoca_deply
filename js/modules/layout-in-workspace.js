/**
 * Review video stays inside #viewport.
 * Play/pause controls live ON the video, not floating elsewhere.
 */
(function () {
  function park() {
    const viewport = document.getElementById('viewport');
    const root = document.getElementById('fumocaReviewRoot');
    const controls = document.getElementById('fumocaReviewControls');
    if (!root) return;

    // In editor: keep root inside the center workspace
    if (viewport && root.parentElement !== viewport) {
      viewport.appendChild(root);
    }
    // Controls always inside the video pane
    if (controls && controls.parentElement !== root) {
      root.appendChild(controls);
    }
    const dock = document.getElementById('fumocaPresentDock');
    if (dock) dock.remove();
  }
  const obs = new MutationObserver(park);
  obs.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('fumoca:reviewVideoLocal', () => setTimeout(park, 30));
  window.addEventListener('load', () => setTimeout(park, 100));
  setInterval(park, 800);
  park();
})();
