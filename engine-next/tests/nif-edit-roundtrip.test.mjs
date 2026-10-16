import assert from 'node:assert/strict';
import { encodeNif, decodeNif } from '../../js/modules/nif-format.js';

const source = {
  positions: new Float32Array([0, 0, 0, 1, 1, 1]),
  colors01: new Float32Array([1, 0, 0, 0, 1, 0]),
  opacities01: new Float32Array([1, 0.8]),
  mesh: {
    vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    colours: new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255]),
    triangles: new Uint32Array([0, 1, 2]),
  },
  lidarAttributes: {
    intensity: new Uint16Array([120, 450]),
    classification: new Uint8Array([2, 5]),
    returnNumber: new Uint8Array([1, 3]),
  },
};

const decoded = await decodeNif(encodeNif(source));
assert.equal(decoded.gaussians.count, 2);
assert.equal(decoded.mesh.nVerts, 3);
assert.equal(decoded.mesh.nFaces, 1);
assert.deepEqual([...decoded.mesh.colors], [...source.mesh.colours]);
assert.deepEqual([...decoded.mesh.faces], [...source.mesh.triangles]);
assert.deepEqual([...decoded.lidarAttributes.intensity], [...source.lidarAttributes.intensity]);
assert.deepEqual([...decoded.lidarAttributes.classification], [...source.lidarAttributes.classification]);
assert.deepEqual([...decoded.lidarAttributes.returnNumber], [...source.lidarAttributes.returnNumber]);

console.log('PASS edited NIF round-trips splats, colored mesh, and LiDAR attributes');
