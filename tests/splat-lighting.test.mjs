import assert from 'node:assert/strict';
import { splatNormals, relightColors, shadowMap, lightDirection, normalizeLighting, SplatLighting } from '../js/modules/splat-lighting.js';

// A flat disc of splats on the ground (normals up) + a vertical wall facing +z.
function scene() {
  const pts = [];
  for (let i = 0; i < 400; i++) { const a = i * 2.39996, r = Math.sqrt(i / 400); pts.push({ p: [r * Math.cos(a), 0, r * Math.sin(a)], q: [Math.SQRT1_2, Math.SQRT1_2, 0, 0], s: [0.05, 0.05, 0.002] }); }   // flat in xz: thin along local z → rotated to y
  for (let i = 0; i < 200; i++) pts.push({ p: [(i % 20) / 10 - 1, 0.2 + Math.floor(i / 20) / 10, 1.2], q: [1, 0, 0, 0], s: [0.05, 0.05, 0.002] });          // wall in xy: thin along z
  const n = pts.length;
  const rest = { count: n, positions: new Float32Array(n * 3), rotations: new Float32Array(n * 4), scales: new Float32Array(n * 3), opacity: new Float32Array(n).fill(0.9), colors: new Float32Array(n * 3).fill(0.6) };
  pts.forEach((t, i) => { rest.positions.set(t.p, i * 3); rest.rotations.set(t.q, i * 4); rest.scales.set(t.s, i * 3); });
  return rest;
}
const rest = scene();
const N = splatNormals(rest);
// ground splats: normal ±y (oriented away from centre, centre is above the ground → points down? check magnitude only)
for (let i = 0; i < 400; i += 37) assert.ok(Math.abs(N[i * 3 + 1] - 1) < 1e-6, 'ground normal faces up');
const topLit = relightColors(rest.colors, N, { enabled: true, azimuth: 0, elevation: 80, intensity: 1, ambient: 0.3, color: '#ffffff' });
assert.ok(topLit[5 * 3] > 0.6 * 1.1, 'floor lit by an overhead light');
for (let i = 400; i < 600; i += 17) assert.ok(Math.abs(N[i * 3 + 2] - 1) < 1e-6, 'wall normal faces +z (away from centre)');

// light from the front (+z) lights the wall, light from behind doesn't
const front = relightColors(rest.colors, N, { enabled: true, azimuth: 0, elevation: 10, intensity: 1, ambient: 0.3, color: '#ffffff' });
const back = relightColors(rest.colors, N, { enabled: true, azimuth: 180, elevation: 10, intensity: 1, ambient: 0.3, color: '#ffffff' });
assert.ok(front[450 * 3] > back[450 * 3] + 0.3, `wall lit from the front ${front[450 * 3]} vs ${back[450 * 3]}`);
assert.ok(Math.abs(back[450 * 3] - 0.6 * 0.3) < 1e-6, 'unlit side gets ambient only');
const off = relightColors(rest.colors, N, { enabled: false });
assert.deepEqual(Array.from(off), Array.from(rest.colors), 'lighting off = original colours');

// shadow: light from the left-up casts the wall's shadow towards +x
const L = lightDirection(-90, 45);
assert.ok(L[0] < -0.6 && L[1] > 0.6, 'azimuth −90 = light on the −x side');
const sm = shadowMap(rest.positions.slice(400 * 3), 200, null, { enabled: true, azimuth: -90, elevation: 45, shadowOpacity: 1, shadowSoftness: 0 }, { size: 64, groundY: 0 });
let cx = 0, w = 0;
for (let v = 0; v < 64; v++) for (let u = 0; u < 64; u++) { const d = sm.data[v * 64 + u]; cx += d * (sm.bounds.x0 + (u + 0.5) / 64 * (sm.bounds.x1 - sm.bounds.x0)); w += d; }
assert.ok(cx / w > 0.2, 'shadow falls away from the light: centre x = ' + (cx / w));
assert.ok(Math.max(...sm.data) <= 1 && Math.min(...sm.data) >= 0);

// settings validation
assert.deepEqual(normalizeLighting({ enabled: true, color: 'red; x', elevation: -5, intensity: 99 }).color, '#fff4e6');
assert.equal(normalizeLighting({ elevation: -5 }).elevation, 2);
assert.equal(normalizeLighting(null), null);

// SplatLighting on a fake Spark mesh: lights, adds a shadow plane, reset restores
class V3 { set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } }
class Q4 { set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; return this; } }
class C3 { setRGB(r, g, b) { this.r = r; this.g = g; this.b = b; return this; } }
class Obj { constructor() { this.children = []; this.position = new V3().set(0, 0, 0); this.scale = new V3().set(1, 1, 1); this.rotation = {}; } add(o) { o.parent = this; this.children.push(o); } remove(o) { this.children = this.children.filter(c => c !== o); } }
const THREE = { Vector3: V3, Quaternion: Q4, Color: C3, RGBAFormat: 1, LinearFilter: 1,
  DataTexture: class { constructor(d, w, h) { this.image = { data: d, width: w, height: h }; } dispose() {} },
  MeshBasicMaterial: class { constructor(o) { Object.assign(this, o); } dispose() {} },
  PlaneGeometry: class { dispose() {} }, Mesh: class extends Obj { constructor(g, m) { super(); this.geometry = g; this.material = m; } } };
const rows = Array.from({ length: rest.count }, (_, i) => ({ c: [...rest.positions.slice(i * 3, i * 3 + 3)], s: [...rest.scales.slice(i * 3, i * 3 + 3)], q: [rest.rotations[i * 4 + 1], rest.rotations[i * 4 + 2], rest.rotations[i * 4 + 3], rest.rotations[i * 4]], a: 0.9, col: [0.6, 0.6, 0.6] }));
const mesh = Object.assign(new Obj(), { packedSplats: { numSplats: rows.length,
  forEachSplat(cb) { rows.forEach((r, i) => cb(i, { x: r.c[0], y: r.c[1], z: r.c[2] }, { x: r.s[0], y: r.s[1], z: r.s[2] }, { x: r.q[0], y: r.q[1], z: r.q[2], w: r.q[3] }, r.a, { r: r.col[0], g: r.col[1], b: r.col[2] })); },
  setSplat(i, c, s, q, a, col) { rows[i] = { c: [c.x, c.y, c.z], s: [s.x, s.y, s.z], q: [q.x, q.y, q.z, q.w], a, col: [col.r, col.g, col.b] }; } } });
const lighting = new SplatLighting(THREE, mesh);
lighting.apply({ enabled: true, azimuth: 0, elevation: 10, intensity: 1, ambient: 0.3, color: '#ffffff' });
assert.ok(rows[450].col[0] > 0.6 * 0.3 + 0.2, 'mesh relit');
const plane = mesh.children.find(c => c.name === 'fumoca-splat-shadow');
assert.ok(plane && plane.visible, 'shadow plane under the splat');
assert.ok(Math.abs(plane.position.y - 0) < 1e-3, 'shadow on the ground');
lighting.reset();
assert.ok(rows.every(r => Math.abs(r.col[0] - 0.6) < 1e-6), 'reset restores the scan colours');
assert.equal(plane.visible, false);
console.log('splat-lighting: all tests passed');
