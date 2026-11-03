import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeNif, decodeNif } from '../../js/modules/nif-format.js';

test('NIF preserves Gaussian source and connected mesh as independent layers', async () => {
  const positions = new Float32Array([
    -0.5, 0, 0,  0.5, 0, 0,
    0, 0.5, 0,  0, 0, 0.5,
  ]);
  const colors01 = new Float32Array([
    1, 0, 0,  0, 1, 0,
    0, 0, 1,  1, 1, 1,
  ]);
  const opacities01 = new Float32Array([1, 0.9, 0.8, 1]);
  const scalesLinear = new Float32Array([
    0.08, 0.03, 0.02,  0.08, 0.03, 0.02,
    0.08, 0.03, 0.02,  0.08, 0.03, 0.02,
  ]);
  const quats = new Float32Array([
    1, 0, 0, 0,  1, 0, 0, 0,
    1, 0, 0, 0,  1, 0, 0, 0,
  ]);
  const mesh = {
    vertices: new Float32Array([
      -0.5, 0, 0,  0.5, 0, 0,  0, 0.5, 0,  0, 0, 0.5,
    ]),
    triangles: new Uint32Array([0, 1, 2, 0, 3, 1, 1, 3, 2, 2, 3, 0]),
    colours: new Uint8Array([
      255, 0, 0,  0, 255, 0,  0, 0, 255, 255, 255, 255,
    ]),
  };

  const meshComponents = [
    { id: 'cap-shell', vertices: mesh.vertices, triangles: mesh.triangles,
      colours: mesh.colours, watertight: true },
    { id: 'support-platform', vertices: new Float32Array([0, -0.2, 0, 1, -0.2, 0, 0, -0.2, 1]),
      triangles: new Uint32Array([0, 1, 2]), colours: new Uint8Array([90, 70, 50, 90, 70, 50, 90, 70, 50]),
      watertight: false, visible: false },
  ];
  const encoded = encodeNif({
    positions, colors01, opacities01, scalesLinear, quats, mesh, meshComponents,
    meta: { title: 'Dual surface round-trip fixture', surface_model: 'gaussian+mesh' },
  });
  const decoded = await decodeNif(encoded);

  assert.equal(decoded.gaussians.count, 4, 'Gaussian layer must survive');
  assert.ok(decoded.mesh, 'mesh layer must survive independently');
  assert.deepEqual(Array.from(decoded.mesh.positions), Array.from(mesh.vertices));
  assert.deepEqual(Array.from(decoded.mesh.faces), Array.from(mesh.triangles));
  assert.deepEqual(Array.from(decoded.mesh.colors), Array.from(mesh.colours));
  assert.equal(decoded.meshComponents.length, 2, 'independent component chunk must survive');
  assert.deepEqual(decoded.meshComponents.map(component => component.id), ['cap-shell', 'support-platform']);
  assert.equal(decoded.meshComponents[0].watertight, true);
  assert.equal(decoded.meshComponents[1].watertight, false);
  assert.equal(decoded.meshComponents[0].visible, true);
  assert.equal(decoded.meshComponents[1].visible, false);
  assert.deepEqual(Array.from(decoded.meshComponents[1].faces), [0, 1, 2]);
  assert.ok(decoded.meshComponents[1].positions.every((value, index) => Math.abs(value - [0, -0.2, 0, 1, -0.2, 0, 0, -0.2, 1][index]) < 1e-6));
  assert.equal(decoded.meta.title, 'Dual surface round-trip fixture');
  const componentOnly = await decodeNif(encodeNif({
    positions, colors01, opacities01, scalesLinear, quats, meshComponents,
  }));
  assert.ok(componentOnly.mesh, 'legacy combined mesh fallback must be rebuilt from components');
  assert.equal(componentOnly.meshComponents.length, 2);
  assert.equal(componentOnly.mesh.nFaces, 5);
});
