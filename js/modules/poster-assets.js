/**
 * FUMOCA editorial image layers.
 * Supporting imagery is presentation-only DOM; Gaussian buffers are never changed.
 */
function hostNode() {
  return document.getElementById('stageHost') || document.getElementById('stage') || document.getElementById('viewport');
}
function clamp(n, a, b) { return Math.max(a, Math.min(b, Number(n) || 0)); }
export function initPosterAssets({ editable = false } = {}) {
  const host = hostNode();
  if (!host || !window.FumocaPoster) return null;
  let root = host.querySelector('[data-fumoca-poster-assets]');
  if (!root) {
    root = document.createElement('div');
    root.dataset.fumocaPosterAssets = '1';
    Object.assign(root.style, { position: 'absolute', inset: '0', overflow: 'hidden', pointerEvents: 'none', zIndex: '8' });
    host.appendChild(root);
  }
  const render = () => {
    const state = window.FumocaPoster?.getState?.();
    const images = state?.composition?.assets?.images || [];
    root.replaceChildren();
    images.forEach((item) => {
      if (!item.visible || !item.src) return;
      const img = document.createElement('img');
      img.src = item.src;
      img.alt = item.name || 'Editorial image';
      img.draggable = false;
      Object.assign(img.style, {
        position: 'absolute', left: (item.x * 100) + '%', top: (item.y * 100) + '%',
        width: (item.width * 100) + '%', height: 'auto', maxHeight: '90%',
        objectFit: item.fit || 'contain', opacity: String(item.opacity ?? 1),
        transform: 'translate(-50%,-50%) rotate(' + (item.rotation || 0) + 'deg)',
        transformOrigin: 'center', zIndex: String(item.z || 1),
        pointerEvents: editable ? 'auto' : 'none',
        cursor: editable ? 'move' : 'default',
        filter: 'drop-shadow(0 8px 24px rgba(0,0,0,.28))',
      });
      if (editable) {
        img.addEventListener('pointerdown', (event) => {
          event.preventDefault(); event.stopPropagation();
          const rect = host.getBoundingClientRect();
          const move = (ev) => {
            const x = clamp((ev.clientX - rect.left) / rect.width, 0.02, 0.98);
            const y = clamp((ev.clientY - rect.top) / rect.height, 0.02, 0.98);
            window.FumocaPoster.updateComposition({ assets: { images: images.map((entry) => entry.id === item.id ? { ...entry, x, y } : entry) } });
          };
          const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up, { once: true });
        });
      }
      root.appendChild(img);
    });
  };
  window.addEventListener('fumoca:posterChange', render);
  render();
  return { refresh: render, destroy() { window.removeEventListener('fumoca:posterChange', render); root.remove(); } };
}
if (typeof window !== 'undefined') {
  const boot = () => initPosterAssets({ editable: /\/edit/i.test(location.pathname) });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
}
