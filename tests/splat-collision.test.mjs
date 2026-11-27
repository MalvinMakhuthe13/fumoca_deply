import assert from 'node:assert/strict';
import { voxelize, samplePoints, backOff, dropDistance, touches } from '../js/modules/splat-collision.js';

let seed = 4; const R = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const cube = (c, s, n, P) => { const start = P.length / 3; for (let i = 0; i < n; i++) { const f = Math.floor(R() * 6), u = R() - 0.5, v = R() - 0.5, p = [0, 0, 0], ax = f >> 1, o = [0, 1, 2].filter(k => k !== ax); p[ax] = (f & 1 ? 0.5 : -0.5); p[o[0]] = u; p[o[1]] = v; P.push(c[0] + p[0] * s, c[1] + p[1] * s, c[2] + p[2] * s); } return [...Array(n).keys()].map(k => start + k); };
const P = [];
const table = cube([0, 0.5, 0], 1, 20000, P);           // a 1 m block, top at y = 1
const box = cube([0, 2, 0], 0.4, 6000, P);              // a 0.4 m box floating above it
const pos = Float32Array.from(P), cell = 0.03;
const vox = voxelize(pos, table, cell);

// 1. drop: the box falls from y = 1.8 (its bottom) and rests on the block's top (y = 1)
const pts = samplePoints(pos, box);
const fall = dropDistance(pts, vox, 0);
assert.ok(Math.abs(fall - 0.8) < 0.04, 'box drops onto the block: fell ' + fall.toFixed(3));
// with nothing below it lands on the floor
const fallFloor = dropDistance(samplePoints(pos, box), { cell, set: new Set() }, 0);
assert.ok(Math.abs(fallFloor - 1.8) < 1e-6, 'lands on the floor: ' + fallFloor);

// 2. a move that pushes the box into the block stops at contact
const moved = Float32Array.from(pts);
const delta = [0, -1.3, 0];   // would sink 0.5 m into the block
for (let i = 1; i < moved.length; i += 3) moved[i] += delta[1];
assert.ok(touches(moved, vox), 'the move pushes it in');
const f = backOff(moved, vox, delta);
const kept = f * delta[1];
assert.ok(Math.abs(kept + 0.8) < 0.04, 'keeps the move up to contact: moved ' + kept.toFixed(3));
// 3. a move that doesn't collide is kept whole
const side = Float32Array.from(pts); for (let i = 0; i < side.length; i += 3) side[i] += 2;
assert.equal(backOff(side, vox, [2, 0, 0]), 1);
// 4. a sparse scan (about one splat per voxel on its skin) is still filled solid
const P2 = []; const sparse = cube([5, 0.5, 0], 1, 8000, P2); const pos2 = Float32Array.from(P2);
const v2 = voxelize(pos2, sparse, 0.04);
assert.ok(v2.set.size > 0.8 * 25 ** 3, 'sparse block filled inside: ' + v2.set.size + ' voxels');
console.log('splat collision (voxels, drop, stop at contact): all checks passed');
