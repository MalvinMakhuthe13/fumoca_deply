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
const plane=fitSelectedSupportPlane(new Float32Array(positions),selected,{orientationPoint:n.map(x=>x*.5)});
assert.ok(plane,'selected support plane should be found');
assert.ok(plane.normal.reduce((sum,x,i)=>sum+x*n[i],0)>.999,'support normal must point inward toward object interior');
assert.ok(plane.inlierRatio>.95,'support region should have high consensus');
assert.ok(plane.footprint&&plane.u&&plane.v,'fitted plane must retain the selected patch footprint');

// Build a realistic cap side, one underside wisp inside the patch, and an
// unrelated lower point far outside the selected patch footprint.
const scan=[...positions];
for(let i=0;i<40;i++)scan.push(...u.map((x,k)=>x*(i%5-2)*.1+v[k]*(Math.floor(i/5)-4)*.1+n[k]*.2));
const trimIndex=scan.length/3;scan.push(...n.map(x=>x*-.2));
const outsideIndex=scan.length/3;scan.push(...u.map((x,k)=>x*100+n[k]*-.2));
const state=new Float32Array(scan),alive=new Uint8Array(state.length/3);alive.fill(1);
const before=alive.slice(),positionsBefore=state.slice();
const preview=previewSupportPlaneTrim(state,alive,plane,{margin:.01,maxTrimRatio:.35,footprintPadding:.2});
assert.ok(preview&&preview.below>=1&&preview.above>=30,'preview must have trim candidates and retained cap evidence');
assert.ok(preview.safe,'bounded support trim should pass safety gate');
assert.ok(preview.trimIndices.includes(trimIndex),'underside wisp inside selected footprint should be a trim candidate');
assert.ok(!preview.trimIndices.includes(outsideIndex),'unrelated geometry outside selected footprint must be protected');
assert.ok(preview.outside>=1,'preview should report protected unrelated points');
assert.deepEqual(alive,before,'preview must not mutate visibility');
assert.deepEqual(state,positionsBefore,'preview must not mutate positions');

// Ambiguous/undersupported selections must fail closed.
assert.equal(fitSelectedSupportPlane(state,[0,1,2]),null,'too-small selections must be rejected');
console.log('Support-plane fitting, scoped trim preview, and non-destructive guarantees passed.');
