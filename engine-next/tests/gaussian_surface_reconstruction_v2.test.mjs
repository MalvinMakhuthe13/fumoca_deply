import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis.window || {};
const { default: FumocMeshExtractor } = await import('../../js/modules/fumoc-mesh-extractor.js');
const { autoTuneThreshold, buildDensityField } = FumocMeshExtractor;

test('mesh splitter preserves separate connected surfaces and local indices', () => {
  const mesh = {
    vertices: new Float32Array([
      0, 0, 0, 1, 0, 0, 0, 1, 0,
      3, 0, 0, 4, 0, 0, 3, 1, 0,
    ]),
    triangles: new Uint32Array([0, 1, 2, 3, 4, 5]),
    colours: new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 90, 70, 50, 90, 70, 50, 90, 70, 50]),
  };
  const parts = FumocMeshExtractor.splitMeshComponents(mesh);
  assert.equal(parts.length, 2);
  assert.deepEqual(parts.map(part => part.triangles.length / 3), [1, 1]);
  assert.deepEqual(Array.from(parts[0].triangles), [0, 1, 2]);
  assert.deepEqual(Array.from(parts[1].triangles), [0, 1, 2]);
  assert.deepEqual(Array.from(parts[0].colours), [255, 0, 0, 0, 255, 0, 0, 0, 255]);
  assert.deepEqual(Array.from(parts[1].colours), [90, 70, 50, 90, 70, 50, 90, 70, 50]);
  assert.notEqual(parts[0].id, parts[1].id);
});

test('mesh splitter keeps faces connected through shared vertices in one component', () => {
  const parts = FumocMeshExtractor.splitMeshComponents({
    vertices: new Float32Array([0,0,0, 1,0,0, 0,1,0, 1,1,0]),
    triangles: new Uint32Array([0,1,2, 1,3,2]),
  });
  assert.equal(parts.length, 1);
  assert.equal(parts[0].triangles.length / 3, 2);
  assert.equal(parts[0].vertices.length / 3, 4);
});

test('plane splitting separates observed triangles without capping the cut', () => {
  const mesh = {
    vertices: new Float32Array([
      0, -1, 0,  1, 1, 0,  -1, 1, 0,
      0, 2, 1,
    ]),
    triangles: new Uint32Array([0, 1, 2, 1, 3, 2]),
    colours: new Uint8Array([0, 0, 255, 255, 0, 0, 0, 255, 0, 255, 255, 255]),
  };
  const result = FumocMeshExtractor.splitMeshByPlane(mesh, { normal: [0, 1, 0], offset: 0 });
  assert.equal(result.split, true);
  assert.equal(result.cutIsOpen, true, 'the split creates no cap faces');
  assert.ok(result.positive && result.negative);
  assert.ok(result.positive.triangles.length > 0 && result.negative.triangles.length > 0);
  for (const part of [result.positive, result.negative]) {
    assert.equal(part.vertices.length % 3, 0);
    assert.equal(part.triangles.length % 3, 0);
    assert.ok(part.triangles.every(index => index < part.vertices.length / 3));
    assert.equal(part.colours.length, part.vertices.length);
    const topology = FumocMeshExtractor.validateWatertight(part);
    assert.ok(topology.openEdges > 0, 'each clipped side must report its deliberately open cut boundary');
    assert.equal(topology.watertight, false, 'plane splitting must not silently cap the cut');
  }
  assert.deepEqual(Array.from(mesh.vertices), [0, -1, 0, 1, 1, 0, -1, 1, 0, 0, 2, 1],
    'source geometry is never mutated');
});

test('plane splitting returns one side when the plane does not cross the mesh', () => {
  const result = FumocMeshExtractor.splitMeshByPlane({
    vertices: new Float32Array([0, 1, 0, 1, 1, 0, 0, 2, 0]),
    triangles: new Uint32Array([0, 1, 2]),
  }, { normal: [0, 1, 0], offset: 0 });
  assert.equal(result.split, false);
  assert.ok(result.positive);
  assert.equal(result.negative, null);
});

test('auto threshold is positive, bounded and scale invariant', () => {
  const density = new Float32Array(1000);
  for (let i = 0; i < density.length; i++) density[i] = i < 100 ? 0 : (i - 99) / 900;
  const threshold = autoTuneThreshold(density);
  const scaled = Float32Array.from(density, value => value * 7.5);
  const scaledThreshold = autoTuneThreshold(scaled);
  assert.ok(threshold >= 0.12);
  assert.ok(threshold <= 0.38);
  assert.ok(Math.abs(scaledThreshold / 7.5 - threshold) < 0.003);
});

test('auto threshold does not follow a tiny low-density tail', () => {
  const density = new Float32Array(1000);
  for (let i = 0; i < 850; i++) density[i] = 0.001 + (i % 100) * 0.0001;
  for (let i = 850; i < 1000; i++) density[i] = 0.5 + (i - 850) * 0.003;
  const threshold = autoTuneThreshold(density);
  assert.ok(threshold >= 0.06, `unexpectedly low threshold: ${threshold}`);
});

test('non-unit Gaussian quaternions produce the same density as normalized quaternions', async () => {
  const makeGaussian = (qScale) => ({
    N: 2,
    posX: new Float32Array([-0.1, 0.1]), posY: new Float32Array([0, 0]), posZ: new Float32Array([0, 0]),
    sclX: new Float32Array([Math.log(0.18), Math.log(0.18)]), sclY: new Float32Array([Math.log(0.08), Math.log(0.08)]), sclZ: new Float32Array([Math.log(0.12), Math.log(0.12)]),
    rotW: new Float32Array([Math.SQRT1_2 * qScale, Math.SQRT1_2 * qScale]), rotX: new Float32Array([0, 0]),
    rotY: new Float32Array([0, 0]), rotZ: new Float32Array([Math.SQRT1_2 * qScale, Math.SQRT1_2 * qScale]),
    colA: new Float32Array([255, 255]),
  });
  const a = await buildDensityField(makeGaussian(1), { resolution: 18, sigmaScale: 1.2 });
  const b = await buildDensityField(makeGaussian(3.7), { resolution: 18, sigmaScale: 1.2 });
  assert.equal(a.density.length, b.density.length);
  for (let i = 0; i < a.density.length; i++) assert.ok(Math.abs(a.density[i] - b.density[i]) < 1e-5);
});


test('anisotropic density follows the renderer forward quaternion orientation', async () => {
  const q = { w: 0.72, x: 0.21, y: 0.43, z: 0.49 };
  const qn = Math.hypot(q.w, q.x, q.y, q.z);
  for (const k of ['w', 'x', 'y', 'z']) q[k] /= qn;
  const rotate = (v, inverse = false) => {
    const x = inverse ? -q.x : q.x;
    const y = inverse ? -q.y : q.y;
    const z = inverse ? -q.z : q.z;
    const tx = 2 * (y * v.z - z * v.y);
    const ty = 2 * (z * v.x - x * v.z);
    const tz = 2 * (x * v.y - y * v.x);
    return {
      x: v.x - q.w * tx + (y * tz - z * ty),
      y: v.y - q.w * ty + (z * tx - x * tz),
      z: v.z - q.w * tz + (x * ty - y * tx),
    };
  };
  const field = await buildDensityField({
    N: 1,
    posX: new Float32Array([0]), posY: new Float32Array([0]), posZ: new Float32Array([0]),
    sclX: new Float32Array([Math.log(0.22)]),
    sclY: new Float32Array([Math.log(0.07)]),
    sclZ: new Float32Array([Math.log(0.05)]),
    rotW: new Float32Array([q.w]), rotX: new Float32Array([q.x]),
    rotY: new Float32Array([q.y]), rotZ: new Float32Array([q.z]),
    colA: new Float32Array([255]),
  }, {
    resolution: 64,
    sigmaScale: 1,
    bounds: { min: { x: -0.4, y: -0.4, z: -0.4 }, max: { x: 0.4, y: 0.4, z: 0.4 } },
  });
  const sample = (direction) => {
    const step = 0.16;
    const x = direction.x * step, y = direction.y * step, z = direction.z * step;
    const ix = Math.max(0, Math.min(63, Math.round((x - field.bounds.min.x) / field.voxelSize)));
    const iy = Math.max(0, Math.min(63, Math.round((y - field.bounds.min.y) / field.voxelSize)));
    const iz = Math.max(0, Math.min(63, Math.round((z - field.bounds.min.z) / field.voxelSize)));
    return field.density[iz * 64 * 64 + iy * 64 + ix];
  };
  const rendererMajorAxis = rotate({ x: 1, y: 0, z: 0 });
  const mirroredMajorAxis = rotate({ x: 1, y: 0, z: 0 }, true);
  assert.ok(
    sample(rendererMajorAxis) > sample(mirroredMajorAxis) * 1.5,
    'mesh density must follow the renderer orientation, not its mirrored inverse',
  );
});

test('density bounds include rotated three-sigma Gaussian support', async () => {
  const q = { w: Math.SQRT1_2, x: 0, y: 0, z: Math.SQRT1_2 };
  const field = await buildDensityField({
    N: 1,
    posX: new Float32Array([0]), posY: new Float32Array([0]), posZ: new Float32Array([0]),
    sclX: new Float32Array([Math.log(0.2)]),
    sclY: new Float32Array([Math.log(0.04)]),
    sclZ: new Float32Array([Math.log(0.03)]),
    rotW: new Float32Array([q.w]), rotX: new Float32Array([q.x]),
    rotY: new Float32Array([q.y]), rotZ: new Float32Array([q.z]),
    colA: new Float32Array([255]),
  }, { resolution: 48, sigmaScale: 1 });
  // A 90-degree Z rotation swaps the long X and short Y support axes.
  assert.ok(field.bounds.max.x >= 0.11 && field.bounds.min.x <= -0.11,
    'world X bounds must include the rotated long-axis support');
  assert.ok(field.bounds.max.y >= 0.59 && field.bounds.min.y <= -0.59,
    'world Y bounds must include the rotated long-axis support');
  assert.ok(field.bounds.max.z >= 0.09 && field.bounds.min.z <= -0.09,
    'world Z bounds must include the short-axis support');
});

test('extractMesh uses directional bridging and returns bridge diagnostics', async () => {
  const result = await FumocMeshExtractor.extractMesh({
    N: 1,
    posX: new Float32Array([0]), posY: new Float32Array([0]), posZ: new Float32Array([0]),
    sclX: new Float32Array([Math.log(0.12)]),
    sclY: new Float32Array([Math.log(0.12)]),
    sclZ: new Float32Array([Math.log(0.12)]),
    rotW: new Float32Array([1]), rotX: new Float32Array([0]),
    rotY: new Float32Array([0]), rotZ: new Float32Array([0]),
    colA: new Float32Array([255]),
  }, {
    resolution: 20,
    sigmaScale: 1,
    densityBridgingPasses: 1,
    smooth: 0,
    transferColours: false,
    format: 'stl',
  });
  assert.ok(result.stats.triangles > 0);
  assert.equal(result.stats.densityBridging.method, 'opposed-support-cavity-bridge');
  assert.equal(result.stats.densityBridging.passes, 1);
  assert.ok(result.stats.openEdges >= 0);
});

test('density regularization bridges a one-voxel gap without mutating the source field', () => {
  const R = 7;
  const density = new Float32Array(R * R * R);
  const at = (x, y, z) => z * R * R + y * R + x;
  density[at(2, 3, 3)] = 1;
  density[at(4, 3, 3)] = 1;
  const original = density.slice();
  const field = { density, resolution: R, voxelSize: 1, bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 7, y: 7, z: 7 } } };
  const regularized = FumocMeshExtractor.smoothDensityField(field, 1);
  assert.equal(density[at(3, 3, 3)], 0, 'source density remains unchanged');
  assert.ok(regularized.density[at(3, 3, 3)] > 0, 'the one-voxel gap receives neighbouring density');
  assert.equal(regularized.densitySmoothing, 1);
  assert.deepEqual(Array.from(density), Array.from(original));
});

test('density regularization preserves a constant field and zero-pass identity', () => {
  const density = new Float32Array(5 * 5 * 5).fill(0.25);
  const field = { density, resolution: 5 };
  const smoothed = FumocMeshExtractor.smoothDensityField(field, 1);
  for (const value of smoothed.density) assert.ok(Math.abs(value - 0.25) < 1e-6);
  assert.equal(FumocMeshExtractor.smoothDensityField(field, 0), field);
});


test('automatic component cleanup removes tiny islands but preserves the dominant shell', () => {
  const vertices = new Float32Array([
    0,0,0, 1,0,0, 0,1,0,
    10,0,0, 11,0,0, 10,1,0,
    11,1,0, 10,0,1,
  ]);
  const triangles = new Uint32Array([
    0,1,2,
    3,4,5, 4,6,5, 3,5,7, 5,6,7,
  ]);
  const result = FumocMeshExtractor.removeSmallComponents({ vertices, triangles }, 3);
  assert.equal(result.removedComponents, 1);
  assert.equal(result.removedTriangles, 1);
  assert.equal(result.mesh.triangles.length / 3, 4);
});

test('axis-aligned component splitting supports X, Y and Z without creating caps', () => {
  for (const axis of [0, 1, 2]) {
    const vertices = new Float32Array([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
      0, 0, 1,
    ]);
    for (let i = 0; i < vertices.length; i += 3) {
      vertices[i + axis] -= 0.5;
    }
    const mesh = {
      vertices,
      triangles: new Uint32Array([0, 1, 2, 0, 3, 1, 1, 3, 2, 2, 3, 0]),
      colours: new Uint8Array(12).fill(180),
    };
    const normal = [0, 0, 0]; normal[axis] = 1;
    const result = FumocMeshExtractor.splitMeshByPlane(mesh, { normal, offset: 0 });
    assert.equal(result.split, true, `axis ${axis} should divide the fixture`);
    assert.equal(result.cutIsOpen, true);
    assert.ok(result.positive && result.negative);
    for (let i = axis; i < result.positive.vertices.length; i += 3) {
      assert.ok(result.positive.vertices[i] >= -1e-5, 'positive side stays on positive half-space');
    }
    for (let i = axis; i < result.negative.vertices.length; i += 3) {
      assert.ok(result.negative.vertices[i] <= 1e-5, 'negative side stays on negative half-space');
    }
  }
});

