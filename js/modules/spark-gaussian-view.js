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
    _spark = new SparkRenderer({ renderer, autoUpdate: true });
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
      const material = new THREE.PointsMaterial({ size: 0.025, sizeAttenuation: true, vertexColors: true, transparent: true, opacity: 1, depthTest: true });
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
    return { src, header, headerEnd, count, rowBytes, xyz };
  }

  function _stateSignature(state) {
    // Compact hash avoids retaining a giant string for every point in the scene.
    let h1 = 2166136261, h2 = 0;
    for (let i = 0; i < state.alive.length; i++) {
      h1 = Math.imul(h1 ^ (state.alive[i] ? 1 : 0), 16777619);
      if (state.alive[i]) {
        for (let k=0;k<3;k++) {
          const v = Math.fround(state.positions[i*3+k]);
          const n = Number.isFinite(v) ? Math.round(v * 100000) : 0;
          h2 = Math.imul(h2 ^ n, 16777619);
        }
      }
    }
    return state.alive.length + ':' + (h1 >>> 0) + ':' + (h2 >>> 0);
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
    if (_mesh) { scene.remove(_mesh); _mesh.dispose?.(); _mesh = null; }
    const fileBytes = bytes instanceof Uint8Array ? new Uint8Array(bytes) : new Uint8Array(bytes.slice ? bytes.slice(0) : bytes);
    _mesh = new SplatMesh({ fileBytes, fileName, onLoad: () => console.info('[FUMOCA] Spark Gaussian data loaded:', fileName) });
    _mesh.name = 'fumoca-spark-splat';
    scene.add(_mesh);
    if (_mesh.initialized) await _mesh.initialized;
    return _mesh;
  }

  async function syncEditorState(state = window.S) {
    if (!_enabled || !_originalBytes || !state?.alive || !state?.positions || _loading) return false;
    const signature = _stateSignature(state);
    _updateSelectionOverlay(state);
    _hideLegacy();
    if (signature === _lastStateSignature) return true;
    _loading = true;
    try {
      const edited = _makeEditedBytes(state);
      await loadFromBytes(edited, _lastFileName);
      _lastStateSignature = signature;
      console.info('[FUMOCA] Spark synced with editor state', {
        originalCount: state.alive.length,
        remaining: state.alive.reduce((n,v)=>n+(v?1:0),0)
      });
      return true;
    } catch (error) {
      console.error('[FUMOCA] Spark editor sync refused to apply changes safely', error);
      return false;
    } finally {
      _loading = false;
      _hideLegacy();
      _updateSelectionOverlay(state);
    }
  }

  function refreshEditorState(state = window.S) {
    if (!_enabled || !state) return;
    _hideLegacy();
    _updateSelectionOverlay(state);
    if (_syncQueued) return;
    _syncQueued = true;
    requestAnimationFrame(() => {
      _syncQueued = false;
      syncEditorState(state);
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
  function isEnabled() { return _enabled; }
  function isAvailable() { return true; }
  function dispose() {
    disable();
    if (_spark) { try { _scene()?.remove(_spark); _spark.dispose?.(); } catch (_) {} _spark = null; }
  }

  return { enable, disable, isEnabled, isAvailable, loadFromBytes, syncEditorState, refreshEditorState, dispose };
})();
window.FumocaSparkGaussian = SparkGaussianView;
export default SparkGaussianView;
