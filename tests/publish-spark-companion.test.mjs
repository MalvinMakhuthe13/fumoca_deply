import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [studio, publish, spark] = await Promise.all([
  readFile(new URL('../edit.html', import.meta.url), 'utf8'),
  readFile(new URL('../js/modules/publish-to-fumoca.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/modules/spark-gaussian-view.js', import.meta.url), 'utf8'),
]);

// A legacy .splat can be rendered by Spark, but Spark's editor export bridge
// only round-trips binary Gaussian PLY. Publishing must encode the current
// live Studio arrays (and filter deleted splats) into a Gaussian PLY instead.
assert.match(studio, /window\.exportGaussianPlyForPublish\s*=\s*async\s*\(\)\s*=>/);
assert.match(studio, /for\s*\(let i = 0; i < S\.alive\.length; i\+\+\) if \(S\.alive\[i\]\) indices\.push\(i\)/);
assert.match(studio, /_encodeGaussianPly\(indices\)\.arrayBuffer\(\)/);
assert.match(publish, /const isLegacySplat = window\.S\?\.fileType === 'splat' \|\| sourceName\.endsWith\('\.splat'\)/);
assert.match(publish, /else if \(isLegacySplat\)/);
assert.match(publish, /window\.exportGaussianPlyForPublish\?\.\(\)/);
assert.match(publish, /if \(sourcePlyBytes && \(isGaussianPly \|\| isLegacySplat\)\)/);

// Ordinary point-cloud PLYs are not Gaussian PLYs. They must not be registered
// as Spark companions simply because their filename ends in .ply.
assert.doesNotMatch(publish, /isGaussianPly \|\| sourceName\.endsWith\('\.ply'\)/);
assert.match(publish, /if \(!viewPlyKey && payload\.meta\) \{/);
assert.match(publish, /delete payload\.meta\.view_ply_r2_key/);
assert.match(publish, /Legacy \.splat source\. Encode the live editor arrays/);
assert.match(publish, /const buf = encodeNif\(\{ positions, colors01, opacities01, scalesLinear, quats, meta, vertical, passthroughChunks/);
assert.doesNotMatch(publish, /sourceBuffer: new Uint8Array\(S\.sourceBuffer\)/);
assert.match(spark, /Explicit Studio paint overrides must reach the published Spark PLY/);
assert.match(spark, /state\.paintColors\?\.\[i\*3\+axis\]/);
assert.match(spark, /f_rest_/);
console.log('Spark companion publish contract passed: edited .splat conversion, deleted-point filtering, and non-Gaussian PLY exclusion.');
