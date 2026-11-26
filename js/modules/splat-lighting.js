/**
 * Lighting and shadows for Gaussian splats (CPU, no AI).
 *
 * Relight: every splat gets a normal from its flattest axis (the standard
 * trick — trained splats lie flat on surfaces), oriented away from the
 * subject's centre. Colour = base × (ambient + key·max(0, n·L)) × light
 * colour, written into the Spark mesh with setSplat. Base colours are kept,
 * so turning lighting off restores the scan exactly.
 *
 * Shadow: splat centres (posed, if a rig is playing) are projected along the
 * light onto the ground under the subject and splatted into a soft texture
 * on a plane parented to the mesh — so the shadow follows the splats, the
 * platform and the turntable.
 */
import { readRest, refreshRestGeometry } from './splat-rig-driver.js';

export const DEFAULT_LIGHTING = Object.freeze({
  version: 2, enabled: false, preset: 'custom',
  azimuth: 35, elevation: 50,        // key light, degrees; elevation from the ground plane
  intensity: 0.9, ambient: 0.55, color: '#fff4e6',
  ambientColor: '#ffffff',
  // second light: fill, rim or a coloured accent
  light2: false, azimuth2: -150, elevation2: 25, intensity2: 0.6, color2: '#8fb8ff',
  // colour grade
  exposure: 0, contrast: 0, saturation: 0, warmth: 0, tint: 0,
  // atmosphere (background + vignette in Studio and the viewer)
  background: '', vignette: 0,
  shadow: true, shadowOpacity: 0.55, shadowSoftness: 0.5,
  // shadows on the object itself (a brim on the crown, a wall on the floor)
  selfShadow: true, selfShadowStrength: 0.85,
  // lamps: room lights, headlights, a glowing product — switchable from hotspots
  lamps: [],
});

const finite3 = (v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
export function normalizeLamp(l, i = 0) {
  if (!l || !finite3(l.position)) return null;
  return {
    id: String(l.id || 'lamp' + i).replace(/[^\w-]/g, '').slice(0, 32) || 'lamp' + i,
    name: String(l.name || 'Light ' + (i + 1)).slice(0, 40),
    position: l.position.map(Number),
    color: /^#[0-9a-f]{6}$/i.test(l.color || '') ? l.color.toLowerCase() : '#ffd9a0',
    intensity: Math.min(5, Math.max(0, Number.isFinite(+l.intensity) ? +l.intensity : 1.2)),
    radius: Math.min(1e4, Math.max(1e-4, Number.isFinite(+l.radius) ? +l.radius : 1)),
    on: l.on !== false,
    ...(Number.isFinite(l.fade) ? { fade: Math.min(1, Math.max(0, l.fade)) } : {}),
  };
}

const num = (v, lo, hi, d) => (Number.isFinite(+v) && v !== '' && v !== null ? Math.min(hi, Math.max(lo, +v)) : d);
const hex = (v, d) => (/^#[0-9a-f]{6}$/i.test(v || '') ? v.toLowerCase() : d);

export function normalizeLighting(input) {
  if (!input || typeof input !== 'object') return null;
  const D = DEFAULT_LIGHTING;
  return {
    version: 2, enabled: !!input.enabled, preset: String(input.preset || 'custom').slice(0, 24),
    azimuth: num(input.azimuth, -360, 360, D.azimuth), elevation: num(input.elevation, 2, 90, D.elevation),
    intensity: num(input.intensity, 0, 3, D.intensity), ambient: num(input.ambient, 0, 2, D.ambient),
    color: hex(input.color, D.color), ambientColor: hex(input.ambientColor, D.ambientColor),
    light2: !!input.light2, azimuth2: num(input.azimuth2, -360, 360, D.azimuth2), elevation2: num(input.elevation2, -30, 90, D.elevation2),
    intensity2: num(input.intensity2, 0, 3, D.intensity2), color2: hex(input.color2, D.color2),
    exposure: num(input.exposure, -2, 2, 0), contrast: num(input.contrast, -1, 1, 0), saturation: num(input.saturation, -1, 1, 0),
    warmth: num(input.warmth, -1, 1, 0), tint: num(input.tint, -1, 1, 0),
    background: input.background ? hex(input.background, '') : '', vignette: num(input.vignette, 0, 1, 0),
    shadow: input.shadow !== false, shadowOpacity: num(input.shadowOpacity, 0, 1, D.shadowOpacity),
    shadowSoftness: num(input.shadowSoftness, 0, 1, D.shadowSoftness),
    selfShadow: input.selfShadow !== false,
    selfShadowStrength: num(input.selfShadowStrength, 0, 1, D.selfShadowStrength),
    lamps: (Array.isArray(input.lamps) ? input.lamps : []).slice(0, 12).map(normalizeLamp).filter(Boolean),
    ...(input.motion && typeof input.motion === 'object' ? { motion: input.motion } : {}),
  };
}

/**
 * Mood presets — one click to set the scene, then tweak anything.
 * Values are only the ones each mood changes; the rest come from defaults.
 */
export const MOODS = {
  natural:  { label: 'Natural', enabled: false },
  golden:   { label: 'Golden hour', azimuth: 70, elevation: 14, intensity: 1.15, color: '#ffb35c', ambient: 0.42, ambientColor: '#8aa4d6',
              light2: true, azimuth2: -120, elevation2: 30, intensity2: 0.25, color2: '#7fa2ff', warmth: 0.35, contrast: 0.15, saturation: 0.15,
              background: '#2a1a12', vignette: 0.35, shadowOpacity: 0.6, shadowSoftness: 0.35 },
  studio:   { label: 'Studio softbox', azimuth: 35, elevation: 45, intensity: 0.8, color: '#ffffff', ambient: 0.7, ambientColor: '#ffffff',
              light2: true, azimuth2: -140, elevation2: 35, intensity2: 0.45, color2: '#ffffff', contrast: 0.05,
              background: '#e9eaec', vignette: 0.1, shadowOpacity: 0.35, shadowSoftness: 0.85 },
  overcast: { label: 'Overcast', azimuth: 0, elevation: 80, intensity: 0.35, color: '#e9eef5', ambient: 0.85, ambientColor: '#dfe6ee',
              warmth: -0.1, saturation: -0.15, contrast: -0.1, background: '#9aa3ad', vignette: 0.15, shadowOpacity: 0.25, shadowSoftness: 1 },
  night:    { label: 'Moonlit night', azimuth: -60, elevation: 35, intensity: 0.7, color: '#9db8ff', ambient: 0.22, ambientColor: '#2b3a66',
              exposure: -0.5, warmth: -0.45, saturation: -0.25, contrast: 0.2, background: '#05070d', vignette: 0.6, shadowOpacity: 0.7, shadowSoftness: 0.5 },
  neon:     { label: 'Neon', azimuth: 60, elevation: 25, intensity: 1.1, color: '#ff3fb4', ambient: 0.2, ambientColor: '#2a1440',
              light2: true, azimuth2: -110, elevation2: 20, intensity2: 1.0, color2: '#25e2ff', saturation: 0.35, contrast: 0.25,
              background: '#0b0614', vignette: 0.5, shadowOpacity: 0.5, shadowSoftness: 0.4 },
  noir:     { label: 'Noir', azimuth: 50, elevation: 30, intensity: 1.3, color: '#ffffff', ambient: 0.18, ambientColor: '#ffffff',
              saturation: -1, contrast: 0.45, exposure: -0.1, background: '#050505', vignette: 0.7, shadowOpacity: 0.85, shadowSoftness: 0.2 },
  sunsetRim:{ label: 'Sunset rim', azimuth: 170, elevation: 12, intensity: 1.4, color: '#ff8a3d', ambient: 0.35, ambientColor: '#5a6fa8',
              light2: true, azimuth2: 20, elevation2: 30, intensity2: 0.35, color2: '#9fb5ff', warmth: 0.2, contrast: 0.2,
              background: '#1a0f14', vignette: 0.45, shadowOpacity: 0.55, shadowSoftness: 0.4 },
  product:  { label: 'Clean product', azimuth: 25, elevation: 55, intensity: 0.6, color: '#ffffff', ambient: 0.9, ambientColor: '#ffffff',
              light2: true, azimuth2: 180, elevation2: 40, intensity2: 0.4, color2: '#ffffff', exposure: 0.15, saturation: 0.05,
              background: '#ffffff', vignette: 0, shadowOpacity: 0.3, shadowSoftness: 0.9 },
};

export function moodSettings(name, base = {}) {
  const m = MOODS[name];
  if (!m) return normalizeLighting(base);
  const { label, ...values } = m;
  return normalizeLighting({ ...DEFAULT_LIGHTING, shadow: base.shadow ?? true, enabled: true, ...values, preset: name });
}

/** Direction *towards* the light (y up). */
export function lightDirection(azimuthDeg, elevationDeg) {
  const az = azimuthDeg * Math.PI / 180, el = elevationDeg * Math.PI / 180;
  return [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
}

const hexRgb = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);

/** Per-splat normals from the flattest axis, pointing away from the centre. */
export function splatNormals(rest) {
  const n = rest.count, N = new Float32Array(n * 3);
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < n; i++) { cx += rest.positions[i * 3]; cy += rest.positions[i * 3 + 1]; cz += rest.positions[i * 3 + 2]; }
  cx /= n || 1; cy /= n || 1; cz /= n || 1;
  for (let i = 0; i < n; i++) {
    const w = rest.rotations[i * 4], x = rest.rotations[i * 4 + 1], y = rest.rotations[i * 4 + 2], z = rest.rotations[i * 4 + 3];
    const sx = rest.scales[i * 3], sy = rest.scales[i * 3 + 1], sz = rest.scales[i * 3 + 2];
    // column k of the rotation matrix is the splat's k-th axis
    let nx, ny, nz;
    if (sx <= sy && sx <= sz) { nx = 1 - 2 * (y * y + z * z); ny = 2 * (x * y + z * w); nz = 2 * (x * z - y * w); }
    else if (sy <= sz) { nx = 2 * (x * y - z * w); ny = 1 - 2 * (x * x + z * z); nz = 2 * (y * z + x * w); }
    else { nx = 2 * (x * z + y * w); ny = 2 * (y * z - x * w); nz = 1 - 2 * (x * x + y * y); }
    const px = rest.positions[i * 3] - cx, py = rest.positions[i * 3 + 1] - cy, pz = rest.positions[i * 3 + 2] - cz;
    const l = Math.hypot(nx, ny, nz) || 1;
    // Mostly-horizontal surfaces (floors, table tops, the top of a cap) face up;
    // everything else faces away from the subject's centre.
    if (Math.abs(ny) / l > 0.8) { if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; } }
    else if (nx * px + ny * py + nz * pz < 0) { nx = -nx; ny = -ny; nz = -nz; }
    N[i * 3] = nx / l; N[i * 3 + 1] = ny / l; N[i * 3 + 2] = nz / l;
  }
  return N;
}

/** Colour grade one linear-ish RGB triple in place (exposure, white balance, contrast, saturation). */
function grade(rgb, g) {
  let [r, gg, b] = rgb;
  const e = Math.pow(2, g.exposure);
  r *= e; gg *= e; b *= e;
  r *= 1 + 0.18 * g.warmth; b *= 1 - 0.18 * g.warmth;            // warm ↔ cool
  gg *= 1 - 0.12 * g.tint; r *= 1 + 0.06 * g.tint; b *= 1 + 0.06 * g.tint;   // green ↔ magenta
  const c = 1 + g.contrast;
  r = (r - 0.5) * c + 0.5; gg = (gg - 0.5) * c + 0.5; b = (b - 0.5) * c + 0.5;
  const l = 0.2126 * r + 0.7152 * gg + 0.0722 * b, sat = 1 + g.saturation;
  r = l + (r - l) * sat; gg = l + (gg - l) * sat; b = l + (b - l) * sat;
  rgb[0] = Math.min(1, Math.max(0, r)); rgb[1] = Math.min(1, Math.max(0, gg)); rgb[2] = Math.min(1, Math.max(0, b));
}

/** Lit + graded colours (0..1) for every splat. */
/**
 * Which splats the light reaches: a shadow map seen from the light, built from
 * the splats themselves. Each splat looks up the nearest surface towards the
 * light; if something solid is in front, it is in shadow (soft, PCF).
 * Returns visibility 0 (in shadow) … 1 (lit) per splat.
 */
export function selfShadow(positions, count, opacity, L, { softness = 0.5, out = null } = {}) {
  const vis = out && out.length >= count ? out : new Float32Array(count);
  const l = Math.hypot(L[0], L[1], L[2]) || 1, Lx = L[0] / l, Ly = L[1] / l, Lz = L[2] / l;
  // a basis across the light's view
  let ux = Ly * 0 - Lz * 1, uy = Lz * 0 - Lx * 0, uz = Lx * 1 - Ly * 0;          // L × up
  if (Math.hypot(ux, uy, uz) < 1e-6) { ux = 1; uy = 0; uz = 0; }
  const ul = Math.hypot(ux, uy, uz); ux /= ul; uy /= ul; uz /= ul;
  const vx = Ly * uz - Lz * uy, vy = Lz * ux - Lx * uz, vz = Lx * uy - Ly * ux;
  const solid = (i) => !opacity || opacity[i] >= 0.25;
  // robust bounds of the solid splats across the light
  const stride = Math.max(1, Math.floor(count / 40000)), us = [], vs = [];
  let nSolid = 0;
  for (let i = 0; i < count; i++) if (solid(i)) nSolid++;
  for (let i = 0; i < count; i += stride) if (solid(i)) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    us.push(x * ux + y * uy + z * uz); vs.push(x * vx + y * vy + z * vz);
  }
  if (us.length < 16) { vis.fill(1, 0, count); return vis; }
  us.sort((a, b) => a - b); vs.sort((a, b) => a - b);
  const q = (a, p) => a[Math.floor(p * (a.length - 1))];
  const u0 = q(us, 0.002), u1 = q(us, 0.998), v0 = q(vs, 0.002), v1 = q(vs, 0.998);
  const G = Math.max(64, Math.min(512, Math.round(Math.sqrt(nSolid) / 1.6)));
  const span = Math.max(u1 - u0, v1 - v0, 1e-6) * 1.04, cu0 = (u0 + u1) / 2 - span / 2, cv0 = (v0 + v1) / 2 - span / 2;
  const cell = span / G;
  // nearest-to-light depth per cell
  const grid = new Float32Array(G * G).fill(-Infinity);
  const cellOf = new Int32Array(count), depth = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    const cu = Math.floor(((x * ux + y * uy + z * uz) - cu0) / cell), cv = Math.floor(((x * vx + y * vy + z * vz) - cv0) / cell);
    const d = x * Lx + y * Ly + z * Lz;
    depth[i] = d;
    if (cu < 0 || cv < 0 || cu >= G || cv >= G) { cellOf[i] = -1; continue; }
    const c = cv * G + cu; cellOf[i] = c;
    if (solid(i) && d > grid[c]) grid[c] = d;
  }
  // close pin-holes between splats (one-cell max filter)
  const closed = new Float32Array(G * G);
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
    let m = grid[y * G + x];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < G && yy < G) { const g = grid[yy * G + xx]; if (g > m && (dx === 0 || dy === 0)) m = g; }
    }
    closed[y * G + x] = m;
  }
  // soft lookup: a (2r+1)² neighbourhood, surface thickness as bias
  const r = count > 800000 ? 1 : Math.max(1, Math.round(1 + softness * 2));
  // bias grows with the tap's distance, so sloped surfaces (a floor under a
  // low sun) don't shadow themselves ("shadow acne")
  const bias0 = cell * 2.2, slope = cell * 1.6, taps = (2 * r + 1) * (2 * r + 1);
  const tapBias = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) tapBias.push(bias0 + slope * Math.hypot(dx, dy));
  for (let i = 0; i < count; i++) {
    const c = cellOf[i];
    if (c < 0) { vis[i] = 1; continue; }
    const cx = c % G, cy = (c - cx) / G, d = depth[i];
    let hit = 0, t = 0;
    for (let dy = -r; dy <= r; dy++) {
      const yy = cy + dy;
      for (let dx = -r; dx <= r; dx++, t++) {
        const xx = cx + dx; if (yy < 0 || yy >= G || xx < 0 || xx >= G) continue;
        if (closed[yy * G + xx] > d + tapBias[t]) hit++;
      }
    }
    vis[i] = 1 - hit / taps;
  }
  return vis;
}

export function relightColors(baseColors, normals, settings, out = null, positions = null, extra = {}) {
  const s = normalizeLighting(settings) || normalizeLighting(DEFAULT_LIGHTING);
  const n = baseColors.length / 3;
  out = out || new Float32Array(baseColors.length);
  if (!s.enabled) { out.set(baseColors); return out; }
  const L1 = lightDirection(s.azimuth, s.elevation), c1 = hexRgb(s.color);
  const L2 = lightDirection(s.azimuth2, Math.max(-89, s.elevation2)), c2 = hexRgb(s.color2), on2 = s.light2 ? s.intensity2 : 0;
  const ca = hexRgb(s.ambientColor);
  const graded = s.exposure || s.contrast || s.saturation || s.warmth || s.tint;
  const lamps = positions ? s.lamps.filter(l => l.on && l.intensity > 0).map(l => ({ ...l, c: hexRgb(l.color), fade: l.fade ?? 1 })) : [];
  const rgb = [0, 0, 0];
  const vis1 = extra.vis1 || null, vis2 = extra.vis2 || null, ss = s.selfShadowStrength ?? 0.85, op = extra.opacity || null;
  for (let i = 0; i < n; i++) {
    const nx = normals[i * 3], ny = normals[i * 3 + 1], nz = normals[i * 3 + 2];
    const v1 = vis1 ? 1 - ss * (1 - vis1[i]) : 1, v2 = vis2 ? 1 - ss * (1 - vis2[i]) : 1;
    const d1 = Math.max(0, nx * L1[0] + ny * L1[1] + nz * L1[2]) * s.intensity * v1;
    const d2 = on2 ? Math.max(0, nx * L2[0] + ny * L2[1] + nz * L2[2]) * on2 * v2 : 0;
    let lr = 0, lg = 0, lb = 0;
    for (const l of lamps) {
      const dx = l.position[0] - positions[i * 3], dy = l.position[1] - positions[i * 3 + 1], dz = l.position[2] - positions[i * 3 + 2];
      const d = Math.hypot(dx, dy, dz) || 1e-6, x = d / l.radius;
      if (x > 3) continue;                                     // out of reach
      const facing = 0.35 + 0.65 * Math.max(0, (nx * dx + ny * dy + nz * dz) / d);
      const k = l.intensity * l.fade * facing / (1 + 4 * x * x) * (x > 2 ? (3 - x) : 1);
      lr += k * l.c[0]; lg += k * l.c[1]; lb += k * l.c[2];
    }
    const add = [lr, lg, lb];
    for (let k = 0; k < 3; k++) {
      const light = s.ambient * ca[k] + d1 * c1[k] + d2 * c2[k] + add[k];
      rgb[k] = baseColors[i * 3 + k] * light;
    }
    if (graded) grade(rgb, s);
    // faint haze / floaters keep their own colour: lighting them up makes a scan look smoky
    if (op && op[i] < 0.45) {
      const k = Math.max(0, (op[i] - 0.08) / 0.37);
      for (let c = 0; c < 3; c++) rgb[c] = baseColors[i * 3 + c] * (1 - k) + rgb[c] * k;
    }
    out[i * 3] = Math.min(1, rgb[0]); out[i * 3 + 1] = Math.min(1, rgb[1]); out[i * 3 + 2] = Math.min(1, rgb[2]);
  }
  return out;
}

/**
 * Shadow density map: project points along −L onto the plane y = groundY.
 * Returns { size, data (Float32 0..1), bounds:{x0,z0,x1,z1} }.
 */
export function shadowMap(positions, count, opacity, settings, { size = 256, groundY = null, stride = 1 } = {}) {
  const s = normalizeLighting(settings) || { ...DEFAULT_LIGHTING };
  const L = lightDirection(s.azimuth, s.elevation);
  // Only splats that are really there cast a shadow: faint haze / floaters
  // would set the ground too low and smear the shadow into a dark rectangle.
  const solid = (i) => !opacity || opacity[i] >= 0.2;
  // percentiles from a sample (sorting millions of splats took seconds)
  const sampleStep = Math.max(stride, Math.floor(count / 60000));
  let ys = [];
  for (let i = 0; i < count; i += sampleStep) if (solid(i)) ys.push(positions[i * 3 + 1]);
  if (!ys.length) for (let i = 0; i < count; i += sampleStep) ys.push(positions[i * 3 + 1]);
  ys = Float32Array.from(ys).sort();
  const gy = groundY ?? ys[Math.floor(ys.length * 0.005)];
  const height = Math.max(1e-4, ys[Math.floor((ys.length - 1) * 0.98)] - gy);
  // a very low sun is capped (~12°) so shadows stay long but readable
  const ly = Math.max(0.21, L[1]), hl = Math.hypot(L[0], L[2]) || 1, sx = (L[0] / hl) * Math.sqrt(Math.max(0, 1 - ly * ly)), sz = (L[2] / hl) * Math.sqrt(Math.max(0, 1 - ly * ly));
  const n = Math.ceil(count / stride), px = new Float32Array(n * 2), w = new Float32Array(n);
  let k = 0;
  for (let i = 0; i < count; i += stride, k++) {
    if (!solid(i)) { w[k] = 0; continue; }
    const h = Math.max(0, positions[i * 3 + 1] - gy);
    const t = h / ly;
    px[k * 2] = positions[i * 3] - sx * t; px[k * 2 + 1] = positions[i * 3 + 2] - sz * t;
    // contact is darkest; far up the object the shadow fades out
    w[k] = (opacity ? opacity[i] : 1) * (0.35 + 0.65 * Math.exp(-2.2 * h / height));
  }
  // bounds from the bulk of the shadow, not its stragglers
  let xs = [], zs = [];
  const bstep = Math.max(1, Math.floor(k / 60000));
  for (let j = 0; j < k; j += bstep) if (w[j] > 0) { xs.push(px[j * 2]); zs.push(px[j * 2 + 1]); }
  if (!xs.length) return { size, data: new Float32Array(size * size), bounds: { x0: -1, z0: -1, x1: 1, z1: 1 }, groundY: gy };
  xs = Float32Array.from(xs).sort(); zs = Float32Array.from(zs).sort();
  const pct = (a, p) => a[Math.min(a.length - 1, Math.max(0, Math.floor(p * (a.length - 1))))];
  const x0 = pct(xs, 0.01), x1 = pct(xs, 0.99), z0 = pct(zs, 0.01), z1 = pct(zs, 0.99);
  const span = Math.max(x1 - x0, z1 - z0, 1e-6) * 1.5;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const b = { x0: cx - span / 2, z0: cz - span / 2, x1: cx + span / 2, z1: cz + span / 2 };
  const data = new Float32Array(size * size);
  for (let j = 0; j < k; j++) {
    if (!w[j]) continue;
    const u = Math.floor((px[j * 2] - b.x0) / span * size), v = Math.floor((px[j * 2 + 1] - b.z0) / span * size);
    if (u >= 0 && v >= 0 && u < size && v < size) data[v * size + u] += w[j];
  }
  // soften: box blur (radius from softness), then normalise to a robust max
  const r = Math.max(1, Math.round(1 + s.shadowSoftness * size / 40));
  const blur = (src) => {
    const tmp = new Float32Array(size * size), dst = new Float32Array(size * size);
    for (let y = 0; y < size; y++) { let a = 0; for (let x = -r; x <= r; x++) a += src[y * size + Math.min(size - 1, Math.max(0, x))];
      for (let x = 0; x < size; x++) { tmp[y * size + x] = a; a += src[y * size + Math.min(size - 1, x + r + 1)] - src[y * size + Math.max(0, x - r)]; } }
    for (let x = 0; x < size; x++) { let a = 0; for (let y = -r; y <= r; y++) a += tmp[Math.min(size - 1, Math.max(0, y)) * size + x];
      for (let y = 0; y < size; y++) { dst[y * size + x] = a; a += tmp[Math.min(size - 1, y + r + 1) * size + x] - tmp[Math.max(0, y - r) * size + x]; } }
    return dst;
  };
  const d = blur(blur(data));
  const sorted = d.filter(v => v > 0).sort();
  const ref = sorted.length ? sorted[Math.floor(sorted.length * 0.85)] : 1;
  // fade to nothing at the edges, so the shadow never shows a square border
  const edge = Math.max(2, Math.round(size * 0.12));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const e = Math.min(x, y, size - 1 - x, size - 1 - y) / edge, f = e >= 1 ? 1 : e * e * (3 - 2 * e);
    const i = y * size + x;
    d[i] = Math.min(1, d[i] / (ref || 1)) * s.shadowOpacity * f;
  }
  return { size, data: d, bounds: b, groundY: gy };
}

/**
 * Drives lighting + shadow on one Spark SplatMesh (Studio and viewer).
 */
/**
 * Mood atmosphere: background colour and a soft vignette over the view.
 * Remembers what was there so turning it off restores it.
 */
export class Atmosphere {
  constructor(THREE, scene, host) { this.THREE = THREE; this.scene = scene; this.host = host; this.saved = undefined; this.el = null; }
  apply(settings) {
    const s = normalizeLighting(settings);
    const on = !!(s?.enabled);
    if (this.scene) {
      if (on && s.background) {
        if (this.saved === undefined) this.saved = this.scene.background ?? null;
        this.scene.background = new this.THREE.Color(s.background);
      } else if (this.saved !== undefined) { this.scene.background = this.saved; this.saved = undefined; }
    }
    if (this.host && typeof document !== 'undefined') {
      if (!this.el) {
        this.el = document.createElement('div');
        this.el.className = 'fumoca-vignette';
        this.el.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:2;transition:opacity .25s';
        if (getComputedStyle(this.host).position === 'static') this.host.style.position = 'relative';
        this.host.appendChild(this.el);
      }
      const v = on ? s.vignette : 0;
      this.el.style.opacity = v > 0 ? '1' : '0';
      this.el.style.background = `radial-gradient(ellipse at center, rgba(0,0,0,0) ${Math.round(70 - v * 35)}%, rgba(0,0,0,${(0.25 + v * 0.6).toFixed(2)}) 100%)`;
    }
  }
  dispose() { this.apply({ enabled: false }); this.el?.remove(); this.el = null; }
}

export class SplatLighting {
  constructor(THREE, mesh, settings = null, { scene = null, host = null } = {}) {
    this.THREE = THREE; this.mesh = mesh;
    this.atmosphere = scene || host ? new Atmosphere(THREE, scene, host) : null;
    this.rest = readRest(mesh);
    if (!this.rest) throw new Error('Splat is not ready for lighting yet.');
    this.normals = splatNormals(this.rest);
    this.lit = new Float32Array(this.rest.colors.length);
    this.settings = normalizeLighting(settings) || { ...DEFAULT_LIGHTING };
    this.plane = null;
    (globalThis._fumocaLightingByMesh ||= new WeakMap()).set(mesh, this);
  }

  /** The splats were edited in place: take their new geometry, keep the scan colours. */
  refreshGeometry() {
    if (!refreshRestGeometry(this.rest, this.mesh)) return false;
    this.normals = splatNormals(this.rest);
    this.groundY = null;                // the shadow goes to the new ground
    return true;
  }

  /** Positions to cast the shadow from: a posed rig, or open parts, if any. */
  _rigPositions() {
    const d = globalThis.FumocaRig?.driver || globalThis._fumocaRigDriver;
    return d?.mesh === this.mesh && d.out?.positions && d.prevMats ? d.out.positions : null;
  }
  _partAnimator() { return globalThis._fumocaPartAnimatorByMesh?.get?.(this.mesh) || null; }
  _positions() {
    const rig = this._rigPositions();
    if (rig) return rig;
    const a = this._partAnimator();
    if (a?.posed?.length === this.rest.positions.length && a.openTransforms().length) return a.posed;
    return this.rest.positions;
  }
  /** Normals, turned with any open door / lid so it is lit as it now faces. */
  _normals() {
    const a = this._partAnimator(), open = a?.openTransforms?.() || [];
    if (!open.length) return this.normals;
    const N = this._turned && this._turned.length === this.normals.length ? this._turned : (this._turned = new Float32Array(this.normals.length));
    N.set(this.normals);
    for (const { members, q } of open) {
      const [x, y, z, w] = q;
      for (const i of members) {
        const v0 = N[i * 3], v1 = N[i * 3 + 1], v2 = N[i * 3 + 2];
        const tx = 2 * (y * v2 - z * v1), ty = 2 * (z * v0 - x * v2), tz = 2 * (x * v1 - y * v0);
        N[i * 3] = v0 + w * tx + (y * tz - z * ty); N[i * 3 + 1] = v1 + w * ty + (z * tx - x * tz); N[i * 3 + 2] = v2 + w * tz + (x * ty - y * tx);
      }
    }
    return N;
  }
  /** Self-shadow visibility for the key (and second) light, cached until the light or pose changes. */
  _visibility(P) {
    const s = this.settings;
    if (!s.selfShadow) return {};
    const n = this.rest.count, posed = P !== this.rest.positions;
    const key = (a, e) => `${a.toFixed(1)}|${e.toFixed(1)}|${s.shadowSoftness}|${posed ? this._poseStamp = (this._poseStamp || 0) + 1 : 0}`;
    const k1 = key(s.azimuth, s.elevation);
    if (k1 !== this._vis1Key) { this._vis1 = selfShadow(P, n, this.rest.opacity, lightDirection(s.azimuth, s.elevation), { softness: s.shadowSoftness, out: this._vis1 }); this._vis1Key = k1; }
    let vis2 = null;
    if (s.light2 && s.intensity2 > 0) {
      const k2 = key(s.azimuth2, s.elevation2);
      if (k2 !== this._vis2Key) { this._vis2 = selfShadow(P, n, this.rest.opacity, lightDirection(s.azimuth2, Math.max(-89, s.elevation2)), { softness: s.shadowSoftness, out: this._vis2 }); this._vis2Key = k2; }
      vis2 = this._vis2;
    }
    return { vis1: this._vis1, vis2 };
  }

  /** While a door / lid moves: relight it as it turns, shadow following. */
  _listenParts() {
    if (this._onPartFrame) return;
    let queued = false, frame = 0;
    this._onPartFrame = (e) => {
      if (e.detail?.mesh && e.detail.mesh !== this.mesh) return;
      if (!this.settings.enabled || queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; try { this.apply(this.settings, { fast: true, shadow: (frame++ % 2) === 0 ? 'auto' : false }); } catch (_) {} });
    };
    this._onPartSettled = (e) => {
      if (e.detail?.mesh && e.detail.mesh !== this.mesh) return;
      if (this.settings.enabled) try { this.apply(this.settings, { fast: true, shadow: true }); } catch (_) {}
    };
    globalThis.addEventListener?.('fumoca:partFrame', this._onPartFrame);
    globalThis.addEventListener?.('fumoca:partSettled', this._onPartSettled);
  }

  /**
   * Fast path for animation: only colours change, so write the colour bytes of
   * Spark's packed splats directly and keep each splat's current opacity
   * (parts / reveals may have changed it). Returns false if not possible.
   */
  _writeColoursOnly(splats) {
    const arr = splats.packedArray, n = this.rest.count;
    if (!(arr instanceof Uint32Array) || arr.length < n * 4 || splats.numSplats < n) return false;
    const enc = splats.splatEncoding || {}, lo = enc.rgbMin ?? 0, range = (enc.rgbMax ?? 1) - lo;
    const L = this.lit, k = 255 / (range || 1);
    for (let i = 0; i < n; i++) {
      const r = Math.max(0, Math.min(255, Math.round((L[i * 3] - lo) * k)));
      const g = Math.max(0, Math.min(255, Math.round((L[i * 3 + 1] - lo) * k)));
      const b = Math.max(0, Math.min(255, Math.round((L[i * 3 + 2] - lo) * k)));
      const j = i * 4;
      arr[j] = ((arr[j] & 0xff000000) | r | (g << 8) | (b << 16)) >>> 0;
    }
    return true;
  }

  apply(settings = this.settings, { shadow = true, fast = false } = {}) {
    this.settings = settings === this.settings ? settings : (normalizeLighting(settings) || this.settings);
    const splats = this.mesh.packedSplats || this.mesh.splats;
    if (!splats?.setSplat) throw new Error('This Spark build cannot relight splats in place.');
    this._listenParts();
    const P = this._positions();
    relightColors(this.rest.colors, this._normals(), this.settings, this.lit, P, { ...this._visibility(P), opacity: this.rest.opacity });
    const rigOn = !!this._rigPositions();
    // 'auto': update the shadow every frame while it is cheap, less often on big scans
    const doShadow = shadow === 'auto' ? ((this._shadowMs ?? 0) < 12 || ((this._shadowSkip = (this._shadowSkip || 0) + 1) % Math.ceil((this._shadowMs || 12) / 12) === 0)) : !!shadow;
    if (fast && !rigOn && this._writeColoursOnly(splats)) {
      splats.needsUpdate = true;
      this.mesh.updateVersion?.();
      if (doShadow) this.updateShadow();
      this.atmosphere?.apply(this.settings);
      globalThis.dispatchEvent?.(new CustomEvent('fumoca:lightingApplied', { detail: this.settings }));
      return;
    }
    const { THREE } = this, r = this.rest;
    const c = new THREE.Vector3(), sc = new THREE.Vector3(), q = new THREE.Quaternion(), col = new THREE.Color();
    for (let i = 0; i < r.count; i++) {
      c.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
      sc.set(r.scales[i * 3], r.scales[i * 3 + 1], r.scales[i * 3 + 2]);
      q.set(r.rotations[i * 4 + 1], r.rotations[i * 4 + 2], r.rotations[i * 4 + 3], r.rotations[i * 4]);
      col.setRGB(this.lit[i * 3], this.lit[i * 3 + 1], this.lit[i * 3 + 2]);
      splats.setSplat(i, c, sc, q, r.opacity[i], col);
    }
    splats.needsUpdate = true;
    this.mesh.updateVersion?.();
    if (doShadow) this.updateShadow();
    this.atmosphere?.apply(this.settings);
    globalThis.dispatchEvent?.(new CustomEvent('fumoca:lightingApplied', { detail: this.settings }));
  }

  updateShadow() {
    const started = performance.now();
    try { return this._updateShadow(); } finally { this._shadowMs = performance.now() - started; }
  }

  _updateShadow() {
    const { THREE, settings: s } = this;
    if (!s.enabled || !s.shadow) { if (this.plane) this.plane.visible = false; return; }
    const map = shadowMap(this._positions(), this.rest.count, this.rest.opacity, s,
      { size: 256, groundY: this.groundY ?? null, stride: Math.max(1, Math.floor(this.rest.count / 120000)) });
    this.groundY = this.groundY ?? map.groundY;           // ground stays put while the rig moves
    const rgba = new Uint8Array(map.size * map.size * 4);
    // DataTexture row 0 sits at v = 0, which the −90° X rotation puts at the
    // far (+z) edge, so write rows reversed.
    const S = map.size;
    for (let v = 0; v < S; v++) for (let u = 0; u < S; u++) rgba[((S - 1 - v) * S + u) * 4 + 3] = Math.round(map.data[v * S + u] * 255);
    if (!this.plane) {
      const tex = new THREE.DataTexture(rgba, map.size, map.size, THREE.RGBAFormat);
      tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter;
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, color: 0x000000 });
      this.plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
      this.plane.name = 'fumoca-splat-shadow';
      this.plane.rotation.x = -Math.PI / 2;
      this.plane.renderOrder = -1;
      this.mesh.add(this.plane);
    } else {
      this.plane.material.map.image.data.set(rgba);
      this.plane.material.map.needsUpdate = true;
    }
    const b = map.bounds;
    this.plane.scale.set(b.x1 - b.x0, b.z1 - b.z0, 1);
    this.plane.position.set((b.x0 + b.x1) / 2, this.groundY + 1e-4, (b.z0 + b.z1) / 2);
    this.plane.visible = true;
  }

  /**
   * Switch a lamp on/off (or 'toggle') with a short fade — the "light switch"
   * hotspot. Resolves when done.
   */
  async setLamp(id, to = 'toggle', { fadeMs = 450 } = {}) {
    const lamp = this.settings.lamps.find(l => l.id === id);
    if (!lamp) return false;
    const on = to === 'toggle' ? !lamp.on : !!(to === true || to === 'on');
    const steps = Math.max(1, Math.round(fadeMs / 90));
    lamp.on = true;
    for (let k = 1; k <= steps; k++) {
      lamp.fade = on ? k / steps : 1 - k / steps;
      this.apply(this.settings);
      await new Promise(r => setTimeout(r, fadeMs / steps));
    }
    lamp.on = on; delete lamp.fade;
    this.apply(this.settings);
    globalThis.dispatchEvent?.(new CustomEvent('fumoca:lampChange', { detail: { id, on } }));
    return true;
  }

  /** Back to the scan's own colours, shadow removed. */
  reset() {
    this.apply({ ...this.settings, enabled: false });
    if (this.plane) this.plane.visible = false;
  }

  dispose() {
    if (this._onPartFrame) { globalThis.removeEventListener?.('fumoca:partFrame', this._onPartFrame); globalThis.removeEventListener?.('fumoca:partSettled', this._onPartSettled); }
    try { this.reset(); } catch (_) {}
    this.atmosphere?.dispose();
    if (this.plane) { this.plane.parent?.remove(this.plane); this.plane.geometry.dispose(); this.plane.material.map?.dispose(); this.plane.material.dispose(); }
    this.plane = null;
  }
}

/** Public viewer: light the published splat as saved in Studio. */
export async function applyLightingOnViewer(THREE, mesh, saved) {
  const s = normalizeLighting(saved);
  if (!s?.enabled || !mesh) return null;
  if (mesh.initialized) await mesh.initialized;
  const renderer = globalThis._fumocaViewerRenderer;
  const l = new SplatLighting(THREE, mesh, s, { scene: globalThis._fumocaViewerScene || null, host: renderer?.domElement?.parentElement || null });
  l.apply(s);
  // Light animation saved in Studio (orbit, sunrise, sweep…)
  try {
    const { normalizeLightMotion, LightAnimator } = await import('./light-motion.js');
    const motion = normalizeLightMotion(saved?.motion);
    if (motion?.enabled && motion.autoplay) {
      l.animator = new LightAnimator(l, () => s, motion);
      l.animator.play();
    }
  } catch (e) { console.warn('[lighting] light animation', e); }
  return l;
}
