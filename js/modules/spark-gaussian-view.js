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
  let _failureCount = 0, _contextLossBound = false, _loadToken = 0;
  const LOAD_TIMEOUT_MS = 45000;
  // In-place editing: what the current Spark mesh holds, so moves, rotations
  // and deletions can be written straight into it with setSplat instead of
  // re-encoding and re-decoding the whole file (the old lag on big scans).
  let _built = null;
  // View-only cleanup (never changes the data or exports): hide faint haze
  // and oversized floaters, the main cause of a "smoky" look.
  let _filter = { minOpacity: 0, maxScale: Infinity };
  const _passes = (a, sx, sy, sz) => a >= _filter.minOpacity && Math.max(sx, sy, sz) <= _filter.maxScale;

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
    const canvas = renderer.domElement;
    if (canvas && !_contextLossBound) {
      _contextLossBound = true;
      canvas.addEventListener('webglcontextlost', () => {
        if (_enabled) _fallback('The graphics context was lost (GPU reset or memory pressure).');
      });
    }
    return _spark;
  }

  function _hideLegacy() {
    const pts = _pointsObject();
    if (pts) pts.visible = !_enabled;
  }

  // SuperSplat-style selection: fine dots on the selected splats plus a crisp
  // box around the selection, drawn on top so it reads clearly at any zoom.
  let _box = null;
  function _updateSelectionOverlay(state = window.S) {
    const scene = _scene();
    const THREE = window.THREE;
    if (!scene || !THREE?.BufferGeometry || !state?.positions || !state?.alive || !state?.selected) return;
    const positions = [];
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < state.alive.length; i++) {
      if (!state.alive[i] || !state.selected[i] || state.layerHidden?.[i]) continue;
      const x = state.positions[i*3], y = state.positions[i*3+1], z = state.positions[i*3+2];
      positions.push(x, y, z);
      if (x < minX) minX = x; if (y < minY) minY = y; if (z < minZ) minZ = z;
      if (x > maxX) maxX = x; if (y > maxY) maxY = y; if (z > maxZ) maxZ = z;
    }
    if (!_overlay) {
      const material = new THREE.PointsMaterial({ size: 2.5, sizeAttenuation: false, color: 0xffd400, transparent: true, opacity: 0.85, depthTest: false });
      _overlay = new THREE.Points(new THREE.BufferGeometry(), material);
      _overlay.name = 'fumoca-spark-selection-overlay';
      _overlay.renderOrder = 20;
      scene.add(_overlay);
      window.FumocaPresentation?.adoptVisuals?.();
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const previous = _overlay.geometry;
    _overlay.geometry = geometry;
    previous?.dispose?.();
    _overlay.visible = _enabled && positions.length > 0;

    // bounding box outline
    if (THREE.LineSegments && THREE.LineBasicMaterial) {
      if (!_box) {
        _box = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffd400, transparent: true, opacity: 0.9, depthTest: false }));
        _box.name = 'fumoca-spark-selection-box';
        _box.renderOrder = 21;
        scene.add(_box);
      }
      const has = positions.length >= 6;
      _box.visible = _enabled && has;
      if (has) {
        const pad = Math.max(maxX - minX, maxY - minY, maxZ - minZ) * 0.02;
        const x0 = minX - pad, y0 = minY - pad, z0 = minZ - pad, x1 = maxX + pad, y1 = maxY + pad, z1 = maxZ + pad;
        const c = [[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]];
        const e = [0,1,1,2,2,3,3,0,4,5,5,6,6,7,7,4,0,4,1,5,2,6,3,7];
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(e.flatMap(k => c[k]), 3));
        const prev = _box.geometry; _box.geometry = g; prev?.dispose?.();
      }
    }
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

  function _unparent(obj) {
    try { obj?.parent?.remove(obj); } catch (_) {}
  }

  function _withTimeout(promise, ms, message) {
    let timer = null;
    return Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); }),
    ]).finally(() => clearTimeout(timer));
  }

  // Build the new Spark mesh off-screen and only swap it in once it has fully
  // decoded. The previous mesh stays visible the whole time, so edits never
  // flash an empty viewport, and a failed load leaves the last good view.
  async function loadFromBytes(bytes, fileName = 'scene.ply') {
    await _ensureSpark();
    const scene = _scene();
    const { SplatMesh } = await import('@sparkjsdev/spark');
    const token = ++_loadToken;
    const fileBytes = bytes instanceof Uint8Array ? new Uint8Array(bytes) : new Uint8Array(bytes.slice ? bytes.slice(0) : bytes);
    let next = null;
    try {
      next = new SplatMesh({ fileBytes, fileName, enableLod: false, onLoad: () => console.info('[FUMOCA] Spark Gaussian data loaded:', fileName) });
      next.name = 'fumoca-spark-splat';
      next.visible = false;
      scene.add(next);
      if (next.initialized) await _withTimeout(next.initialized, LOAD_TIMEOUT_MS, 'Spark took too long to decode the splat');
    } catch (error) {
      if (next) { _unparent(next); try { next.dispose?.(); } catch (_) {} }
      throw error;
    }
    if (token !== _loadToken) {
      // A newer load started while this one decoded; discard this result.
      _unparent(next); try { next.dispose?.(); } catch (_) {}
      return _mesh;
    }
    const previous = _mesh;
    next.visible = true;
    _mesh = next;
    if (previous) { _unparent(previous); try { previous.dispose?.(); } catch (_) {} }
    window.FumocaPresentation?.adoptVisuals?.();
    return _mesh;
  }

  // Spark failed while active: never leave the viewport blank. Drop back to
  // the editor's own Gaussian/point view (which always reflects the current
  // edits), tell the user, and let them re-enable Photoreal later.
  function _fallback(reason) {
    if (!_enabled && !_mesh) return;
    console.warn('[FUMOCA] Spark unavailable — falling back to the editor renderer:', reason);
    _enabled = false;
    _loadToken++;
    if (_overlay) { try { _unparent(_overlay); _overlay.geometry?.dispose?.(); _overlay.material?.dispose?.(); } catch (_) {} _overlay = null; }
    if (_box) { try { _unparent(_box); _box.geometry?.dispose?.(); } catch (_) {} _box = null; }
    if (_mesh) { try { _unparent(_mesh); _mesh.dispose?.(); } catch (_) {} _mesh = null; }
    _hideLegacy();
    try {
      const gr = window.FumocaGaussianRenderer;
      if (gr && !gr.isEnabled?.()) gr.enable?.(false);
      window.rebuildGeometry?.();
    } catch (error) { console.warn('[FUMOCA] Legacy renderer fallback failed', error); }
    window.dispatchEvent(new CustomEvent('fumoca:sparkFallback', { detail: { reason: String(reason || 'unknown') } }));
    window.showToast?.('Photoreal paused', 'Spark could not keep up, so Studio switched to its built-in view. Your edits are safe — turn Photoreal back on to retry.', 'warn');
  }

  // Copy what is about to be encoded, before the (async) decode starts, so
  // edits made while Spark decodes are still seen as changes afterwards.
  function _capture(state) {
    if (!state?.alive || !state.positions) return null;
    return {
      positions: Float32Array.from(state.positions),
      rotation: state.rotation ? Float32Array.from(state.rotation) : null,
      alive: Uint8Array.from(state.alive, v => (v ? 1 : 0)),
    };
  }

  function _snapshot(state) {
    _built = null;
    const splats = _mesh?.packedSplats;
    if (!state?.alive || !state.positions || !splats?.setSplat) return;
    const meshToS = [];
    for (let i = 0; i < state.alive.length; i++) if (state.alive[i]) meshToS.push(i);
    const n = splats.numSplats ?? meshToS.length;
    if (n !== meshToS.length) return;              // can't map rows safely
    const sToMesh = new Int32Array(state.alive.length).fill(-1);
    meshToS.forEach((s, m) => { sToMesh[s] = m; });
    _built = {
      mesh: _mesh, sToMesh, count: n,
      positions: Float32Array.from(state.positions),
      rotations: state.rotation ? Float32Array.from(state.rotation) : null,
      alive: Uint8Array.from(state.alive, v => (v ? 1 : 0)),
      attrs: null,
    };
  }

  function _readAttrs() {
    const splats = _built.mesh.packedSplats, n = _built.count;
    const scales = new Float32Array(n * 3), colors = new Float32Array(n * 3), opacity = new Float32Array(n);
    splats.forEachSplat((i, c, sc, q, a, col) => {
      if (i >= n) return;
      scales[i * 3] = sc.x; scales[i * 3 + 1] = sc.y; scales[i * 3 + 2] = sc.z;
      colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b;
      opacity[i] = a;
    });
    _built.attrs = { scales, colors, opacity };
  }

  /** Write changed splats into the live mesh. Returns the number written, or −1 if a full rebuild is needed. */
  function _tryInPlace(state) {
    const b = _built;
    if (!b || b.mesh !== _mesh || !state?.alive || state.alive.length !== b.sToMesh.length) return -1;
    // A rigged splat is being posed in place too; rebuild instead so the rig
    // re-attaches to clean rest data rather than mixing edits into a pose.
    if (window.FumocaRig?.driver) return -1;
    const THREE = window.THREE;
    if (!THREE?.Vector3 || !THREE?.Quaternion || !THREE?.Color) return -1;
    const n = state.alive.length;
    for (let i = 0; i < n; i++) if (state.alive[i] && b.sToMesh[i] < 0) return -1;   // restored a splat the mesh doesn't hold
    if (!b.attrs) _readAttrs();
    const splats = _mesh.packedSplats, { scales, colors, opacity } = b.attrs;
    const P = state.positions, Q = state.rotation, BP = b.positions, BQ = b.rotations;
    const c = new THREE.Vector3(), sc = new THREE.Vector3(), q = new THREE.Quaternion(), col = new THREE.Color();
    let written = 0;
    for (let i = 0; i < n; i++) {
      const m = b.sToMesh[i];
      if (m < 0) continue;
      const alive = state.alive[i] ? 1 : 0;
      let moved = BP[i * 3] !== P[i * 3] || BP[i * 3 + 1] !== P[i * 3 + 1] || BP[i * 3 + 2] !== P[i * 3 + 2];
      if (!moved && Q && BQ) moved = BQ[i * 4] !== Q[i * 4] || BQ[i * 4 + 1] !== Q[i * 4 + 1] || BQ[i * 4 + 2] !== Q[i * 4 + 2] || BQ[i * 4 + 3] !== Q[i * 4 + 3];
      if (!moved && alive === b.alive[i]) continue;
      if (!Number.isFinite(P[i * 3]) || !Number.isFinite(P[i * 3 + 1]) || !Number.isFinite(P[i * 3 + 2])) return -1;
      c.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
      sc.set(scales[m * 3], scales[m * 3 + 1], scales[m * 3 + 2]);
      if (Q) {
        const w = Q[i * 4], x = Q[i * 4 + 1], y = Q[i * 4 + 2], z = Q[i * 4 + 3];
        const len = Math.hypot(w, x, y, z);
        if (!(len > 1e-8)) return -1;
        q.set(x / len, y / len, z / len, w / len);           // FUMOCA stores w,x,y,z
      } else q.set(0, 0, 0, 1);
      col.setRGB(colors[m * 3], colors[m * 3 + 1], colors[m * 3 + 2]);
      const show = alive && _passes(opacity[m], scales[m * 3], scales[m * 3 + 1], scales[m * 3 + 2]);
      splats.setSplat(m, c, sc, q, show ? opacity[m] : 0, col);
      if (b.shown) b.shown[m] = show ? 1 : 0;
      BP[i * 3] = P[i * 3]; BP[i * 3 + 1] = P[i * 3 + 1]; BP[i * 3 + 2] = P[i * 3 + 2];
      if (Q && BQ) for (let k = 0; k < 4; k++) BQ[i * 4 + k] = Q[i * 4 + k];
      b.alive[i] = alive;
      written++;
    }
    if (written) {
      splats.needsUpdate = true;
      _mesh.updateVersion?.();
      window.dispatchEvent(new CustomEvent('fumoca:sparkInPlaceUpdate', { detail: { written } }));
    }
    return written;
  }

  /** Apply the view filter to every splat in the live mesh (no data change). */
  function _applyFilter() {
    const b = _built;
    if (!b || b.mesh !== _mesh || !window.THREE?.Vector3) return 0;
    if (!b.attrs) _readAttrs();
    const THREE = window.THREE, splats = _mesh.packedSplats, { scales, colors, opacity } = b.attrs;
    const c = new THREE.Vector3(), sc = new THREE.Vector3(), q = new THREE.Quaternion(), col = new THREE.Color();
    let hidden = 0, written = 0;
    const P = b.positions, Q = b.rotations;
    for (let i = 0; i < b.sToMesh.length; i++) {
      const m = b.sToMesh[i];
      if (m < 0) continue;
      const pass = _passes(opacity[m], scales[m * 3], scales[m * 3 + 1], scales[m * 3 + 2]);
      if (!pass) hidden++;
      const want = b.alive[i] && pass ? opacity[m] : 0;
      const shown = b.shown ? b.shown[m] : 1;
      if ((want > 0 ? 1 : 0) === shown && !b.forceAll) continue;
      c.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
      sc.set(scales[m * 3], scales[m * 3 + 1], scales[m * 3 + 2]);
      if (Q) { const w = Q[i * 4], x = Q[i * 4 + 1], y = Q[i * 4 + 2], z = Q[i * 4 + 3], l = Math.hypot(w, x, y, z) || 1; q.set(x / l, y / l, z / l, w / l); }
      else q.set(0, 0, 0, 1);
      col.setRGB(colors[m * 3], colors[m * 3 + 1], colors[m * 3 + 2]);
      splats.setSplat(m, c, sc, q, want, col);
      if (b.shown) b.shown[m] = want > 0 ? 1 : 0;
      written++;
    }
    b.forceAll = false;
    if (written) { splats.needsUpdate = true; _mesh.updateVersion?.(); }
    return hidden;
  }

  /**
   * View filter: hide splats fainter than minOpacity (0..1) or larger than
   * maxScale × the scene's typical splat size. Returns how many are hidden.
   */
  function setViewFilter({ minOpacity = 0, maxScaleFactor = Infinity } = {}) {
    if (!_built) return 0;
    if (!_built.attrs) _readAttrs();
    let typical = Infinity;
    if (Number.isFinite(maxScaleFactor)) {
      const sc = _built.attrs.scales, n = _built.count, sample = [];
      for (let m = 0; m < n; m += Math.max(1, Math.floor(n / 20000))) sample.push(Math.max(sc[m * 3], sc[m * 3 + 1], sc[m * 3 + 2]));
      sample.sort((a, b) => a - b);
      typical = sample[Math.floor(sample.length * 0.5)] || Infinity;
    }
    _filter = { minOpacity: Math.max(0, Math.min(1, +minOpacity || 0)), maxScale: Number.isFinite(maxScaleFactor) ? typical * maxScaleFactor : Infinity };
    if (!_built.shown) { _built.shown = new Uint8Array(_built.count).fill(1); _built.forceAll = true; }
    const hidden = _applyFilter();
    window.dispatchEvent(new CustomEvent('fumoca:viewFilter', { detail: { hidden, total: _built.count } }));
    return hidden;
  }

  async function syncEditorState(state = window.S) {
    if (!_enabled || !_originalBytes || !state?.alive || !state?.positions) return false;
    if (_loading) { _syncQueued = false; refreshEditorState(state); return false; }
    const signature = _stateSignature(state);
    _updateSelectionOverlay(state);
    _hideLegacy();
    if (signature === _lastStateSignature) return true;
    try {
      const written = _tryInPlace(state);
      if (written >= 0) {
        _lastStateSignature = signature;
        _failureCount = 0;
        return true;
      }
    } catch (error) {
      console.warn('[FUMOCA] in-place Spark update failed; rebuilding instead', error);
      _built = null;
    }
    _loading = true;
    let ok = false;
    try {
      const encoded = _capture(state);
      const edited = _makeEditedBytes(state);
      await loadFromBytes(edited, _lastFileName);
      _snapshot(encoded);
      if (_filter.minOpacity > 0 || Number.isFinite(_filter.maxScale)) { _built && (_built.shown = new Uint8Array(_built.count).fill(1), _built.forceAll = true); _applyFilter(); }
      _lastStateSignature = signature;
      _failureCount = 0;
      ok = true;
      console.info('[FUMOCA] Spark synced with editor state', {
        originalCount: state.alive.length,
        remaining: state.alive.reduce((n,v)=>n+(v?1:0),0)
      });
      return true;
    } catch (error) {
      _failureCount++;
      console.error('[FUMOCA] Spark editor sync failed (attempt ' + _failureCount + ')', error);
      // One retry with the latest state; after that stop fighting Spark.
      if (_failureCount >= 2) _fallback(error?.message || error);
      return false;
    } finally {
      _loading = false;
      if (_enabled) {
        _hideLegacy();
        _updateSelectionOverlay(state);
        // Edits made while Spark was decoding must not be lost.
        if (!ok || _stateSignature(window.S || state) !== _lastStateSignature) refreshEditorState(window.S || state);
      }
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
      // Preserve the exact original Gaussian source for the publish engine.
      // This is the high-fidelity PLY/SPLAT, not a re-encoded NIF or edited point array.
      S.gaussianSourceBytes = new Uint8Array(_originalBytes);
      window._fumocaLastGaussianBytes = new Uint8Array(_originalBytes);
      _lastFileName = name;
      await loadFromBytes(_originalBytes, name);
      _enabled = true;
      _snapshot(_capture(S));
      _lastStateSignature = _stateSignature(S);
      _hideLegacy();
      _updateSelectionOverlay(S);
      console.info('[FUMOCA] Spark renderer enabled with editor bridge', { fileName:name, bytes:_originalBytes.byteLength });
      return true;
    } catch (error) {
      console.error('[FUMOCA] Spark renderer could not load the source file', error);
      window.dispatchEvent(new CustomEvent('fumoca:sparkFallback', { detail: { reason: String(error?.message || error), phase: 'enable' } }));
      _enabled = false;
      _hideLegacy();
      if (_mesh) { try { _unparent(_mesh); _mesh.dispose?.(); } catch (_) {} _mesh = null; }
      return false;
    } finally { _loading = false; }
  }

  function disable() {
    _enabled = false;
    _built = null;
    _loadToken++;
    _failureCount = 0;
    _hideLegacy();
    if (_overlay) { try { _unparent(_overlay); _overlay.geometry?.dispose?.(); _overlay.material?.dispose?.(); } catch (_) {} _overlay = null; }
    if (_box) { try { _unparent(_box); _box.geometry?.dispose?.(); _box.material?.dispose?.(); } catch (_) {} _box = null; }
    if (_mesh) { try { _unparent(_mesh); _mesh.dispose?.(); } catch (_) {} _mesh = null; }
  }
  // Export the current edited Gaussian PLY without flattening it to NIF's
  // 14-float preview representation. This preserves SH coefficients and all
  // original per-Gaussian attributes while applying positions, rotations and deletions.
  function exportEditedBytes(state = window.S) {
    if (!_enabled || !_originalBytes) throw new Error('Spark source is not active');
    return _makeEditedBytes(state);
  }

  function isEnabled() { return _enabled; }
  function getMesh() { return _mesh; }
  function isAvailable() { return true; }
  function dispose() {
    disable();
    if (_spark) { try { _scene()?.remove(_spark); _spark.dispose?.(); } catch (_) {} _spark = null; }
  }

  return { enable, disable, isEnabled, getMesh, isAvailable, loadFromBytes, syncEditorState, refreshEditorState, exportEditedBytes, dispose, setViewFilter };
})();
window.FumocaSparkGaussian = SparkGaussianView;
export default SparkGaussianView;
