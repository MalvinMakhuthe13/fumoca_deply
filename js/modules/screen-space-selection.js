/**
 * Screen-space visibility filtering for Gaussian point selection.
 * Selects only the nearest projected layer in each small screen cell.
 * Repeated lasso/box selections from different camera angles are additive,
 * allowing users to build a complete object selection without selecting
 * hidden background/support points through the front surface.
 */
export function selectVisibleScreenPoints({
  count,
  isAlive,
  project,
  contains,
  cellSize = 4,
  depthTolerance = 0.006,
}) {
  const nearest = new Map();
  const projected = new Array(count);
  const keyFor = (x, y) => `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)}`;

  for (let i = 0; i < count; i++) {
    if (!isAlive(i)) continue;
    const p = project(i);
    if (!p || p.visible === false || !Number.isFinite(p.x) ||
        !Number.isFinite(p.y) || !Number.isFinite(p.depth) || p.depth <= 0) continue;
    projected[i] = p;
    const key = keyFor(p.x, p.y);
    const old = nearest.get(key);
    if (old === undefined || p.depth < old) nearest.set(key, p.depth);
  }

  const indices = [];
  for (let i = 0; i < projected.length; i++) {
    const p = projected[i];
    if (!p || !contains(p.x, p.y)) continue;
    const front = nearest.get(keyFor(p.x, p.y));
    const tolerance = Math.max(0.004, Math.abs(front) * depthTolerance);
    if (p.depth <= front + tolerance) indices.push(i);
  }
  return indices;
}

export default { selectVisibleScreenPoints };
