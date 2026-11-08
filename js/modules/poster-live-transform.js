/**
 * FUMOCA live poster transform math.
 * Converts normalized poster composition into a camera-plane world transform.
 * Renderer-agnostic: it never mutates Gaussian data or camera controls.
 */
export function posterMotionSpeed(level) {
  return ({ still: 0, gentle: 0.35, normal: 0.8, dynamic: 1.5 })[String(level || 'still').toLowerCase()] ?? 0;
}

export function advancePosterMotionPhase(phase, speed, deltaSeconds) {
  const current = Number.isFinite(Number(phase)) ? Number(phase) : 0;
  const rate = Math.max(0, Number.isFinite(Number(speed)) ? Number(speed) : 0);
  const delta = Math.min(0.05, Math.max(0, Number.isFinite(Number(deltaSeconds)) ? Number(deltaSeconds) : 0));
  return rate > 0 ? (current + rate * delta) % (Math.PI * 2) : 0;
}

/**
 * Apply the current yaw phase relative to the poster's freshly-applied base
 * orientation. The base transform is reset each render frame, so this must
 * multiply the base quaternion rather than cumulatively rotating the group.
 */
export function applyPosterMotionRotation(THREE, group, phase) {
  if (!THREE?.Vector3 || !THREE?.Quaternion || !group?.quaternion?.multiply) return false;
  const angle = Number.isFinite(Number(phase)) ? Number(phase) : 0;
  const axis = new THREE.Vector3(0, 1, 0).normalize();
  const yaw = new THREE.Quaternion().setFromAxisAngle(axis, angle);
  group.quaternion.multiply(yaw);
  return true;
}

export function computePosterWorldTransform({
  center = { x: 0, y: 0, z: 0 },
  cameraPosition = { x: 0, y: 0, z: 10 },
  cameraRight = { x: 1, y: 0, z: 0 },
  cameraUp = { x: 0, y: 1, z: 0 },
  fov = 50,
  aspect = 1,
  object = { x: 0.5, y: 0.5, scale: 1, rotation: 0 },
  enabled = true,
} = {}) {
  const safe = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const cx = safe(center.x, 0), cy = safe(center.y, 0), cz = safe(center.z, 0);
  if (!enabled) {
    return { position: { x: cx, y: cy, z: cz }, scale: 1, rotation: 0 };
  }
  const dx = safe(cameraPosition.x, 0) - cx;
  const dy = safe(cameraPosition.y, 0) - cy;
  const dz = safe(cameraPosition.z, 0) - cz;
  const distance = Math.max(Math.hypot(dx, dy, dz), 1e-6);
  const safeFov = Math.min(150, Math.max(1, safe(fov, 50)));
  const safeAspect = Math.max(1e-4, safe(aspect, 1));
  const halfHeight = distance * Math.tan((safeFov * Math.PI / 180) / 2);
  const halfWidth = halfHeight * safeAspect;
  const layer = Math.min(99, Math.max(1, safe(object.z, 1)));
  const depthOffset = (layer - 1) * halfHeight * 0.01;
  const x = Math.min(1, Math.max(0, safe(object.x, 0.5)));
  const y = Math.min(1, Math.max(0, safe(object.y, 0.5)));
  const offsetX = (x - 0.5) * 2 * halfWidth;
  const offsetY = (0.5 - y) * 2 * halfHeight;
  const right = cameraRight || { x: 1, y: 0, z: 0 };
  const up = cameraUp || { x: 0, y: 1, z: 0 };
  return {
    position: {
      x: cx + safe(right.x, 1) * offsetX + safe(up.x, 0) * offsetY + dx / distance * depthOffset,
      y: cy + safe(right.y, 0) * offsetX + safe(up.y, 1) * offsetY + dy / distance * depthOffset,
      z: cz + safe(right.z, 0) * offsetX + safe(up.z, 0) * offsetY + dz / distance * depthOffset,
    },
    scale: Math.min(4, Math.max(0.1, safe(object.scale, 1))),
    rotation: Math.min(360, Math.max(-360, safe(object.rotation, 0))) * Math.PI / 180,
  };
}

/**
 * Apply the normalized poster state to a THREE.Group that pivots around the
 * Gaussian subject's original center. Call after controls.update() each frame
 * so poster-space offsets remain aligned with the camera during free orbit.
 */
export function applyPosterLiveTransform({ THREE, group, camera, center, composition, enabled }) {
  if (!THREE?.Vector3 || !group?.position?.set || !camera?.position || !composition) return false;
  camera.updateMatrixWorld?.(true);
  const cameraRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
  const cameraUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).normalize();
  const transform = computePosterWorldTransform({
    center,
    cameraPosition: camera.position,
    cameraRight,
    cameraUp,
    fov: camera.fov,
    // Normalized X/Y are poster coordinates, not full editor-canvas
    // coordinates. Use the fixed artboard ratio while poster mode is active.
    aspect: enabled && Number.isFinite(Number(composition.aspectRatio)) && Number(composition.aspectRatio) > 0
      ? Number(composition.aspectRatio)
      : camera.aspect,
    object: composition.object,
    enabled,
  });
  group.position.set(transform.position.x, transform.position.y, transform.position.z);
  group.scale.setScalar(transform.scale);
  const viewAxis = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
  group.quaternion.setFromAxisAngle(viewAxis, transform.rotation);
  return true;
}
