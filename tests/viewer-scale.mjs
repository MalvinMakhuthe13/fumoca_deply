import { geometryToSplatRows } from '../js/modules/nif-format.js';

function pack(count, fill) {
  const data = new Float32Array(count * 14);
  for (let i = 0; i < count; i++) {
    const o = i * 14;
    data[o] = (i % 20) * 0.4;
    data[o + 1] = ((i * 3) % 17) * 0.3;
    data[o + 2] = ((i * 5) % 13) * 0.25;
    fill(data, o, i);
    data[o + 6] = 1;
    data[o + 10] = 2.2;
    data[o + 11] = 0.4;
    data[o + 12] = -0.2;
    data[o + 13] = 0.1;
  }
  return geometryToSplatRows({ count, data });
}

function firstScale(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getFloat32(12, true);
}

const real = pack(400, (d, o, i) => {
  d[o + 3] = Math.log(0.008 + (i % 9) * 0.003);
  d[o + 4] = Math.log(0.02 + (i % 5) * 0.004);
  d[o + 5] = Math.log(0.004 + (i % 4) * 0.002);
});
const realScale = firstScale(real);
if (!(realScale > 0.006 && realScale < 0.02)) {
  throw new Error('real splat was enlarged: ' + realScale);
}

const cloud = pack(400, (d, o) => {
  const s = Math.log(0.01);
  d[o + 3] = s;
  d[o + 4] = s;
  d[o + 5] = s;
});
const cloudScale = firstScale(cloud);
if (!(cloudScale > 0.01 * 1.2)) {
  throw new Error('uniform point cloud was not filled: ' + cloudScale);
}
if (cloudScale > 0.01 * 12.1) {
  throw new Error('uniform point cloud boost exceeded cap: ' + cloudScale);
}

console.log('viewer scale ok', { realScale, cloudScale });
