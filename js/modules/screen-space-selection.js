/**
 * Screen-space visibility filtering for Gaussian point selection.
 * Selects only the nearest projected layer in each small screen cell.
 * Repeated lasso/box selections from different camera angles are additive,
 * allowing users to build a complete object selection without selecting
 * hidden background/support points through the front surface.
 *
 * A splat is an ellipse, not a dot: when `radius(i)` is given, each solid
 * splat covers every cell under its on-screen footprint. Without that, the
 * gaps between front-surface splat centres let the far side of an object
 * (the other side of a car) leak into the selection.
 */
export function selectVisibleScreenPoints({
  count,
  isAlive,
  project,
  contains,
  cellSize = 4,
  depthTolerance = 0.006,
  // Only splats that can actually hide what's behind them decide the front
  // (faint haze / floaters in front of an object must not block selecting it).
  isOccluder = null,
  // Optional on-screen radius in pixels of splat i (its footprint).
  radius = null,
  // Optional viewport size: enables a fast typed-array depth grid.
  width = 0,
  height = 0,
  // Cells a footprint may cover in each direction (keeps huge halos in check).
  maxFootprintCells = 6,
}) {
  const projected = new Array(count);
  const useGrid = width > 0 && height > 0;
  const gw = useGrid ? Math.ceil(width / cellSize) + 1 : 0, gh = useGrid ? Math.ceil(height / cellSize) + 1 : 0;
  const grid = useGrid ? new Float32Array(gw * gh).fill(Infinity) : null;
  const nearest = useGrid ? null : new Map();
  const keyFor = (x, y) => `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)}`;
  const stamp = (cx, cy, depth) => {
    if (useGrid) {
      if (cx < 0 || cy < 0 || cx >= gw || cy >= gh) return;
      const k = cy * gw + cx;
      if (depth < grid[k]) grid[k] = depth;
    } else {
      const key = `${cx},${cy}`, old = nearest.get(key);
      if (old === undefined || depth < old) nearest.set(key, depth);
    }
  };
  const frontAt = (x, y) => {
    const cx = Math.floor(x / cellSize), cy = Math.floor(y / cellSize);
    if (useGrid) {
      if (cx < 0 || cy < 0 || cx >= gw || cy >= gh) return undefined;
      const v = grid[cy * gw + cx];
      return v === Infinity ? undefined : v;
    }
    return nearest.get(`${cx},${cy}`);
  };

  for (let i = 0; i < count; i++) {
    if (!isAlive(i)) continue;
    const p = project(i);
    if (!p || p.visible === false || !Number.isFinite(p.x) ||
        !Number.isFinite(p.y) || !Number.isFinite(p.depth) || p.depth <= 0) continue;
    projected[i] = p;
    if (isOccluder && !isOccluder(i)) continue;
    const cx = Math.floor(p.x / cellSize), cy = Math.floor(p.y / cellSize);
    const rPx = radius ? radius(i, p) : 0;
    const rc = Number.isFinite(rPx) && rPx > 0 ? Math.min(maxFootprintCells, Math.floor(rPx / cellSize)) : 0;
    if (!rc) { stamp(cx, cy, p.depth); continue; }
    const r2 = (rc + 0.5) * (rc + 0.5);
    for (let dy = -rc; dy <= rc; dy++) for (let dx = -rc; dx <= rc; dx++) {
      if (dx * dx + dy * dy <= r2) stamp(cx + dx, cy + dy, p.depth);
    }
  }

  const indices = [];
  for (let i = 0; i < projected.length; i++) {
    const p = projected[i];
    if (!p || !contains(p.x, p.y)) continue;
    const front = frontAt(p.x, p.y);
    if (front === undefined) { indices.push(i); continue; }   // nothing solid in this cell
    const tolerance = Math.max(0.004, Math.abs(front) * depthTolerance);
    if (p.depth <= front + tolerance) indices.push(i);
  }
  return indices;
}

export default { selectVisibleScreenPoints };
