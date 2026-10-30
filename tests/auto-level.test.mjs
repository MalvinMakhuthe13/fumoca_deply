import assert from 'node:assert/strict';
import { estimateLevelNormal } from '../js/modules/auto-level.js';

const expected = [0.31, 0.88, -0.36];
const norm = Math.hypot(...expected);
const n = expected.map(v => v / norm);
let u = [n[1], -n[0], 0];
let ul = Math.hypot(...u); u = u.map(v => v / ul);
const v = [n[1]*u[2]-n[2]*u[1], n[2]*u[0]-n[0]*u[2], n[0]*u[1]-n[1]*u[0]];
const positions = [];
for (let a=-15; a<=15; a++) for (let b=-15; b<=15; b++) {
  const noise = Math.sin(a*19+b*7)*0.0005;
  positions.push(...u.map((x,i)=>x*a+v[i]*b+n[i]*noise));
}
// Add outliers so the test verifies robust plane detection, not a global PCA guess.
for (let i=0;i<300;i++) positions.push(Math.sin(i*17)*8,Math.cos(i*11)*7,Math.sin(i*5)*6);
const indices = Array.from({length:positions.length/3},(_,i)=>i);
const result = estimateLevelNormal(new Float32Array(positions),indices);
assert.ok(result, 'plane estimate should exist');
assert.equal(result.method,'plane','RANSAC should identify the broad support plane');
const dot = Math.abs(result.normal.reduce((sum,value,i)=>sum+value*n[i],0));
assert.ok(dot > 0.995, 'estimated normal should match the tilted plane');
console.log('Auto-level support-plane test passed.');
