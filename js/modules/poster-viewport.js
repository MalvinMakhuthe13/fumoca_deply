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
  let originalAutoRotate;
  let originalAutoRotateSpeed;
  let viewerReadyCamera = null;
  let viewerReadyControls = null;
  // Keep the unmodified zoom for each camera. viewerReady can fire more than
  // once; capturing an already poster-zoomed value compounds the zoom and can
  // push the subject out of frame on the next composition update.
  const cameraBaseZoom = new WeakMap();
  let camera = viewerReadyCamera || (isStudioEditor
    ? (window._fumocaCamera || window.camera || window._fumocaRenderer?.camera || null)
    : (window._fumocaRenderer?.camera || null));
  const getCamera = () => {
    // The camera announced by the live viewer is authoritative. Editor globals
    // may still point at a previous scene after a viewer remount.
    camera = viewerReadyCamera || (isStudioEditor ? (window._fumocaCamera || window.camera) : null) ||
      window._fumocaRenderer?.camera || camera || null;
    if (camera && !cameraBaseZoom.has(camera) && Number.isFinite(camera.zoom)) {
      cameraBaseZoom.set(camera, camera.zoom);
    }
    return camera;
  };
  const syncRendererBindings = () => {
    // #viewport contains a legacy placeholder canvas before the actual WebGL renderer canvas.
    // querySelector('canvas') selects that placeholder, leaving the live splat canvas unclipped.
    // Prefer the renderer's authoritative DOM element and only then fall back to a non-placeholder canvas.
    const nextCanvas = window._fumocaGlRenderer?.domElement ||
      window.renderer?.domElement ||
      Array.from(host.querySelectorAll('canvas')).find(canvas => canvas.id !== 'viewportCanvas') ||
      null;
    if (nextCanvas !== rendererCanvas) {
      if (rendererCanvas) {
        rendererCanvas.style.clipPath = '';
        rendererCanvas.style.webkitClipPath = '';
      }
      rendererCanvas = nextCanvas;
    }
    const nextControls = (isStudioEditor ? window._fumocaOrbitControls : null) ||
      viewerReadyControls || window._fumocaViewerControls || window._fumocaRenderer?.controls || null;
    if (nextControls !== orbitControls) {
      if (orbitControls) {
        if (originalPan !== undefined) orbitControls.enablePan = originalPan;
        if (originalZoomEnabled !== undefined) orbitControls.enableZoom = originalZoomEnabled;
        if (originalAutoRotate !== undefined) orbitControls.autoRotate = originalAutoRotate;
        if (originalAutoRotateSpeed !== undefined) orbitControls.autoRotateSpeed = originalAutoRotateSpeed;
      }
      orbitControls = nextControls;
      originalPan = orbitControls ? orbitControls.enablePan : undefined;
      originalZoomEnabled = orbitControls ? orbitControls.enableZoom : undefined;
      originalAutoRotate = orbitControls ? orbitControls.autoRotate : undefined;
      originalAutoRotateSpeed = orbitControls ? orbitControls.autoRotateSpeed : undefined;
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
    if (orbitControls && originalAutoRotate !== undefined) orbitControls.autoRotate = originalAutoRotate;
    if (orbitControls && originalAutoRotateSpeed !== undefined) orbitControls.autoRotateSpeed = originalAutoRotateSpeed;
    const activeCamera = getCamera();
    const baseZoom = activeCamera && cameraBaseZoom.get(activeCamera);
    if (activeCamera && Number.isFinite(baseZoom)) { activeCamera.zoom = baseZoom; activeCamera.updateProjectionMatrix?.(); }
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
      }
      return;
    }
    const signature = JSON.stringify({
      width: layout.width, height: layout.height, left: layout.left, top: layout.top,
      background: layout.background, assets: layout.assets, title: layout.title,
      framing: state.composition?.framing,
      motion: state.composition?.motion,
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
    if (orbitControls) {
      orbitControls.enablePan = false;
      orbitControls.enableZoom = false;
      const motionLevel = state.composition?.motion?.level || 'still';
      const motionSpeed = ({ still: 0, gentle: 0.35, normal: 0.8, dynamic: 1.5 })[motionLevel] ?? 0;
      orbitControls.autoRotate = motionSpeed > 0;
      if (motionSpeed > 0) orbitControls.autoRotateSpeed = motionSpeed;
    }
    const activeCamera = getCamera();
    if (activeCamera) {
      const framingZoom = Math.max(0.5, Math.min(2.5, Number(state.composition?.framing?.zoom) || 1));
      const baseZoom = cameraBaseZoom.get(activeCamera);
      activeCamera.zoom = (Number.isFinite(baseZoom) ? baseZoom : 1) * framingZoom;
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
    // The renderer canvas deliberately remains full-size in Studio. Updating
    // poster framing must not broadcast a global resize: the main editor's
    // resize listeners can rebuild camera/scene state and cause the viewer to
    // jump out of the active scene while the zoom slider is being dragged.
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };
  window.addEventListener('fumoca:viewerReady', event => {
    // The viewer announces its actual live camera and controls. Prefer these
    // references over guessed globals so poster zoom reaches the renderer that
    // is currently displaying the splat (including non-Studio viewer routes).
    viewerReadyCamera = event.detail?.camera || viewerReadyCamera;
    viewerReadyControls = event.detail?.controls || event.detail?.viewer?.controls || viewerReadyControls;
    // Do not overwrite the baseline when readiness is re-announced after a
    // poster zoom has already been applied to this same camera.
    if (viewerReadyCamera && !cameraBaseZoom.has(viewerReadyCamera) && Number.isFinite(viewerReadyCamera.zoom)) {
      cameraBaseZoom.set(viewerReadyCamera, viewerReadyCamera.zoom);
    }
    syncRendererBindings();
    schedule();
  });
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
