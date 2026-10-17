import assert from 'node:assert/strict';
import { compactGaussianSHSidecar, gaussianSHMetadata } from '../js/modules/nif-sh-sidecar.js';
import { readFile } from 'node:fs/promises';
import { encodeNif, decodeNif } from '../js/modules/nif-format.js';

const names = ['f_dc_0', 'f_dc_1', 'f_dc_2', ...Array.from({ length: 9 }, (_, i) => `f_rest_${i}`)];
const source = new Float32Array(3 * names.length);
for (let i = 0; i < source.length; i++) source[i] = i / 100;
const identity = compactGaussianSHSidecar({
  indices: [0, 1, 2], attributes: names, coefficients: source, pointCount: 3,
});
assert.strictEqual(identity.values, source, 'full ordered scenes should reuse the validated interleaved buffer without a second large allocation');
const compact = compactGaussianSHSidecar({
  indices: [2, 0], attributes: names, coefficients: source, pointCount: 3,
});
assert.equal(compact.degree, 1);
assert.equal(compact.pointCount, 2);
assert.equal(compact.coefficientCount, 12);
for (let j = 0; j < names.length; j++) {
  assert.equal(compact.values[j], source[2 * names.length + j], `retained point 2 coefficient ${j}`);
  assert.equal(compact.values[names.length + j], source[j], `retained point 0 coefficient ${j}`);
}
assert.deepEqual(gaussianSHMetadata(compact, names), {
  degree: 1, properties: names, coefficient_count: 12,
});

const roundTripRows = new Uint8Array(2 * 32);
const roundTripView = new DataView(roundTripRows.buffer);
for (let i = 0; i < 2; i++) {
  const o = i * 32;
  roundTripView.setFloat32(o, i === 0 ? 2 : 0, true);
  roundTripView.setFloat32(o + 4, 1, true);
  roundTripView.setFloat32(o + 8, -1, true);
  roundTripView.setFloat32(o + 12, 0.1, true);
  roundTripView.setFloat32(o + 16, 0.1, true);
  roundTripView.setFloat32(o + 20, 0.1, true);
  roundTripRows[o + 24] = 200; roundTripRows[o + 25] = 120;
  roundTripRows[o + 26] = 40; roundTripRows[o + 27] = 230;
  roundTripRows[o + 28] = 255; roundTripRows[o + 29] = 128;
  roundTripRows[o + 30] = 128; roundTripRows[o + 31] = 128;
}
const roundTripNif = encodeNif({
  sourceBuffer: roundTripRows, aliveIndices: [0, 1], rowSize: 32,
  gaussianSH: compact,
  meta: { gaussian_sh: gaussianSHMetadata(compact, names) },
});
const decodedRoundTrip = await decodeNif(roundTripNif);
assert.equal(decodedRoundTrip.gaussianSH.pointCount, 2);
assert.equal(decodedRoundTrip.gaussianSH.coefficientCount, names.length);
assert.deepEqual(Array.from(decodedRoundTrip.gaussianSH.values), Array.from(compact.values));
assert.deepEqual(decodedRoundTrip.meta.gaussian_sh.properties, names);

const shChunks = decodedRoundTrip.reader.chunks.filter(chunk => chunk.type === 0x001A);
assert.equal(shChunks.length, 1);
const noDuplicateSH = encodeNif({
  sourceBuffer: roundTripRows, aliveIndices: [0, 1], rowSize: 32,
  gaussianSH: compact,
  meta: { gaussian_sh: gaussianSHMetadata(compact, names) },
  passthroughChunks: shChunks,
});
const noDuplicateSHDecoded = await decodeNif(noDuplicateSH);
assert.equal(noDuplicateSHDecoded.reader.chunks.filter(chunk => chunk.type === 0x001A).length, 1,
  'explicit SH encoding must replace, not duplicate, the passthrough sidecar');
const droppedSH = encodeNif({
  sourceBuffer: roundTripRows, aliveIndices: [0, 1], rowSize: 32,
  gaussianSH: undefined,
  meta: { title: 'sidecar intentionally dropped' },
  passthroughChunks: shChunks,
});
const droppedSHDecoded = await decodeNif(droppedSH);
assert.equal(droppedSHDecoded.reader.chunks.filter(chunk => chunk.type === 0x001A).length, 0,
  'explicitly omitted SH data must not reattach a stale passthrough sidecar');


const objectValues = Object.fromEntries(names.map((name, j) => [
  name, Float32Array.from([j + 0.1, j + 1.1, j + 2.1]),
]));
const fromObject = compactGaussianSHSidecar({
  indices: [1], attributes: names, coefficients: objectValues, pointCount: 3,
});
for (let j = 0; j < names.length; j++) assert.equal(fromObject.values[j], objectValues[names[j]][1]);

const paintColors = new Float32Array([-1, -1, -1, 0.8, -1, -1, -1, -1, -1]);
const colors = new Float32Array([0.2, 0.3, 0.4, 0.1, 0.2, 0.3, 0.5, 0.6, 0.7]);
const painted = compactGaussianSHSidecar({
  indices: [1], attributes: names, coefficients: source, pointCount: 3,
  paintColors, colors,
});
assert.ok(Math.abs(painted.values[0] - ((0.8 - 0.5) / 0.28209479177387814)) < 1e-6);
assert.ok(Math.abs(painted.values[1] - ((0.2 - 0.5) / 0.28209479177387814)) < 1e-6);
assert.ok(Math.abs(painted.values[2] - ((0.3 - 0.5) / 0.28209479177387814)) < 1e-6);
assert.ok(painted.values.slice(3).every(value => value === 0), 'painting a point clears higher-order SH bands');

assert.throws(() => compactGaussianSHSidecar({
  indices: [0], attributes: names.filter(name => name !== 'f_rest_2'),
  coefficients: source, pointCount: 3,
}), /unsupported or non-contiguous/);
assert.throws(() => compactGaussianSHSidecar({
  indices: [0], attributes: names, coefficients: null, pointCount: 3,
}), /coefficient values are unavailable/);
assert.throws(() => compactGaussianSHSidecar({
  indices: [], attributes: names, coefficients: source, pointCount: 3,
}), /invalid source point count or compact index/);
assert.throws(() => compactGaussianSHSidecar({
  indices: [1, 1], attributes: names, coefficients: source, pointCount: 3,
}), /invalid source point count or compact index/);
const bad = source.slice();
bad[0] = Number.NaN;
assert.throws(() => compactGaussianSHSidecar({
  indices: [0], attributes: names, coefficients: bad, pointCount: 3,
}), /non-finite coefficient/);
assert.throws(() => gaussianSHMetadata(compact, ['f_dc_0', 'f_dc_1', 'f_dc_2']),
  /metadata does not match/);

const editor = await readFile(new URL('../edit.html', import.meta.url), 'utf8');
assert.match(editor, /import \{ compactGaussianSHSidecar, gaussianSHMetadata \} from '\.\/js\/modules\/nif-sh-sidecar\.js';/,
  'Studio must use the tested SH compaction helper');
assert.equal((editor.match(/parsed\.shCoefficients = decoded\.gaussianSH\.values;/g) || []).length, 2,
  'both opening NIF and Add Splat must restore SH coefficients into live editor state');
assert.match(editor, /gaussianSH: gaussianSH \|\| undefined/,
  'NIF export must write a compacted SH sidecar instead of silently dropping it');
assert.match(editor, /S\.nifPassthroughChunks = decoded\.reader\.chunks\.filter\(chunk =>[\s\S]*?CHUNK\.KEYFRAME_MESH && S\.nifMesh/,
  're-encoded point-indexed chunks must not be duplicated, while undecoded raw mesh chunks remain preserved');
assert.match(editor, /if \(\(S\.nifMeta\?\.gaussian_sh \|\| window\._fumocaCurrentRecord\?\.meta\?\.gaussian_sh\) && !gaussianSH\)/,
  'save must fail closed if either live or saved-record metadata claims SH but coefficient data is unavailable');

console.log('Studio Gaussian SH compaction, filtering, paint invalidation, metadata and editor wiring tests passed.');
