/**
 * True section layouts — video and splat share the workspace, no overlay.
 * PIP is draggable. Works in editor (#viewport) and viewer (#stage).
 */
(function () {
  function host() {
    return document.getElementById('viewport') || document.getElementById('stage') || document.body;
  }

  function park() {
    const root = document.getElementById('fumocaReviewRoot');
    const controls = document.getElementById('fumocaReviewControls');
    if (!root) return;
    const h = host();
    if (root.parentElement !== h) h.appendChild(root);
    if (controls && controls.parentElement !== root) root.appendChild(controls);
    makePipDraggable(root);
    const dock = document.getElementById('fumocaPresentDock');
    if (dock) dock.remove();
  }

  function makePipDraggable(root) {
    if (root.dataset.dragReady) return;
    root.dataset.dragReady = '1';
    let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
    root.addEventListener('pointerdown', (e) => {
      if (!root.classList.contains('layout-pip')) return;
      if (e.target.closest('button, input')) return;
      dragging = true;
      const r = root.getBoundingClientRect();
      const p = root.parentElement.getBoundingClientRect();
      sx = e.clientX; sy = e.clientY;
      ox = r.left - p.left; oy = r.top - p.top;
      root.setPointerCapture(e.pointerId);
    });
    root.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const p = root.parentElement.getBoundingClientRect();
      let x = ox + (e.clientX - sx);
      let y = oy + (e.clientY - sy);
      x = Math.max(0, Math.min(x, p.width - root.offsetWidth));
      y = Math.max(0, Math.min(y, p.height - root.offsetHeight));
      root.style.left = x + 'px';
      root.style.top = y + 'px';
      root.style.right = 'auto';
      root.style.bottom = 'auto';
    });
    root.addEventListener('pointerup', () => { dragging = false; });
  }

  const obs = new MutationObserver(park);
  obs.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('load', () => setTimeout(park, 100));
  setInterval(park, 1000);
  park();
})();
