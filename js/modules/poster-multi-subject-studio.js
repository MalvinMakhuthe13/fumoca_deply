/**
 * FUMOCA Studio multi-subject poster bridge.
 * Loads companion Gaussian PLYs as real Spark meshes in the Studio scene and
 * gives each one an independent poster-space transform.
 */
import { applyPosterLiveTransform } from './poster-live-transform.js';
import { posterMotionSpeed, advancePosterMotionPhase, applyPosterMotionRotation } from './poster-live-transform.js';

const entries = new Map();
let running = false;
let lastTime = 0;

function sceneRef() { return window._fumocaScene || window.scene || null; }
function cameraRef() { return window._fumocaCamera || window.camera || null; }
function signature(subject) {
  return subject?.source?.type + ':' + (subject?.source?.url || subject?.source?.assetId || '');
}
function centerMesh(mesh, THREE) {
  mesh.updateMatrixWorld?.(true);
  const bounds = new THREE.Box3().setFromObject(mesh);
  if (!Number.isFinite(bounds.min.x) || !Number.isFinite(bounds.max.x)) return new THREE.Vector3();
  const center = bounds.getCenter(new THREE.Vector3());
  mesh.position.sub(center);
  return center;
}
async function loadSubject(subject) {
  const id = subject.id;
  if (entries.has(id)) return;
  if (subject.source?.type !== 'ply' && subject.source?.type !== 'url') {
    entries.set(id, { id, signature: signature(subject), unsupported: true });
    window.dispatchEvent(new CustomEvent('fumoca:posterSubjectError', {
      detail: { id, message: 'Studio multi-object loading currently supports Gaussian PLY URLs. Saved NIF asset resolution is the next integration.' },
    }));
    return;
  }
  const url = subject.source.url;
  if (!/^https?:\\/\\//i.test(url || '')) return;
  const entry = { id, signature: signature(subject), loading: true, group: null, mesh: null, center: null, phase: 0 };
  entries.set(id, entry);
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error('PLY download failed (' + response.status + ').');
    const bytes = new Uint8Array(await response.arrayBuffer());
    const { SplatMesh } = await import('@sparkjsdev/spark');
    const mesh = new SplatMesh({ fileBytes: bytes, fileName: url.split('/').pop() || (id + '.ply'), enableLod: false });
    mesh.name = 'fumoca-poster-subject-' + id;
    if (mesh.initialized) await mesh.initialized;
    const scene = sceneRef(), THREE = window.THREE;
    if (!scene || !THREE?.Group || entries.get(id) !== entry) {
      mesh.dispose?.();
      throw new Error('Studio 3D scene is not ready.');
    }
    const group = new THREE.Group();
    group.name = 'fumoca-poster-subject-pivot-' + id;
    scene.add(group);
    const center = centerMesh(mesh, THREE);
    group.add(mesh);
    entry.group = group; entry.mesh = mesh; entry.center = center; entry.loading = false;
    window.dispatchEvent(new CustomEvent('fumoca:posterSubjectReady', { detail: { id } }));
  } catch (error) {
    entries.delete(id);
    window.dispatchEvent(new CustomEvent('fumoca:posterSubjectError', { detail: { id, message: error?.message || 'Could not load companion PLY.' } }));
  }
}
function disposeEntry(id) {
  const entry = entries.get(id);
  if (!entry) return;
  try { entry.group?.parent?.remove(entry.group); entry.mesh?.dispose?.(); } catch (_) {}
  entries.delete(id);
}
function syncSubjects() {
  const state = window.FumocaPoster?.getState?.();
  const subjects = (state?.composition?.subjects || []).filter(item => item.id !== 'subject_main' && item.visible);
  const wanted = new Map(subjects.map(item => [item.id, signature(item)]));
  for (const [id, entry] of entries) if (!wanted.has(id) || wanted.get(id) !== entry.signature) disposeEntry(id);
  for (const subject of subjects) if (!entries.has(subject.id)) loadSubject(subject);
}
function applyFrame(now) {
  requestAnimationFrame(applyFrame);
  const state = window.FumocaPoster?.getState?.();
  const camera = cameraRef(), scene = sceneRef(), THREE = window.THREE;
  if (!state?.enabled || !camera || !scene || !THREE?.Vector3) {
    for (const id of [...entries.keys()]) disposeEntry(id);
    lastTime = now;
    return;
  }
  syncSubjects();
  const delta = lastTime ? Math.min(.05, Math.max(0, (now - lastTime) / 1000)) : 0;
  lastTime = now;
  for (const subject of state.composition?.subjects || []) {
    if (subject.id === 'subject_main' || !subject.visible) continue;
    const entry = entries.get(subject.id);
    if (!entry?.group || entry.loading) continue;
    entry.group.visible = true;
    const composition = { ...state.composition, object: { x: subject.x, y: subject.y, scale: subject.scale, rotation: subject.rotation, z: subject.z } };
    applyPosterLiveTransform({ THREE, group: entry.group, camera, center: entry.center, composition, enabled: true });
    const speed = posterMotionSpeed(subject.motion?.level || 'still');
    entry.phase = advancePosterMotionPhase(entry.phase, speed, delta);
    if (speed) applyPosterMotionRotation(THREE, entry.group, entry.phase);
  }
}
function start() {
  if (running) return;
  running = true;
  window.addEventListener('fumoca:posterChange', syncSubjects);
  requestAnimationFrame(applyFrame);
}
start();
window.FumocaPosterMultiSubjectStudio = Object.freeze({
  refresh: syncSubjects,
  dispose: () => { for (const id of [...entries.keys()]) disposeEntry(id); },
});
