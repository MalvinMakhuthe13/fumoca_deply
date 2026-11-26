import assert from 'node:assert/strict';
import { PartAnimator, normalizeParts, partTransform, suggestHinge, partMembers } from '../js/modules/part-animator.js';

class V3 { set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } }
class Q4 { set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; return this; } }
class C3 { setRGB(r, g, b) { this.r = r; this.g = g; this.b = b; return this; } }
const THREE = { Vector3: V3, Quaternion: Q4, Color: C3 };
globalThis.requestAnimationFrame ??= (f) => setTimeout(() => f(performance.now()), 4);
globalThis.cancelAnimationFrame ??= (id) => clearTimeout(id);

// a "car": body block + a door panel on the +z side (x 0..1, y 0..1, z = 1)
const rows = [];
for (let i = 0; i < 2000; i++) rows.push({ c: [Math.random() * 2 - 1, Math.random(), Math.random() * 0.9], s: [0.02, 0.02, 0.02], q: [0, 0, 0, 1], a: 0.9, col: [0.4, 0.4, 0.4] });
const doorStart = rows.length;
for (let i = 0; i < 400; i++) rows.push({ c: [(i % 20) / 20, Math.floor(i / 20) / 20, 1.0], s: [0.02, 0.02, 0.002], q: [0, 0, 0, 1], a: 0.9, col: [0.8, 0.1, 0.1] });
const mesh = { packedSplats: { numSplats: rows.length,
  forEachSplat(cb) { rows.forEach((r, i) => cb(i, { x: r.c[0], y: r.c[1], z: r.c[2] }, { x: r.s[0], y: r.s[1], z: r.s[2] }, { x: r.q[0], y: r.q[1], z: r.q[2], w: r.q[3] }, r.a, { r: r.col[0], g: r.col[1], b: r.col[2] })); },
  setSplat(i, c, s, q, a, col) { rows[i] = { c: [c.x, c.y, c.z], s: [s.x, s.y, s.z], q: [q.x, q.y, q.z, q.w], a, col: [col.r, col.g, col.b] }; } } };

const doorBox = { min: [-0.01, -0.01, 0.98], max: [1.0, 1.0, 1.02] };
const hinge = suggestHinge(doorBox, 'left');
assert.deepEqual(hinge.axis, [0, 1, 0]); assert.ok(Math.abs(hinge.pivot[0] + 0.01) < 1e-9);
const parts = normalizeParts([{ id: 'door', name: 'Driver door', box: doorBox, motion: { type: 'hinge', ...hinge, angle: -90, duration: 0.15 } },
  { id: 'drawer', name: 'Drawer', box: { min: [5, 5, 5], max: [6, 6, 6] }, motion: { type: 'slide', axis: [0, 0, 2], distance: 0.5 } },
  { name: 'bad', box: { min: [0, 0, 'x'], max: [1, 1, 1] } }]);
assert.equal(parts.length, 2, 'invalid part dropped');
assert.deepEqual(parts[1].motion.axis, [0, 0, 1], 'axis normalised');

const anim = new PartAnimator(THREE, mesh, parts);
assert.equal(anim.list().find(p => p.id === 'door').members, 400, 'door region holds exactly the door splats');
const far = rows[doorStart + 19].c.slice();   // far edge of the door from the hinge
await anim.run('door', 'open');
const opened = rows[doorStart + 19].c;
// swung 90° about the vertical hinge at x≈0: the far edge now sticks out along +z
assert.ok(Math.abs(opened[0] - (-0.01)) < 0.02 && opened[2] > 1.9, 'door swung open on its hinge: ' + opened.map(v => v.toFixed(2)));
assert.ok(Math.abs(Math.abs(rows[doorStart + 19].q[1]) - Math.SQRT1_2) < 1e-6, 'door splats rotate with it');
assert.ok(rows.slice(0, doorStart).every((r, i) => r.c[2] <= 0.9 + 1e-9), 'body untouched');
assert.equal(anim.list().find(p => p.id === 'door').open, true);
await anim.run('door');                           // toggle → closed
assert.ok(rows[doorStart + 19].c.every((v, k) => Math.abs(v - far[k]) < 1e-6), 'closed again exactly');

// twist: cap rotates and lifts
const cap = normalizeParts([{ id: 'cap', box: { min: [0, 0, 0], max: [1, 1, 1] }, motion: { type: 'twist', pivot: [0.5, 0, 0.5], axis: [0, 1, 0], angle: -360, lift: 0.3 } }])[0];
const tf = partTransform(cap, 1);
const p1 = tf.apply([1, 0.5, 0.5]);
assert.ok(Math.abs(p1[0] - 1) < 1e-9 && Math.abs(p1[1] - 0.8) < 1e-9, 'full turn returns around and lifts 0.3');
// slide
const slide = partTransform(parts[1], 1).apply([0, 0, 0]);
assert.deepEqual(slide.map(v => +v.toFixed(6)), [0, 0, 0.5]);
assert.equal(partMembers(new Float32Array([0.5, 0.5, 1, 3, 3, 3]), 2, parts[0]).length, 1);

// lighting re-applies would reset positions → parts put themselves back
await anim.run('door', 'open');
globalThis.dispatchEvent?.(new Event('fumoca:lightingApplied'));
anim.dispose();
assert.ok(rows[doorStart + 19].c.every((v, k) => Math.abs(v - far[k]) < 1e-6), 'dispose returns parts to rest');
console.log('part-animator: all tests passed');
