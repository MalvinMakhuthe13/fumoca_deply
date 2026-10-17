import assert from 'node:assert/strict';
import FumocFormat from '../js/modules/fumoc-format.js';
import FumocDecoder from '../js/modules/fumoc-decoder.js';
import FumocCodec from '../js/modules/fumoc-codec.js';
import { readFile } from 'node:fs/promises';

const splat = new Uint8Array(32);
const view = new DataView(splat.buffer);
view.setFloat32(0, 1, true); view.setFloat32(4, 2, true); view.setFloat32(8, 3, true);
view.setFloat32(12, 0.1, true); view.setFloat32(16, 0.1, true); view.setFloat32(20, 0.1, true);
splat[24] = 200; splat[25] = 120; splat[26] = 40; splat[27] = 230;
splat[28] = 255; splat[29] = 128; splat[30] = 128; splat[31] = 128;
const valid = await FumocFormat.encode({ splatBuffer: splat, meta: { title: 'decoder fixture' } });
const decoded = await FumocDecoder.decode(valid);
assert.equal(decoded.gaussians.N, 1);
assert.equal(decoded.splatBinary.byteLength, 32);
assert.equal(decoded.gaussians.posX[0], 1);
assert.equal(decoded.header.splat_byte_length, 32);
const preview = await FumocDecoder.decodePreview(valid);
assert.equal(preview.meta.title, 'decoder fixture');

// Build a minimal order-1 ANS channel to prove the canonical decoder reads
// the full 131072-byte table instead of mis-parsing it as an order-0 table.
const encodedOrder1 = FumocCodec.ansEncodeOrder1(new Uint8Array([128]));
const order1Meta = new TextEncoder().encode(JSON.stringify({
  length: 1, bits: 8, min: 0, max: 1, signed: true, delta: false, order: 1,
}));
const order1Splt = new Uint8Array(8 + 1 + encodedOrder1.tables.byteLength + 4 + order1Meta.byteLength + 4 + encodedOrder1.compressed.byteLength);
const order1View = new DataView(order1Splt.buffer);
order1View.setUint32(0, 1, true);
order1View.setUint32(4, 1, true);
order1Splt[8] = 1; // POS_X
let order1Offset = 9;
order1Splt.set(encodedOrder1.tables, order1Offset);
order1Offset += encodedOrder1.tables.byteLength;
order1View.setUint32(order1Offset, order1Meta.byteLength, true);
order1Offset += 4;
order1Splt.set(order1Meta, order1Offset);
order1Offset += order1Meta.byteLength;
order1View.setUint32(order1Offset, encodedOrder1.compressed.byteLength, true);
order1Offset += 4;
order1Splt.set(encodedOrder1.compressed, order1Offset);
const order1File = await FumocFormat.encode({ splatBuffer: order1Splt, meta: { title: 'order-1 fixture' } });
const order1Decoded = await FumocDecoder.decode(order1File);
assert.equal(order1Decoded.gaussians.N, 1, 'order-1 channel should decode one Gaussian');
assert.ok(Number.isFinite(order1Decoded.gaussians.posX[0]), 'order-1 position channel should decode to a finite value');

await assert.rejects(() => FumocDecoder.decode(new Uint8Array(10)), /14-byte header/,
  'short FUMOC files must fail before reading header fields');
const invalidHeader = new Uint8Array(14);
invalidHeader.set(new TextEncoder().encode('FUMOC1'), 0);
const invalidView = new DataView(invalidHeader.buffer);
invalidView.setUint16(8, 2, true);
invalidView.setUint32(10, 0xffffffff, true);
await assert.rejects(() => FumocDecoder.decode(invalidHeader), /Header length is invalid/,
  'FUMOC header lengths must be bounded');
await assert.rejects(() => FumocDecoder.decode(new Uint8Array(valid.slice(0, valid.byteLength - 1))),
  /truncated|Truncated/i, 'truncated sections must not be silently ignored');
assert.throws(() => FumocDecoder.toSplatBinary({ N: 0 }), /point count must be between 1/,
  'public SPLAT export must validate point count');

const originalDecompressionStream = globalThis.DecompressionStream;
class OversizedFakeDecompressionStream {
  constructor() {
    this.writable = new WritableStream({ write() {}, close() {} });
    this.readable = new ReadableStream({
      start(controller) {
        controller.enqueue({ byteLength: 512 * 1024 * 1024 + 1 });
        controller.close();
      },
    });
  }
}
try {
  globalThis.DecompressionStream = OversizedFakeDecompressionStream;
  const bomb = new Uint8Array(valid.slice(0));
  const bombView = new DataView(bomb.buffer);
  const headerLength = bombView.getUint32(10, true);
  bombView.setUint8(14 + headerLength + 4, 1);
  await assert.rejects(() => FumocDecoder.decode(bomb), /512 MiB safety limit/,
    'FUMOC decoder must cap decompressed sections');
  const worker = await readFile(new URL('../js/modules/fumoc-decoder-worker-module.js', import.meta.url), 'utf8');
  assert.match(worker, /MAX_GAUSSIANS = 5_000_000/, 'worker decoder must use the same point cap');
  assert.match(worker, /Decompressed section exceeds the 512 MiB safety limit/, 'worker decompression must be bounded');
  assert.match(worker, /Raw SPLT payload must contain complete 32-byte rows/, 'worker must reject partial raw SPLAT rows');
} finally {
  globalThis.DecompressionStream = originalDecompressionStream;
}
console.log('FUMOC decoder and worker bounds passed.');
