import assert from 'node:assert/strict';
import { normalizeLightMotion, motionFromPreset, sampleMotion, phaseAt, directionToAngles, raySphere, LIGHT_MOTIONS } from '../js/modules/light-motion.js';
import { lightDirection, normalizeLighting } from '../js/modules/splat-lighting.js';
const base = normalizeLighting({ enabled: true, azimuth: 30, elevation: 40, intensity: 0.9, ambient: 0.5, color: '#ffffff' });
// orbit: full turn, eased between keys
const orbit = motionFromPreset('orbit', base);
assert.equal(orbit.keys.length, 2); assert.equal(orbit.enabled, true);
assert.equal(sampleMotion(orbit, base, 0).azimuth, 30);
assert.equal(sampleMotion(orbit, base, 1).azimuth, 390);
assert.ok(Math.abs(sampleMotion(orbit, base, 0.5).azimuth - 210) < 1e-9);
assert.equal(sampleMotion(orbit, base, 0.5).elevation, 40, 'untouched values stay');
// colours blend
const sun = motionFromPreset('sunrise', base);
const mid = sampleMotion(sun, base, 0.25);
assert.match(mid.color, /^#[0-9a-f]{6}$/); assert.notEqual(mid.color, '#ff8a3d'); assert.notEqual(mid.color, '#fff6e8');
// loops
assert.equal(phaseAt({ duration: 4, loop: 'loop' }, 5), 0.25);
assert.equal(phaseAt({ duration: 4, loop: 'pingpong' }, 6), 0.5);
assert.equal(phaseAt({ duration: 4, loop: 'pingpong' }, 7), 0.25);
assert.equal(phaseAt({ duration: 4, loop: 'once' }, 9), 1);
// every preset is valid
for (const k of Object.keys(LIGHT_MOTIONS)) { const m = motionFromPreset(k, base); assert.ok(m.enabled && m.keys.length >= 2, k); }
// untrusted data
const bad = normalizeLightMotion({ enabled: true, duration: 9999, loop: 'x', keys: [{ t: 5, azimuth: 1e9, color: 'red' }, { t: -1, intensity: 'a' }] });
assert.equal(bad.duration, 120); assert.equal(bad.loop, 'loop'); assert.equal(bad.keys[0].t, 0); assert.equal(bad.keys[1].azimuth, 720); assert.equal(bad.keys[1].color, undefined);
assert.equal(normalizeLightMotion({ keys: [{ t: 0 }] }).enabled, false, 'needs two keys');
// lighting keeps the motion through normalize
assert.ok(normalizeLighting({ enabled: true, motion: orbit }).motion);
// drag maths: dragging to a point gives the light direction that points there
for (const [az, el] of [[0, 30], [90, 10], [-135, 60], [170, 85]]) {
  const d = lightDirection(az, el), a = directionToAngles(...d);
  assert.ok(Math.abs(((a.azimuth - az + 540) % 360) - 180) < 1e-6 && Math.abs(a.elevation - el) < 1e-6, `${az}/${el}`);
}
const hit = raySphere([0, 0, 5], [0, 0, -1], [0, 0, 0], 1); assert.deepEqual(hit.map(v => +v.toFixed(6)), [0, 0, 1]);
const miss = raySphere([3, 0, 5], [0, 0, -1], [0, 0, 0], 1); assert.ok(Math.abs(Math.hypot(...miss) - 1) < 1e-9 && miss[0] > 0.99, 'a miss lands on the sphere edge');
console.log('light-motion: all tests passed');
