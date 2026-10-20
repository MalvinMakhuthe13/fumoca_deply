/* FUMOCA Alignment Studio v3 — interactive 3D path viewer + multi-export */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const $ = (id) => document.getElementById(id);
const fileInput = $('alignFiles');
const drop = $('alignDrop');
const listEl = $('alignFrameList');
if (!fileInput || !drop || !listEl) {
  console.warn('[alignment] missing DOM');
} else {

/** @type {{id:string,name:string,url:string,file?:File,blob?:Blob,enabled:boolean,yaw:number,kind:string}[]} */
let frames = [];
let activeIndex = -1;
let pathCursor = 0;
let controlPoints = [];
let cameras = [];
let videoFile = null;
let cpSeq = 1;
let playTimer = null;
let showFrustums = true;
let showCloud = true;

/* ── Three.js scene ─────────────────────────────────────── */
const host = $('alignThreeHost');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0f18);
const camera3d = new THREE.PerspectiveCamera(50, 1, 0.05, 500);
camera3d.position.set(4.5, 3.2, 5.5);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
host.appendChild(renderer.domElement);
const controls = new OrbitControls(camera3d, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 0.3, 0);
controls.update();

scene.add(new THREE.AmbientLight(0x8899aa, 0.7));
const key = new THREE.DirectionalLight(0xffffff, 0.85);
key.position.set(3, 6, 4);
scene.add(key);

const grid = new THREE.GridHelper(12, 24, 0x1a3048, 0x121a28);
scene.add(grid);
const axes = new THREE.AxesHelper(1.2);
scene.add(axes);

const subjectGroup = new THREE.Group();
scene.add(subjectGroup);
const boxGeo = new THREE.BoxGeometry(1.2, 0.7, 1.0);
const boxEdges = new THREE.EdgesGeometry(boxGeo);
const boxLine = new THREE.LineSegments(boxEdges, new THREE.LineBasicMaterial({ color: 0xc8ff00 }));
boxLine.position.y = 0.35;
subjectGroup.add(boxLine);
const subjectMesh = new THREE.Mesh(
  new THREE.BoxGeometry(1.15, 0.65, 0.95),
  new THREE.MeshStandardMaterial({ color: 0x1a2838, transparent: true, opacity: 0.35, roughness: 0.4 })
);
subjectMesh.position.y = 0.35;
subjectGroup.add(subjectMesh);

const pathGroup = new THREE.Group();
scene.add(pathGroup);
const cloudGroup = new THREE.Group();
scene.add(cloudGroup);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let cameraMeshes = [];

function resizeThree() {
  const w = host.clientWidth || 640;
  const h = host.clientHeight || 360;
  camera3d.aspect = w / h;
  camera3d.updateProjectionMatrix();
  renderer.setSize(w, h, false);
}
resizeThree();
window.addEventListener('resize', () => {
  resizeThree();
  drawFrame();
  drawView();
});

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera3d);
}
animate();

function clearPathVisuals() {
  while (pathGroup.children.length) {
    const o = pathGroup.children.pop();
    o.geometry?.dispose?.();
    o.material?.dispose?.();
  }
  cameraMeshes = [];
}

function buildProxyCloud() {
  while (cloudGroup.children.length) {
    const o = cloudGroup.children.pop();
    o.geometry?.dispose?.();
    o.material?.dispose?.();
  }
  if (!showCloud || !cameras.length) return;
  const n = Math.min(2500, 400 + cameras.length * 8);
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    // cluster inside subject bbox + a bit of volume
    const x = (Math.random() - 0.5) * 1.1;
    const y = Math.random() * 0.7;
    const z = (Math.random() - 0.5) * 0.95;
    pos[i * 3] = x;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = z;
    const t = Math.random();
    col[i * 3] = 0.4 + t * 0.5;
    col[i * 3 + 1] = 0.55 + t * 0.4;
    col[i * 3 + 2] = 0.65 + t * 0.3;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const pts = new THREE.Points(
    geo,
    new THREE.PointsMaterial({ size: 0.03, vertexColors: true, transparent: true, opacity: 0.85 })
  );
  cloudGroup.add(pts);
}

function makeFrustum(fovDeg, aspect = 1.4, depth = 0.55) {
  const fov = (fovDeg * Math.PI) / 180;
  const h = Math.tan(fov / 2) * depth;
  const w = h * aspect;
  const verts = new Float32Array([
    0, 0, 0, -w, -h, -depth, 0, 0, 0, w, -h, -depth, 0, 0, 0, w, h, -depth, 0, 0, 0, -w, h, -depth, -w, -h, -depth, w, -h, -depth, w, -h, -depth, w, h, -depth, w, h, -depth, -w, h, -depth, -w, h, -depth, -w, -h, -depth,
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x56b4ff, transparent: true, opacity: 0.55 }));
}

function rebuildPathVisuals() {
  clearPathVisuals();
  if (!cameras.length) {
    buildProxyCloud();
    return;
  }
  const curvePts = cameras.map((c) => new THREE.Vector3(c.position.x, c.position.y, c.position.z));
  if (curvePts.length >= 2) {
    const curve = new THREE.CatmullRomCurve3(curvePts, false, 'catmullrom', 0.15);
    const tube = new THREE.TubeGeometry(curve, Math.max(32, cameras.length * 2), 0.012, 6, false);
    pathGroup.add(new THREE.Mesh(tube, new THREE.MeshBasicMaterial({ color: 0x3d9eff, transparent: true, opacity: 0.7 })));
  }
  const fov = Number($('alignFov')?.value || 50);
  cameras.forEach((cam, i) => {
    const g = new THREE.Group();
    g.position.set(cam.position.x, cam.position.y, cam.position.z);
    g.lookAt(cam.look_at.x, cam.look_at.y, cam.look_at.z);
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(i === pathCursor ? 0.07 : 0.045, 12, 12),
      new THREE.MeshBasicMaterial({ color: i === pathCursor ? 0xc8ff00 : 0x7ec8ff })
    );
    g.add(body);
    if (showFrustums) {
      const fr = makeFrustum(fov);
      if (i === pathCursor) fr.material.color.setHex(0xc8ff00);
      g.add(fr);
    }
    g.userData = { pathIndex: i };
    pathGroup.add(g);
    cameraMeshes.push(body);
  });
  buildProxyCloud();
  if ($('alignHudCameras')) $('alignHudCameras').textContent = `${cameras.length} cameras`;
}

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (!cameraMeshes.length) return;
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera3d);
  const hits = raycaster.intersectObjects(cameraMeshes, true);
  if (!hits.length) return;
  let obj = hits[0].object;
  while (obj && obj.userData?.pathIndex === undefined) obj = obj.parent;
  if (obj?.userData?.pathIndex === undefined) return;
  pathCursor = obj.userData.pathIndex;
  setActiveFromPath();
  refreshAll();
});

$('alignViewReset')?.addEventListener('click', () => {
  camera3d.position.set(4.5, 3.2, 5.5);
  controls.target.set(0, 0.3, 0);
  controls.update();
});
$('alignViewTop')?.addEventListener('click', () => {
  camera3d.position.set(0.01, 8, 0.01);
  controls.target.set(0, 0, 0);
  controls.update();
});
$('alignToggleFrustums')?.addEventListener('click', () => {
  showFrustums = !showFrustums;
  rebuildPathVisuals();
});
$('alignToggleCloud')?.addEventListener('click', () => {
  showCloud = !showCloud;
  buildProxyCloud();
});

/* ── Pane layout ────────────────────────────────────────── */
document.querySelectorAll('.align-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.align-tab').forEach((t) => t.classList.remove('is-active'));
    tab.classList.add('is-active');
    const body = $('alignStageBody');
    if (body) body.dataset.layout = tab.dataset.pane || '3d';
    resizeThree();
    drawView();
  });
});

/* ── Frame state ────────────────────────────────────────── */
function enabledFrames() {
  return frames.filter((f) => f.enabled);
}
function enabledIndices() {
  const out = [];
  frames.forEach((f, i) => {
    if (f.enabled) out.push(i);
  });
  return out;
}
function revokeAll() {
  frames.forEach((f) => {
    if (f.url?.startsWith('blob:')) URL.revokeObjectURL(f.url);
  });
}
function updateCounts() {
  const n = frames.length;
  const on = enabledFrames().length;
  if ($('alignFileCount')) $('alignFileCount').textContent = String(n);
  const has = on > 0;
  [
    'alignExportZip',
    'alignExportZip2',
    'alignExportJson',
    'alignExportNerf',
    'alignExportColmap',
    'alignExportSeq',
    'alignSaveLocal',
    'alignClear',
  ].forEach((id) => {
    const b = $(id);
    if (b) b.disabled = id === 'alignClear' ? n === 0 : !has;
  });
  const scrub = $('alignScrub');
  if (scrub) {
    scrub.max = String(Math.max(0, on - 1));
    if (pathCursor > on - 1) pathCursor = Math.max(0, on - 1);
    scrub.value = String(pathCursor);
  }
  if ($('alignScrubOut')) $('alignScrubOut').textContent = on ? `${pathCursor + 1} / ${on}` : '0 / 0';
}
function setActiveFromPath() {
  const idxs = enabledIndices();
  if (!idxs.length) {
    activeIndex = -1;
    return;
  }
  pathCursor = Math.max(0, Math.min(pathCursor, idxs.length - 1));
  activeIndex = idxs[pathCursor];
}
function refreshAll() {
  renderList();
  drawFrame();
  drawView();
  rebuildPathVisuals();
  renderFilmstrip();
  updateCounts();
}

function renderList() {
  listEl.innerHTML = '';
  if (!frames.length) {
    listEl.innerHTML = '<li style="padding:8px;color:#666">No frames</li>';
    updateCounts();
    return;
  }
  frames.forEach((f, i) => {
    const li = document.createElement('li');
    li.className = (i === activeIndex ? 'is-active ' : '') + (f.enabled ? '' : 'is-off');
    li.innerHTML = `<img src="${f.url}" alt=""><div title="${f.name}">${String(i + 1).padStart(3, '0')} ${f.name}</div>
      <input type="checkbox" ${f.enabled ? 'checked' : ''} data-en="${i}">`;
    li.addEventListener('click', (e) => {
      if (e.target.closest('input')) return;
      activeIndex = i;
      const p = enabledIndices().indexOf(i);
      if (p >= 0) pathCursor = p;
      refreshAll();
    });
    li.querySelector('input')?.addEventListener('change', (e) => {
      f.enabled = !!e.target.checked;
      rebuildPath();
      setActiveFromPath();
      refreshAll();
    });
    listEl.append(li);
  });
  updateCounts();
}

function renderFilmstrip() {
  const strip = $('alignFilmstrip');
  if (!strip) return;
  strip.innerHTML = '';
  enabledIndices().forEach((fi, p) => {
    const f = frames[fi];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = p === pathCursor ? 'is-active' : '';
    btn.innerHTML = `<img src="${f.url}" alt=""><span>${p + 1}</span>`;
    btn.addEventListener('click', () => {
      pathCursor = p;
      setActiveFromPath();
      refreshAll();
    });
    strip.append(btn);
  });
}

function drawImageOnCanvas(canvas, frame, withPoints) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth || 400;
  const h = Math.round(w * 0.62);
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#05080f';
  ctx.fillRect(0, 0, w, h);
  if (!frame) {
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = '12px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('No frame', w / 2, h / 2);
    canvas._layout = null;
    return;
  }
  const img = new Image();
  img.onload = () => {
    const scale = Math.min(w / img.width, h / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    const dx = (w - dw) / 2;
    const dy = (h - dh) / 2;
    ctx.drawImage(img, dx, dy, dw, dh);
    canvas._layout = { dx, dy, dw, dh };
    if (withPoints) {
      controlPoints
        .filter((p) => p.frameIndex === activeIndex)
        .forEach((p) => {
          const px = dx + p.x * dw;
          const py = dy + p.y * dh;
          ctx.fillStyle = '#c8ff00';
          ctx.beginPath();
          ctx.arc(px, py, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.font = '10px system-ui';
          ctx.fillText(p.id, px + 7, py + 3);
        });
    }
  };
  img.src = frame.url;
}
function drawFrame() {
  drawImageOnCanvas($('alignFrameCanvas'), frames[activeIndex], true);
  const ul = $('alignCpList');
  if (ul) {
    const pts = controlPoints.filter((p) => p.frameIndex === activeIndex);
    ul.innerHTML =
      pts.map((p) => `<li>${p.id} (${(p.x * 100).toFixed(0)}%,${(p.y * 100).toFixed(0)}%)</li>`).join('') ||
      '<li>Click image to place points</li>';
  }
}
function drawView() {
  drawImageOnCanvas($('alignViewCanvas'), frames[activeIndex], false);
  const meta = $('alignViewMeta');
  if (!meta) return;
  const f = frames[activeIndex];
  if (!f) {
    meta.textContent = 'No frame selected';
    return;
  }
  const cam = cameras[pathCursor];
  meta.textContent = `${f.name} · ${pathCursor + 1}/${enabledFrames().length} · yaw ${(cam?.yaw_deg ?? f.yaw ?? 0).toFixed?.(1) || 0}°`;
}

$('alignFrameCanvas')?.addEventListener('click', (e) => {
  const c = $('alignFrameCanvas');
  const layout = c?._layout;
  if (!layout || activeIndex < 0) return;
  const rect = c.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  if (x < layout.dx || y < layout.dy || x > layout.dx + layout.dw || y > layout.dy + layout.dh) return;
  const id = ($('alignCpId')?.value || '').trim() || `cp_${cpSeq}`;
  controlPoints.push({
    id,
    frameIndex: activeIndex,
    x: (x - layout.dx) / layout.dw,
    y: (y - layout.dy) / layout.dh,
  });
  drawFrame();
});
$('alignCpClear')?.addEventListener('click', () => {
  controlPoints = controlPoints.filter((p) => p.frameIndex !== activeIndex);
  drawFrame();
});
$('alignCpNextId')?.addEventListener('click', () => {
  cpSeq += 1;
  if ($('alignCpId')) $('alignCpId').value = `cp_${cpSeq}`;
});

function rebuildPath() {
  const type = $('alignPathType')?.value || 'orbit';
  const radius = Number($('alignRadius')?.value || 2.5);
  const elev = (Number($('alignElev')?.value || 12) * Math.PI) / 180;
  const list = enabledFrames();
  cameras = [];
  list.forEach((f, i) => {
    const t = list.length <= 1 ? 0 : i / (list.length - 1);
    let yaw = 0;
    if (type === 'orbit') yaw = t * Math.PI * 2;
    else if (type === 'arc') yaw = -Math.PI / 2 + t * Math.PI;
    const x = Math.sin(yaw) * radius * Math.cos(elev);
    const y = Math.sin(elev) * radius;
    const z = Math.cos(yaw) * radius * Math.cos(elev);
    cameras.push({
      frame_id: f.id,
      frame_name: f.name,
      index: i,
      yaw_deg: (yaw * 180) / Math.PI,
      elevation_deg: (elev * 180) / Math.PI,
      position: { x, y, z },
      look_at: { x: 0, y: 0.3, z: 0 },
      prior: type,
    });
    f.yaw = (yaw * 180) / Math.PI;
  });
  rebuildPathVisuals();
  if ($('alignPathNote')) {
    $('alignPathNote').textContent = list.length
      ? `${list.length} cameras · ${type} · r=${radius}`
      : 'Drop frames to generate cameras.';
  }
}

function goPath(d) {
  const n = enabledFrames().length;
  if (!n) return;
  pathCursor = (pathCursor + d + n) % n;
  setActiveFromPath();
  refreshAll();
}
function stopPlay() {
  if (playTimer) clearInterval(playTimer);
  playTimer = null;
  if ($('alignPlay')) $('alignPlay').textContent = 'Play path';
}
function togglePlay() {
  if (playTimer) {
    stopPlay();
    return;
  }
  if (!enabledFrames().length) return;
  if ($('alignPlay')) $('alignPlay').textContent = 'Pause';
  playTimer = setInterval(() => goPath(1), 100);
}
$('alignPrev')?.addEventListener('click', () => {
  stopPlay();
  goPath(-1);
});
$('alignNext')?.addEventListener('click', () => {
  stopPlay();
  goPath(1);
});
$('alignPlay')?.addEventListener('click', () => togglePlay());
$('alignScrub')?.addEventListener('input', () => {
  stopPlay();
  pathCursor = Number($('alignScrub').value) || 0;
  setActiveFromPath();
  refreshAll();
});
window.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea, select')) return;
  if (e.key === 'ArrowLeft') {
    e.preventDefault();
    stopPlay();
    goPath(-1);
  }
  if (e.key === 'ArrowRight') {
    e.preventDefault();
    stopPlay();
    goPath(1);
  }
  if (e.key === ' ') {
    e.preventDefault();
    togglePlay();
  }
});

/* ── Export helpers ─────────────────────────────────────── */
function projectPayload() {
  return {
    schema: 'fumoca.alignment.v3',
    created_at: new Date().toISOString(),
    project_name: $('alignProjectName')?.value || '',
    notes: $('alignNotes')?.value || '',
    scale_cm: Number($('alignScale')?.value) || null,
    status: 'path_prior',
    frames: frames.map((f, i) => ({
      id: f.id,
      index: i,
      name: f.name,
      enabled: f.enabled,
      yaw_deg: typeof f.yaw === 'number' ? f.yaw : null,
    })),
    control_points: controlPoints,
    cameras,
    path: {
      type: $('alignPathType')?.value || 'orbit',
      radius: Number($('alignRadius')?.value || 2.5),
      elevation_deg: Number($('alignElev')?.value || 12),
      fov_deg: Number($('alignFov')?.value || 50),
      keyframes: cameras.map((c) => c.frame_id),
    },
    provenance: {
      client: 'fumoca-alignment-studio-v3',
      poses: 'path_prior',
      splat: false,
      viewer: 'threejs_interactive',
    },
  };
}
function downloadBlob(blob, name) {
  const a = document.createElement('a');
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
async function loadJSZip() {
  const { default: JSZip } = await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm');
  return JSZip;
}
async function addEnabledImages(folder) {
  const list = enabledFrames();
  const names = [];
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    const safe = String(i).padStart(4, '0') + '_' + f.name.replace(/[^\w.\-]+/g, '_');
    if (f.file) folder.file(safe, f.file);
    else if (f.blob) folder.file(safe, f.blob);
    names.push(safe);
  }
  return names;
}
function quatLookAt(pos, target) {
  const zx = target.x - pos.x,
    zy = target.y - pos.y,
    zz = target.z - pos.z;
  const len = Math.hypot(zx, zy, zz) || 1;
  const fx = zx / len,
    fy = zy / len,
    fz = zz / len;
  let ux = 0,
    uy = 1,
    uz = 0;
  let rx = uy * fz - uz * fy,
    ry = uz * fx - ux * fz,
    rz = ux * fy - uy * fx;
  const rl = Math.hypot(rx, ry, rz) || 1;
  rx /= rl;
  ry /= rl;
  rz /= rl;
  ux = fy * rz - fz * ry;
  uy = fz * rx - fx * rz;
  uz = fx * ry - fy * rx;
  const m00 = rx,
    m01 = ux,
    m02 = -fx;
  const m10 = ry,
    m11 = uy,
    m12 = -fy;
  const m20 = rz,
    m21 = uz,
    m22 = -fz;
  const tr = m00 + m11 + m22;
  let qw, qx, qy, qz;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    qw = 0.25 * s;
    qx = (m21 - m12) / s;
    qy = (m02 - m20) / s;
    qz = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    qw = (m21 - m12) / s;
    qx = 0.25 * s;
    qy = (m01 + m10) / s;
    qz = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    qw = (m02 - m20) / s;
    qx = (m01 + m10) / s;
    qy = 0.25 * s;
    qz = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    qw = (m10 - m01) / s;
    qx = (m02 + m20) / s;
    qy = (m12 + m21) / s;
    qz = 0.25 * s;
  }
  return [qw, qx, qy, qz];
}
function matrix44(pos, target) {
  const [qw, qx, qy, qz] = quatLookAt(pos, target);
  const xx = qx * qx,
    yy = qy * qy,
    zz = qz * qz;
  const xy = qx * qy,
    xz = qx * qz,
    yz = qy * qz;
  const wx = qw * qx,
    wy = qw * qy,
    wz = qw * qz;
  const r00 = 1 - 2 * (yy + zz),
    r01 = 2 * (xy - wz),
    r02 = 2 * (xz + wy);
  const r10 = 2 * (xy + wz),
    r11 = 1 - 2 * (xx + zz),
    r12 = 2 * (yz - wx);
  const r20 = 2 * (xz - wy),
    r21 = 2 * (yz + wx),
    r22 = 1 - 2 * (xx + yy);
  return [
    [r00, r01, r02, pos.x],
    [r10, r11, r12, pos.y],
    [r20, r21, r22, pos.z],
    [0, 0, 0, 1],
  ];
}

async function runExport(kind) {
  if (!enabledFrames().length) return;
  rebuildPath();
  const JSZip = await loadJSZip();
  const zip = new JSZip();
  if (kind === 'fumoca') {
    zip.file('fumoca-alignment.json', JSON.stringify(projectPayload(), null, 2));
    zip.file('cameras.json', JSON.stringify({ cameras, path: projectPayload().path }, null, 2));
    await addEnabledImages(zip.folder('images'));
    downloadBlob(await zip.generateAsync({ type: 'blob' }), 'fumoca-alignment-package.zip');
  } else if (kind === 'nerf') {
    const names = await addEnabledImages(zip.folder('images'));
    zip.file(
      'transforms.json',
      JSON.stringify(
        {
          camera_model: 'OPENCV',
          fl_x: 1200,
          fl_y: 1200,
          cx: 960,
          cy: 540,
          w: 1920,
          h: 1080,
          frames: cameras.map((cam, i) => ({
            file_path: `images/${names[i]}`,
            transform_matrix: matrix44(cam.position, cam.look_at),
          })),
          fumoca_note: 'Path-prior poses from Alignment Studio v3',
        },
        null,
        2
      )
    );
    downloadBlob(await zip.generateAsync({ type: 'blob' }), 'fumoca-nerfstudio-export.zip');
  } else if (kind === 'colmap') {
    const names = await addEnabledImages(zip.folder('images'));
    let camerasTxt = '# CAMERA_ID MODEL WIDTH HEIGHT PARAMS\n1 PINHOLE 1920 1080 1200 1200 960 540\n';
    let imagesTxt = '# IMAGE_ID QW QX QY QZ TX TY TZ CAMERA_ID NAME\n';
    cameras.forEach((cam, i) => {
      const [qw, qx, qy, qz] = quatLookAt(cam.position, cam.look_at);
      imagesTxt += `${i + 1} ${qw} ${qx} ${qy} ${qz} ${-cam.position.x} ${-cam.position.y} ${-cam.position.z} 1 ${names[i]}\n\n`;
    });
    const sparse = zip.folder('sparse/0');
    sparse.file('cameras.txt', camerasTxt);
    sparse.file('images.txt', imagesTxt);
    sparse.file('points3D.txt', '# Empty path prior\n');
    downloadBlob(await zip.generateAsync({ type: 'blob' }), 'fumoca-colmap-export.zip');
  } else if (kind === 'seq') {
    await addEnabledImages(zip.folder('images'));
    downloadBlob(await zip.generateAsync({ type: 'blob' }), 'fumoca-image-sequence.zip');
  } else if (kind === 'json') {
    downloadBlob(new Blob([JSON.stringify(projectPayload(), null, 2)], { type: 'application/json' }), 'fumoca-cameras.json');
  }
}

$('alignExportZip')?.addEventListener('click', () => runExport('fumoca').catch((e) => alert(e.message)));
$('alignExportZip2')?.addEventListener('click', () => runExport('fumoca').catch((e) => alert(e.message)));
$('alignExportNerf')?.addEventListener('click', () => runExport('nerf').catch((e) => alert(e.message)));
$('alignExportColmap')?.addEventListener('click', () => runExport('colmap').catch((e) => alert(e.message)));
$('alignExportSeq')?.addEventListener('click', () => runExport('seq').catch((e) => alert(e.message)));
$('alignExportJson')?.addEventListener('click', () => runExport('json').catch((e) => alert(e.message)));
$('alignSaveLocal')?.addEventListener('click', () => {
  try {
    localStorage.setItem('fumoca_alignment_v3', JSON.stringify(projectPayload()));
    alert('Draft saved');
  } catch (e) {
    alert(e.message);
  }
});

$('alignRebuildPath')?.addEventListener('click', () => {
  rebuildPath();
  refreshAll();
});
$('alignPathType')?.addEventListener('change', () => {
  rebuildPath();
  refreshAll();
});
$('alignRadius')?.addEventListener('input', () => {
  if ($('alignRadiusOut')) $('alignRadiusOut').textContent = Number($('alignRadius').value).toFixed(1);
});
$('alignElev')?.addEventListener('input', () => {
  if ($('alignElevOut')) $('alignElevOut').textContent = $('alignElev').value;
});
$('alignFov')?.addEventListener('input', () => {
  if ($('alignFovOut')) $('alignFovOut').textContent = $('alignFov').value;
  rebuildPathVisuals();
});

$('alignEnableAll')?.addEventListener('click', () => {
  frames.forEach((f) => (f.enabled = true));
  rebuildPath();
  setActiveFromPath();
  refreshAll();
});
$('alignDisableWeak')?.addEventListener('click', () => {
  const n = Number($('alignNth')?.value || 3);
  frames.forEach((f, i) => {
    f.enabled = i % n === 0;
  });
  pathCursor = 0;
  rebuildPath();
  setActiveFromPath();
  refreshAll();
});
$('alignAddMore')?.addEventListener('click', () => fileInput.click());

function addFiles(fileList) {
  for (const file of Array.from(fileList || [])) {
    if (file.type.startsWith('image/')) {
      frames.push({
        id: `f_${String(frames.length + 1).padStart(4, '0')}`,
        name: file.name,
        url: URL.createObjectURL(file),
        file,
        enabled: true,
        yaw: 0,
        kind: 'image',
      });
    } else if (file.type.startsWith('video/')) {
      videoFile = file;
      const panel = $('alignVideoPanel');
      const v = $('alignVideo');
      if (panel) panel.hidden = false;
      if (v) {
        v.src = URL.createObjectURL(file);
        v.load();
      }
    }
  }
  if (frames.length && activeIndex < 0) {
    activeIndex = 0;
    pathCursor = 0;
  }
  rebuildPath();
  setActiveFromPath();
  refreshAll();
}

async function extractFrames() {
  const v = $('alignVideo');
  if (!v || !videoFile) {
    alert('Load a video first');
    return;
  }
  const n = Math.max(8, Math.min(180, Number($('alignFrameCount')?.value || 48)));
  const btn = $('alignExtract');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '…';
  }
  try {
    await new Promise((resolve, reject) => {
      if (v.readyState >= 1) resolve();
      else {
        v.onloadedmetadata = () => resolve();
        v.onerror = () => reject(new Error('Video failed'));
      }
    });
    const duration = v.duration;
    frames = frames.filter((f) => f.kind !== 'frame');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    for (let i = 0; i < n; i++) {
      v.currentTime = Math.min((i / n) * duration, duration - 0.05);
      await new Promise((r) => {
        const done = () => {
          v.removeEventListener('seeked', done);
          r();
        };
        v.addEventListener('seeked', done);
      });
      canvas.width = v.videoWidth || 640;
      canvas.height = v.videoHeight || 360;
      ctx.drawImage(v, 0, 0);
      const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.9));
      if (!blob) continue;
      frames.push({
        id: `f_${String(frames.length + 1).padStart(4, '0')}`,
        name: `frame_${String(i + 1).padStart(4, '0')}.jpg`,
        url: URL.createObjectURL(blob),
        blob,
        enabled: true,
        yaw: (i / n) * 360,
        kind: 'frame',
      });
    }
    pathCursor = 0;
    activeIndex = frames.length ? 0 : -1;
    rebuildPath();
    setActiveFromPath();
    refreshAll();
  } catch (e) {
    alert(e.message || e);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Extract';
    }
  }
}
$('alignExtract')?.addEventListener('click', () => extractFrames());
$('alignFrameCount')?.addEventListener('input', () => {
  if ($('alignFrameOut')) $('alignFrameOut').textContent = $('alignFrameCount').value;
});

fileInput.addEventListener('change', () => {
  addFiles(fileInput.files);
  fileInput.value = '';
});
['dragenter', 'dragover'].forEach((ev) =>
  drop.addEventListener(ev, (e) => {
    e.preventDefault();
    drop.classList.add('is-drag');
  })
);
['dragleave', 'drop'].forEach((ev) =>
  drop.addEventListener(ev, (e) => {
    e.preventDefault();
    drop.classList.remove('is-drag');
  })
);
drop.addEventListener('drop', (e) => addFiles(e.dataTransfer?.files));
$('alignClear')?.addEventListener('click', () => {
  stopPlay();
  revokeAll();
  frames = [];
  controlPoints = [];
  cameras = [];
  activeIndex = -1;
  pathCursor = 0;
  videoFile = null;
  if ($('alignVideoPanel')) $('alignVideoPanel').hidden = true;
  clearPathVisuals();
  buildProxyCloud();
  refreshAll();
});

rebuildPath();
refreshAll();
}
