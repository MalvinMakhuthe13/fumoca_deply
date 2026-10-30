import assert from 'node:assert/strict';
import { fitSelectedSupportPlane, previewSupportPlaneTrim, detectAutomaticSupportPlane } from '../js/modules/support-plane.js';

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
// Scale-aware trim: a Gaussian whose centre is slightly above the plane
// must still be removed when its covariance ellipsoid visibly crosses below.
const scaleScan=[...scan,...n.map(x=>x*.03)];
const scaleAlive=new Uint8Array(scaleScan.length/3);scaleAlive.fill(1);
const scaleXYZ=new Float32Array(scaleAlive.length*3);
const crossingIndex=scaleAlive.length-1;
scaleXYZ.set([.1,.1,.1],crossingIndex*3);
const scalePreview=previewSupportPlaneTrim(new Float32Array(scaleScan),scaleAlive,plane,{
  margin:.005,footprintPadding:.2,maxTrimRatio:.35,scaleXYZ,extentSigma:2.5
});
assert.ok(scalePreview?.trimIndices.includes(crossingIndex),'near-plane Gaussian with an ellipsoid crossing the support plane must be trimmed');
assert.equal(scalePreview.centerBelow,0,'scale-aware candidate is allowed to have its centre above the plane');
assert.ok(scalePreview.crossing>=1,'preview must report ellipsoid-plane intersections');

console.log('Support-plane fitting, scoped trim preview, and non-destructive guarantees passed.');


// Automatic mode: tilted support plane plus the object body above it. No
// manual selection is supplied; the detector must return a review candidate.
const autoPositions=[];
const autoAlive=[];
for(let a=-18;a<=18;a++)for(let b=-18;b<=18;b++){
  const noise=Math.sin(a*11+b*7)*0.00015;
  autoPositions.push(...u.map((x,i)=>x*a+v[i]*b+n[i]*noise));
  autoAlive.push(1);
}
for(let i=0;i<1800;i++){
  const aa=(Math.sin(i*13)*.5+.5)*30-15;
  const bb=(Math.cos(i*17)*.5+.5)*30-15;
  const hh=.15+(Math.sin(i*23)*.5+.5)*8;
  autoPositions.push(...u.map((x,k)=>x*aa+v[k]*bb+n[k]*hh));
  autoAlive.push(1);
}
const autoPlane=detectAutomaticSupportPlane(new Float32Array(autoPositions),new Uint8Array(autoAlive),{iterations:700});
assert.ok(autoPlane,'automatic detector should find a broad boundary support plane');
assert.ok(Math.abs(autoPlane.normal.reduce((sum,x,i)=>sum+x*n[i],0))>.99,'automatic support normal should match the tilted base');
assert.equal(autoPlane.method,'automatic-boundary-ransac+pca','automatic result should be clearly identified');

// A clean underside with no material below it must still be eligible for
// leveling/seating; zero trim candidates is not a reason to reject a plane.
const cleanExtra=[];
for(let i=0;i<50;i++)cleanExtra.push(...u.map((x,k)=>x*((i%10)-5)*.1+v[k]*(Math.floor(i/10)-2)*.1+n[k]*(.2+(i%7)*.03)));
const cleanPositions=new Float32Array([...positions,...cleanExtra]);
const cleanAlive=new Uint8Array(cleanPositions.length/3);cleanAlive.fill(1);
const cleanPlane=fitSelectedSupportPlane(cleanPositions,selected,{orientationPoint:n.map(x=>x*.5)});
const cleanPreview=previewSupportPlaneTrim(cleanPositions,cleanAlive,cleanPlane,{margin:.01});
assert.ok(cleanPreview?.safe,'a valid clean base must be safe even when there are no trim candidates');
assert.equal(cleanPreview.below,0,'clean base should not invent trim candidates');
console.log('Automatic support-plane detection and clean-base seating checks passed.');
