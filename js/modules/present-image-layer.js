/**
 * FUMOCA Present — image / logo layers.
 * Screen layers stay fixed to the composition; world layers project a Gaussian
 * anchor through the live camera so they travel with the scene while orbiting.
 */
import * as THREE from 'three';

let root = null;
let items = [];
let editing = false;
let placingId = null;
let onChange = null;
let raf = 0;
const MAX_IMAGE_BYTES = 300 * 1024;
const MAX_ANCHOR_HIT_PX = 64;

const uid = () => 'mi_' + Math.random().toString(36).slice(2, 10);
const camera = () => window._fumocaViewerCamera || window._fumocaViewer?.camera || window._fumocaCamera || null;
const host = () => document.getElementById('viewport') || document.getElementById('stage') || document.getElementById('stageHost') || document.body;

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
function stageRect() {
  const c = document.querySelector('#viewport canvas, #stage canvas, #stageHost canvas');
  return (c || host()).getBoundingClientRect();
}
function project(item) {
  const cam = camera();
  if (!cam || ![item.wx,item.wy,item.wz].every(Number.isFinite)) return null;
  try {
    cam.updateMatrixWorld?.(true);
    const p = new THREE.Vector3(item.wx,item.wy,item.wz).project(cam);
    if (p.z > 1 || p.z < -1) return null;
    return {x:(p.x*.5+.5)*100,y:(-p.y*.5+.5)*100,depth:p.z};
  } catch { return null; }
}
function renderItem(item) {
  const wrap = document.createElement('div');
  wrap.className = 'mi-item';
  wrap.dataset.id = item.id;
  const img = document.createElement('img');
  img.src = item.src;
  img.alt = item.name || 'Scene logo';
  img.draggable = false;
  wrap.appendChild(img);
  Object.assign(wrap.style, {
    width: (item.width || 18) + '%',
    opacity: String(item.opacity ?? 1),
    zIndex: String(30 + (item.z || 0)),
    pointerEvents: editing ? 'auto' : 'none',
    cursor: editing ? 'move' : 'default'
  });
  if (editing) wrap.addEventListener('pointerdown', e => dragStart(e,item,wrap));
  return wrap;
}
function dragStart(e,item,el) {
  if (placingId) return;
  e.preventDefault(); e.stopPropagation();
  const rect = host().getBoundingClientRect();
  const move = ev => {
    item.sx = Math.max(2,Math.min(98,((ev.clientX-rect.left)/rect.width)*100));
    item.sy = Math.max(2,Math.min(98,((ev.clientY-rect.top)/rect.height)*100));
    // Dragging a world logo changes its screen placement intentionally;
    // keep its 3D anchor only when it was not manually repositioned.
    if (item.mode === 'world') item.mode = 'screen';
    el.style.left = item.sx+'%'; el.style.top = item.sy+'%';
  };
  const up = () => {
    window.removeEventListener('pointermove',move);
    window.removeEventListener('pointerup',up);
    notify();
  };
  window.addEventListener('pointermove',move);
  window.addEventListener('pointerup',up,{once:true});
}
function nearestGaussian(event) {
  const cam = camera(), cloud = window.S;
  const positions = cloud?.positions;
  if (!cam || !positions?.length) return null;
  const rect = stageRect();
  const nx = ((event.clientX-rect.left)/rect.width)*2-1;
  const ny = -((event.clientY-rect.top)/rect.height)*2+1;
  cam.updateMatrixWorld?.(true);
  const alive = cloud.alive;
  // Gaussian centres are not the same as the visible splat surface. A small
  // 18px radius silently missed many valid clicks on sparse/soft splats.
  let best = null, bestD = MAX_ANCHOR_HIT_PX * MAX_ANCHOR_HIT_PX;
  const v = new THREE.Vector3();
  // Sampling caps the click-time work on very large splats without changing data.
  const stride = Math.max(1,Math.ceil((positions.length/3)/180000));
  for(let i=0;i<positions.length/3;i+=stride) {
    if (alive && !alive[i]) continue;
    v.set(positions[i*3],positions[i*3+1],positions[i*3+2]).project(cam);
    if (v.z < -1 || v.z > 1) continue;
    const dx=(v.x-nx)*rect.width*.5, dy=(-v.y-ny)*rect.height*.5;
    const d=dx*dx+dy*dy;
    if(d<bestD){bestD=d;best={wx:positions[i*3],wy:positions[i*3+1],wz:positions[i*3+2]};}
  }
  return best;
}
function onPlace(e) {
  if (!placingId) return;
  const item = items.find(x=>x.id===placingId);
  if (!item) { placingId=null; return; }
  const anchor = nearestGaussian(e);
  if (!anchor) {
    // Never silently convert a failed 3D placement into a screen-fixed logo.
    // Keep placement armed so the user can try another visible part of the splat.
    const message = !camera() || !window.S?.positions?.length
      ? '3D anchoring is not ready. Make sure the splat is loaded, then try again.'
      : 'No Gaussian found close enough. Click a more solid, visible part of the splat.';
    if (typeof window.showToast === 'function') window.showToast('Anchor not placed', message, 'warn');
    else console.warn('[Present image layer]', message);
    e.preventDefault(); e.stopPropagation();
    return;
  }
  Object.assign(item,anchor);
  item.mode='world';
  placingId=null;
  host().classList.remove('mi-placing');
  e.preventDefault(); e.stopPropagation();
  rebuild(); notify();
  if (typeof window.showToast === 'function') window.showToast('Image anchored', 'This image will follow its 3D point as you orbit.', 'success');
}
function tick() {
  raf=0;
  const layer=ensureRoot();
  for(const item of items) {
    const el=layer.querySelector('[data-id="'+item.id+'"]');
    if(!el) continue;
    if(item.mode==='world') {
      const p=project(item);
      if(!p){el.style.opacity='0';continue;}
      el.style.left=p.x+'%'; el.style.top=p.y+'%';
      el.style.opacity=String(item.opacity ?? 1);
      el.style.transform='translate(-50%,-50%) scale('+Math.max(.65,1-Math.max(0,p.depth)*.18)+')';
    } else {
      el.style.left=(item.sx ?? 50)+'%'; el.style.top=(item.sy ?? 18)+'%';
      el.style.opacity=String(item.opacity ?? 1);
      el.style.transform='translate(-50%,-50%)';
    }
  }
  raf=requestAnimationFrame(tick);
}
function rebuild() {
  const layer=ensureRoot(); layer.replaceChildren();
  items.forEach(item=>layer.appendChild(renderItem(item)));
}
export function initMagazineImages(opts={}) {
  editing=opts.editable !== false; onChange=opts.onChange || null;
  ensureRoot();
  host().removeEventListener('pointerdown',onPlace,true);
  host().addEventListener('pointerdown',onPlace,true);
  if(!raf) raf=requestAnimationFrame(tick);
}
export function addImage(src, partial={}) {
  if(typeof src!=='string' || !src.startsWith('data:image/')) throw new Error('Choose a valid image file.');
  const item={id:uid(),name:partial.name||'Logo',src,mode:'screen',sx:partial.sx??50,sy:partial.sy??18,width:partial.width??18,opacity:partial.opacity??1,z:partial.z||0,wx:partial.wx,wy:partial.wy,wz:partial.wz};
  items.push(item); rebuild(); notify(); return item;
}
export function removeImage(id){items=items.filter(x=>x.id!==id);if(placingId===id)cancelPlacement();rebuild();notify();}
export function updateImage(id,patch){const item=items.find(x=>x.id===id);if(!item)return null;Object.assign(item,patch);rebuild();notify();return item;}
export function armWorldPlacement(id){if(!items.some(x=>x.id===id))return false;placingId=id;host().classList.add('mi-placing');return true;}
export function cancelPlacement(){placingId=null;host().classList.remove('mi-placing');}
export function exportAll(){return items.map(x=>({...x}));}
export function importAll(list=[]){items=(Array.isArray(list)?list:[]).filter(x=>typeof x.src==='string'&&x.src.startsWith('data:image/')).map(x=>({...x,id:x.id||uid()}));rebuild();}
export function setEditable(v){editing=!!v;rebuild();}
export function readImageFile(file){
  return new Promise((resolve,reject)=>{
    if(!file||!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type)) return reject(new Error('Use PNG, JPG, WebP or SVG.'));
    if(file.size>MAX_IMAGE_BYTES) return reject(new Error('Image must be 300 KB or smaller for a portable Studio composition.'));
    const reader=new FileReader();
    reader.onload=()=>resolve(String(reader.result));
    reader.onerror=()=>reject(new Error('Could not read that image.'));
    reader.readAsDataURL(file);
  });
}
