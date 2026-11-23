import test from 'node:test';
import assert from 'node:assert/strict';
import { NIFWriter, CHUNK, CODEC, NIFReader, decodeGaussianAnimationChunk } from '../format/NIFSpec.js';
import { NIFManualGaussianDeformAuthor } from '../animation/NIFManualGaussianDeformAuthor.js';
import { NIFGaussianAnimator } from '../animation/NIFGaussianAnimator.js';
import { encodeManualAnimationNif, verifyManualAnimationNif } from '../animation/NIFManualAnimationExport.js';

function geometryChunk(points){
  const out=new Uint8Array(5+points.length*14*4),dv=new DataView(out.buffer);
  dv.setUint8(0,0);dv.setUint32(1,points.length,false);
  points.forEach((p,i)=>p.forEach((v,k)=>dv.setFloat32(5+(i*14+k)*4,v,true)));
  return out;
}
function sourceNif(){
  const record=[0,0,0,0,0,0,1,0,0,0,0.8,0.2,0.3,0.4];
  return new NIFWriter({captureMode:'video',fps:30,vertical:'generic'}).add(CHUNK.KEYFRAME_GEO,geometryChunk([record]),CODEC.RAW).build();
}

test('NIF export preserves original geometry and embeds validated manual animation',async()=>{
  const source=sourceNif(),reader=new NIFReader(source),geometry=await reader.getGeometry();
  const author=new NIFManualGaussianDeformAuthor(geometry.data);
  author.selectIds([0]);author.apply({type:'fold',axis:[0,0,1],pivot:[0,0,0],angle:Math.PI/3});author.capture(0.5);
  const output=await encodeManualAnimationNif(source,author.exportTracks(),{duration:1});
  const report=await verifyManualAnimationNif(output);
  assert.equal(report.geometryCount,1);assert.equal(report.trackCount,1);assert.equal(report.duration,1);
  const result=new NIFReader(output),after=await result.getGeometry();
  assert.deepEqual(Array.from(after.data.slice(10,14)),Array.from(geometry.data.slice(10,14)));
  assert.ok(result.hasChunk(CHUNK.GAUSSIAN_ANIMATION));
  const animation=await decodeGaussianAnimationChunk(result.getChunk(CHUNK.GAUSSIAN_ANIMATION));
  assert.equal(animation.tracks[0].keyframes[0].time,0);
  const reopenedGeometry=await result.getGeometry(),reopened=new NIFManualGaussianDeformAuthor(reopenedGeometry.data);
  assert.equal(reopened.loadTracks(animation.tracks),1);
  reopened.selectIds([0]);reopened.apply({type:'translate',direction:[0,1,0],amount:.25});reopened.capture(.75);
  const secondPass=await encodeManualAnimationNif(output,reopened.exportTracks(),{duration:1});
  assert.equal((await verifyManualAnimationNif(secondPass)).trackCount,1);
});

test('manual author undo and redo restore data and keyframe state',()=>{
  const data=new Float32Array([1,0,0,0,0,0,1,0,0,0,0.8,0.2,0.3,0.4]);
  const author=new NIFManualGaussianDeformAuthor(data);author.selectIds([0]);
  author.apply({type:'fold',axis:[0,0,1],pivot:[0,0,0],angle:Math.PI/2});
  const changed=Array.from(data);
  assert.equal(author.undo(),true);assert.ok(Math.abs(data[0]-1)<1e-6);
  assert.equal(author.redo(),true);assert.deepEqual(Array.from(data),changed);
});

test('screen-space brush and lasso selection operate on projected Gaussian centers',()=>{
  const data=new Float32Array(3*14);
  const author=new NIFManualGaussianDeformAuthor(data);
  const projected=new Float32Array([0,0,10,10,20,20]);
  author.selectScreenBrush(projected,[0,0],5);
  assert.equal(author.selection[0],1);assert.equal(author.selection[1],0);
  author.selectLasso(projected,[[-1,-1],[15,-1],[15,15],[-1,15]]);
  assert.equal(author.selection[0],1);assert.equal(author.selection[1],1);assert.equal(author.selection[2],0);
});

test('manual layers, keyframe editing and easing survive track export',()=>{
  const data=new Float32Array([1,0,0,0,0,0,1,0,0,0,.8,.2,.3,.4]);
  const author=new NIFManualGaussianDeformAuthor(data);
  author.selectIds([0]);
  author.createLayer('Arm');
  author.apply({type:'translate',direction:[1,0,0],amount:1});
  author.capture(.5,{easing:'ease-in-out'});
  const tracks=author.exportTracks();
  assert.equal(tracks[0].keyframes[1].easing,'ease-in-out');
  assert.equal(author.moveKeyframe(.5,.75),1);
  assert.equal(author.deleteKeyframe(.75),1);
  assert.equal(author.exportTracks().length,0);
});
test('world-space nonuniform scale updates Gaussian covariance orientation and radii',()=>{
  const angle=Math.PI/4,q=[Math.cos(angle/2),0,0,Math.sin(angle/2)];
  const data=new Float32Array([1,0,0,0,0,0,...q,.8,.2,.3,.4]);
  const author=new NIFManualGaussianDeformAuthor(data);author.selectIds([0]);
  author.apply({type:'scale',pivot:[0,0,0],scale:[2,1,1]});
  assert.ok(data.slice(6,10).some((v,i)=>Math.abs(v-q[i])>1e-3));
  assert.ok(data[3]>0);
});

test('connected selection growth remains practical on Puma-sized Gaussian sets',()=>{
  const count=23485,data=new Float32Array(count*14);
  for(let i=0;i<count;i++){const o=i*14;data[o]=(i%97)*.01;data[o+1]=Math.floor(i/97)*.01;data[o+2]=0;data[o+6]=1;data[o+10]=.8;}
  const author=new NIFManualGaussianDeformAuthor(data);author.selectIds([0]);
  const start=performance.now();author.growSelection(.035,{iterations:2,falloff:.35});const elapsed=performance.now()-start;
  assert.ok(author.selection.some(v=>v>0));
  assert.ok(elapsed<5000, 'spatially indexed selection growth exceeded 5 seconds');
});
test('inflate and deflate safely handle a selected Gaussian at the pivot',()=>{
  const data=new Float32Array([0,0,0,0,0,0,1,0,0,0,.8,.2,.3,.4]);
  const author=new NIFManualGaussianDeformAuthor(data);author.selectIds([0]);
  assert.doesNotThrow(()=>author.apply({type:'inflate',pivot:[0,0,0],amount:.1}));
  assert.ok(Number.isFinite(data[0])&&Number.isFinite(data[3]));
});

test('native animator applies easing without changing colour or opacity',()=>{
  const data=new Float32Array([0,0,0,0,0,0,1,0,0,0,.8,.2,.3,.4]),g={count:1,data};
  const animator=new NIFGaussianAnimator(g,[{id:0,keyframes:[{time:0,position:[0,0,0],easing:'ease-in'},{time:1,position:[1,0,0]}]}]);
  animator.evaluate(.5);
  assert.ok(Math.abs(g.data[0]-.25)<1e-5);
  assert.deepEqual(Array.from(g.data.slice(10,14)),[.8,.2,.3,.4].map(Math.fround));
});

test('authoring project restores named layers, keyframes and weighted selection sets',()=>{
  const data=new Float32Array([1,0,0,0,0,0,1,0,0,0,.8,.2,.3,.4]);
  const author=new NIFManualGaussianDeformAuthor(data);author.selectIds([0]);author.saveSelection('Subject');
  author.createLayer('Arm');author.apply({type:'translate',direction:[0,1,0],amount:.5});author.capture(.5,{easing:'ease-out'});
  const project=author.exportProject(),restored=new NIFManualGaussianDeformAuthor(data.slice());
  const report=restored.importProject(project);
  assert.equal(report.layerCount,2);assert.equal(report.trackCount,1);assert.equal(report.selectionSetCount,1);
  assert.equal(restored.activeLayer,'Arm');assert.equal(restored.loadSelection('Subject')[0],1);
  assert.equal(restored.exportTracks()[0].keyframes[1].easing,'ease-out');
  assert.throws(()=>restored.importProject({...project,gaussianCount:99}),/does not match/);
});
