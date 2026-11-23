import assert from 'node:assert/strict';
import { NIFProxyDeformer } from '../engine-next/animation/NIFProxyDeformer.js';

const rest = new Float32Array([0,0,0, 1,0,0, 0,1,0]);
const triangles = new Uint32Array([0,1,2]);
const gaussian = new Float32Array([
  .25,.25,.1, .1,.2,.3, 1,0,0,0, .8, .2,.4,.6
]);
const deformer = new NIFProxyDeformer(rest, triangles, gaussian);
const moved = new Float32Array([1,2,3, 3,2,3, 1,5,3]);
const out = deformer.update(moved);
assert.ok(Math.abs(out[0]-1.5)<1e-5);
assert.ok(Math.abs(out[1]-2.75)<1e-5);
assert.ok(Math.abs(out[2]-3.1)<1e-5);
assert.ok(Math.abs(out[3]-.2)<1e-5);
assert.ok(Math.abs(out[4]-.6)<1e-5);
assert.ok(Math.abs(out[5]-1.8)<1e-5);
assert.ok(Math.abs(out[6]-1)<1e-5);
assert.ok(Math.abs(out[10]-.8)<1e-6);
assert.ok(Math.abs(out[11]-.2)<1e-6);
assert.ok(Math.abs(out[12]-.4)<1e-6);
assert.ok(Math.abs(out[13]-.6)<1e-6);
assert.ok(Math.abs(deformer.reset()[0]-.25)<1e-6);
assert.throws(() => new NIFProxyDeformer(rest, triangles, gaussian, {maxBindDistance:.001}), /outside/);
assert.throws(() => deformer.update(new Float32Array([0,0,0])), /match/);
console.log('NIF proxy deformation: 14 assertions passed');
