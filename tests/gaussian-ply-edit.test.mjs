import assert from 'node:assert/strict';
import { makeEditedGaussianPlyBytes } from '../js/modules/gaussian-ply-edit.js';

function fixture(newline='\n') {
  const properties=[
    ['x','float'],['y','float'],['z','float'],['opacity','float'],
    ['scale_0','float'],['scale_1','float'],['scale_2','float'],
    ['rot_0','float'],['rot_1','float'],['rot_2','float'],['rot_3','float'],
    ['f_dc_0','float']
  ];
  const header=[
    'ply','format binary_little_endian 1.0','element vertex 2',
    ...properties.map(([name,type])=>`property ${type} ${name}`),'end_header',''
  ].join(newline);
  const headerBytes=new TextEncoder().encode(header);
  const rowBytes=properties.length*4;
  const bytes=new Uint8Array(headerBytes.length+rowBytes*2);
  bytes.set(headerBytes);
  const view=new DataView(bytes.buffer);
  const offsets=Object.fromEntries(properties.map(([name],i)=>[name,i*4]));
  for(let row=0;row<2;row++){
    const base=headerBytes.length+row*rowBytes;
    const values={x:row+1,y:row+2,z:row+3,opacity:0,scale_0:Math.log(.1),scale_1:Math.log(.2),scale_2:Math.log(.3),rot_0:1,rot_1:0,rot_2:0,rot_3:0,f_dc_0:.123};
    for(const [name,value] of Object.entries(values))view.setFloat32(base+offsets[name],value,true);
  }
  return {bytes,headerBytes,rowBytes,offsets};
}
function check(newline) {
  const source=fixture(newline);
  const state={
    alive:new Uint8Array([1,0]),
    positions:new Float32Array([10,20,30,40,50,60]),
    scaleXYZ:new Float32Array([.2,.3,.4,.5,.6,.7]),
    rotation:new Float32Array([Math.SQRT1_2,0,Math.SQRT1_2,0,1,0,0,0]),
    opacity:new Float32Array([.75,.25])
  };
  const output=makeEditedGaussianPlyBytes(source.bytes,state);
  const headerText=new TextDecoder().decode(output.subarray(0,source.headerBytes.length));
  assert.match(headerText,/element vertex 1/);
  assert.equal(output.length,source.headerBytes.length+source.rowBytes);
  const view=new DataView(output.buffer,output.byteOffset,output.byteLength);
  const base=source.headerBytes.length,at=name=>base+source.offsets[name];
  assert.equal(view.getFloat32(at('x'),true),10);
  assert.equal(view.getFloat32(at('y'),true),20);
  assert.equal(view.getFloat32(at('z'),true),30);
  assert.ok(Math.abs(view.getFloat32(at('opacity'),true)-Math.log(3))<1e-6);
  assert.ok(Math.abs(view.getFloat32(at('scale_0'),true)-Math.log(.2))<1e-6);
  assert.ok(Math.abs(view.getFloat32(at('scale_1'),true)-Math.log(.3))<1e-6);
  assert.ok(Math.abs(view.getFloat32(at('scale_2'),true)-Math.log(.4))<1e-6);
  assert.ok(Math.abs(view.getFloat32(at('rot_0'),true)-Math.SQRT1_2)<1e-6);
  assert.ok(Math.abs(view.getFloat32(at('rot_2'),true)-Math.SQRT1_2)<1e-6);
  assert.ok(Math.abs(view.getFloat32(at('f_dc_0'),true)-.123)<1e-6);
}
check('\n');
check('\r\n');
const source=fixture();
assert.throws(()=>makeEditedGaussianPlyBytes(source.bytes,{alive:new Uint8Array([1]),positions:new Float32Array(3)}),/do not match/);
const trailing=new Uint8Array(source.bytes.length+1);trailing.set(source.bytes);
assert.throws(()=>makeEditedGaussianPlyBytes(trailing,{alive:new Uint8Array([1,1]),positions:new Float32Array(6)}),/trailing elements/);
console.log('Binary Gaussian PLY edit/export tests passed (LF + CRLF, position, scale, opacity, rotation, SH preservation, deletion).');
