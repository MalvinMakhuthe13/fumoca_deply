/**
 * Browser-side math for the pieces competitors already ship
 * and a phone cannot train: view framing, point-vs-splat choice,
 * floater cleanup, washed-colour recovery, two-point upright.
 * No DOM. Safe to unit test.
 */

export function sceneRadius(g) {
  const n = g?.N | 0;
  if (!n) return 1;
  const step = Math.max(1, Math.floor(n / 8000));
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i += step) {
    const x = g.posX[i], y = g.posY[i], z = g.posZ[i];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  if (!Number.isFinite(minX)) return 1;
  return Math.max(0.05, 0.5 * Math.hypot(maxX - minX, maxY - minY, maxZ - minZ));
}

export function sceneCenter(g) {
  const n = g?.N | 0;
  if (!n) return [0, 0, 0];
  const step = Math.max(1, Math.floor(n / 8000));
  let sx = 0, sy = 0, sz = 0, c = 0;
  for (let i = 0; i < n; i += step) {
    sx += g.posX[i]; sy += g.posY[i]; sz += g.posZ[i]; c++;
  }
  return c ? [sx / c, sy / c, sz / c] : [0, 0, 0];
}

/**
 * Trained 3DGS clouds are anisotropic. A COLMAP / 1 cm point dump is not.
 * Only the dump should use the point renderer. Real splats stay on the
 * Gaussian renderer, which is what SuperSplat and Spark actually draw.
 */
export function chooseRenderMode(g) {
  const n = g?.N | 0;
  if (!n || !g.sclX) return 'splats';
  const step = Math.max(1, Math.floor(n / 3000));
  let mean = 0, aniso = 0, c = 0;
  let minS = Infinity, maxS = 0;
  for (let i = 0; i < n; i += step) {
    const a = g.sclX[i] || 0, b = g.sclY?.[i] || 0, c3 = g.sclZ?.[i] || 0;
    const m = (a + b + c3) / 3;
    mean += m;
    aniso += Math.abs(a - m) + Math.abs(b - m) + Math.abs(c3 - m);
    if (m < minS) minS = m;
    if (m > maxS) maxS = m;
    c++;
  }
  mean /= c || 1;
  aniso /= c || 1;
  if (aniso > mean * 0.12) return 'splats';
  if ((maxS - minS) > mean * 0.35) return 'splats';
  return 'points';
}

/** World-space point diameter so a sparse cloud reads as a surface, not dust. */
export function solidPointScale(g) {
  const n = Math.max(g?.N | 0, 1);
  const radius = sceneRadius(g);
  const spacing = (radius * 2) / Math.cbrt(n);
  return Math.max(spacing * 0.85, radius * 0.004, 0.002);
}

/**
 * Drop isolated floaters: points whose nearest neighbour (sampled) is
 * far outside the local spacing, or whose opacity is already gone.
 * Returns a Uint8Array mask, 1 = keep.
 */
export function floaterMask(g, { opacityCut = 0.04, gapFactor = 4.2 } = {}) {
  const n = g?.N | 0;
  const mask = new Uint8Array(n);
  if (!n) return mask;
  const radius = sceneRadius(g);
  const spacing = (radius * 2) / Math.cbrt(n);
  const cut = spacing * gapFactor;
  const cut2 = cut * cut;
  const step = Math.max(1, Math.floor(n / 2500));
  for (let i = 0; i < n; i++) {
    const a = g.opacity ? g.opacity[i] : (g.colA ? g.colA[i] / 255 : 1);
    if (a < opacityCut) { mask[i] = 0; continue; }
    const x = g.posX[i], y = g.posY[i], z = g.posZ[i];
    let near = Infinity;
    for (let j = 0; j < n; j += step) {
      if (j === i) continue;
      const dx = g.posX[j] - x, dy = g.posY[j] - y, dz = g.posZ[j] - z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < near) near = d2;
      if (near < cut2) break;
    }
    mask[i] = near < cut2 ? 1 : 0;
  }
  return mask;
}

/**
 * If a cloud was saved almost grey (the old additive-white wash),
 * push chroma back toward the per-point hue. Colours are 0..1.
 * Returns a new Float32Array, or the same buffer if it was already healthy.
 */
export function recoverWash(colors, { floor = 0.08, gain = 1.65 } = {}) {
  const n = (colors?.length || 0) / 3;
  if (!n) return colors;
  let sat = 0;
  for (let i = 0; i < n; i++) {
    const r = colors[i * 3], g = colors[i * 3 + 1], b = colors[i * 3 + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    sat += max - min;
  }
  sat /= n;
  if (sat > 0.12) return colors;
  const out = new Float32Array(colors.length);
  for (let i = 0; i < n; i++) {
    const r = colors[i * 3], g = colors[i * 3 + 1], b = colors[i * 3 + 2];
    const l = (r + g + b) / 3;
    out[i * 3] = clamp01(l + (r - l) * gain + floor);
    out[i * 3 + 1] = clamp01(l + (g - l) * gain + floor * 0.4);
    out[i * 3 + 2] = clamp01(l + (b - l) * gain);
  }
  return out;
}

/**
 * SuperSplat 3.6 style: two points on a vertical edge (door frame, pillar).
 * Returns a 3x3 rotation that maps (b - a) onto world up (0,1,0).
 * Positions are not mutated.
 */
export function uprightFromEdge(a, b) {
  const vx = b[0] - a[0], vy = b[1] - a[1], vz = b[2] - a[2];
  const len = Math.hypot(vx, vy, vz) || 1;
  const fx = vx / len, fy = vy / len, fz = vz / len;
  // Rodrigues: rotate f onto +Y
  const ux = 0, uy = 1, uz = 0;
  let cx = fy * uz - fz * uy;
  let cy = fz * ux - fx * uz;
  let cz = fx * uy - fy * ux;
  const clen = Math.hypot(cx, cy, cz);
  const dot = Math.max(-1, Math.min(1, fx * ux + fy * uy + fz * uz));
  if (clen < 1e-6) {
    return dot > 0 ? identity() : [[1, 0, 0], [0, -1, 0], [0, 0, -1]];
  }
  cx /= clen; cy /= clen; cz /= clen;
  const ang = Math.acos(dot);
  return rodrigues(cx, cy, cz, ang);
}

export function applyRotation(positions, rot, origin) {
  const out = new Float32Array(positions.length);
  const ox = origin?.[0] || 0, oy = origin?.[1] || 0, oz = origin?.[2] || 0;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i] - ox, y = positions[i + 1] - oy, z = positions[i + 2] - oz;
    out[i] = rot[0][0] * x + rot[0][1] * y + rot[0][2] * z + ox;
    out[i + 1] = rot[1][0] * x + rot[1][1] * y + rot[1][2] * z + oy;
    out[i + 2] = rot[2][0] * x + rot[2][1] * y + rot[2][2] * z + oz;
  }
  return out;
}

/** Camera offsets around a subject. Y is up. Full tumble, not a 180° clamp. */
export function viewPose(name, center, radius) {
  const [cx, cy, cz] = center;
  const r = Math.max(radius, 0.2);
  const d = r * 2.35;
  const table = {
    front: [cx, cy + r * 0.12, cz + d],
    back: [cx, cy + r * 0.12, cz - d],
    left: [cx - d, cy + r * 0.12, cz],
    right: [cx + d, cy + r * 0.12, cz],
    top: [cx, cy + d, cz + r * 0.02],
    under: [cx, cy - d, cz + r * 0.02],
  };
  const pos = table[name] || table.front;
  return { position: pos, target: [cx, cy, cz] };
}

/**
 * Closest point to a ray. Used by measure, upright, and click-to-walk.
 * Returns null when the click misses the subject.
 */
export function pickNearest(g, origin, dir) {
  const n = g?.N | 0;
  if (!n) return null;
  const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const ux = dir[0] / len, uy = dir[1] / len, uz = dir[2] / len;
  const step = n > 80000 ? Math.ceil(n / 80000) : 1;
  let best = -1, bestD = Infinity;
  for (let i = 0; i < n; i += step) {
    const vx = g.posX[i] - origin[0];
    const vy = g.posY[i] - origin[1];
    const vz = g.posZ[i] - origin[2];
    const t = vx * ux + vy * uy + vz * uz;
    if (t < 0) continue;
    const px = origin[0] + ux * t;
    const py = origin[1] + uy * t;
    const pz = origin[2] + uz * t;
    const d = Math.hypot(g.posX[i] - px, g.posY[i] - py, g.posZ[i] - pz);
    if (d < bestD) { bestD = d; best = i; }
  }
  const limit = sceneRadius(g) * 0.12;
  if (best < 0 || bestD > limit) return null;
  return { index: best, x: g.posX[best], y: g.posY[best], z: g.posZ[best], miss: bestD };
}

export function formatDistance(a, b, metersPerUnit) {
  const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  if (metersPerUnit > 0) return { meters: d * metersPerUnit, label: (d * metersPerUnit).toFixed(2) + ' m' };
  return { meters: null, label: d.toFixed(3) + ' scene units' };
}

/** True when a point sits inside keep (0..1) of the scene radius. */
export function insideCrop(x, y, z, center, radius, keep) {
  const dx = x - center[0], dy = y - center[1], dz = z - center[2];
  return Math.hypot(dx, dy, dz) <= radius * keep + 1e-8;
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function identity() { return [[1, 0, 0], [0, 1, 0], [0, 0, 1]]; }
function rodrigues(x, y, z, ang) {
  const c = Math.cos(ang), s = Math.sin(ang), t = 1 - c;
  return [
    [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
    [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
    [t * x * z - s * y, t * y * z + s * x, t * z * z + c],
  ];
}
