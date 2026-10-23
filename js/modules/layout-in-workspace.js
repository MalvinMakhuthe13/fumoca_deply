/**
 * Editor (#viewport) and viewer (#stage).
 * Sections only on layout choice. Video plays, splat stays interactive.
 */
(function () {
  let layout = 'off';

  function host() { return document.getElementById('viewport') || document.getElementById('stage'); }
  function canvas() { return document.getElementById('viewportCanvas') || document.querySelector('#stage canvas'); }

  function pane() {
    const h = host();
    if (!h) return null;
    let p = document.getElementById('fumocaVideoPane');
    if (!p) {
      p = document.createElement('div');
      p.id = 'fumocaVideoPane';
      p.innerHTML = '<div class="fvp-label">VIDEO</div>';
      h.appendChild(p);
    }
    const root = document.getElementById('fumocaReviewRoot');
    if (root && root.parentElement !== p) p.appendChild(root);
    const c = document.getElementById('fumocaReviewControls');
    if (c && root && c.parentElement !== root) root.appendChild(c);
    return p;
  }

  function apply() {
    const p = pane();
    const c = canvas();
    if (!p) return;
    document.body.dataset.fvp = layout === 'off' ? '' : layout;
    if (layout === 'off') { p.style.display = 'none'; if (c) c.style.cssText = ''; return; }
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
    }
    // Play the video
    const vid = p.querySelector('video');
    if (vid) { vid.muted = true; vid.play().catch(() => {}); }
  }

  function setLayout(name) {
    layout = (name === 'hidden' || name === 'off') ? 'off' : name;
    apply();
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-layout]');
    if (!btn) return;
    setLayout(btn.dataset.layout);
  });

  // Viewer: read ?review= and ?rvLayout= from the URL
  function fromUrl() {
    const q = new URLSearchParams(location.search);
    const review = q.get('review');
    const lay = q.get('rvLayout') || 'split';
    if (!review) return;
    const trySet = () => {
      if (window.FumocaReviewVideo?.set) {
        window.FumocaReviewVideo.set(review, { layout: lay });
        setTimeout(() => setLayout(lay), 400);
      }
    };
    trySet();
    [800, 1800, 3000].forEach((ms) => setTimeout(trySet, ms));
  }

  window.addEventListener('load', () => setTimeout(fromUrl, 500));
  window.fumocaSetLayout = setLayout;
})();
