import test from 'node:test';
import assert from 'node:assert/strict';
import { NIFManualGaussianDeformAuthor } from '../engine-next/animation/NIFManualGaussianDeformAuthor.js';

function fixture(points) {
  const data=new Float32Array(points.length*14);
  points.forEach((p,i)=>{
    const o=i*14;
    data.set([...p,0,0,0,1,0,0,0,0.8,0.2,0.3,0.4],o);
  });
  return data;
}

test('manual author selects Gaussian IDs and applies weighted fold from rest pose',()=>{
  const data=fixture([[0,0,0],[1,0,0],[2,0,0]]);
  const author=new NIFManualGaussianDeformAuthor(data);
  author.selectIds([0,1]);
  author.apply({type:'fold',axis:[0,0,1],pivot:[0,0,0],angle:Math.PI/2});
  assert.ok(Math.abs(data[0]-0)<1e-6);
  assert.ok(Math.abs(data[14])<1e-5);
  assert.ok(Math.abs(data[15]-1)<1e-5);
  assert.deepEqual(Array.from(data.slice(10,14)),[0.8,0.2,0.3,0.4]);
  assert.deepEqual(Array.from(data.slice(28,42)),Array.from(fixture([[2,0,0]])));
});

test('sphere selection supports soft falloff and additive selection',()=>{
  const author=new NIFManualGaussianDeformAuthor(fixture([[0,0,0],[0.5,0,0],[1,0,0],[2,0,0]]));
  author.selectSphere([0,0,0],1,{falloff:0.5});
  assert.equal(author.selection[0],1);
  assert.ok(author.selection[1]>0&&author.selection[1]<1);
  assert.equal(author.selection[2],0);
  author.selectIds([3],{mode:'add'});
  assert.equal(author.selection[3],1);
});

test('box selection validates bounds and applies deformation without changing appearance channels',()=>{
  const data=fixture([[0,0,0],[1,0,0]]);
  const author=new NIFManualGaussianDeformAuthor(data);
  author.selectBox([-0.1,-1,-1],[1.1,1,1]);
  author.apply({type:'scale',pivot:[0,0,0],scale:[0.5,1,1]});
  assert.ok(Math.abs(data[14+3]-Math.log(0.5))<1e-5);
  for(let i=0;i<2;i++)assert.deepEqual(Array.from(data.slice(i*14+10,i*14+14)),[0.8,0.2,0.3,0.4]);
  assert.throws(()=>author.selectBox([1,0,0],[0,1,1]),/ordered/);
});

test('captured manual keyframes export in native Gaussian track shape',()=>{
  const data=fixture([[1,0,0]]);
  const author=new NIFManualGaussianDeformAuthor(data);
  author.selectIds([0]);
  author.apply({type:'fold',axis:[0,0,1],pivot:[0,0,0],angle:Math.PI/2});
  author.capture(0.5);
  const tracks=author.exportTracks();
  assert.equal(tracks.length,1);
  assert.equal(tracks[0].id,0);
  assert.equal(tracks[0].keyframes[0].time,0);
  assert.equal(tracks[0].keyframes[1].time,0.5);
  assert.ok(Array.isArray(tracks[0].keyframes[0].position));
  author.reset();
  assert.deepEqual(Array.from(data.slice(0,3)),[1,0,0]);
});
