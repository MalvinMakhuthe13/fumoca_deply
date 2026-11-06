import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const viewer = await readFile(new URL('../js/modules/viewer.js', import.meta.url), 'utf8');
const helper = await readFile(new URL('../js/modules/poster-live-transform.js', import.meta.url), 'utf8');
const sceneManager = await readFile(new URL('../js/modules/poster-scene-manager.js', import.meta.url), 'utf8');

assert.match(viewer, /import \{ applyPosterLiveTransform \} from '\.\/poster-live-transform\.js';/);
assert.match(viewer, /import '\.\/poster-viewport\.js(?:\\?[^']*)?';/);
assert.match(viewer, /posterEnabled \? 0 : 1/);
assert.match(viewer, /_publishedSparkGroup\.add\(_publishedSparkMesh\)/);
assert.match(viewer, /group: _publishedSparkGroup, camera: _plyCamera/);
assert.match(viewer, /_legacyPosterGroup\.add\(pts\)/);
assert.match(viewer, /group: _legacyPosterGroup, camera: _plyCamera, center: c/);
assert.match(viewer, /const decodedPoints = new THREE\.Points\(geo, mat\)/);
assert.match(viewer, /_legacyPosterGroup\.add\(decodedPoints\)/);
assert.match(viewer, /center: \{ x: cx, y: cy, z: cz \}/);
assert.match(viewer, /window\.FumocaPoster\?\.getState\?\.\(\) \|\| _fumocaPosterStateCache/);
assert.match(helper, /group\.scale\.setScalar\(transform\.scale\)/);
assert.match(helper, /group\.quaternion\.setFromAxisAngle\(viewAxis, transform\.rotation\)/);
assert.match(viewer, /Prefer Spark for Gaussian PLY/);
assert.match(viewer, /new SplatMesh\(\{ fileBytes: subjectBytes/);
assert.match(viewer, /meta\?\.view_ply_r2_key/);
assert.match(viewer, /applyPosterLiveTransform\(\{[\s\S]*?group: entry\.group/);
assert.match(viewer, /mainSubject\?\.visible !== false/);
assert.match(sceneManager, /data-scene-load-assets/);
assert.match(sceneManager, /from\('nif_files'\)\.select\('id,title'\)/);
assert.match(sceneManager, /window\.FumocaPresent\?\.save\?\.\(\)/);


console.log('Poster viewer integration contract tests passed.');
