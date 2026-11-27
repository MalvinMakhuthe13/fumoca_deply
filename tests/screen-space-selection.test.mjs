import assert from 'node:assert/strict';
import { selectVisibleScreenPoints } from '../js/modules/screen-space-selection.js';
// a solid surface at depth 2 (with 1 cm thickness), faint haze at depth 1.5 in front,
// and a solid wall behind at depth 4
const pts = [];
for (let i = 0; i < 400; i++) pts.push({ x: (i % 20) * 2, y: Math.floor(i / 20) * 2, depth: 2 + (i % 3) * 0.005, op: 0.9, kind: 'cap' });
for (let i = 0; i < 100; i++) pts.push({ x: (i % 10) * 4, y: Math.floor(i / 10) * 4, depth: 1.5, op: 0.1, kind: 'haze' });
for (let i = 0; i < 400; i++) pts.push({ x: (i % 20) * 2, y: Math.floor(i / 20) * 2, depth: 4, op: 0.9, kind: 'back' });
const sel = selectVisibleScreenPoints({ count: pts.length, isAlive: () => true, project: (i) => ({ ...pts[i], visible: true }), contains: () => true,
  cellSize: 4, depthTolerance: 0.025, isOccluder: (i) => pts[i].op >= 0.35 });
const by = (k) => sel.filter(i => pts[i].kind === k).length;
assert.equal(by('cap'), 400, 'whole surface selected through the haze');
assert.equal(by('back'), 0, 'what is behind stays unselected');
assert.equal(by('haze'), 100, 'haze in front comes along');
console.log('screen-space selection: all tests passed');
