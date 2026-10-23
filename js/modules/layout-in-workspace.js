/**
 * Layout buttons work directly.
 * Stack / Split / PIP / Full / BG / Off apply immediately when a video is loaded.
 * Does not move the canvas. Does not cover the left panel.
 */
(function () {
  const LAYOUTS = ['stack', 'split', 'pip', 'full', 'bg', 'cinema', 'hidden', 'off'];

  function root() { return document.getElementById('fumocaReviewRoot'); }
  function controls() { return document.getElementById('fumocaReviewControls'); }

  function park() {
    const vp = document.getElementById('viewport');
    const r = root();
    const c = controls();
    // Undo any broken section wrapper from earlier versions
    const bad = document.getElementById('fumocaSections');
    if (bad) {
      const canvas = document.getElementById('viewportCanvas');
      const stageHost = document.getElementById('stageHost');
      if (canvas && vp) vp.appendChild(canvas);
      if (stageHost && vp) vp.appendChild(stageHost);
      bad.remove();
    }
    if (!r) return;
    if (vp && r.parentElement !== vp) vp.appendChild(r);
    if (c && c.parentElement !== r) r.appendChild(c);
  }

  function setLayout(name) {
    park();
    const r = root();
    if (!r) return;
    const vid = r.querySelector('video');
    const hasVideo = vid && vid.currentSrc && !vid.currentSrc.endsWith('/');
    LAYOUTS.forEach((l) => {
      r.classList.remove('layout-' + l);
      document.body.classList.remove('rv-layout-' + l);
    });
    const layout = name === 'off' ? 'hidden' : name;
    r.classList.add('layout-' + layout);
    document.body.classList.add('rv-layout-' + layout);
    document.body.classList.toggle('rv-active', layout !== 'hidden' && hasVideo);
    r.style.display = (layout === 'hidden' || !hasVideo) ? 'none' : 'block';
    // Tell the official module too, if present
    try { window.FumocaReviewVideo?.setLayout?.(layout); } catch (_) {}
    setTimeout(() => window.dispatchEvent(new Event('resize')), 40);
  }

  // Direct button wiring — works even if the other module misses the click
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-layout]');
    if (!btn) return;
    const name = btn.dataset.layout;
    if (!LAYOUTS.includes(name) && name !== 'off') return;
    setLayout(name);
    document.querySelectorAll('[data-layout]').forEach((b) => {
      b.classList.toggle('active', b === btn);
    });
  });

  const obs = new MutationObserver(park);
  obs.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('load', () => setTimeout(park, 200));
  setInterval(park, 1500);
  park();

  window.fumocaSetLayout = setLayout;
})();
