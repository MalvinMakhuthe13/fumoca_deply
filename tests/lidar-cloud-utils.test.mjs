import test from 'node:test';
import assert from 'node:assert/strict';
import { downsample } from '../js/modules/lidar-cloud-utils.mjs';

test('downsampling keeps point attributes aligned to the same selected indices', () => {
  const coordinateMetadata = { renderOrigin: { x: 500000, y: 6000000, z: 100 }, metricScaleVerified: false };
  const cloud = {
    positions: new Float32Array([
      0,0,0, 1,1,1, 2,2,2, 3,3,3, 4,4,4,
    ]),
    colors: new Float32Array([
      0,0,0, 0.1,0.1,0.1, 0.2,0.2,0.2, 0.3,0.3,0.3, 0.4,0.4,0.4,
    ]),
    intensities: new Uint16Array([10,20,30,40,50]),
    classifications: new Uint8Array([1,2,3,4,5]),
    returnNumbers: new Uint8Array([1,2,1,2,1]),
    count: 5, source: 'las-format-0', sourcePointCount: 5, coordinateMetadata,
  };
  const result = downsample(cloud, 2);
  assert.equal(result.count, 2);
  assert.deepEqual([...result.positions], [0,0,0,3,3,3]);
  assert.deepEqual([...result.intensities], [10,40]);
  assert.deepEqual([...result.classifications], [1,4]);
  assert.deepEqual([...result.returnNumbers], [1,2]);
  const expectedColors = [0,0,0,0.3,0.3,0.3];
  result.colors.forEach((value,index) => assert.ok(Math.abs(value - expectedColors[index]) < 1e-6));
  assert.equal(result.coordinateMetadata, coordinateMetadata);
  assert.equal(result.sourcePointCount, 5);
});

test('downsampling rejects invalid point caps and malformed point buffers', () => {
  assert.throws(() => downsample({ count: 3, positions: new Float32Array(9) }, 0), /maxPoints/);
  assert.throws(() => downsample({ count: 3, positions: new Float32Array(2) }, 1), /invalid count or position/);
});

test('clouds already under the cap are returned without needless copies', () => {
  const cloud = { count: 1, positions: new Float32Array([1,2,3]) };
  assert.equal(downsample(cloud, 10), cloud);
});

test('binary PLY export preserves local coordinates, attributes, and provenance comment', async () => {
  const { encodePointCloudPLY } = await import('../js/modules/lidar-cloud-utils.mjs');
  const metadata = {
    source: 'LAS',
    renderOrigin: { x: 500000, y: 6000000, z: 100 },
    positionCoordinates: 'local_relative_to_render_origin',
    units: 'unknown',
  };
  const cloud = {
    positions: new Float32Array([0,0,0, 0.01,0.02,0.03, 1,2,3]),
    colors: new Float32Array([1,0,0, 0,1,0, 0,0,1]),
    intensities: new Uint16Array([1,65535,42]),
    classifications: new Uint8Array([2,5,6]),
    returnNumbers: new Uint8Array([1,2,1]),
    count: 3,
    coordinateMetadata: metadata,
  };
  const bytes = encodePointCloudPLY(cloud);
  const textHeader = new TextDecoder().decode(bytes.slice(0, 8192));
  const marker = 'end_header\n';
  const headerEnd = textHeader.indexOf(marker);
  assert.ok(headerEnd >= 0, 'PLY header terminator exists');
  const header = textHeader.slice(0, headerEnd + marker.length);
  assert.match(header, /property ushort intensity/);
  assert.match(header, /property uchar classification/);
  assert.match(header, /property uchar return_number/);
  const { parsePlyCoordinateMetadata } = await import('../js/modules/lidar-coordinate-metadata.mjs');
  assert.deepEqual(parsePlyCoordinateMetadata(header), metadata);

  const dataOffset = new TextEncoder().encode(header).length;
  const view = new DataView(bytes.buffer, bytes.byteOffset + dataOffset);
  assert.equal(view.getFloat32(0, true), 0);
  assert.equal(view.getFloat32(4, true), 0);
  assert.equal(view.getFloat32(8, true), 0);
  assert.equal(view.getUint8(12), 255);
  assert.equal(view.getUint8(13), 0);
  assert.equal(view.getUint8(14), 0);
  assert.equal(view.getUint16(15, true), 1);
  assert.equal(view.getUint8(17), 2);
  assert.equal(view.getUint8(18), 1);
});
