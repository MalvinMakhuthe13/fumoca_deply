/**
 * FUMOCA live poster transform math.
 * Converts normalized poster composition into a camera-plane world transform.
 * Renderer-agnostic: it never mutates Gaussian data or camera controls.
 */
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
  const x = Math.min(1, Math.max(0, safe(object.x, 0.5)));
  const y = Math.min(1, Math.max(0, safe(object.y, 0.5)));
  const offsetX = (x - 0.5) * 2 * halfWidth;
  const offsetY = (0.5 - y) * 2 * halfHeight;
  const right = cameraRight || { x: 1, y: 0, z: 0 };
  const up = cameraUp || { x: 0, y: 1, z: 0 };
  return {
    position: {
      x: cx + safe(right.x, 1) * offsetX + safe(up.x, 0) * offsetY,
      y: cy + safe(right.y, 0) * offsetX + safe(up.y, 1) * offsetY,
      z: cz + safe(right.z, 0) * offsetX + safe(up.z, 0) * offsetY,
    },
    scale: Math.min(4, Math.max(0.1, safe(object.scale, 1))),
    rotation: Math.min(360, Math.max(-360, safe(object.rotation, 0))) * Math.PI / 180,
  };
}
