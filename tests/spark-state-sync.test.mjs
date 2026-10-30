import assert from 'node:assert/strict';
import { applyEditorStateToPackedSplats } from '../js/modules/spark-state-sync.js';

class Vec3 {
  set(x,y,z) { this.x=x; this.y=y; this.z=z; return this; }
}
class Quaternion {
  set(x,y,z,w) { this.x=x; this.y=y; this.z=z; this.w=w; return this; }
  lengthSq() { return this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w; }
  normalize() { const n=Math.sqrt(this.lengthSq())||1; this.x/=n;this.y/=n;this.z/=n;this.w/=n;return this; }
  identity() { return this.set(0,0,0,1); }
}
class Color {
  setRGB(r,g,b) { this.r=r;this.g=g;this.b=b;return this; }
}
const THREE={Vector3:Vec3,Quaternion,Color};
const records=[];
const packed={needsUpdate:false,setSplat(i,center,scales,rotation,opacity,color){
  records[i]={center:{...center},scales:{...scales},rotation:{...rotation},opacity,color:{...color}};
}};
const mesh={numSplats:2,packedSplats:packed,pushSplat(center,scales,rotation,opacity,color){
  records[this.numSplats]={center:{...center},scales:{...scales},rotation:{...rotation},opacity,color:{...color}};
  this.numSplats++;
}};
const state={
  fileType:'ply',
  alive:new Uint8Array([1,0]),
  positions:new Float32Array([1,2,3,4,5,6]),
  scaleXYZ:new Float32Array([.1,.2,.3,.4,.5,.6]),
  rotation:new Float32Array([1,0,0,0,.7071068,0,.7071068,0]),
  opacity:new Float32Array([.8,.9]),
  colors:new Float32Array([.1,.2,.3,.4,.5,.6])
};
let result=applyEditorStateToPackedSplats(mesh,state,[1],THREE);
assert.equal(result.ok,true);
assert.equal(result.updated,1);
assert.equal(records[0],undefined,'unselected splat must not be touched');
assert.equal(records[1].opacity,0,'deleted splat must become transparent');
assert.deepEqual(records[1].center,{x:4,y:5,z:6});
assert.ok(Math.abs(records[1].scales.x-.4)<1e-6 && Math.abs(records[1].scales.y-.5)<1e-6 && Math.abs(records[1].scales.z-.6)<1e-6,'Gaussian scales must be preserved within Float32 precision');
assert.ok(Math.abs(records[1].rotation.y-Math.SQRT1_2)<1e-5,'PLY wxyz rotation must map to THREE xyzw');
assert.equal(packed.needsUpdate,true);

// A newly appended editor layer is appended to Spark exactly once.
state.alive=new Uint8Array([1,1,1]);
state.positions=new Float32Array([1,2,3,4,5,6,7,8,9]);
state.scaleXYZ=new Float32Array([.1,.2,.3,.4,.5,.6,.7,.8,.9]);
state.rotation=new Float32Array([1,0,0,0,1,0,0,0,1,0,0,0]);
state.opacity=new Float32Array([.8,.9,1]);
state.colors=new Float32Array([.1,.2,.3,.4,.5,.6,.7,.8,.9]);
result=applyEditorStateToPackedSplats(mesh,state,[],THREE);
assert.equal(result.appended,1);
assert.equal(mesh.numSplats,3);
assert.deepEqual(records[2].center,{x:7,y:8,z:9});
applyEditorStateToPackedSplats(mesh,state,[],THREE);
assert.equal(mesh.numSplats,3,'repeated sync must not duplicate appended splats');

// SPLAT source rotations are already xyzw in FUMOCA state.
state.fileType='splat';
state.rotation.set([0,0,Math.SQRT1_2,Math.SQRT1_2],0);
applyEditorStateToPackedSplats(mesh,state,[0],THREE);
assert.ok(Math.abs(records[0].rotation.z-Math.SQRT1_2)<1e-5);
console.log('Live Spark PackedSplats synchronization tests passed.');
