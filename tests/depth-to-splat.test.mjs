import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDepth, depthToDistance, depthToGaussians, encodeGaussianPly, photoToGaussianPly } from '../js/modules/depth-to-splat.js';

// 40×30 photo: red near square (inverse depth high) on a blue far background.
const W = 40, H = 30;
function scene() {
  const rgba = new Uint8ClampedArray(W * H * 4);
  const raw = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, near = x >= 12 && x < 28 && y >= 8 && y < 22;
    rgba.set(near ? [230, 20, 20, 255] : [20, 40, 220, 255], i * 4);
    raw[i] = near ? 9.0 : 1.0; // Depth Anything style: bigger = closer
  }
  return { rgba, raw };
}

test('normalizeDepth maps to [0,1] with 1 = nearest and ignores outliers', () => {
  const d = normalizeDepth(new Float32Array([1, 2, 3, 4, 1000, NaN]));
  assert.ok(d.every(v => v >= 0 && v <= 1));
  assert.equal(d[5], 0, 'non-finite becomes far');
  assert.equal(normalizeDepth(new Float32Array([0, 1]), { invert: true })[0], 1);
});

test('disparity mapping keeps near < far and is monotonic', () => {
  assert.ok(Math.abs(depthToDistance(1, 1, 4) - 1) < 1e-9);
  assert.ok(Math.abs(depthToDistance(0, 1, 4) - 4) < 1e-9);
  assert.ok(depthToDistance(0.5, 1, 4) < depthToDistance(0.25, 1, 4));
});

test('near pixels end up in front of far pixels (depth is not inverted)', () => {
  const { rgba, raw } = scene();
  const g = depthToGaussians({ rgba, width: W, height: H, depth: normalizeDepth(raw) });
  let redZ = [], blueZ = [];
  for (let i = 0; i < g.count; i++) (g.colors[i * 3] > 0.5 ? redZ : blueZ).push(g.positions[i * 3 + 2]);
  const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
  assert.ok(redZ.length > 100 && blueZ.length > 100);
  assert.ok(mean(redZ) > mean(blueZ) + 1, 'camera looks down -Z: nearer surfaces have larger z');
  assert.ok(g.stats.edgesDropped > 0, 'flying pixels on the square border are removed');
});

test('near Gaussians are smaller than far ones (pixel footprint)', () => {
  const { rgba, raw } = scene();
  const g = depthToGaussians({ rgba, width: W, height: H, depth: normalizeDepth(raw) });
  let red = 0, blue = 0;
  for (let i = 0; i < g.count; i++) { if (g.colors[i * 3] > 0.5) red = g.scales[i * 3]; else blue = g.scales[i * 3]; }
  assert.ok(red < blue);
  for (let i = 0; i < g.count; i++) assert.ok(g.scales[i * 3 + 2] < g.scales[i * 3], 'flat along the view axis');
});

test('maxSplats strides the grid and removeBackground drops the far plane', () => {
  const { rgba, raw } = scene();
  const depth = normalizeDepth(raw);
  const small = depthToGaussians({ rgba, width: W, height: H, depth }, { maxSplats: 300 });
  assert.ok(small.count <= 300 && small.stats.stride >= 2);
  const subject = depthToGaussians({ rgba, width: W, height: H, depth }, { removeBackground: 0.5 });
  for (let i = 0; i < subject.count; i++) assert.ok(subject.colors[i * 3] > 0.5, 'only the red subject remains');
});

test('transparent PNG pixels are skipped', () => {
  const { rgba, raw } = scene();
  for (let i = 0; i < W * H; i++) if (rgba[i * 4 + 2] > 200) rgba[i * 4 + 3] = 0;
  const g = depthToGaussians({ rgba, width: W, height: H, depth: normalizeDepth(raw) });
  for (let i = 0; i < g.count; i++) assert.ok(g.colors[i * 3] > 0.5);
});

test('encodeGaussianPly writes a valid standard 3DGS PLY', () => {
  const { rgba, raw } = scene();
  const { bytes, count } = photoToGaussianPly({ rgba, width: W, height: H, rawDepth: raw, depthWidth: W, depthHeight: H });
  const text = new TextDecoder().decode(bytes.subarray(0, 600));
  const headerEnd = text.indexOf('end_header\n') + 'end_header\n'.length;
  assert.match(text, new RegExp(`element vertex ${count}\\n`));
  for (const p of ['f_dc_0', 'scale_0', 'rot_0', 'opacity']) assert.match(text, new RegExp(`property float ${p}\\n`));
  assert.equal(bytes.length - headerEnd, count * 14 * 4, 'no trailing bytes (Studio sync requires exact size)');
  const v = new DataView(bytes.buffer, bytes.byteOffset + headerEnd);
  for (let i = 0; i < count; i += 37) {
    const o = i * 56;
    assert.equal(v.getFloat32(o + 40, true), 1, 'identity quaternion w');
    assert.ok(v.getFloat32(o + 24, true) > 2, 'opaque (logit)');
    assert.ok(v.getFloat32(o + 28, true) < 0, 'log scale of a small Gaussian');
    for (let k = 0; k < 14; k++) assert.ok(Number.isFinite(v.getFloat32(o + k * 4, true)));
  }
});

test('depth at a different resolution than the photo is resampled', () => {
  const { rgba } = scene();
  const dw = 10, dh = 8, raw = new Float32Array(dw * dh).fill(1);
  for (let y = 2; y < 6; y++) for (let x = 3; x < 7; x++) raw[y * dw + x] = 9;
  const { count } = photoToGaussianPly({ rgba, width: W, height: H, rawDepth: raw, depthWidth: dw, depthHeight: dh });
  assert.ok(count > 500);
});
