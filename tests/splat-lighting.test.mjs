import assert from 'node:assert/strict';
import { splatNormals, relightColors, shadowMap, lightDirection, normalizeLighting, SplatLighting, MOODS, moodSettings } from '../js/modules/splat-lighting.js';

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
// moods + grade
for (const name of Object.keys(MOODS)) {
  const m = moodSettings(name);
  assert.equal(m.preset, name);
  const out = relightColors(rest.colors, N, m);
  for (const v of out) assert.ok(v >= 0 && v <= 1 && Number.isFinite(v), name + ' colours valid');
}
assert.equal(moodSettings('natural').enabled, false, 'Natural = the scan\'s own light');
const noir = relightColors(rest.colors.map((_, i) => [0.8, 0.3, 0.1][i % 3]), N, moodSettings('noir'));
assert.ok(Math.abs(noir[450 * 3] - noir[450 * 3 + 1]) < 1e-6 && Math.abs(noir[450 * 3 + 1] - noir[450 * 3 + 2]) < 1e-6, 'noir is black & white');
const warm = relightColors(rest.colors, N, { enabled: true, ambient: 1, intensity: 0, color: '#ffffff', warmth: 1 });
assert.ok(warm[0] > warm[2] + 0.1, 'warmth pushes red over blue');
const neon = relightColors(rest.colors, N, moodSettings('neon'));
assert.ok(neon[450 * 3] > neon[450 * 3 + 1], 'neon key light is pink on the lit side');
const bright = relightColors(rest.colors, N, { enabled: true, ambient: 0.5, intensity: 0, exposure: 1 });
assert.ok(Math.abs(bright[0] - 0.6 * 0.5 * 2) < 1e-6, '+1 exposure doubles');
console.log('splat-lighting: all tests passed');

// lamps: a room light only brightens what is near it; switching fades on/off
{
  const lampOn = { enabled: true, ambient: 0.2, intensity: 0, lamps: [{ id: 'ceiling', position: [-0.5, 0.45, 1.45], radius: 0.5, intensity: 2, color: '#ffffff', on: true }] };
  const lit2 = relightColors(rest.colors, N, lampOn, null, rest.positions);
  const nearWall = 445, farFloor = 5;   // wall splats sit at z=1.2 near the lamp; floor centre is far away
  assert.ok(lit2[nearWall * 3] > 0.6 * 0.2 * 2, 'lamp lights the wall near it: ' + lit2[nearWall * 3]);
  assert.ok(Math.abs(lit2[farFloor * 3] - 0.6 * 0.2) < 0.05, 'far away stays dark');
  const off2 = relightColors(rest.colors, N, { ...lampOn, lamps: [{ ...lampOn.lamps[0], on: false }] }, null, rest.positions);
  assert.ok(Math.abs(off2[nearWall * 3] - 0.6 * 0.2) < 1e-6, 'switched off');
  const l2 = new SplatLighting(THREE, mesh, null);
  l2.apply({ ...lampOn, lamps: [{ ...lampOn.lamps[0], on: false }] });
  const before = rows[nearWall].col[0];
  await l2.setLamp('ceiling', 'toggle', { fadeMs: 60 });
  assert.ok(rows[nearWall].col[0] > before + 0.1, 'light switch turns the room light on');
  assert.equal(l2.settings.lamps[0].on, true);
  await l2.setLamp('ceiling', 'off', { fadeMs: 30 });
  assert.ok(Math.abs(rows[nearWall].col[0] - before) < 1e-6, 'and off again');
  l2.dispose();
}
// shadow: haze below doesn't drag the ground down; a very low sun gives a bounded, soft-edged shadow
{
  const { shadowMap } = await import('../js/modules/splat-lighting.js');
  const P = [], O = [];
  for (let i = 0; i < 3000; i++) { P.push(Math.random() * 0.2 - 0.1, Math.random() * 0.3, Math.random() * 0.2 - 0.1); O.push(0.9); }
  for (let i = 0; i < 300; i++) { P.push(Math.random() * 4 - 2, -1 - Math.random(), Math.random() * 4 - 2); O.push(0.05); }
  const m = shadowMap(Float32Array.from(P), P.length / 3, Float32Array.from(O), { enabled: true, azimuth: 30, elevation: 2, shadowOpacity: 0.6, shadowSoftness: 0.5 }, { size: 128 });
  assert.ok(Math.abs(m.groundY) < 0.01, 'ground from the object, not the haze: ' + m.groundY);
  assert.ok(m.bounds.x1 - m.bounds.x0 < 4, 'low sun: shadow stays bounded ' + (m.bounds.x1 - m.bounds.x0));
  let edgeMax = 0; for (let x = 0; x < 128; x++) edgeMax = Math.max(edgeMax, m.data[x], m.data[127 * 128 + x], m.data[x * 128], m.data[x * 128 + 127]);
  assert.ok(edgeMax < 1e-6, 'no square border');
  assert.ok(Math.max(...m.data) > 0.3, 'there is a shadow');
}
// self-shadow: a disc (brim) above a floor shades the floor under it, not beside it; slant moves it
{
  const { selfShadow, lightDirection } = await import('../js/modules/splat-lighting.js');
  const P = [], kind = [];
  for (let i = 0; i < 20000; i++) { P.push(Math.random() * 2 - 1, 0, Math.random() * 2 - 1); kind.push('floor'); }
  for (let i = 0; i < 6000; i++) { const a = Math.random() * 6.283, r = Math.sqrt(Math.random()) * 0.3; P.push(Math.cos(a) * r, 0.4, Math.sin(a) * r); kind.push('disc'); }
  const pos = Float32Array.from(P), n = pos.length / 3, op = new Float32Array(n).fill(0.9);
  const vis = selfShadow(pos, n, op, lightDirection(0, 90));
  const avg = (f) => { let s = 0, c = 0; kind.forEach((k, i) => { if (f(k, i)) { s += vis[i]; c++; } }); return s / c; };
  const r2 = (i) => pos[i * 3] ** 2 + pos[i * 3 + 2] ** 2;
  const under = avg((k, i) => k === 'floor' && r2(i) < 0.2 ** 2), outside = avg((k, i) => k === 'floor' && r2(i) > 0.45 ** 2), top = avg(k => k === 'disc');
  assert.ok(under < 0.15 && outside > 0.95 && top > 0.95, `overhead: under ${under.toFixed(2)}, outside ${outside.toFixed(2)}, disc ${top.toFixed(2)}`);
  // light from 45° on +x: the shadow moves to −x by ~0.4
  const vs = selfShadow(pos, n, op, lightDirection(90, 45));
  const at = (cx) => { let s = 0, c = 0; kind.forEach((k, i) => { if (k === 'floor' && (pos[i * 3] - cx) ** 2 + pos[i * 3 + 2] ** 2 < 0.15 ** 2) { s += vs[i]; c++; } }); return s / c; };
  assert.ok(at(-0.4) < 0.2 && at(0.4) > 0.9, `slanted: shadow at −x ${at(-0.4).toFixed(2)}, lit at +x ${at(0.4).toFixed(2)}`);
  // haze does not cast shadows
  const hz = new Float32Array(n).fill(0.9); kind.forEach((k, i) => { if (k === 'disc') hz[i] = 0.1; });
  const vh = selfShadow(pos, n, hz, lightDirection(0, 90));
  let u = 0, c = 0; kind.forEach((k, i) => { if (k === 'floor' && r2(i) < 0.04) { u += vh[i]; c++; } });
  assert.ok(u / c > 0.95, 'faint splats cast no shadow');
}
console.log('splat-lighting lamps: all tests passed');
