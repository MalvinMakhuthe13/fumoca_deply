import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const viewer = await readFile(new URL('../js/modules/viewer.js', import.meta.url), 'utf8');
const helper = await readFile(new URL('../js/modules/poster-live-transform.js', import.meta.url), 'utf8');
const sceneManager = await readFile(new URL('../js/modules/poster-scene-manager.js', import.meta.url), 'utf8');
const presentViewer = await readFile(new URL('../js/modules/present-viewer.js', import.meta.url), 'utf8');
const composer = await readFile(new URL('../js/modules/poster-composer.js', import.meta.url), 'utf8');

assert.match(viewer, /import \{ advancePosterMotionPhase, applyPosterLiveTransform, applyPosterMotionRotation, posterMotionSpeed \} from '\.\/poster-live-transform\.js';/);
assert.match(viewer, /const subjectMotion = \(subject\) => \{/,
  'Each Spark subject must resolve its own motion override or inherit the poster default');
assert.match(viewer, /const level = subject\?\.motion\?\.level \|\| defaultMotionLevel/,
  'Per-subject motion must fall back to the saved poster-wide motion level');
assert.match(viewer, /posterMotionPhases = new Map\(\)/,
  'Each subject must retain an independent motion phase');
assert.match(viewer, /applyPosterMotionRotation\(THREE, _publishedSparkGroup, mainMotion\.phase\)/,
  'The main Spark Gaussian subject must receive its own live motion phase');
assert.match(viewer, /applyPosterMotionRotation\(THREE, entry\.group, motion\.phase\)/,
  'Additional poster Gaussian subjects must receive their own live motion phase');
assert.match(sceneManager, /data-scene-motion/,
  'The scene manager must expose a per-object motion selector');
assert.match(composer, /motion: \['still', 'gentle', 'normal', 'dynamic'\]/,
  'The composition model must normalize per-object motion overrides');
assert.ok(composer.includes("new CustomEvent('fumoca:posterReady'"), 'Poster composer must announce when its public API is ready');
assert.ok(presentViewer.includes("addEventListener('fumoca:posterReady', tryApply)"), 'Public viewer must retry restoration when poster composer loads late');
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
assert.match(helper, /const depthOffset = \(layer - 1\) \* halfHeight \* 0\.01/);
assert.match(viewer, /object: \{ \.\.\.posterState\.composition\.object, z: mainSubject\?\.z \?\? 1 \}/, 'Main splat must receive its saved depth layer');
assert.match(viewer, /const subjectComposition = \{ \.\.\.posterState\.composition, object: subject \}/, 'Every additional splat must receive its own saved position, scale, rotation and depth layer');
assert.match(viewer, /composition: subjectComposition, enabled: !!posterState\.enabled/, 'Additional splats must apply their independent transforms in the live renderer');
assert.match(sceneManager, /dataset\.sceneAction = 'front'/);
assert.match(sceneManager, /dataset\.sceneAction = 'back'/);
assert.match(viewer, /Prefer Spark for Gaussian PLY/);
assert.match(viewer, /new SplatMesh\(\{ fileBytes: subjectBytes/);
assert.match(viewer, /meta\?\.view_ply_r2_key/);
assert.match(viewer, /decodeNif\(await response\.arrayBuffer\(\)\)/);
assert.match(viewer, /geometryToSplatRows\(decoded\.gaussians, \{ preserveScales: true \}\)/);
assert.match(viewer, /poster-subject-' \+ subject\.id \+ '\.splat/);
assert.match(viewer, /applyPosterLiveTransform\(\{[\s\S]*?group: entry\.group/);
assert.match(viewer, /mainSubject\?\.visible !== false/);
assert.match(sceneManager, /data-scene-load-assets/);
assert.match(sceneManager, /from\('nif_files'\)\.select\('id,title'\)/);
assert.match(sceneManager, /window\.FumocaPresent\?\.save\?\.\(\)/);


console.log('Poster viewer integration contract tests passed.');
