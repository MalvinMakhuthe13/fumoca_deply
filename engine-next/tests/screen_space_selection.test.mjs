import test from 'node:test';
import assert from 'node:assert/strict';
import { selectVisibleScreenPoints } from '../../js/modules/screen-space-selection.js';

test('lasso selection excludes a hidden support point behind the visible object', () => {
  const points = [
    { x: 10, y: 10, depth: 2.0 }, // visible cap surface
    { x: 11, y: 10, depth: 2.004 }, // same visible surface, within tolerance
    { x: 10, y: 10, depth: 2.35 }, // wooden support behind the cap
    { x: 30, y: 30, depth: 1.0 }, // outside lasso
  ];
  const selected = selectVisibleScreenPoints({
    count: points.length,
    isAlive: () => true,
    project: i => ({ ...points[i], visible: true }),
    contains: (x, y) => x <= 20 && y <= 20,
    cellSize: 4,
    depthTolerance: 0.006,
  });
  assert.deepEqual(selected, [0, 1]);
});

test('visibility selection ignores dead and clipped points', () => {
  const points = [
    { x: 5, y: 5, depth: 1, visible: true },
    { x: 5, y: 5, depth: 0.5, visible: false },
    { x: 5, y: 5, depth: 1.2, visible: true },
  ];
  const selected = selectVisibleScreenPoints({
    count: points.length,
    isAlive: i => i !== 2,
    project: i => points[i],
    contains: () => true,
  });
  assert.deepEqual(selected, [0]);
});

test('selection remains additive across separate camera-angle gestures', () => {
  const firstView = selectVisibleScreenPoints({
    count: 2,
    isAlive: () => true,
    project: i => ({ x: i * 20, y: 0, depth: 1, visible: true }),
    contains: (x) => x < 10,
  });
  const secondView = selectVisibleScreenPoints({
    count: 2,
    isAlive: () => true,
    project: i => ({ x: i * 20, y: 0, depth: 1, visible: true }),
    contains: (x) => x >= 10,
  });
  const accumulated = new Set([...firstView, ...secondView]);
  assert.deepEqual([...accumulated].sort(), [0, 1]);
});
