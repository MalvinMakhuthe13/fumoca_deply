/**
 * NIFProxyDeformer
 *
 * Transfers an animated proxy mesh's deformation to Gaussian records.
 * This is the browser/runtime counterpart of the Blender/Houdini workflows:
 * bind once against a rest proxy, then update from animated proxy vertices.
 *
 * Gaussian record layout: [px,py,pz,sx,sy,sz,qw,qx,qy,qz,opacity,r,g,b].
 *
 * Binding uses the closest point on a proxy triangle, barycentric coordinates,
 * and a local-frame offset. Per-frame updates are O(number of splats), not
 * O(splats × triangles). The closest-triangle bind is O(splats × triangles)
 * and should run in a worker for large assets in a later optimization.
 *
 * Limitations: this first runtime implementation is intended for moderate
 * proxy meshes. It transfers position, orientation and axis scale. It does not
 * solve cloth/topology changes, remeshing, self-intersections or SH rotation.
 */

const EPS = 1e-8;
const v = (a, b) => [a[0], a[1], a[2]];
const add = (a,b) => [a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const sub = (a,b) => [a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const mul = (a,s) => [a[0]*s,a[1]*s,a[2]*s];
const dot = (a,b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const len = a => Math.hypot(a[0],a[1],a[2]);
const norm = a => { const l=len(a); return l>EPS?mul(a,1/l):[0,0,1]; };
const clamp = (x,a,b) => Math.max(a,Math.min(b,x));

function closestTriangle(p,a,b,c) {
  const ab=sub(b,a), ac=sub(c,a), ap=sub(p,a);
  const d1=dot(ab,ap), d2=dot(ac,ap);
  if(d1<=0&&d2<=0) return {w:[1,0,0],point:a};
  const bp=sub(p,b), d3=dot(ab,bp), d4=dot(ac,bp);
  if(d3>=0&&d4<=d3) return {w:[0,1,0],point:b};
  const vc=d1*d4-d3*d2;
  if(vc<=0&&d1>=0&&d3<=0){const t=d1/(d1-d3);return {w:[1-t,t,0],point:add(a,mul(ab,t))};}
  const cp=sub(p,c), d5=dot(ab,cp), d6=dot(ac,cp);
  if(d6>=0&&d5<=d6) return {w:[0,0,1],point:c};
  const vb=d5*d2-d1*d6;
  if(vb<=0&&d2>=0&&d6<=0){const t=d2/(d2-d6);return {w:[1-t,0,t],point:add(a,mul(ac,t))};}
  const va=d3*d6-d5*d4;
  if(va<=0&&(d4-d3)>=0&&(d5-d6)>=0){const t=(d4-d3)/((d4-d3)+(d5-d6));return {w:[0,1-t,t],point:add(b,mul(sub(c,b),t))};}
  const denom=1/(va+vb+vc), y=vb*denom, z=vc*denom, x=1-y-z;
  return {w:[x,y,z],point:add(add(mul(a,x),mul(b,y)),mul(c,z))};
}
function frame(a,b,c) {
  const x=norm(sub(b,a));
  const raw=sub(c,a);
  const z=norm(cross(x,raw));
  const y=norm(cross(z,x));
  return {x,y,z,origin:a};
}
function local(frame,p) {
  const d=sub(p,frame.origin);
  return [dot(d,frame.x),dot(d,frame.y),dot(d,frame.z)];
}
function world(frame,p) {
  return add(frame.origin,add(add(mul(frame.x,p[0]),mul(frame.y,p[1])),mul(frame.z,p[2])));
}
function quatFromBasis(x,y,z) {
  const m00=x[0],m01=y[0],m02=z[0],m10=x[1],m11=y[1],m12=z[1],m20=x[2],m21=y[2],m22=z[2];
  const tr=m00+m11+m22; let w,qx,qy,qz;
  if(tr>0){const s=Math.sqrt(tr+1)*2;w=.25*s;qx=(m21-m12)/s;qy=(m02-m20)/s;qz=(m10-m01)/s;}
  else if(m00>m11&&m00>m22){const s=Math.sqrt(1+m00-m11-m22)*2;w=(m21-m12)/s;qx=.25*s;qy=(m01+m10)/s;qz=(m02+m20)/s;}
  else if(m11>m22){const s=Math.sqrt(1+m11-m00-m22)*2;w=(m02-m20)/s;qx=(m01+m10)/s;qy=.25*s;qz=(m12+m21)/s;}
  else {const s=Math.sqrt(1+m22-m00-m11)*2;w=(m10-m01)/s;qx=(m02+m20)/s;qy=(m12+m21)/s;qz=.25*s;}
  return [w,qx,qy,qz];
}
function quatMul(a,b) {
  const [w,x,y,z]=a,[W,X,Y,Z]=b;
  return [w*W-x*X-y*Y-z*Z,w*X+x*W+y*Z-z*Y,w*Y-x*Z+y*W+z*X,w*Z+x*Y-y*X+z*W];
}
function quatNorm(q){const l=Math.hypot(...q)||1;return q.map(x=>x/l);}
function quatInv(q){return [q[0],-q[1],-q[2],-q[3]];}
function quatRotate(q,p) {
  const [w,x,y,z]=q, u=[x,y,z];
  return add(p,add(mul(cross(u,p),2*w),mul(cross(u,cross(u,p)),2)));
}
function readVec(array,i){return [array[i*3],array[i*3+1],array[i*3+2]];}

export class NIFProxyDeformer {
  constructor(restVertices, triangles, gaussianData, options={}) {
    if(!(restVertices instanceof Float32Array)||restVertices.length%3) throw new TypeError('restVertices must be Float32Array xyz triples');
    if(!(triangles instanceof Uint32Array)||triangles.length%3) throw new TypeError('triangles must be Uint32Array triangle indices');
    if(!(gaussianData instanceof Float32Array)||gaussianData.length%14) throw new TypeError('gaussianData must use the 14-float NIF Gaussian layout');
    if(!triangles.length) throw new Error('Proxy mesh has no triangles');
    this.rest=restVertices.slice(); this.triangles=triangles.slice();
    this.base=gaussianData.slice(); this.output=gaussianData.slice();
    this.maxBindDistance=Number.isFinite(options.maxBindDistance)?options.maxBindDistance:Infinity;
    this.bindings=[];
    const count=this.base.length/14;
    for(let i=0;i<count;i++){
      const p=readVec(this.base,i).slice();
      let best=null,bestD=Infinity;
      for(let t=0;t<this.triangles.length;t+=3){
        const ia=this.triangles[t],ib=this.triangles[t+1],ic=this.triangles[t+2];
        if(ia*3+2>=this.rest.length||ib*3+2>=this.rest.length||ic*3+2>=this.rest.length) throw new RangeError('Proxy triangle index is out of range');
        const a=readVec(this.rest,ia),b=readVec(this.rest,ib),c=readVec(this.rest,ic);
        const candidate=closestTriangle(p,a,b,c), d=len(sub(p,candidate.point));
        if(d<bestD){bestD=d;best={ia,ib,ic,w:candidate.w,point:candidate.point,frame:frame(a,b,c)};}
      }
      if(!best||bestD>this.maxBindDistance) throw new Error(`Gaussian ${i} is outside the proxy bind distance`);
      best.offset=local(best.frame,p);
      this.bindings.push(best);
    }
    this.count=count;
  }
  update(deformedVertices) {
    if(!(deformedVertices instanceof Float32Array)||deformedVertices.length!==this.rest.length) throw new TypeError('deformedVertices must match the rest proxy vertex buffer');
    const out=this.output;
    for(let i=0;i<this.count;i++){
      const b=this.bindings[i],a=readVec(deformedVertices,b.ia),c=readVec(deformedVertices,b.ib),d=readVec(deformedVertices,b.ic);
      const current=frame(a,c,d);
      const pos=world(current,b.offset);
      const currentFrameQ=quatFromBasis(current.x,current.y,current.z);
      const restFrameQ=quatFromBasis(b.frame.x,b.frame.y,b.frame.z);
      const delta=quatNorm(quatMul(currentFrameQ,quatInv(restFrameQ)));
      const restQ=[this.base[i*14+6],this.base[i*14+7],this.base[i*14+8],this.base[i*14+9]];
      const q=quatNorm(quatMul(delta,restQ));
      const ratios=[
        len(sub(c,a))/Math.max(EPS,len(sub(readVec(this.rest,b.ib),readVec(this.rest,b.ia)))),
        len(sub(d,a))/Math.max(EPS,len(sub(readVec(this.rest,b.ic),readVec(this.rest,b.ia)))),
        len(cross(sub(c,a),sub(d,a)))/Math.max(EPS,len(cross(sub(readVec(this.rest,b.ib),readVec(this.rest,b.ia)),sub(readVec(this.rest,b.ic),readVec(this.rest,b.ia)))))
      ];
      const base=i*14;
      out[base]=pos[0];out[base+1]=pos[1];out[base+2]=pos[2];
      out[base+3]=this.base[base+3]*clamp(ratios[0],.01,100);
      out[base+4]=this.base[base+4]*clamp(ratios[1],.01,100);
      out[base+5]=this.base[base+5]*clamp(ratios[2],.01,100);
      out[base+6]=q[0];out[base+7]=q[1];out[base+8]=q[2];out[base+9]=q[3];
      out[base+10]=this.base[base+10];
      out[base+11]=this.base[base+11];out[base+12]=this.base[base+12];out[base+13]=this.base[base+13];
    }
    return out;
  }
  reset(){this.output.set(this.base);return this.output;}
}
export default NIFProxyDeformer;
