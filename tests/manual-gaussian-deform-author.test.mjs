import test from 'node:test';
import assert from 'node:assert/strict';
import { NIFManualGaussianDeformAuthor } from '../engine-next/animation/NIFManualGaussianDeformAuthor.js';

function fixture(points) {
  const data=new Float32Array(points.length*14);
  points.forEach((p,i)=>data.set([...p,0,0,0,1,0,0,0,0.8,0.2,0.3,0.4],i*14));
  return data;
}

test('ID selection and fold rotate selected Gaussians while preserving appearance',()=>{
  const data=fixture([[0,0,0],[1,0,0],[2,0,0]]);
  const author=new NIFManualGaussianDeformAuthor(data);
  author.selectIds([0,1]);
  author.apply({type:'fold',axis:[0,0,1],pivot:[0,0,0],angle:Math.PI/2});
  assert.ok(Math.abs(data[14])<1e-5);
  assert.ok(Math.abs(data[15]-1)<1e-5);
  for(let i=0;i<4;i++)assert.ok(Math.abs(data[10+i]-[0.8,0.2,0.3,0.4][i])<1e-6);
  assert.deepEqual(Array.from(data.slice(28,42)),Array.from(fixture([[2,0,0]])));
});

test('sphere selection uses a smooth falloff and additive ID selection',()=>{
  const author=new NIFManualGaussianDeformAuthor(fixture([[0,0,0],[0.75,0,0],[1,0,0],[2,0,0]]));
  author.selectSphere([0,0,0],1,{falloff:0.5});
  assert.equal(author.selection[0],1);
  assert.ok(author.selection[1]>0&&author.selection[1]<1);
  assert.equal(author.selection[2],0);
  author.selectIds([3],{mode:'add'});
  assert.equal(author.selection[3],1);
});

test('box selection and scale preserve opacity and colour channels',()=>{
  const data=fixture([[0,0,0],[1,0,0]]);
  const author=new NIFManualGaussianDeformAuthor(data);
  author.selectBox([-0.1,-1,-1],[1.1,1,1]);
  author.apply({type:'scale',pivot:[0,0,0],scale:[0.5,1,1]});
  assert.ok(Math.abs(data[17]-Math.log(0.5))<1e-5);
  for(let p=0;p<2;p++)for(let i=0;i<4;i++)assert.ok(Math.abs(data[p*14+10+i]-[0.8,0.2,0.3,0.4][i])<1e-6);
  assert.throws(()=>author.selectBox([1,0,0],[0,1,1]),/ordered/);
});

test('captured tracks include the rest pose and can be reset',()=>{
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
  assert.deepEqual(tracks[0].keyframes[0].position,[1,0,0]);
  author.reset();
  assert.deepEqual(Array.from(data.slice(0,3)),[1,0,0]);
});

test('twist distributes rotation over the full asset extent',()=>{
  const data=fixture([[0,0,0],[0,1,0],[0,2,0]]);
  const author=new NIFManualGaussianDeformAuthor(data);
  author.selectIds([0,1,2]);
  author.apply({type:'twist',axis:[0,1,0],pivot:[0,0,0],angle:Math.PI});
  assert.ok(Math.abs(data[0])<1e-6);
  assert.ok(Math.abs(data[28])<1e-6);
  assert.ok(Math.abs(data[29]-2)<1e-6);
});
