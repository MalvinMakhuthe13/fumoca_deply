import test from 'node:test';
import assert from 'node:assert/strict';
import { parseXYZ } from '../js/modules/lidar-text-parser.mjs';

test('header-aware CSV maps xyz, RGB, intensity, class and return columns by name', () => {
  const cloud = parseXYZ('intensity,blue,z,classification,x,green,return_number,y,red\n65535,0,3,2,1,128,2,2,255\n1,255,6,5,4,64,1,5,0');
  assert.equal(cloud.count, 2);
  assert.deepEqual([...cloud.positions], [1,2,3,4,5,6]);
  assert.deepEqual([...cloud.intensities], [65535,1]);
  assert.deepEqual([...cloud.classifications], [2,5]);
  assert.deepEqual([...cloud.returnNumbers], [2,1]);
  assert.deepEqual([...cloud.colors.slice(0,3)], [1,128/255,0]);
  assert.equal(cloud.coordinateMetadata.metricScaleVerified, false);
});

test('headerless XYZRGB remains compatible and scales 8-bit color', () => {
  const cloud = parseXYZ('# capture\n1 2 3 255 128 0\n4 5 6 0 255 10');
  assert.equal(cloud.count, 2);
  assert.deepEqual([...cloud.positions], [1,2,3,4,5,6]);
  assert.deepEqual([...cloud.colors.slice(0,3)], [1,128/255,0]);
  assert.equal(cloud.intensities, null);
});

test('headerless four-column rows preserve raw intensity 0, 1 and 65535', () => {
  const cloud = parseXYZ('1 2 3 0\n4 5 6 1\n7 8 9 65535');
  assert.deepEqual([...cloud.intensities], [0,1,65535]);
});

test('malformed rows are skipped; no valid points is an explicit error', () => {
  const cloud = parseXYZ('x,y,z,intensity\n1,2,3,10\nnope,2,3,4\n4,5,');
  assert.deepEqual([...cloud.positions], [1,2,3]);
  assert.deepEqual([...cloud.intensities], [10]);
  assert.throws(() => parseXYZ('# empty\nno,points,here'), /must identify x, y, and z/);
});

test('missing xyz headers fail instead of silently swapping columns', () => {
  assert.throws(() => parseXYZ('latitude,longitude,height\n1,2,3'), /no valid x\/y\/z/);
});
