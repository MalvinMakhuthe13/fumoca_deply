import assert from 'node:assert/strict';
import {
  DEVICE_PRESETS,
  computeFrameLayout,
  resolveDeviceSize,
} from '../js/modules/device-preview.js';

assert.ok(DEVICE_PRESETS.length >= 5, 'expected device presets');
assert.ok(DEVICE_PRESETS.some((p) => p.id === 'tablet' && p.width === 820 && p.height === 1180));

const tablet = DEVICE_PRESETS.find((p) => p.id === 'tablet');
const portrait = resolveDeviceSize(tablet, false);
assert.deepEqual(portrait, { width: 820, height: 1180 });
const landscape = resolveDeviceSize(tablet, true);
assert.deepEqual(landscape, { width: 1180, height: 820 });

const fit = computeFrameLayout(820, 1180, 1000, 800, 20);
assert.ok(fit.scale > 0 && fit.scale <= 1);
assert.equal(fit.scalePct, Math.round(fit.scale * 100));
assert.ok(Math.abs(fit.width / fit.height - 820 / 1180) < 0.02, 'aspect preserved');
assert.ok(fit.width <= 1000 - 40 && fit.height <= 800 - 40);

// Never upscale past 100%
const smallStage = computeFrameLayout(360, 640, 2000, 2000, 0);
assert.equal(smallStage.scale, 1);
assert.equal(smallStage.width, 360);
assert.equal(smallStage.height, 640);

console.log('device-preview unit tests: all checks passed');
