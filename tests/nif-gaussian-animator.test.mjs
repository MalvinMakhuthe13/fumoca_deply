import assert from 'node:assert/strict';
import { NIFGaussianAnimator } from '../engine-next/animation/NIFGaussianAnimator.js';

const data = new Float32Array([
  0,0,0, 0,0,0, 1,0,0,0, .8,.1,.2,.3,
  5,5,5, 1,1,1, 1,0,0,0, .4,.4,.5,.6,
]);
const gaussians = { count: 2, data };
const animator = new NIFGaussianAnimator(gaussians, [{
  id: 42,
  keyframes: [
    { time: 0, position: [0,0,0], scale: [0,0,0], rotation: [1,0,0,0] },
    { time: 2, position: [2,4,6], scale: [2,4,6], rotation: [0,0,1,0] },
  ],
}], new Uint32Array([42, 99]));

const mid = animator.evaluate(1);
assert.ok(Math.abs(mid[0]-1)<1e-6 && Math.abs(mid[1]-2)<1e-6 && Math.abs(mid[2]-3)<1e-6);
assert.ok(Math.abs(mid[3]-1)<1e-6 && Math.abs(mid[4]-2)<1e-6 && Math.abs(mid[5]-3)<1e-6);
assert.ok(Math.abs(Math.hypot(mid[6],mid[7],mid[8],mid[9])-1)<1e-6);
assert.deepEqual(Array.from(mid.slice(10,14)), [0.8,0.1,0.2,0.3]);
assert.deepEqual(Array.from(mid.slice(14,28)), Array.from(data.slice(14,28)));
const end = animator.evaluate(5);
assert.ok(Math.abs(end[0]-2)<1e-6, 'time after final key clamps to final pose');
const reset = animator.reset();
assert.ok(Math.abs(reset[0])<1e-6, 'reset restores base position');
assert.throws(() => new NIFGaussianAnimator(gaussians, [{id:123,keyframes:[{time:0,position:[0,0,0]}]}], new Uint32Array([42,99])), /Unknown Gaussian ID/);
assert.throws(() => new NIFGaussianAnimator(gaussians, [{id:42,keyframes:[{time:1,position:[0,0,0]},{time:1,position:[1,0,0]}]}], new Uint32Array([42,99])), /strictly increasing/);
console.log('Native Gaussian animation: 9 assertions passed');
