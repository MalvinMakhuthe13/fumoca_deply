import assert from 'node:assert/strict';
import { regionFromPoints, regionMembers, findStrands, pickTransform, pickPhases, strandPull, inPoly } from '../js/modules/food-pick.js';
import { normalizePart, partTransform } from '../js/modules/part-animator.js';
let seed = 4; const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
// a pizza: disc radius 1, 0.04 thick; slice = wedge 0…45°
const P = [], slice = [];
for (let i = 0; i < 20000; i++) {
  const a = r() * Math.PI * 2, d = Math.sqrt(r());
  P.push(Math.cos(a) * d, r() * 0.04, Math.sin(a) * d);
  if (a < Math.PI / 4) slice.push(i);
}
const pos = Float32Array.from(P);
const region = regionFromPoints(pos, slice);
const members = regionMembers(pos, 20000, region);
const set = new Set(members);
const inSlice = slice.filter(i => set.has(i)).length / slice.length;
const outside = [...members].filter(i => !slice.includes(i)).length / members.length;
assert.ok(inSlice > 0.97 && outside < 0.06, `wedge outline: ${inSlice.toFixed(3)} in, ${outside.toFixed(3)} extra`);
// strands along the cut, strongest at the cut
const st = findStrands(pos, 20000, members, 0.15);
assert.ok(st.idx.length > 200, 'strands found: ' + st.idx.length);
assert.ok([...st.idx].every(i => !set.has(i)), 'strands are from the rest of the pizza');
assert.ok(Math.max(...st.w) > 0.8 && Math.min(...st.w) >= 0, 'weights 1 at the cut → 0 at the edge');
// stretch then let go
assert.equal(strandPull(0), 0); assert.ok(strandPull(0.5) > 0.99); assert.equal(strandPull(0.9), 0);
// the piece rises, pulls away, the far end droops
const m = { pivot: [0.9, 0.02, 0.35], dir: [0.92, 0, 0.38], lift: 0.5, distance: 0.4, angle: 10, droop: 0.4, size: 1 };
const tf = pickTransform(m, 1), held = tf.apply(m.pivot), tip = tf.apply([0.1, 0.02, 0.04]);
assert.ok(held[1] > 0.5 && held[0] > 0.9, 'held point rises and pulls away');
assert.ok(tip[1] < held[1] - 0.05, 'the tip droops below where it is held');
assert.deepEqual(pickPhases(0.1).lift, 0, 'utensil grips before the lift');
// saved part keeps food settings
const part = normalizePart({ id: 'p', box: { min: [0, 0, 0], max: [1, 0.04, 1] }, region, motion: { type: 'pick', pivot: m.pivot, dir: m.dir, lift: 0.5, distance: 0.4, angle: 10, droop: 0.4, stretch: 0.9, zone: 0.15, size: 1, utensil: 'chopsticks' } });
assert.equal(part.motion.type, 'pick'); assert.equal(part.motion.utensil, 'chopsticks'); assert.ok(part.region.poly.length >= 3);
assert.equal(normalizePart({ ...part, motion: { ...part.motion, utensil: '<script>' } }).motion.utensil, 'none');
assert.ok(Math.abs(partTransform(part, 1).apply(m.pivot)[1] - held[1]) < 1e-9, 'parts use the same motion');
console.log('food-pick: all tests passed');
