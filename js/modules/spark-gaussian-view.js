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
    // Do not hide the editor preview until Spark has finished decoding the file.
    if (_mesh.initialized) await _mesh.initialized;
    _sourceKey = key;
    return _mesh;
  }


  let _originalBytes = null;
  let _syncQueued = false;
  let _lastAliveSignature = '';

  function _filterBinaryPlyByAlive(bytes, alive) {
    const src = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const headerEnd = (() => {
      const marker = new TextEncoder().encode('end_header\n');
      for (let i = 0; i <= src.length - marker.length; i++) {
        let match = true;
        for (let j = 0; j < marker.length; j++) {
          if (src[i + j] !== marker[j]) { match = false; break; }
        }
        if (match) return i + marker.length;
      }
      return -1;
    })();
    if (headerEnd < 0) throw new Error('PLY header terminator not found');

    const header = new TextDecoder().decode(src.subarray(0, headerEnd));
    if (!/^format binary_little_endian 1\.0$/m.test(header)) {
      throw new Error('Safe edit-sync currently requires binary_little_endian PLY');
    }
    const vertexMatch = header.match(/^element vertex (\d+)$/m);
    if (!vertexMatch) throw new Error('PLY vertex element not found');
    const vertexCount = Number(vertexMatch[1]);
    if (!alive || alive.length !== vertexCount) {
      throw new Error('Safe edit-sync stopped: editor mask length ' + (alive?.length ?? 'missing') + ' does not match PLY vertex count ' + vertexCount);
    }

    const types = {
      char: 1, int8: 1, uchar: 1, uint8: 1,
      short: 2, int16: 2, ushort: 2, uint16: 2,
      int: 4, int32: 4, uint: 4, uint32: 4,
      float: 4, float32: 4, double: 8, float64: 8
    };
    let inVertex = false;
    let rowBytes = 0;
    for (const line of header.split(/\r?\n/)) {
      if (line.startsWith('element ')) {
        inVertex = /^element vertex \d+$/.test(line);
        continue;
      }
      if (inVertex && line.startsWith('property ')) {
        const parts = line.trim().split(/\s+/);
        if (parts[1] === 'list') {
          throw new Error('PLY vertex list properties are not supported by safe edit-sync');
        }
        const size = types[parts[1]];
        if (!size) throw new Error('Unsupported PLY scalar type: ' + parts[1]);
        rowBytes += size;
      }
    }
    if (!rowBytes) throw new Error('No scalar vertex properties found');
    const dataEnd = headerEnd + vertexCount * rowBytes;
    if (dataEnd > src.length) throw new Error('PLY vertex data is truncated');
    // This first prototype deliberately rejects trailing elements rather than
    // silently dropping face/other element data when rebuilding the file.
    if (dataEnd !== src.length) {
      throw new Error('PLY has trailing data/elements; safe edit-sync refuses to rewrite it');
    }

    const kept = [];
    for (let i = 0; i < vertexCount; i++) if (alive[i]) kept.push(i);
    const newHeader = header.replace(/^element vertex \d+$/m, 'element vertex ' + kept.length);
    const head = new TextEncoder().encode(newHeader);
    const out = new Uint8Array(head.length + kept.length * rowBytes);
    out.set(head, 0);
    let at = head.length;
    for (const i of kept) {
      const row = src.subarray(headerEnd + i * rowBytes, headerEnd + (i + 1) * rowBytes);
      out.set(row, at);
      at += rowBytes;
    }
    return out;
  }

  async function syncEditorState(state = window.S || window._fumocaState) {
    if (!_enabled || !_originalBytes || !state?.alive || _loading) return false;
    const signature = Array.from(state.alive, v => v ? '1' : '0').join('');
    if (signature === _lastAliveSignature) return true;
    _loading = true;
    try {
      const filtered = _filterBinaryPlyByAlive(_originalBytes, state.alive);
      const name = state.fileName || 'edited.ply';
      await loadFromBytes(filtered, name);
      _lastAliveSignature = signature;
      console.info('[FUMOCA] Spark synced to editor alive mask', {
        originalCount: state.alive.length,
        remaining: state.alive.reduce((n, v) => n + (v ? 1 : 0), 0)
      });
      return true;
    } catch (error) {
      console.error('[FUMOCA] Spark edit-sync safely refused to apply mask', error);
      return false;
    } finally {
      _loading = false;
    }
  }

  function _scheduleEditorSync() {
    if (_syncQueued) return;
    _syncQueued = true;
    queueMicrotask(() => {
      _syncQueued = false;
      syncEditorState();
    });
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
      _originalBytes = bytes instanceof Uint8Array ? new Uint8Array(bytes) : new Uint8Array(bytes.slice ? bytes.slice(0) : bytes);
      _lastAliveSignature = '';
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

  window.addEventListener('fumoca:rebuildGeometry', _scheduleEditorSync);
  window.addEventListener('fumoca:selectionChanged', _scheduleEditorSync);

  function dispose() {
    disable();
    const scene = _scene();
    if (_spark && scene) {
      try { scene.remove(_spark); } catch (_) {}
      try { _spark.dispose?.(); } catch (_) {}
      _spark = null;
    }
  }

  return { enable, disable, isEnabled, isAvailable, loadFromBytes, syncEditorState, dispose };
})();

window.FumocaSparkGaussian = SparkGaussianView;
export default SparkGaussianView;
