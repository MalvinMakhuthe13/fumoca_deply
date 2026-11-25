import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePlyCoordinateMetadata, serializePlyCoordinateMetadata } from '../js/modules/lidar-coordinate-metadata.mjs';

test('PLY coordinate metadata round-trips a LAS local render origin', () => {
  const metadata = {
    source: 'LAS',
    scale: { x: 0.01, y: 0.01, z: 0.01 },
    offset: { x: 500000, y: 6000000, z: 100 },
    renderOrigin: { x: 510000, y: 6020000, z: 30100 },
    positionCoordinates: 'local_relative_to_render_origin',
    crs: 'unknown_not_parsed',
    units: 'unknown',
    metricScaleVerified: false,
  };
  const comment = serializePlyCoordinateMetadata(metadata);
  assert.ok(comment.startsWith('comment fumoca_coordinate_metadata '));
  const recovered = parsePlyCoordinateMetadata(['ply', 'format binary_little_endian 1.0', comment, 'end_header'].join('\n'));
  assert.deepEqual(recovered, metadata);
});

test('PLY metadata parser ignores absent or malformed metadata safely', () => {
  assert.equal(parsePlyCoordinateMetadata('ply\nformat ascii 1.0\nend_header'), null);
  assert.equal(parsePlyCoordinateMetadata('ply\ncomment fumoca_coordinate_metadata {broken}\nend_header'), null);
  assert.equal(serializePlyCoordinateMetadata(null), null);
});
