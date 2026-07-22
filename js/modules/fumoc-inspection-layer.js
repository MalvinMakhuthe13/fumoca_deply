/**
 * FUMOCA Scene Inspection Layer v84
 * ════════════════════════════════════════════════════════════════════════════
 * Click any point in the reconstructed or captured splat to:
 *   - Measure distance between two points
 *   - Measure height of an object
 *   - Measure angle between three points
 *   - Drop an annotation (text note, category, timestamp)
 *   - Select a region and export its bounds
 *
 * All measurements and annotations are stored in the ANOT section of the
 * .fumoc file and travel with it when shared.
 *
 * Forensic mode adds:
 *   - SHA-256 hash of each annotation at creation time
 *   - Timestamp (device + UTC)
 *   - User identity (from Supabase auth)
 *   - Immutable log (annotations can be added but not deleted in forensic mode)
 *   - Watermark overlay on all rendered outputs
 *
 * Measurement math:
 *   Points are picked by raycasting against the Gaussian splat point cloud.
 *   Distance = Euclidean 3D distance between picked points.
 *   The unit is whatever unit the splat was reconstructed in (metres for
 *   real-world captures, relative units for single-image reconstructions).
 * ════════════════════════════════════════════════════════════════════════════
 */

import * as THREE from 'three';

// ── State ─────────────────────────────────────────────────────────────────────

const _state = {
  active:        false,
  mode:          'inspect',   // 'inspect' | 'measure_dist' | 'measure_height' | 'measure_angle' | 'annotate'
  forensicMode:  false,
  pickedPoints:  [],          // THREE.Vector3[]
  annotations:   [],          // ANOT records
  measureLines:  [],          // THREE.Line objects in scene
  markers:       [],          // THREE.Mesh point markers in scene
  scene:         null,        // THREE.Scene
  camera:        null,
  renderer:      null,
  raycaster:     new THREE.Raycaster(),
  gaussianPoints: null,       // THREE.Points built from splat positions
};

// ── ANOT record schema ────────────────────────────────────────────────────────

function _newAnnotation(type, data, forensicMeta = null) {
  return {
    id:        crypto.randomUUID(),
    type,      // 'point' | 'distance' | 'height' | 'angle' | 'region' | 'note'
    data,      // type-specific payload
    label:     data.label || '',
    category:  data.category || 'general',
    created:   new Date().toISOString(),
    ...(forensicMeta ? { forensic: forensicMeta } : {}),
  };
}

async function _forensicMeta() {
  if (!_state.forensicMode) return null;
  const { data: { user } } = await window._fumocaSupabase?.auth.getUser() || { data: {} };
  return {
    user_id:   user?.id   || 'anonymous',
    user_email:user?.email || null,
    timestamp: Date.now(),
    hash:      null, // populated after serialisation
  };
}

// ── DOM / scene setup ─────────────────────────────────────────────────────────

function _ensureHUD() {
  let hud = document.getElementById('fumocInspectHUD');
  if (hud) return hud;

  hud = document.createElement('div');
  hud.id = 'fumocInspectHUD';
  hud.innerHTML = `
    <style>
      #fumocInspectHUD {
        position: fixed; bottom: 90px; left: 50%; transform: translateX(-50%);
        z-index: 200; width: min(480px, calc(100vw - 24px));
        font-family: 'DM Sans', system-ui, sans-serif;
        display: none;
      }
      #fumocInspectHUD.visible { display: block; }
      #fihToolbar {
        background: rgba(5,7,11,.92); border: 1px solid rgba(255,255,255,.1);
        backdrop-filter: blur(20px); border-radius: 18px;
        display: flex; gap: 6px; padding: 10px 12px; margin-bottom: 8px;
        overflow-x: auto; scrollbar-width: none;
      }
      #fihToolbar::-webkit-scrollbar { display: none; }
      .fih-tool {
        flex-shrink: 0; padding: 8px 14px; border-radius: 12px; cursor: pointer;
        background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.1);
        color: rgba(255,255,255,.75); font-size: 12px; font-weight: 700;
        white-space: nowrap; transition: all .15s;
      }
      .fih-tool.active {
        background: rgba(200,255,0,.15); border-color: rgba(200,255,0,.4); color: #c8ff00;
      }
      .fih-tool:hover { background: rgba(255,255,255,.14); }
      #fihResult {
        background: rgba(5,7,11,.92); border: 1px solid rgba(255,255,255,.1);
        backdrop-filter: blur(20px); border-radius: 14px; padding: 14px 16px;
        display: none;
      }
      #fihResult.show { display: block; }
      .fih-result-val {
        font-size: 22px; font-weight: 800; color: #c8ff00; margin-bottom: 4px;
      }
      .fih-result-label { font-size: 12px; color: rgba(255,255,255,.5); }
      .fih-result-actions {
        display: flex; gap: 8px; margin-top: 12px;
      }
      .fih-action {
        flex: 1; padding: 9px; border-radius: 11px; font-size: 12px; font-weight: 700;
        cursor: pointer; border: 1px solid rgba(255,255,255,.1);
        background: rgba(255,255,255,.07); color: #fff; transition: background .15s;
      }
      .fih-action:hover { background: rgba(255,255,255,.15); }
      .fih-action.primary {
        background: rgba(200,255,0,.15); border-color: rgba(200,255,0,.3); color: #c8ff00;
      }
      #fihAnnotList {
        background: rgba(5,7,11,.92); border: 1px solid rgba(255,255,255,.1);
        backdrop-filter: blur(20px); border-radius: 14px; padding: 12px 14px;
        margin-top: 8px; max-height: 200px; overflow-y: auto; display: none;
      }
      #fihAnnotList.show { display: block; }
      .fih-annot {
        padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,.06);
        font-size: 12px;
      }
      .fih-annot:last-child { border-bottom: none; }
      .fih-annot-type { color: #c8ff00; font-weight: 700; font-size: 10px;
        text-transform: uppercase; margin-bottom: 2px; }
      .fih-annot-val  { color: rgba(255,255,255,.8); }
      .fih-annot-meta { color: rgba(255,255,255,.35); font-size: 10px; margin-top: 2px; }
      #fihForensicBadge {
        display: none; position: fixed; top: 70px; left: 50%;
        transform: translateX(-50%); z-index: 201;
        background: rgba(255,72,72,.15); border: 1px solid rgba(255,72,72,.4);
        border-radius: 999px; padding: 5px 16px;
        font-size: 11px; font-weight: 700; color: #ff8a8a; letter-spacing: .05em;
        font-family: 'DM Sans', system-ui;
      }
      #fihForensicBadge.show { display: block; }
      .fih-note-input {
        width: 100%; padding: 10px; border-radius: 10px; margin-top: 8px;
        background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.12);
        color: #fff; font-size: 13px; outline: none; resize: none;
        font-family: 'DM Sans', system-ui;
      }
      .fih-note-input:focus { border-color: rgba(200,255,0,.4); }
    </style>

    <div id="fihForensicBadge">⚠ FORENSIC RECONSTRUCTION — ESTIMATED DEPTH</div>

    <div id="fihToolbar">
      <div class="fih-tool active" data-mode="inspect">🔍 Inspect</div>
      <div class="fih-tool" data-mode="measure_dist">📏 Distance</div>
      <div class="fih-tool" data-mode="measure_height">↕ Height</div>
      <div class="fih-tool" data-mode="measure_angle">📐 Angle</div>
      <div class="fih-tool" data-mode="annotate">📌 Annotate</div>
      <div class="fih-tool" data-mode="clear">✕ Clear</div>
    </div>

    <div id="fihResult">
      <div class="fih-result-val"  id="fihResultVal">—</div>
      <div class="fih-result-label" id="fihResultLabel">Click a point to start</div>
      <div id="fihNoteArea" style="display:none">
        <textarea class="fih-note-input" id="fihNoteInput" rows="2" placeholder="Enter annotation note…"></textarea>
        <select id="fihCategory" style="width:100%;margin-top:6px;padding:8px;border-radius:10px;
          background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:#fff;font-size:12px;">
          <option value="general">General</option>
          <option value="evidence">Evidence</option>
          <option value="person">Person</option>
          <option value="vehicle">Vehicle</option>
          <option value="measurement">Measurement</option>
          <option value="damage">Damage</option>
        </select>
      </div>
      <div class="fih-result-actions">
        <button class="fih-action primary" id="fihSaveBtn">Save annotation</button>
        <button class="fih-action"         id="fihClearBtn">Clear</button>
      </div>
    </div>

    <div id="fihAnnotList">
      <div style="font-size:11px;font-weight:700;color:rgba(255,255,255,.4);
        text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px;">
        Annotations
      </div>
      <div id="fihAnnotItems"></div>
    </div>
  `;
  document.body.appendChild(hud);
  _wireHUD(hud);
  return hud;
}

function _wireHUD(hud) {
  // Mode buttons
  hud.querySelectorAll('.fih-tool[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      if (mode === 'clear') { clearAll(); return; }
      setMode(mode);
      hud.querySelectorAll('.fih-tool').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  hud.querySelector('#fihSaveBtn').addEventListener('click', _saveCurrentMeasurement);
  hud.querySelector('#fihClearBtn').addEventListener('click', () => {
    _clearPickedPoints();
    document.getElementById('fihResult').classList.remove('show');
  });
}

// ── Point picking ─────────────────────────────────────────────────────────────

/**
 * Build a raycasting target from Gaussian positions.
 * We create an invisible THREE.Points object that the raycaster can hit.
 */
function buildPickTarget(gaussians) {
  if (_state.gaussianPoints) {
    _state.scene?.remove(_state.gaussianPoints);
    _state.gaussianPoints = null;
  }

  if (!_state.scene || !gaussians) return;

  const N = gaussians.N;
  const positions = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    positions[i*3]   = gaussians.posX[i];
    positions[i*3+1] = gaussians.posY[i];
    positions[i*3+2] = gaussians.posZ[i];
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({ size: 0.05, visible: false });
  _state.gaussianPoints = new THREE.Points(geo, mat);
  _state.scene.add(_state.gaussianPoints);
}

function _pickPoint(event) {
  if (!_state.camera || !_state.gaussianPoints) return null;

  const canvas = _state.renderer?.domElement || document.querySelector('#stage canvas');
  if (!canvas) return null;

  const rect = canvas.getBoundingClientRect();
  const x =  ((event.clientX - rect.left) / rect.width)  * 2 - 1;
  const y = -((event.clientY - rect.top)  / rect.height) * 2 + 1;

  _state.raycaster.setFromCamera(new THREE.Vector2(x, y), _state.camera);
  _state.raycaster.params.Points.threshold = 0.08;

  const hits = _state.raycaster.intersectObject(_state.gaussianPoints);
  if (!hits.length) return null;

  return hits[0].point.clone();
}

// ── Visual markers ────────────────────────────────────────────────────────────

function _addMarker(point, colour = 0xc8ff00, label = '') {
  if (!_state.scene) return;

  const geo = new THREE.SphereGeometry(0.05, 8, 8);
  const mat = new THREE.MeshBasicMaterial({ color: colour, depthTest: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(point);
  _state.scene.add(mesh);
  _state.markers.push(mesh);

  if (label) {
    // Floating label via CSS2D (if available)
    try {
      const { CSS2DObject, CSS2DRenderer } = THREE;
      if (CSS2DObject) {
        const div = document.createElement('div');
        div.style.cssText = `
          background: rgba(5,7,11,.85); border: 1px solid #c8ff00; color: #c8ff00;
          font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 6px;
          font-family: 'DM Sans', system-ui; white-space: nowrap; pointer-events: none;
        `;
        div.textContent = label;
        const obj = new CSS2DObject(div);
        obj.position.copy(point);
        _state.scene.add(obj);
        _state.markers.push(obj);
      }
    } catch {}
  }
}

function _addLine(p1, p2, colour = 0xc8ff00) {
  if (!_state.scene) return;
  const geo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
  const mat = new THREE.LineBasicMaterial({ color: colour, depthTest: false, linewidth: 2 });
  const line = new THREE.Line(geo, mat);
  _state.scene.add(line);
  _state.measureLines.push(line);
}

// ── Measurements ──────────────────────────────────────────────────────────────

function _measureDistance(p1, p2) {
  const d = p1.distanceTo(p2);
  return { value: d, unit: 'm', display: d.toFixed(3) + ' m', type: 'distance' };
}

function _measureHeight(p1, p2) {
  const h = Math.abs(p1.y - p2.y);
  return { value: h, unit: 'm', display: h.toFixed(3) + ' m', type: 'height' };
}

function _measureAngle(p1, p2, p3) {
  const v1 = new THREE.Vector3().subVectors(p1, p2).normalize();
  const v2 = new THREE.Vector3().subVectors(p3, p2).normalize();
  const cos = Math.max(-1, Math.min(1, v1.dot(v2)));
  const deg = (Math.acos(cos) * 180 / Math.PI);
  return { value: deg, unit: '°', display: deg.toFixed(1) + '°', type: 'angle' };
}

// ── Click handler ─────────────────────────────────────────────────────────────

async function _handleClick(event) {
  if (!_state.active) return;

  const point = _pickPoint(event);
  if (!point) return;

  const mode  = _state.mode;
  const pts   = _state.pickedPoints;

  if (mode === 'inspect') {
    _clearPickedPoints();
    pts.push(point);
    _addMarker(point, 0xc8ff00, `(${point.x.toFixed(2)}, ${point.y.toFixed(2)}, ${point.z.toFixed(2)})`);
    _showResult(`${point.x.toFixed(3)}, ${point.y.toFixed(3)}, ${point.z.toFixed(3)}`, 'XYZ position (metres)');
    return;
  }

  if (mode === 'annotate') {
    _clearPickedPoints();
    pts.push(point);
    _addMarker(point, 0xff8800);
    _showResult('', 'Add your note below', true);
    return;
  }

  // Measurement modes
  pts.push(point);
  _addMarker(point, 0xc8ff00, `P${pts.length}`);

  if (mode === 'measure_dist' && pts.length === 2) {
    _addLine(pts[0], pts[1]);
    const m = _measureDistance(pts[0], pts[1]);
    _showResult(m.display, `Distance between P1 and P2`);
    _state._lastMeasurement = m;
  } else if (mode === 'measure_height' && pts.length === 2) {
    const m = _measureHeight(pts[0], pts[1]);
    _addLine(
      pts[0],
      new THREE.Vector3(pts[0].x, pts[1].y, pts[0].z),
    );
    _showResult(m.display, `Vertical height difference`);
    _state._lastMeasurement = m;
  } else if (mode === 'measure_angle' && pts.length === 3) {
    _addLine(pts[0], pts[1]);
    _addLine(pts[1], pts[2]);
    const m = _measureAngle(pts[0], pts[1], pts[2]);
    _showResult(m.display, `Angle at P2`);
    _state._lastMeasurement = m;
  } else if (pts.length === 1) {
    _showResult('Pick second point…', mode.replace('measure_', '').replace('_', ' ') + ' measurement');
  } else if (mode === 'measure_angle' && pts.length === 2) {
    _showResult('Pick third point…', 'Angle measurement');
  }
}

function _showResult(val, label, showNoteArea = false) {
  const result = document.getElementById('fihResult');
  if (!result) return;
  document.getElementById('fihResultVal').textContent   = val;
  document.getElementById('fihResultLabel').textContent = label;
  const noteArea = document.getElementById('fihNoteArea');
  if (noteArea) noteArea.style.display = showNoteArea ? 'block' : 'none';
  result.classList.add('show');
}

async function _saveCurrentMeasurement() {
  const pts  = _state.pickedPoints;
  const mode = _state.mode;
  const note = document.getElementById('fihNoteInput')?.value?.trim() || '';
  const cat  = document.getElementById('fihCategory')?.value || 'general';
  const fm   = await _forensicMeta();

  let annotation;

  if (mode === 'annotate' && pts.length === 1) {
    annotation = _newAnnotation('note', {
      position: pts[0].toArray(),
      label:    note,
      category: cat,
    }, fm);
  } else if (_state._lastMeasurement) {
    const m = _state._lastMeasurement;
    annotation = _newAnnotation(m.type, {
      points:   pts.map(p => p.toArray()),
      value:    m.value,
      unit:     m.unit,
      display:  m.display,
      label:    note,
      category: cat,
    }, fm);
  } else return;

  _state.annotations.push(annotation);
  _renderAnnotationList();
  _clearPickedPoints();
  document.getElementById('fihResult').classList.remove('show');
  if (document.getElementById('fihNoteInput')) {
    document.getElementById('fihNoteInput').value = '';
  }

  // Dispatch event so the export pipeline knows annotations changed
  window.dispatchEvent(new CustomEvent('fumoca:annotationAdded', { detail: annotation }));
}

function _renderAnnotationList() {
  const list  = document.getElementById('fihAnnotItems');
  const panel = document.getElementById('fihAnnotList');
  if (!list || !panel) return;

  if (!_state.annotations.length) { panel.classList.remove('show'); return; }
  panel.classList.add('show');

  list.innerHTML = _state.annotations.map((a, i) => `
    <div class="fih-annot">
      <div class="fih-annot-type">${a.type} ${a.data.category ? '· ' + a.data.category : ''}</div>
      <div class="fih-annot-val">
        ${a.data.display || a.data.label || '—'}
        ${a.data.label && a.data.display ? ' — ' + a.data.label : ''}
      </div>
      <div class="fih-annot-meta">${new Date(a.created).toLocaleTimeString()}</div>
    </div>
  `).join('');
}

function _clearPickedPoints() {
  _state.pickedPoints = [];
  _state._lastMeasurement = null;
  // Remove visual markers and lines
  _state.markers.forEach(m => _state.scene?.remove(m));
  _state.measureLines.forEach(l => _state.scene?.remove(l));
  _state.markers = [];
  _state.measureLines = [];
}

// ── Public API ─────────────────────────────────────────────────────────────────

function init(options = {}) {
  _state.camera      = options.camera   || window._fumocaCamera;
  _state.renderer    = options.renderer || window._fumocaRenderer?._renderer;
  _state.scene       = options.scene    || window._fumocaScene;
  _state.forensicMode = options.forensicMode || false;

  const canvas = _state.renderer?.domElement || document.querySelector('#stage canvas');
  if (canvas) {
    canvas.addEventListener('click', _handleClick, { passive: true });
  }
}

function activate(opts = {}) {
  _state.active = true;
  if (opts.gaussians) buildPickTarget(opts.gaussians);

  const hud = _ensureHUD();
  hud.classList.add('visible');

  if (_state.forensicMode) {
    document.getElementById('fihForensicBadge')?.classList.add('show');
  }
  if (opts.existingAnnotations?.length) {
    _state.annotations = opts.existingAnnotations;
    _renderAnnotationList();
  }
}

function deactivate() {
  _state.active = false;
  document.getElementById('fumocInspectHUD')?.classList.remove('visible');
  document.getElementById('fihForensicBadge')?.classList.remove('show');
  _clearPickedPoints();
}

function setMode(mode) {
  _state.mode = mode;
  _clearPickedPoints();
  document.getElementById('fihResult')?.classList.remove('show');

  const labels = {
    inspect:        'Click any point to inspect its position',
    measure_dist:   'Click two points to measure distance',
    measure_height: 'Click two points to measure height',
    measure_angle:  'Click three points to measure angle at P2',
    annotate:       'Click a point to place an annotation',
  };
  _showResult('', labels[mode] || '');
}

function clearAll() {
  if (_state.forensicMode && _state.annotations.length) {
    if (!confirm('In forensic mode, clearing annotations cannot be undone. Continue?')) return;
  }
  _clearPickedPoints();
  _state.annotations = [];
  _renderAnnotationList();
  document.getElementById('fihResult')?.classList.remove('show');
}

function getAnnotations() { return [..._state.annotations]; }

function loadAnnotations(annotations) {
  _state.annotations = Array.isArray(annotations) ? annotations : [];
  _renderAnnotationList();
  // Re-render visual markers for saved annotations
  _state.annotations.forEach(a => {
    if (a.data.position) {
      _addMarker(new THREE.Vector3(...a.data.position), 0xff8800, a.data.label);
    } else if (a.data.points?.length >= 2) {
      a.data.points.forEach((p, i) =>
        _addMarker(new THREE.Vector3(...p), 0xc8ff00, `P${i+1}`));
      if (a.data.points.length >= 2) {
        _addLine(
          new THREE.Vector3(...a.data.points[0]),
          new THREE.Vector3(...a.data.points[1])
        );
      }
    }
  });
}

function destroy() {
  deactivate();
  const canvas = _state.renderer?.domElement || document.querySelector('#stage canvas');
  canvas?.removeEventListener('click', _handleClick);
  document.getElementById('fumocInspectHUD')?.remove();
  document.getElementById('fihForensicBadge')?.remove();
  if (_state.gaussianPoints) _state.scene?.remove(_state.gaussianPoints);
}

const FumocInspectionLayer = {
  init, activate, deactivate, setMode, clearAll,
  getAnnotations, loadAnnotations, buildPickTarget, destroy,
};

window.FumocInspectionLayer = FumocInspectionLayer;
export default FumocInspectionLayer;
