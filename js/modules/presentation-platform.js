/**
 * FUMOCA Presentation Platform
 * Platform + splat are one unit. Flip reveals underside logo.
 * Splat sits flat. Orbit/zoom stays connected.
 */
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/controls/OrbitControls.js';
import * as GaussianSplats3D from 'https://cdn.jsdelivr.net/npm/@mkkellogg/gaussian-splats-3d@0.4.7/build/gaussian-splats-3d.module.js';
import { supabase } from '../supabaseClient.js';

const $ = (id) => document.getElementById(id);

const canvasHost = $('canvasHost');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070b);

const camera = new THREE.PerspectiveCamera(50, canvasHost.clientWidth / canvasHost.clientHeight, 0.01, 100);
camera.position.set(0, 0.55, 1.6);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(canvasHost.clientWidth, canvasHost.clientHeight);
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
canvasHost.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 0.25, 0);

// Lights
scene.add(new THREE.AmbientLight(0xffffff, 0.55));
const key = new THREE.DirectionalLight(0xffffff, 1.4);
key.position.set(2.2, 4, 2.5);
key.castShadow = true;
scene.add(key);
const rim = new THREE.PointLight(0xffeeaa, 1.2, 4);
rim.position.set(0, -0.4, 0);
scene.add(rim);
const fill = new THREE.DirectionalLight(0x88ccff, 0.25);
fill.position.set(-2, 1.5, -1);
scene.add(fill);

// Root group — everything transforms together
const rootGroup = new THREE.Group();
scene.add(rootGroup);

const platformGroup = new THREE.Group();
rootGroup.add(platformGroup);

const splatHolder = new THREE.Group();
rootGroup.add(splatHolder);

let platformMesh = null;
let logoTexture = null;
let currentSplatViewer = null;

const state = {
  shape: 'circle',
  width: 0.6,
  height: 0.08,
  edge: 0.02,
  material: 'wood',
  logoSize: 0.4,
  angle: 0,
};

function makeWoodTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 512, 512);
  g.addColorStop(0, '#6B3E26');
  g.addColorStop(0.5, '#8B5A2B');
  g.addColorStop(1, '#5C3317');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 60; i++) {
    ctx.strokeStyle = `rgba(0,0,0,${0.04 + Math.random() * 0.12})`;
    ctx.lineWidth = 0.5 + Math.random() * 2;
    ctx.beginPath();
    ctx.moveTo(0, Math.random() * 512);
    ctx.bezierCurveTo(170, Math.random() * 512, 340, Math.random() * 512, 512, Math.random() * 512);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function makeMaterial(type) {
  switch (type) {
    case 'wood':
      return new THREE.MeshStandardMaterial({ color: 0x8B4513, roughness: 0.65, metalness: 0.05, map: makeWoodTexture() });
    case 'black':
      return new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.35, metalness: 0.15 });
    case 'white':
      return new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.45, metalness: 0.05 });
    case 'metal':
      return new THREE.MeshStandardMaterial({ color: 0xaaaaaa, roughness: 0.18, metalness: 0.85 });
    case 'glass':
      return new THREE.MeshPhysicalMaterial({ color: 0xaeeeff, roughness: 0.05, metalness: 0.1, transmission: 0.85, thickness: 0.4, transparent: true });
    default:
      return new THREE.MeshStandardMaterial({ color: 0x888888 });
  }
}

function rebuildPlatform() {
  if (platformMesh) {
    platformGroup.remove(platformMesh);
    platformMesh.geometry.dispose();
    if (Array.isArray(platformMesh.material)) platformMesh.material.forEach(m => m.dispose());
    else platformMesh.material.dispose();
  }

  const w = state.width;
  const h = state.height;
  const d = state.shape === 'rect' ? w * 0.65 : w;
  const edge = Math.min(state.edge, Math.min(w, h) * 0.4);

  let geo;
  if (state.shape === 'circle') {
    geo = new THREE.CylinderGeometry(w / 2, w / 2, h, 64);
  } else {
    // Approximate rounded box by using BoxGeometry (edge radius visual via bevel if available)
    geo = new THREE.BoxGeometry(w, h, state.shape === 'square' ? w : d);
  }

  const mat = makeMaterial(state.material);

  // Underside: dark + logo + glow
  const undersideMat = new THREE.MeshStandardMaterial({
    color: 0x0a0a0a,
    roughness: 0.4,
    metalness: 0.3,
    map: logoTexture || null,
    emissive: logoTexture ? 0xffee88 : 0x222222,
    emissiveMap: logoTexture || null,
    emissiveIntensity: logoTexture ? 0.9 : 0.15,
  });

  if (state.shape === 'circle') {
    platformMesh = new THREE.Mesh(geo, [mat, mat, undersideMat]);
  } else {
    platformMesh = new THREE.Mesh(geo, [mat, mat, mat, mat, mat, undersideMat]);
  }

  platformMesh.position.y = h / 2;
  platformMesh.castShadow = true;
  platformMesh.receiveShadow = true;
  platformGroup.add(platformMesh);

  if (logoTexture && undersideMat.map) {
    const scale = state.logoSize / w;
    undersideMat.map.repeat.set(scale, scale);
    undersideMat.map.offset.set(0.5 - scale / 2, 0.5 - scale / 2);
    undersideMat.map.needsUpdate = true;
  }

  // Rim light ring under platform
  const ringGeo = new THREE.RingGeometry(w * 0.42, w * 0.48, 64);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffeeaa, transparent: true, opacity: 0.55, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.001;
  platformGroup.add(ring);
}

async function loadSplat(url, name = 'Splat') {
  $('status').textContent = 'Loading splat…';
  $('loadedName').textContent = name;

  while (splatHolder.children.length) {
    const child = splatHolder.children[0];
    splatHolder.remove(child);
    if (child.geometry) child.geometry.dispose();
    if (child.material) child.material.dispose();
  }
  if (currentSplatViewer) {
    try { currentSplatViewer.dispose?.(); } catch (_) {}
    currentSplatViewer = null;
  }

  const lower = (url || '').toLowerCase();
  let formatHint = null;
  if (lower.includes('.splat')) formatHint = 'splat';
  else if (lower.includes('.ply')) formatHint = 'ply';
  else if (lower.includes('.ksplat')) formatHint = 'ksplat';

  const viewer = new GaussianSplats3D.DropInViewer({ selfDrivenMode: false, useBuiltInControls: false });

  try {
    const opts = { showLoadingUI: false, progressiveLoad: true };
    if (formatHint) opts.format = formatHint;
    await viewer.addSplatScene(url, opts);
    currentSplatViewer = viewer;
    splatHolder.add(viewer);
    setTimeout(() => sitFlat(), 250);
    $('status').textContent = 'Drag to orbit · Scroll to zoom · Flip to see logo';
  } catch (err) {
    console.error(err);
    const msg = (err && err.message) ? err.message : String(err);
    if (msg.toLowerCase().includes('format') || msg.toLowerCase().includes('supported')) {
      $('status').textContent = 'Format not supported — use a .splat or Gaussian .ply';
      alert('This file is not a supported Gaussian splat (.splat / .ply / .ksplat).\\nUpload a proper .splat or export one from the editor.');
    } else {
      $('status').textContent = 'Failed to load — check console';
    }
    addPlaceholder();
  }
}

function sitFlat() {
  if (!currentSplatViewer) return;
  currentSplatViewer.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(currentSplatViewer);
  if (box.isEmpty()) {
    currentSplatViewer.position.y = state.height + 0.04;
    return;
  }
  const bottomY = box.min.y;
  const platformTop = state.height;
  currentSplatViewer.position.y += (platformTop - bottomY);
}

function setLogo(file) {
  if (!file) {
    logoTexture = null;
    $('logoPreview').innerHTML = '<span style="font-size:11px;color:var(--dim)">No logo</span>';
    rebuildPlatform();
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      logoTexture = new THREE.Texture(img);
      logoTexture.needsUpdate = true;
      logoTexture.colorSpace = THREE.SRGBColorSpace;
      $('logoPreview').innerHTML = '';
      const preview = document.createElement('img');
      preview.src = e.target.result;
      $('logoPreview').appendChild(preview);
      rebuildPlatform();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// UI
$('loadFileBtn').onclick = () => $('fileInput').click();
$('fileInput').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  await loadSplat(URL.createObjectURL(file), file.name);
};

$('loadFromLibraryBtn').onclick = async () => {
  $('status').textContent = 'Loading your splats…';
  const { data: splats, error } = await supabase.from('splats').select('id, title, splat_url, nif_url, metadata').order('created_at', { ascending: false }).limit(30);
  if (error || !splats?.length) {
    alert(error ? 'Could not load library: ' + error.message : 'No splats found.');
    $('status').textContent = 'Drag to orbit · Scroll to zoom · Flip to see logo';
    return;
  }
  const options = splats.map((s, i) => `${i + 1}. ${s.title || 'Untitled'} (${s.id.slice(0, 8)})`).join('\\n');
  const choice = prompt(`Your splats:\\n\\n${options}\\n\\nEnter the number to load:`);
  const idx = parseInt(choice, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= splats.length) {
    $('status').textContent = 'Drag to orbit · Scroll to zoom · Flip to see logo';
    return;
  }
  const selected = splats[idx];
  const url = selected.splat_url || selected.nif_url || selected.metadata?.splat_url;
  if (!url) { alert('This splat has no file URL.'); return; }
  await loadSplat(url, selected.title || 'Splat');
};

$('uploadLogoBtn').onclick = () => $('logoInput').click();
$('logoInput').onchange = (e) => setLogo(e.target.files[0]);
$('clearLogoBtn').onclick = () => setLogo(null);

document.querySelectorAll('#shapeRow .chip').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('#shapeRow .chip').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.shape = btn.dataset.shape;
    rebuildPlatform();
    sitFlat();
  };
});

document.querySelectorAll('#matRow .mat-swatch').forEach(sw => {
  sw.onclick = () => {
    document.querySelectorAll('#matRow .mat-swatch').forEach(s => s.classList.remove('active'));
    sw.classList.add('active');
    state.material = sw.dataset.mat;
    rebuildPlatform();
  };
});

function bindRange(id, key, scale = 0.001, labelId) {
  const el = $(id);
  el.oninput = () => {
    state[key] = parseFloat(el.value) * scale;
    if (labelId) $(labelId).textContent = el.value;
    rebuildPlatform();
    sitFlat();
  };
}
bindRange('widthRange', 'width', 0.001, 'widthVal');
bindRange('heightRange', 'height', 0.001, 'heightVal');
bindRange('edgeRange', 'edge', 0.001, 'edgeVal');
bindRange('logoSizeRange', 'logoSize', 0.001, 'logoSizeVal');

$('applyBtn').onclick = () => { rebuildPlatform(); sitFlat(); };

$('angleSlider').oninput = (e) => {
  const deg = parseFloat(e.target.value);
  state.angle = deg;
  $('angleLabel').textContent = Math.round(deg) + '°';
  rootGroup.rotation.x = THREE.MathUtils.degToRad(deg);
};

document.querySelectorAll('.view-card').forEach(card => {
  card.onclick = () => {
    document.querySelectorAll('.view-card').forEach(c => c.classList.remove('active'));
    card.classList.add('active');
    const view = card.dataset.view;
    if (view === 'front') rootGroup.rotation.set(0, 0, 0);
    if (view === 'side') rootGroup.rotation.set(0, Math.PI / 2, 0);
    if (view === 'back') rootGroup.rotation.set(0, Math.PI, 0);
    if (view === 'bottom') rootGroup.rotation.set(Math.PI, 0, 0);
    $('angleSlider').value = 0;
    $('angleLabel').textContent = '0°';
  };
});

window.addEventListener('resize', () => {
  camera.aspect = canvasHost.clientWidth / canvasHost.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(canvasHost.clientWidth, canvasHost.clientHeight);
});

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();

rebuildPlatform();

function addPlaceholder() {
  const geo = new THREE.BoxGeometry(0.28, 0.12, 0.28);
  const mat = new THREE.MeshStandardMaterial({ color: 0x444444 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = state.height + 0.06;
  splatHolder.add(mesh);
  $('loadedName').textContent = 'Placeholder — upload a .splat';
}
addPlaceholder();

console.log('[FUMOCA] Presentation Platform ready');
