/**
 * RealityScan-style multi-pane workspace.
 * Video and splat are real grid cells that share the space.
 * Not overlays. PIP is a free panel you can drag.
 */
(function () {
  function vp() { return document.getElementById('viewport') || document.getElementById('stage'); }

  function setup() {
    const host = vp();
    if (!host || host.dataset.panes) return host;
    host.dataset.panes = '1';
    host.classList.add('fvp-host');

    // Video pane — a real section, sibling of the canvas
    let pane = document.getElementById('fumocaVideoPane');
    if (!pane) {
      pane = document.createElement('div');
      pane.id = 'fumocaVideoPane';
      pane.innerHTML = '<div class="fvp-label">VIDEO</div><div class="fvp-empty">Upload a video in Present</div>';
      host.insertBefore(pane, host.firstChild);
    }

    // Park the review root inside the pane
    const root = document.getElementById('fumocaReviewRoot');
    if (root && root.parentElement !== pane) pane.appendChild(root);
    const controls = document.getElementById('fumocaReviewControls');
    if (controls && root && controls.parentElement !== root) root.appendChild(controls);

    makeDraggable(pane);
    return host;
  }

  function makeDraggable(pane) {
    if (pane.dataset.drag) return;
    pane.dataset.drag = '1';
    let on = false, sx = 0, sy = 0, ox = 0, oy = 0;
    pane.addEventListener('pointerdown', (e) => {
      if (pane.dataset.layout !== 'pip') return;
      if (e.target.closest('button, input, video')) return;
      on = true;
      const r = pane.getBoundingClientRect();
      const p = pane.parentElement.getBoundingClientRect();
      sx = e.clientX; sy = e.clientY;
      ox = r.left - p.left; oy = r.top - p.top;
      pane.setPointerCapture(e.pointerId);
    });
    pane.addEventListener('pointermove', (e) => {
      if (!on) return;
      const p = pane.parentElement.getBoundingClientRect();
      let x = Math.max(0, Math.min(ox + e.clientX - sx, p.width - pane.offsetWidth));
      let y = Math.max(0, Math.min(oy + e.clientY - sy, p.height - pane.offsetHeight));
      pane.style.left = x + 'px';
      pane.style.top = y + 'px';
    });
    pane.addEventListener('pointerup', () => { on = false; });
  }

  function setLayout(name) {
    const host = setup();
    if (!host) return;
    const pane = document.getElementById('fumocaVideoPane');
    const layout = (name === 'off' || name === 'hidden') ? 'off' : name;
    host.dataset.layout = layout;
    if (pane) {
      pane.dataset.layout = layout;
      if (layout !== 'pip') { pane.style.left = ''; pane.style.top = ''; }
    }
    document.body.dataset.fvp = layout;
    try { window.FumocaReviewVideo?.setLayout?.(layout === 'off' ? 'hidden' : layout); } catch (_) {}
    // Force the WebGL canvas to refit its new cell
    setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
      const c = document.getElementById('viewportCanvas');
      if (c && window._fumocaRenderer) {
        try { window._fumocaRenderer.setSize(c.clientWidth, c.clientHeight, false); } catch (_) {}
      }
    }, 80);
    console.log('[FUMOCA] section layout →', layout);
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-layout]');
    if (!btn) return;
    setLayout(btn.dataset.layout);
    document.querySelectorAll('[data-layout]').forEach((b) => b.classList.toggle('active', b === btn));
  });

  window.addEventListener('load', () => setTimeout(setup, 200));
  setInterval(setup, 2000);
  window.fumocaSetLayout = setLayout;
})();
