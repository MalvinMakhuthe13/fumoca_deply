/**
 * Layouts enforced with inline styles so nothing can override them.
 * PIP is draggable.
 */
(function () {
  let layout = 'off';

  function host() { return document.getElementById('viewport') || document.getElementById('stage'); }

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
    const c = document.getElementById('fumocaReviewControls');
    if (c && root && c.parentElement !== root) root.appendChild(c);
    return p;
  }

  function apply() {
    const h = host();
    const p = pane();
    const canvas = document.getElementById('viewportCanvas');
    if (!h || !p) return;

    // Reset
    p.style.cssText = '';
    if (canvas) canvas.style.cssText = '';

    if (layout === 'off') {
      p.style.display = 'none';
      return;
    }

    const base = 'position:absolute;background:#05070b;overflow:hidden;z-index:6;border:0;';

    if (layout === 'stack') {
      p.style.cssText = base + 'top:0;left:0;right:0;width:100%;height:50%;border-bottom:3px solid #c8ff00;';
      if (canvas) canvas.style.cssText = 'position:absolute;top:50%;left:0;width:100%;height:50%;';
    } else if (layout === 'split') {
      p.style.cssText = base + 'top:0;left:0;bottom:0;width:50%;height:100%;border-right:3px solid #c8ff00;';
      if (canvas) canvas.style.cssText = 'position:absolute;top:0;left:50%;width:50%;height:100%;';
    } else if (layout === 'pip') {
      p.style.cssText = base + 'right:16px;bottom:16px;width:300px;height:170px;border-radius:12px;border:2px solid #c8ff00;cursor:grab;z-index:20;box-shadow:0 12px 36px rgba(0,0,0,.6);';
      if (canvas) canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
    } else if (layout === 'full' || layout === 'cinema') {
      p.style.cssText = base + 'inset:0;width:100%;height:100%;z-index:8;';
      if (canvas) canvas.style.visibility = 'hidden';
    } else if (layout === 'bg') {
      p.style.cssText = base + 'inset:0;width:100%;height:100%;z-index:1;opacity:.8;';
    }
    p.style.display = 'block';
  }

  function setLayout(name) {
    layout = (name === 'hidden') ? 'off' : name;
    apply();
    try { window.FumocaReviewVideo?.setLayout?.(layout === 'off' ? 'hidden' : layout); } catch (_) {}
    setTimeout(() => window.dispatchEvent(new Event('resize')), 60);
    console.log('[FUMOCA] layout', layout);
  }

  // PIP drag
  document.addEventListener('pointerdown', (e) => {
    const p = document.getElementById('fumocaVideoPane');
    if (!p || layout !== 'pip' || !p.contains(e.target)) return;
    if (e.target.closest('button, input, video')) return;
    const parent = p.parentElement.getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY, l: p.offsetLeft, t: p.offsetTop };
    p.setPointerCapture(e.pointerId);
    function move(ev) {
      let x = start.l + ev.clientX - start.x;
      let y = start.t + ev.clientY - start.y;
      x = Math.max(0, Math.min(x, parent.width - p.offsetWidth));
      y = Math.max(0, Math.min(y, parent.height - p.offsetHeight));
      p.style.left = x + 'px';
      p.style.top = y + 'px';
      p.style.right = 'auto';
      p.style.bottom = 'auto';
    }
    function up() {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
    }
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  });

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-layout]');
    if (!btn) return;
    setLayout(btn.dataset.layout);
    document.querySelectorAll('[data-layout]').forEach((b) => b.classList.toggle('active', b === btn));
  });

  window.addEventListener('load', () => setTimeout(apply, 300));
  setInterval(() => { if (layout !== 'off') apply(); }, 2000);
  window.fumocaSetLayout = setLayout;
})();
