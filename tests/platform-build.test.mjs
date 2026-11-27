import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePlatformConfig, platformMetrics, seatFromPoints, DEFAULT_PLATFORM } from '../js/modules/platform-build.js';

test('saved platform config is validated', () => {
  const c = normalizePlatformConfig({ enabled: true, shape: 'hexagon', fit: -5, material: 'gold', logoSrc: 'data:image/svg+xml;base64,PHN2Zz4=', tilt: 500, turntable: 30 });
  assert.equal(c.shape, 'circle'); assert.equal(c.fit, 60); assert.equal(c.material, 'wood');
  assert.equal(c.logoSrc, null, 'SVG data URLs are refused (script-capable)');
  assert.equal(c.tilt, 180); assert.equal(c.turntable, 30); assert.equal(c.enabled, true);
  assert.equal(normalizePlatformConfig(null).enabled, false);
  assert.equal(normalizePlatformConfig({ logoSrc: 'data:image/png;base64,AAAA' }).logoSrc, 'data:image/png;base64,AAAA');
});

test('metrics scale with the splat footprint', () => {
  const m = platformMetrics({ ...DEFAULT_PLATFORM, fit: 100, shape: 'rect' }, 2);
  assert.equal(m.width, 2); assert.ok(Math.abs(m.depth - 1.32) < 1e-9); assert.ok(m.height > 0);
});

test('seat uses robust percentiles', () => {
  const xs = [], ys = [], zs = [];
  for (let i = 0; i < 100; i++) { xs.push(i / 100); ys.push(5 + i / 100); zs.push(i / 100); }
  xs.push(1000); ys.push(-1000); zs.push(1000);
  const s = seatFromPoints(xs, ys, zs);
  assert.ok(s.minY > 4.9 && s.footprint < 1);
  assert.equal(seatFromPoints([1], [1], [1]), null);
});
