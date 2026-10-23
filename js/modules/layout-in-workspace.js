/**
 * Layouts always show a visible section.
 * Click Split/Stack and the workspace divides immediately.
 * Video fills its half when loaded.
 */
(function () {
  function ensure() {
    const vp = document.getElementById('viewport');
    if (!vp) return null;
    let pane = document.getElementById('fumocaVideoPane');
    if (!pane) {
      pane = document.createElement('div');
      pane.id = 'fumocaVideoPane';
      pane.innerHTML = '<div class="fvp-empty">Upload a video in Present</div>';
      vp.appendChild(pane);
    }
    // Move the real review root into the pane if it exists
    const root = document.getElementById('fumocaReviewRoot');
    if (root && root.parentElement !== pane) pane.appendChild(root);
    const controls = document.getElementById('fumocaReviewControls');
    if (controls && root && controls.parentElement !== root) root.appendChild(controls);
    return pane;
  }

  function setLayout(name) {
    const pane = ensure();
    if (!pane) return;
    const layout = (name === 'off' || name === 'hidden') ? 'off' : name;
    pane.dataset.layout = layout;
    document.body.dataset.fvp = layout;
    // Also tag the official root so its own CSS can cooperate
    const root = document.getElementById('fumocaReviewRoot');
    if (root) {
      root.className = root.className.replace(/layout-\w+/g, '').trim();
      root.classList.add('layout-' + (layout === 'off' ? 'hidden' : layout));
    }
    try { window.FumocaReviewVideo?.setLayout?.(layout === 'off' ? 'hidden' : layout); } catch (_) {}
    setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
    console.log('[FUMOCA] layout →', layout);
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-layout]');
    if (!btn) return;
    e.stopPropagation();
    setLayout(btn.dataset.layout);
    document.querySelectorAll('[data-layout]').forEach((b) => b.classList.toggle('active', b === btn));
  });

  window.addEventListener('load', () => setTimeout(ensure, 300));
  setInterval(ensure, 1500);
  window.fumocaSetLayout = setLayout;
})();
