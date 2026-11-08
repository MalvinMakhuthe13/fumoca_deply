/**
 * Studio-side live poster transform bridge.
 *
 * The public viewer already transforms a centered THREE.Group per frame.
 * Studio's editor canvas needs the same treatment: the poster composition
 * must transform the actual visible Spark mesh (or legacy Points object),
 * without mutating the editable source positions.
 */
import { applyPosterLiveTransform } from './poster-live-transform.js';
import './spark-gaussian-view.js?v=20261108-postertransform01';

let pivot = null;
let attached = null;
let originalParent = null;
let originalTransform = null;
let subjectCenter = null;
let wasEnabled = false;

function getVisibleSubject() {
  const spark = window.FumocaSparkGaussian;
  if (spark?.isEnabled?.()) {
    const mesh = spark.getMesh?.();
    if (mesh) return mesh;
  }
  return window.S?.points || null;
}

function calculateCenter(state) {
  const positions = state?.positions;
  const alive = state?.alive;
  if (!positions?.length) return null;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  const count = Math.min(alive?.length || Math.floor(positions.length / 3), Math.floor(positions.length / 3));
  const stride = Math.max(1, Math.floor(count / 120000));
  for (let i = 0; i < count; i += stride) {
    if (alive && !alive[i]) continue;
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    if (!Number.isFinite(x + y + z)) continue;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  if (!Number.isFinite(minX + minY + minZ + maxX + maxY + maxZ)) return null;
  return new window.THREE.Vector3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
}

function restoreAttached() {
  if (!attached) return;
  if (attached.parent === pivot) {
    pivot.remove(attached);
    if (originalParent) originalParent.add(attached);
    if (originalTransform) {
      attached.position.copy(originalTransform.position);
      attached.quaternion.copy(originalTransform.quaternion);
      attached.scale.copy(originalTransform.scale);
    }
  }
  attached = null;
  originalParent = null;
  originalTransform = null;
  subjectCenter = null;
}

function attachSubject(subject, state, scene) {
  if (attached === subject && subject.parent === pivot) return true;
  // A Spark sync can replace its mesh while the poster remains enabled. Drop
  // the obsolete object rather than re-inserting a disposed editor mesh.
  if (attached) {
    if (attached.parent === pivot) pivot.remove(attached);
    attached = null;
    originalParent = null;
    originalTransform = null;
    subjectCenter = null;
  }
  const center = calculateCenter(state);
  if (!center) return false;
  if (!pivot) {
    pivot = new window.THREE.Group();
    pivot.name = 'fumoca-studio-poster-subject-pivot';
  }
  if (pivot.parent !== scene) scene.add(pivot);
  originalParent = subject.parent || scene;
  originalTransform = {
    position: subject.position.clone(),
    quaternion: subject.quaternion.clone(),
    scale: subject.scale.clone(),
  };
  subjectCenter = center;
  subject.position.sub(center);
  pivot.add(subject);
  attached = subject;
  return true;
}

function apply() {
  const THREE = window.THREE;
  const state = window.FumocaPoster?.getState?.();
  const enabled = !!state?.enabled;
  const scene = window._fumocaScene || window.scene;
  const camera = window._fumocaCamera || window.camera;
  const editorState = window.S;
  if (!enabled || !scene || !camera || !THREE?.Vector3) {
    if (wasEnabled || attached) {
      restoreAttached();
      if (pivot?.parent) pivot.parent.remove(pivot);
    }
    wasEnabled = false;
    return;
  }
  wasEnabled = true;
  const subject = getVisibleSubject();
  if (!subject || !attachSubject(subject, editorState, scene)) return;
  const main = (state.composition?.subjects || []).find(item => item.id === 'subject_main');
  const composition = {
    ...state.composition,
    object: {
      ...(state.composition.object || {}),
      ...(main || {}),
    },
  };
  applyPosterLiveTransform({
    THREE,
    group: pivot,
    camera,
    center: subjectCenter,
    composition,
    enabled: true,
  });
}

function frame() {
  requestAnimationFrame(frame);
  try { apply(); } catch (error) {
    console.warn('[FUMOCA Poster] Studio subject transform skipped:', error);
  }
}
window.FumocaPosterStudioTransform = Object.freeze({ refresh: apply });
window.addEventListener('fumoca:posterChange', apply);
frame();
