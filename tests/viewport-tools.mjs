import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../edit.html', import.meta.url), 'utf8');
const toolbar = html.match(/const toolMap = \{([\s\S]*?)\n\};/);
assert.ok(toolbar, 'toolbar mode map must exist');
const toolIds = [...toolbar[1].matchAll(/(tool[A-Za-z]+):\s*'([^']+)'/g)];
assert.ok(toolIds.length >= 12, 'expected navigation, selection and transform tools');
for (const [, id] of toolIds) assert.match(html, new RegExp('id="' + id + '"'), id + ' button must exist');
assert.match(html, /Object\.entries\(toolMap\)\.forEach\(\(\[id, mode\]\) => \{[\s\S]*?addEventListener\('click', \(\) => setMode\(mode\)\)/);
for (const mode of ['orbit','pan','move','rotate','scale-tool','measure']) assert.match(html,new RegExp('data-hud-mode="' + mode + '"'));
assert.match(html,/querySelectorAll\('\[data-hud-mode\]'\)[\s\S]*?setMode\(button\.dataset\.hudMode\)/);
for (const view of ['front','side','top']) assert.match(html,new RegExp('data-hud-view="' + view + '"'));
assert.match(html,/querySelectorAll\('\[data-hud-view\]'\)[\s\S]*?camera\.position\.copy\(target\)[\s\S]*?controls\.update\(\)/);
assert.match(html,/const canTransform = S\.transformScope === 'scene' \? count > 0 : selectedCount > 0/);
assert.match(html,/const useSelection = S\.transformScope === 'selection'/);
assert.match(html,/if \(!S\.alive\[i\] \|\| \(useSelection && !S\.selected\[i\]\)\) continue/);
assert.match(html,/function _gizmoCollectIndices\(\)[\s\S]*?const useSelection = S\.transformScope === 'selection'[\s\S]*?if \(useSelection && !selectedPointCount\(\)\) return indices[\s\S]*?if \(useSelection && !\(S\.selected && S\.selected\[i\]\)\) continue[\s\S]*?indices\.push\(i\)/);
assert.match(html,/function beginGizmoGesture\(\)[\s\S]*?const indices = _gizmoCollectIndices\(\)/);
assert.match(html,/Nothing selected\. Select points or switch scope to Whole scene/);
assert.match(html,/if \(\(S\.mode === 'pan' \|\| S\.mode === 'zoom-tool'\)[\s\S]*?camera\.position\.add\(delta\)[\s\S]*?camera\.position\.copy\(controls\.target\)\.add\(offset\)/);
assert.match(html,/controls\.enabled = mode === 'orbit'/);
assert.match(html,/transformScope: 'selection'/);
assert.match(html,/data-transform-scope="selection"/);
assert.match(html,/data-transform-scope="scene"/);
assert.match(html,/const canTransform = S\.transformScope === 'scene'/);
assert.match(html,/Transforming the whole splat\. Every live point will change\./);

// Save/reopen integrity: exported rows must be encoded from the live editor buffers,
// not copied from the original source buffer after transforms have been applied.
assert.match(html,/function _encodeSplatRows\(indices\)[\s\S]*?S\.positions\[i \* 3 \+ c\][\s\S]*?S\.scaleXYZ\?\.\[i \* 3 \+ c\][\s\S]*?_rotationAt\(i\)/);
assert.match(html,/window\.saveLiveEdit = async function saveLiveEdit\(extra = \{\}\)[\s\S]*?rowBytes = _encodeSplatRows\(aliveIdx\)/);
assert.match(html,/const savedBlob = hasSh \? _encodeGaussianPly\(aliveIdx\) : new Blob\(\[encodeNif\([\s\S]*?sourceBuffer: rowBytes/);
assert.match(html,/\.from\('nif-files'\)[\s\S]*?\.upload\(path, savedBlob/);
assert.match(html,/\.from\('nif_files'\)[\s\S]*?\.update\(\{ r2_key: fileKey, gaussian_count: aliveCount, meta \}\)/);
assert.match(html,/if \(savedToNifFiles\) return true/);

// Reopen must trust the freshly fetched nif_files row and its current immutable
// R2 object, not a stale URL or cached in-memory r2_key from before the save.
assert.match(html,/window\._fumocaCurrentRecord = \{ \.\.\.\(window\._fumocaCurrentRecord \|\| \{\}\), \.\.\.data \}/);
assert.match(html,/if \(data\.r2_key\) \{[\s\S]*?fileUrl = client\.publicUrl\('nif-files', data\.r2_key\)/);
assert.match(html,/else if \(!fileUrl\) \{[\s\S]*?fileUrl = data\.output_url \|\| data\.nif_url \|\| data\.splat_url/);


console.log('Viewport toolbar contract passed: navigation, HUD modes, camera views, transforms, pan and zoom.');
