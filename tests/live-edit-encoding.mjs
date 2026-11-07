import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../edit.html', import.meta.url), 'utf8');

function extractFunction(name, nextName) {
  const start = html.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist in Studio`);
  const end = html.indexOf(`function ${nextName}(`, start);
  assert.notEqual(end, -1, `expected ${nextName} after ${name}`);
  return html.slice(start, end).trim();
}

const colorFn = extractFunction('_splatColorAt', '_rotationAt');
const rotationFn = extractFunction('_rotationAt', '_encodeSplatRows');
const encodeFn = extractFunction('_encodeSplatRows', '_encodeGaussianPly');
const makeEncoder = new Function('S', 'clamp', `${colorFn}\n${rotationFn}\n${encodeFn}\nreturn _encodeSplatRows;`);

const S = {
  positions: new Float32Array([12.5, -3.25, 8.75, 100, 100, 100]),
  scaleXYZ: new Float32Array([0.25, 0.5, 0.75, 1, 1, 1]),
  scale: new Float32Array([0.4, 1]),
  colors: new Float32Array([0.1, 0.2, 0.3, 0.9, 0.8, 0.7]),
  paintColors: new Float32Array([-1, 0.65, -1, -1, -1, -1]),
  opacity: new Float32Array([0.42, 1]),
  rotation: new Float32Array([0, 0, Math.SQRT1_2, Math.SQRT1_2, 0, 0, 0, 1]),
};
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const encode = makeEncoder(S, clamp);
const bytes = encode([0]);
assert.equal(bytes.byteLength, 32, 'one live splat must encode to one 32-byte row');

const view = new DataView(bytes.buffer);
assert.deepEqual(
  [0, 1, 2].map(c => view.getFloat32(c * 4, true)),
  [12.5, -3.25, 8.75],
  'saved row must use transformed live positions, not the original source buffer',
);
assert.deepEqual(
  [0, 1, 2].map(c => view.getFloat32(12 + c * 4, true)),
  [0.25, 0.5, 0.75],
  'saved row must preserve independent live XYZ scales',
);
assert.deepEqual(
  [24, 25, 26, 27].map(i => bytes[i]),
  [26, 166, 77, 107],
  'saved row must include live paint override, source colors and opacity',
);
assert.deepEqual(
  [28, 29, 30, 31].map(i => bytes[i]),
  [128, 128, 219, 219],
  'saved row must include normalized live rotation',
);

// The persistence path must encode from the current editor buffers before upload.
assert.match(html, /rowBytes = _encodeSplatRows\(aliveIdx\)/);
assert.match(html, /sourceBuffer: rowBytes[\s\S]*?rowSize: 32/);
assert.match(html, /\.upload\(path, savedBlob/);
console.log('Live edit encoding passed: transformed position, XYZ scale, color, opacity and rotation are persisted.');
