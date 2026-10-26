/**
 * Public viewer + showroom: same Spark engine as Studio Photoreal.
 */
import * as THREE from 'three';

const SparkViewerBridge = (() => {
  let _renderer, _scene, _camera, _spark, _mesh, _controls, _raf, _resize;

  function destroy() {
    if (_raf) cancelAnimationFrame(_raf);
    _raf = 0;
    if (_resize) window.removeEventListener('resize', _resize);
    _resize = null;
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
    window._fumocaSparkPublicActive = false;
  }

  async function mount(hostEl, { fileBytes = null, fileName = 'scene.ply', url = null } = {}) {
    if (!hostEl) throw new Error('SparkViewer: no host');
    destroy();
    const w = Math.max(2, hostEl.clientWidth || window.innerWidth);
    const h = Math.max(2, hostEl.clientHeight || window.innerHeight);
    _renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    _renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    _renderer.setSize(w, h, false);
    _renderer.setClearColor(0x05070b, 1);
    _renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;';
    hostEl.appendChild(_renderer.domElement);
    window._fumocaCaptureCanvas = _renderer.domElement;
    _scene = new THREE.Scene();
    _camera = new THREE.PerspectiveCamera(50, w / h, 0.01, 500);
    _camera.position.set(0, 1.15, 3);
    _camera.up.set(0, -1, -0.6).normalize();
    const { SparkRenderer, SplatMesh } = await import('@sparkjsdev/spark');
    _spark = new SparkRenderer({ renderer: _renderer, premultipliedAlpha: true });
    _scene.add(_spark);
    const opts = { fileName };
    if (url) opts.url = url;
    else if (fileBytes) opts.fileBytes = fileBytes instanceof Uint8Array ? fileBytes : new Uint8Array(fileBytes);
    else throw new Error('SparkViewer needs url or fileBytes');
    _mesh = new SplatMesh(opts);
    _mesh.name = 'fumoca-spark-public';
    _scene.add(_mesh);
    try {
      const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
      _controls = new OrbitControls(_camera, _renderer.domElement);
      _controls.enableDamping = true;
      _controls.dampingFactor = 0.06;
      _controls.minDistance = 0.04;
      _controls.maxDistance = 100;
      _controls.target.set(0, 0, 0);
    } catch (e) { console.warn('[Viewer] OrbitControls unavailable', e); }
    _resize = () => {
      if (!_renderer || !_camera) return;
      const ww = Math.max(2, hostEl.clientWidth || window.innerWidth);
      const hh = Math.max(2, hostEl.clientHeight || window.innerHeight);
      _camera.aspect = ww / hh; _camera.updateProjectionMatrix(); _renderer.setSize(ww, hh, false);
    };
    window.addEventListener('resize', _resize);
    const loop = () => { _raf = requestAnimationFrame(loop); _controls?.update?.(); _renderer?.render(_scene, _camera); };
    loop();
    window._fumocaViewerCamera = _camera;
    window._fumocaGlRenderer = _renderer;
    window._fumocaSparkPublicActive = true;
    console.log('[Viewer] Spark solid — same engine as Studio Photoreal', fileName);
    return true;
  }
  return { mount, destroy, isActive: () => !!_mesh };
})();
window.FumocaSparkViewer = SparkViewerBridge;
export default SparkViewerBridge;
