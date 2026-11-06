/**
 * FUMOCA editorial image layers.
 * Presentation-only layers: no source Gaussian buffers are modified.
 * Layer geometry is stored in poster coordinates so compositions survive resize.
 */
function hostNode() {
  if (/\/edit/i.test(location.pathname)) return document.getElementById('viewport') || document.getElementById('stageHost') || document.getElementById('stage');
  return document.getElementById('stageHost') || document.getElementById('stage') || document.getElementById('viewport');
}
const clamp = (n, a, b) => Math.max(a, Math.min(b, Number(n) || 0));
const emitSelection = (item) => window.dispatchEvent(new CustomEvent('fumoca:posterAssetSelected', { detail: item || null }));

export function initPosterAssets({ editable = false } = {}) {
  const host = hostNode();
  if (!host || !window.FumocaPoster) return null;
  let dragging = false;
  let selectedId = null;
  let root = host.querySelector('[data-fumoca-poster-assets]');
  if (!root) {
    root = document.createElement('div');
    root.dataset.fumocaPosterAssets = '1';
    Object.assign(root.style, {
      position: 'absolute', inset: '0', overflow: 'hidden',
      pointerEvents: 'none', zIndex: '8',
    });
    host.appendChild(root);
  }

  const patchItem = (id, patch) => {
    const images = window.FumocaPoster.getState().composition.assets?.images || [];
    window.FumocaPoster.updateComposition({
      assets: { images: images.map((item) => item.id === id ? { ...item, ...patch } : item) },
    });
  };

  const render = () => {
    const state = window.FumocaPoster?.getState?.();
    if (dragging) return;
    const images = state?.composition?.assets?.images || [];
    root.style.display = state?.enabled ? 'block' : 'none';
    if (/\/edit/i.test(location.pathname)) {
      const bounds = host.getBoundingClientRect();
      const ratio = Number(state?.composition?.aspectRatio) || 4 / 5;
      let width = bounds.width, height = width / ratio;
      if (height > bounds.height) { height = bounds.height; width = height * ratio; }
      Object.assign(root.style, {
        inset: 'auto', left: ((bounds.width - width) / 2) + 'px',
        top: ((bounds.height - height) / 2) + 'px',
        width: width + 'px', height: height + 'px',
      });
    } else {
      Object.assign(root.style, { inset: '0', left: '0', top: '0', width: '100%', height: '100%' });
    }
    root.replaceChildren();
    images.forEach((item) => {
      if (!item.visible || !item.src) return;
      const layer = document.createElement('div');
      layer.dataset.posterAssetId = item.id;
      const anchorTransforms = {
        free: 'translate(-50%,-50%)', 'top-left': 'translate(0,0)', top: 'translate(-50%,0)',
        'top-right': 'translate(-100%,0)', left: 'translate(0,-50%)', center: 'translate(-50%,-50%)',
        right: 'translate(-100%,-50%)', 'bottom-left': 'translate(0,-100%)',
        bottom: 'translate(-50%,-100%)', 'bottom-right': 'translate(-100%,-100%)',
      };
      Object.assign(layer.style, {
        position: 'absolute',
        left: (item.x * 100) + '%',
        top: (item.y * 100) + '%',
        transform: (anchorTransforms[item.anchor || 'free'] || anchorTransforms.free) + ' rotate(' + (item.rotation || 0) + 'deg)',
        transformOrigin: 'center',
        zIndex: String(item.z || 1),
        pointerEvents: editable ? 'auto' : 'none',
        cursor: editable && !item.locked ? 'move' : 'default',
        touchAction: 'none',
        outline: editable && selectedId === item.id ? '1px solid #c8ff00' : 'none',
        outlineOffset: '3px',
        opacity: String(item.opacity ?? 1),
        filter: 'drop-shadow(0 8px 24px rgba(0,0,0,.28))',
        boxSizing: 'border-box',
      });
      if (item.sizeMode === 'fixed') {
        layer.style.width = Math.max(24, Number(item.fixedWidthPx) || 240) + 'px';
        layer.style.maxWidth = '100%';
      } else if (item.sizeMode === 'responsive') {
        layer.style.width = 'clamp(' + (Number(item.minWidthPx) || 72) + 'px, ' +
          (item.width * 100) + '%, ' + (Number(item.maxWidthPx) || 720) + 'px)';
        layer.style.maxWidth = '100%';
      } else {
        layer.style.width = (item.width * 100) + '%';
        layer.style.maxWidth = '100%';
      }
      const img = document.createElement('img');
      img.src = item.src;
      img.alt = item.name || 'Editorial image';
      img.draggable = false;
      Object.assign(img.style, {
        display: 'block', width: '100%', height: 'auto', maxHeight: '90%',
        objectFit: item.fit || 'contain', pointerEvents: 'none',
      });
      layer.appendChild(img);

      if (editable) {
        layer.addEventListener('click', (event) => {
          event.stopPropagation();
          selectedId = item.id;
          root.querySelectorAll('[data-poster-asset-id]').forEach((node) => {
            node.style.outline = node.dataset.posterAssetId === selectedId ? '1px solid #c8ff00' : 'none';
          });
          emitSelection(item);
        });
        if (!item.locked) {
          const resize = document.createElement('button');
          resize.type = 'button';
          resize.setAttribute('aria-label', 'Resize ' + (item.name || 'image'));
          Object.assign(resize.style, {
            position: 'absolute', right: '-7px', bottom: '-7px', width: '14px', height: '14px',
            border: '2px solid #111', borderRadius: '50%', background: '#c8ff00',
            padding: '0', cursor: 'nwse-resize', pointerEvents: 'auto', touchAction: 'none',
          });
          resize.addEventListener('pointerdown', (event) => {
            event.preventDefault(); event.stopPropagation();
            selectedId = item.id; dragging = true;
            const startX = event.clientX;
            const startWidth = item.sizeMode === 'fixed'
              ? (Number(item.fixedWidthPx) || 240)
              : host.getBoundingClientRect().width * item.width;
            const rect = host.getBoundingClientRect();
            const move = (ev) => {
              const delta = ev.clientX - startX;
              const nextWidth = clamp(startWidth + delta, 24, Math.max(24, rect.width * 1.5));
              if (item.sizeMode === 'fixed') patchItem(item.id, { fixedWidthPx: Math.round(nextWidth) });
              else patchItem(item.id, { width: clamp(nextWidth / Math.max(1, rect.width), 0.05, 1) });
            };
            const up = () => {
              window.removeEventListener('pointermove', move);
              window.removeEventListener('pointerup', up);
              dragging = false; render(); emitSelection(window.FumocaPoster.getState().composition.assets.images.find(x => x.id === item.id));
            };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up, { once: true });
          });
          layer.appendChild(resize);
        }
        layer.addEventListener('pointerdown', (event) => {
          if (event.target === resizeTarget(event) || item.locked) return;
          if (event.button !== 0) return;
          event.preventDefault(); event.stopPropagation();
          selectedId = item.id; dragging = true;
          const rect = host.getBoundingClientRect();
          const startX = event.clientX, startY = event.clientY;
          const startItemX = item.x, startItemY = item.y;
          const move = (ev) => {
            const x = clamp(startItemX + (ev.clientX - startX) / Math.max(1, rect.width), 0.005, 0.995);
            const y = clamp(startItemY + (ev.clientY - startY) / Math.max(1, rect.height), 0.005, 0.995);
            patchItem(item.id, { x, y });
          };
          const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            dragging = false; render();
            const current = window.FumocaPoster.getState().composition.assets.images.find(x => x.id === item.id);
            emitSelection(current);
          };
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up, { once: true });
        });
      }
      root.appendChild(layer);
    });
  };

  // Avoid a resize handle being mistaken for the image drag target.
  function resizeTarget(event) { return event.target.closest?.('[aria-label^="Resize "]'); }

  window.addEventListener('fumoca:posterChange', render);
  window.FumocaPosterAssets = Object.freeze({
    select(id) {
      selectedId = id || null;
      const item = (window.FumocaPoster.getState().composition.assets.images || []).find(x => x.id === selectedId);
      emitSelection(item || null); render();
    },
    refresh: render,
  });
  render();
  return {
    refresh: render,
    select(id) { window.FumocaPosterAssets.select(id); },
    destroy() { window.removeEventListener('fumoca:posterChange', render); root.remove(); delete window.FumocaPosterAssets; },
  };
}

if (typeof window !== 'undefined') {
  const boot = () => initPosterAssets({ editable: /\/edit/i.test(location.pathname) });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
}
