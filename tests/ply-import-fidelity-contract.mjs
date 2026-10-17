import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../js/modules/upload-page.js', import.meta.url), 'utf8');
assert.match(source, /const gaussianGeometry = new Float32Array\(count \* 14\)/, 'Gaussian PLY import must map into canonical NIF geometry directly');
assert.match(source, /if \(count > 5_000_000\) throw new Error\('This PLY exceeds the 5-million-point browser conversion safety limit/, 'PLY count must be capped before allocating geometry arrays');
assert.match(source, /if \(gaussianCount > 5_000_000\) throw new Error\('This \.splat exceeds the 5-million-Gaussian browser conversion safety limit/, 'SPLAT count must be capped before allocating alive-index arrays');
assert.match(source, /gaussianGeometry\[o \+ 3\] = logSx/, 'Gaussian log-scales must be retained before compression');
assert.match(source, /requiresRawScalePreservation = true/, 'out-of-range log-scales must trigger a lossless raw geometry fallback');
assert.match(source, /compress: !requiresRawScalePreservation/, 'NIF import must not silently clamp out-of-range Gaussian scales');
assert.match(source, /gaussianSH: \{[\s\S]*?values: gaussianSHValues/, 'exact DC and higher-order SH values must be stored in the sidecar');
assert.match(source, /discarded_attributes: \[\]/, 'Gaussian PLY import must not report preserved SH coefficients as discarded');
assert.match(source, /if \(shMetadata\.hasUnsupportedShLayout\)[\s\S]*?refuses to discard them/, 'unsupported SH layouts must fail closed instead of silently losing data');
console.log('Gaussian PLY fidelity and raw-scale fallback contracts passed.');
