/**
 * NIFGaussianAnimator — native animation tracks for Gaussian records.
 *
 * Tracks address splats by stable IDs, not transient render/sort order.
 * Each keyframe may animate position, log-scale and quaternion; opacity and
 * colour/SH payload remain unchanged from the base Gaussian data.
 *
 * Record layout: [px,py,pz,sx,sy,sz,qw,qx,qy,qz,opacity,r,g,b] (14 Float32s).
 * Scale values are the renderer's stored log-scales, not world-space radii.
 *
 * The evaluator writes into one reusable Float32Array and allocates no arrays
 * in the per-frame evaluation loop. File persistence is handled by NIFSpec.
 */
const STRIDE = 14;
const EPS = 1e-8;
const finite3 = v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
const finite4 = v => Array.isArray(v) && v.length === 4 && v.every(Number.isFinite);
const normalizeQuat = q => {
  const n = Math.hypot(...q);
  if (n < EPS) throw new Error('Animation quaternion must be non-zero');
  return q.map(x => x / n);
};

function ease(t,mode){if(mode==='ease-in')return t*t;if(mode==='ease-out')return 1-(1-t)*(1-t);if(mode==='ease-in-out')return t<.5?2*t*t:1-Math.pow(-2*t+2,2)/2;return t;}
function segment(keys, time) {
  if (time <= keys[0].time) return -1;
  if (time >= keys[keys.length - 1].time) return keys.length - 1;
  let lo = 0, hi = keys.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1;
    if (keys[mid].time <= time) lo = mid;
    else hi = mid;
  }
  return lo;
}
function writeVec3(keys, time, base, out, offset) {
  if (!keys.length) {
    out[offset] = base[offset]; out[offset+1] = base[offset+1]; out[offset+2] = base[offset+2];
    return;
  }
  const i = segment(keys, time);
  if (i < 0) {
    const v = keys[0].value;
    out[offset]=v[0]; out[offset+1]=v[1]; out[offset+2]=v[2]; return;
  }
  if (i === keys.length - 1) {
    const v = keys[i].value;
    out[offset]=v[0]; out[offset+1]=v[1]; out[offset+2]=v[2]; return;
  }
  const a=keys[i], b=keys[i+1], t=ease((time-a.time)/(b.time-a.time),a.easing);
  out[offset]=a.value[0]+(b.value[0]-a.value[0])*t;
  out[offset+1]=a.value[1]+(b.value[1]-a.value[1])*t;
  out[offset+2]=a.value[2]+(b.value[2]-a.value[2])*t;
}
function writeQuat(keys, time, base, out, offset) {
  if (!keys.length) {
    out[offset]=base[offset]; out[offset+1]=base[offset+1];
    out[offset+2]=base[offset+2]; out[offset+3]=base[offset+3]; return;
  }
  const i=segment(keys,time);
  let a,b,t;
  if(i<0){a=keys[0].value;b=a;t=0;}
  else if(i===keys.length-1){a=keys[i].value;b=a;t=0;}
  else {a=keys[i].value;b=keys[i+1].value;t=ease((time-keys[i].time)/(keys[i+1].time-keys[i].time),keys[i].easing);}
  let dot=a[0]*b[0]+a[1]*b[1]+a[2]*b[2]+a[3]*b[3];
  let bw=b[0],bx=b[1],by=b[2],bz=b[3];
  if(dot<0){dot=-dot;bw=-bw;bx=-bx;by=-by;bz=-bz;}
  let aw,ax,ay,az;
  if(dot>0.9995){aw=a[0]+(bw-a[0])*t;ax=a[1]+(bx-a[1])*t;ay=a[2]+(by-a[2])*t;az=a[3]+(bz-a[3])*t;}
  else {
    const theta=Math.acos(Math.max(-1,Math.min(1,dot))),sin=Math.sin(theta);
    const wa=Math.sin((1-t)*theta)/sin,wb=Math.sin(t*theta)/sin;
    aw=a[0]*wa+bw*wb;ax=a[1]*wa+bx*wb;ay=a[2]*wa+by*wb;az=a[3]*wa+bz*wb;
  }
  const norm=Math.hypot(aw,ax,ay,az)||1;
  out[offset]=aw/norm;out[offset+1]=ax/norm;out[offset+2]=ay/norm;out[offset+3]=az/norm;
}

export class NIFGaussianAnimator {
  constructor(gaussians, tracks, stableIds = null) {
    if (!(gaussians?.data instanceof Float32Array) || gaussians.data.length % STRIDE) {
      throw new TypeError('gaussians.data must be Float32Array records of 14 floats');
    }
    this.gaussians=gaussians;
    this.base=gaussians.data.slice();
    this.output=new Float32Array(this.base.length);
    this.count=this.base.length/STRIDE;
    this.ids=stableIds??Uint32Array.from({length:this.count},(_,i)=>i);
    if(!(this.ids instanceof Uint32Array)||this.ids.length!==this.count) throw new TypeError('stableIds must be a Uint32Array with one ID per Gaussian');
    this.indexById=new Map();
    for(let i=0;i<this.ids.length;i++){
      if(this.indexById.has(this.ids[i])) throw new Error(`Duplicate stable Gaussian ID: ${this.ids[i]}`);
      this.indexById.set(this.ids[i],i);
    }
    if(!Array.isArray(tracks)) throw new TypeError('tracks must be an array');
    this.tracks=tracks.map(track=>{
      if(!this.indexById.has(track?.id)) throw new Error(`Unknown Gaussian ID: ${track?.id}`);
      if(!Array.isArray(track.keyframes)||!track.keyframes.length) throw new Error('Each track needs keyframes');
      let previous=-Infinity;
      const keys=track.keyframes.map(key=>{
        if(!Number.isFinite(key.time)||key.time<0||key.time<=previous) throw new Error('Keyframe times must be finite, non-negative and strictly increasing');
        previous=key.time;
        const out={time:key.time,easing:key.easing??'linear'};
        if(key.position!=null){if(!finite3(key.position))throw new Error('position must be a finite xyz triple');out.position=key.position.slice();}
        if(key.scale!=null){if(!finite3(key.scale))throw new Error('scale must be a finite xyz triple');out.scale=key.scale.slice();}
        if(key.rotation!=null){if(!finite4(key.rotation))throw new Error('rotation must be a finite wxyz quaternion');out.rotation=normalizeQuat(key.rotation);}
        return out;
      });
      if(!keys.some(k=>k.position||k.scale||k.rotation)) throw new Error('Track has no animated properties');
      return {
        offset:this.indexById.get(track.id)*STRIDE,
        positionKeys:keys.filter(k=>k.position).map(k=>({time:k.time,value:k.position})),
        scaleKeys:keys.filter(k=>k.scale).map(k=>({time:k.time,value:k.scale})),
        rotationKeys:keys.filter(k=>k.rotation).map(k=>({time:k.time,value:k.rotation})),
      };
    });
  }

  evaluate(time) {
    if(!Number.isFinite(time)||time<0) throw new RangeError('Animation time must be finite and non-negative');
    this.output.set(this.base);
    for(const track of this.tracks){
      const o=track.offset;
      writeVec3(track.positionKeys,time,this.base,this.output,o);
      writeVec3(track.scaleKeys,time,this.base,this.output,o+3);
      writeQuat(track.rotationKeys,time,this.base,this.output,o+6);
    }
    this.gaussians.data=this.output;
    return this.output;
  }

  reset(){
    this.output.set(this.base);
    this.gaussians.data=this.output;
    return this.output;
  }
}
