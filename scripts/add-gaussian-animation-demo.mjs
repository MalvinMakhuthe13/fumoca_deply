#!/usr/bin/env node
/**
 * Add a small synthetic native Gaussian animation to an existing NIF.
 *
 * This is a QA fixture generator, not an automatic motion-reconstruction tool.
 * It animates an evenly sampled subset of splats vertically and returns them
 * to rest, allowing the NIF 1.2 runtime/timeline UI to be tested on real assets.
 *
 * Usage:
 *   node --experimental-default-type=module scripts/add-gaussian-animation-demo.mjs input.nif output-animated.nif
 */
import { readFile, writeFile } from 'node:fs/promises';
import { NIFReader, NIFChunk, CHUNK, encodeGaussianAnimationChunk } from '../engine-next/format/NIFSpec.js';

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  console.error('Usage: node --experimental-default-type=module scripts/add-gaussian-animation-demo.mjs input.nif output-animated.nif');
  process.exit(2);
}

const input = new Uint8Array(await readFile(inputPath));
const reader = new NIFReader(input);
if (!reader.isVersionSupported || reader.isCorrupted) {
  throw new Error('Input NIF has an unsupported major version or corrupted chunks');
}
const geometry = await reader.getGeometry();
if (!geometry?.count || !(geometry.data instanceof Float32Array)) {
  throw new Error('Input NIF has no decodable KEYFRAME_GEO');
}

let minY=Infinity,maxY=-Infinity,minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
for(let i=0;i<geometry.count;i++){
  const o=i*14,x=geometry.data[o],y=geometry.data[o+1],z=geometry.data[o+2];
  minX=Math.min(minX,x);maxX=Math.max(maxX,x);
  minY=Math.min(minY,y);maxY=Math.max(maxY,y);
  minZ=Math.min(minZ,z);maxZ=Math.max(maxZ,z);
}
const diagonal=Math.hypot(maxX-minX,maxY-minY,maxZ-minZ);
const amplitude=Math.max(diagonal*0.025,0.01);
const maxTracks=5000;
const stride=Math.max(1,Math.ceil(geometry.count/maxTracks));
const tracks=[];
for(let i=0;i<geometry.count;i+=stride){
  const o=i*14;
  const p=[geometry.data[o],geometry.data[o+1],geometry.data[o+2]];
  tracks.push({
    id:i,
    keyframes:[
      {time:0,position:p},
      {time:1,position:[p[0],p[1]+amplitude,p[2]]},
      {time:2,position:p},
    ],
  });
}
const gaussianIds=Array.from({length:geometry.count},(_,i)=>i);
const animation={
  schema:'fumoca.gaussian-animation',
  version:1,
  duration:2,
  gaussianIds,
  tracks,
};
const animationChunk=encodeGaussianAnimationChunk(animation);
const header=input.slice(0,256);
header[4]=1;
header[5]=2;
const headerView=new DataView(header.buffer,header.byteOffset,header.byteLength);
headerView.setUint16(18,61,false);
headerView.setFloat32(20,2,false);
const parts=[header];
for(const chunk of reader.chunks){
  if(chunk.type===CHUNK.GAUSSIAN_ANIMATION)continue;
  parts.push(new NIFChunk(chunk.type,chunk.data,chunk.codec).toUint8Array());
}
parts.push(animationChunk.toUint8Array());
const total=parts.reduce((sum,p)=>sum+p.byteLength,0);
const output=new Uint8Array(total);
let offset=0;
for(const part of parts){output.set(part,offset);offset+=part.byteLength;}
await writeFile(outputPath,output);
console.log(`Created ${outputPath}`);
console.log(`Base splats: ${geometry.count.toLocaleString()} | Animated splats: ${tracks.length.toLocaleString()} | Duration: 2s | Vertical amplitude: ${amplitude.toFixed(4)} scene units`);
console.log('This is a synthetic playback QA animation, not reconstructed real motion.');
