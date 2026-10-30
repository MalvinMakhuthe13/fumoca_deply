/**
 * FUMOCA Present — screen graphics and real 3D surface decals.
 * World decals are THREE meshes in the active Studio/viewer scene. They are
 * saved as image data + world transform, never as screen percentages.
 */
import * as THREE from 'three';

let root = null, items = [], editing = false, placingId = null, onChange = null, raf = 0;
const MAX_IMAGE_BYTES = 300 * 1024;
const MAX_ANCHOR_HIT_PX = 72;
const uid = () => 'mi_' + Math.random().toString(36).slice(2, 10);
const camera = () => window._fumocaViewerCamera || window._fumocaViewer?.camera || window._fumocaCamera || null;
const scene = () => window._fumocaViewerScene || window._fumocaViewer?.scene || window._fumocaScene || null;
const host = () => document.getElementById('viewport') || document.getElementById('stage') || document.getElementById('stageHost') || document.body;
const stageRect = () => ensureRoot().getBoundingClientRect();

function ensureRoot() {
  if (root?.isConnected) return root;
  root = document.getElementById('magazineImageLayer');
  if (!root) {
    root = document.createElement('div');
    root.id = 'magazineImageLayer';
    root.className = 'mi-layer';
    host().appendChild(root);
  }
  return root;
}
function notify() { onChange?.(exportAll()); }
function disposeDecal(item) {
  if (!item.decal) return;
  item.decal.parent?.remove(item.decal);
  item.decal.geometry?.dispose?.();
  const mat = item.decal.material;
  if (mat?.map) mat.map.dispose();
  mat?.dispose?.();
  item.decal = null;
}
function renderItem(item) {
  const wrap = document.createElement('div');
  wrap.className = 'mi-item';
  wrap.dataset.id = item.id;
  const img = document.createElement('img');
  img.src = item.src; img.alt = item.name || 'Scene logo'; img.draggable = false;
  wrap.appendChild(img);
  Object.assign(wrap.style, {
    width: (item.width || 18) + '%', opacity: String(item.opacity ?? 1),
    zIndex: String(30 + (item.z || 0)), pointerEvents: editing && item.mode !== 'world' ? 'auto' : 'none',
    cursor: editing ? 'move' : 'default',
    display: item.mode === 'world' ? 'none' : 'flex'
  });
  if (editing && item.mode !== 'world') wrap.addEventListener('pointerdown', e => dragStart(e,item,wrap));
  return wrap;
}
function dragStart(e,item,el) {
  if (placingId) return;
  e.preventDefault(); e.stopPropagation();
  const rect = host().getBoundingClientRect();
  const move = ev => {
    item.sx = Math.max(2,Math.min(98,((ev.clientX-rect.left)/rect.width)*100));
    item.sy = Math.max(2,Math.min(98,((ev.clientY-rect.top)/rect.height)*100));
    el.style.left = item.sx+'%'; el.style.top = item.sy+'%';
  };
  const up = () => { window.removeEventListener('pointermove',move); window.removeEventListener('pointerup',up); notify(); };
  window.addEventListener('pointermove',move); window.addEventListener('pointerup',up,{once:true});
}

// Jacobi diagonalisation of a symmetric 3x3 covariance matrix; smallest
// eigenvector is the local tangent-plane normal.
function covarianceNormal(points, origin) {
  if (points.length < 8) return null;
  let cx=0,cy=0,cz=0;
  for (const p of points) { cx+=p[0]; cy+=p[1]; cz+=p[2]; }
  cx/=points.length; cy/=points.length; cz/=points.length;
  let a=[[0,0,0],[0,0,0],[0,0,0]];
  for (const p of points) {
    const d=[p[0]-cx,p[1]-cy,p[2]-cz];
    for(let r=0;r<3;r++) for(let c=0;c<3;c++) a[r][c]+=d[r]*d[c];
  }
  let v=[[1,0,0],[0,1,0],[0,0,1]];
  for(let iter=0;iter<16;iter++) {
    let p=0,q=1;
    if(Math.abs(a[0][2])>Math.abs(a[p][q])){p=0;q=2;}
    if(Math.abs(a[1][2])>Math.abs(a[p][q])){p=1;q=2;}
    if(Math.abs(a[p][q])<1e-12) break;
    const phi=.5*Math.atan2(2*a[p][q],a[q][q]-a[p][p]), c=Math.cos(phi), s=Math.sin(phi);
    const app=c*c*a[p][p]-2*s*c*a[p][q]+s*s*a[q][q];
    const aqq=s*s*a[p][p]+2*s*c*a[p][q]+c*c*a[q][q];
    for(let k=0;k<3;k++) if(k!==p&&k!==q) {
      const akp=a[k][p], akq=a[k][q];
      a[k][p]=a[p][k]=c*akp-s*akq; a[k][q]=a[q][k]=s*akp+c*akq;
    }
    a[p][p]=app; a[q][q]=aqq; a[p][q]=a[q][p]=0;
    for(let k=0;k<3;k++){const vp=v[k][p],vq=v[k][q];v[k][p]=c*vp-s*vq;v[k][q]=s*vp+c*vq;}
  }
  const order=[0,1,2].sort((i,j)=>a[i][i]-a[j][j]);
  const sum=Math.max(1e-12,a[0][0]+a[1][1]+a[2][2]);
  if(a[order[0]][order[0]]/sum>.28) return null; // too volumetric/no stable surface
  const n=new THREE.Vector3(v[0][order[0]],v[1][order[0]],v[2][order[0]]).normalize();
  if(!Number.isFinite(n.x+n.y+n.z)) return null;
  return n;
}
function nearestGaussian(event) {
  const cam=camera(), cloud=window.S, positions=cloud?.positions;
  if(!cam || !positions?.length) return null;
  const rect=stageRect();
  if(rect.width<2||rect.height<2) return null;
  const nx=((event.clientX-rect.left)/rect.width)*2-1;
  const ny=-((event.clientY-rect.top)/rect.height)*2+1;
  cam.updateMatrixWorld?.(true);
  const alive=cloud.alive;
  let best=null,bestD=MAX_ANCHOR_HIT_PX*MAX_ANCHOR_HIT_PX,bestDepth=Infinity;
  const projected=new THREE.Vector3();
  const stride=Math.max(1,Math.ceil((positions.length/3)/220000));
  for(let i=0;i<positions.length/3;i+=stride) {
    if(alive&&!alive[i]) continue;
    projected.set(positions[i*3],positions[i*3+1],positions[i*3+2]).project(cam);
    if(projected.z < -1 || projected.z > 1) continue;
    const dx=(projected.x-nx)*rect.width*.5,dy=(-projected.y-ny)*rect.height*.5,d=dx*dx+dy*dy;
    // Prefer the front-most Gaussian when several layers overlap at almost
    // the same screen pixel; otherwise rear surfaces can steal the decal.
    if(d<bestD-64 || (Math.abs(d-bestD)<=64 && projected.z<bestDepth)) {
      bestD=d;bestDepth=projected.z;best={x:positions[i*3],y:positions[i*3+1],z:positions[i*3+2]};
    }
  }
  if(!best) return null;

  // Gather a local 3D neighbourhood around the picked Gaussian for PCA.
  const nearest=[], max=32;
  for(let i=0;i<positions.length/3;i+=stride) {
    if(alive&&!alive[i]) continue;
    const x=positions[i*3]-best.x,y=positions[i*3+1]-best.y,z=positions[i*3+2]-best.z;
    const d=x*x+y*y+z*z;
    if(nearest.length<max){nearest.push({d,p:[positions[i*3],positions[i*3+1],positions[i*3+2]]});nearest.sort((a,b)=>b.d-a.d);}
    else if(d<nearest[0].d){nearest[0]={d,p:[positions[i*3],positions[i*3+1],positions[i*3+2]]};nearest.sort((a,b)=>b.d-a.d);}
  }
  const normal=covarianceNormal(nearest.map(x=>x.p),[best.x,best.y,best.z]);
  if(!normal) return null;
  const towardCamera=new THREE.Vector3().subVectors(cam.position,new THREE.Vector3(best.x,best.y,best.z));
  if(normal.dot(towardCamera)<0) normal.negate();
  return {wx:best.x,wy:best.y,wz:best.z,nx:normal.x,ny:normal.y,nz:normal.z};
}
function sceneRadius() {
  const p=window.S?.positions;
  if(!p?.length) return 1;
  let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
  const step=Math.max(1,Math.ceil((p.length/3)/50000));
  for(let i=0;i<p.length/3;i+=step){const x=p[i*3],y=p[i*3+1],z=p[i*3+2];minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);minZ=Math.min(minZ,z);maxZ=Math.max(maxZ,z);}
  return Math.max(.001,Math.hypot(maxX-minX,maxY-minY,maxZ-minZ)*.5);
}
function decalWidthFor(item) { return sceneRadius()*Math.max(.005,(Number(item.width)||18)/100*.8); }
function createDecal(item) {
  const sc=scene(), cam=camera();
  if(!sc||!cam||item.mode!=='world'||item.decal) return;
  const n=new THREE.Vector3(item.nx??0,item.ny??0,item.nz??1);
  if(n.lengthSq()<.5) n.subVectors(cam.position,new THREE.Vector3(item.wx,item.wy,item.wz)).normalize();
  n.normalize();
  const radius=sceneRadius();
  const width=decalWidthFor(item);
  item.worldWidth=width;
  item.worldWidth=width;
  let mesh=null;
  const texture=new THREE.TextureLoader().load(item.src,loaded=>{
    texture.colorSpace=THREE.SRGBColorSpace;texture.needsUpdate=true;
    if(mesh && loaded.image?.width && loaded.image?.height) {
      item.aspectRatio=loaded.image.width/loaded.image.height;
      const previous=mesh.geometry;
      mesh.geometry=new THREE.PlaneGeometry(item.worldWidth,item.worldWidth/Math.max(.01,item.aspectRatio));
      previous.dispose();
    }
  });
  texture.colorSpace=THREE.SRGBColorSpace;
  const material=new THREE.MeshBasicMaterial({map:texture,transparent:true,opacity:item.opacity??1,side:THREE.FrontSide,depthTest:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2,toneMapped:false});
  const geometry=new THREE.PlaneGeometry(width,width/Math.max(.01,item.aspectRatio||1));
  mesh=new THREE.Mesh(geometry,material);
  mesh.name='fumoca-present-decal-'+item.id;
  mesh.position.set(item.wx,item.wy,item.wz).addScaledVector(n,Math.max(radius*.00035,.00003));
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),n);
  mesh.renderOrder=100;
  mesh.userData.fumocaPresentImageId=item.id;
  sc.add(mesh); item.decal=mesh;
}
function syncDecals() {
  for(const item of items) {
    if(item.mode==='world') {
      createDecal(item);
      if(item.decal) item.decal.material.opacity=item.opacity??1;
    } else if(item.decal) disposeDecal(item);
  }
}
function onPlace(e) {
  if(!placingId||!host().contains(e.target)) return;
  const item=items.find(x=>x.id===placingId);
  if(!item){placingId=null;return;}
  const anchor=nearestGaussian(e);
  if(!anchor) {
    const message=!camera()||!window.S?.positions?.length
      ? '3D scene or Gaussian positions are unavailable.'
      : 'A stable local surface could not be estimated here. Try a flatter, denser part of the scan.';
    window.showToast?.('Surface not found',message,'warn');
    e.preventDefault();e.stopPropagation();return;
  }
  Object.assign(item,anchor,{mode:'world'});
  item.worldWidth=decalWidthFor(item);
  placingId=null;host().classList.remove('mi-placing');
  rebuild();notify();
  window.showToast?.('3D decal attached','The image is now a scene object, not a screen overlay.','success');
  e.preventDefault();e.stopPropagation();
}
function rebuild() {
  const layer=ensureRoot();
  for(const item of items) disposeDecal(item);
  layer.replaceChildren();
  items.forEach(item=>layer.appendChild(renderItem(item)));
  syncDecals();
}
function tick() {
  raf=0;
  syncDecals();
  raf=requestAnimationFrame(tick);
}
export function initMagazineImages(opts={}) {
  editing=opts.editable!==false;onChange=opts.onChange||null;
  ensureRoot();
  document.removeEventListener('pointerdown',onPlace,true);
  document.addEventListener('pointerdown',onPlace,true);
  if(!raf) raf=requestAnimationFrame(tick);
}
export function addImage(src,partial={}) {
  if(typeof src!=='string'||!src.startsWith('data:image/'))throw new Error('Choose a valid image file.');
  const item={id:uid(),name:partial.name||'Logo',src,mode:'screen',sx:partial.sx??50,sy:partial.sy??18,width:partial.width??18,opacity:partial.opacity??1,z:partial.z||0,wx:partial.wx,wy:partial.wy,wz:partial.wz,nx:partial.nx,ny:partial.ny,nz:partial.nz,worldWidth:partial.worldWidth};
  items.push(item);rebuild();notify();return item;
}
export function removeImage(id){const item=items.find(x=>x.id===id);if(item)disposeDecal(item);items=items.filter(x=>x.id!==id);if(placingId===id)cancelPlacement();rebuild();notify();}
export function updateImage(id,patch){const item=items.find(x=>x.id===id);if(!item)return null;Object.assign(item,patch);if(patch.width!==undefined){item.worldWidth=decalWidthFor(item);if(item.decal){const previous=item.decal.geometry;const aspect=item.aspectRatio||previous.parameters.width/Math.max(.001,previous.parameters.height)||1;item.decal.geometry=new THREE.PlaneGeometry(item.worldWidth,item.worldWidth/Math.max(.01,aspect));previous.dispose();item.decal.scale.set(1,1,1);}}if(patch.opacity!==undefined&&item.decal)item.decal.material.opacity=item.opacity;notify();return item;}
export function armWorldPlacement(id){if(!items.some(x=>x.id===id))return false;placingId=id;host().classList.add('mi-placing');window.showToast?.('Place 3D decal','Click a visible, reasonably flat area of the scanned subject.','info');return true;}
export function cancelPlacement(){placingId=null;host().classList.remove('mi-placing');}
export function exportAll(){return items.map(({decal,...x})=>({...x}));}
export function importAll(list=[]){for(const item of items)disposeDecal(item);items=(Array.isArray(list)?list:[]).filter(x=>typeof x.src==='string'&&x.src.startsWith('data:image/')).map(x=>({...x,id:x.id||uid()}));rebuild();}
export function setEditable(v){editing=!!v;rebuild();}
export function readImageFile(file){return new Promise((resolve,reject)=>{if(!file||!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type))return reject(new Error('Use PNG, JPG, WebP or SVG.'));if(file.size>MAX_IMAGE_BYTES)return reject(new Error('Image must be 300 KB or smaller for a portable Studio composition.'));const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('Could not read that image.'));reader.readAsDataURL(file);});}
