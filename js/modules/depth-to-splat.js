/**
 * FUMOCA Photo → 3D: turn one photo + its estimated depth into 3D Gaussians.
 *
 * Pure functions (no DOM), so they run in the browser, in workers and in tests.
 *
 * Depth input is RELATIVE INVERSE depth as produced by Depth Anything V2:
 * larger values are closer to the camera. It is normalised robustly (2nd–98th
 * percentile) and mapped to metric-looking distance with a disparity model,
 *   1/z = 1/far + d · (1/near − 1/far),   d ∈ [0,1] (1 = nearest)
 * so perspective is preserved instead of linearly squashing the scene.
 *
 * Each kept pixel becomes one flat Gaussian facing the camera, sized to its
 * pixel footprint at that depth, so the photo looks exactly right from the
 * original viewpoint and turns into real parallax when you orbit. Pixels on
 * depth discontinuities (the "flying pixel" smear between foreground and
 * background) are dropped.
 */

const SH_C0 = 0.28209479177387814;

/** Robustly normalise depth to [0,1] (1 = near) using percentiles. */
export function normalizeDepth(depth, { low = 0.02, high = 0.98, invert = false } = {}) {
  const n = depth.length;
  if (!n) return new Float32Array(0);
  const sample = [];
  const step = Math.max(1, Math.floor(n / 20000));
  for (let i = 0; i < n; i += step) if (Number.isFinite(depth[i])) sample.push(depth[i]);
  if (!sample.length) throw new Error('Depth map has no finite values');
  sample.sort((a, b) => a - b);
  const lo = sample[Math.floor(low * (sample.length - 1))];
  const hi = sample[Math.ceil(high * (sample.length - 1))];
  const range = hi - lo || 1;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let v = Number.isFinite(depth[i]) ? (depth[i] - lo) / range : 0;
    v = v < 0 ? 0 : v > 1 ? 1 : v;
    out[i] = invert ? 1 - v : v;
  }
  return out;
}

/** Bilinear sample of a w×h float grid at continuous (x,y) in that grid. */
function sampleBilinear(grid, w, h, x, y) {
  const x0 = Math.max(0, Math.min(w - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(h - 1, Math.floor(y)));
  const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
  const fx = Math.min(1, Math.max(0, x - x0)), fy = Math.min(1, Math.max(0, y - y0));
  const a = grid[y0 * w + x0], b = grid[y0 * w + x1], c = grid[y1 * w + x0], d = grid[y1 * w + x1];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

/** Disparity-space mapping from normalised depth (1 = near) to distance. */
export function depthToDistance(d, near, far) {
  const inv = 1 / far + d * (1 / near - 1 / far);
  return 1 / inv;
}

/**
 * Build Gaussians from an RGBA image and a depth map.
 * @param {object} p
 * @param {Uint8ClampedArray|Uint8Array} p.rgba  image pixels (width*height*4)
 * @param {number} p.width @param {number} p.height
 * @param {Float32Array} p.depth  normalised depth, 1 = near (any resolution)
 * @param {number} p.depthWidth @param {number} p.depthHeight
 * @param {object} [opts]
 */
export function depthToGaussians(p, opts = {}) {
  const { rgba, width: W, height: H, depth, depthWidth: DW = W, depthHeight: DH = H } = p;
  if (!rgba || rgba.length < W * H * 4) throw new Error('Image pixels are missing or truncated');
  if (!depth || depth.length < DW * DH) throw new Error('Depth map is missing or truncated');
  const {
    fovDeg = 55,          // horizontal field of view assumed for the photo
    near = 1.0,           // distance of the nearest surface
    far = 3.5,            // distance of the farthest surface (depth range)
    maxSplats = 450000,
    edgeThreshold = 0.06, // relative depth jump that counts as an edge
    removeBackground = 0, // 0..1: drop pixels farther than this fraction (0 = keep all)
    thickness = 0.18,     // Gaussian depth extent relative to its width
    overlap = 0.62,       // Gaussian sigma relative to the pixel footprint
    opacity = 0.97,
  } = opts;
  if (!(far > near && near > 0)) throw new Error('far must be greater than near > 0');

  let stride = 1;
  while (Math.ceil(W / stride) * Math.ceil(H / stride) > maxSplats) stride++;
  const gw = Math.ceil(W / stride), gh = Math.ceil(H / stride);

  // Depth resampled onto the (strided) image grid.
  const dGrid = new Float32Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const px = Math.min(W - 1, gx * stride + (stride - 1) / 2);
      const py = Math.min(H - 1, gy * stride + (stride - 1) / 2);
      dGrid[gy * gw + gx] = sampleBilinear(depth, DW, DH, (px + 0.5) * DW / W - 0.5, (py + 0.5) * DH / H - 0.5);
    }
  }

  const focal = (W / 2) / Math.tan((fovDeg * Math.PI / 180) / 2);
  const cx = W / 2, cy = H / 2;
  const cutoff = removeBackground > 0 ? removeBackground : -1;

  const positions = new Float32Array(gw * gh * 3);
  const colors = new Float32Array(gw * gh * 3);
  const alphas = new Float32Array(gw * gh);
  const scales = new Float32Array(gw * gh * 3);
  let n = 0;
  let edgesDropped = 0, backgroundDropped = 0;
  const zOf = (i) => depthToDistance(dGrid[i], near, far);

  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const i = gy * gw + gx;
      const d = dGrid[i];
      if (cutoff > 0 && d < 1 - cutoff) { backgroundDropped++; continue; }
      const z = zOf(i);
      // Flying-pixel rejection: big relative jump to any 4-neighbour.
      let maxJump = 0;
      if (gx > 0) maxJump = Math.max(maxJump, Math.abs(z - zOf(i - 1)) / z);
      if (gx < gw - 1) maxJump = Math.max(maxJump, Math.abs(z - zOf(i + 1)) / z);
      if (gy > 0) maxJump = Math.max(maxJump, Math.abs(z - zOf(i - gw)) / z);
      if (gy < gh - 1) maxJump = Math.max(maxJump, Math.abs(z - zOf(i + gw)) / z);
      if (maxJump > edgeThreshold) { edgesDropped++; continue; }

      const px = Math.min(W - 1, gx * stride + (stride - 1) / 2);
      const py = Math.min(H - 1, gy * stride + (stride - 1) / 2);
      const o = n * 3;
      positions[o] = ((px + 0.5) - cx) / focal * z;
      positions[o + 1] = -((py + 0.5) - cy) / focal * z;
      positions[o + 2] = -z;
      const footprint = (z / focal) * stride;
      scales[o] = scales[o + 1] = Math.max(1e-6, footprint * overlap);
      scales[o + 2] = Math.max(1e-6, footprint * overlap * thickness);
      // Average colour over the stride block.
      let r = 0, g = 0, b = 0, a = 0, c = 0;
      const x0 = gx * stride, y0 = gy * stride;
      for (let yy = y0; yy < Math.min(H, y0 + stride); yy++) {
        for (let xx = x0; xx < Math.min(W, x0 + stride); xx++) {
          const k = (yy * W + xx) * 4;
          r += rgba[k]; g += rgba[k + 1]; b += rgba[k + 2]; a += rgba[k + 3]; c++;
        }
      }
      colors[o] = r / c / 255; colors[o + 1] = g / c / 255; colors[o + 2] = b / c / 255;
      alphas[n] = opacity * (a / c / 255);
      if (alphas[n] < 0.02) continue; // transparent PNG regions
      n++;
    }
  }

  // Centre the result on its median depth so it orbits around the subject.
  const zs = [];
  for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 5000))) zs.push(positions[i * 3 + 2]);
  zs.sort((a, b) => a - b);
  const zMid = zs.length ? zs[Math.floor(zs.length / 2)] : 0;
  for (let i = 0; i < n; i++) positions[i * 3 + 2] -= zMid;

  return {
    count: n,
    positions: positions.subarray(0, n * 3),
    colors: colors.subarray(0, n * 3),
    opacities: alphas.subarray(0, n),
    scales: scales.subarray(0, n * 3),
    stats: { stride, grid: [gw, gh], edgesDropped, backgroundDropped, focal, centerZ: zMid },
  };
}

/** Standard 3DGS binary PLY (Spark, SuperSplat, FUMOCA Studio all read it). */
export function encodeGaussianPly(g) {
  const props = ['x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity',
    'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3'];
  const header = 'ply\nformat binary_little_endian 1.0\n' +
    'comment FUMOCA photo-to-3D (inferred from a single image)\n' +
    `element vertex ${g.count}\n` + props.map(p => `property float ${p}\n`).join('') + 'end_header\n';
  const head = new TextEncoder().encode(header);
  const rowBytes = props.length * 4;
  const out = new Uint8Array(head.length + g.count * rowBytes);
  out.set(head, 0);
  const view = new DataView(out.buffer, head.length);
  const logit = (a) => { const v = Math.min(0.9999, Math.max(1e-4, a)); return Math.log(v / (1 - v)); };
  for (let i = 0; i < g.count; i++) {
    const o = i * rowBytes, p = i * 3;
    view.setFloat32(o, g.positions[p], true);
    view.setFloat32(o + 4, g.positions[p + 1], true);
    view.setFloat32(o + 8, g.positions[p + 2], true);
    view.setFloat32(o + 12, (g.colors[p] - 0.5) / SH_C0, true);
    view.setFloat32(o + 16, (g.colors[p + 1] - 0.5) / SH_C0, true);
    view.setFloat32(o + 20, (g.colors[p + 2] - 0.5) / SH_C0, true);
    view.setFloat32(o + 24, logit(g.opacities[i]), true);
    view.setFloat32(o + 28, Math.log(g.scales[p]), true);
    view.setFloat32(o + 32, Math.log(g.scales[p + 1]), true);
    view.setFloat32(o + 36, Math.log(g.scales[p + 2]), true);
    view.setFloat32(o + 40, 1, true); // rot_0 = w (identity: discs face the camera)
    view.setFloat32(o + 44, 0, true);
    view.setFloat32(o + 48, 0, true);
    view.setFloat32(o + 52, 0, true);
  }
  return out;
}

/** Convenience: photo pixels + raw model depth → Gaussian PLY bytes. */
export function photoToGaussianPly({ rgba, width, height, rawDepth, depthWidth, depthHeight, invertDepth = false }, opts = {}) {
  const depth = normalizeDepth(rawDepth, { invert: invertDepth });
  const g = depthToGaussians({ rgba, width, height, depth, depthWidth, depthHeight }, opts);
  return { bytes: encodeGaussianPly(g), count: g.count, stats: g.stats };
}

export default { normalizeDepth, depthToDistance, depthToGaussians, encodeGaussianPly, photoToGaussianPly };
