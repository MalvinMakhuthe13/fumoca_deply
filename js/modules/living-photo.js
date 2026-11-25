/**
 * Living photo — one photo → a shallow 3D splat that moves gently, with no
 * AI model and no GPU. Classic image cues only:
 *
 *   subject   frequency-tuned saliency (Achanta 2009) × a soft centre prior,
 *             Otsu threshold, largest regions kept, feathered
 *   depth     scene layout (lower in frame = nearer), focus (sharper = nearer,
 *             strong for portraits with background blur), subject pulled
 *             forward; then edge-aware smoothing (guided filter) so depth
 *             follows the photo's own edges
 *   splat     one Gaussian per pixel, unprojected with a pinhole camera; a
 *             hidden background layer is painted in behind the subject so a
 *             small camera move never reveals a hole
 *
 * Output is a standard 3DGS binary PLY that Studio, Spark and the public
 * viewer already understand. Plain typed arrays: runs in the browser, a
 * worker or Node tests.
 */

export const DEFAULTS = {
  maxSide: 720,          // long side in pixels → ~370k Gaussians at 4:3
  depthRange: 0.55,      // far − near, relative to the near distance
  layout: 0.55,          // weight of "lower = nearer"
  focus: 0.35,           // weight of "sharper = nearer"
  subject: 0.6,          // how far the subject is pulled forward (0..1)
  smooth: 8,             // guided-filter radius (px)
  fillBehind: true,      // paint a background layer behind the subject
};

// ─── small image helpers ──────────────────────────────────────────────────
function boxBlur(src, w, h, r) {
  // separable running-sum box blur; O(N) for any radius
  if (r < 1) return Float32Array.from(src);
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    let acc = 0; const row = y * w;
    for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / (2 * r + 1);
      acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / (2 * r + 1);
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

function normalize01(a) {
  let lo = Infinity, hi = -Infinity;
  for (const v of a) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const s = hi - lo > 1e-9 ? 1 / (hi - lo) : 0;
  for (let i = 0; i < a.length; i++) a[i] = (a[i] - lo) * s;
  return a;
}

/** Guided filter (He et al.): smooths p while keeping edges of guide I. */
export function guidedFilter(I, p, w, h, r, eps = 1e-3) {
  const mI = boxBlur(I, w, h, r), mp = boxBlur(p, w, h, r);
  const Ip = new Float32Array(I.length), II = new Float32Array(I.length);
  for (let i = 0; i < I.length; i++) { Ip[i] = I[i] * p[i]; II[i] = I[i] * I[i]; }
  const mIp = boxBlur(Ip, w, h, r), mII = boxBlur(II, w, h, r);
  const a = new Float32Array(I.length), b = new Float32Array(I.length);
  for (let i = 0; i < I.length; i++) {
    const cov = mIp[i] - mI[i] * mp[i], v = mII[i] - mI[i] * mI[i];
    a[i] = cov / (v + eps); b[i] = mp[i] - a[i] * mI[i];
  }
  const ma = boxBlur(a, w, h, r), mb = boxBlur(b, w, h, r);
  const q = new Float32Array(I.length);
  for (let i = 0; i < I.length; i++) q[i] = ma[i] * I[i] + mb[i];
  return q;
}

function srgbToLab(r, g, b) {
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const R = lin(r), G = lin(g), B = lin(b);
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(X), fy = f(Y), fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function otsu(values, bins = 64) {
  const hist = new Float64Array(bins);
  for (const v of values) hist[Math.min(bins - 1, Math.max(0, Math.floor(v * bins)))]++;
  const total = values.length;
  let sum = 0; for (let i = 0; i < bins; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, thr = 0.5;
  for (let i = 0; i < bins; i++) {
    wB += hist[i]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; thr = (i + 0.5) / bins; }
  }
  return thr;
}

function largestComponents(mask, w, h, keepFraction = 0.25) {
  const label = new Int32Array(w * h).fill(-1);
  const sizes = [];
  const stack = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || label[i] >= 0) continue;
    const id = sizes.length; let n = 0;
    stack.push(i); label[i] = id;
    while (stack.length) {
      const k = stack.pop(); n++;
      const x = k % w, y = (k / w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (mask[j] && label[j] < 0) { label[j] = id; stack.push(j); }
      }
    }
    sizes.push(n);
  }
  if (!sizes.length) return new Uint8Array(w * h);
  const max = Math.max(...sizes);
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) if (label[i] >= 0 && sizes[label[i]] >= max * keepFraction) out[i] = 1;
  return out;
}

/** Resample RGBA to fit maxSide (box-filtered when shrinking). */
export function fitImage(rgba, w, h, maxSide) {
  const s = Math.min(1, maxSide / Math.max(w, h));
  if (s >= 1) return { rgba, w, h };
  const W = Math.max(2, Math.round(w * s)), H = Math.max(2, Math.round(h * s));
  const out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    const y0 = Math.floor(y / s), y1 = Math.min(h, Math.floor((y + 1) / s));
    for (let x = 0; x < W; x++) {
      const x0 = Math.floor(x / s), x1 = Math.min(w, Math.floor((x + 1) / s));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < Math.max(y1, y0 + 1); yy++) for (let xx = x0; xx < Math.max(x1, x0 + 1); xx++) {
        const k = (yy * w + xx) * 4; r += rgba[k]; g += rgba[k + 1]; b += rgba[k + 2]; a += rgba[k + 3]; n++;
      }
      const o = (y * W + x) * 4; out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = a / n;
    }
  }
  return { rgba: out, w: W, h: H };
}

// ─── analysis ─────────────────────────────────────────────────────────────
/**
 * Returns { depth (0 near … 1 far), subject (0..1 soft mask), gray }.
 */
export function analyzePhoto(rgba, w, h, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const N = w * h;
  const gray = new Float32Array(N), L = new Float32Array(N), A = new Float32Array(N), B = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const r = rgba[i * 4] / 255, g = rgba[i * 4 + 1] / 255, b = rgba[i * 4 + 2] / 255;
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    const lab = srgbToLab(r, g, b); L[i] = lab[0]; A[i] = lab[1]; B[i] = lab[2];
  }

  // Saliency: distance of each (slightly blurred) Lab colour from the mean colour.
  const rb = Math.max(1, Math.round(Math.max(w, h) / 200));
  const Lb = boxBlur(L, w, h, rb), Ab = boxBlur(A, w, h, rb), Bb = boxBlur(B, w, h, rb);
  let mL = 0, mA = 0, mB = 0;
  for (let i = 0; i < N; i++) { mL += L[i]; mA += A[i]; mB += B[i]; }
  mL /= N; mA /= N; mB /= N;
  const sal = new Float32Array(N);
  const cx = w / 2, cy = h / 2, sig2 = 2 * (0.35 * Math.max(w, h)) ** 2;
  for (let i = 0; i < N; i++) {
    const x = i % w, y = (i / w) | 0;
    const centre = Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / sig2);
    sal[i] = Math.hypot(Lb[i] - mL, Ab[i] - mA, Bb[i] - mB) * (0.35 + 0.65 * centre);
  }
  normalize01(sal);

  // Focus: local Laplacian energy, smoothed. Sharper → nearer (bokeh portraits).
  const lap = new Float32Array(N);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    lap[i] = Math.abs(4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w]);
  }
  const sharp = normalize01(boxBlur(lap, w, h, Math.max(2, Math.round(Math.max(w, h) / 60))));

  // Subject mask: Otsu on saliency, biggest regions, feathered.
  const thr = Math.max(0.2, otsu(sal));
  const hard = new Uint8Array(N);
  for (let i = 0; i < N; i++) hard[i] = sal[i] > thr ? 1 : 0;
  const kept = largestComponents(hard, w, h, 0.2);
  const keptF = new Float32Array(N);
  let area = 0;
  for (let i = 0; i < N; i++) { keptF[i] = kept[i]; area += kept[i]; }
  // ignore a "subject" that is basically the whole frame or a speck
  const useSubject = area > N * 0.01 && area < N * 0.85;
  let subject = useSubject ? guidedFilter(gray, boxBlur(keptF, w, h, 2), w, h, Math.max(2, o.smooth >> 1), 1e-2) : new Float32Array(N);
  for (let i = 0; i < N; i++) subject[i] = Math.min(1, Math.max(0, subject[i]));

  // Depth: layout + focus, subject pulled forward, edge-aware smoothing.
  const raw = new Float32Array(N);
  const wl = o.layout, wf = o.focus, wsum = Math.max(1e-6, wl + wf);
  for (let i = 0; i < N; i++) {
    const y = ((i / w) | 0) / (h - 1);
    const layoutFar = 1 - y;                         // top of frame = far
    const focusFar = 1 - sharp[i];
    raw[i] = (wl * layoutFar + wf * focusFar) / wsum;
  }
  // subject depth = its own nearest-ish value, then pull forward
  if (useSubject) {
    let sd = 0, sn = 0;
    for (let i = 0; i < N; i++) if (kept[i]) { sd += raw[i]; sn++; }
    const subjDepth = (sd / Math.max(1, sn)) * (1 - o.subject);
    for (let i = 0; i < N; i++) raw[i] = raw[i] * (1 - subject[i]) + subjDepth * subject[i];
  }
  let depth = guidedFilter(gray, raw, w, h, Math.max(1, o.smooth), 2e-3);
  depth = normalize01(depth);
  return { depth, subject, gray, hasSubject: useSubject };
}

/** Paint colours into the masked area from its surroundings (diffusion fill). */
export function inpaint(rgba, w, h, mask, iterations = 0) {
  const N = w * h;
  const r = new Float32Array(N), g = new Float32Array(N), b = new Float32Array(N), known = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    known[i] = mask[i] ? 0 : 1;
    r[i] = rgba[i * 4]; g[i] = rgba[i * 4 + 1]; b[i] = rgba[i * 4 + 2];
  }
  // pyramid-free fill: march inward from the known border, then relax
  const order = [];
  const dist = new Int32Array(N).fill(-1);
  const q = [];
  for (let i = 0; i < N; i++) if (known[i]) { dist[i] = 0; q.push(i); }
  for (let qi = 0; qi < q.length; qi++) {
    const k = q[qi], x = k % w, y = (k / w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (dist[j] < 0) { dist[j] = dist[k] + 1; q.push(j); order.push(j); }
    }
  }
  for (const j of order) {
    const x = j % w, y = (j / w) | 0;
    let sr = 0, sg = 0, sb = 0, n = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const k = ny * w + nx;
      if (dist[k] >= 0 && dist[k] < dist[j]) { sr += r[k]; sg += g[k]; sb += b[k]; n++; }
    }
    if (n) { r[j] = sr / n; g[j] = sg / n; b[j] = sb / n; }
  }
  const its = iterations || 8;
  for (let it = 0; it < its; it++) {
    for (const j of order) {
      const x = j % w, y = (j / w) | 0;
      let sr = 0, sg = 0, sb = 0, n = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const k = ny * w + nx; sr += r[k]; sg += g[k]; sb += b[k]; n++;
      }
      r[j] = sr / n; g[j] = sg / n; b[j] = sb / n;
    }
  }
  const out = new Uint8ClampedArray(rgba.length);
  for (let i = 0; i < N; i++) { out[i * 4] = r[i]; out[i * 4 + 1] = g[i]; out[i * 4 + 2] = b[i]; out[i * 4 + 3] = 255; }
  return out;
}

// ─── splat building ───────────────────────────────────────────────────────
const SH_C0 = 0.28209479177387814;

/**
 * Build Gaussians. Camera at the origin looking down −Z, y up (three.js
 * convention), focal ≈ 1.2 × long side so the result frames like the photo.
 * Returns { count, positions, colors (0..1), scales (linear), opacity, camera }.
 */
export function buildLivingSplat(rgba, w, h, analysis, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const { depth, subject } = analysis;
  const f = 1.2 * Math.max(w, h), cx = (w - 1) / 2, cy = (h - 1) / 2;
  const near = 1, range = o.depthRange;
  const N = w * h;

  // background layer: where the subject is, behind it
  let bgIdx = [];
  let bgRGBA = null, bgDepth = null;
  if (o.fillBehind && analysis.hasSubject) {
    const mask = new Uint8Array(N);
    for (let i = 0; i < N; i++) mask[i] = subject[i] > 0.15 ? 1 : 0;
    // grow the mask a little so edges are covered
    const grown = boxBlur(Float32Array.from(mask), w, h, 3);
    for (let i = 0; i < N; i++) if (grown[i] > 0.01) { mask[i] = 1; bgIdx.push(i); }
    bgRGBA = inpaint(rgba, w, h, mask);
    // background depth: fill depth the same way (treat depth as a grey image)
    const dImg = new Uint8ClampedArray(N * 4);
    for (let i = 0; i < N; i++) { const v = depth[i] * 255; dImg[i * 4] = dImg[i * 4 + 1] = dImg[i * 4 + 2] = v; dImg[i * 4 + 3] = 255; }
    const dFill = inpaint(dImg, w, h, mask);
    bgDepth = new Float32Array(N);
    for (let i = 0; i < N; i++) bgDepth[i] = Math.max(depth[i], dFill[i * 4] / 255);
  }

  const count = N + bgIdx.length;
  const positions = new Float32Array(count * 3), colors = new Float32Array(count * 3);
  const scales = new Float32Array(count * 3), opacity = new Float32Array(count);
  const put = (k, px, py, d, r, g, b, a, thin) => {
    const z = near + d * range;
    positions[k * 3] = ((px - cx) / f) * z;
    positions[k * 3 + 1] = -((py - cy) / f) * z;
    positions[k * 3 + 2] = -z;
    colors[k * 3] = r / 255; colors[k * 3 + 1] = g / 255; colors[k * 3 + 2] = b / 255;
    const s = (z / f) * 0.75;                     // ~1.5σ covers one pixel with overlap
    scales[k * 3] = s; scales[k * 3 + 1] = s; scales[k * 3 + 2] = s * thin;
    opacity[k] = a;
  };
  for (let i = 0; i < N; i++) {
    const x = i % w, y = (i / w) | 0;
    put(i, x, y, depth[i], rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2], 0.97, 0.35);
  }
  bgIdx.forEach((i, n) => {
    const x = i % w, y = (i / w) | 0;
    put(N + n, x, y, bgDepth[i], bgRGBA[i * 4], bgRGBA[i * 4 + 1], bgRGBA[i * 4 + 2], 0.97, 0.35);
  });
  return { count, positions, colors, scales, opacity, camera: { fov: 2 * Math.atan(h / 2 / f) * 180 / Math.PI, aspect: w / h, distance: near } };
}

/** Standard 3DGS binary PLY (x,y,z,n,f_dc,opacity,scale,rot). */
export function toGaussianPly(g) {
  const props = ['x', 'y', 'z', 'nx', 'ny', 'nz', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3'];
  const header = `ply\nformat binary_little_endian 1.0\ncomment FUMOCA living photo\nelement vertex ${g.count}\n` +
    props.map(p => `property float ${p}`).join('\n') + '\nend_header\n';
  const hb = new TextEncoder().encode(header);
  const stride = props.length * 4;
  const out = new Uint8Array(hb.length + g.count * stride);
  out.set(hb);
  const dv = new DataView(out.buffer, hb.length);
  const logit = (p) => Math.log(p / (1 - p));
  for (let i = 0; i < g.count; i++) {
    const o = i * stride;
    const v = [
      g.positions[i * 3], g.positions[i * 3 + 1], g.positions[i * 3 + 2], 0, 0, 1,
      (g.colors[i * 3] - 0.5) / SH_C0, (g.colors[i * 3 + 1] - 0.5) / SH_C0, (g.colors[i * 3 + 2] - 0.5) / SH_C0,
      logit(Math.min(0.999, Math.max(0.001, g.opacity[i]))),
      Math.log(g.scales[i * 3]), Math.log(g.scales[i * 3 + 1]), Math.log(g.scales[i * 3 + 2]),
      1, 0, 0, 0,
    ];
    for (let k = 0; k < v.length; k++) dv.setFloat32(o + k * 4, v[k], true);
  }
  return out;
}

/** Everything in one call. */
export function photoToLivingSplat(rgba, w, h, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const fit = fitImage(rgba, w, h, o.maxSide);
  const analysis = analyzePhoto(fit.rgba, fit.w, fit.h, o);
  const g = buildLivingSplat(fit.rgba, fit.w, fit.h, analysis, o);
  return { ply: toGaussianPly(g), gaussians: g, analysis, width: fit.w, height: fit.h };
}

// ─── motion ───────────────────────────────────────────────────────────────
export const MOTIONS = {
  drift: { label: 'Gentle drift' },
  pushin: { label: 'Slow push-in' },
  sway: { label: 'Side sway' },
  float: { label: 'Floating' },
};

/**
 * Camera offset for time t (seconds). Returns { x, y, z, yaw, pitch } in
 * scene units relative to the rest view; amount 0..1, period in seconds.
 * Smooth, looping, never more than a few degrees — enough to feel depth
 * without revealing the edge of a one-photo scene.
 */
export function motionAt(type, t, { amount = 0.5, period = 8, scale = 1 } = {}) {
  const a = Math.min(1, Math.max(0, amount)) * scale;
  const w = (2 * Math.PI) / Math.max(1, period);
  switch (type) {
    case 'pushin': {
      const p = (1 - Math.cos(w * t)) / 2; // 0 → 1 → 0
      return { x: 0.02 * a * Math.sin(w * t), y: 0.01 * a * Math.sin(w * t * 0.5), z: -0.12 * a * p, yaw: 0, pitch: 0 };
    }
    case 'sway':
      return { x: 0.09 * a * Math.sin(w * t), y: 0, z: 0, yaw: 0, pitch: 0 };
    case 'float':
      return { x: 0.04 * a * Math.sin(w * t), y: 0.03 * a * Math.sin(w * t + 1.7), z: -0.03 * a * (1 - Math.cos(2 * w * t)) / 2, yaw: 0, pitch: 0 };
    case 'drift':
    default:
      return { x: 0.07 * a * Math.sin(w * t), y: 0.035 * a * Math.sin(w * t * 2 + 0.6), z: -0.04 * a * (1 - Math.cos(w * t)) / 2, yaw: 0, pitch: 0 };
  }
}

export function normalizeLivingState(input) {
  if (!input || typeof input !== 'object' || !input.enabled) return null;
  const motion = Object.prototype.hasOwnProperty.call(MOTIONS, input.motion) ? input.motion : 'drift';
  const num = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : d);
  const out = { enabled: true, motion, amount: num(input.amount, 0, 1, 0.5), period: num(input.period, 3, 30, 8), version: 1 };
  const v = input.view;
  if (v && typeof v === 'object') {
    out.view = { near: num(v.near, 0.01, 100, 1), range: num(v.range, 0.01, 10, 0.55), fovY: num(v.fovY, 5, 120, 45), aspect: num(v.aspect, 0.2, 5, 4 / 3) };
  }
  return out;
}

export default { DEFAULTS, analyzePhoto, buildLivingSplat, toGaussianPly, photoToLivingSplat, motionAt, MOTIONS, normalizeLivingState, guidedFilter, inpaint, fitImage };
