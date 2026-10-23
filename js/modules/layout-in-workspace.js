/**
 * Layouts only activate on button click.
 * Default view is untouched.
 */
(function () {
  let layout = 'off';

  function host() { return document.getElementById('viewport'); }
  function canvas() { return document.getElementById('viewportCanvas'); }

  function pane() {
    const h = host();
    if (!h) return null;
    let p = document.getElementById('fumocaVideoPane');
    if (!p) {
      p = document.createElement('div');
      p.id = 'fumocaVideoPane';
      p.innerHTML = '<div class="fvp-label">VIDEO</div><div class="fvp-empty">Upload a video</div>';
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
    document.body.dataset.fvp = layout === 'off' ? '' : layout;

    if (layout === 'off') {
      p.style.display = 'none';
      if (c) c.style.cssText = '';
      return;
    }

    const base = 'display:block;position:absolute;background:#05070b;overflow:hidden;z-index:6;';
    if (layout === 'stack') {
      p.style.cssText = base + 'top:0;left:0;width:100%;height:50%;border-bottom:3px solid #c8ff00;';
      if (c) c.style.cssText = 'position:absolute;top:50%;left:0;width:100%;height:50%;';
    } else if (layout === 'split') {
      p.style.cssText = base + 'top:0;left:0;width:50%;height:100%;border-right:3px solid #c8ff00;';
      if (c) c.style.cssText = 'position:absolute;top:0;left:50%;width:50%;height:100%;';
    } else if (layout === 'pip') {
      p.style.cssText = base + 'right:16px;bottom:16px;width:300px;height:170px;border-radius:12px;border:2px solid #c8ff00;cursor:grab;z-index:20;';
      if (c) c.style.cssText = '';
    } else if (layout === 'full' || layout === 'cinema') {
      p.style.cssText = base + 'inset:0;width:100%;height:100%;z-index:8;';
      if (c) c.style.visibility = 'hidden';
    } else if (layout === 'bg') {
      p.style.cssText = base + 'inset:0;width:100%;height:100%;z-index:1;opacity:.75;';
      if (c) c.style.cssText = '';
    }
  }

  function setLayout(name) {
    layout = (name === 'hidden' || name === 'off') ? 'off' : name;
    apply();
    console.log('[FUMOCA] layout', layout);
  }

  // PIP drag
  document.addEventListener('pointerdown', (e) => {
    const p = document.getElementById('fumocaVideoPane');
    if (!p || layout !== 'pip' || !p.contains(e.target)) return;
    if (e.target.closest('button,input,video')) return;
    const parent = p.parentElement.getBoundingClientRect();
    const s = { x: e.clientX, y: e.clientY, l: p.offsetLeft, t: p.offsetTop };
    function move(ev) {
      let x = Math.max(0, Math.min(s.l + ev.clientX - s.x, parent.width - p.offsetWidth));
      let y = Math.max(0, Math.min(s.t + ev.clientY - s.y, parent.height - p.offsetHeight));
      p.style.left = x + 'px'; p.style.top = y + 'px';
      p.style.right = 'auto'; p.style.bottom = 'auto';
    }
    function up() { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); }
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  });

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-layout]');
    if (!btn) return;
    setLayout(btn.dataset.layout);
    document.querySelectorAll('[data-layout]').forEach((b) => b.classList.toggle('active', b === btn));
  });

  window.fumocaSetLayout = setLayout;
})();
