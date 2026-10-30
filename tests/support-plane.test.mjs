import assert from 'node:assert/strict';
import { fitSelectedSupportPlane, previewSupportPlaneTrim } from '../js/modules/support-plane.js';

const normal=[0.31,0.88,-0.36],length=Math.hypot(...normal),n=normal.map(v=>v/length);
let u=[n[1],-n[0],0];let ul=Math.hypot(...u);u=u.map(v=>v/ul);
const v=[n[1]*u[2]-n[2]*u[1],n[2]*u[0]-n[0]*u[2],n[0]*u[1]-n[1]*u[0]];
const positions=[];
for(let a=-20;a<=20;a++)for(let b=-20;b<=20;b++){
 const noise=Math.sin(a*17+b*13)*0.0002;
 positions.push(...u.map((x,i)=>x*a+v[i]*b+n[i]*noise));
}
const selected=Array.from({length:positions.length/3},(_,i)=>i);
const plane=fitSelectedSupportPlane(new Float32Array(positions),selected);
assert.ok(plane,'selected support plane should be found');
assert.ok(Math.abs(plane.normal.reduce((sum,x,i)=>sum+x*n[i],0))>.999,'plane normal should match');
assert.ok(plane.inlierRatio>.95,'support region should have high consensus');

// Preview classifies points without mutating either input array.
const scan=new Float32Array([...positions,...n.map(x=>x*-.2),...n.map(x=>x*.2)]);
const alive=new Uint8Array(scan.length/3);alive.fill(1);
const before=alive.slice();
const preview=previewSupportPlaneTrim(scan,alive,plane,{margin:.01,maxTrimRatio:.35});
assert.ok(preview&&preview.below>=1&&preview.above>=1,'trim preview should identify both sides');
assert.deepEqual(alive,before,'preview must not mutate scan state');
assert.equal(preview.safe,true,'small trim preview should pass safety gate');
console.log('Support-plane analysis and non-destructive trim preview tests passed.');
