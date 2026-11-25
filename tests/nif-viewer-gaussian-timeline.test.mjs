import assert from 'node:assert/strict';
import { NIFViewer } from '../engine-next/viewer-src/NIFViewer.js';

const scheduled = new Map();
let nextId = 1;
globalThis.requestAnimationFrame = callback => { const id=nextId++;scheduled.set(id,callback);return id; };
globalThis.cancelAnimationFrame = id => scheduled.delete(id);

const updates=[];
const viewer=Object.create(NIFViewer.prototype);
Object.assign(viewer,{
  _renderer:{updateGaussianAnimation:t=>updates.push(t)},
  _gaussianAnimation:{duration:2},
  _gaussianAnimationFrame:null,
  _gaussianAnimationStart:0,
  _gaussianAnimationFrom:0,
  _gaussianAnimationSpeed:1,
  _gaussianAnimationLoop:false,
  _gaussianAnimationTime:0,
});
viewer.playGaussianAnimation({from:0,speed:2});
assert.equal(updates.at(-1),0,'play evaluates the initial playhead');
let [id,callback]=[...scheduled.entries()].at(-1);
callback(viewer._gaussianAnimationStart+500);
assert.ok(Math.abs(viewer.gaussianAnimationTime-1)<1e-6,'speed scales elapsed playback time');
assert.ok(Math.abs(updates.at(-1)-1)<1e-6,'frame updates native splats');

viewer.seekGaussianAnimation(1.5);
assert.equal(viewer.gaussianAnimationTime,1.5,'seek updates the playhead');
assert.equal(updates.at(-1),1.5,'seek evaluates the exact requested time');

viewer.pauseGaussianAnimation();
assert.equal(viewer.isGaussianAnimationPlaying,false,'pause cancels the playback frame');

viewer.playGaussianAnimation({from:1.5,speed:1,loop:true});
const start=viewer._gaussianAnimationStart;
[id,callback]=[...scheduled.entries()].at(-1);
callback(start+1000);
assert.ok(Math.abs(viewer.gaussianAnimationTime-0.5)<1e-6,'loop wraps at the animation duration');
assert.ok(Math.abs(updates.at(-1)-0.5)<1e-6,'loop evaluates the wrapped time');

viewer.pauseGaussianAnimation();
assert.throws(()=>viewer.playGaussianAnimation({speed:0}),/positive/);
assert.throws(()=>viewer.seekGaussianAnimation(Infinity),/finite/);
console.log('NIF viewer Gaussian timeline controls: 9 assertions passed');
