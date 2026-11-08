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

export function calculatePosterCanvasClip(canvasRect, posterRect, canvasWidth = canvasRect?.width, canvasHeight = canvasRect?.height) {
  if (!canvasRect || !posterRect) return 'inset(100%)';
  const cLeft = Number(canvasRect.left) || 0;
  const cTop = Number(canvasRect.top) || 0;
  const cWidth = Math.max(0, Number(canvasRect.width) || 0);
  const cHeight = Math.max(0, Number(canvasRect.height) || 0);
  const cRight = Number.isFinite(Number(canvasRect.right)) ? Number(canvasRect.right) : cLeft + cWidth;
  const cBottom = Number.isFinite(Number(canvasRect.bottom)) ? Number(canvasRect.bottom) : cTop + cHeight;
  const pLeft = Number(posterRect.left) || 0;
  const pTop = Number(posterRect.top) || 0;
  const pRight = Number.isFinite(Number(posterRect.right)) ? Number(posterRect.right) : pLeft + (Number(posterRect.width) || 0);
  const pBottom = Number.isFinite(Number(posterRect.bottom)) ? Number(posterRect.bottom) : pTop + (Number(posterRect.height) || 0);
  const visibleLeft = Math.max(cLeft, pLeft);
  const visibleTop = Math.max(cTop, pTop);
  const visibleRight = Math.min(cRight, pRight);
  const visibleBottom = Math.min(cBottom, pBottom);
  if (cWidth < 1 || cHeight < 1 || visibleRight <= visibleLeft || visibleBottom <= visibleTop) return 'inset(100%)';
  // getBoundingClientRect() includes CSS transforms; clip-path inset values use
  // the canvas's untransformed CSS pixels, so convert by its rendered scale.
  const scaleX = cWidth / Math.max(1, Number(canvasWidth) || cWidth);
  const scaleY = cHeight / Math.max(1, Number(canvasHeight) || cHeight);
  const px = value => Number((value / Math.max(0.0001, scaleX)).toFixed(3)) + 'px';
  const py = value => Number((value / Math.max(0.0001, scaleY)).toFixed(3)) + 'px';
  const top = py(visibleTop - cTop);
  const right = px(cRight - visibleRight);
  const bottom = py(cBottom - visibleBottom);
  const left = px(visibleLeft - cLeft);
  return 'inset(' + top + ' ' + right + ' ' + bottom + ' ' + left + ')';
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
  let posterBounds = null;
  let trackballGesture = null;
  // Keep the unmodified zoom for each camera. viewerReady can fire more than
  // once; capturing an already poster-zoomed value compounds the zoom and can
  // push the subject out of frame on the next composition update.
  const cameraBaseZoom = new WeakMap();
  const cameraBaseAspect = new WeakMap();
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
    if (camera && !cameraBaseAspect.has(camera) && Number.isFinite(camera.aspect)) {
      cameraBaseAspect.set(camera, camera.aspect);
    }
    return camera;
  };
  const syncRendererBindings = () => {
    // #viewport contains a legacy placeholder canvas before the actual WebGL renderer canvas.
    // querySelector('canvas') selects that placeholder, leaving the live splat canvas unclipped.
    // Prefer the renderer's authoritative DOM element and only then fall back to a non-placeholder canvas.
    // The Spark PLY renderer publishes its exact live canvas for capture.
    // It is not always the first canvas under #viewport (Studio also mounts a
    // legacy placeholder), so prefer this authoritative reference first.
    const captureCanvas = window._fumocaCaptureCanvas;
    const nextCanvas = (captureCanvas?.isConnected ? captureCanvas : null) ||
      window._fumocaGlRenderer?.domElement ||
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
    // The viewerReady event is emitted by the renderer that is actually
    // drawing the current scene (Spark PLY in the poster workflow). Studio's
    // legacy orbit global can point at an older canvas and must never win.
    const nextControls = viewerReadyControls ||
      window._fumocaViewerControls ||
      window._fumocaRenderer?.controls ||
      (isStudioEditor ? window._fumocaOrbitControls : null) ||
      null;
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
      if (isStudioEditor) {
        Object.assign(rendererCanvas.style, {
          position: 'absolute', left: '0px', top: '0px',
          right: 'auto', bottom: 'auto', width: '100%', height: '100%',
        });
      }
    }
    if (isStudioEditor) {
      const width = Math.max(2, host.clientWidth || 2);
      const height = Math.max(2, host.clientHeight || 2);
      const renderer = window._fumocaGlRenderer || window.renderer;
      renderer?.setSize?.(width, height, false);
      const activeCamera = getCamera();
      if (activeCamera) {
        activeCamera.aspect = width / height;
        activeCamera.updateProjectionMatrix?.();
      }
    }
    if (orbitControls && originalPan !== undefined) orbitControls.enablePan = originalPan;
    if (orbitControls && originalZoomEnabled !== undefined) orbitControls.enableZoom = originalZoomEnabled;
    if (orbitControls && originalAutoRotate !== undefined) orbitControls.autoRotate = originalAutoRotate;
    if (orbitControls && originalAutoRotateSpeed !== undefined) orbitControls.autoRotateSpeed = originalAutoRotateSpeed;
    const activeCamera = getCamera();
    const baseZoom = activeCamera && cameraBaseZoom.get(activeCamera);
    const baseAspect = activeCamera && cameraBaseAspect.get(activeCamera);
    if (activeCamera && Number.isFinite(baseZoom)) activeCamera.zoom = baseZoom;
    if (activeCamera && Number.isFinite(baseAspect)) activeCamera.aspect = baseAspect;
    if (activeCamera) activeCamera.updateProjectionMatrix?.();
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
      position: 'absolute', zIndex: '3', pointerEvents: isStudioEditor ? 'auto' : 'none',
      color: '#fff', fontFamily: 'system-ui, sans-serif', fontWeight: '750',
      lineHeight: '1.12', textShadow: '0 2px 18px rgba(0,0,0,.45)',
      overflowWrap: 'anywhere', cursor: isStudioEditor ? 'move' : 'default',
      userSelect: 'none', touchAction: 'none',
    });
    const target = host.querySelector('[data-fumoca-poster-canvas]') || host;
    target.appendChild(title);
    if (isStudioEditor) {
      title.addEventListener('pointerdown', event => {
        if (event.button !== 0 || event.target !== title) return;
        const current = window.FumocaPoster?.getState?.()?.composition?.title || {};
        const start = { x: Number(current.x ?? .5), y: Number(current.y ?? .12) };
        const bounds = target.getBoundingClientRect();
        const origin = { x: event.clientX, y: event.clientY };
        try { title.setPointerCapture?.(event.pointerId); } catch (_) {}
        event.preventDefault(); event.stopPropagation();
        const move = ev => {
          window.FumocaPoster?.updateComposition?.({ title: {
            x: Math.max(0, Math.min(1, start.x + (ev.clientX - origin.x) / Math.max(1, bounds.width))),
            y: Math.max(0, Math.min(1, start.y + (ev.clientY - origin.y) / Math.max(1, bounds.height))),
          }});
        };
        const up = ev => {
          title.removeEventListener('pointermove', move);
          title.removeEventListener('pointerup', up);
          title.removeEventListener('pointercancel', up);
          try { title.releasePointerCapture?.(ev.pointerId); } catch (_) {}
        };
        title.addEventListener('pointermove', move);
        title.addEventListener('pointerup', up);
        title.addEventListener('pointercancel', up);
      });
    }
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

    posterBounds = {
      left: rect.left + layout.left,
      top: rect.top + layout.top,
      right: rect.left + layout.left + layout.width,
      bottom: rect.top + layout.top + layout.height,
    };
    // Studio's live WebGL canvas is the poster's 3D viewport, not a
    // full-editor canvas hidden behind a CSS crop. Give the renderer, drawing
    // buffer, camera frustum and pointer surface the exact same poster bounds.
    if (isStudioEditor && rendererCanvas) {
      Object.assign(rendererCanvas.style, {
        position: 'absolute',
        left: layout.left + 'px',
        top: layout.top + 'px',
        right: 'auto',
        bottom: 'auto',
        width: layout.width + 'px',
        height: layout.height + 'px',
        clipPath: 'none',
        webkitClipPath: 'none',
      });
      const renderer = window._fumocaGlRenderer || window.renderer;
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const bufferWidth = Math.max(2, Math.round(layout.width * pixelRatio));
      const bufferHeight = Math.max(2, Math.round(layout.height * pixelRatio));
      if (renderer?.setSize) renderer.setSize(layout.width, layout.height, false);
      else {
        rendererCanvas.width = bufferWidth;
        rendererCanvas.height = bufferHeight;
      }
      const activeCamera = getCamera();
      if (activeCamera) {
        activeCamera.aspect = layout.aspectRatio;
        activeCamera.updateProjectionMatrix?.();
      }
    }
    // Keep all camera gestures alive in poster mode. Object placement is a
    // separate direct-manipulation gesture: dragging a Gaussian moves it,
    // while dragging empty canvas orbits/pans the camera.
    if (orbitControls) {
      // In Studio, OrbitControls must only own pointer gestures in Orbit mode.
      // Pan and Move are handled by their dedicated editor interactions; leaving
      // OrbitControls enabled there causes competing gestures and truncated-feeling
      // rotations. The public viewer keeps its normal camera controls enabled.
      const studioMode = window.S?.mode || window._fumocaStudioMode || 'orbit';
      // Studio uses the free-trackball pointer handler below; OrbitControls'\n      // Y-up orbit model cannot roll/tumble freely through all three axes.\n      orbitControls.enabled = !isStudioEditor;
      if ('enableRotate' in orbitControls) orbitControls.enableRotate = true;
      if ('enablePan' in orbitControls) orbitControls.enablePan = true;
      if ('enableZoom' in orbitControls) orbitControls.enableZoom = true;
      // Restore an unrestricted full 360° orbit around the subject, including
      // looking directly over the poles. OrbitControls has no azimuth limit by default.
      if ('minPolarAngle' in orbitControls) orbitControls.minPolarAngle = 0;
      if ('maxPolarAngle' in orbitControls) orbitControls.maxPolarAngle = Math.PI;
      if ('minAzimuthAngle' in orbitControls) orbitControls.minAzimuthAngle = -Infinity;
      if ('maxAzimuthAngle' in orbitControls) orbitControls.maxAzimuthAngle = Infinity;
      if ('rotateSpeed' in orbitControls) orbitControls.rotateSpeed = 1.2;
      const motionLevel = state.composition?.motion?.level || 'still';
      const motionSpeed = ({ gentle: 0.35, normal: 0.8, dynamic: 1.5 })[motionLevel];
      if (motionSpeed !== undefined) {
        orbitControls.autoRotate = true;
        orbitControls.autoRotateSpeed = motionSpeed;
      } else {
        orbitControls.autoRotate = originalAutoRotate ?? false;
        if (originalAutoRotateSpeed !== undefined) orbitControls.autoRotateSpeed = originalAutoRotateSpeed;
      }
    }
    const activeCamera = getCamera();
    if (activeCamera) {
      activeCamera.aspect = layout.aspectRatio;
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
        left: (Math.max(0, Math.min(1, Number(heading.x ?? .5))) * layout.width) + 'px',
        top: (Math.max(0, Math.min(1, Number(heading.y ?? .12))) * layout.height) + 'px',
        width: layout.safe.width + 'px',
        transform: 'translate(-50%, -50%) rotate(' + (Number(heading.rotation) || 0) + 'deg)',
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
  // True arcball/trackball navigation for the Studio poster. Unlike
  // OrbitControls this rotates the camera's complete orientation quaternion,
  // including roll, so the subject can tumble freely around screen X/Y/Z.
  const trackballVector = (clientX, clientY) => {
    if (!posterBounds) return null;
    const width = Math.max(1, posterBounds.right - posterBounds.left);
    const height = Math.max(1, posterBounds.bottom - posterBounds.top);
    const x = ((clientX - posterBounds.left) / width) * 2 - 1;
    const y = 1 - ((clientY - posterBounds.top) / height) * 2;
    const d = x * x + y * y;
    const z = d <= 1 ? Math.sqrt(1 - d) : 0;
    const THREE = window.THREE;
    const vector = THREE?.Vector3
      ? new THREE.Vector3(x, y, z)
      : getCamera()?.position?.clone?.().set(x, y, z);
    return vector?.normalize?.() || null;
  };
  const onTrackballDown = event => {
    if (!isStudioEditor || event.button !== 0 || event.altKey || !posterBounds) return;
    const mode = window.S?.mode || window._fumocaStudioMode || 'orbit';
    if (mode !== 'orbit') return;
    if (event.target?.closest?.('[data-fumoca-poster-title],[data-poster-asset-id],[aria-label^="Resize "],[aria-label^="Rotate "],#fumocaPosterEditorOverlay .fpe-control,button,input,select,textarea')) return;
    if (event.clientX < posterBounds.left || event.clientX > posterBounds.right ||
        event.clientY < posterBounds.top || event.clientY > posterBounds.bottom) return;
    const activeCamera = getCamera();
    const Quaternion = activeCamera?.quaternion?.constructor;
    if (!activeCamera?.position || !activeCamera?.quaternion || typeof Quaternion !== 'function' ||
        typeof activeCamera.quaternion.clone !== 'function') return;
    const point = trackballVector(event.clientX, event.clientY);
    if (!point) return;
    trackballGesture = {
      pointerId: event.pointerId,
      // Keep trackball points in the gesture's starting camera space. Reusing
      // the newly rotated camera quaternion for the previous point compounds
      // the transform and causes the drag to collapse into a constrained orbit.
      previous: point.clone(),
      startQuaternion: activeCamera.quaternion.clone(),
      target: orbitControls?.target?.clone?.() || null,
    };
    try { host.setPointerCapture?.(event.pointerId); } catch (_) {}
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const onTrackballMove = event => {
    if (!trackballGesture || event.pointerId !== trackballGesture.pointerId) return;
    const activeCamera = getCamera();
    const current = trackballVector(event.clientX, event.clientY);
    if (!activeCamera || !current) return;
    // Build the incremental arcball delta in the original camera frame, then
    // conjugate it into world space so yaw, pitch AND roll remain unrestricted.
    const Quaternion = activeCamera.quaternion?.constructor;
    if (typeof Quaternion !== 'function') return;
    const deltaCamera = new Quaternion()
      .setFromUnitVectors(current, trackballGesture.previous);
    const base = trackballGesture.startQuaternion;
    const deltaWorld = base.clone().multiply(deltaCamera).multiply(base.clone().invert());
    const target = trackballGesture.target || orbitControls?.target;
    if (target && activeCamera.position?.sub && activeCamera.position?.add) {
      const offset = activeCamera.position.clone().sub(target).applyQuaternion(deltaWorld);
      activeCamera.position.copy(target).add(offset);
    }
    activeCamera.quaternion.premultiply(deltaWorld).normalize();
    if (activeCamera.up?.applyQuaternion) activeCamera.up.applyQuaternion(deltaWorld).normalize();
    activeCamera.updateMatrixWorld?.();
    trackballGesture.previous.copy(current);
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const onTrackballUp = event => {
    if (!trackballGesture || event.pointerId !== trackballGesture.pointerId) return;
    trackballGesture = null;
    try { host.releasePointerCapture?.(event.pointerId); } catch (_) {}
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  if (isStudioEditor) {
    host.addEventListener('pointerdown', onTrackballDown, true);
    host.addEventListener('pointermove', onTrackballMove, true);
    host.addEventListener('pointerup', onTrackballUp, true);
    host.addEventListener('pointercancel', onTrackballUp, true);
  }

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
