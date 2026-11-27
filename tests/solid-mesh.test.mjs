// Splat → textured solid mesh (CPU, OpenMVS-style). Run: node --test tests/solid-mesh.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { gaussiansToSolidMesh, renderView, gaussianCovariances, orbitCameras, robustBounds } from '../js/modules/solid-mesh.js';
import { encodePng, writeGlb, readGlb } from '../js/modules/glb-writer.js';

function tangentQuat(n) { // rotate local +z onto n
  const w = 1 + n[2];
  if (w < 1e-6) return [0, 1, 0, 0];
  const q = [w, -n[1], n[0], 0]; const l = Math.hypot(...q); return q.map(v => v / l);
}
function sphere(N = 24000, R = 1) {
  const g = { count: N, positions: new Float32Array(N * 3), colors: new Float32Array(N * 3), opacities: new Float32Array(N).fill(0.95), scales: new Float32Array(N * 3), rotations: new Float32Array(N * 4) };
  for (let i = 0; i < N; i++) {
    const y = 1 - 2 * (i + 0.5) / N, r = Math.sqrt(1 - y * y), phi = i * Math.PI * (3 - Math.sqrt(5));
    const n = [Math.cos(phi) * r, y, Math.sin(phi) * r];
    g.positions.set(n.map(v => v * R), i * 3);
    g.colors.set(y > 0 ? [0.9, 0.1, 0.1] : [0.1, 0.2, 0.9], i * 3);
    g.rotations.set(tangentQuat(n), i * 4);
    g.scales.set([0.035, 0.035, 0.003], i * 3);
  }
  return g;
}
function cube(perFace = 3600, h = 0.8) {
  const N = perFace * 6, side = Math.sqrt(perFace) | 0;
  const g = { count: N, positions: new Float32Array(N * 3), colors: new Float32Array(N * 3), opacities: new Float32Array(N).fill(0.97), scales: new Float32Array(N * 3), rotations: new Float32Array(N * 4) };
  const faces = [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]];
  let i = 0;
  for (const [ax, sgn] of faces) for (let a = 0; a < side; a++) for (let b = 0; b < side; b++) {
    const p = [0, 0, 0], u = (a + 0.5) / side * 2 - 1, v = (b + 0.5) / side * 2 - 1;
    const others = [0, 1, 2].filter(k => k !== ax);
    p[ax] = sgn * h; p[others[0]] = u * h; p[others[1]] = v * h;
    const n = [0, 0, 0]; n[ax] = sgn;
    g.positions.set(p, i * 3); g.colors.set([0.2 + 0.1 * ax, 0.8, 0.3], i * 3);
    g.rotations.set(tangentQuat(n), i * 4); g.scales.set([2 * h / side * 0.7, 2 * h / side * 0.7, 0.002], i * 3);
    i++;
  }
  g.count = i;
  return g;
}

test('CPU renderer: median depth sits on the surface, colours un-premultiplied', () => {
  const g = sphere(12000);
  const cams = orbitCameras(robustBounds(g.positions, g.count), { count: 6, width: 128, height: 128 });
  const v = renderView(g, gaussianCovariances(g), cams[0]);
  const c = 64 * 128 + 64;
  const dist = Math.hypot(...cams[0].eye);
  assert.ok(Math.abs(v.depth[c] - (dist - 1)) < 0.06, `centre depth ${v.depth[c]} ≈ ${dist - 1}`);
  assert.ok(v.alpha[c] > 0.95 && v.alpha[0] < 0.01, 'opaque object, empty corner');
  assert.ok(Number.isNaN(v.depth[0]), 'no depth where nothing was hit');
});

test('sphere → closed textured mesh on the true surface', async () => {
  const t0 = Date.now();
  const out = await gaussiansToSolidMesh(sphere(), { views: 26, viewSize: 256, resolution: 96, atlasSize: 1024 });
  assert.ok(Date.now() - t0 < 60000, 'finishes in reasonable time on a CPU');
  const rs = [];
  for (let i = 0; i < out.positions.length; i += 3) rs.push(Math.hypot(out.positions[i], out.positions[i + 1], out.positions[i + 2]));
  rs.sort((a, b) => a - b);
  assert.ok(Math.abs(rs[rs.length >> 1] - 1) < 0.04 && rs[rs.length * 0.95 | 0] - rs[rs.length * 0.05 | 0] < 0.05, 'vertices lie on the sphere');
  let outward = 0;
  for (let i = 0; i < out.normals.length; i += 3) if (out.positions[i] * out.normals[i] + out.positions[i + 1] * out.normals[i + 1] + out.positions[i + 2] * out.normals[i + 2] > 0) outward++;
  assert.ok(outward / (out.normals.length / 3) > 0.99, 'normals point outward');
  let good = 0, tot = 0;
  const A = out.atlas.width;
  for (let i = 0; i < out.uvs.length / 2; i++) {
    const y = out.positions[i * 3 + 1]; if (Math.abs(y) < 0.3) continue;
    const px = ((Math.min(A - 1, out.uvs[i * 2 + 1] * A | 0)) * A + Math.min(A - 1, out.uvs[i * 2] * A | 0)) * 4;
    if ((y > 0) === (out.atlas.rgba[px] > out.atlas.rgba[px + 2])) good++; tot++;
  }
  assert.ok(good / tot > 0.98, `texture shows the right colour on each side (${(good / tot).toFixed(3)})`);
  for (const v of out.uvs) assert.ok(v >= 0 && v <= 1);
});

test('cube keeps its extents (no blobby inflation)', async () => {
  const out = await gaussiansToSolidMesh(cube(), { views: 26, viewSize: 256, resolution: 112, atlasSize: 1024 });
  const max = [0, 1, 2].map(k => { let m = -Infinity; for (let i = k; i < out.positions.length; i += 3) m = Math.max(m, Math.abs(out.positions[i])); return m; });
  for (const m of max) assert.ok(Math.abs(m - 0.8) < 0.06, `half-extent ${m.toFixed(3)} ≈ 0.8`);
});

test('PNG + GLB are valid and round-trip', async () => {
  const rgba = new Uint8Array(4 * 4 * 4).map((_, i) => (i * 37) & 255);
  const png = await encodePng(rgba, 4, 4);
  assert.deepEqual(Array.from(png.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
  const idatLen = new DataView(png.buffer).getUint32(33);
  const inflated = new Uint8Array(await new Response(new Blob([png.subarray(41, 41 + idatLen)]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
  assert.equal(inflated.length, (4 * 4 + 1) * 4, 'IDAT inflates to the raw scanlines');
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const uvs = new Float32Array([0, 0, 1, 0, 0, 1]), indices = new Uint32Array([0, 1, 2]);
  const glb = writeGlb({ positions, normals, uvs, indices, png });
  assert.equal(glb.length % 4, 0);
  const { json, bin } = readGlb(glb);
  assert.equal(json.asset.version, '2.0');
  assert.equal(json.accessors[0].count, 3);
  assert.deepEqual(json.extensionsUsed, ['KHR_materials_unlit']);
  const pv = json.bufferViews[json.images[0].bufferView];
  assert.deepEqual(Array.from(bin.subarray(pv.byteOffset, pv.byteOffset + 4)), [137, 80, 78, 71]);
  const pos = new Float32Array(bin.buffer.slice(bin.byteOffset + json.bufferViews[0].byteOffset, bin.byteOffset + json.bufferViews[0].byteOffset + 36));
  assert.deepEqual(Array.from(pos), Array.from(positions));
});
