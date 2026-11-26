import assert from 'node:assert/strict';
import { normalizeViewSettings, viewSettingsFromUrl, ViewController, captureView, DEFAULT_VIEW } from '../js/modules/view-settings.js';

class V3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { return this.set(v.x, v.y, v.z); } clone() { return new V3(this.x, this.y, this.z); }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; } add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  normalize() { const l = Math.hypot(this.x, this.y, this.z) || 1; this.x /= l; this.y /= l; this.z /= l; return this; }
  distanceTo(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
  applyAxisAngle(a, ang) { // rotate about a unit axis (Rodrigues)
    const c = Math.cos(ang), s = Math.sin(ang), d = a.x * this.x + a.y * this.y + a.z * this.z;
    const cx = a.y * this.z - a.z * this.y, cy = a.z * this.x - a.x * this.z, cz = a.x * this.y - a.y * this.x;
    return this.set(this.x * c + cx * s + a.x * d * (1 - c), this.y * c + cy * s + a.y * d * (1 - c), this.z * c + cz * s + a.z * d * (1 - c));
  }
}
const THREE = { Vector3: V3 };
globalThis.requestAnimationFrame ??= (f) => setTimeout(() => f(performance.now()), 5);
globalThis.cancelAnimationFrame ??= (id) => clearTimeout(id);

// validation
assert.equal(normalizeViewSettings(null), null);
const n = normalizeViewSettings({ zoomMin: 5, zoomMax: 0.5, spin: 999, startView: { position: [0, 0, 'x'], target: [0, 0, 0] } });
assert.equal(n.zoomMin, 1); assert.equal(n.zoomMax, 1); assert.equal(n.spin, 180); assert.equal(n.startView, null);

// URL overrides for embeds
const u = viewSettingsFromUrl('?spin=12&lock=1&zoomMin=0.6&zoomMax=2.5&fixed=1');
assert.deepEqual([u.spin, u.lockZoom, u.lockRotate, u.zoomMin, u.zoomMax, u.fixed], [12, true, true, 0.6, 2.5, true]);
assert.equal(viewSettingsFromUrl('?nifId=abc', null), null, 'unrelated params change nothing');
assert.equal(viewSettingsFromUrl('?pan=1', { ...DEFAULT_VIEW, spin: 5 }).spin, 5, 'URL only overrides what it names');

// OrbitControls-style: start view, zoom limits, locks
const cam = { position: new V3(9, 9, 9), up: new V3(0, 1, 0), fov: 50, lookAt() {}, updateProjectionMatrix() {} };
const orbit = { target: new V3(), enableZoom: true, enableRotate: true, enablePan: true, minDistance: 0, maxDistance: Infinity, update() {} };
const vc = new ViewController(THREE, cam, orbit, { startView: { position: [0, 1, 4], target: [0, 1, 0] }, zoomMin: 0.5, zoomMax: 2, lockRotate: true });
vc.apply();
assert.deepEqual([cam.position.x, cam.position.y, cam.position.z], [0, 1, 4], 'start view applied');
assert.equal(orbit.minDistance, 2); assert.equal(orbit.maxDistance, 8);
assert.equal(orbit.enableRotate, false); assert.equal(orbit.enableZoom, true); assert.equal(orbit.enablePan, false);
assert.equal(globalThis._fumocaViewSettings.maxDistance, 8, 'limits published so auto-fit keeps them');
vc.dispose();

// TrackballControls-style: steady view
const track = { target: new V3(), noZoom: false, noRotate: false, noPan: false, noRoll: false, update() {} };
const cam2 = { position: new V3(0, 0, 5), up: new V3(0, 1, 0), lookAt() {} };
new ViewController(THREE, cam2, track, { fixed: true }).apply();
assert.deepEqual([track.noZoom, track.noRotate, track.noPan], [true, true, true], 'steady view locks everything');

// spin: camera orbits the target at the set speed, keeps its distance, pauses on drag
const cam3 = { position: new V3(0, 0, 5), up: new V3(0, 1, 0), lookAt() {} };
const c3 = { target: new V3(), update() {} };
const spinner = new ViewController(THREE, cam3, c3, { spin: 90 });
spinner.apply();
await new Promise(r => setTimeout(r, 300));
const ang = Math.atan2(cam3.position.x, cam3.position.z) * 180 / Math.PI;
assert.ok(ang > 10 && ang < 40, 'spun ~27° in 0.3 s at 90°/s: ' + ang.toFixed(1));
assert.ok(Math.abs(cam3.position.distanceTo(c3.target) - 5) < 1e-6, 'distance kept');
spinner._down();
const p1 = cam3.position.clone();
await new Promise(r => setTimeout(r, 120));
assert.ok(cam3.position.distanceTo(p1) < 1e-9, 'paused while dragging');
spinner.dispose();

// capture
assert.deepEqual(captureView(cam, orbit).position, [0, 1, 4]);
console.log('view-settings: all tests passed');
