import assert from 'node:assert/strict';
import { gzipDecompress, gzipCompress, NIFWriter, NIFReader, CHUNK } from '../engine-next/format/NIFSpec.js';

// 1. A zip bomb chunk is refused instead of expanding without limit.
const zeros = new Uint8Array(8 * 1024 * 1024);           // 8 MiB of zeros → a few KB gzipped
const bomb = await gzipCompress(zeros);
assert.ok(bomb.length < 64 * 1024, 'bomb is tiny');
await assert.rejects(() => gzipDecompress(bomb, 1024 * 1024), /refusing to decode/);
const ok = await gzipDecompress(bomb);                    // default cap is far above real chunks
assert.equal(ok.length, zeros.length);

// 2. Garbage after the header never throws out of the reader.
const junk = new Uint8Array(4096); junk.set([0x4e, 0x49, 0x46, 0x00, 1, 0]);
for (let i = 256; i < junk.length; i++) junk[i] = (i * 7919) & 255;
const r = new NIFReader(junk);
assert.ok(Array.isArray(r.chunks));
assert.throws(() => new NIFReader(new Uint8Array(10)), /Too short/);
console.log('nif-hardening: all tests passed');
