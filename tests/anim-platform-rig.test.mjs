/**
 * Presentation platform: shared builder + public-viewer restore, on real three.js.
 * Requires: npm install three   (CI installs it; run via scripts/run-anim-tests.mjs)
 */
import * as THREE from 'three';

globalThis.window = globalThis;
globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(performance.now()), 16);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

const { normalizePlatformConfig, platformMetrics, seatFromPoints, buildPlatform } = await import('../js/modules/platform-build.js');
const { restorePlatform, clearPlatform } = await import('../js/modules/platform-viewer.js');

let passed = 0, failed = 0;
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); failed++; } else { console.log('PASS:', m); passed++; } };
const near = (a, b, e = 1e-4) => Math.abs(a - b) < e;

// ── config validation (saved metadata is untrusted)
const bad = normalizePlatformConfig({ enabled: true, shape: '<script>', fit: 1e9, logoSrc: 'javascript:alert(1)', turntable: 'fast' });
assert(bad.shape === 'circle' && bad.fit === 260 && bad.logoSrc === null && bad.turntable === 0, 'invalid saved config is clamped and unsafe logo URLs are dropped');
assert(normalizePlatformConfig({ logoSrc: 'https://cdn.example/logo.png' }).logoSrc === 'https://cdn.example/logo.png', 'https logo kept');
assert(normalizePlatformConfig({}).enabled === false, 'disabled by default');

// ── seat ignores floaters
const xs = [], ys = [], zs = [];
for (let i = 0; i < 400; i++) { xs.push((i % 20) / 10 - 1); ys.push(1 + (i % 7) / 10); zs.push(((i * 3) % 20) / 10 - 1); }
xs.push(50); ys.push(-30); zs.push(50); // floater
const seat = seatFromPoints(xs, ys, zs);
assert(seat.minY > 0.9 && seat.footprint < 3, 'stray floaters do not drag the seat down or widen the base');

// ── builder: top surface at y=0, logo underneath
const g = new THREE.Group();
const m = buildPlatform(THREE, g, { shape: 'square', material: 'black', fit: 100 }, 2, new THREE.Texture());
const box = new THREE.Box3().setFromObject(g);
assert(near(box.max.y, 0, 1e-3), 'platform top surface is at the seat (y = 0)');
assert(box.min.y < -m.height * 0.9, 'platform extends downwards by its thickness');
assert(!!g.getObjectByName('fumoca-platform-logo'), 'logo mesh is placed on the underside');
buildPlatform(THREE, g, { shape: 'circle', material: 'metal', glow: false }, 2, null);
assert(!g.getObjectByName('fumoca-platform-logo') && !g.getObjectByName('fumoca-platform-ring'), 'rebuild clears previous meshes');

// ── viewer restore keeps the splat in place and rotates it with the base
const scene = new THREE.Scene();
const group = new THREE.Group(); group.position.set(3, 1, -2);
const mesh = new THREE.Object3D(); mesh.position.set(-0.5, 0, 0.25);
const centres = [];
for (let i = 0; i < 800; i++) centres.push(new THREE.Vector3((i % 20) / 10 - 1, (i % 11) / 10, ((i * 7) % 20) / 10 - 1));
mesh.packedSplats = { forEachSplat: (fn) => centres.forEach((c, i) => fn(i, c)) };
group.add(mesh); scene.add(group); scene.updateMatrixWorld(true);
const before = new THREE.Vector3(); mesh.getWorldPosition(before);
window._fumocaPublishedSparkGroup = group; window._fumocaPublishedSparkMesh = mesh; window._fumocaViewerScene = scene;

const ok = await restorePlatform({ enabled: true, material: 'black', spin: 0, tilt: 0 });
scene.updateMatrixWorld(true);
const after = new THREE.Vector3(); mesh.getWorldPosition(after);
assert(ok, 'restorePlatform succeeds');
assert(after.distanceTo(before) < 1e-5, 'restoring the platform does not move the splat');
const rig = scene.getObjectByName('fumoca-presentation-root');
const top = new THREE.Box3().setFromObject(rig.getObjectByName('fumoca-platform-base'));
const lowest = new THREE.Box3().setFromObject(mesh);
assert(rig && group.parent?.parent === rig, 'splat group is inside the rig with the base');
assert(top.max.y <= before.y + 0.11 && top.max.y > before.y - 0.2, 'base sits at the bottom of the splat');
clearPlatform();
scene.updateMatrixWorld(true);
const restored = new THREE.Vector3(); mesh.getWorldPosition(restored);
assert(restored.distanceTo(before) < 1e-5 && group.parent === scene, 'clearing returns the splat unchanged');

// Spin rotates splat and base together about the seat.
await restorePlatform({ enabled: true, material: 'black', spin: 90 });
scene.updateMatrixWorld(true);
const spun = new THREE.Vector3(); mesh.getWorldPosition(spun);
assert(spun.distanceTo(before) > 0.1, 'spin moves the splat with the rig');
clearPlatform();

// Turntable keeps rotating.
await restorePlatform({ enabled: true, material: 'black', turntable: 90 });
const r = scene.getObjectByName('fumoca-presentation-root');
const y0 = r.rotation.y;
await new Promise(res => setTimeout(res, 120));
assert(Math.abs(r.rotation.y - y0) > 0.01, 'turntable rotates the rig over time');
clearPlatform();
assert(!scene.getObjectByName('fumoca-presentation-root'), 'rig removed on clear');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
