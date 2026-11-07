/**
 * FUMOCA editorial image layers.
 * Presentation-only layers: no source Gaussian buffers are modified.
 * Layer geometry is stored in poster coordinates so compositions survive resize.
 */
function hostNode() {
  if (/\/edit/i.test(location.pathname)) {
    const viewport = document.getElementById('viewport') || document.getElementById('stageHost') || document.getElementById('stage');
    // Studio poster is a distinct adapting layer. Attach image layers to it when present.
    return viewport?.querySelector('[data-fumoca-poster-canvas]') || viewport;
  }
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
    // Poster viewport may mount after this module. Follow the authoritative
    // canvas when it appears instead of leaving image layers on the full editor.
    const currentHost = hostNode();
    if (currentHost && root.parentElement !== currentHost) currentHost.appendChild(root);
    const images = state?.composition?.assets?.images || [];
    root.style.display = state?.enabled ? 'block' : 'none';
    // The poster host is the single coordinate system. Supporting images fill
    // the host and use normalized coordinates relative to it. Do not compute a
    // second contain-fit inside an already-framed host.
    Object.assign(root.style, { inset: '0', left: '0', top: '0', width: '100%', height: '100%' });
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
        // Fixed-pixel layers deliberately retain their CSS-pixel size on every
        // device. Use Responsive mode when a layer should shrink to fit.
        layer.style.width = Math.max(24, Number(item.fixedWidthPx) || 240) + 'px';
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
          render();
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
              : root.getBoundingClientRect().width * item.width;
            const rect = root.getBoundingClientRect();
            const move = (ev) => {
              const delta = ev.clientX - startX;
              // Never let a resized supporting image extend beyond the poster artboard.
              // Fixed mode still keeps CSS-pixel sizing; the frame is its upper bound.
              const nextWidth = clamp(startWidth + delta, 24, Math.max(24, rect.width));
              if (item.sizeMode === 'fixed') patchItem(item.id, { fixedWidthPx: Math.round(nextWidth) });
              else patchItem(item.id, { width: clamp(nextWidth / Math.max(1, rect.width), 0.05, 1) });
            };
            const up = () => {
              window.removeEventListener('pointermove', move);
              window.removeEventListener('pointerup', up);
              window.removeEventListener('pointercancel', up);
              dragging = false; render(); emitSelection(window.FumocaPoster.getState().composition.assets.images.find(x => x.id === item.id));
            };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up, { once: true });
            window.addEventListener('pointercancel', up, { once: true });
          });
          layer.appendChild(resize);

          if (selectedId === item.id) {
            const rotate = document.createElement('button');
            rotate.type = 'button';
            rotate.setAttribute('aria-label', 'Rotate ' + (item.name || 'image'));
            rotate.title = 'Drag to rotate';
            Object.assign(rotate.style, {
              position: 'absolute', left: '50%', top: '-24px', transform: 'translateX(-50%)',
              width: '14px', height: '14px', border: '2px solid #111', borderRadius: '50%',
              background: '#7cecff', padding: '0', cursor: 'grab', pointerEvents: 'auto', touchAction: 'none',
            });
            rotate.addEventListener('pointerdown', event => {
              event.preventDefault(); event.stopPropagation();
              selectedId = item.id; dragging = true;
              const bounds = layer.getBoundingClientRect();
              const center = { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
              const angle = (x, y) => Math.atan2(y - center.y, x - center.x) * 180 / Math.PI;
              const startAngle = angle(event.clientX, event.clientY);
              const startRotation = Number(item.rotation) || 0;
              const move = ev => {
                const rotation = clamp(startRotation + angle(ev.clientX, ev.clientY) - startAngle, -180, 180);
                patchItem(item.id, { rotation });
                layer.style.transform = (anchorTransforms[item.anchor || 'free'] || anchorTransforms.free) + ' rotate(' + rotation + 'deg)';
              };
              const up = () => {
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', up);
                window.removeEventListener('pointercancel', up);
                dragging = false; render();
                const current = window.FumocaPoster.getState().composition.assets.images.find(x => x.id === item.id);
                emitSelection(current);
              };
              window.addEventListener('pointermove', move);
              window.addEventListener('pointerup', up);
              window.addEventListener('pointercancel', up);
            });
            layer.appendChild(rotate);
          }
        }
        layer.addEventListener('pointerdown', (event) => {
          if (event.target === resizeTarget(event) || item.locked) return;
          if (event.button !== 0) return;
          event.preventDefault(); event.stopPropagation();
          selectedId = item.id; dragging = true;
          // Image x/y are normalized to the poster root, not the larger editor host.
          // Measuring against the host causes drift whenever the poster is letterboxed.
          const rect = root.getBoundingClientRect();
          const layerRect = layer.getBoundingClientRect();
          const startX = event.clientX, startY = event.clientY;
          const startItemX = item.x, startItemY = item.y;
          // Preserve the complete visible layer inside the artboard. Use its
          // rendered (already rotation-aware) bounds so wide and rotated logos
          // cannot be dragged halfway beyond the poster edge.
          const leftInset = layerRect.left - rect.left - startItemX * rect.width;
          const rightInset = layerRect.right - rect.left - startItemX * rect.width;
          const topInset = layerRect.top - rect.top - startItemY * rect.height;
          const bottomInset = layerRect.bottom - rect.top - startItemY * rect.height;
          const minX = clamp(-leftInset / Math.max(1, rect.width), 0, 1);
          const maxX = clamp((rect.width - rightInset) / Math.max(1, rect.width), 0, 1);
          const minY = clamp(-topInset / Math.max(1, rect.height), 0, 1);
          const maxY = clamp((rect.height - bottomInset) / Math.max(1, rect.height), 0, 1);
          const move = (ev) => {
            const x = clamp(startItemX + (ev.clientX - startX) / Math.max(1, rect.width), minX, maxX);
            const y = clamp(startItemY + (ev.clientY - startY) / Math.max(1, rect.height), minY, maxY);
            patchItem(item.id, { x, y });
          };
          const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            window.removeEventListener('pointercancel', up);
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
  function resizeTarget(event) { return event.target.closest?.('[aria-label^="Resize "], [aria-label^="Rotate "]'); }

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
