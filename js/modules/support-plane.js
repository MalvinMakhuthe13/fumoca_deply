// FUMOCA support-plane analysis. Pure geometry only: preview first, never edits scan data.
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm=a=>Math.hypot(a[0],a[1],a[2]);
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const normalize=a=>{const n=norm(a);return n>1e-12?a.map(v=>v/n):null;};

/** Fit a plane only from the user's explicitly selected underside patch. */
export function fitSelectedSupportPlane(positions, indices, options={}) {
  if(!positions||!indices||indices.length<30)return null;
  const points=[];
  const stride=Math.max(1,Math.floor(indices.length/(options.maxSamples||12000)));
  for(let k=0;k<indices.length;k+=stride){
    const i=indices[k];if(!Number.isInteger(i)||i<0||i*3+2>=positions.length)continue;
    const p=[positions[i*3],positions[i*3+1],positions[i*3+2]];
    if(p.every(Number.isFinite))points.push(p);
  }
  if(points.length<30)return null;
  const mins=[0,1,2].map(a=>Math.min(...points.map(p=>p[a])));
  const maxs=[0,1,2].map(a=>Math.max(...points.map(p=>p[a])));
  const diagonal=norm(sub(maxs,mins));if(!(diagonal>1e-8))return null;
  const tolerance=Math.max(diagonal*(options.toleranceRatio??0.006),1e-7);
  let seed=0x71c3a5d9;
  const rand=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
  let bestNormal=null,bestInliers=[];
  for(let it=0;it<(options.iterations||500);it++){
    const a=points[rand(points.length)],b=points[rand(points.length)],c=points[rand(points.length)];
    const n=normalize(cross(sub(b,a),sub(c,a)));if(!n)continue;
    const inliers=[];
    for(let i=0;i<points.length;i++)if(Math.abs(dot(n,sub(points[i],a)))<=tolerance)inliers.push(i);
    if(inliers.length>bestInliers.length){bestNormal=n;bestInliers=inliers;}
  }
  const required=Math.max(24,Math.ceil(points.length*(options.minInlierRatio??0.18)));
  if(!bestNormal||bestInliers.length<required)return null;
  const sample=bestInliers.map(i=>points[i]),center=[0,0,0];
  for(const p of sample)for(let a=0;a<3;a++)center[a]+=p[a]/sample.length;
  const A=[[0,0,0],[0,0,0],[0,0,0]],V=[[1,0,0],[0,1,0],[0,0,1]];
  for(const p of sample)for(let r=0;r<3;r++)for(let c=0;c<3;c++)A[r][c]+=(p[r]-center[r])*(p[c]-center[c])/sample.length;
  for(let it=0;it<32;it++){
    let p=0,q=1;if(Math.abs(A[0][2])>Math.abs(A[p][q])){p=0;q=2;}if(Math.abs(A[1][2])>Math.abs(A[p][q])){p=1;q=2;}
    if(Math.abs(A[p][q])<1e-14)break;
    const theta=.5*Math.atan2(2*A[p][q],A[q][q]-A[p][p]),c=Math.cos(theta),s=Math.sin(theta),app=A[p][p],aqq=A[q][q],apq=A[p][q];
    A[p][p]=c*c*app-2*s*c*apq+s*s*aqq;A[q][q]=s*s*app+2*s*c*apq+c*c*aqq;A[p][q]=A[q][p]=0;
    for(let k=0;k<3;k++)if(k!==p&&k!==q){const x=A[k][p],y=A[k][q];A[k][p]=A[p][k]=c*x-s*y;A[k][q]=A[q][k]=s*x+c*y;}
    for(let k=0;k<3;k++){const x=V[k][p],y=V[k][q];V[k][p]=c*x-s*y;V[k][q]=s*x+c*y;}
  }
  let axis=0;if(A[1][1]<A[axis][axis])axis=1;if(A[2][2]<A[axis][axis])axis=2;
  let normal=normalize([V[0][axis],V[1][axis],V[2][axis]]);if(!normal)return null;
  if(options.orientationPoint){if(dot(normal,sub(options.orientationPoint,center))<0)normal=normal.map(v=>-v);}
  else if(dot(normal,bestNormal)<0)normal=normal.map(v=>-v);
  // Construct stable in-plane axes and retain the selected patch's footprint.
  const ref=Math.abs(normal[1])<.9?[0,1,0]:[1,0,0];
  const u=normalize(cross(ref,normal)),v=normalize(cross(normal,u));
  const projected=sample.map(p=>{const d=sub(p,center);return [dot(d,u),dot(d,v)];});
  const footprint={minU:Math.min(...projected.map(p=>p[0])),maxU:Math.max(...projected.map(p=>p[0])),minV:Math.min(...projected.map(p=>p[1])),maxV:Math.max(...projected.map(p=>p[1]))};
  const residuals=sample.map(p=>Math.abs(dot(normal,sub(p,center)))).sort((a,b)=>a-b);
  return {normal,point:center,offset:-dot(normal,center),u,v,footprint,inlierCount:sample.length,
    sampleCount:points.length,inlierRatio:sample.length/points.length,
    medianResidual:residuals[Math.floor(residuals.length*.5)],tolerance,method:'selected-ransac+pca'};
}

/**
 * Trim candidates only inside an expanded footprint around the selected support
 * patch. This prevents a plane from deleting unrelated geometry elsewhere.
 * The returned indices are a review result; input arrays are never modified.
 */
export function previewSupportPlaneTrim(positions, alive, plane, options={}) {
  if(!positions||!alive||!plane?.normal||!plane?.point||!plane?.footprint||!plane?.u||!plane?.v)return null;
  const margin=Math.max(0,options.margin??plane.tolerance??0),padding=Math.max(0,options.footprintPadding??0.2);
  const f=plane.footprint,du=(f.maxU-f.minU)*padding,dv=(f.maxV-f.minV)*padding;
  const trimIndices=[];let below=0,above=0,near=0,outside=0;
  const scales=options.scaleXYZ||null,rotations=options.rotation||null;
  const order=options.rotationOrder||'wxyz',sigma=Math.max(0,options.extentSigma??2.5);
  const projectedRadius=(i)=>{
    if(!scales)return 0;
    const o=i*3,sx=Math.max(0,scales[o]||0),sy=Math.max(0,scales[o+1]||0),sz=Math.max(0,scales[o+2]||0);
    if(!(sx+sy+sz>0))return 0;
    let rx=[1,0,0],ry=[0,1,0],rz=[0,0,1];
    if(rotations){
      const q=i*4,x=rotations[q+(order==='xyzw'?0:1)],y=rotations[q+(order==='xyzw'?1:2)],z=rotations[q+(order==='xyzw'?2:3)],w=rotations[q+(order==='xyzw'?3:0)];
      const rotate=(v)=>{const tx=2*(y*v[2]-z*v[1]),ty=2*(z*v[0]-x*v[2]),tz=2*(x*v[1]-y*v[0]);return [v[0]+w*tx+(y*tz-z*ty),v[1]+w*ty+(z*tx-x*tz),v[2]+w*tz+(x*ty-y*tx)];};
      rx=rotate(rx);ry=rotate(ry);rz=rotate(rz);
    }
    const n=plane.normal;
    return sigma*Math.sqrt((sx*dot(n,rx))**2+(sy*dot(n,ry))**2+(sz*dot(n,rz))**2);
  };
  let centerBelow=0,crossing=0;
  for(let i=0;i<alive.length;i++)if(alive[i]){
    const o=i*3;if(o+2>=positions.length)continue;
    const p=[positions[o],positions[o+1],positions[o+2]];if(!p.every(Number.isFinite))continue;
    const delta=sub(p,plane.point),pu=dot(delta,plane.u),pv=dot(delta,plane.v);
    if(pu<f.minU-du||pu>f.maxU+du||pv<f.minV-dv||pv>f.maxV+dv){outside++;continue;}
    const distance=dot(plane.normal,delta),extent=projectedRadius(i);
    // Remove centres below the plane and near-plane Gaussians whose visible
    // covariance ellipsoid hangs through it. Do not trim splats well inside
    // the object merely because they are large.
    const reachesBelow=extent>0&&distance<extent-margin&&distance<=extent*.35;
    if(distance < -margin || reachesBelow){below++;trimIndices.push(i);if(distance<0)centerBelow++;if(reachesBelow)crossing++;}
    else if(distance>margin)above++;else near++;
  }
  const total=below+above+near;
  return {below,above,near,outside,total,trimIndices,trimRatio:total?below/total:0,centerBelow,crossing,margin,footprintPadding:padding,
    safe:total>0&&below/total<=(options.maxTrimRatio??0.35)&&above>=30};
}


/**
 * Find a likely support plane from the complete live scan without requiring
 * a manual point selection. This is deliberately a candidate detector:
 * it only returns a plane and never edits the scan. A human-reviewed preview
 * remains mandatory before Level / Trim / Seat can mutate Gaussian data.
 *
 * The candidate must be a broad boundary plane with almost all scan points
 * on its inward side. Ambiguous or weak planes fail closed.
 */
export function detectAutomaticSupportPlane(positions, alive, options={}) {
  if(!positions || !alive || alive.length<60 || positions.length<alive.length*3) return null;
  const maxSamples=Math.max(500,Math.min(options.maxSamples||9000,alive.length));
  const stride=Math.max(1,Math.floor(alive.length/maxSamples));
  const points=[],indices=[],center=[0,0,0],mins=[Infinity,Infinity,Infinity],maxs=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<alive.length;i+=stride) {
    if(!alive[i]) continue;
    const o=i*3,p=[positions[o],positions[o+1],positions[o+2]];
    if(!p.every(Number.isFinite)) continue;
    points.push(p);indices.push(i);
    for(let a=0;a<3;a++){center[a]+=p[a];mins[a]=Math.min(mins[a],p[a]);maxs[a]=Math.max(maxs[a],p[a]);}
  }
  if(points.length<60)return null;
  for(let a=0;a<3;a++)center[a]/=points.length;
  const diagonal=norm(sub(maxs,mins));
  if(!(diagonal>1e-8))return null;
  const tolerance=Math.max(diagonal*(options.toleranceRatio??0.006),1e-7);
  let seed=0x4b1d2a73;
  const rand=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
  let best=null,bestScore=0;
  const iterations=options.iterations||420;
  for(let it=0;it<iterations;it++){
    const ia=rand(points.length),ib=rand(points.length),ic=rand(points.length);
    if(ia===ib||ia===ic||ib===ic)continue;
    const a=points[ia],b=points[ib],c=points[ic];
    let normal=normalize(cross(sub(b,a),sub(c,a)));
    if(!normal)continue;
    if(dot(normal,sub(center,a))<0)normal=normal.map(v=>-v);
    const inliers=[];let below=0;
    for(let k=0;k<points.length;k++){
      const d=dot(normal,sub(points[k],a));
      if(d < -tolerance)below++;
      if(Math.abs(d)<=tolerance)inliers.push(k);
    }
    const ratio=inliers.length/points.length,belowRatio=below/points.length;
    if(inliers.length<Math.max(30,points.length*(options.minInlierRatio??0.012)))continue;
    if(belowRatio>(options.maxOppositeRatio??0.025))continue;
    const ref=Math.abs(normal[1])<.9?[0,1,0]:[1,0,0];
    const u=normalize(cross(ref,normal)),v=normalize(cross(normal,u));
    let minU=Infinity,maxU=-Infinity,minV=Infinity,maxV=-Infinity;
    for(const k of inliers){const d=sub(points[k],a),pu=dot(d,u),pv=dot(d,v);minU=Math.min(minU,pu);maxU=Math.max(maxU,pu);minV=Math.min(minV,pv);maxV=Math.max(maxV,pv);}
    const area=Math.max(0,(maxU-minU)*(maxV-minV));
    const footprint=Math.sqrt(area)/diagonal;
    const score=ratio*Math.min(1,footprint)*Math.max(0,1-belowRatio*12);
    if(score>bestScore){bestScore=score;best={indices:inliers.map(k=>indices[k]),ratio,belowRatio,score};}
  }
  if(!best)return null;
  const plane=fitSelectedSupportPlane(positions,best.indices,{
    maxSamples:Math.min(12000,best.indices.length),
    toleranceRatio:options.toleranceRatio??0.006,
    minInlierRatio:options.refineInlierRatio??0.55,
    iterations:Math.min(500,options.refineIterations||300),
    orientationPoint:center
  });
  if(!plane)return null;
  plane.method='automatic-boundary-ransac+pca';
  plane.candidateInlierRatio=best.ratio;
  plane.oppositeSideRatio=best.belowRatio;
  plane.confidence=best.score;
  return plane;
}
