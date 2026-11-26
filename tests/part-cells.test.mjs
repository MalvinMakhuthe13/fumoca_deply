import assert from 'node:assert/strict';
import { cellsFromIndices, cellMembers, partMembers, normalizePart } from '../js/modules/part-animator.js';
import { selectVisibleScreenPoints } from '../js/modules/screen-space-selection.js';

// An angled "car side": near wall z=+0.9 with a door patch, far wall z=-0.9, rotated 20°.
let seed = 11; const R = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const P = [], tag = [];
for (let i = 0; i < 40000; i++) { const x = R() * 4 - 2, y = R() * 1.4; P.push(x, y, 0.9); tag.push(x > -1.7 && x < -0.7 && y > 0.2 && y < 1.2 ? 'door' : 'near'); }
for (let i = 0; i < 40000; i++) { P.push(R() * 4 - 2, R() * 1.4, -0.9); tag.push('far'); }
const a = 20 * Math.PI / 180, pos = new Float32Array(P.length);
for (let i = 0; i < P.length; i += 3) { const x = P[i], z = P[i + 2]; pos[i] = x * Math.cos(a) + z * Math.sin(a); pos[i + 1] = P[i + 1]; pos[i + 2] = -x * Math.sin(a) + z * Math.cos(a); }
const n = tag.length;

// 1. A part made from the door selection moves the door only — never the far side,
//    even though the door's axis-aligned box reaches across the car.
const doorIdx = []; tag.forEach((t, i) => { if (t === 'door' && R() < 0.4) doorIdx.push(i); });   // sparse selection
const cells = cellsFromIndices(pos, doorIdx);
const part = normalizePart({ id: 'd', name: 'Door', box: { min: [-9, -9, -9], max: [9, 9, 9] }, cells });
assert.ok(part.cells, 'cells survive normalizePart');
const m = partMembers(pos, n, part);
const count = { door: 0, near: 0, far: 0 }; for (const i of m) count[tag[i]]++;
const doorTotal = tag.filter(t => t === 'door').length;
assert.equal(count.far, 0, 'far side never in the part');
assert.ok(count.door > doorTotal * 0.95, 'fills the whole door from a sparse selection: ' + count.door + '/' + doorTotal);
assert.ok(count.near < doorTotal * 0.08, 'barely spills past the door edge: ' + count.near);
// survives a JSON round trip (saved with the asset)
const again = cellMembers(pos, n, JSON.parse(JSON.stringify(cells)));
assert.equal(again.length, m.length);

// 2. Selecting through a gappy front surface must not reach the far side when
//    footprints are used (splats are ellipses, not dots).
const W = 400, H = 300;
const project = i => {   // camera looking along -z (towards the far wall), orthographic-ish
  const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
  return { x: (x + 2) * 100, y: (1.4 - y) * 100 + 80, depth: 5 - z };
};
// thin out the near wall so its centres leave gaps on screen
const alive = i => tag[i] !== 'near' && tag[i] !== 'door' ? true : (i % 6 === 0);
const inDoor = (x, y) => x > 30 && x < 130 && y > 100 && y < 200;
const dots = selectVisibleScreenPoints({ count: n, isAlive: alive, project, contains: inDoor, cellSize: 4, depthTolerance: 0.02 });
const foot = selectVisibleScreenPoints({ count: n, isAlive: alive, project, contains: inDoor, cellSize: 4, depthTolerance: 0.02, width: W, height: H, radius: () => 6 });
const far = idx => idx.filter(i => tag[i] === 'far').length;
assert.ok(far(dots) > 0, 'without footprints the far side leaks (sanity check of the test)');
assert.equal(far(foot), 0, 'with footprints nothing on the far side is selected');
assert.ok(foot.filter(i => tag[i] === 'door').length > 0, 'the door itself is still selected');
console.log('part cells + front-surface selection: all checks passed');
