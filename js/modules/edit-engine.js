import r2 from '../r2Client.js';
import * as THREE from 'three';

/**
 * FUMOCA Edit Engine v1.0
 * ════════════════════════════════════════════════════════════════
 * True Gaussian nif surgery integrated into the viewer.
 *
 * What this does that no competitor does:
 *   - Parses the actual .nif/.ply binary from the live viewer URL
 *   - Renders all Gaussians via a dedicated WebGL2 canvas overlaid on the stage
 *   - Implements real 3D box-selection (projects positions through MVP matrix)
 *   - Auto-detects floaters by neighbourhood count (O(N²) with early exit)
 *   - Opacity sharpening: kill ghosts, boost survivors — data-level, not CSS
 *   - Density pruning: score every Gaussian, cull the sparse tail
 *   - Scale filtering: removes blown-up halos
 *   - Exports a real cleaned .nif binary (32 bytes/Gaussian, standard format)
 *   - Uploads cleaned .nif to Supabase storage + creates variant record
 * ════════════════════════════════════════════════════════════════
 */

// ── DOM REFS ────────────────────────────────────────────────────
const editModeBtn   = document.getElementById('editModeBtn');
const closeEditBtn  = document.getElementById('closeEditBtn');
const editPanel     = document.getElementById('editPanel');
const editCanvas    = document.getElementById('editCanvas');
const editSelRect   = document.getElementById('editSelRect');
const editModeBadge = document.getElementById('editModeBadge');

// Stats
const eTotal = document.getElementById('eTotal');
const eAlive = document.getElementById('eAlive');
const eDel   = document.getElementById('eDel');
const eSel   = document.getElementById('eSel');
const eExportAlive = document.getElementById('eExportAlive');
const eExportDel   = document.getElementById('eExportDel');

// Select tab
const eModeOrbit     = document.getElementById('eModeOrbit');
const eModeBox       = document.getElementById('eModeBox');
const eModeBrush     = document.getElementById('eModeBrush');
const eSelAll        = document.getElementById('eSelAll');
const eSelInvert     = document.getElementById('eSelInvert');
const eSelClear      = document.getElementById('eSelClear');
const eDeleteQuick   = document.getElementById('eDeleteQuick');
const eFloatR        = document.getElementById('eFloatR');
const eFloatRLbl     = document.getElementById('eFloatRLbl');
const eFloatN        = document.getElementById('eFloatN');
const eFloatNLbl     = document.getElementById('eFloatNLbl');
const eSelectFloaters= document.getElementById('eSelectFloaters');
const eOpThresh      = document.getElementById('eOpThresh');
const eOpThreshLbl   = document.getElementById('eOpThreshLbl');
const eSelectLowOp   = document.getElementById('eSelectLowOp');
const eScaleSel      = document.getElementById('eScaleSel');
const eScaleSelLbl   = document.getElementById('eScaleSelLbl');
const eSelectLargeScale = document.getElementById('eSelectLargeScale');
const eBrushSize     = document.getElementById('eBrushSize');
const eBrushSizeLbl  = document.getElementById('eBrushSizeLbl');
const eBrushDepth    = document.getElementById('eBrushDepth');
const eBrushDepthLbl = document.getElementById('eBrushDepthLbl');

// Clean tab
const eDelete        = document.getElementById('eDelete');
const eUndo          = document.getElementById('eUndo');
const eKillThresh    = document.getElementById('eKillThresh');
const eKillLbl       = document.getElementById('eKillLbl');
const eBoost         = document.getElementById('eBoost');
const eBoostLbl      = document.getElementById('eBoostLbl');
const eSharpen       = document.getElementById('eSharpen');
const eDensity       = document.getElementById('eDensity');
const eDensityLbl    = document.getElementById('eDensityLbl');
const eDensityPrune  = document.getElementById('eDensityPrune');
const eScaleFilter   = document.getElementById('eScaleFilter');
const eScaleFilterLbl= document.getElementById('eScaleFilterLbl');
const eScaleFilterBtn= document.getElementById('eScaleFilterBtn');
const eSmartCleanup  = document.getElementById('eSmartCleanup');
const eCubeFromSelection = document.getElementById('eCubeFromSelection');
const eCropOutsideCube = document.getElementById('eCropOutsideCube');
const eCropInsideCube = document.getElementById('eCropInsideCube');
const eClearCube = document.getElementById('eClearCube');
const eCubeStatus = document.getElementById('eCubeStatus');

// Export tab
const eExportNif   = document.getElementById('eExportNif');
const eSaveToSupabase= document.getElementById('eSaveToSupabase');
const eExportReport  = document.getElementById('eExportReport');
const eSaveStatus    = document.getElementById('eSaveStatus');

// History tab
const eHistList = document.getElementById('eHistList');

// ── STATE ───────────────────────────────────────────────────────
const NIF_ROW = 32; // pos(12) + scale(12) + rgba(4) + quat(4)

let engineReady  = false;
let editActive   = false;
let editMode     = 'orbit'; // 'orbit' | 'box' | 'brush'
let numG         = 0;
let positions    = null; // Float32Array N*3
let scales       = null; // Float32Array N*3
let colors       = null; // Uint8Array N*4
let rotations    = null; // Float32Array N*4
let opacities    = null; // Float32Array N
let deletedMask  = null; // Uint8Array N
let selectedMask = null; // Uint8Array N
let undoStack    = [];   // Array<Uint8Array> (snapshots of deletedMask)
let editHistory  = [];
let nifFileName = 'nif';
let loadedNifUrl = '';

// WebGL
let gl, prog, vao, posBuf, colBuf, _pointCount = 0;

// Camera
const cam = { theta: 0.5, phi: 1.1, radius: 4, cx: 0, cy: 0, cz: 0 };
let orbiting = false, orbStart = {};
let boxDrag = null; // { x0,y0,x1,y1 }
let brushStrokeActive = false;
let orbitClickCandidate = null;
let cropCube = null;

const _projVec = new THREE.Vector3();
const _projCamera = new THREE.PerspectiveCamera(60, 1, 0.01, 2000);

function syncProjectionCamera() {
  const w = editCanvas.clientWidth || window.innerWidth || 1;
  const h = editCanvas.clientHeight || window.innerHeight || 1;
  _projCamera.fov = 60;
  _projCamera.aspect = w / h;
  _projCamera.near = 0.01;
  _projCamera.far = 2000;
  const { theta, phi, radius, cx, cy, cz } = cam;
  const ex = cx + radius * Math.sin(phi) * Math.sin(theta);
  const ey = cy + radius * Math.cos(phi);
  const ez = cz + radius * Math.sin(phi) * Math.cos(theta);
  _projCamera.position.set(ex, ey, ez);
  _projCamera.up.set(0, 1, 0);
  _projCamera.lookAt(cx, cy, cz);
  _projCamera.updateProjectionMatrix();
  _projCamera.updateMatrixWorld();
  _projCamera.updateWorldMatrix?.(true, false);
  return _projCamera;
}

function projectGaussianToScreen(i, cameraObj, w, h) {
  _projVec.set(positions[i*3], positions[i*3+1], positions[i*3+2]);
  _projVec.project(cameraObj);
  if (!Number.isFinite(_projVec.x) || !Number.isFinite(_projVec.y) || !Number.isFinite(_projVec.z)) return null;
  if (_projVec.z < -1 || _projVec.z > 1) return null;
  return {
    sx: (_projVec.x * 0.5 + 0.5) * w,
    sy: (1 - (_projVec.y * 0.5 + 0.5)) * h,
    depth: _projVec.z
  };
}

// ── FORMAT ──────────────────────────────────────────────────────
function fmt(n) {
  if (n == null || isNaN(n)) return '—';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return '' + n;
}
function addHistory(msg) {
  editHistory.unshift({ msg, t: new Date().toLocaleTimeString() });
  renderHistory();
}
function renderHistory() {
  if (!editHistory.length) {
    eHistList.innerHTML = '<div class="e-hist-item" style="color:rgba(255,255,255,.2);">No edits yet</div>';
    return;
  }
  eHistList.innerHTML = editHistory.slice(0, 20).map((h, i) =>
    `<div class="e-hist-item${i === 0 ? ' new' : ''}"><span>${h.msg}</span><span>${h.t}</span></div>`
  ).join('');
}

// ── STATS UPDATE ────────────────────────────────────────────────
function updateStats() {
  if (!deletedMask) {
    [eTotal, eAlive, eDel, eSel, eExportAlive, eExportDel].forEach(el => { if (el) el.textContent = '—'; });
    return;
  }
  let dead = 0, sel = 0;
  for (let i = 0; i < numG; i++) {
    if (deletedMask[i]) dead++;
    if (selectedMask[i]) sel++;
  }
  const alive = numG - dead;
  if (eTotal) eTotal.textContent = fmt(numG);
  if (eAlive) eAlive.textContent = fmt(alive);
  if (eDel)   eDel.textContent   = fmt(dead);
  if (eSel)   eSel.textContent   = fmt(sel);
  if (eExportAlive) eExportAlive.textContent = fmt(alive);
  if (eExportDel)   eExportDel.textContent   = fmt(dead);
  updateButtonStates(sel, alive);
}
function updateButtonStates(sel, alive) {
  const loaded = !!positions;
  const hasSel = loaded && sel > 0;
  if (eDelete) eDelete.disabled = !hasSel;
  if (eDeleteQuick) eDeleteQuick.disabled = !hasSel;
  if (eUndo)   eUndo.disabled   = !undoStack.length;
  [eSharpen, eDensityPrune, eScaleFilterBtn,
   eSelectFloaters, eSelectLowOp, eSelectLargeScale,
   eSelAll, eSelInvert, eSelClear,
   eExportNif, eSaveToSupabase, eExportReport
  ].forEach(el => { if (el) el.disabled = !loaded; });
}


let _viewerControlsWereEnabled = null;
function setViewerInteractionLocked(locked) {
  try {
    const controls = window._fumocaViewerControls || window._fumocaViewer?.controls;
    if (!controls) return;
    if (locked) {
      if (_viewerControlsWereEnabled === null) {
        _viewerControlsWereEnabled = controls.enabled !== false;
      }
      controls.enabled = false;
      try { controls.enableRotate = false; } catch (_) {}
      try { controls.enablePan = false; } catch (_) {}
      try { controls.enableZoom = false; } catch (_) {}
      try { document.body.classList.add('fumoca-edit-lock'); } catch (_) {}
      return;
    }
    controls.enabled = _viewerControlsWereEnabled !== false;
    try { controls.enableRotate = true; } catch (_) {}
    try { controls.enablePan = true; } catch (_) {}
    try { controls.enableZoom = true; } catch (_) {}
    _viewerControlsWereEnabled = null;
    try { document.body.classList.remove('fumoca-edit-lock'); document.body.classList.remove('fumoca-edit-locked'); } catch (_) {}
  } catch (_) {}
}
function consumePointerEvent(e) {
  try { e.preventDefault(); } catch (_) {}
  try { e.stopPropagation(); } catch (_) {}
  try { e.stopImmediatePropagation?.(); } catch (_) {}
  try { e.cancelBubble = true; } catch (_) {}
  return false;
}

// ── OPEN / CLOSE PANEL ─────────────────────────────────────────
function openEditEngine() {
  // Never open edit engine in public/embed viewer
  if (window.IS_PUBLIC_VIEWER || document.body.classList.contains('fumoca-public-viewer')) return;
  editActive = true;
  editPanel.classList.add('open');
  editModeBtn.classList.add('active');
  editCanvas.classList.add('active');
  editCanvas.style.pointerEvents = 'auto';
  editModeBadge.classList.add('visible');
  // Hide studio panel
  const sp = document.getElementById('studioPanel');
  if (sp) sp.style.display = 'none';
  setEditMode('box');
  setViewerInteractionLocked(true);
  const currentUrl = window._fumocaNifUrl || new URLSearchParams(window.location.search).get('file') || '';
  // Reload when opening a different / legacy nif, not just the first time
  if (!engineReady || !loadedNifUrl || currentUrl !== loadedNifUrl) loadNifForEngine(true);
  else {
    try { updateStats(); } catch (_) {}
  }
}
function closeEditEngine() {
  editActive = false;
  editPanel.classList.remove('open');
  editModeBtn.classList.remove('active');
  editCanvas.classList.remove('active');
  editCanvas.style.pointerEvents = 'none';
  editModeBadge.classList.remove('visible');
  const sp = document.getElementById('studioPanel');
  if (sp) sp.style.display = '';
  setEditMode('orbit');
  setViewerInteractionLocked(false);
}

editModeBtn?.addEventListener('click', () => {
  // Navigate to the dedicated Edit Studio page
  const params = new URLSearchParams(window.location.search);
  const nifId = params.get('id') || params.get('nifId');
  const fileUrl = window._fumocaCurrentNifUrl || '';
  const back = encodeURIComponent(window.location.href);
  let editUrl = 'edit.html?back=' + back;
  if (nifId) editUrl += '&nifId=' + encodeURIComponent(nifId);
  if (fileUrl) editUrl += '&file=' + encodeURIComponent(fileUrl);
  window.location.href = editUrl;
});
closeEditBtn?.addEventListener('click', closeEditEngine);

// ── TAB SWITCHING ───────────────────────────────────────────────
document.querySelectorAll('.edit-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.edit-tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.edit-pane').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    const pane = document.getElementById('etab-' + btn.dataset.etab);
    if (pane) pane.classList.add('active');
  });
});

// ── LOAD nif DATA ─────────────────────────────────────────────
async function loadNifForEngine(forceReload = false) {
  // Get URL from viewer state (set by viewer.js on window)
  const url = window._fumocaNifUrl || new URLSearchParams(window.location.search).get('file') || '';
  if (!url) {
    addHistory('No nif URL found — open a nif first');
    return;
  }
  if (!forceReload && engineReady && loadedNifUrl === url && positions && deletedMask) {
    return;
  }
  engineReady = false;
  loadedNifUrl = url;
  addHistory('Fetching nif binary…');
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    nifFileName = url.split('/').pop().replace(/\?.*$/, '').replace(/\.[^.]+$/, '') || 'nif';
    const ext = url.split('.').pop().split('?')[0].toLowerCase();
    if (ext === 'ply') {
      parsePly(buf);
    } else {
      parseNif(buf); // .nif or .knif treated as .nif
    }
    initGL();
    uploadGPU();
    autofitCamera();
    engineReady = true;
    updateStats();
    addHistory(`Loaded ${fmt(numG)} Gaussians from ${nifFileName}`);
    if (!_rafRunning) requestAnimationFrame(renderLoop);
  } catch (err) {
    addHistory(`Load failed: ${err.message}`);
    console.error('[EditEngine]', err);
  }
}

// ── PARSERS ─────────────────────────────────────────────────────
function parseNif(buf) {
  numG = Math.floor(buf.byteLength / NIF_ROW);
  if (!numG) throw new Error('Empty or invalid .nif file');
  allocArrays();
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < numG; i++) {
    const b = i * NIF_ROW;
    positions[i*3]   = view.getFloat32(b,    true);
    positions[i*3+1] = view.getFloat32(b+4,  true);
    positions[i*3+2] = view.getFloat32(b+8,  true);
    scales[i*3]   = view.getFloat32(b+12, true);
    scales[i*3+1] = view.getFloat32(b+16, true);
    scales[i*3+2] = view.getFloat32(b+20, true);
    colors[i*4]   = bytes[b+24];
    colors[i*4+1] = bytes[b+25];
    colors[i*4+2] = bytes[b+26];
    colors[i*4+3] = bytes[b+27];
    opacities[i]   = bytes[b+27] / 255;
    // unpack quat from uint8
    rotations[i*4]   = bytes[b+28] / 128 - 1;
    rotations[i*4+1] = bytes[b+29] / 128 - 1;
    rotations[i*4+2] = bytes[b+30] / 128 - 1;
    rotations[i*4+3] = bytes[b+31] / 128 - 1;
  }
}

function parsePly(buf) {
  const dec = new TextDecoder('ascii');
  const bytes = new Uint8Array(buf);
  const endHdr = 'end_header\n';
  let hdrEnd = 0;
  for (let i = 0; i < bytes.length - endHdr.length; i++) {
    if (dec.decode(bytes.slice(i, i + endHdr.length)) === endHdr) {
      hdrEnd = i + endHdr.length; break;
    }
  }
  const hdr = dec.decode(bytes.slice(0, hdrEnd));
  const lines = hdr.split('\n');
  let N = 0;
  const props = [];
  const typeSz = { float: 4, double: 8, uchar: 1, int: 4 };
  for (const ln of lines) {
    const me = ln.match(/^element vertex (\d+)/);
    if (me) N = parseInt(me[1]);
    const mp = ln.match(/^property (float|double|uchar|int) (\w+)/);
    if (mp) props.push({ type: mp[1], name: mp[2] });
  }
  numG = N;
  if (!N) throw new Error('PLY vertex count is 0');
  allocArrays();
  let rowSz = 0;
  const offsets = {};
  for (const p of props) { offsets[p.name] = rowSz; rowSz += typeSz[p.type] || 4; }
  const data = buf.slice(hdrEnd);
  const view = new DataView(data);
  const C0 = 0.28209479177387814;
  for (let i = 0; i < N; i++) {
    const base = i * rowSz;
    const gf = (name) => {
      if (!(name in offsets)) return 0;
      const o = base + offsets[name];
      return props.find(p => p.name === name)?.type === 'double'
        ? view.getFloat64(o, true) : view.getFloat32(o, true);
    };
    positions[i*3]   = gf('x');
    positions[i*3+1] = gf('y');
    positions[i*3+2] = gf('z');
    scales[i*3]   = Math.exp(gf('scale_0'));
    scales[i*3+1] = Math.exp(gf('scale_1'));
    scales[i*3+2] = Math.exp(gf('scale_2'));
    const rgb = (sh) => Math.max(0, Math.min(255, ((gf(sh) * C0 + 0.5) * 255) | 0));
    colors[i*4]   = rgb('f_dc_0');
    colors[i*4+1] = rgb('f_dc_1');
    colors[i*4+2] = rgb('f_dc_2');
    const alpha = 1 / (1 + Math.exp(-gf('opacity')));
    opacities[i]   = alpha;
    colors[i*4+3] = Math.max(0, Math.min(255, (alpha * 255) | 0));
    rotations[i*4]   = gf('rot_0');
    rotations[i*4+1] = gf('rot_1');
    rotations[i*4+2] = gf('rot_2');
    rotations[i*4+3] = gf('rot_3');
  }
}

function allocArrays() {
  positions  = new Float32Array(numG * 3);
  scales     = new Float32Array(numG * 3);
  colors     = new Uint8Array(numG * 4);
  rotations  = new Float32Array(numG * 4);
  opacities  = new Float32Array(numG);
  deletedMask  = new Uint8Array(numG);
  selectedMask = new Uint8Array(numG);
}

// ── WEBGL ───────────────────────────────────────────────────────
function initGL() {
  gl = editCanvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: false });
  if (!gl) { console.error('[EditEngine] WebGL2 unavailable'); return; }

  const mkShader = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };

  const vs = `#version 300 es
    in vec3 aPos; in vec4 aCol;
    uniform mat4 uMVP; uniform float uPtSz;
    out vec4 vCol;
    void main(){
      gl_Position = uMVP * vec4(aPos, 1.0);
      gl_PointSize = uPtSz;
      vCol = aCol;
    }`;
  const fs = `#version 300 es
    precision mediump float;
    in vec4 vCol; out vec4 fragCol;
    void main(){
      vec2 c = gl_PointCoord - .5;
      float r = dot(c,c);
      if(r>.25) discard;
      fragCol = vec4(vCol.rgb, vCol.a*(1.0 - r*4.0));
    }`;

  prog = gl.createProgram();
  gl.attachShader(prog, mkShader(gl.VERTEX_SHADER, vs));
  gl.attachShader(prog, mkShader(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(prog);

  vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  posBuf = gl.createBuffer();
  colBuf = gl.createBuffer();
  gl.bindVertexArray(null);

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.disable(gl.DEPTH_TEST);
  gl.clearColor(0, 0, 0, 0);
}

function uploadGPU() {
  if (!gl || !positions) return;
  const posArr = [], colArr = [];
  for (let i = 0; i < numG; i++) {
    if (deletedMask[i]) continue;
    posArr.push(positions[i*3], positions[i*3+1], positions[i*3+2]);
    const sel = selectedMask[i];
    const r = sel ? 0.4 : colors[i*4]   / 255;
    const g = sel ? 1.0 : colors[i*4+1] / 255;
    const b = sel ? 0.2 : colors[i*4+2] / 255;
    colArr.push(r, g, b, opacities[i]);
  }
  _pointCount = posArr.length / 3;
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(posArr), gl.DYNAMIC_DRAW);
  const posLoc = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, colBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(colArr), gl.DYNAMIC_DRAW);
  const colLoc = gl.getAttribLocation(prog, 'aCol');
  gl.enableVertexAttribArray(colLoc);
  gl.vertexAttribPointer(colLoc, 4, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
}

// ── CAMERA ──────────────────────────────────────────────────────
function autofitCamera() {
  if (!positions || !numG) return;
  let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity,z0=Infinity,z1=-Infinity;
  for (let i = 0; i < numG; i++) {
    const x=positions[i*3], y=positions[i*3+1], z=positions[i*3+2];
    if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y; if(z<z0)z0=z; if(z>z1)z1=z;
  }
  cam.cx=(x0+x1)/2; cam.cy=(y0+y1)/2; cam.cz=(z0+z1)/2;
  cam.radius = Math.max(x1-x0, y1-y0, z1-z0) * 1.3;
}

function buildMVP() {
  const c = syncProjectionCamera();
  const pv = new THREE.Matrix4().multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse);
  return pv.elements;
}


// ── RENDER ──────────────────────────────────────────────────────
let _rafRunning = false;
function renderLoop() {
  _rafRunning = true;
  if (!editActive || !gl) { _rafRunning = false; return; }
  const w = editCanvas.clientWidth, h = editCanvas.clientHeight;
  if (editCanvas.width !== w || editCanvas.height !== h) {
    editCanvas.width = w; editCanvas.height = h;
    gl.viewport(0, 0, w, h);
  }
  gl.clear(gl.COLOR_BUFFER_BIT);
  if (!_pointCount) { requestAnimationFrame(renderLoop); return; }
  gl.useProgram(prog);
  gl.bindVertexArray(vao);
  const mvp = buildMVP();
  gl.uniformMatrix4fv(gl.getUniformLocation(prog, 'uMVP'), false, mvp);
  const ptSz = Math.max(1, Math.min(10, 500 / cam.radius));
  gl.uniform1f(gl.getUniformLocation(prog, 'uPtSz'), ptSz);
  gl.drawArrays(gl.POINTS, 0, _pointCount);
  gl.bindVertexArray(null);
  requestAnimationFrame(renderLoop);
}

function currentBrushRadius() { return Math.max(4, Number(eBrushSize?.value || 28)); }
function currentBrushDepthBias() { return Math.max(0.01, Number(eBrushDepth?.value || 0.10)); }
function updateCubeStatus() {
  if (!eCubeStatus) return;
  if (!cropCube) { eCubeStatus.textContent = 'No crop cube yet. Select the wheelchair or subject first, then build a real 3D crop volume from that selection.'; return; }
  const sx = (cropCube.maxX - cropCube.minX).toFixed(2);
  const sy = (cropCube.maxY - cropCube.minY).toFixed(2);
  const sz = (cropCube.maxZ - cropCube.minZ).toFixed(2);
  eCubeStatus.textContent = `Crop cube ready · ${sx} × ${sy} × ${sz}`;
}
function brushEraseAt(clientX, clientY) {
  if (!positions || !deletedMask || !selectedMask) return 0;
  const rect = editCanvas.getBoundingClientRect();
  const w = editCanvas.clientWidth || rect.width || 1;
  const h = editCanvas.clientHeight || rect.height || 1;
  const px = clientX - rect.left;
  const py = clientY - rect.top;
  const radius = currentBrushRadius();
  const radius2 = radius * radius;
  const depthBias = currentBrushDepthBias();
  const projCam = syncProjectionCamera();
  let frontDepth = Infinity;
  const hits = [];
  for (let i = 0; i < numG; i++) {
    if (deletedMask[i]) continue;
    const p = projectGaussianToScreen(i, projCam, w, h);
    if (!p) continue;
    const dx = p.sx - px;
    const dy = p.sy - py;
    const d2 = dx*dx + dy*dy;
    if (d2 > radius2) continue;
    hits.push({ i, d2, depth: p.depth });
    if (p.depth < frontDepth) frontDepth = p.depth;
  }
  if (!hits.length) return 0;
  let removed = 0;
  for (const hit of hits) {
    if (hit.depth > frontDepth + depthBias) continue;
    const idx = hit.i;
    deletedMask[idx] = 1;
    selectedMask[idx] = 0;
    removed++;
  }
  if (removed) { uploadGPU(); updateStats(); }
  return removed;
}
function buildCropCubeFromSelection() {
  if (!selectedMask || !positions || !deletedMask) return 0;
  let count = 0;
  let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
  for (let i=0;i<numG;i++) {
    if (deletedMask[i] || !selectedMask[i]) continue;
    const x=positions[i*3], y=positions[i*3+1], z=positions[i*3+2];
    if (x<minX) minX=x; if (y<minY) minY=y; if (z<minZ) minZ=z;
    if (x>maxX) maxX=x; if (y>maxY) maxY=y; if (z>maxZ) maxZ=z;
    count++;
  }
  if (!count) return 0;
  const pad = Math.max(cam.radius * 0.02, 0.02);
  cropCube = { minX:minX-pad, minY:minY-pad, minZ:minZ-pad, maxX:maxX+pad, maxY:maxY+pad, maxZ:maxZ+pad, count };
  updateCubeStatus();
  addHistory(`Built 3D crop cube from ${fmt(count)} selected Gaussians`);
  return count;
}
function applyCropCube(mode='outside') {
  if (!cropCube || !positions || !deletedMask) return 0;
  undoStack.push(new Uint8Array(deletedMask));
  let removed = 0;
  for (let i=0;i<numG;i++) {
    if (deletedMask[i]) continue;
    const x=positions[i*3], y=positions[i*3+1], z=positions[i*3+2];
    const inside = x>=cropCube.minX && x<=cropCube.maxX && y>=cropCube.minY && y<=cropCube.maxY && z>=cropCube.minZ && z<=cropCube.maxZ;
    if ((mode === 'outside' && !inside) || (mode === 'inside' && inside)) {
      deletedMask[i]=1; selectedMask[i]=0; removed++;
    }
  }
  if (removed) {
    uploadGPU(); updateStats();
    addHistory(`${mode === 'outside' ? 'Deleted outside' : 'Deleted inside'} crop cube · ${fmt(removed)} Gaussians removed`);
  } else {
    undoStack.pop();
  }
  return removed;
}
function runSmartCleanup() {
  if (!positions || !deletedMask || !opacities || !scales) return 0;
  undoStack.push(new Uint8Array(deletedMask));
  let aliveCount = 0, cx = 0, cy = 0, cz = 0;
  for (let i=0;i<numG;i++) {
    if (deletedMask[i]) continue;
    cx += positions[i*3]; cy += positions[i*3+1]; cz += positions[i*3+2]; aliveCount++;
  }
  if (!aliveCount) { undoStack.pop(); return 0; }
  cx/=aliveCount; cy/=aliveCount; cz/=aliveCount;
  const distances = [];
  let meanScale = 0;
  for (let i=0;i<numG;i++) {
    if (deletedMask[i]) continue;
    const dx=positions[i*3]-cx, dy=positions[i*3+1]-cy, dz=positions[i*3+2]-cz;
    const d=Math.sqrt(dx*dx+dy*dy+dz*dz);
    distances.push(d);
    meanScale += Math.max(Math.abs(scales[i*3]), Math.abs(scales[i*3+1]), Math.abs(scales[i*3+2]));
  }
  distances.sort((a,b)=>a-b);
  meanScale /= Math.max(1, aliveCount);
  const farCut = distances[Math.max(0, Math.floor(distances.length * 0.985) - 1)] || Infinity;
  const opacityCut = Math.max(0.04, Number(eKillThresh?.value || 0.08));
  const scaleCut = Math.max(Number(eScaleFilter?.value || 2.0), meanScale * 4);
  const floaterR = Math.max(0.08, Number(eFloatR?.value || 0.25));
  const floaterMin = Math.max(2, Number(eFloatN?.value || 8) - 2);
  let removed = 0;
  for (let i=0;i<numG;i++) {
    if (deletedMask[i]) continue;
    const op = opacities[i];
    const s = Math.max(Math.abs(scales[i*3]), Math.abs(scales[i*3+1]), Math.abs(scales[i*3+2]));
    const dx=positions[i*3]-cx, dy=positions[i*3+1]-cy, dz=positions[i*3+2]-cz;
    const d=Math.sqrt(dx*dx+dy*dy+dz*dz);
    let neighbors = 0;
    const floaterR2 = floaterR * floaterR;
    for (let j=0;j<numG && neighbors < floaterMin;j++) {
      if (i===j || deletedMask[j]) continue;
      const x=positions[j*3]-positions[i*3], y=positions[j*3+1]-positions[i*3+1], z=positions[j*3+2]-positions[i*3+2];
      if (x*x+y*y+z*z <= floaterR2) neighbors++;
    }
    const sparse = neighbors < floaterMin;
    const ghost = op <= opacityCut;
    const huge = s > scaleCut;
    const far = d > farCut;
    if ((ghost && sparse) || (huge && (sparse || far)) || (far && sparse)) {
      deletedMask[i]=1; selectedMask[i]=0; removed++;
    }
  }
  if (!removed) { undoStack.pop(); return 0; }
  uploadGPU(); updateStats();
  addHistory(`Smart cleanup removed ${fmt(removed)} floaters / ghosts / halo nifs`);
  return removed;
}
// ── MOUSE / CAMERA CONTROLS ─────────────────────────────────────
function setEditMode(mode) {
  editMode = mode;
  eModeOrbit?.classList.toggle('active', mode === 'orbit');
  eModeBox?.classList.toggle('active', mode === 'box');
  eModeBrush?.classList.toggle('active', mode === 'brush');
  editCanvas.className = editActive ? 'active' : '';
  if (mode === 'orbit') editCanvas.classList.add('orbit-mode');
  if (mode === 'brush') editCanvas.style.cursor = 'crosshair';
  if (editModeBadge) {
    editModeBadge.textContent = mode === 'box'
      ? '▭ BOX SELECT — drag to select Gaussians'
      : mode === 'brush'
        ? '🖌 BRUSH ERASE — paint over junk to remove it live'
        : '✦ EDIT ENGINE ACTIVE — real Gaussian selection';
  }
}

eModeOrbit?.addEventListener('click', () => setEditMode('orbit'));
eModeBox?.addEventListener('click', () => setEditMode('box'));
eModeBrush?.addEventListener('click', () => setEditMode('brush'));

editCanvas.addEventListener('mousedown', e => {
  consumePointerEvent(e);
  try { editCanvas.setPointerCapture?.(e.pointerId); } catch (_) {}
  if (!editActive || !positions) return;
  if (editMode === 'orbit') {
    orbiting = true;
    orbitClickCandidate = { x: e.clientX, y: e.clientY, shiftKey: !!e.shiftKey };
    orbStart = { x: e.clientX, y: e.clientY, theta: cam.theta, phi: cam.phi, cx: cam.cx, cy: cam.cy };
    editCanvas.style.cursor = 'grabbing';
  } else if (editMode === 'brush') {
    brushStrokeActive = true;
    undoStack.push(new Uint8Array(deletedMask));
    const removed = brushEraseAt(e.clientX, e.clientY);
    if (removed) addHistory(`Brush erased ${fmt(removed)} Gaussians`);
  } else {
    const r = editCanvas.getBoundingClientRect();
    boxDrag = { x0: e.clientX - r.left, y0: e.clientY - r.top, x1: e.clientX - r.left, y1: e.clientY - r.top, clientX0: e.clientX, clientY0: e.clientY };
  }
});
window.addEventListener('mousemove', e => {
  if (editActive && (orbiting || boxDrag || brushStrokeActive)) consumePointerEvent(e);
  if (editMode === 'orbit' && orbiting) {
    const dx = e.clientX - orbStart.x, dy = e.clientY - orbStart.y;
    if (e.buttons === 2 || e.shiftKey) {
      const s = cam.radius * 0.002;
      cam.cx = orbStart.cx - dx * s;
      cam.cy = orbStart.cy + dy * s;
    } else {
      cam.theta = orbStart.theta - dx * 0.006;
      cam.phi   = Math.max(0.08, Math.min(Math.PI - 0.08, orbStart.phi + dy * 0.006));
    }
  } else if (editMode === 'brush' && brushStrokeActive) {
    brushEraseAt(e.clientX, e.clientY);
  } else if (editMode === 'box' && boxDrag) {
    const r = editCanvas.getBoundingClientRect();
    boxDrag.x1 = e.clientX - r.left;
    boxDrag.y1 = e.clientY - r.top;
    drawSelBox();
  }
});
window.addEventListener('mouseup', e => {
  if (editActive && (orbiting || boxDrag || brushStrokeActive)) consumePointerEvent(e);
  if (orbiting) {
    const dx = (e.clientX || orbStart?.x || 0) - (orbStart?.x || 0);
    const dy = (e.clientY || orbStart?.y || 0) - (orbStart?.y || 0);
    const moved = Math.hypot(dx, dy);
    orbiting = false;
    if (editMode === 'orbit') editCanvas.style.cursor = 'grab';
    if (editMode === 'orbit' && orbitClickCandidate && moved < 6) {
      finishClickSelect(orbitClickCandidate.x, orbitClickCandidate.y, orbitClickCandidate.shiftKey || e.shiftKey);
    }
    orbitClickCandidate = null;
  }
  if (brushStrokeActive) {
    brushStrokeActive = false;
    if (undoStack.length && deletedMask && undoStack[undoStack.length - 1].every((v, i) => v === deletedMask[i])) undoStack.pop();
  }
  if (boxDrag) {
    const dx = (e.clientX || boxDrag.clientX0) - boxDrag.clientX0;
    const dy = (e.clientY || boxDrag.clientY0) - boxDrag.clientY0;
    const moved = Math.hypot(dx, dy);
    if (moved < 6) finishClickSelect(boxDrag.clientX0, boxDrag.clientY0, e.shiftKey);
    else finishBoxSelect(e.shiftKey);
    boxDrag = null; editSelRect.style.display = 'none';
  }
});
editCanvas.addEventListener('wheel', e => {
  consumePointerEvent(e);
  e.preventDefault();
  cam.radius = Math.max(0.05, cam.radius * (1 + e.deltaY * 0.001));
}, { passive: false });
editCanvas.addEventListener('contextmenu', e => consumePointerEvent(e));


editCanvas.addEventListener('pointerdown', e => {
  if (!editActive) return;
  consumePointerEvent(e);
  try { editCanvas.setPointerCapture?.(e.pointerId); } catch (_) {}
});
editCanvas.addEventListener('pointermove', e => {
  if (!editActive) return;
  if (editMode !== 'orbit' && boxDrag) consumePointerEvent(e);
});
editCanvas.addEventListener('pointerup', e => {
  if (!editActive) return;
  consumePointerEvent(e);
  try { editCanvas.releasePointerCapture?.(e.pointerId); } catch (_) {}
});
editCanvas.addEventListener('mouseleave', () => {
  if (!editActive) return;
  if (!orbiting) orbitClickCandidate = null;
});
window.addEventListener('keydown', e => {
  if (!editActive) return;
  if ([" ","ArrowUp","ArrowDown","ArrowLeft","ArrowRight"] .includes(e.key)) consumePointerEvent(e);
}, true);

function finishClickSelect(clientX, clientY, additive) {
  if (!positions || !selectedMask || !deletedMask) return;
  const rect = editCanvas.getBoundingClientRect();
  const w = editCanvas.clientWidth || rect.width || 1;
  const h = editCanvas.clientHeight || rect.height || 1;
  const px = clientX - rect.left;
  const py = clientY - rect.top;
  const pickRadius = Math.max(14, Math.min(48, Math.round(Math.min(w, h) * 0.024)));
  const pickRadius2 = pickRadius * pickRadius;
  const projCam = syncProjectionCamera();
  let best = -1;
  let bestScore = Infinity;
  let bestDepth = Infinity;
  const projected = [];
  for (let i = 0; i < numG; i++) {
    if (deletedMask[i]) continue;
    const p = projectGaussianToScreen(i, projCam, w, h);
    if (!p) continue;
    const dx = p.sx - px;
    const dy = p.sy - py;
    const d2 = dx * dx + dy * dy;
    if (d2 > pickRadius2) continue;
    projected.push({ i, d2, depth: p.depth });
    const scaleBias = Math.max(Math.abs(scales[i*3]||0), Math.abs(scales[i*3+1]||0), Math.abs(scales[i*3+2]||0), 0.001);
    const score = d2 + Math.max(0, p.depth + 1) * 18 + scaleBias * 4;
    if (score < bestScore || (Math.abs(score - bestScore) < 1e-6 && p.depth < bestDepth)) {
      best = i;
      bestScore = score;
      bestDepth = p.depth;
    }
  }
  if (best < 0) {
    addHistory('No nearby Gaussians found — zoom closer and click the visible subject edge');
    return;
  }
  if (!additive) selectedMask.fill(0);
  const bx = positions[best*3], by = positions[best*3+1], bz = positions[best*3+2];
  const baseScale = Math.max(
    Math.abs(scales[best*3] || 0),
    Math.abs(scales[best*3+1] || 0),
    Math.abs(scales[best*3+2] || 0),
    0.01
  );
  const clusterRadius = Math.max(baseScale * 7, cam.radius * 0.03);
  const clusterR2 = clusterRadius * clusterRadius;
  let selected = 0;
  for (const item of projected) {
    const idx = item.i;
    const dx = positions[idx*3] - bx;
    const dy = positions[idx*3+1] - by;
    const dz = positions[idx*3+2] - bz;
    const worldD2 = dx*dx + dy*dy + dz*dz;
    if ((worldD2 <= clusterR2 && item.depth <= bestDepth + 0.12) || item.d2 <= pickRadius2 * 0.18) {
      selectedMask[idx] = 1;
      selected++;
    }
  }
  if (!selected) {
    selectedMask[best] = 1;
    selected = 1;
  }
  updateStats();
  uploadGPU();
  addHistory(`Selected ${fmt(selected)} Gaussian${selected===1?'':'s'} near click`);
}

function finishBoxSelect(additive) {
  if (!boxDrag || !positions) return;
  const w = editCanvas.clientWidth || 1;
  const h = editCanvas.clientHeight || 1;
  const x0 = Math.min(boxDrag.x0, boxDrag.x1);
  const x1 = Math.max(boxDrag.x0, boxDrag.x1);
  const y0 = Math.min(boxDrag.y0, boxDrag.y1);
  const y1 = Math.max(boxDrag.y0, boxDrag.y1);
  const projCam = syncProjectionCamera();
  if (!additive) selectedMask.fill(0);
  let count = 0;
  for (let i = 0; i < numG; i++) {
    if (deletedMask[i]) continue;
    const p = projectGaussianToScreen(i, projCam, w, h);
    if (!p) continue;
    if (p.sx >= x0 && p.sx <= x1 && p.sy >= y0 && p.sy <= y1) {
      selectedMask[i] = 1;
      count++;
    }
  }
  uploadGPU();
  updateStats();
  addHistory(`Box-selected ${fmt(count)} Gaussians`);
}

// ── SELECTION OPS ───────────────────────────────────────────────
eSelAll?.addEventListener('click', () => {
  if (!selectedMask) return;
  for (let i=0;i<numG;i++) if(!deletedMask[i]) selectedMask[i]=1;
  uploadGPU(); updateStats(); addHistory('Selected all Gaussians');
});
eSelInvert?.addEventListener('click', () => {
  if (!selectedMask) return;
  for (let i=0;i<numG;i++) if(!deletedMask[i]) selectedMask[i]=selectedMask[i]?0:1;
  uploadGPU(); updateStats(); addHistory('Inverted selection');
});
eSelClear?.addEventListener('click', () => {
  if (!selectedMask) return;
  selectedMask.fill(0); uploadGPU(); updateStats();
});

// ── FLOATER DETECTION ───────────────────────────────────────────
eFloatR?.addEventListener('input', () => {
  if(eFloatRLbl) eFloatRLbl.textContent = `r=${parseFloat(eFloatR.value).toFixed(2)}`;
});
eFloatN?.addEventListener('input', () => {
  if(eFloatNLbl) eFloatNLbl.textContent = eFloatN.value;
});
eSelectFloaters?.addEventListener('click', async () => {
  if (!positions || !numG) return;
  eSelectFloaters.textContent = 'Scanning…'; eSelectFloaters.disabled = true;
  await new Promise(r => setTimeout(r, 20));
  const radius = parseFloat(eFloatR.value);
  const minN   = parseInt(eFloatN.value);
  const r2 = radius * radius;
  selectedMask.fill(0);
  let floaters = 0;
  for (let i = 0; i < numG; i++) {
    if (deletedMask[i]) continue;
    const px=positions[i*3], py=positions[i*3+1], pz=positions[i*3+2];
    let n = 0;
    for (let j = 0; j < numG && n < minN; j++) {
      if (i===j||deletedMask[j]) continue;
      const dx=positions[j*3]-px, dy=positions[j*3+1]-py, dz=positions[j*3+2]-pz;
      if (dx*dx+dy*dy+dz*dz < r2) n++;
    }
    if (n < minN) { selectedMask[i]=1; floaters++; }
  }
  uploadGPU(); updateStats();
  eSelectFloaters.textContent = '⚡ Auto-select floaters';
  addHistory(`Auto-selected ${fmt(floaters)} floaters (r=${radius}, n≥${minN})`);
});

// ── OPACITY SELECTION ───────────────────────────────────────────
eOpThresh?.addEventListener('input', () => {
  if(eOpThreshLbl) eOpThreshLbl.textContent = `α ≤ ${parseFloat(eOpThresh.value).toFixed(2)}`;
});
eSelectLowOp?.addEventListener('click', () => {
  if (!opacities) return;
  const thresh = parseFloat(eOpThresh.value);
  selectedMask.fill(0); let count = 0;
  for (let i=0;i<numG;i++) {
    if (!deletedMask[i] && opacities[i] <= thresh) { selectedMask[i]=1; count++; }
  }
  uploadGPU(); updateStats();
  addHistory(`Selected ${fmt(count)} ghost nifs (α≤${thresh})`);
});

// ── SCALE SELECTION ─────────────────────────────────────────────
eScaleSel?.addEventListener('input', () => {
  if(eScaleSelLbl) eScaleSelLbl.textContent = `max ${parseFloat(eScaleSel.value).toFixed(1)}`;
});
eSelectLargeScale?.addEventListener('click', () => {
  if (!scales) return;
  const maxS = parseFloat(eScaleSel.value);
  selectedMask.fill(0); let count = 0;
  for (let i=0;i<numG;i++) {
    if (deletedMask[i]) continue;
    const s = Math.max(Math.abs(scales[i*3]), Math.abs(scales[i*3+1]), Math.abs(scales[i*3+2]));
    if (s > maxS) { selectedMask[i]=1; count++; }
  }
  uploadGPU(); updateStats();
  addHistory(`Selected ${fmt(count)} halo nifs (scale>${maxS})`);
});

// ── DELETE ──────────────────────────────────────────────────────
eDeleteQuick?.addEventListener('click', () => eDelete?.click());

eDelete?.addEventListener('click', () => {
  if (!selectedMask) return;
  undoStack.push(new Uint8Array(deletedMask));
  let count = 0;
  for (let i=0;i<numG;i++) if(selectedMask[i]&&!deletedMask[i]) { deletedMask[i]=1; count++; }
  selectedMask.fill(0);
  uploadGPU(); updateStats();
  addHistory(`🗑 Deleted ${fmt(count)} Gaussians`);
});

eUndo?.addEventListener('click', () => {
  if (!undoStack.length) return;
  deletedMask.set(undoStack.pop());
  uploadGPU(); updateStats();
  addHistory('↩ Undo: restored deletion');
});

// ── OPACITY SHARPEN ─────────────────────────────────────────────
eKillThresh?.addEventListener('input', () => {
  if(eKillLbl) eKillLbl.textContent = `kill ≤ ${parseFloat(eKillThresh.value).toFixed(2)}`;
});
eBoost?.addEventListener('input', () => {
  if(eBoostLbl) eBoostLbl.textContent = `${parseFloat(eBoost.value).toFixed(1)}×`;
});
eSharpen?.addEventListener('click', () => {
  if (!opacities) return;
  undoStack.push(new Uint8Array(deletedMask));
  const kill = parseFloat(eKillThresh.value);
  const boost = parseFloat(eBoost.value);
  let killed=0, boosted=0;
  for (let i=0;i<numG;i++) {
    if (deletedMask[i]) continue;
    if (opacities[i] <= kill) { deletedMask[i]=1; killed++; }
    else { opacities[i]=Math.min(1, opacities[i]*boost); colors[i*4+3]=Math.min(255,(opacities[i]*255)|0); boosted++; }
  }
  uploadGPU(); updateStats();
  addHistory(`✦ Sharpen: killed ${fmt(killed)}, boosted ${fmt(boosted)} (kill=${kill}, ×${boost})`);
});

// ── DENSITY PRUNE ───────────────────────────────────────────────
eDensity?.addEventListener('input', () => {
  if(eDensityLbl) eDensityLbl.textContent = `keep ${eDensity.value}%`;
});
eDensityPrune?.addEventListener('click', async () => {
  if (!positions||!numG) return;
  eDensityPrune.textContent = 'Scoring…'; eDensityPrune.disabled = true;
  await new Promise(r => setTimeout(r, 20));
  const keepPct = parseFloat(eDensity.value) / 100;
  const r = cam.radius * 0.07; const r2 = r*r;
  const alive = [];
  for (let i=0;i<numG;i++) {
    if (deletedMask[i]) continue;
    const px=positions[i*3], py=positions[i*3+1], pz=positions[i*3+2];
    let n=0;
    for (let j=0;j<numG;j++) {
      if(i===j||deletedMask[j]) continue;
      const dx=positions[j*3]-px,dy=positions[j*3+1]-py,dz=positions[j*3+2]-pz;
      if(dx*dx+dy*dy+dz*dz<r2) n++;
    }
    alive.push({i, n});
  }
  alive.sort((a,b)=>a.n-b.n);
  const cutIdx = Math.floor(alive.length * (1 - keepPct));
  undoStack.push(new Uint8Array(deletedMask));
  let pruned=0;
  for (let k=0;k<cutIdx;k++) { deletedMask[alive[k].i]=1; pruned++; }
  uploadGPU(); updateStats();
  eDensityPrune.textContent = 'Density prune';
  addHistory(`Density prune: removed ${fmt(pruned)} sparse Gaussians (keep ${keepPct*100|0}%)`);
});

// ── SCALE FILTER ─────────────────────────────────────────────────
eScaleFilter?.addEventListener('input', () => {
  if(eScaleFilterLbl) eScaleFilterLbl.textContent = `max ${parseFloat(eScaleFilter.value).toFixed(1)}`;
});
eScaleFilterBtn?.addEventListener('click', () => {
  if (!scales) return;
  const maxS = parseFloat(eScaleFilter.value);
  undoStack.push(new Uint8Array(deletedMask));
  let removed=0;
  for (let i=0;i<numG;i++) {
    if (deletedMask[i]) continue;
    const s = Math.max(Math.abs(scales[i*3]),Math.abs(scales[i*3+1]),Math.abs(scales[i*3+2]));
    if (s > maxS) { deletedMask[i]=1; removed++; }
  }
  uploadGPU(); updateStats();
  addHistory(`Scale filter: removed ${fmt(removed)} halo nifs (max=${maxS})`);
});


eBrushSize?.addEventListener('input', () => { if (eBrushSizeLbl) eBrushSizeLbl.textContent = `size ${Number(eBrushSize.value).toFixed(0)}`; });
eBrushDepth?.addEventListener('input', () => { if (eBrushDepthLbl) eBrushDepthLbl.textContent = `front ${Number(eBrushDepth.value).toFixed(2)}`; });
eDeleteQuick?.addEventListener('click', () => eDelete?.click());
eSmartCleanup?.addEventListener('click', () => {
  const removed = runSmartCleanup();
  if (!removed) addHistory('Smart cleanup found nothing removable — tighten floaters / opacity settings or zoom closer');
});
eCubeFromSelection?.addEventListener('click', () => {
  const count = buildCropCubeFromSelection();
  if (!count) addHistory('Crop cube needs a current selection first');
});
eCropOutsideCube?.addEventListener('click', () => {
  const removed = applyCropCube('outside');
  if (!removed) addHistory('No outside-cube gaussians removed');
});
eCropInsideCube?.addEventListener('click', () => {
  const removed = applyCropCube('inside');
  if (!removed) addHistory('No inside-cube gaussians removed');
});
eClearCube?.addEventListener('click', () => { cropCube = null; updateCubeStatus(); addHistory('Cleared crop cube'); });

// ── EXPORT ───────────────────────────────────────────────────────
function buildCleanedNifBuffer() {
  let alive = 0;
  for (let i=0;i<numG;i++) if(!deletedMask[i]) alive++;
  const out = new ArrayBuffer(alive * NIF_ROW);
  const view = new DataView(out);
  const ob   = new Uint8Array(out);
  let wi = 0;
  for (let i=0;i<numG;i++) {
    if (deletedMask[i]) continue;
    const b = wi * NIF_ROW;
    view.setFloat32(b,    positions[i*3],   true);
    view.setFloat32(b+4,  positions[i*3+1], true);
    view.setFloat32(b+8,  positions[i*3+2], true);
    view.setFloat32(b+12, scales[i*3],   true);
    view.setFloat32(b+16, scales[i*3+1], true);
    view.setFloat32(b+20, scales[i*3+2], true);
    ob[b+24] = colors[i*4];
    ob[b+25] = colors[i*4+1];
    ob[b+26] = colors[i*4+2];
    ob[b+27] = Math.min(255, (opacities[i]*255)|0);
    ob[b+28] = Math.max(0, Math.min(255, ((rotations[i*4]+1)*128)|0));
    ob[b+29] = Math.max(0, Math.min(255, ((rotations[i*4+1]+1)*128)|0));
    ob[b+30] = Math.max(0, Math.min(255, ((rotations[i*4+2]+1)*128)|0));
    ob[b+31] = Math.max(0, Math.min(255, ((rotations[i*4+3]+1)*128)|0));
    wi++;
  }
  return { buf: out, alive };
}

function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

eExportNif?.addEventListener('click', () => {
  if (!positions) return;
  const {buf, alive} = buildCleanedNifBuffer();
  downloadBlob(new Blob([buf], {type:'application/octet-stream'}), `${nifFileName}_cleaned.nif`);
  addHistory(`⬇ Exported ${fmt(alive)} Gaussians → ${nifFileName}_cleaned.nif`);
});

eExportReport?.addEventListener('click', () => {
  if (!deletedMask) return;
  let dead=0, sel=0;
  for (let i=0;i<numG;i++) { if(deletedMask[i])dead++; if(selectedMask[i])sel++; }
  const lines = [
    'FUMOCA Edit Engine — Edit Report',
    '══════════════════════════════════════════',
    `File:          ${nifFileName}`,
    `Date:          ${new Date().toISOString()}`,
    `Total:         ${numG}`,
    `Alive:         ${numG - dead}`,
    `Deleted:       ${dead} (${((dead/numG)*100).toFixed(1)}%)`,
    `Selected now:  ${sel}`,
    '',
    '── Edit History ──',
    ...editHistory.map(h => `[${h.t}] ${h.msg}`),
    '',
    'Generated by FUMOCA Edit Engine v1.0 — nifWorld'
  ];
  downloadBlob(new Blob([lines.join('\n')], {type:'text/plain'}), `${nifFileName}_edit_report.txt`);
  addHistory('Exported edit report');
});

// ── SAVE TO SUPABASE ─────────────────────────────────────────────
eSaveToSupabase?.addEventListener('click', async () => {
  if (!positions) return;
  const supabase = window._fumocaSupabase;
  const currentRecord = window._fumocaCurrentRecord;
  if (!supabase) {
    setStatus('Supabase client not available — check config.js', 'error'); return;
  }
  eSaveToSupabase.disabled = true;
  eSaveToSupabase.textContent = 'Uploading…';
  setStatus('Building cleaned .nif…', 'progress');
  try {
    const {buf, alive} = buildCleanedNifBuffer();
    const cleanedName = `${nifFileName}_cleaned_${Date.now()}.nif`;
    const path = `nifs/${cleanedName}`;
    setStatus('Uploading to R2 storage…', 'progress');
    const { publicUrl, error: uploadErr } = await r2
      .from('nif-files')
      .upload(path, new Blob([buf], { type: 'application/octet-stream' }), { contentType: 'application/octet-stream' });
    if (uploadErr) throw new Error('R2 upload: ' + uploadErr.message);
    setStatus('Creating nif record…', 'progress');
    const { user } = (await supabase.auth.getUser()).data;
    const variantRecord = {
      user_id: user?.id,
      title: (currentRecord?.title || nifFileName) + ' (cleaned)',
      description: `Cleaned variant — ${fmt(alive)} Gaussians, ${fmt(numG - alive)} removed`,
      file_url: publicUrl,
      status: 'ready',
      parent_id: currentRecord?.id || null,
      variant_type: 'edit_engine_clean',
      gaussian_count: alive,
      edit_recipe: JSON.stringify({ history: editHistory.slice(0, 20) }),
    };
    const { error: insertErr } = await supabase.from('nifs').insert(variantRecord);
    if (insertErr) throw new Error('DB insert: ' + insertErr.message);
    setStatus(`✓ Saved — ${fmt(alive)} Gaussians → ${cleanedName}`, 'success');
    addHistory(`☁ Saved to Supabase: ${cleanedName} (${fmt(alive)} Gaussians)`);
  } catch (err) {
    setStatus('Save failed: ' + err.message, 'error');
    addHistory('☁ Supabase save failed: ' + err.message);
    console.error('[EditEngine] Supabase save:', err);
  } finally {
    eSaveToSupabase.textContent = '☁ Save cleaned nif to cloud';
    eSaveToSupabase.disabled = false;
  }
});

function setStatus(msg, type) {
  if (!eSaveStatus) return;
  eSaveStatus.style.display = 'block';
  eSaveStatus.textContent = msg;
  eSaveStatus.style.color = type === 'error' ? 'var(--danger)'
    : type === 'success' ? 'var(--acid2)'
    : 'var(--neon)';
}

// ── KEYBOARD ─────────────────────────────────────────────────────
window.addEventListener('keydown', e => {
  if (!editActive) return;
  const active = document.activeElement;
  if (active && active.tagName === 'INPUT') return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && eDelete && !eDelete.disabled) eDelete.click();
  if (e.key === 'z' && (e.ctrlKey||e.metaKey)) { e.preventDefault(); eUndo?.click(); }
  if (e.key === 'a' && (e.ctrlKey||e.metaKey)) { e.preventDefault(); eSelAll?.click(); }
  if (e.key === 'Escape') { eSelClear?.click(); setEditMode('orbit'); }
  if (e.key === 'b') setEditMode('box');
  if (e.key === 'o') setEditMode('orbit');
});

// ── EXPOSE TO VIEWER ──────────────────────────────────────────────
// viewer.js exposes window._fumocaNifUrl after loading
// We also expose the engine state so other modules can read it
window._editEngine = {
  isActive: () => editActive,
  getDeletedCount: () => { if(!deletedMask)return 0; let d=0; for(let i=0;i<numG;i++) if(deletedMask[i])d++; return d; },
  getAliveCount: () => { if(!deletedMask)return numG; let d=0; for(let i=0;i<numG;i++) if(deletedMask[i])d++; return numG-d; },
};

// Sync the current fileUrl when it becomes available
function watchForNifUrl() {
  if (window._fumocaNifUrl && !engineReady && editActive) {
    loadNifForEngine();
  }
}
// Disabled polling reload loop; rely on explicit recordLoaded/open events for a stable editing feel.
// setInterval(watchForNifUrl, 800);

// ── Renderer preview bridge ─────────────────────────────────────
let _fumocaPreviewUrl = null;
let _fumocaPreviewDisplayUrl = null;
let _previewBuildTimer = null;
function _fumocaRevokePreviewUrl() {
  try { if (_fumocaPreviewUrl) URL.revokeObjectURL(_fumocaPreviewUrl); } catch (_) {}
  _fumocaPreviewUrl = null;
  _fumocaPreviewDisplayUrl = null;
}
function _fumocaBuildPreviewBlobUrl() {
  if (!positions || !deletedMask) return null;
  const { buf, alive } = buildCleanedNifBuffer();
  _fumocaRevokePreviewUrl();
  _fumocaPreviewUrl = URL.createObjectURL(new Blob([buf], { type: 'application/octet-stream' }));
  // Gaussiannifs3D checks the URL string for an extension. Blob URLs have none,
  // so provide a display URL with a fragment hint while keeping the raw blob URL for revoke().
  _fumocaPreviewDisplayUrl = `${_fumocaPreviewUrl}#preview.nif`;
  return { url: _fumocaPreviewDisplayUrl, rawUrl: _fumocaPreviewUrl, alive, total: numG || 0 };
}
function _fumocaScheduleRendererPreview() {
  clearTimeout(_previewBuildTimer);
  _previewBuildTimer = setTimeout(() => {
    try {
      if (!positions || !deletedMask) return;
      let dead = 0;
      for (let i = 0; i < numG; i++) if (deletedMask[i]) dead++;
      if (!dead) {
        _fumocaRevokePreviewUrl();
        window.dispatchEvent(new CustomEvent('fumoca:editPreviewCleared', { detail: { total: numG || 0 } }));
        return;
      }
      const detail = _fumocaBuildPreviewBlobUrl();
      if (detail?.url) window.dispatchEvent(new CustomEvent('fumoca:editPreviewReady', { detail }));
    } catch (err) {
      console.warn('[EditEngine] preview bridge failed', err);
    }
  }, 120);
}
window.addEventListener('beforeunload', _fumocaRevokePreviewUrl);
// Disabled auto preview requests; current renderer cannot safely hot-swap edit previews.
// window.addEventListener('fumoca:requestEditPreview', _fumocaScheduleRendererPreview);

// Initial button states
if (eBrushSizeLbl) eBrushSizeLbl.textContent = `size ${Number(eBrushSize?.value || 28).toFixed(0)}`;
if (eBrushDepthLbl) eBrushDepthLbl.textContent = `front ${Number(eBrushDepth?.value || 0.10).toFixed(2)}`;
updateCubeStatus();
updateStats();
renderHistory();


// ── V31 live edit mask bridge ───────────────────────────────────
function _fumocaEmitEditMask() {
  try {
    const deleted = deletedMask ? Array.from(deletedMask) : [];
    const selected = selectedMask ? Array.from(selectedMask) : [];
    window._fumocaEditMask = { deleted, selected, total: numG || 0 };
    window._editEngine = Object.assign(window._editEngine || {}, {
      buildCleanedNifBuffer,
      getPointCloud: () => ({ positions, count: numG || 0, center: { x: cam.cx || 0, y: cam.cy || 0, z: cam.cz || 0 }, radius: cam.radius || 1 }),
      getPreviewBlobUrl: () => _fumocaPreviewDisplayUrl || _fumocaPreviewUrl,
      requestRendererPreview: _fumocaScheduleRendererPreview,
    });
    window.dispatchEvent(new CustomEvent('fumoca:editMaskUpdated', { detail: window._fumocaEditMask }));
    _fumocaScheduleRendererPreview();
  } catch (_) {}
}
const _origUploadGPU = uploadGPU;
uploadGPU = function patchedUploadGPU() {
  const out = _origUploadGPU.apply(this, arguments);
  _fumocaEmitEditMask();
  return out;
};
window.addEventListener('fumoca:recordLoaded', () => {
  const currentUrl = window._fumocaNifUrl || new URLSearchParams(window.location.search).get('file') || '';
  if (currentUrl && currentUrl !== loadedNifUrl) {
    engineReady = false;
    try { window.dispatchEvent(new CustomEvent('fumoca:editPreviewCleared', { detail: { total: numG || 0 } })); } catch (_) {}
  }
});
window.addEventListener('fumoca:requestEditMask', _fumocaEmitEditMask);

// ─── v60: Live Edit Mode ──────────────────────────────────────────────────────
// When launched with ?live=true&nifId=X, patches the save button to update
// the existing published nif instead of creating a new variant.
(async () => {
  const params   = new URLSearchParams(location.search);
  const isLive   = params.get('live') === 'true';
  const nifId  = params.get('nifId');
  if (!isLive || !nifId) return;

  const sb = window._fumocaSupabase;
  if (!sb) return;

  const { data } = await sb.from('nifs').select('*').eq('id', nifId).single();
  if (!data) return;

  window._fumocaCurrentRecord = data;

  // Restore previous edit_recipe if present
  if (data.edit_recipe && typeof data.edit_recipe === 'object' && Object.keys(data.edit_recipe).length) {
    console.log('[EditEngine v60] Restoring edit recipe from live nif:', data.edit_recipe);
    window._fumocaEditRecipeRestored = data.edit_recipe;
  }

  // Swap the save button label + behaviour
  const saveBtn = document.getElementById('eSaveToSupabase') || document.querySelector('[id*="save" i]');
  if (saveBtn) {
    saveBtn.textContent = '💾 Save Live Changes';
    saveBtn.title       = 'Updates the published nif visible to everyone on the feed';
  }

  // Override saveLiveEdit so edit-engine can call it directly
  if (!window.saveLiveEdit) {
    window.saveLiveEdit = async (delta) => {
      const rec = window._fumocaCurrentRecord;
      if (!rec?.id) return false;
      const merged = { ...(rec.edit_recipe || {}), ...delta, lastSaved: new Date().toISOString() };
      const payload = { edit_recipe: merged, last_edited_at: new Date().toISOString() };
      if (window._fumocaEditedNifUrl) payload.nif_url = window._fumocaEditedNifUrl;
      const { error } = await sb.from('nifs').update(payload).eq('id', rec.id);
      if (!error) window._fumocaCurrentRecord = { ...rec, edit_recipe: merged };
      return !error;
    };
  }

  console.log('%c[EditEngine v60] Live Edit Mode active — changes update the published nif', 'color:#c8ff00;font-weight:800');
})();
