/**
 * Keep review video inside the editor workspace (#viewport),
 * not covering the full screen or side panels.
 */
(function () {
  function reparent() {
    const viewport = document.getElementById('viewport');
    if (!viewport) return; // viewer — leave full-screen
    const root = document.getElementById('fumocaReviewRoot');
    const controls = document.getElementById('fumocaReviewControls');
    if (root && root.parentElement !== viewport) {
      viewport.appendChild(root);
    }
    if (controls && controls.parentElement !== viewport) {
      viewport.appendChild(controls);
    }
  }
  const obs = new MutationObserver(reparent);
  obs.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('fumoca:reviewVideoLocal', () => setTimeout(reparent, 50));
  window.addEventListener('load', () => setTimeout(reparent, 200));
  setInterval(reparent, 1500);
})();
