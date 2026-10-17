import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLidarQualityReport, formatLidarQualitySummary } from '../js/modules/lidar-quality-report.mjs';

test('reports present attributes and does not imply Gaussian fusion or metric accuracy', () => {
  const cloud = {
    positions: new Float32Array([0,0,0, 1,0,0, 0,1,0]),
    colors: new Float32Array(9),
    intensities: new Uint16Array([10,20,30]),
    classifications: new Uint8Array([2,2,5]),
    returnNumbers: new Uint8Array([1,1,2]),
    count: 3,
    source: 'las-format-2',
    sourcePointCount: 3,
    coordinateMetadata: {
      crs: 'unknown_not_parsed',
      units: 'unknown',
      metricScaleVerified: false,
    },
  };
  const report = buildLidarQualityReport(cloud);
  assert.equal(report.status, 'ready_with_cautions');
  assert.equal(report.gates.preview, true);
  assert.equal(report.gates.merge, true);
  assert.equal(report.gates.metricMeasurement, false);
  assert.equal(report.gates.gaussianFusion, false);
  assert.deepEqual(report.attributes, { rgb: true, intensity: true, classification: true, returnNumber: true });
  assert.ok(report.warnings.some(item => item.code === 'CRS_UNKNOWN'));
  assert.ok(report.warnings.some(item => item.code === 'METRIC_SCALE_UNVERIFIED'));
  assert.match(formatLidarQualitySummary(report), /NOT verified/);
});

test('flags absent attribute arrays instead of manufacturing them', () => {
  const report = buildLidarQualityReport({
    positions: new Float32Array([0,0,0, 1,0,0, 0,1,0]),
    colors: null, intensities: null, classifications: null, returnNumbers: null, count: 3,
  });
  assert.deepEqual(report.attributes, { rgb: false, intensity: false, classification: false, returnNumber: false });
  assert.ok(report.warnings.some(item => item.code === 'INTENSITY_MISSING'));
  assert.equal(report.gates.metricMeasurement, false);
});

test('blocks previews with non-finite coordinates or malformed local-origin metadata', () => {
  const report = buildLidarQualityReport({
    positions: new Float32Array([0,0,0, NaN,1,2, 3,4,5]),
    count: 3,
    coordinateMetadata: {
      positionCoordinates: 'local_relative_to_render_origin',
      renderOrigin: { x: 0, y: 0, z: Infinity },
    },
  });
  assert.equal(report.status, 'blocked');
  assert.equal(report.gates.preview, false);
  assert.ok(report.warnings.some(item => item.code === 'NON_FINITE_COORDINATES'));
  assert.ok(report.warnings.some(item => item.code === 'ORIGIN_MISSING'));
});

test('records downsampling as a caution and preserves source/preview point counts', () => {
  const report = buildLidarQualityReport({
    positions: new Float32Array([0,0,0, 1,1,1, 2,2,2]),
    count: 3,
    sourcePointCount: 100,
  });
  assert.equal(report.sampled, true);
  assert.equal(report.sourcePointCount, 100);
  assert.ok(report.warnings.some(item => item.code === 'DOWNSAMPLED'));
});

test('rejects invalid clouds', () => {
  assert.throws(() => buildLidarQualityReport({ count: 4, positions: new Float32Array(3) }), /invalid point count/);
});
