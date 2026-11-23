import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

globalThis.window = {};
const { default: FourD } = await import(pathToFileURL(resolve('js/modules/fourd-sequence.js')).href);

const manifest = {
  schema: 'fumoca.4d.sequence',
  version: 1,
  id: 'walk-cycle',
  duration: 1,
  frameRate: 2,
  interpolation: 'hold',
  frames: [
    { time: 0, url: '/capture/frame-000.ply', format: 'ply', gaussianCount: 100, topologyId: 'frame-sequence-a' },
    { time: 0.5, url: '/capture/frame-001.ply', format: 'ply', gaussianCount: 100, topologyId: 'frame-sequence-b' },
    { time: 1, url: '/capture/frame-002.ply', format: 'ply', gaussianCount: 100, topologyId: 'frame-sequence-c' },
  ],
};

assert.equal(FourD.validateManifest(manifest).ok, true);
assert.equal(FourD.validateManifest({ ...manifest, frames: [] }).ok, false);
assert.equal(FourD.validateManifest({ ...manifest, frames: [manifest.frames[0], { ...manifest.frames[1], time: 0 }] }).ok, false);
assert.equal(FourD.validateManifest({ ...manifest, frames: [manifest.frames[0], { ...manifest.frames[1], url: 'javascript:alert(1)' }, manifest.frames[2]] }).ok, false);
assert.equal(FourD.validateManifest({ ...manifest, interpolation: 'linear', frames: [manifest.frames[0], { ...manifest.frames[1], topologyId: 'different' }, manifest.frames[2]] }).ok, false);
assert.deepEqual(FourD.locateFrames(manifest.frames, 0.25), { a: 0, b: 1, alpha: 0.5 });
assert.deepEqual(FourD.locateFrames(manifest.frames, 3), { a: 2, b: 2, alpha: 0 });

const loaded = [];
const presented = [];
const disposed = [];
const queue = [];
const adapter = {
  async loadFrame(frame, index) { loaded.push(index); return { index, url: frame.url }; },
  async presentFrame(handle, context) { presented.push({ handle, context }); },
  disposeFrame(handle) { disposed.push(handle.index); },
};
const player = FourD.create(manifest, adapter, {
  requestAnimationFrame(fn) { queue.push(fn); return queue.length; },
  cancelAnimationFrame() {},
});
assert.equal(await player.seek(0.75), true);
assert.equal(player.activeFrame, 1);
assert.equal(presented.at(-1).context.time, 0.75);
assert.equal(player.time, 0.75);
assert.equal(player.setSpeed(2), 2);
assert.throws(() => player.setSpeed(9), RangeError);
assert.equal(player.play(), true);
assert.equal(player.play(), false);
const tick = queue.shift();
tick(1000);
const tickAgain = queue.shift();
tickAgain(1100);
assert.equal(player.time, 0.95);
player.pause();
assert.equal(player.playing, false);
player.setLoop(false);
await player.seek(1);
assert.equal(player.activeFrame, 2);
await player.dispose();
assert.equal(player.playing, false);
assert.ok(disposed.length >= 1);
console.log('4D Gaussian sequence tests: 17 assertions passed');
