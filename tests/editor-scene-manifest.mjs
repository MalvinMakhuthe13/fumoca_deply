import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../edit.html', import.meta.url), 'utf8');
function extractFunction(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing ${name}`);
  const brace = html.indexOf('{', start);
  let depth = 0, quote = null, escaped = false, lineComment = false, blockComment = false, template = false;
  for (let i = brace; i < html.length; i++) {
    const ch = html[i], next = html[i + 1];
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; i++; } continue; }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '/' && next === '/') { lineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    if (ch === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error(`unterminated function ${name}`);
}
const source = [
  extractFunction('serializeEditorSceneMetadata'),
  extractFunction('restoreEditorSceneMetadata'),
  'return { serializeEditorSceneMetadata, restoreEditorSceneMetadata };'
].join('\n');
// Test compact remapping after deleted points and correct layer membership.
const S = {
  alive: Uint8Array.from([1, 0, 1, 1, 1]),
  layers: [
    { id: 'red', name: 'Red subject', icon: '🔴', visible: true, opacity: 0.75, mask: Uint8Array.from([1,1,1,0,0]) },
    { id: 'blue', name: 'Blue subject', icon: '🔵', visible: false, opacity: 0.4, mask: Uint8Array.from([0,0,0,1,1]) }
  ],
  activeLayerId: 'blue',
  layerHidden: Uint8Array.from([0,0,0,1,1])
};
// Execute helpers with isolated fixture state.
const bound = new Function('S', extractFunction('serializeEditorSceneMetadata') + '; return serializeEditorSceneMetadata;')(S);
const saved = bound([0,2,3,4]);
assert.equal(saved.version, 1);
assert.equal(saved.point_count, 4);
assert.equal(saved.active_layer_id, 'blue');
assert.deepEqual(saved.layers.map(x => x.point_indices), [[0,1],[2,3]]);
assert.equal(saved.layers[1].visible, false);
assert.equal(saved.layers[0].opacity, 0.75);

// Restore must bounds-check malformed indices and reconstruct typed masks.
const restoredState = { layers: [], activeLayerId: null, layerHidden: null, selected: null };
const restore = new Function('S', extractFunction('restoreEditorSceneMetadata') + '; return restoreEditorSceneMetadata;')(restoredState);
assert.equal(restore({ editor_scene: { version: 1, active_layer_id: 'red', layers: [
  { id: 'red', name: 'Red subject', point_indices: [0, 2, 999, -1, 1.5], visible: true, opacity: 1 },
  { id: 'empty', name: 'Empty', point_indices: [999], visible: true, opacity: 1 },
  null
]}}, 3), true);
assert.deepEqual(Array.from(restoredState.layers[0].mask), [1,0,1]);
assert.equal(restoredState.layers.length, 1);
assert.equal(restoredState.activeLayerId, 'red');
assert.deepEqual(Array.from(restoredState.layerHidden), [0,0,0]);
assert.deepEqual(Array.from(restoredState.selected), [0,0,0]);

const legacy = { layers: [], activeLayerId: null, layerHidden: null, selected: null };
const restoreLegacy = new Function('S', extractFunction('restoreEditorSceneMetadata') + '; return restoreEditorSceneMetadata;')(legacy);
assert.equal(restoreLegacy({}, 2), false);
console.log('Editor scene manifest tests passed: compact indices, visibility/opacity, bounded restore, empty/legacy manifests.');
