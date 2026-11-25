/**
 * Public viewer + showroom: same Spark engine as Studio Photoreal.
 * Fixes: stuck Loading overlay, camera miss after async PLY init.
 */
import * as THREE from 'three';

const SparkViewerBridge = (() => {
  let _renderer, _scene, _camera, _spark, _mesh, _controls, _raf, _resize, _resizeObserver, _focusCenter, _lastProgressLog = -1;
  let _presentation = {}, _userAdjustedCamera = false, _fitDistance = 1;

  function destroy() {
    if (_raf) cancelAnimationFrame(_raf);
    _raf = 0;
    if (_resize) window.removeEventListener('resize', _resize);
    _resize = null;
    try { _resizeObserver?.disconnect?.(); } catch (_) {}
    _resizeObserver = null;
    _presentation = {};
    _userAdjustedCamera = false;
    _fitDistance = 1;
    if (window._fumocaViewerControls === _controls) delete window._fumocaViewerControls;
    if (window._fumocaControls === _controls) delete window._fumocaControls;
    if (window._fumocaViewerCamera === _camera) delete window._fumocaViewerCamera;
    if (window._fumocaCamera === _camera) delete window._fumocaCamera;
    try { _controls?.dispose?.(); } catch (_) {}
    _controls = null;
    if (_mesh && _scene) { try { _scene.remove(_mesh); _mesh.dispose?.(); } catch (_) {} }
    _mesh = null;
    if (_spark && _scene) { try { _scene.remove(_spark); _spark.dispose?.(); } catch (_) {} }
    _spark = null;
    if (_renderer) {
      try { _renderer.dispose(); _renderer.domElement?.remove(); } catch (_) {}
      _renderer = null;
    }
    _scene = _camera = null;
    _focusCenter = null;
    window._fumocaSparkPublicActive = false;
  }

  function forceHideAllLoaders() {
    const ids = ['loadingOverlay', 'fumocLoadingOverlay', 'stageFreeze', 'stageFreezeEl'];
    for (const id of ids) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.classList.add('hidden');
      el.style.setProperty('display', 'none', 'important');
      el.style.setProperty('opacity', '0', 'important');
      el.style.setProperty('visibility', 'hidden', 'important');
      el.style.setProperty('pointer-events', 'none', 'important');
    }
    try {
      document.querySelectorAll('.spinner, #loadingText, #fumocLoadMsg').forEach((n) => {
        const p = n.closest('#loadingOverlay, #fumocLoadingOverlay');
        if (p) {
          p.classList.add('hidden');
          p.style.setProperty('display', 'none', 'important');
        }
      });
    } catch (_) {}
    try { document.body.classList.remove('media-flat', 'is-loading'); } catch (_) {}
  }

  function fitCameraToMesh() {
    if (!_mesh || !_camera) return false;
    let bounds = null;
    try { bounds = _mesh.getBoundingBox?.(); } catch (_) {}
    if (!bounds || bounds.isEmpty?.()) {
      // Fallback: try sphere
      try {
        const sphere = _mesh.getBoundingSphere?.();
        if (sphere && sphere.radius > 1e-6) {
          bounds = new THREE.Box3().setFromCenterAndSize(
            sphere.center,
            new THREE.Vector3(sphere.radius * 2, sphere.radius * 2, sphere.radius * 2),
          );
        }
      } catch (_) {}
    }
    if (!bounds || bounds.isEmpty?.()) return false;

    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z, 0.05) * 0.5;
    const fov = THREE.MathUtils.degToRad(_camera.fov || 50);
    const aspect = Math.max(0.1, _camera.aspect || 1);
    const horizontalFov = 2 * Math.atan(Math.tan(fov * 0.5) * aspect);
    // Fit against the narrower field of view so portrait and narrow embeds
    // never crop the subject. APE padding is a multiplier around the bounds.
    const limitingFov = Math.min(fov, horizontalFov);
    const padding = THREE.MathUtils.clamp(Number(_presentation.framePadding) || 1.55, 1.05, 3.5);
    const initialZoom = THREE.MathUtils.clamp(Number(_presentation.initialZoom) || 1, 0.25, 4);
    const baseDistance = Math.max((radius / Math.tan(limitingFov * 0.5)) * padding, radius * 2.2, 0.15);
    _fitDistance = baseDistance;
    const distance = baseDistance / initialZoom;

    _focusCenter = center.clone();
    // Place camera on a diagonal so thin objects (shoes) aren't edge-on
    const dir = new THREE.Vector3(0.35, 0.25, 1).normalize();
    _camera.up.set(0, 1, 0);
    _camera.position.copy(center).addScaledVector(dir, distance);
    _camera.near = Math.max(distance / 2000, 0.0005);
    _camera.far = Math.max(distance * 200, 500);
    _camera.updateProjectionMatrix();
    _camera.lookAt(center);
    if (_controls) {
      _controls.target.copy(center);
      // Zoom is publisher-configurable while remaining unrestricted by default.
      const minZoom = Number.isFinite(Number(_presentation.minZoom)) ? THREE.MathUtils.clamp(Number(_presentation.minZoom), 0.05, 1) : 0;
      const maxZoom = Number.isFinite(Number(_presentation.maxZoom)) ? THREE.MathUtils.clamp(Number(_presentation.maxZoom), 1, 30) : Infinity;
      _controls.minDistance = maxZoom === Infinity ? 0 : _fitDistance / maxZoom;
      _controls.maxDistance = minZoom === 0 ? Infinity : _fitDistance / minZoom;
      _controls.update?.();
    }
    console.info('[Viewer] Spark camera fitted', {
      center: center.toArray().map((v) => +v.toFixed(3)),
      radius: +radius.toFixed(3),
      distance: +distance.toFixed(3),
    });
    return true;
  }

  async function mount(hostEl, { fileBytes = null, fileName = 'scene.ply', url = null, presentation = {} } = {}) {
    if (!hostEl) throw new Error('SparkViewer: no host');
    destroy();
    _lastProgressLog = -1;
    _presentation = { ...presentation };

    // Ensure host can show canvas above any residual overlays
    try {
      hostEl.style.position = hostEl.style.position || 'relative';
      hostEl.style.zIndex = hostEl.style.zIndex || '2';
      hostEl.style.width = hostEl.style.width || '100%';
      hostEl.style.height = hostEl.style.height || '100%';
      hostEl.style.minWidth = '0';
      hostEl.style.minHeight = '0';
      hostEl.style.overflow = 'hidden';
      hostEl.style.contain = 'layout paint size';
    } catch (_) {}

    const w = Math.max(2, hostEl.clientWidth || window.innerWidth);
    const h = Math.max(2, hostEl.clientHeight || window.innerHeight);

    _renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    });
    _renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    _renderer.setSize(w, h, false);
    _renderer.setClearColor(0x05070b, 1);
    _renderer.domElement.style.cssText =
      'display:block;width:100%;height:100%;touch-action:none;position:relative;z-index:3;';
    hostEl.appendChild(_renderer.domElement);
    window._fumocaCaptureCanvas = _renderer.domElement;

    _scene = new THREE.Scene();
    _camera = new THREE.PerspectiveCamera(50, w / h, 0.001, 2000);
    _camera.position.set(0, 1.2, 3);
    _camera.up.set(0, 1, 0);

    const { SparkRenderer, SplatMesh } = await import('@sparkjsdev/spark');
    _spark = new SparkRenderer({ renderer: _renderer, premultipliedAlpha: true });
    _scene.add(_spark);

    const opts = { fileName };
    if (url) opts.url = url;
    else if (fileBytes) {
      opts.fileBytes = fileBytes instanceof Uint8Array ? fileBytes : new Uint8Array(fileBytes);
    } else {
      throw new Error('SparkViewer needs url or fileBytes');
    }

    _mesh = new SplatMesh({
      ...opts,
      onProgress: (event) => {
        if (!event?.lengthComputable) return;
        const pct = Math.round((event.loaded / Math.max(1, event.total)) * 100);
        const bucket = Math.floor(pct / 10) * 10;
        if (bucket >= _lastProgressLog + 10 || pct === 100) {
          _lastProgressLog = bucket;
          console.info('[Viewer] Spark companion download', pct + '%');
        }
      },
    });
    _mesh.name = 'fumoca-spark-public';
    _scene.add(_mesh);

    // Wait until Gaussians are real GPU content
    if (_mesh.initialized) await _mesh.initialized;
    if (_mesh.isInitialized === false) {
      throw new Error('Spark finished without initializing the Gaussian mesh');
    }

    console.info('[Viewer] Spark Gaussian mesh initialized', {
      splats: _mesh.numSplats,
      fileName,
    });

    // Controls first, then frame
    try {
      const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
      _controls = new OrbitControls(_camera, _renderer.domElement);
      _controls.enableDamping = true;
      _controls.dampingFactor = THREE.MathUtils.clamp(Number(_presentation.dampingFactor) || 0.08, 0.02, 0.2);
      _controls.addEventListener('start', () => { _userAdjustedCamera = true; });
      _controls.minDistance = 0.02;
      _controls.maxDistance = 500;
    } catch (e) {
      console.warn('[Viewer] OrbitControls unavailable', e);
    }

    // Fit now + again next frames (bounds sometimes settle after first draw)
    fitCameraToMesh();
    requestAnimationFrame(() => {
      fitCameraToMesh();
      forceHideAllLoaders();
    });
    setTimeout(() => {
      fitCameraToMesh();
      forceHideAllLoaders();
    }, 120);
    setTimeout(() => {
      fitCameraToMesh();
      forceHideAllLoaders();
    }, 400);

    _resize = () => {
      if (!_renderer || !_camera || !hostEl) return;
      const ww = Math.max(2, hostEl.clientWidth || window.innerWidth);
      const hh = Math.max(2, hostEl.clientHeight || window.innerHeight);
      const dpr = Math.min(window.devicePixelRatio || 1, Number(_presentation.maxDpr) || 2);
      _renderer.setPixelRatio(dpr);
      _camera.aspect = ww / hh;
      _camera.updateProjectionMatrix();
      _renderer.setSize(ww, hh, false);
      // Refit only before the visitor takes control; never fight their camera.
      if (!_userAdjustedCamera && _mesh) fitCameraToMesh();
    };
    window.addEventListener('resize', _resize, { passive: true });
    if (typeof ResizeObserver !== 'undefined') {
      _resizeObserver = new ResizeObserver(() => _resize?.());
      _resizeObserver.observe(hostEl);
    }

    const loop = () => {
      _raf = requestAnimationFrame(loop);
      try { _controls?.update?.(); } catch (_) {}
      try { _renderer.render(_scene, _camera); } catch (_) {}
    };
    loop();

    // Publish one stable camera/controls contract for hotspots, tours and viewer tools.
    window._fumocaViewerCamera = _camera;
    window._fumocaViewerControls = _controls;
    window._fumocaCamera = _camera;
    window._fumocaControls = _controls;
    window._fumocaGlRenderer = _renderer;
    window._fumocaSparkPublicActive = true;
    forceHideAllLoaders();
    console.log('%c[Viewer] Spark solid — same engine as Studio Photoreal', 'color:#c8ff00;font-weight:700', fileName);
    return true;
  }

  return { mount, destroy, isActive: () => !!_mesh, refit: fitCameraToMesh };
})();

window.FumocaSparkViewer = SparkViewerBridge;
export default SparkViewerBridge;
