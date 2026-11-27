import assert from 'node:assert/strict';
import { floaterMask } from '../js/modules/floater-clean.js';

// Deterministic random
let seed = 7; const R = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const gauss = () => Math.sqrt(-2 * Math.log(R() + 1e-12)) * Math.cos(6.283185 * R());

// Object: a sphere shell of 30k splats, plus 8k floaters scattered around it.
const P = [], tag = [];
for (let i = 0; i < 30000; i++) { const a = R() * 6.283, b = Math.acos(2 * R() - 1); P.push(Math.sin(b) * Math.cos(a), Math.cos(b), Math.sin(b) * Math.sin(a)); tag.push('obj'); }
for (let i = 0; i < 8000; i++) { P.push(gauss() * 2.5, gauss() * 2.5, gauss() * 2.5); tag.push('fl'); }
let m = floaterMask(Float32Array.from(P), new Uint8Array(tag.length).fill(1), { aggression: 0.5 });
let objLost = 0, flGone = 0; tag.forEach((t, i) => { if (m[i]) t === 'obj' ? objLost++ : flGone++; });
assert.ok(objLost / 30000 < 0.005, 'keeps the object: lost ' + objLost);
assert.ok(flGone / 8000 > 0.85, 'removes floaters: ' + flGone);

// Room: floor + wall + a small separate table and lamp must all survive.
const Q = [], qt = [];
for (let i = 0; i < 120000; i++) { Q.push(R() * 6, 0, R() * 6); qt.push('floor'); }
for (let i = 0; i < 60000; i++) { Q.push(0, R() * 2.6, R() * 6); qt.push('wall'); }
for (let i = 0; i < 5000; i++) { Q.push(3 + R() * 0.8, 0.75, 3 + R() * 0.5); qt.push('table'); }
for (let i = 0; i < 1500; i++) { const a = R() * 6.283, b = Math.acos(2 * R() - 1); Q.push(4.5 + 0.12 * Math.sin(b) * Math.cos(a), 1.8 + 0.12 * Math.cos(b), 4.5 + 0.12 * Math.sin(b) * Math.sin(a)); qt.push('lamp'); }
for (let i = 0; i < 2000; i++) { Q.push(R() * 6, R() * 2.6, R() * 6); qt.push('fl'); }
m = floaterMask(Float32Array.from(Q), new Uint8Array(qt.length).fill(1), { aggression: 0.5 });
const lost = {}; qt.forEach((t, i) => { if (m[i]) lost[t] = (lost[t] || 0) + 1; });
for (const part of ['floor', 'wall', 'table', 'lamp']) assert.ok((lost[part] || 0) < 50, part + ' kept: lost ' + (lost[part] || 0));
assert.ok((lost.fl || 0) > 1500, 'room floaters removed: ' + (lost.fl || 0));

// Dead splats are never flagged; tiny inputs are left alone.
const alive = new Uint8Array(tag.length).fill(1); alive.fill(0, 0, 100);
m = floaterMask(Float32Array.from(P), alive); for (let i = 0; i < 100; i++) assert.equal(m[i], 0);
assert.equal(floaterMask(new Float32Array(30), new Uint8Array(10).fill(1)).reduce((a, b) => a + b, 0), 0);
console.log('floater-clean: all checks passed');
