/**
 * Articulated door from tagged Gaussian region.
 * Builds a textured plane from the region bbox and swings on a hinge.
 * Uses window.THREE + scene/camera when available; falls back to CSS door.
 */
const doors = new Map(); // key -> { mesh, pivot, open }

function getTHREE() {
  return window.THREE || null;
}

function getScene() {
  return (
    window._fumocaScene ||
    window._fumocaRenderer?.scene ||
    window.viewerInstance?.scene ||
    window.FumocaGaussianRenderer?.scene ||
    null
  );
}

function regionBounds(indices, positions) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const i of indices) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  if (!Number.isFinite(minX)) return null;
  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
    size: [maxX - minX, maxY - minY, maxZ - minZ],
  };
}

/**
 * Capture a canvas crop roughly covering the region for door texture (optional).
 */
function grabTexture() {
  const canvas =
    document.querySelector('#stage canvas') ||
    document.querySelector('#viewport canvas') ||
    document.querySelector('canvas');
  return canvas || null;
}

export function ensureHingeDoor(key, region) {
  const THREE = getTHREE();
  const scene = getScene();
  const S = window.S || window._fumocaState;
  if (!THREE || !scene || !S?.positions || !region?.indices?.length) {
    return null;
  }

  if (doors.has(key)) return doors.get(key);

  const b = regionBounds(region.indices, S.positions);
  if (!b) return null;

  // Door dimensions from AABB — use the two larger axes as the panel
  const [sx, sy, sz] = b.size;
  const width = Math.max(sx, sz) || 0.8;
  const height = Math.max(sy, 0.5);

  const geo = new THREE.PlaneGeometry(width, height);
  const canvas = grabTexture();
  let mat;
  if (canvas) {
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace || THREE.sRGBEncoding;
    mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide,
    });
  } else {
    mat = new THREE.MeshBasicMaterial({
      color: 0x2a303c,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
    });
  }

  const mesh = new THREE.Mesh(geo, mat);
  // Pivot group at hinge (left edge of door in local space)
  const pivot = new THREE.Group();
  // Place pivot at left side of bbox (hinge)
  const hingeX = b.min[0];
  pivot.position.set(hingeX, b.center[1], b.center[2]);
  mesh.position.set(width / 2, 0, 0); // offset so left edge is at pivot
  pivot.add(mesh);
  pivot.userData.fumocaDoor = key;
  scene.add(pivot);

  const entry = { mesh, pivot, open: false, width, height, bounds: b };
  doors.set(key, entry);

  // Hide source Gaussians so the plane reads as the door
  for (const i of region.indices) {
    if (S.alive && i < S.alive.length) S.alive[i] = 0;
  }
  S.needsUpdate = true;

  return entry;
}

export function setDoorOpen(key, open, { angle = Math.PI * 0.72 } = {}) {
  const entry = doors.get(key);
  if (!entry) return false;
  entry.open = !!open;
  // Animate via simple lerp on userData target
  entry.pivot.userData.targetRot = open ? -angle : 0;
  if (!entry._animating) {
    entry._animating = true;
    const step = () => {
      const cur = entry.pivot.rotation.y;
      const tgt = entry.pivot.userData.targetRot ?? 0;
      const next = cur + (tgt - cur) * 0.18;
      entry.pivot.rotation.y = next;
      if (Math.abs(tgt - next) > 0.01) {
        requestAnimationFrame(step);
      } else {
        entry.pivot.rotation.y = tgt;
        entry._animating = false;
      }
    };
    requestAnimationFrame(step);
  }
  return true;
}

export function syncDoorsFromState(state = {}) {
  const regions = window._fumocaStateRegions || {};
  for (const key of Object.keys(regions)) {
    if (!key.startsWith('door') && key !== 'boot') continue;
    ensureHingeDoor(key, regions[key]);
    const val = state[key] ?? window.FUMOCA_SceneInteractions?.getInteractionState?.(key);
    setDoorOpen(key, val === 'open');
  }
}

export function disposeDoors() {
  const scene = getScene();
  for (const [, entry] of doors) {
    scene?.remove(entry.pivot);
    entry.mesh.geometry?.dispose?.();
    entry.mesh.material?.dispose?.();
  }
  doors.clear();
}

if (typeof window !== 'undefined') {
  window.FUMOCA_HingeDoor = {
    ensureHingeDoor,
    setDoorOpen,
    syncDoorsFromState,
    disposeDoors,
  };
}
