/**
 * NIFManualGaussianDeformAuthor
 *
 * Manual-first deformation authoring for native NIF Gaussian records.
 * Selection is explicit (stable Gaussian IDs or spatial brushes); transforms
 * are evaluated from an immutable rest pose to avoid cumulative drift.
 *
 * Record layout: [px,py,pz,sx,sy,sz,qw,qx,qy,qz,opacity,r,g,b].
 * Opacity and colour payload are never modified.
 */
const STRIDE = 14;
const EPS = 1e-8;
const vec = v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
const add = (a,b) => [a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const sub = (a,b) => [a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const mul = (a,s) => [a[0]*s,a[1]*s,a[2]*s];
const dot = (a,b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm = a => { const n=Math.hypot(...a); if(n<EPS) throw new Error('Axis must be non-zero'); return mul(a,1/n); };
const clamp = (x,a,b) => Math.max(a,Math.min(b,x));
const qnorm = q => { const n=Math.hypot(...q); if(n<EPS) throw new Error('Quaternion must be non-zero'); return q.map(x=>x/n); };
const qmul = (a,b) => {
  const [w,x,y,z]=a,[W,X,Y,Z]=b;
  return [w*W-x*X-y*Y-z*Z,w*X+x*W+y*Z-z*Y,w*Y-x*Z+y*W+z*X,w*Z+x*Y-y*X+z*W];
};
const qaxis = (axis,angle) => { const h=angle/2,s=Math.sin(h),a=norm(axis); return [Math.cos(h),a[0]*s,a[1]*s,a[2]*s]; };
const qrotate = (q,p) => {
  const u=[q[1],q[2],q[3]];
  return add(p,add(mul(cross(u,p),2*q[0]),mul(cross(u,cross(u,p)),2)));
};
const smooth = x => { x=clamp(x,0,1); return x*x*(3-2*x); };

export class NIFManualGaussianDeformAuthor {
  constructor(data, stableIds=null) {
    if(!(data instanceof Float32Array)||data.length%STRIDE) throw new TypeError('data must be Float32Array with 14-float Gaussian records');
    this.data=data;
    this.rest=data.slice();
    this.output=data.slice();
    this.count=data.length/STRIDE;
    this.ids=stableIds??Uint32Array.from({length:this.count},(_,i)=>i);
    if(!(this.ids instanceof Uint32Array)||this.ids.length!==this.count) throw new TypeError('stableIds must contain one Uint32 ID per Gaussian');
    this.indexById=new Map();
    for(let i=0;i<this.count;i++){if(this.indexById.has(this.ids[i]))throw new Error('Duplicate stable Gaussian ID');this.indexById.set(this.ids[i],i);}
    this.selection=new Float32Array(this.count);
    this.keyframes=new Map();
  }

  clearSelection(){ this.selection.fill(0); return this.selection; }

  selectIds(ids,{mode='replace',weight=1}={}) {
    if(mode==='replace') this.clearSelection();
    const w=clamp(Number(weight),0,1);
    for(const id of ids){const i=this.indexById.get(id);if(i===undefined)continue;this.selection[i]=mode==='add'?Math.max(this.selection[i],w):mode==='subtract'?0:w;}
    return this.selection;
  }

  selectSphere(center,radius,{falloff=0,mode='replace',weight=1}={}) {
    if(!vec(center)||!(radius>0)||!Number.isFinite(radius)) throw new TypeError('Sphere needs a finite center and positive radius');
    if(mode==='replace')this.clearSelection();
    const inner=radius*(1-clamp(falloff,0,1)),w=clamp(weight,0,1);
    for(let i=0;i<this.count;i++){
      const o=i*STRIDE,d=Math.hypot(this.rest[o]-center[0],this.rest[o+1]-center[1],this.rest[o+2]-center[2]);
      if(d>radius)continue;
      const f=d<=inner?1:1-smooth((d-inner)/Math.max(EPS,radius-inner));
      const value=w*f;
      this.selection[i]=mode==='subtract'?0:mode==='add'?Math.max(this.selection[i],value):value;
    }
    return this.selection;
  }

  selectBox(min,max,{falloff=0,mode='replace',weight=1}={}) {
    if(!vec(min)||!vec(max)||min.some((v,i)=>v>max[i]))throw new TypeError('Box bounds must be ordered xyz triples');
    if(mode==='replace')this.clearSelection();
    const f=clamp(falloff,0,1),w=clamp(weight,0,1);
    for(let i=0;i<this.count;i++){
      const o=i*STRIDE,p=[this.rest[o],this.rest[o+1],this.rest[o+2]];
      if(p.some((v,a)=>v<min[a]||v>max[a]))continue;
      const edge=Math.min(...p.map((v,a)=>Math.min(v-min[a],max[a]-v)));
      const span=Math.min(max[0]-min[0],max[1]-min[1],max[2]-min[2])*f*.5;
      const value=span>EPS?w*smooth(edge/span):w;
      this.selection[i]=mode==='subtract'?0:mode==='add'?Math.max(this.selection[i],value):value;
    }
    return this.selection;
  }

  apply({type='bend',axis=[0,1,0],pivot=[0,0,0],angle=0,amount=0,scale=[1,1,1],direction=[0,0,0],gradientAxis=null,gradientRange=null}={}) {
    if(!vec(axis)||!vec(pivot)||!vec(scale)||!vec(direction)||![angle,amount].every(Number.isFinite))throw new TypeError('Invalid deformation parameters');
    const a=norm(axis);
    const range=gradientAxis?norm(gradientAxis):null;
    for(let i=0;i<this.count;i++){
      const w=this.selection[i],o=i*STRIDE;
      if(w<=0){this.output.set(this.rest.subarray(o,o+STRIDE),o);continue;}
      const p=[this.rest[o],this.rest[o+1],this.rest[o+2]];
      const q=qnorm(Array.from(this.rest.subarray(o+6,o+10)));
      const s=[this.rest[o+3],this.rest[o+4],this.rest[o+5]];
      let next=p,rot=[1,0,0,0],scaleMul=[1,1,1];
      let localAngle=angle*w,localAmount=amount*w;
      if(range&&gradientRange){
        const t=clamp((dot(sub(p,pivot),range)-gradientRange[0])/(gradientRange[1]-gradientRange[0]||1),0,1);
        localAngle*=t;localAmount*=t;
      }
      if(type==='bend'||type==='fold'||type==='rotate'){
        rot=qaxis(a,localAngle);
        next=add(pivot,qrotate(rot,sub(p,pivot)));
      } else if(type==='twist'){
        const axial=dot(sub(p,pivot),a);
        rot=qaxis(a,localAngle*axial);
        next=add(pivot,qrotate(rot,sub(p,pivot)));
      } else if(type==='translate'){
        next=add(p,mul(direction,w));
      } else if(type==='scale'||type==='compress'){
        scaleMul=scale.map(v=>Math.exp(Math.log(Math.max(EPS,v))*w));
        const rel=sub(p,pivot);
        next=add(pivot,[rel[0]*scaleMul[0],rel[1]*scaleMul[1],rel[2]*scaleMul[2]]);
      } else throw new Error('Unsupported deformation type: '+type);
      const nq=qnorm(qmul(rot,q));
      this.output[o]=next[0];this.output[o+1]=next[1];this.output[o+2]=next[2];
      this.output[o+3]=s[0]+Math.log(Math.max(EPS,scaleMul[0]));
      this.output[o+4]=s[1]+Math.log(Math.max(EPS,scaleMul[1]));
      this.output[o+5]=s[2]+Math.log(Math.max(EPS,scaleMul[2]));
      this.output[o+6]=nq[0];this.output[o+7]=nq[1];this.output[o+8]=nq[2];this.output[o+9]=nq[3];
      this.output[o+10]=this.rest[o+10];this.output[o+11]=this.rest[o+11];this.output[o+12]=this.rest[o+12];this.output[o+13]=this.rest[o+13];
    }
    this.data.set(this.output);
    return this.data;
  }

  capture(time) {
    if(!Number.isFinite(time)||time<0)throw new RangeError('Keyframe time must be non-negative');
    const tracks=[];
    for(let i=0;i<this.count;i++){
      if(this.selection[i]<=0)continue;
      const o=i*STRIDE,b=this.rest,c=this.output;
      const changed=(a,z,n)=>{for(let k=0;k<n;k++)if(Math.abs(a[o+z+k]-b[o+z+k])>1e-6)return true;return false;};
      const keyframe={time};
      if(changed(c,0,3))keyframe.position=Array.from(c.subarray(o,o+3));
      if(changed(c,3,3))keyframe.scale=Array.from(c.subarray(o+3,o+6));
      if(changed(c,6,4))keyframe.rotation=Array.from(c.subarray(o+6,o+10));
      if(Object.keys(keyframe).length>1){
        const id=this.ids[i],list=this.keyframes.get(id)||[];
        const existing=list.findIndex(k=>Math.abs(k.time-time)<1e-8);
        if(existing>=0)list[existing]=keyframe;else list.push(keyframe);
        list.sort((a,z)=>a.time-z.time);this.keyframes.set(id,list);
        tracks.push({id,keyframe});
      }
    }
    return tracks;
  }

  exportTracks() {
    return [...this.keyframes.entries()].map(([id,keyframes])=>({id,keyframes:keyframes.map(k=>({...k}))}));
  }

  reset({clearKeyframes=false}={}) {
    this.output.set(this.rest);this.data.set(this.rest);this.selection.fill(0);
    if(clearKeyframes)this.keyframes.clear();
    return this.data;
  }
}
export default NIFManualGaussianDeformAuthor;
