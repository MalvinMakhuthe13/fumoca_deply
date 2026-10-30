// FUMOCA support-plane analysis. Pure geometry only: preview first, never edits scan data.
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm=a=>Math.hypot(a[0],a[1],a[2]);
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const normalize=a=>{const n=norm(a);return n>1e-12?a.map(v=>v/n):null;};

/**
 * Fit a support plane to explicitly selected underside samples.
 * Selection is intentional: whole-object RANSAC can mistake a brim/crown plane
 * for the support surface. Returns null when evidence is weak or ambiguous.
 */
export function fitSelectedSupportPlane(positions, indices, options={}) {
  if(!positions||!indices||indices.length<30)return null;
  const points=[];
  const stride=Math.max(1,Math.floor(indices.length/(options.maxSamples||12000)));
  for(let k=0;k<indices.length;k+=stride){
    const i=indices[k],p=[positions[i*3],positions[i*3+1],positions[i*3+2]];
    if(Number.isInteger(i)&&i>=0&&p.every(Number.isFinite))points.push(p);
  }
  if(points.length<30)return null;
  const mins=[0,1,2].map(a=>Math.min(...points.map(p=>p[a])));
  const maxs=[0,1,2].map(a=>Math.max(...points.map(p=>p[a])));
  const diagonal=norm(sub(maxs,mins));if(!(diagonal>1e-8))return null;
  const tolerance=Math.max(diagonal*(options.toleranceRatio??0.006),1e-7);
  let seed=0x71c3a5d9;
  const rand=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
  let best=null,bestInliers=[];
  const iterations=options.iterations||500;
  for(let it=0;it<iterations;it++){
    const a=points[rand(points.length)],b=points[rand(points.length)],c=points[rand(points.length)];
    let n=normalize(cross(sub(b,a),sub(c,a)));if(!n)continue;
    let d=-dot(n,a),inliers=[];
    for(let i=0;i<points.length;i++)if(Math.abs(dot(n,points[i])+d)<=tolerance)inliers.push(i);
    if(inliers.length>bestInliers.length){best={normal:n,d};bestInliers=inliers;}
  }
  const required=Math.max(24,Math.ceil(points.length*(options.minInlierRatio??0.18)));
  if(!best||bestInliers.length<required)return null;
  // Refit plane from inlier covariance using a Jacobi eigensolver.
  const sample=bestInliers.map(i=>points[i]),center=[0,0,0];
  for(const p of sample)for(let a=0;a<3;a++)center[a]+=p[a]/sample.length;
  const A=[[0,0,0],[0,0,0],[0,0,0]];
  for(const p of sample)for(let r=0;r<3;r++)for(let c=0;c<3;c++)A[r][c]+=(p[r]-center[r])*(p[c]-center[c])/sample.length;
  const V=[[1,0,0],[0,1,0],[0,0,1]];
  for(let it=0;it<32;it++){
    let p=0,q=1;if(Math.abs(A[0][2])>Math.abs(A[p][q])){p=0;q=2;}if(Math.abs(A[1][2])>Math.abs(A[p][q])){p=1;q=2;}
    if(Math.abs(A[p][q])<1e-14)break;
    const theta=.5*Math.atan2(2*A[p][q],A[q][q]-A[p][p]),c=Math.cos(theta),s=Math.sin(theta),app=A[p][p],aqq=A[q][q],apq=A[p][q];
    A[p][p]=c*c*app-2*s*c*apq+s*s*aqq;A[q][q]=s*s*app+2*s*c*apq+c*c*aqq;A[p][q]=A[q][p]=0;
    for(let k=0;k<3;k++)if(k!==p&&k!==q){const x=A[k][p],y=A[k][q];A[k][p]=A[p][k]=c*x-s*y;A[k][q]=A[q][k]=s*x+c*y;}
    for(let k=0;k<3;k++){const x=V[k][p],y=V[k][q];V[k][p]=c*x-s*y;V[k][q]=s*x+c*y;}
  }
  let axis=0;if(A[1][1]<A[axis][axis])axis=1;if(A[2][2]<A[axis][axis])axis=2;
  let normal=normalize([V[0][axis],V[1][axis],V[2][axis]]);
  if(!normal)return null;
  // Orient normal toward the selected region's positive mean offset only for stable output.
  if(dot(normal,best.normal)<0)normal=normal.map(v=>-v);
  const residuals=sample.map(p=>Math.abs(dot(normal,sub(p,center))));
  residuals.sort((a,b)=>a-b);
  return {normal,point:center,offset:-dot(normal,center),inlierCount:sample.length,
    sampleCount:points.length,inlierRatio:sample.length/points.length,
    medianResidual:residuals[Math.floor(residuals.length*.5)],tolerance,method:'selected-ransac+pca'};
}

/** Classify candidate points on the negative side of a reviewed plane. */
export function previewSupportPlaneTrim(positions, alive, plane, options={}) {
  if(!positions||!alive||!plane||!plane.normal||!plane.point)return null;
  const margin=Math.max(0,options.margin??plane.tolerance??0);
  let below=0,above=0,near=0;
  for(let i=0;i<alive.length;i++)if(alive[i]){
    const p=[positions[i*3],positions[i*3+1],positions[i*3+2]];
    if(!p.every(Number.isFinite))continue;
    const distance=dot(plane.normal,sub(p,plane.point));
    if(distance < -margin)below++;else if(distance>margin)above++;else near++;
  }
  const total=below+above+near;
  return {below,above,near,total,trimRatio:total?below/total:0,margin,
    safe:total>0&&below>0&&below/total<=(options.maxTrimRatio??0.35)&&above>=30};
}
