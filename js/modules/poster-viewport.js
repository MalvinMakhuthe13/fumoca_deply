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

export function mountPosterViewport() {
  const isStudioEditor = /\/edit(?:\.html)?\/?$/i.test(window.location.pathname);
  // Studio's poster layers and editable image assets share #viewport.
  // The public viewer uses the dedicated #stageHost inside its WebGL canvas host.
  const stage = isStudioEditor
    ? (document.getElementById('viewport') || document.getElementById('canvasHost'))
    : (document.getElementById('stageHost') || document.getElementById('stage') || document.getElementById('canvasHost') || document.getElementById('splatHost'));
  // The host is the single authoritative poster coordinate system.
  // Background, 3D canvas, supporting images and typography all live inside it
  // and use local coordinates. We never apply the outer centering offset to children.
  const host = stage;
  if (!stage || !host || !window.FumocaPoster) return;
  if (host.dataset.fumocaPosterViewportMounted === '1') return;
  host.dataset.fumocaPosterViewportMounted = '1';
  let lastSignature = '';
  let frame = 0;
  let title = host.querySelector('[data-fumoca-poster-title]');
  let posterCanvas = host.querySelector('[data-fumoca-poster-canvas]');
  let backgroundNode = host.querySelector('[data-fumoca-poster-background]');
  let backgroundImage = backgroundNode?.querySelector?.('[data-fumoca-poster-background-image]');
  // Viewer startup is asynchronous in some Studio routes. Resolve the live
  // renderer/camera/controls at each layout pass instead of capturing null
  // references before the viewer has finished mounting.
  let rendererCanvas = null;
  let orbitControls = null;
  let originalPan;
  let originalZoomEnabled;
  let camera = isStudioEditor ? (window._fumocaCamera || window.camera) : null;
  let originalCameraZoom = camera && Number.isFinite(camera.zoom) ? camera.zoom : null;
  const getCamera = () => {
    if (!camera && isStudioEditor) camera = window._fumocaCamera || window.camera || null;
    if (camera && originalCameraZoom === null && Number.isFinite(camera.zoom)) originalCameraZoom = camera.zoom;
    return camera;
  };
  const syncRendererBindings = () => {
    const nextCanvas = host.querySelector('canvas');
    if (nextCanvas !== rendererCanvas) {
      if (rendererCanvas) {
        rendererCanvas.style.clipPath = '';
        rendererCanvas.style.webkitClipPath = '';
      }
      rendererCanvas = nextCanvas;
    }
    const nextControls = isStudioEditor ? window._fumocaOrbitControls || null : null;
    if (nextControls !== orbitControls) {
      if (orbitControls) {
        if (originalPan !== undefined) orbitControls.enablePan = originalPan;
        if (originalZoomEnabled !== undefined) orbitControls.enableZoom = originalZoomEnabled;
      }
      orbitControls = nextControls;
      originalPan = orbitControls ? orbitControls.enablePan : undefined;
      originalZoomEnabled = orbitControls ? orbitControls.enableZoom : undefined;
    }
    getCamera();
  };

  const restoreRendererBounds = () => {
    syncRendererBindings();
    if (rendererCanvas) {
      rendererCanvas.style.clipPath = '';
      rendererCanvas.style.webkitClipPath = '';
    }
    if (orbitControls && originalPan !== undefined) orbitControls.enablePan = originalPan;
    if (orbitControls && originalZoomEnabled !== undefined) orbitControls.enableZoom = originalZoomEnabled;
    const activeCamera = getCamera();
    if (activeCamera && Number.isFinite(originalCameraZoom)) { activeCamera.zoom = originalCameraZoom; activeCamera.updateProjectionMatrix?.(); }
  };

  if (!backgroundNode) {
    backgroundNode = document.createElement('div');
    backgroundNode.dataset.fumocaPosterBackground = '1';
    host.insertBefore(backgroundNode, host.firstChild);
  }
  Object.assign(backgroundNode.style, {
    position: 'absolute', zIndex: '1',
    pointerEvents: 'none', overflow: 'hidden', clipPath: 'inset(0)',
    contain: 'layout paint',
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
    const target = host.querySelector('[data-fumoca-poster-canvas]') || host;
    target.appendChild(title);
    return title;
  };
  const restore = () => {
    for (const property of ['position','inset','left','top','right','bottom','width','height','maxWidth','maxHeight','boxSizing','overflow']) {
      host.style.removeProperty(property.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()));
    }
    backgroundNode.style.left = '0'; backgroundNode.style.top = '0';
    backgroundNode.style.width = '100%'; backgroundNode.style.height = '100%';
    title?.remove();
    title = null;
    // Keep the background layer mounted so disabling and re-enabling poster
    // composition does not leave the renderer without its background element.
    if (backgroundNode) backgroundNode.style.display = 'none';
    if (posterCanvas) posterCanvas.style.display = 'none';
    restoreRendererBounds();
    host.removeAttribute('data-fumoca-poster-viewport');

  };
  // Studio measures the stage itself so the poster layer is centered in the
  // editing area. Public viewer measures the parent to avoid a resize feedback loop.
  const measureEl = isStudioEditor ? host : (host.parentElement || document.documentElement);
  const update = () => {
    frame = 0;
    const state = window.FumocaPoster?.getState?.();
    syncRendererBindings();
    const rect = measureEl.getBoundingClientRect();
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
      framing: state.composition?.framing,
    });
    if (signature === lastSignature) return;
    lastSignature = signature;
    // Studio: keep the main #viewport full-size. The poster is a distinct
    // adapting layer on top. Public viewer: the host itself is the poster
    // canvas so the WebGL surface matches the composition.
    posterCanvas = host;
    if (isStudioEditor) {
      posterCanvas = host.querySelector('[data-fumoca-poster-canvas]');
      if (!posterCanvas) {
        posterCanvas = document.createElement('div');
        posterCanvas.dataset.fumocaPosterCanvas = '1';
        Object.assign(posterCanvas.style, {
          position: 'absolute', zIndex: '3', pointerEvents: 'none', overflow: 'hidden',
          clipPath: 'inset(0)', isolation: 'isolate', contain: 'layout paint',
        });
        host.appendChild(posterCanvas);
      }
      Object.assign(posterCanvas.style, {
        display: 'block',
        zIndex: '3',
        overflow: 'hidden', clipPath: 'inset(0)', isolation: 'isolate', contain: 'layout paint',
        left: layout.left + 'px',
        top: layout.top + 'px',
        width: layout.width + 'px',
        height: layout.height + 'px',
      });
      // Do not resize the main stage.
      for (const property of ['width','height','left','top','right','bottom','maxWidth','maxHeight','flex']) {
        host.style.removeProperty(property.replace(/[A-Z]/g, m => '-' + m.toLowerCase()));
      }
    } else {
      const hostIsAbsolute = getComputedStyle(host).position === 'absolute';
      Object.assign(host.style, {
        width: layout.width + 'px',
        height: layout.height + 'px',
        maxWidth: '100%',
        maxHeight: '100%',
        overflow: 'hidden',
        boxSizing: 'border-box',
        margin: 'auto',
        flex: '0 0 auto',
      });
      if (hostIsAbsolute) {
        Object.assign(host.style, {
          position: 'absolute',
          left: layout.left + 'px',
          top: layout.top + 'px',
          right: 'auto',
          bottom: 'auto',
        });
      }
    }
    // Studio background is a clipped poster-sized layer BEHIND the transparent
    // WebGL canvas. The editorial canvas stays above WebGL for text and images.
    // Keeping these siblings prevents an opaque poster background from hiding
    // the live splat while preserving an independent printable composition.
    if (isStudioEditor) {
      if (backgroundNode.parentElement !== host) host.insertBefore(backgroundNode, host.firstChild);
      Object.assign(backgroundNode.style, {
        left: layout.left + 'px', top: layout.top + 'px',
        width: layout.width + 'px', height: layout.height + 'px',
        zIndex: '1',
      });
    } else if (backgroundNode.parentElement !== posterCanvas) posterCanvas.appendChild(backgroundNode);
    Object.assign(backgroundNode.style, {
      position: 'absolute',
      inset: isStudioEditor ? 'auto' : '0',
      left: isStudioEditor ? layout.left + 'px' : '0',
      top: isStudioEditor ? layout.top + 'px' : '0',
      width: isStudioEditor ? layout.width + 'px' : '100%',
      height: isStudioEditor ? layout.height + 'px' : '100%',
      zIndex: isStudioEditor ? '1' : '0',
      display: 'block',
    });
    const background = layout.background || {};
    if (!isStudioEditor) {
      host.style.background = background.type === 'gradient' ? background.value : '';
      host.style.backgroundColor = background.type === 'solid' ? (background.value || '#10131a') : 'transparent';
      host.style.backgroundImage = '';
    } else {
      host.style.background = '';
      host.style.backgroundColor = '';
      host.style.backgroundImage = '';
    }
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
      backgroundNode.style.transform = 'none';
      backgroundNode.style.clipPath = 'inset(0)';
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

    // The live WebGL canvas remains full-size for renderer stability, but its
    // visible pixels are clipped to the exact poster rectangle. This keeps the
    // splat inside the printable composition without resizing the 3D renderer.
    if (isStudioEditor && rendererCanvas) {
      const right = Math.max(0, rect.width - layout.left - layout.width);
      const bottom = Math.max(0, rect.height - layout.top - layout.height);
      const clip = `inset(${layout.top}px ${right}px ${bottom}px ${layout.left}px)`;
      rendererCanvas.style.clipPath = clip;
      rendererCanvas.style.webkitClipPath = clip;
    }
    // Panning can move the subject beyond the designed frame. Keep orbit and
    // zoom available, but make pan an explicit poster-layout operation instead.
    if (orbitControls) { orbitControls.enablePan = false; orbitControls.enableZoom = false; }
    const activeCamera = getCamera();
    if (activeCamera) {
      const framingZoom = Math.max(0.5, Math.min(2.5, Number(state.composition?.framing?.zoom) || 1));
      activeCamera.zoom = (Number.isFinite(originalCameraZoom) ? originalCameraZoom : 1) * framingZoom;
      activeCamera.updateProjectionMatrix?.();
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
  window.addEventListener('fumoca:viewerReady', () => { syncRendererBindings(); schedule(); });
  window.addEventListener('fumoca:posterChange', schedule);
  window.addEventListener('fumoca:presentationResize', schedule);
  window.addEventListener('resize', schedule, { passive: true });
  window.addEventListener('orientationchange', schedule, { passive: true });
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(schedule);
    observer.observe(measureEl);
  }
  schedule();
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountPosterViewport, { once: true });
  } else {
    mountPosterViewport();
  }
}
