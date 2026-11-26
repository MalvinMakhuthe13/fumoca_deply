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
import { readRest } from './splat-rig-driver.js';

export const DEFAULT_LIGHTING = Object.freeze({
  version: 1, enabled: false,
  azimuth: 35, elevation: 50,        // degrees; elevation from the ground plane
  intensity: 0.9, ambient: 0.55, color: '#fff4e6',
  shadow: true, shadowOpacity: 0.55, shadowSoftness: 0.5,
});

const num = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : d);

export function normalizeLighting(input) {
  if (!input || typeof input !== 'object') return null;
  const color = /^#[0-9a-f]{6}$/i.test(input.color || '') ? input.color : DEFAULT_LIGHTING.color;
  return {
    version: 1, enabled: !!input.enabled,
    azimuth: num(input.azimuth, -360, 360, 35), elevation: num(input.elevation, 2, 90, 50),
    intensity: num(input.intensity, 0, 3, 0.9), ambient: num(input.ambient, 0, 2, 0.55), color,
    shadow: input.shadow !== false, shadowOpacity: num(input.shadowOpacity, 0, 1, 0.55),
    shadowSoftness: num(input.shadowSoftness, 0, 1, 0.5),
  };
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

/** Lit colours (0..1) for every splat. */
export function relightColors(baseColors, normals, settings, out = null) {
  const s = normalizeLighting(settings) || { ...DEFAULT_LIGHTING };
  const n = baseColors.length / 3;
  out = out || new Float32Array(baseColors.length);
  if (!s.enabled) { out.set(baseColors); return out; }
  const L = lightDirection(s.azimuth, s.elevation), lc = hexRgb(s.color);
  for (let i = 0; i < n; i++) {
    const d = Math.max(0, normals[i * 3] * L[0] + normals[i * 3 + 1] * L[1] + normals[i * 3 + 2] * L[2]);
    const k = s.ambient + s.intensity * d;
    out[i * 3] = Math.min(1, baseColors[i * 3] * k * lc[0]);
    out[i * 3 + 1] = Math.min(1, baseColors[i * 3 + 1] * k * lc[1]);
    out[i * 3 + 2] = Math.min(1, baseColors[i * 3 + 2] * k * lc[2]);
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
  let minY = Infinity, minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < count; i += stride) {
    const y = positions[i * 3 + 1]; if (y < minY) minY = y;
  }
  const gy = groundY ?? minY;
  const px = new Float32Array(Math.ceil(count / stride) * 2);
  let k = 0;
  for (let i = 0; i < count; i += stride, k++) {
    const h = Math.max(0, positions[i * 3 + 1] - gy);
    const t = h / Math.max(0.05, L[1]);
    const x = positions[i * 3] - L[0] * t, z = positions[i * 3 + 2] - L[2] * t;
    px[k * 2] = x; px[k * 2 + 1] = z;
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const span = Math.max(maxX - minX, maxZ - minZ, 1e-6) * 1.35;
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const b = { x0: cx - span / 2, z0: cz - span / 2, x1: cx + span / 2, z1: cz + span / 2 };
  const data = new Float32Array(size * size);
  for (let j = 0, i = 0; j < k; j++, i += stride) {
    const u = Math.floor((px[j * 2] - b.x0) / span * size), v = Math.floor((px[j * 2 + 1] - b.z0) / span * size);
    if (u >= 0 && v >= 0 && u < size && v < size) data[v * size + u] += opacity ? opacity[i] : 1;
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
  let d = blur(blur(data));
  const sorted = Float32Array.from(d).filter(v => v > 0).sort();
  const ref = sorted.length ? sorted[Math.floor(sorted.length * 0.9)] : 1;
  for (let i = 0; i < d.length; i++) d[i] = Math.min(1, d[i] / (ref || 1)) * s.shadowOpacity;
  return { size, data: d, bounds: b, groundY: gy };
}

/**
 * Drives lighting + shadow on one Spark SplatMesh (Studio and viewer).
 */
export class SplatLighting {
  constructor(THREE, mesh, settings = null) {
    this.THREE = THREE; this.mesh = mesh;
    this.rest = readRest(mesh);
    if (!this.rest) throw new Error('Splat is not ready for lighting yet.');
    this.normals = splatNormals(this.rest);
    this.lit = new Float32Array(this.rest.colors.length);
    this.settings = normalizeLighting(settings) || { ...DEFAULT_LIGHTING };
    this.plane = null;
    (globalThis._fumocaLightingByMesh ||= new WeakMap()).set(mesh, this);
  }

  /** Positions to cast the shadow from: a posed rig if one is driving this mesh. */
  _positions() {
    const d = globalThis.FumocaRig?.driver || globalThis._fumocaRigDriver;
    if (d?.mesh === this.mesh && d.out?.positions && d.prevMats) return d.out.positions;
    return this.rest.positions;
  }

  apply(settings = this.settings) {
    this.settings = normalizeLighting(settings) || this.settings;
    const splats = this.mesh.packedSplats || this.mesh.splats;
    if (!splats?.setSplat) throw new Error('This Spark build cannot relight splats in place.');
    relightColors(this.rest.colors, this.normals, this.settings, this.lit);
    const { THREE } = this, r = this.rest, P = this._positions();
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
    this.updateShadow();
    globalThis.dispatchEvent?.(new CustomEvent('fumoca:lightingApplied', { detail: this.settings }));
  }

  updateShadow() {
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

  /** Back to the scan's own colours, shadow removed. */
  reset() {
    this.apply({ ...this.settings, enabled: false });
    if (this.plane) this.plane.visible = false;
  }

  dispose() {
    try { this.reset(); } catch (_) {}
    if (this.plane) { this.plane.parent?.remove(this.plane); this.plane.geometry.dispose(); this.plane.material.map?.dispose(); this.plane.material.dispose(); }
    this.plane = null;
  }
}

/** Public viewer: light the published splat as saved in Studio. */
export async function applyLightingOnViewer(THREE, mesh, saved) {
  const s = normalizeLighting(saved);
  if (!s?.enabled || !mesh) return null;
  if (mesh.initialized) await mesh.initialized;
  const l = new SplatLighting(THREE, mesh, s);
  l.apply(s);
  return l;
}
