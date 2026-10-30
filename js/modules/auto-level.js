export function estimateLevelNormal(positions, indices, options = {}) {
  if (!positions || !indices || indices.length < 30) return null;
  const points=[],maxSamples=Math.min(options.maxSamples||10000,indices.length),stride=Math.max(1,Math.floor(indices.length/maxSamples));
  for(let n=0;n<indices.length;n+=stride){const i=indices[n],p=[positions[i*3],positions[i*3+1],positions[i*3+2]];if(p.every(Number.isFinite))points.push(p);}
  if(points.length<30)return null;
  const mins=[Infinity,Infinity,Infinity],maxs=[-Infinity,-Infinity,-Infinity];
  for(const p of points)for(let a=0;a<3;a++){mins[a]=Math.min(mins[a],p[a]);maxs[a]=Math.max(maxs[a],p[a]);}
  const diagonal=Math.hypot(maxs[0]-mins[0],maxs[1]-mins[1],maxs[2]-mins[2]);if(!(diagonal>1e-8))return null;
  const threshold=Math.max(diagonal*(options.planeToleranceRatio||0.008),1e-6);
  let best=null,bestCount=0,seed=0x51f15e;
  const rand=limit=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%limit;};
  const iterations=options.iterations||220;
  for(let it=0;it<iterations;it++){
    const a=points[rand(points.length)],b=points[rand(points.length)],c=points[rand(points.length)];
    const ab=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],ac=[c[0]-a[0],c[1]-a[1],c[2]-a[2]];
    const nx=ab[1]*ac[2]-ab[2]*ac[1],ny=ab[2]*ac[0]-ab[0]*ac[2],nz=ab[0]*ac[1]-ab[1]*ac[0],len=Math.hypot(nx,ny,nz);
    if(len<diagonal*1e-7)continue;
    const normal=[nx/len,ny/len,nz/len],d=-(normal[0]*a[0]+normal[1]*a[1]+normal[2]*a[2]);let count=0;
    for(const p of points)if(Math.abs(normal[0]*p[0]+normal[1]*p[1]+normal[2]*p[2]+d)<=threshold)count++;
    if(count>bestCount){bestCount=count;best={normal,method:'plane'};}
  }
  if(best&&bestCount>=Math.max(30,points.length*0.08))return best;
  const mean=[0,0,0];for(const p of points)for(let a=0;a<3;a++)mean[a]+=p[a]/points.length;
  const A=[[0,0,0],[0,0,0],[0,0,0]],V=[[1,0,0],[0,1,0],[0,0,1]];
  for(const p of points)for(let r=0;r<3;r++)for(let c=0;c<3;c++)A[r][c]+=(p[r]-mean[r])*(p[c]-mean[c])/points.length;
  for(let iter=0;iter<24;iter++){
    let p=0,q=1;if(Math.abs(A[0][2])>Math.abs(A[p][q])){p=0;q=2;}if(Math.abs(A[1][2])>Math.abs(A[p][q])){p=1;q=2;}
    if(Math.abs(A[p][q])<1e-12)break;
    const theta=.5*Math.atan2(2*A[p][q],A[q][q]-A[p][p]),c=Math.cos(theta),s=Math.sin(theta),app=A[p][p],aqq=A[q][q],apq=A[p][q];
    A[p][p]=c*c*app-2*s*c*apq+s*s*aqq;A[q][q]=s*s*app+2*s*c*apq+c*c*aqq;A[p][q]=A[q][p]=0;
    for(let k=0;k<3;k++)if(k!==p&&k!==q){const akp=A[k][p],akq=A[k][q];A[k][p]=A[p][k]=c*akp-s*akq;A[k][q]=A[q][k]=s*akp+c*akq;}
    for(let k=0;k<3;k++){const vkp=V[k][p],vkq=V[k][q];V[k][p]=c*vkp-s*vkq;V[k][q]=s*vkp+c*vkq;}
  }
  let axis=0;if(A[1][1]<A[axis][axis])axis=1;if(A[2][2]<A[axis][axis])axis=2;
  return {normal:[V[0][axis],V[1][axis],V[2][axis]],method:'pca'};
}
