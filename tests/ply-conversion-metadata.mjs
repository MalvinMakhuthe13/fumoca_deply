import assert from 'node:assert/strict';
import { inspectPlyAttributes } from '../js/modules/ply-conversion-metadata.js';

const degreeThree = Array.from({ length: 45 }, (_, i) => `f_rest_${i}`);
const gaussian = inspectPlyAttributes([
  'x', 'y', 'z', 'scale_0', 'scale_1', 'scale_2', 'opacity',
  'rot_0', 'rot_1', 'rot_2', 'rot_3', 'f_dc_0', 'f_dc_1', 'f_dc_2',
  ...degreeThree,
], true);
assert.equal(gaussian.detectedShDegree, 3);
assert.equal(gaussian.higherOrderShCount, 45);
assert.deepEqual(gaussian.discardedAttributes, []);
assert.equal(gaussian.hasUnsupportedShLayout, false);
assert.ok(gaussian.qualityFlags.includes('higher_order_sh_preserved_in_nif_sidecar'));

const degreeOne = inspectPlyAttributes(Array.from({ length: 9 }, (_, i) => `f_rest_${i}`), true);
assert.equal(degreeOne.detectedShDegree, 1);
assert.equal(degreeOne.hasUnsupportedShLayout, false);

const malformed = inspectPlyAttributes(['f_rest_0', 'f_rest_1', 'f_rest_2', 'f_rest_3'], true);
assert.equal(malformed.hasUnsupportedShLayout, true, 'unknown SH coefficient layouts must fail closed');

const gappedDegreeOne = inspectPlyAttributes([
  ...Array.from({ length: 8 }, (_, i) => `f_rest_${i}`),
  'f_rest_9',
], true);
assert.equal(gappedDegreeOne.detectedShDegree, 1);
assert.equal(gappedDegreeOne.hasUnsupportedShLayout, true, 'non-contiguous coefficient names must not be mislabeled as standard SH');

const dcOnly = inspectPlyAttributes(['x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2'], true);
assert.equal(dcOnly.detectedShDegree, 0);
assert.deepEqual(dcOnly.discardedAttributes, []);
assert.deepEqual(dcOnly.qualityFlags, []);

const incompleteGaussian = inspectPlyAttributes(['x', 'y', 'z', 'f_rest_0', 'f_rest_1', 'f_rest_2'], false);
assert.equal(incompleteGaussian.hasUnsupportedShLayout, true,
  'SH coefficients without the full Gaussian PLY schema must not silently fall back to point-cloud import');

const pointCloud = inspectPlyAttributes(['x', 'y', 'z', 'red', 'green', 'blue'], false);
assert.deepEqual(pointCloud.qualityFlags, ['point_cloud_not_gaussian', 'mesh_reconstruction_not_run']);
assert.deepEqual(pointCloud.discardedAttributes, []);

console.log('PLY conversion provenance passed: Gaussian SH is preserved and unsupported layouts are flagged.');
