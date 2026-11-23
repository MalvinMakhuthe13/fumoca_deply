/**
 * NIFManualGaussianDeformAuthor
 * Manual-first Gaussian deformation, selection, keyframe and history core.
 * Record layout: [px,py,pz,sx,sy,sz,qw,qx,qy,qz,opacity,r,g,b].
 * Opacity and colour are preserved by every transform.
 */
const STRIDE=14, EPS=1e-8;
const vec=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const mul=(a,s)=>[a[0]*s,a[1]*s,a[2]*s];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm=a=>{const n=Math.hypot(...a);if(n<EPS)throw new Error('Axis must be non-zero');return mul(a,1/n);};
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const qnorm=q=>{const n=Math.hypot(...q);if(n<EPS)throw new Error('Quaternion must be non-zero');return q.map(x=>x/n);};
const qmul=(a,b)=>{const [w,x,y,z]=a,[W,X,Y,Z]=b;return [w*W-x*X-y*Y-z*Z,w*X+x*W+y*Z-z*Y,w*Y-x*Z+y*W+z*X,w*Z+x*Y-y*X+z*W];};
const qaxis=(axis,angle)=>{const h=angle/2,s=Math.sin(h),a=norm(axis);return [Math.cos(h),a[0]*s,a[1]*s,a[2]*s];};
const qrotate=(q,p)=>{const u=[q[1],q[2],q[3]];return add(p,add(mul(cross(u,p),2*q[0]),mul(cross(u,cross(u,p)),2)));};
const smooth=x=>{x=clamp(x,0,1);return x*x*(3-2*x);};

export class NIFManualGaussianDeformAuthor {
  constructor(data,stableIds=null){
    if(!(data instanceof Float32Array)||data.length%STRIDE)throw new TypeError('data must be Float32Array with 14-float Gaussian records');
    this.data=data;this.rest=data.slice();this.output=data.slice();this.count=data.length/STRIDE;
    this.ids=stableIds??Uint32Array.from({length:this.count},(_,i)=>i);
    if(!(this.ids instanceof Uint32Array)||this.ids.length!==this.count)throw new TypeError('stableIds must contain one Uint32 ID per Gaussian');
    this.indexById=new Map();
    for(let i=0;i<this.count;i++){if(this.indexById.has(this.ids[i]))throw new Error('Duplicate stable Gaussian ID');this.indexById.set(this.ids[i],i);}
    this.selection=new Float32Array(this.count);this.keyframes=new Map();this.selectionSets=new Map();
    this.layers=new Map([['Main',true]]);this.activeLayer='Main';
    this.undoStack=[];this.redoStack=[];
    this.historyLimit=Math.max(1,Math.min(24,Math.floor((64*1024*1024)/Math.max(1,this.data.byteLength))));
  }
  clearSelection(){this.selection.fill(0);return this.selection;}
  invertSelection(){for(let i=0;i<this.count;i++)this.selection[i]=1-this.selection[i];return this.selection;}
  saveSelection(name){if(typeof name!=='string'||!name.trim())throw new TypeError('Selection set needs a name');this.selectionSets.set(name.trim(),this.selection.slice());return name.trim();}
  loadSelection(name){const saved=this.selectionSets.get(name);if(!saved)return false;this.selection.set(saved);return this.selection;}
  deleteSelection(name){return this.selectionSets.delete(name);}
  createLayer(name){if(typeof name!=='string'||!name.trim())throw new TypeError('Layer needs a name');name=name.trim();if(this.layers.has(name))throw new Error('Layer already exists');this.layers.set(name,true);this.activeLayer=name;return name;}
  setLayerEnabled(name,enabled){if(!this.layers.has(name))return false;this.layers.set(name,!!enabled);return true;}
  setActiveLayer(name){if(!this.layers.has(name))return false;this.activeLayer=name;return true;}
  deleteLayer(name){if(name==='Main'||!this.layers.has(name))return false;this.layers.delete(name);for(const [id,keys] of this.keyframes){const keep=keys.filter(k=>(k.layer||'Main')!==name);if(keep.length)this.keyframes.set(id,keep);else this.keyframes.delete(id);}if(this.activeLayer===name)this.activeLayer='Main';return true;}
  _snapshot(){return {data:this.data.slice(),keyframes:new Map([...this.keyframes].map(([id,keys])=>[id,keys.map(k=>({...k}))]))};}
  _checkpoint(label='edit'){this.undoStack.push({label,...this._snapshot()});if(this.undoStack.length>this.historyLimit)this.undoStack.shift();this.redoStack.length=0;}
  undo(){const p=this.undoStack.pop();if(!p)return false;this.redoStack.push({label:p.label,...this._snapshot()});this.data.set(p.data);this.output.set(p.data);this.keyframes=p.keyframes;return true;}
  redo(){const n=this.redoStack.pop();if(!n)return false;this.undoStack.push({label:n.label,...this._snapshot()});this.data.set(n.data);this.output.set(n.data);this.keyframes=n.keyframes;return true;}
  selectIds(ids,{mode='replace',weight=1}={}){if(mode==='replace')this.clearSelection();const w=clamp(Number(weight),0,1);for(const id of ids){const i=this.indexById.get(id);if(i===undefined)continue;this.selection[i]=mode==='add'?Math.max(this.selection[i],w):mode==='subtract'?0:w;}return this.selection;}
  selectSphere(center,radius,{falloff=0,mode='replace',weight=1}={}){if(!vec(center)||!(radius>0)||!Number.isFinite(radius))throw new TypeError('Sphere needs a finite center and positive radius');if(mode==='replace')this.clearSelection();const inner=radius*(1-clamp(falloff,0,1)),w=clamp(weight,0,1);for(let i=0;i<this.count;i++){const o=i*STRIDE,d=Math.hypot(this.rest[o]-center[0],this.rest[o+1]-center[1],this.rest[o+2]-center[2]);if(d>radius)continue;const f=d<=inner?1:1-smooth((d-inner)/Math.max(EPS,radius-inner)),v=w*f;this.selection[i]=mode==='subtract'?0:mode==='add'?Math.max(this.selection[i],v):v;}return this.selection;}
  selectBox(min,max,{falloff=0,mode='replace',weight=1}={}){if(!vec(min)||!vec(max)||min.some((v,i)=>v>max[i]))throw new TypeError('Box bounds must be ordered xyz triples');if(mode==='replace')this.clearSelection();const f=clamp(falloff,0,1),w=clamp(weight,0,1);for(let i=0;i<this.count;i++){const o=i*STRIDE,p=[this.rest[o],this.rest[o+1],this.rest[o+2]];if(p.some((v,a)=>v<min[a]||v>max[a]))continue;const edge=Math.min(...p.map((v,a)=>Math.min(v-min[a],max[a]-v))),span=Math.min(max[0]-min[0],max[1]-min[1],max[2]-min[2])*f*.5,v=span>EPS?w*smooth(edge/span):w;this.selection[i]=mode==='subtract'?0:mode==='add'?Math.max(this.selection[i],v):v;}return this.selection;}
  selectScreenBrush(projectedXY,center,radius,{falloff=0,mode='replace',weight=1,depths=null,depthRange=null}={}){if(!(projectedXY instanceof Float32Array)||projectedXY.length!==this.count*2)throw new TypeError('projectedXY must contain screen-space xy pairs');if(!Array.isArray(center)||center.length!==2||!center.every(Number.isFinite)||!(radius>0))throw new TypeError('Brush needs finite center and positive radius');if(depths&&(!(depths instanceof Float32Array)||depths.length!==this.count))throw new TypeError('depths must contain one depth per Gaussian');if(mode==='replace')this.clearSelection();const inner=radius*(1-clamp(falloff,0,1)),w=clamp(weight,0,1);for(let i=0;i<this.count;i++){const dx=projectedXY[i*2]-center[0],dy=projectedXY[i*2+1]-center[1],d=Math.hypot(dx,dy);if(d>radius)continue;if(depths&&depthRange&&(depths[i]<depthRange[0]||depths[i]>depthRange[1]))continue;const v=w*(d<=inner?1:1-smooth((d-inner)/Math.max(EPS,radius-inner)));this.selection[i]=mode==='subtract'?0:mode==='add'?Math.max(this.selection[i],v):v;}return this.selection;}
  selectLasso(projectedXY,polygon,{mode='replace',weight=1,depths=null,depthRange=null}={}){if(!(projectedXY instanceof Float32Array)||projectedXY.length!==this.count*2)throw new TypeError('projectedXY must contain screen-space xy pairs');if(!Array.isArray(polygon)||polygon.length<3||polygon.some(p=>!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)))throw new TypeError('Lasso needs at least three points');if(depths&&(!(depths instanceof Float32Array)||depths.length!==this.count))throw new TypeError('depths must contain one depth per Gaussian');if(mode==='replace')this.clearSelection();const inside=(x,y)=>{let hit=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[i],b=polygon[j];if(((a[1]>y)!==(b[1]>y))&&(x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]))hit=!hit;}return hit;};const w=clamp(weight,0,1);for(let i=0;i<this.count;i++){if(!inside(projectedXY[i*2],projectedXY[i*2+1]))continue;if(depths&&depthRange&&(depths[i]<depthRange[0]||depths[i]>depthRange[1]))continue;this.selection[i]=mode==='subtract'?0:mode==='add'?Math.max(this.selection[i],w):w;}return this.selection;}
  growSelection(radius,{iterations=1,falloff=.5}={}){if(!(radius>0)||!Number.isFinite(radius))throw new TypeError('Growth radius must be positive');const r2=radius*radius;for(let pass=0;pass<Math.max(1,Math.floor(iterations));pass++){const next=this.selection.slice();for(let i=0;i<this.count;i++){if(this.selection[i]<=0)continue;const o=i*STRIDE,p=[this.rest[o],this.rest[o+1],this.rest[o+2]];for(let j=0;j<this.count;j++){if(next[j]>=this.selection[i])continue;const q=j*STRIDE,dx=this.rest[q]-p[0],dy=this.rest[q+1]-p[1],dz=this.rest[q+2]-p[2],d2=dx*dx+dy*dy+dz*dz;if(d2<=r2){const v=this.selection[i]*(1-clamp(falloff,0,1)*Math.sqrt(d2/r2));if(v>next[j])next[j]=v;}}}this.selection.set(next);}return this.selection;}
  apply({type='bend',axis=[0,1,0],pivot=[0,0,0],angle=0,amount=0,scale=[1,1,1],direction=[0,0,0],gradientAxis=null,gradientRange=null}={}){
    if(!vec(axis)||!vec(pivot)||!vec(scale)||!vec(direction)||![angle,amount].every(Number.isFinite)||scale.some(v=>v<=0))throw new TypeError('Invalid deformation parameters');
    const a=norm(axis),range=gradientAxis?norm(gradientAxis):null;
    this._checkpoint(type);
    let minAx=Infinity,maxAx=-Infinity;if(type==='twist'){for(let i=0;i<this.count;i++){const o=i*STRIDE,v=dot(sub([this.rest[o],this.rest[o+1],this.rest[o+2]],pivot),a);minAx=Math.min(minAx,v);maxAx=Math.max(maxAx,v);}}
    const extent=Math.max(EPS,maxAx-minAx);
    for(let i=0;i<this.count;i++){const w=this.selection[i],o=i*STRIDE;if(w<=0){this.output.set(this.rest.subarray(o,o+STRIDE),o);continue;}
      const p=[this.rest[o],this.rest[o+1],this.rest[o+2]],q=qnorm(Array.from(this.rest.subarray(o+6,o+10))),s=[this.rest[o+3],this.rest[o+4],this.rest[o+5]];
      let next=p,rot=[1,0,0,0],scaleMul=[1,1,1],localAngle=angle*w,localAmount=amount*w;
      if(range&&gradientRange){const t=clamp((dot(sub(p,pivot),range)-gradientRange[0])/(gradientRange[1]-gradientRange[0]||1),0,1);localAngle*=t;localAmount*=t;}
      if(type==='bend'||type==='fold'||type==='rotate'){rot=qaxis(a,localAngle);next=add(pivot,qrotate(rot,sub(p,pivot)));}
      else if(type==='twist'){const axial=dot(sub(p,pivot),a);rot=qaxis(a,localAngle*(axial-minAx)/extent);next=add(pivot,qrotate(rot,sub(p,pivot)));}
      else if(type==='translate'){next=add(p,mul(direction,w));}
      else if(type==='inflate'||type==='deflate'){const radial=norm(sub(p,pivot));const delta=localAmount*(type==='deflate'?-1:1);next=add(p,mul(radial,delta));const f=Math.max(EPS,1+delta/Math.max(EPS,Math.hypot(...sub(p,pivot))));scaleMul=[f,f,f];}
      else if(type==='scale'||type==='compress'){scaleMul=scale.map(v=>Math.exp(Math.log(Math.max(EPS,v))*w));const rel=sub(p,pivot);next=add(pivot,[rel[0]*scaleMul[0],rel[1]*scaleMul[1],rel[2]*scaleMul[2]]);}
      else throw new Error('Unsupported deformation type: '+type);
      const nq=qnorm(qmul(rot,q));this.output[o]=next[0];this.output[o+1]=next[1];this.output[o+2]=next[2];
      this.output[o+3]=s[0]+Math.log(Math.max(EPS,scaleMul[0]));this.output[o+4]=s[1]+Math.log(Math.max(EPS,scaleMul[1]));this.output[o+5]=s[2]+Math.log(Math.max(EPS,scaleMul[2]));
      this.output[o+6]=nq[0];this.output[o+7]=nq[1];this.output[o+8]=nq[2];this.output[o+9]=nq[3];
      this.output[o+10]=this.rest[o+10];this.output[o+11]=this.rest[o+11];this.output[o+12]=this.rest[o+12];this.output[o+13]=this.rest[o+13];
    }this.data.set(this.output);return this.data;
  }
  capture(time){if(!Number.isFinite(time)||time<0)throw new RangeError('Keyframe time must be non-negative');const tracks=[];for(let i=0;i<this.count;i++){if(this.selection[i]<=0)continue;const o=i*STRIDE,b=this.rest,c=this.output,keyframe={time,layer:this.activeLayer};const changed=(z,n)=>{for(let k=0;k<n;k++)if(Math.abs(c[o+z+k]-b[o+z+k])>1e-6)return true;return false;};if(changed(0,3))keyframe.position=Array.from(c.subarray(o,o+3));if(changed(3,3))keyframe.scale=Array.from(c.subarray(o+3,o+6));if(changed(6,4))keyframe.rotation=Array.from(c.subarray(o+6,o+10));if(Object.keys(keyframe).length>2){const id=this.ids[i],list=this.keyframes.get(id)||[],existing=list.findIndex(k=>Math.abs(k.time-time)<1e-8&&(k.layer||'Main')===this.activeLayer);if(existing>=0)list[existing]=keyframe;else list.push(keyframe);list.sort((x,y)=>x.time-y.time);this.keyframes.set(id,list);tracks.push({id,keyframe});}}return tracks;}
  deleteKeyframe(time,{layer=this.activeLayer,ids=null}={}){this._checkpoint('delete-keyframe');const allowed=ids?new Set(ids):null;let removed=0;for(const [id,keys] of this.keyframes){if(allowed&&!allowed.has(id))continue;const next=keys.filter(k=>{const hit=Math.abs(k.time-time)<1e-8&&(k.layer||'Main')===layer;if(hit)removed++;return !hit;});if(next.length)this.keyframes.set(id,next);else this.keyframes.delete(id);}return removed;}
  moveKeyframe(from,to,{layer=this.activeLayer,ids=null}={}){if(!Number.isFinite(from)||!Number.isFinite(to)||to<0)throw new RangeError('Invalid keyframe time');this._checkpoint('move-keyframe');const allowed=ids?new Set(ids):null;let moved=0;for(const [id,keys] of this.keyframes){if(allowed&&!allowed.has(id))continue;for(const k of keys)if(Math.abs(k.time-from)<1e-8&&(k.layer||'Main')===layer){k.time=to;moved++;}keys.sort((a,b)=>a.time-b.time);}return moved;}
  exportTracks(){return [...this.keyframes.entries()].map(([id,keys])=>{const merged=new Map();for(const k of keys){if(this.layers.get(k.layer||'Main')===false)continue;const value=merged.get(k.time)||{time:k.time};for(const prop of ['position','scale','rotation'])if(k[prop])value[prop]=k[prop].slice();merged.set(k.time,value);}return {id,keyframes:[...merged.values()].sort((a,b)=>a.time-b.time)};}).filter(t=>t.keyframes.length);}
  reset({clearKeyframes=false}={}){this._checkpoint('reset');this.output.set(this.rest);this.data.set(this.rest);this.selection.fill(0);if(clearKeyframes)this.keyframes.clear();return this.data;}
}
export default NIFManualGaussianDeformAuthor;
