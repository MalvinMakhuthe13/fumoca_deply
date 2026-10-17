import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const camera = await readFile(new URL('../js/modules/camera-paths.js', import.meta.url), 'utf8');
assert.match(camera, /escapeHtml\(b\.name \|\| 'Angle '/, 'persisted camera bookmark names must be escaped');
assert.match(camera, /data-go="\$\{escapeHtml\(b\.id\)\}"/, 'bookmark IDs must be escaped in HTML attributes');
assert.match(camera, /data-del="\$\{escapeHtml\(b\.id\)\}"/, 'delete IDs must be escaped in HTML attributes');

const timeline = await readFile(new URL('../js/modules/studio-timeline.js', import.meta.url), 'utf8');
assert.match(timeline, /escapeHtml\(st\.step_label \|\| 'Keyframe '/, 'persisted timeline labels must be escaped');
assert.match(timeline, /Number\(st\.time_offset \|\| 0\)\.toFixed\(1\)/, 'timeline timestamps must be normalized before formatting');

const player = await readFile(new URL('../sdk/fumoc-player.js', import.meta.url), 'utf8');
const start = player.indexOf('_setStatus(msg,pct){');
const end = player.indexOf('_hideOverlay(){', start);
assert.ok(start >= 0 && end > start, 'FUMOC status renderer must exist');
const status = player.slice(start, end);
assert.match(status, /message\.textContent=String\(msg \?\? ''\)/, 'SDK status messages must be rendered as text');
assert.match(status, /replaceChildren\(\.\.\.nodes\)/, 'SDK status renderer must use DOM nodes');
assert.doesNotMatch(status, /innerHTML/, 'SDK status renderer must not interpret messages as HTML');
assert.match(status, /Math\.max\(0,Math\.min\(100,numeric\)\)/, 'progress width must be clamped to 0–100%');
console.log('Camera path, timeline and SDK status injection guards passed.');
