/**
 * FUMOCA Poster Viewport
 *
 * Gives the live viewer a true contain-fit poster viewport. The WebGL canvas,
 * camera aspect and pointer surface all share the poster's actual dimensions.
 * The surrounding viewer page remains untouched.
 */
export function calculatePosterViewport(posterState, width, height) {
  if (!posterState?.enabled || !posterState?.composition) return null;
  const w = Math.max(0, Number(width) || 0);
  const h = Math.max(0, Number(height) || 0);
  const composition = posterState.composition;
  const ratio = Number(composition.aspectRatio);
  if (w < 2 || h < 2 || !Number.isFinite(ratio) || ratio <= 0) return null;
  const fitWidth = Math.min(w, h * ratio);
  const fitHeight = fitWidth / ratio;
  const left = (w - fitWidth) / 2;
  const top = (h - fitHeight) / 2;
  const inset = fitWidth * Math.min(0.2, Math.max(0, Number(composition.safeArea) || 0));
  return {
    width: fitWidth,
    height: fitHeight,
    left,
    top,
    aspectRatio: ratio,
    safe: {
      left: inset,
      top: inset,
      right: fitWidth - inset,
      bottom: fitHeight - inset,
      width: fitWidth - inset * 2,
      height: fitHeight - inset * 2,
    },
    background: composition.background || { type: 'solid', value: '#10131a' },
    assets: composition.assets || { images: [] },
    title: composition.title || { visible: false, text: '', align: 'center' },
  };
}

function mount() {
  const stage = document.getElementById('stage') || document.getElementById('canvasHost') || document.getElementById('splatHost');
  const host = document.getElementById('stageHost') || stage;
  if (!stage || !host || !window.FumocaPoster) return;
  if (host.dataset.fumocaPosterViewportMounted === '1') return;
  host.dataset.fumocaPosterViewportMounted = '1';
  let lastSignature = '';
  let frame = 0;
  let title = host.querySelector('[data-fumoca-poster-title]');
  let backgroundNode = host.querySelector('[data-fumoca-poster-background]');
  let backgroundImage = backgroundNode?.querySelector?.('[data-fumoca-poster-background-image]');
  if (!backgroundNode) {
    backgroundNode = document.createElement('div');
    backgroundNode.dataset.fumocaPosterBackground = '1';
    host.insertBefore(backgroundNode, host.firstChild);
  }
  Object.assign(backgroundNode.style, {
    position: 'absolute', inset: '0', zIndex: '0',
    pointerEvents: 'none', overflow: 'hidden',
  });
  if (!backgroundImage) {
    backgroundImage = document.createElement('img');
    backgroundImage.dataset.fumocaPosterBackgroundImage = '1';
    backgroundImage.alt = '';
    backgroundImage.draggable = false;
    Object.assign(backgroundImage.style, {
      display: 'block', width: '100%', height: '100%',
      objectPosition: 'center', pointerEvents: 'none',
    });
    backgroundNode.appendChild(backgroundImage);
  }
  const ensureTitle = () => {
    if (title?.isConnected) return title;
    title = document.createElement('div');
    title.dataset.fumocaPosterTitle = '1';
    Object.assign(title.style, {
      position: 'absolute', zIndex: '3', pointerEvents: 'none',
      color: '#fff', fontFamily: 'system-ui, sans-serif', fontWeight: '750',
      lineHeight: '1.12', textShadow: '0 2px 18px rgba(0,0,0,.45)',
      overflowWrap: 'anywhere',
    });
    host.appendChild(title);
    return title;
  };
  const restore = () => {
    for (const property of ['position','inset','left','top','right','bottom','width','height','maxWidth','maxHeight','boxSizing','overflow','background','backgroundColor','backgroundImage','backgroundSize','backgroundPosition']) {
      host.style.removeProperty(property.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()));
    }
    title?.remove();
    title = null;
    // Keep the background layer mounted so disabling and re-enabling poster
    // composition does not leave the renderer without its background element.
    if (backgroundNode) backgroundNode.style.display = 'none';
    host.removeAttribute('data-fumoca-poster-viewport');
  };
  const update = () => {
    frame = 0;
    const state = window.FumocaPoster?.getState?.();
    const rect = stage.getBoundingClientRect();
    const layout = calculatePosterViewport(state, rect.width, rect.height);
    if (!layout) {
      if (lastSignature) {
        lastSignature = '';
        restore();
        window.dispatchEvent(new Event('resize'));
      }
      return;
    }
    const signature = JSON.stringify({
      width: layout.width, height: layout.height, left: layout.left, top: layout.top,
      background: layout.background, assets: layout.assets, title: layout.title,
    });
    if (signature === lastSignature) return;
    lastSignature = signature;
    Object.assign(host.style, {
      position: 'absolute', inset: 'auto',
      left: layout.left + 'px', top: layout.top + 'px',
      right: 'auto', bottom: 'auto',
      width: layout.width + 'px', height: layout.height + 'px',
      maxWidth: '100%', maxHeight: '100%', overflow: 'hidden',
      boxSizing: 'border-box',
    });
    const background = layout.background || {};
    host.style.background = background.type === 'gradient' ? background.value : '';
    host.style.backgroundColor = background.type === 'solid' ? (background.value || '#10131a') : 'transparent';
    host.style.backgroundImage = '';
    host.style.backgroundSize = 'cover';
    host.style.backgroundPosition = 'center';
    if (backgroundNode) {
      backgroundNode.style.display = 'block';
      const imageSource = String(background.value || '');
      const isImage = background.type === 'image' && (imageSource.startsWith('data:image/') || imageSource.startsWith('https://') || imageSource.startsWith('http://'));
      backgroundNode.style.background = background.type === 'gradient' ? background.value : '';
      backgroundNode.style.backgroundColor = background.type === 'solid' ? (background.value || '#10131a') : 'transparent';
      backgroundNode.style.opacity = String(Math.max(0, Math.min(1, Number(background.opacity ?? 1))));
      backgroundNode.style.filter = 'blur(' + Math.max(0, Math.min(40, Number(background.blur) || 0)) + 'px) brightness(' + Math.max(0.2, Math.min(2, Number(background.brightness) || 1)) + ')';
      backgroundNode.style.transform = Number(background.blur) > 0 ? 'scale(1.04)' : 'none';
      if (backgroundImage) {
        backgroundImage.style.display = isImage ? 'block' : 'none';
        backgroundImage.style.objectFit = background.fit === 'contain' ? 'contain' : background.fit === 'fill' ? 'fill' : 'cover';
        backgroundImage.style.objectPosition = background.position || 'center';
        if (isImage && backgroundImage.dataset.source !== background.value) {
          backgroundImage.dataset.source = background.value;
          backgroundImage.onload = () => window.dispatchEvent(new CustomEvent('fumoca:posterBackgroundLoaded'));
          backgroundImage.onerror = () => {
            console.error('[FUMOCA Poster] Background image failed to decode or load.');
            window.dispatchEvent(new CustomEvent('fumoca:posterBackgroundError', { detail: { source: 'background' } }));
          };
          backgroundImage.src = background.value;
        } else if (!isImage) {
          backgroundImage.removeAttribute('src');
          delete backgroundImage.dataset.source;
        }
      }
    }
    host.dataset.fumocaPosterViewport = '1';
    const heading = layout.title || {};
    if (heading.visible && String(heading.text || '').trim()) {
      const node = ensureTitle();
      Object.assign(node.style, {
        left: layout.safe.left + 'px',
        top: layout.safe.top + 'px',
        width: layout.safe.width + 'px',
        textAlign: ['left','center','right'].includes(heading.align) ? heading.align : 'center',
        fontSize: Math.max(10, Math.min(layout.width * 0.14, (Number(heading.fontSize) || 42) * (layout.width / 1080))) + 'px',
        fontFamily: ['system-ui, sans-serif','Arial, sans-serif','Georgia, serif','Impact, sans-serif','monospace'].includes(heading.fontFamily) ? heading.fontFamily : 'system-ui, sans-serif',
        fontWeight: String(Math.max(400, Math.min(900, Number(heading.weight) || 750))),
        color: /^#[0-9a-f]{6}$/i.test(heading.color || '') ? heading.color : '#ffffff',
      });
      node.textContent = String(heading.text).slice(0, 160);
    } else {
      title?.remove();
      title = null;
    }
    // Existing renderer resize handlers use the host's measured dimensions.
    window.dispatchEvent(new Event('resize'));
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };
  window.addEventListener('fumoca:posterChange', schedule);
  window.addEventListener('fumoca:presentationResize', schedule);
  window.addEventListener('resize', schedule, { passive: true });
  window.addEventListener('orientationchange', schedule, { passive: true });
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(schedule);
    observer.observe(stage);
  }
  schedule();
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
}
