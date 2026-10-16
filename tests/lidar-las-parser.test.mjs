import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLAS } from '../js/modules/lidar-las-parser.mjs';

function makeLas({ format = 0, versionMinor = 2, recordLength, points, scale = [0.01,0.01,0.01], offset = [0,0,0], pointOffset = 227 } = {}) {
  const defaults = ({0:20,1:28,2:26,3:34,4:57,5:63,6:30,7:36,8:38,9:59,10:67})[format];
  recordLength ??= defaults;
  const count = points.length;
  const buffer = new ArrayBuffer(pointOffset + count * recordLength);
  const v = new DataView(buffer);
  for (let i=0;i<4;i++) v.setUint8(i, 'LASF'.charCodeAt(i));
  v.setUint8(24, 1); v.setUint8(25, versionMinor);
  v.setUint32(96, pointOffset, true);
  v.setUint8(104, format);
  v.setUint16(105, recordLength, true);
  v.setUint32(107, count, true);
  [0,1,2].forEach(i => v.setFloat64(131 + i*8, scale[i], true));
  [0,1,2].forEach(i => v.setFloat64(155 + i*8, offset[i], true));
  if (versionMinor >= 4 && buffer.byteLength >= 255) v.setBigUint64(247, BigInt(count), true);
  for (let i=0;i<count;i++) {
    const p = pointOffset + i*recordLength, point = points[i];
    v.setInt32(p, point.xyz[0], true); v.setInt32(p+4, point.xyz[1], true); v.setInt32(p+8, point.xyz[2], true);
    v.setUint16(p+12, point.intensity ?? 0, true);
    v.setUint8(p+14, point.returnByte ?? 1);
    v.setUint8(p+(format >= 6 ? 16 : 15), point.classification ?? 0);
    const colorOffset = ({2:20,3:28,5:28,7:30,8:30,10:30})[format];
    if (colorOffset != null) for(let c=0;c<3;c++) v.setUint16(p+colorOffset+c*2, point.rgb16?.[c] ?? 0, true);
  }
  return buffer;
}

test('LAS format 0 applies scale and offset and preserves intensity/class/return', () => {
  const cloud = parseLAS(makeLas({points:[
    {xyz:[100,200,300], intensity:1, classification:6, returnByte:3},
    {xyz:[-10,20,30], intensity:65535, classification:2, returnByte:2},
  ], scale:[0.01,0.02,0.03], offset:[500000,6000000,100]}));
  assert.equal(cloud.count,2);
  assert.deepEqual([...cloud.positions], [500001,6000004,109,499999.9,6000000.4,100.9]);
  assert.deepEqual([...cloud.intensities], [1,65535]);
  assert.deepEqual([...cloud.classifications], [6,2]);
  assert.deepEqual([...cloud.returnNumbers], [3,2]);
  assert.equal(cloud.coordinateMetadata.metricScaleVerified,false);
  assert.equal(cloud.coordinateMetadata.units,'unknown');
});

test('LAS 1.4 format 6 reads modern classification offset and 4-bit return number', () => {
  const cloud = parseLAS(makeLas({format:6,versionMinor:4,points:[
    {xyz:[1,2,3],intensity:42,classification:17,returnByte:0x0d},
  ]}));
  assert.equal(cloud.classifications[0],17);
  assert.equal(cloud.returnNumbers[0],13);
  assert.equal(cloud.intensities[0],42);
});

test('LAS RGB formats preserve 16-bit channel scaling', () => {
  const cloud = parseLAS(makeLas({format:2,points:[{xyz:[0,0,0],rgb16:[0,32768,65535]}]}));
  assert.equal(cloud.colors[0],0);
  assert.ok(Math.abs(cloud.colors[1] - 32768/65535) < 1e-7);
  assert.equal(cloud.colors[2],1);
});

test('rejects invalid signature, unsupported formats, short records and bad scales', () => {
  assert.throws(() => parseLAS(new ArrayBuffer(227)), /valid LAS/);
  assert.throws(() => parseLAS(makeLas({format:11,points:[{xyz:[0,0,0]}]})), /Unsupported LAS point format/);
  assert.throws(() => parseLAS(makeLas({format:0,recordLength:19,points:[{xyz:[0,0,0]}]})), /requires records/);
  assert.throws(() => parseLAS(makeLas({points:[{xyz:[0,0,0]}],scale:[0,0.01,0.01})), /scale\/offset/);
});

test('rejects compressed flags and invalid max point cap', () => {
  const compressed = makeLas({points:[{xyz:[0,0,0]}]});
  new DataView(compressed).setUint8(104,0x80);
  assert.throws(() => parseLAS(compressed), /LAZ compression/);
  assert.throws(() => parseLAS(makeLas({points:[{xyz:[0,0,0]}]}),0), /maxPoints/);
});

test('sampling cap preserves source point count and selected point attributes', () => {
  const cloud = parseLAS(makeLas({points:[
    {xyz:[1,0,0],intensity:11,classification:1},
    {xyz:[2,0,0],intensity:22,classification:2},
    {xyz:[3,0,0],intensity:33,classification:3},
    {xyz:[4,0,0],intensity:44,classification:4},
    {xyz:[5,0,0],intensity:55,classification:5},
  ]}),2);
  assert.equal(cloud.sourcePointCount,5);
  assert.equal(cloud.count,2);
  assert.deepEqual([...cloud.intensities],[11,44]);
  assert.deepEqual([...cloud.classifications],[1,4]);
});
