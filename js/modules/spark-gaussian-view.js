import { makeEditedGaussianPlyBytes } from './gaussian-ply-edit.js';
import { applyEditorStateToPackedSplats } from './spark-state-sync.js';
/**
 * FUMOCA Spark Gaussian View + editor bridge.
 * Spark renders the original Gaussian data; FUMOCA remains the source of truth
 * for selection, deletion and transformed positions.
 */
const SparkGaussianView = (() => {
  let _spark = null, _mesh = null, _overlay = null;
  let _enabled = false, _loading = false, _syncQueued = false;
  let _originalBytes = null, _lastStateSignature = '';
  let _lastFileName = 'export.ply';

  function _scene() { return window._fumocaScene || window.scene || null; }
  function _renderer() { return window._fumocaGlRenderer || window.renderer || null; }
  function _pointsObject() { return window.S?.points || window.points || window._pointsMesh || window.S?.pointsMesh || null; }

  async function _ensureSpark() {
    if (_spark) return _spark;
    const renderer = _renderer(), scene = _scene();
    if (!renderer || !scene) throw new Error('FUMOCA scene/renderer is not ready');
    const { SparkRenderer } = await import('@sparkjsdev/spark');
    // Fidelity preset tuned for a sharper SuperSplat-like result:
    // tighter Gaussian cutoff, no added covariance blur, and depth sorting.
    _spark = new SparkRenderer({
      renderer,
      autoUpdate: true,
      maxStdDev: Math.sqrt(6),
      preBlurAmount: 0,
      blurAmount: 0,
      focalAdjustment: 1.5,
      sortRadial: false
    });
    _spark.name = 'fumoca-spark-renderer';
    scene.add(_spark);
    return _spark;
  }

  function _hideLegacy() {
    const pts = _pointsObject();
    if (pts) pts.visible = !_enabled;
  }

  function _updateSelectionOverlay(state = window.S) {
    const scene = _scene();
    if (!scene || !state?.positions || !state?.alive || !state?.selected) return;
    const positions = [], colors = [];
    for (let i = 0; i < state.alive.length; i++) {
      if (!state.alive[i] || !state.selected[i] || state.layerHidden?.[i]) continue;
      positions.push(state.positions[i*3], state.positions[i*3+1], state.positions[i*3+2]);
      colors.push(0.78, 1.0, 0.0);
    }
    if (!_overlay) {
      const THREE = window.THREE;
      if (!THREE?.BufferGeometry || !THREE?.PointsMaterial || !THREE?.Points) return;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute([], 3));
      const material = new THREE.PointsMaterial({ size: 6, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 1, depthTest: true });
      _overlay = new THREE.Points(geometry, material);
      _overlay.name = 'fumoca-spark-selection-overlay';
      _overlay.renderOrder = 20;
      scene.add(_overlay);
    }
    const THREE = window.THREE;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const previous = _overlay.geometry;
    _overlay.geometry = geometry;
    previous?.dispose?.();
    _overlay.visible = _enabled && positions.length > 0;
  }

  function _stateSignature(state) {
    // Include every Gaussian property that the editor can change.
    let hash = 2166136261;
    const mix = value => { hash = Math.imul(hash ^ (value | 0), 16777619); };
    mix(state.alive.length);
    mix(state.rotationOrder === 'xyzw' ? 1 : 0);
    for (let i = 0; i < state.alive.length; i++) {
      mix(state.alive[i] ? 1 : 0);
      const arrays = [state.positions, state.scaleXYZ, state.rotation, state.opacity, state.colors, state.paintColors];
      for (const array of arrays) {
        if (!array) { mix(0); continue; }
        const stride = array === state.positions || array === state.scaleXYZ || array === state.colors || array === state.paintColors ? 3
          : array === state.rotation ? 4 : 1;
        for (let k = 0; k < stride; k++) {
          const value = Number(array[i * stride + k] ?? 0);
          mix(Number.isFinite(value) ? Math.round(Math.fround(value) * 100000) : 0);
        }
      }
    }
    return state.alive.length + ':' + (hash >>> 0);
  }

  async function loadFromBytes(bytes, fileName = 'scene.ply') {
    await _ensureSpark();
    const scene = _scene();
    const { SplatMesh } = await import('@sparkjsdev/spark');
    const fileBytes = bytes instanceof Uint8Array ? new Uint8Array(bytes) : new Uint8Array(bytes.slice ? bytes.slice(0) : bytes);
    const previous = _mesh;
    const candidate = new SplatMesh({
      fileBytes, fileName, enableLod: false,
      onLoad: () => console.info('[FUMOCA] Spark Gaussian data loaded:', fileName)
    });
    candidate.name = 'fumoca-spark-splat';
    candidate.visible = false;
    scene.add(candidate);
    try {
      await candidate.initialized;
      // Swap only after Spark has completely decoded the replacement. A failed
      // load must never remove the last known-good visible mesh.
      candidate.visible = true;
      _mesh = candidate;
      if (previous) { scene.remove(previous); previous.dispose?.(); }
      return candidate;
    } catch (error) {
      scene.remove(candidate);
      candidate.dispose?.();
      throw error;
    }
  }

  function syncEditorState(state = window.S, indices = null) {
    if (!_enabled || !_mesh || !state?.alive || !state?.positions) return false;
    _updateSelectionOverlay(state);
    const result = applyEditorStateToPackedSplats(_mesh, state, indices, window.THREE);
    if (!result.ok) {
      console.error('[FUMOCA] Live Spark update rejected:', result.reason);
      return false;
    }
    if (indices == null) _lastStateSignature = _stateSignature(state);
    return true;
  }

  // Kept as compatibility hooks for edit.html. They no longer swap renderers:
  // Spark stays visible and receives the same live data as the editor changes.
  function beginEditorGesture() { return _enabled; }
  function endEditorGesture(state = window.S) { return syncEditorState(state); }
  function updateEditorStateLive(state = window.S, indices = null) {
    return syncEditorState(state, indices);
  }

  function refreshEditorState(state = window.S) {
    if (!_enabled || !state) return;
    _updateSelectionOverlay(state);
    if (_syncQueued) return;
    _syncQueued = true;
    requestAnimationFrame(() => {
      _syncQueued = false;
      if (!_enabled) return;
      const signature = _stateSignature(state);
      if (signature !== _lastStateSignature) syncEditorState(state);
    });
  }

  async function enable(opts = {}) {
    if (_loading) return false;
    _loading = true;
    try {
      const S = window.S || {};
      const bytes = opts.bytes || S.gaussianSourceBytes || window._fumocaLastGaussianBytes;
      const name = opts.fileName || S.fileName || 'export.ply';
      if (!bytes || !(S.isGaussianPly || S.fileType === 'splat' || /\.splat$/i.test(name))) {
        console.warn('[FUMOCA] Spark requires original Gaussian PLY or SPLAT bytes.');
        return false;
      }
      _originalBytes = bytes instanceof Uint8Array ? new Uint8Array(bytes) : new Uint8Array(bytes.slice ? bytes.slice(0) : bytes);
      // Preserve the exact original Gaussian source for the publish engine.
      // This is the high-fidelity PLY/SPLAT, not a re-encoded NIF or edited point array.
      S.gaussianSourceBytes = new Uint8Array(_originalBytes);
      window._fumocaLastGaussianBytes = new Uint8Array(_originalBytes);
      _lastFileName = name;
      await loadFromBytes(_originalBytes, name);
      _enabled = true;
      _lastStateSignature = _stateSignature(S);
      _hideLegacy();
      _updateSelectionOverlay(S);
      console.info('[FUMOCA] Spark renderer enabled with editor bridge', { fileName:name, bytes:_originalBytes.byteLength });
      return true;
    } catch (error) {
      console.error('[FUMOCA] Spark renderer could not load the source file', error);
      _enabled = false;
      _hideLegacy();
      if (_mesh) { try { _scene()?.remove(_mesh); _mesh.dispose?.(); } catch (_) {} _mesh = null; }
      return false;
    } finally { _loading = false; }
  }

  function disable() {
    _enabled = false;
    _hideLegacy();
    if (_overlay) { try { _scene()?.remove(_overlay); _overlay.geometry?.dispose?.(); _overlay.material?.dispose?.(); } catch (_) {} _overlay = null; }
    if (_mesh) { try { _scene()?.remove(_mesh); _mesh.dispose?.(); } catch (_) {} _mesh = null; }
  }
  // Export the current edited Gaussian PLY without flattening it to NIF's
  // 14-float preview representation. This preserves SH coefficients and all
  // original per-Gaussian attributes while applying positions, rotations and deletions.
  function exportEditedBytes(state = window.S) {
    if (!_enabled || !_originalBytes) throw new Error('Spark source is not active');
    return makeEditedGaussianPlyBytes(_originalBytes, state);
  }

  function isEnabled() { return _enabled; }
  function isAvailable() { return true; }
  function dispose() {
    disable();
    if (_spark) { try { _scene()?.remove(_spark); _spark.dispose?.(); } catch (_) {} _spark = null; }
  }

  return { enable, disable, isEnabled, isAvailable, loadFromBytes, syncEditorState, refreshEditorState, beginEditorGesture, endEditorGesture, updateEditorStateLive, exportEditedBytes, dispose };
})();
window.FumocaSparkGaussian = SparkGaussianView;
export default SparkGaussianView;
