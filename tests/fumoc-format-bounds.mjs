import assert from 'node:assert/strict';
import FumocFormat from '../js/modules/fumoc-format.js';

const splat = new Uint8Array(32);
const valid = await FumocFormat.encode(splat, { title: 'FUMOC validation fixture' });
const decoded = await FumocFormat.decode(valid);
assert.equal(decoded.sections.SPLT.byteLength, 32);
assert.equal(decoded.header.splat_byte_length, 32);
assert.equal(FumocFormat.readHeader(valid).title, 'FUMOC validation fixture');

await assert.rejects(() => FumocFormat.decode(new Uint8Array(10)), /14-byte header/,
  'short files must be rejected before reading header fields');

const invalidHeader = new Uint8Array(14);
invalidHeader.set(new TextEncoder().encode('FUMOC1\0\0'), 0);
const invalidHeaderView = new DataView(invalidHeader.buffer);
invalidHeaderView.setUint16(8, 2, true);
invalidHeaderView.setUint32(10, 0xffffffff, true);
await assert.rejects(() => FumocFormat.decode(invalidHeader), /Header length is invalid/,
  'untrusted header lengths must be bounded');

const truncated = new Uint8Array(valid.slice(0, valid.byteLength - 1));
await assert.rejects(() => FumocFormat.decode(truncated), /truncated|Trailing bytes/i,
  'truncated sections must not be silently ignored');

const wrongLength = new Uint8Array(valid.slice(0));
const wrongView = new DataView(wrongLength.buffer);
const headerLength = wrongView.getUint32(10, true);
const spltOffset = 14 + headerLength;
wrongView.setUint32(spltOffset + 9, 31, true);
await assert.rejects(() => FumocFormat.decode(wrongLength), /mismatched lengths/,
  'uncompressed section lengths must match the payload');

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
  const bombHeaderLength = bombView.getUint32(10, true);
  bombView.setUint8(14 + bombHeaderLength + 4, 1); // Mark SPLT as compressed.
  await assert.rejects(() => FumocFormat.decode(bomb), /512 MiB safety limit/,
    'compressed sections must be capped before accumulation');
  assert.equal(await FumocFormat.thumbnailURL(valid), null,
    'thumbnail lookup must skip decompression of the large SPLT section');
} finally {
  globalThis.DecompressionStream = originalDecompressionStream;
}
console.log('FUMOC header, section, decompression and thumbnail bounds passed.');
