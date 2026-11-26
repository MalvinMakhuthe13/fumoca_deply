import assert from 'node:assert/strict';
import { normalizeTour, detectFloor, isFloorPoint, standingSpotFor, normalizeStop } from '../js/modules/tour-mode.js';
let seed = 5; const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
// a room 6 × 4 m, 2.6 m high, floor at y = 0.3 (scan units), with a sofa and some haze
const P = [], O = [];
const add = (x, y, z, o = 0.9) => { P.push(x, y, z); O.push(o); };
for (let i = 0; i < 30000; i++) add(r() * 6, 0.3, r() * 4);                 // floor
for (let i = 0; i < 20000; i++) add(r() * 6, 2.9, r() * 4);                 // ceiling
for (let i = 0; i < 30000; i++) { const w = r() < 0.5; add(w ? (r() < 0.5 ? 0 : 6) : r() * 6, 0.3 + r() * 2.6, w ? r() * 4 : (r() < 0.5 ? 0 : 4)); }  // walls
for (let i = 0; i < 4000; i++) add(2 + r() * 2, 0.3 + r() * 0.8, 1 + r() * 0.9);   // sofa
for (let i = 0; i < 3000; i++) add(r() * 10 - 2, r() * 8 - 3, r() * 10 - 3, 0.05);  // haze below and above
const pos = Float32Array.from(P), alive = new Uint8Array(pos.length / 3).fill(1), op = Float32Array.from(O);
const f = detectFloor(pos, alive, op);
assert.ok(Math.abs(f.floorY - 0.3) < 0.05, 'floor found: ' + f.floorY);
assert.ok(Math.abs(f.ceilingY - 2.9) < 0.05, 'ceiling found: ' + f.ceilingY);
assert.ok(Math.abs(f.eyeHeight - 1.56) < 0.1, 'eye ≈ 1.6 m: ' + f.eyeHeight);
const t = normalizeTour({ enabled: true, ...f, stops: [{ position: [1, 0.3, 1], name: 'Door' }, { position: [1, 2] }], start: 'walk' });
assert.equal(t.stops.length, 1); assert.equal(t.start, 'walk');
assert.equal(isFloorPoint([3, 0.32, 2], t), true); assert.equal(isFloorPoint([0, 1.5, 2], t), false);
const stand = standingSpotFor([0, 1.5, 2], [3, 1.9, 2], t);
assert.ok(stand[0] > 0.3 && stand[0] < 3 && stand[1] === t.floorY, 'stands back from the wall on the floor: ' + stand);
assert.equal(normalizeStop({ position: [0, 0, 0], pitch: 9 }).pitch, 1.4);
assert.equal(normalizeTour(null), null);
console.log('tour-mode: all tests passed');
