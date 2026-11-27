/**
 * Identify Gaussian rows belonging to one component that lie beneath a support
 * plane. This is a planning function only; callers decide when to apply edits.
 */
export function findGaussianRowsBelowSupportPlane({
  positions, gaussianIds, componentGaussianIds, alive = null,
  scalesXYZ = null, rotationsWXYZ = null, sigmaMultiplier = 2,
  normal, offset, tolerance = 0,
} = {}) {
  if (!positions || positions.length % 3) throw new TypeError('positions must be a flat xyz array');
  const count = positions.length / 3;
  if (!gaussianIds || gaussianIds.length !== count) throw new Error('Gaussian identity count must match positions');
  if (!componentGaussianIds || !componentGaussianIds.length) throw new Error('component has no Gaussian membership');
  if (alive && alive.length !== count) throw new Error('alive mask length must match positions');
  if (scalesXYZ && scalesXYZ.length !== count * 3) throw new Error('Gaussian scale array length must match positions');
  if (rotationsWXYZ && rotationsWXYZ.length !== count * 4) throw new Error('Gaussian rotation array length must match positions');
  const sigma = Number(sigmaMultiplier);
  if (!Number.isFinite(sigma) || sigma < 0) throw new TypeError('sigma multiplier must be a non-negative finite value');
  if (!normal || normal.length !== 3) throw new TypeError('support-plane normal must contain three values');
  const n = Array.from(normal, Number);
  const d = Number(offset), tol = Number(tolerance);
  if (!n.every(Number.isFinite) || !Number.isFinite(d) || !Number.isFinite(tol) || tol < 0) {
    throw new TypeError('support-plane values and non-negative tolerance must be finite');
  }
  const length = Math.hypot(...n);
  if (length < 1e-8) throw new RangeError('support-plane normal is degenerate');
  for (let axis = 0; axis < 3; axis++) n[axis] /= length;
  let normalizedOffset = d / length;
  // "Below" always means the side opposite the object-facing +Y direction.
  if (n[1] < 0) {
    for (let axis = 0; axis < 3; axis++) n[axis] *= -1;
    normalizedOffset *= -1;
  }
  const memberIds = new Set();
  for (const raw of componentGaussianIds) {
    const id = Number(raw);
    if (!Number.isInteger(id) || id < 1 || id > 0xffffffff || memberIds.has(id)) {
      throw new Error('component membership contains an invalid or duplicate Gaussian identity');
    }
    memberIds.add(id);
  }
  const rows = [], signedDistances = [], projectedRadii = [];
  let considered = 0, alreadyDead = 0;
  for (let row = 0; row < count; row++) {
    if (!memberIds.has(gaussianIds[row])) continue;
    if (alive && !alive[row]) { alreadyDead++; continue; }
    considered++;
    const x = Number(positions[row * 3]), y = Number(positions[row * 3 + 1]), z = Number(positions[row * 3 + 2]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    const distance = x * n[0] + y * n[1] + z * n[2] - normalizedOffset;
    let projectedRadius = 0;
    if (scalesXYZ) {
      let localNormal = n;
      if (rotationsWXYZ) {
        let qw = Number(rotationsWXYZ[row * 4]), qx = Number(rotationsWXYZ[row * 4 + 1]);
        let qy = Number(rotationsWXYZ[row * 4 + 2]), qz = Number(rotationsWXYZ[row * 4 + 3]);
        const qLength = Math.hypot(qw, qx, qy, qz);
        if (Number.isFinite(qLength) && qLength > 1e-8) {
          qw /= qLength; qx /= qLength; qy /= qLength; qz /= qLength;
          // Apply inverse quaternion to express the plane normal in the
          // Gaussian's local anisotropic scale frame.
          const tx = -2 * (qy * n[2] - qz * n[1]);
          const ty = -2 * (qz * n[0] - qx * n[2]);
          const tz = -2 * (qx * n[1] - qy * n[0]);
          localNormal = [
            n[0] + qw * tx + (qy * tz - qz * ty),
            n[1] + qw * ty + (qz * tx - qx * tz),
            n[2] + qw * tz + (qx * ty - qy * tx),
          ];
        }
      }
      const sx = Number(scalesXYZ[row * 3]);
      const sy = Number(scalesXYZ[row * 3 + 1]);
      const sz = Number(scalesXYZ[row * 3 + 2]);
      if (![sx, sy, sz].every(value => Number.isFinite(value) && value >= 0)) {
        throw new Error('Gaussian scales must be finite non-negative linear values');
      }
      projectedRadius = sigma * Math.sqrt(
        (localNormal[0] * sx) ** 2 + (localNormal[1] * sy) ** 2 + (localNormal[2] * sz) ** 2,
      );
    }
    if (distance - projectedRadius < -tol) {
      rows.push(row);
      signedDistances.push(distance);
      projectedRadii.push(projectedRadius);
    }
  }
  return {
    rows: Uint32Array.from(rows),
    signedDistances: Float32Array.from(signedDistances),
    projectedRadii: Float32Array.from(projectedRadii),
    sigmaMultiplier: sigma,
    considered,
    alreadyDead,
    retained: considered - rows.length,
    tolerance: tol,
    normal: n,
    offset: normalizedOffset,
  };
}
