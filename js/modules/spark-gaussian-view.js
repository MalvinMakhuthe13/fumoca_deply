/**
 * FUMOCA Spark Gaussian View
 * Native Gaussian rendering for trained Gaussian PLY and .splat files.
 * Uses FUMOCA's existing Three.js scene, camera and WebGLRenderer.
 */
import * as THREE from 'three';

const SparkGaussianView = (() => {
  let _spark = null;
  let _mesh = null;
  let _enabled = false;
  let _loading = false;
  let _sourceKey = '';

  function _scene() {
    return window._fumocaScene || window.scene || null;
  }
  function _renderer() {
    return window._fumocaGlRenderer || window.renderer || null;
  }
  function _pointsObject() {
    return window.S?.points || window.points || window._pointsMesh || window.S?.pointsMesh || null;
  }

  async function _ensureSpark() {
    if (_spark) return _spark;
    const renderer = _renderer();
    const scene = _scene();
    if (!renderer || !scene) throw new Error('FUMOCA scene/renderer is not ready');
    const { SparkRenderer } = await import('@sparkjsdev/spark');
    _spark = new SparkRenderer({ renderer, autoUpdate: true });
    _spark.name = 'fumoca-spark-renderer';
    scene.add(_spark);
    return _spark;
  }

  function _hideLegacy(hide) {
    // Only hide the editor's own point preview. Do not hide every THREE.Points
    // object in the scene; other tools may own unrelated point clouds.
    const pts = _pointsObject();
    if (!pts) return;
    pts.userData ||= {};
    if (hide) {
      if (pts.userData._sparkPrevVisible === undefined) {
        pts.userData._sparkPrevVisible = pts.visible;
      }
      pts.visible = false;
    } else if (pts.userData._sparkPrevVisible !== undefined) {
      pts.visible = pts.userData._sparkPrevVisible;
      delete pts.userData._sparkPrevVisible;
    }
  }

  async function loadFromBytes(bytes, fileName = 'scene.ply') {
    await _ensureSpark();
    const scene = _scene();
    if (!scene) throw new Error('FUMOCA scene is unavailable');

    if (_mesh) {
      scene.remove(_mesh);
      _mesh.dispose?.();
      _mesh = null;
    }

    const { SplatMesh } = await import('@sparkjsdev/spark');
    const fileBytes = bytes instanceof ArrayBuffer
      ? new Uint8Array(bytes.slice(0))
      : bytes instanceof Uint8Array
        ? new Uint8Array(bytes)
        : new Uint8Array(bytes);
    const key = fileName + ':' + fileBytes.byteLength;
    _mesh = new SplatMesh({
      fileBytes,
      fileName,
      onLoad: () => console.info('[FUMOCA] Spark Gaussian data loaded:', fileName),
    });
    _mesh.name = 'fumoca-spark-splat';
    scene.add(_mesh);
    _sourceKey = key;
    return _mesh;
  }

  async function enable(opts = {}) {
    if (_loading) return false;
    _loading = true;
    try {
      const S = window.S || {};
      const bytes = opts.bytes || S.gaussianSourceBytes || window._fumocaLastGaussianBytes || null;
      const name = opts.fileName || S.fileName || 'export.ply';
      if (!bytes || !(S.isGaussianPly || S.fileType === 'splat' || /\.splat$/i.test(name))) {
        console.warn('[FUMOCA] Spark requires original Gaussian PLY or SPLAT bytes.');
        return false;
      }
      await loadFromBytes(bytes, name);
      _hideLegacy(true);
      _enabled = true;
      console.info('[FUMOCA] Spark renderer enabled', { fileName: name, bytes: bytes.byteLength ?? bytes.length });
      return true;
    } catch (error) {
      console.error('[FUMOCA] Spark renderer could not load the source file', error);
      _enabled = false;
      _hideLegacy(false);
      if (_mesh) {
        try { _scene()?.remove(_mesh); _mesh.dispose?.(); } catch (_) {}
        _mesh = null;
      }
      return false;
    } finally {
      _loading = false;
    }
  }

  function disable() {
    _enabled = false;
    _hideLegacy(false);
    const scene = _scene();
    if (_mesh && scene) {
      try { scene.remove(_mesh); } catch (_) {}
      try { _mesh.dispose?.(); } catch (_) {}
      _mesh = null;
    }
  }

  function isEnabled() { return _enabled; }
  function isAvailable() { return true; }

  function dispose() {
    disable();
    const scene = _scene();
    if (_spark && scene) {
      try { scene.remove(_spark); } catch (_) {}
      try { _spark.dispose?.(); } catch (_) {}
      _spark = null;
    }
  }

  return { enable, disable, isEnabled, isAvailable, loadFromBytes, dispose };
})();

window.FumocaSparkGaussian = SparkGaussianView;
export default SparkGaussianView;
