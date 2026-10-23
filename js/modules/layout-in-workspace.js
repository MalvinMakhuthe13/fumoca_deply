/**
 * Sections only show when a video is loaded. No empty black boxes.
 */
(function () {
  let layout = 'off';

  function host() { return document.getElementById('viewport') || document.getElementById('stage'); }
  function canvas() { return document.getElementById('viewportCanvas') || document.querySelector('#stage canvas'); }
  function video() {
    const p = document.getElementById('fumocaVideoPane');
    return p ? p.querySelector('video') : document.querySelector('#fumocaReviewRoot video');
  }
  function hasVideo() {
    const v = video();
    return !!(v && v.currentSrc && v.currentSrc.length > 8);
  }

  function pane() {
    const h = host();
    if (!h) return null;
    let p = document.getElementById('fumocaVideoPane');
    if (!p) {
      p = document.createElement('div');
      p.id = 'fumocaVideoPane';
      h.appendChild(p);
    }
    const root = document.getElementById('fumocaReviewRoot');
    if (root && root.parentElement !== p) p.appendChild(root);
    return p;
  }

  function apply() {
    const p = pane();
    const c = canvas();
    if (!p) return;
    if (layout === 'off' || !hasVideo()) {
      p.style.display = 'none';
      if (c) c.style.cssText = '';
      return;
    }
    const base = 'display:block;position:absolute;background:#000;overflow:hidden;z-index:6;';
    if (layout === 'stack') {
      p.style.cssText = base + 'top:0;left:0;width:100%;height:50%;';
      if (c) c.style.cssText = 'position:absolute;top:50%;left:0;width:100%;height:50%;';
    } else if (layout === 'split') {
      p.style.cssText = base + 'top:0;left:0;width:50%;height:100%;';
      if (c) c.style.cssText = 'position:absolute;top:0;left:50%;width:50%;height:100%;';
    } else if (layout === 'pip') {
      p.style.cssText = base + 'right:16px;bottom:16px;width:300px;height:170px;border-radius:12px;z-index:20;cursor:grab;';
      if (c) c.style.cssText = '';
    } else if (layout === 'full' || layout === 'cinema') {
      p.style.cssText = base + 'inset:0;width:100%;height:100%;z-index:8;';
    } else if (layout === 'bg') {
      p.style.cssText = base + 'inset:0;width:100%;height:100%;z-index:1;opacity:.8;';
      if (c) c.style.cssText = '';
    }
    const v = video();
    if (v) { v.muted = true; v.play().catch(() => {}); }
  }

  window.fumocaSetLayout = function (name) {
    layout = (name === 'hidden' || name === 'off') ? 'off' : name;
    apply();
  };

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-layout]');
    if (!btn) return;
    window.fumocaSetLayout(btn.dataset.layout);
  });

  // Re-apply when a video actually loads
  const obs = new MutationObserver(() => { if (layout !== 'off') apply(); });
  window.addEventListener('load', () => {
    const h = host();
    if (h) obs.observe(h, { childList: true, subtree: true, attributes: true });
  });
})();
