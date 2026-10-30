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

  function _parseBinaryPly(bytes) {
    const src = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const marker = new TextEncoder().encode('end_header\n');
    let headerEnd = -1;
    for (let i = 0; i <= src.length - marker.length; i++) {
      let match = true;
      for (let j = 0; j < marker.length; j++) if (src[i+j] !== marker[j]) { match = false; break; }
      if (match) { headerEnd = i + marker.length; break; }
    }
    if (headerEnd < 0) throw new Error('PLY header terminator not found');
    const header = new TextDecoder().decode(src.subarray(0, headerEnd));
    if (!/^format binary_little_endian 1\.0$/m.test(header)) throw new Error('Editor sync currently requires binary little-endian PLY');
    const vertexMatch = header.match(/^element vertex (\d+)$/m);
    if (!vertexMatch) throw new Error('PLY vertex element not found');
    const count = Number(vertexMatch[1]);
    const typeInfo = {
      char:[1,'getInt8','setInt8'], int8:[1,'getInt8','setInt8'],
      uchar:[1,'getUint8','setUint8'], uint8:[1,'getUint8','setUint8'],
      short:[2,'getInt16','setInt16'], int16:[2,'getInt16','setInt16'],
      ushort:[2,'getUint16','setUint16'], uint16:[2,'getUint16','setUint16'],
      int:[4,'getInt32','setInt32'], int32:[4,'getInt32','setInt32'],
      uint:[4,'getUint32','setUint32'], uint32:[4,'getUint32','setUint32'],
      float:[4,'getFloat32','setFloat32'], float32:[4,'getFloat32','setFloat32'],
      double:[8,'getFloat64','setFloat64'], float64:[8,'getFloat64','setFloat64']
    };
    let inVertex = false, rowBytes = 0;
    const properties = [];
    for (const line of header.split(/\r?\n/)) {
      if (line.startsWith('element ')) { inVertex = /^element vertex \d+$/.test(line); continue; }
      if (!inVertex || !line.startsWith('property ')) continue;
      const parts = line.trim().split(/\s+/);
      if (parts[1] === 'list') throw new Error('Vertex list properties are unsupported');
      const info = typeInfo[parts[1]];
      if (!info) throw new Error('Unsupported vertex property type: ' + parts[1]);
      properties.push({ name:parts[2], type:parts[1], offset:rowBytes, size:info[0], getter:info[1], setter:info[2] });
      rowBytes += info[0];
    }
    const xyz = ['x','y','z'].map(name => properties.find(p => p.name === name));
    if (xyz.some(p => !p || !['float','float32','double','float64'].includes(p.type))) {
      throw new Error('PLY must contain scalar floating-point x, y, z properties');
    }
    const dataEnd = headerEnd + count * rowBytes;
    if (dataEnd !== src.length) throw new Error('PLY contains trailing elements or unexpected data; safe sync refused');
    const scaleProps = [0, 1, 2].map(i => properties.find(p => p.name === 'scale_' + i));
    const rotationProps = [0, 1, 2, 3].map(i => properties.find(p => p.name === 'rot_' + i));
    const opacityProp = properties.find(p => p.name === 'opacity');
    return { src, header, headerEnd, count, rowBytes, properties, xyz, scaleProps, rotationProps, opacityProp };
  }

  function _stateSignature(state) {
    // Include every Gaussian property that the editor can change. Position-only
    // signatures silently dropped rotation, scale and opacity edits.
    let hash = 2166136261;
    const mix = value => { hash = Math.imul(hash ^ (value | 0), 16777619); };
    mix(state.alive.length);
    for (let i = 0; i < state.alive.length; i++) {
      mix(state.alive[i] ? 1 : 0);
      const arrays = [state.positions, state.scaleXYZ, state.rotation, state.opacity, state.colors];
      for (const array of arrays) {
        if (!array) { mix(0); continue; }
        const stride = array === state.positions || array === state.scaleXYZ || array === state.colors ? 3
          : array === state.rotation ? 4 : 1;
        for (let k = 0; k < stride; k++) {
          const value = Number(array[i * stride + k] ?? 0);
          mix(Number.isFinite(value) ? Math.round(Math.fround(value) * 100000) : 0);
        }
      }
    }
    return state.alive.length + ':' + (hash >>> 0);
  }

  function _makeEditedBytes(state) {
    if (!_originalBytes) throw new Error('Original Gaussian bytes unavailable');
    const parsed = _parseBinaryPly(_originalBytes);
    if (!state?.alive || state.alive.length !== parsed.count || !state.positions || state.positions.length !== parsed.count*3) {
      throw new Error('Editor arrays do not match the original PLY vertex count');
    }
    const rows = [];
    const dataView = new DataView(parsed.src.buffer, parsed.src.byteOffset, parsed.src.byteLength);
    for (let i=0;i<parsed.count;i++) {
      if (!state.alive[i]) continue;
      const row = parsed.src.slice(parsed.headerEnd + i*parsed.rowBytes, parsed.headerEnd + (i+1)*parsed.rowBytes);
      const view = new DataView(row.buffer, row.byteOffset, row.byteLength);
      for (let axis=0;axis<3;axis++) {
        const prop = parsed.xyz[axis], value = state.positions[i*3+axis];
        if (!Number.isFinite(value)) throw new Error('Non-finite transformed position at vertex ' + i);
        view[prop.setter](prop.offset, value, true);
      }
      // FUMOCA stores Gaussian rotations as normalized quaternion w,x,y,z,
      // matching the standard rot_0..rot_3 property order.
      if (state.rotation && parsed.rotationProps.every(Boolean)) {
        let norm = 0;
        for (let axis=0;axis<4;axis++) norm += state.rotation[i*4+axis] ** 2;
        norm = Math.sqrt(norm);
        if (!(norm > 1e-8) || !Number.isFinite(norm)) throw new Error('Invalid Gaussian rotation at vertex ' + i);
        for (let axis=0;axis<4;axis++) {
          const prop = parsed.rotationProps[axis];
          view[prop.setter](prop.offset, state.rotation[i*4+axis] / norm, true);
        }
      }
      rows.push(row);
    }
    const header = parsed.header.replace(/^element vertex \d+$/m, 'element vertex ' + rows.length);
    const headerBytes = new TextEncoder().encode(header);
    const out = new Uint8Array(headerBytes.length + rows.length*parsed.rowBytes);
    out.set(headerBytes);
    let offset = headerBytes.length;
    for (const row of rows) { out.set(row, offset); offset += row.length; }
    return out;
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
    _lastStateSignature = _stateSignature(state);
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
    return _makeEditedBytes(state);
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
