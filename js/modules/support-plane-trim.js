/**
 * Identify Gaussian rows belonging to one component that lie beneath a support
 * plane. This is a planning function only; callers decide when to apply edits.
 */
export function findGaussianRowsBelowSupportPlane({
  positions, gaussianIds, componentGaussianIds, alive = null,
  normal, offset, tolerance = 0,
} = {}) {
  if (!positions || positions.length % 3) throw new TypeError('positions must be a flat xyz array');
  const count = positions.length / 3;
  if (!gaussianIds || gaussianIds.length !== count) throw new Error('Gaussian identity count must match positions');
  if (!componentGaussianIds || !componentGaussianIds.length) throw new Error('component has no Gaussian membership');
  if (alive && alive.length !== count) throw new Error('alive mask length must match positions');
  if (!normal || normal.length !== 3) throw new TypeError('support-plane normal must contain three values');
  const n = Array.from(normal, Number);
  const d = Number(offset), tol = Number(tolerance);
  if (!n.every(Number.isFinite) || !Number.isFinite(d) || !Number.isFinite(tol) || tol < 0) {
    throw new TypeError('support-plane values and non-negative tolerance must be finite');
  }
  const length = Math.hypot(...n);
  if (length < 1e-8) throw new RangeError('support-plane normal is degenerate');
  for (let axis = 0; axis < 3; axis++) n[axis] /= length;
  const normalizedOffset = d / length;
  const memberIds = new Set();
  for (const raw of componentGaussianIds) {
    const id = Number(raw);
    if (!Number.isInteger(id) || id < 1 || id > 0xffffffff || memberIds.has(id)) {
      throw new Error('component membership contains an invalid or duplicate Gaussian identity');
    }
    memberIds.add(id);
  }
  const rows = [], signedDistances = [];
  let considered = 0, alreadyDead = 0;
  for (let row = 0; row < count; row++) {
    if (!memberIds.has(gaussianIds[row])) continue;
    if (alive && !alive[row]) { alreadyDead++; continue; }
    considered++;
    const x = Number(positions[row * 3]), y = Number(positions[row * 3 + 1]), z = Number(positions[row * 3 + 2]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    const distance = x * n[0] + y * n[1] + z * n[2] - normalizedOffset;
    if (distance < -tol) {
      rows.push(row);
      signedDistances.push(distance);
    }
  }
  return {
    rows: Uint32Array.from(rows),
    signedDistances: Float32Array.from(signedDistances),
    considered,
    alreadyDead,
    retained: considered - rows.length,
    tolerance: tol,
    normal: n,
    offset: normalizedOffset,
  };
}
