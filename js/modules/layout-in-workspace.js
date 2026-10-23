/**
 * Keep review video INSIDE #viewport only.
 * Never covers left/right panels or top tools.
 */
(function () {
  function park() {
    const viewport = document.getElementById('viewport');
    if (!viewport) return;
    const root = document.getElementById('fumocaReviewRoot');
    const controls = document.getElementById('fumocaReviewControls');
    if (root && root.parentElement !== viewport) viewport.appendChild(root);
    if (controls && controls.parentElement !== viewport) viewport.appendChild(controls);
    // Kill any leftover floating dock
    const dock = document.getElementById('fumocaPresentDock');
    if (dock) dock.remove();
  }
  const obs = new MutationObserver(park);
  obs.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('fumoca:reviewVideoLocal', () => setTimeout(park, 30));
  window.addEventListener('load', () => setTimeout(park, 100));
  setInterval(park, 800);
  park();
  // Make sure the active left tab body is visible
  const active = document.querySelector('#leftTabs .ptab.active');
  if (active) {
    const name = active.dataset.tab;
    const body = document.getElementById('tab-' + name);
    if (body) body.style.display = 'block';
  }
})();
