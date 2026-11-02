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

  const encoded = encodeNif({
    positions, colors01, opacities01, scalesLinear, quats, mesh,
    meta: { title: 'Dual surface round-trip fixture', surface_model: 'gaussian+mesh' },
  });
  const decoded = await decodeNif(encoded);

  assert.equal(decoded.gaussians.count, 4, 'Gaussian layer must survive');
  assert.ok(decoded.mesh, 'mesh layer must survive independently');
  assert.deepEqual(Array.from(decoded.mesh.positions), Array.from(mesh.vertices));
  assert.deepEqual(Array.from(decoded.mesh.faces), Array.from(mesh.triangles));
  assert.deepEqual(Array.from(decoded.mesh.colors), Array.from(mesh.colours));
  assert.equal(decoded.meta.title, 'Dual surface round-trip fixture');
});
