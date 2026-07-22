import r2 from '../r2Client.js';
/**
 * FUMOCA Splat Edit Engine V57 — Professional Studio
 * Real data editing, Gaussian blob visualization, brush tools, mesh studio.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import * as GS3D from 'https://cdn.jsdelivr.net/npm/@mkkellogg/gaussian-splats-3d@0.4.7/build/gaussian-splats-3d.module.js';
import { MeshEngine } from './mesh-engine.js';
import { SoundEngine, buildAmbientPanel } from './sound-engine.js';

// ── DISPLAY MODES ─────────────────────────────────────────────────────────────
const DISP = { SPLAT:'splat', BLOB:'blob', DOT:'dot', COLOR:'color', OPACITY:'opacity', SCALE:'scale' };

// ── THREE SETUP ───────────────────────────────────────────────────────────────
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth/window.innerHeight, 0.001, 2000);
camera.position.set(0,0,2.5);
const renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true, powerPreference:'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
renderer.setSize(window.innerWidth,window.innerHeight);
renderer.setClearColor(0x000000,0);
renderer.shadowMap.enabled = true;
const overlayHost = document.getElementById('overlayCanvasHost');
overlayHost.appendChild(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
scene.add(new THREE.AmbientLight(0xffffff,1.2));
const dirLight = new THREE.DirectionalLight(0xffffff,0.6);
dirLight.position.set(2,4,3);
scene.add(dirLight);

// ── STATE ─────────────────────────────────────────────────────────────────────
const state = {
  fileName:'', fileType:'', sourceBuffer:null, splatRowSize:32, splatSourceUrl:'',
  positions:null, colors:null, opacity:null, scale:null, alive:null, selected:null,
  paintColors:null, // per-point custom paint
  points:null, geometry:null,
  mode:'orbit',
  displayMode:DISP.BLOB,
  brushSize:28, brushStrength:1.0,
  brightness:1.0, ptScale:1.0,
  history:[],
  lassoPoints:[], dragging:false, dragStart:null, dragCurrent:null,
  actualSplatViewer:null, actualSplatCamera:null, actualSplatIframe:null,
  splatVisible:false, // actual splat viewer visibility
};

// ── HELPERS ───────────────────────────────────────────────────────────────────
const $  = (id) => document.getElementById(id);
const fmt = (n) => Number(n||0).toLocaleString();
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
const el = {
  backBtn:$('backBtn'), fileInput:$('fileInput'), openBtn:$('openBtn'), exportBtn:$('exportBtn'),
  meshToggleBtn:$('meshToggleBtn'),
  dropZone:$('dropZone'),
  orbitBtn:$('orbitBtn'), boxBtn:$('boxBtn'), lassoBtn:$('lassoBtn'),
  brushEraseBtn:$('brushEraseBtn'), brushSelectBtn:$('brushSelectBtn'), paintBtn:$('paintBtn'),
  brushSizeRange:$('brushSizeRange'), brushSizeVal:$('brushSizeVal'),
  brushStrRange:$('brushStrRange'), brushStrVal:$('brushStrVal'),
  deleteBtn:$('deleteBtn'), clearSelBtn:$('clearSelBtn'), undoBtn:$('undoBtn'),
  invertSelBtn:$('invertSelBtn'), growSelBtn:$('growSelBtn'), shrinkSelBtn:$('shrinkSelBtn'),
  dispSplatBtn:$('dispSplatBtn'), dispBlobBtn:$('dispBlobBtn'), dispDotBtn:$('dispDotBtn'),
  dispColorBtn:$('dispColorBtn'), dispOpacBtn:$('dispOpacBtn'), dispScaleBtn:$('dispScaleBtn'),
  brightnessRange:$('brightnessRange'), brightnessVal:$('brightnessVal'),
  ptScaleRange:$('ptScaleRange'), ptScaleVal:$('ptScaleVal'),
  autoCleanBtn:$('autoCleanBtn'), selectFloatersBtn:$('selectFloatersBtn'),
  selectOuterBtn:$('selectOuterBtn'), selectLowOpBtn:$('selectLowOpBtn'),
  selectLargeScaleBtn:$('selectLargeScaleBtn'), opacSharpenBtn:$('opacSharpenBtn'),
  densityPruneBtn:$('densityPruneBtn'),
  radiusRange:$('radiusRange'), radiusVal:$('radiusVal'),
  neighbourRange:$('neighbourRange'), neighbourVal:$('neighbourVal'),
  opacityRange:$('opacityRange'), opacityVal:$('opacityVal'),
  scaleRange:$('scaleRange'), scaleVal:$('scaleVal'),
  pruneRange:$('pruneRange'), pruneVal:$('pruneVal'),
  exportCleanedBtn:$('exportCleanedBtn'), saveToSupabaseBtn:$('saveToSupabaseBtn'),
  loadedCount:$('loadedCount'), aliveCount:$('aliveCount'),
  deletedCount:$('deletedCount'), selectedCount:$('selectedCount'),
  statusBar:$('statusBar'), statusText:$('statusBar'),
  modeBadge:$('modeBadge'), selBadge:$('selBadge'), dispBadge:$('dispBadge'),
  lassoSvg:$('lassoSvg'), progressBar:$('progressBar'),
  brushCursor:$('brushCursor'), rightPanel:$('rightPanel'),
  fileName:$('fileName'), fileStats:$('fileStats'),
  actualSplatHost:$('actualSplatHost'),
};

// ── PROGRESS / STATUS ─────────────────────────────────────────────────────────
function setStatus(msg, busy=false) {
  el.statusBar.textContent = msg;
  el.statusBar.className = busy ? 'busy' : '';
}
function setProgress(pct) {
  el.progressBar.style.width = pct + '%';
  if (pct >= 100) setTimeout(()=>{ el.progressBar.style.width='0%'; }, 600);
}

// ── PARSE ─────────────────────────────────────────────────────────────────────
function parseSplat(buffer) {
  const rowSize=32, count=Math.floor(buffer.byteLength/rowSize), dv=new DataView(buffer);
  const positions=new Float32Array(count*3), colors=new Float32Array(count*3);
  const opacity=new Float32Array(count), scale=new Float32Array(count);
  for (let i=0;i<count;i++) {
    const o=i*rowSize;
    positions[i*3]=dv.getFloat32(o,true); positions[i*3+1]=dv.getFloat32(o+4,true); positions[i*3+2]=dv.getFloat32(o+8,true);
    const sx=Math.abs(dv.getFloat32(o+12,true)), sy=Math.abs(dv.getFloat32(o+16,true)), sz=Math.abs(dv.getFloat32(o+20,true));
    scale[i]=(sx+sy+sz)/3||0.01;
    colors[i*3]=dv.getUint8(o+24)/255; colors[i*3+1]=dv.getUint8(o+25)/255; colors[i*3+2]=dv.getUint8(o+26)/255;
    opacity[i]=dv.getUint8(o+27)/255;
  }
  state.splatRowSize=rowSize;
  return {positions,colors,opacity,scale,count};
}

function parsePLY(buffer) {
  const loader=new PLYLoader(), geo=loader.parse(buffer);
  const pos=geo.getAttribute('position'), col=geo.getAttribute('color');
  const count=pos.count;
  const positions=new Float32Array(pos.array);
  const colors=new Float32Array(count*3);
  if (col) colors.set(col.array.slice(0,count*3)); else colors.fill(0.85);
  const opacity=new Float32Array(count); opacity.fill(1);
  const scale=new Float32Array(count); scale.fill(0.01);
  if (geo.getAttribute('scale_0')) {
    const s0=geo.getAttribute('scale_0').array, s1=geo.getAttribute('scale_1').array, s2=geo.getAttribute('scale_2').array;
    for (let i=0;i<count;i++) scale[i]=(Math.abs(s0[i])+Math.abs(s1[i])+Math.abs(s2[i]))/3;
  }
  if (geo.getAttribute('opacity')) { const o=geo.getAttribute('opacity').array; for (let i=0;i<count;i++) opacity[i]=clamp(Number.isFinite(o[i])?o[i]:1,0,1); }
  return {positions,colors,opacity,scale,count};
}

// ── LOAD FILE ─────────────────────────────────────────────────────────────────
async function loadFile(file, sourceUrl='') {
  setStatus('Loading…', true); setProgress(15);
  const buffer=await file.arrayBuffer();
  const name=file.name||'scene', ext=name.toLowerCase().split('.').pop();
  setProgress(40);
  let parsed;
  if (ext==='splat') parsed=parseSplat(buffer);
  else if (ext==='ply') parsed=parsePLY(buffer);
  else { setStatus('Only .splat and .ply supported.'); return; }
  setProgress(70);
  state.fileName=name; state.fileType=ext; state.sourceBuffer=buffer;
  state.splatSourceUrl=sourceUrl||state.splatSourceUrl||'';
  state.positions=parsed.positions; state.colors=parsed.colors;
  state.opacity=parsed.opacity; state.scale=parsed.scale;
  state.alive=new Uint8Array(parsed.count); state.alive.fill(1);
  state.selected=new Uint8Array(parsed.count);
  state.paintColors=null;
  state.history=[];
  el.fileName.textContent=name;
  el.fileStats.textContent=`${fmt(parsed.count)} gaussians · ${ext.toUpperCase()}`;
  rebuildGeometry(true);
  fitCamera();
  setProgress(90);
  if (ext==='splat') {
    const url=sourceUrl||URL.createObjectURL(file);
    state.splatSourceUrl=url;
    await mountSplatViewer(url);
    // Start in blob mode so they can see structure
    setDisplayMode(DISP.BLOB);
  } else {
    await destroySplatViewer();
    setDisplayMode(DISP.BLOB);
  }
  setProgress(100);
  setStatus(`Loaded ${name} — ${fmt(parsed.count)} gaussians. Blob view active. Use Orbit to explore, Brush Erase to clean.`);
  el.dropZone.style.display='none';
}

// ── ACTUAL SPLAT VIEWER ───────────────────────────────────────────────────────
function getViewerCam(v) { return v?.camera||v?.perspectiveCamera||v?.renderer?.camera||v?._camera||null; }

async function destroySplatViewer() {
  const inst=state.actualSplatViewer; state.actualSplatViewer=null; state.actualSplatCamera=null;
  if (state.actualSplatIframe) { try{state.actualSplatIframe.remove();}catch(_){} state.actualSplatIframe=null; }
  if (!inst) { el.actualSplatHost.innerHTML=''; return; }
  try{inst.stop?.();}catch(_){} try{await inst.dispose?.();}catch(_){} try{inst.renderer?.domElement?.remove?.();}catch(_){}
  el.actualSplatHost.innerHTML='';
}

async function mountSplatViewer(url) {
  await destroySplatViewer();
  if (!url||state.fileType!=='splat') return;
  // Try iframe first
  try {
    const iframe=document.createElement('iframe');
    const target=new URL('viewer.html',window.location.href);
    target.searchParams.set('file',url); target.searchParams.set('embed','1');
    iframe.src=target.toString();
    Object.assign(iframe.style,{position:'absolute',inset:'0',width:'100%',height:'100%',border:'0',display:'block',background:'transparent'});
    iframe.setAttribute('aria-hidden','true');
    el.actualSplatHost.innerHTML='';
    el.actualSplatHost.appendChild(iframe);
    state.actualSplatIframe=iframe;
    state.splatVisible=true;
    return;
  } catch(_) {}
  // Fallback: direct GaussianSplats3D
  try {
    const viewer=new GS3D.Viewer({
      rootElement:el.actualSplatHost, cameraUp:[0,-1,-0.6],
      initialCameraPosition:[camera.position.x,camera.position.y,camera.position.z],
      initialCameraLookAt:[controls.target.x,controls.target.y,controls.target.z],
      sharedMemoryForWorkers:false, antialiased:true, selfDrivenMode:true,
      useBuiltInControls:false, dynamicScene:false,
    });
    await viewer.addSplatScene(url,{showLoadingUI:false,progressiveLoad:true,splatAlphaRemovalThreshold:1});
    viewer.start();
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    const c=el.actualSplatHost.querySelector('canvas');
    if (c) Object.assign(c.style,{position:'absolute',inset:'0',width:'100%',height:'100%'});
    state.actualSplatViewer=viewer; state.actualSplatCamera=getViewerCam(viewer); state.splatVisible=true;
  } catch(err) { console.warn('[FUMOCA] splat viewer failed',err); }
}

function syncSplatCamera() {
  const c=state.actualSplatCamera||getViewerCam(state.actualSplatViewer);
  if (!c) return;
  state.actualSplatCamera=c;
  c.position.copy(camera.position); c.quaternion.copy(camera.quaternion);
  c.near=camera.near; c.far=camera.far; c.aspect=camera.aspect;
  c.updateProjectionMatrix?.();
}

// ── DISPLAY MODES ─────────────────────────────────────────────────────────────
function setDisplayMode(mode) {
  state.displayMode=mode;
  // Show/hide actual splat viewer
  el.actualSplatHost.style.display = mode===DISP.SPLAT ? 'block' : 'none';
  el.actualSplatHost.style.opacity = mode===DISP.SPLAT ? '1' : '0';
  // Update button states
  [el.dispSplatBtn,el.dispBlobBtn,el.dispDotBtn,el.dispColorBtn,el.dispOpacBtn,el.dispScaleBtn].forEach(b=>b.classList.remove('active'));
  const map={[DISP.SPLAT]:el.dispSplatBtn,[DISP.BLOB]:el.dispBlobBtn,[DISP.DOT]:el.dispDotBtn,[DISP.COLOR]:el.dispColorBtn,[DISP.OPACITY]:el.dispOpacBtn,[DISP.SCALE]:el.dispScaleBtn};
  map[mode]?.classList.add('active');
  el.dispBadge.textContent=mode.toUpperCase();
  rebuildGeometry(false);
}

// ── REBUILD GEOMETRY (the render heart) ───────────────────────────────────────
// This renders blobs that actually look like Gaussian splats — large, soft, overlapping
function rebuildGeometry(resetCamera=false) {
  if (!state.positions) return;
  const count=state.positions.length/3;
  const aliveIdx=[];
  for (let i=0;i<count;i++) if (state.alive[i]) aliveIdx.push(i);
  const N=aliveIdx.length;
  const pos=new Float32Array(N*3), col=new Float32Array(N*3), siz=new Float32Array(N), alp=new Float32Array(N);
  const bright=state.brightness, ptSc=state.ptScale;
  const mode=state.displayMode;
  for (let j=0;j<N;j++) {
    const i=aliveIdx[j], isSel=!!state.selected[i];
    pos[j*3]=state.positions[i*3]; pos[j*3+1]=state.positions[i*3+1]; pos[j*3+2]=state.positions[i*3+2];
    const op=state.opacity?.[i]??1, sc=state.scale?.[i]??0.01;
    // Color determination
    let r,g,b;
    if (isSel) { r=0.3;g=0.8;b=1.0; }
    else if (state.paintColors && state.paintColors[i*3] !== undefined && state.paintColors[i*3] >= 0) {
      r=state.paintColors[i*3]; g=state.paintColors[i*3+1]; b=state.paintColors[i*3+2];
    } else {
      const cr=clamp(state.colors[i*3],0,1)*bright, cg=clamp(state.colors[i*3+1],0,1)*bright, cb=clamp(state.colors[i*3+2],0,1)*bright;
      if (mode===DISP.OPACITY) { const v=clamp(op,0,1); r=v*0.4; g=v*1.0; b=v*0.5; }
      else if (mode===DISP.SCALE) { const v=clamp(sc/0.3,0,1); r=v; g=0.3*(1-v); b=1-v; }
      else { r=Math.min(cr,1); g=Math.min(cg,1); b=Math.min(cb,1); }
    }
    col[j*3]=r; col[j*3+1]=g; col[j*3+2]=b;
    // Size and alpha — BLOB mode makes big soft Gaussians
    if (isSel) {
      siz[j]=Math.max(12,Math.min(36,sc*200+8))*ptSc;
      alp[j]=0.95;
    } else if (mode===DISP.BLOB||mode===DISP.COLOR) {
      // Big soft blobs — the key visual difference from other editors
      const baseSz = Math.max(2.5, Math.min(60, sc*900+op*2.5));
      siz[j]=baseSz*ptSc;
      alp[j]=Math.max(0.18, Math.min(0.72, op*0.85));
    } else if (mode===DISP.SPLAT) {
      siz[j]=0; alp[j]=0; // hide overlay points when showing real splat
    } else if (mode===DISP.OPACITY) {
      siz[j]=Math.max(2,sc*400+2)*ptSc;
      alp[j]=Math.max(0.3,op);
    } else if (mode===DISP.SCALE) {
      siz[j]=Math.max(2,sc*600)*ptSc;
      alp[j]=0.7;
    } else { // DOT
      siz[j]=Math.max(1.5, Math.min(6, sc*60+op))*ptSc;
      alp[j]=Math.max(0.3, op*0.6);
    }
  }
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.BufferAttribute(pos,3));
  geo.setAttribute('color',new THREE.BufferAttribute(col,3));
  geo.setAttribute('size',new THREE.BufferAttribute(siz,1));
  geo.setAttribute('alpha',new THREE.BufferAttribute(alp,1));

  // Gaussian blob shader — soft radial falloff with additive-like blending
  const mat=new THREE.ShaderMaterial({
    transparent:true, depthWrite:false, vertexColors:true,
    blending: (mode===DISP.BLOB) ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms:{uPR:{value:Math.min(window.devicePixelRatio||1,2)}},
    vertexShader:`
      attribute float size; attribute float alpha;
      varying vec3 vColor; varying float vAlpha; varying float vSize;
      uniform float uPR;
      void main(){
        vColor=color; vAlpha=alpha; vSize=size;
        vec4 mv=modelViewMatrix*vec4(position,1.0);
        gl_PointSize=size*uPR*(200.0/max(1.0,-mv.z));
        gl_Position=projectionMatrix*mv;
      }`,
    fragmentShader:`
      varying vec3 vColor; varying float vAlpha; varying float vSize;
      void main(){
        vec2 c=gl_PointCoord-0.5;
        float d=dot(c,c)*4.0;
        if(d>1.0) discard;
        // Gaussian falloff — this is what makes it look like real splats
        float g=exp(-d*3.5);
        float a=g*vAlpha;
        if(a<0.01) discard;
        gl_FragColor=vec4(vColor,a);
      }`
  });
  if (state.points) { scene.remove(state.points); state.points.geometry.dispose(); state.points.material.dispose(); }
  state.geometry=geo; state.points=new THREE.Points(geo,mat);
  scene.add(state.points);
  updateCounts();
}

function fitCamera() {
  if (!state.points) return;
  state.geometry.computeBoundingBox();
  const box=state.geometry.boundingBox;
  const center=new THREE.Vector3(); box.getCenter(center);
  const size=new THREE.Vector3(); box.getSize(size);
  const r=Math.max(size.x,size.y,size.z,0.01);
  controls.target.copy(center);
  camera.near=Math.max(0.001,r/500); camera.far=Math.max(1000,r*100);
  camera.position.copy(center.clone().add(new THREE.Vector3(r*1.4,r*0.8,r*1.6)));
  camera.updateProjectionMatrix(); controls.update();
}

function updateCounts() {
  if (!state.alive) { [el.loadedCount,el.aliveCount,el.deletedCount,el.selectedCount].forEach(e=>{if(e)e.textContent='—'}); return; }
  const total=state.alive.length; let alive=0, selected=0;
  for (let i=0;i<total;i++) { if(state.alive[i])alive++; if(state.selected[i])selected++; }
  if(el.loadedCount)el.loadedCount.textContent=fmt(total);
  if(el.aliveCount)el.aliveCount.textContent=fmt(alive);
  if(el.deletedCount)el.deletedCount.textContent=fmt(total-alive);
  if(el.selectedCount)el.selectedCount.textContent=fmt(selected);
  if(el.selBadge)el.selBadge.textContent=fmt(selected);
}

// ── HISTORY ───────────────────────────────────────────────────────────────────
function pushHistory(label) {
  if (!state.alive) return;
  state.history.push({label, alive:state.alive.slice(), selected:state.selected.slice(), opacity:state.opacity?.slice()});
  if (state.history.length>30) state.history.shift();
}
function undo() {
  const e=state.history.pop(); if(!e) return;
  state.alive=e.alive; state.selected=e.selected; if(e.opacity)state.opacity=e.opacity;
  rebuildGeometry(); setStatus(`Undid: ${e.label}`);
}

// ── SELECTION ─────────────────────────────────────────────────────────────────
function clearSelection() { if(state.selected){state.selected.fill(0);rebuildGeometry(false);} }
function setMode(mode) {
  state.mode=mode; controls.enabled=(mode==='orbit');
  renderer.domElement.style.cursor=mode==='orbit'?'grab':mode.includes('brush')||mode==='paint'?'none':'crosshair';
  [el.orbitBtn,el.boxBtn,el.lassoBtn,el.brushEraseBtn,el.brushSelectBtn,el.paintBtn].forEach(b=>b.classList.remove('active','active-red','active-purple'));
  const map={orbit:el.orbitBtn,box:el.boxBtn,lasso:el.lassoBtn,'brush-erase':el.brushEraseBtn,'brush-select':el.brushSelectBtn,paint:el.paintBtn};
  const cls={orbit:'active',box:'active','lasso':'active','brush-erase':'active-red','brush-select':'active','paint':'active-purple'};
  if(map[mode]) map[mode].classList.add(cls[mode]||'active');
  el.modeBadge.textContent=mode.toUpperCase().replace('-',' ');
  el.brushCursor.style.display=(mode.includes('brush')||mode==='paint')?'block':'none';
}

function projectPoint(i) {
  const p=new THREE.Vector3(state.positions[i*3],state.positions[i*3+1],state.positions[i*3+2]);
  p.project(camera);
  return {x:(p.x*.5+.5)*window.innerWidth, y:(-p.y*.5+.5)*window.innerHeight, z:p.z};
}
function pointInPoly(x,y,pts) {
  let inside=false;
  for (let i=0,j=pts.length-1;i<pts.length;j=i++) {
    const xi=pts[i].x,yi=pts[i].y,xj=pts[j].x,yj=pts[j].y;
    const c=((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/((yj-yi)||1e-8)+xi);
    if(c) inside=!inside;
  }
  return inside;
}
function selectByScreen(points, isBox=false) {
  if(!state.alive) return;
  let minX,minY,maxX,maxY;
  if(isBox) { minX=Math.min(points[0].x,points[1].x);minY=Math.min(points[0].y,points[1].y);maxX=Math.max(points[0].x,points[1].x);maxY=Math.max(points[0].y,points[1].y); }
  let sel=0;
  for (let i=0;i<state.alive.length;i++) {
    if(!state.alive[i]) continue;
    const p=projectPoint(i);
    if(p.z<-1||p.z>1) continue;
    const hit=isBox?(p.x>=minX&&p.x<=maxX&&p.y>=minY&&p.y<=maxY):pointInPoly(p.x,p.y,points);
    if(hit) { state.selected[i]=1; sel++; }
  }
  rebuildGeometry(false);
  setStatus(`Selected ${fmt(sel)} gaussians.`);
}

function deleteSelected() {
  if(!state.selected) return;
  pushHistory('delete selected');
  let del=0;
  for (let i=0;i<state.selected.length;i++) if(state.alive[i]&&state.selected[i]) { state.alive[i]=0; state.selected[i]=0; del++; }
  rebuildGeometry(); setStatus(`Deleted ${fmt(del)} gaussians.`);
}

function invertSelection() {
  if(!state.alive) return;
  for (let i=0;i<state.alive.length;i++) if(state.alive[i]) state.selected[i]=state.selected[i]?0:1;
  rebuildGeometry(); setStatus('Selection inverted.');
}

function growSelection() {
  if(!state.alive) return;
  const radius=Number(el.radiusRange.value);
  const newSel=new Uint8Array(state.selected);
  for (let i=0;i<state.alive.length;i++) {
    if(!state.alive[i]||state.selected[i]) continue;
    const ix=state.positions[i*3],iy=state.positions[i*3+1],iz=state.positions[i*3+2];
    let near=false;
    for (let j=0;j<state.alive.length;j++) {
      if(!state.selected[j]) continue;
      const dx=ix-state.positions[j*3],dy=iy-state.positions[j*3+1],dz=iz-state.positions[j*3+2];
      if(dx*dx+dy*dy+dz*dz<=radius*radius) { near=true; break; }
    }
    if(near) newSel[i]=1;
  }
  state.selected=newSel; rebuildGeometry(); setStatus('Selection grown.');
}

function shrinkSelection() {
  if(!state.alive) return;
  const radius=Number(el.radiusRange.value);
  const newSel=new Uint8Array(state.selected);
  for (let i=0;i<state.alive.length;i++) {
    if(!state.selected[i]) continue;
    const ix=state.positions[i*3],iy=state.positions[i*3+1],iz=state.positions[i*3+2];
    let hasUnsel=false;
    for (let j=0;j<state.alive.length;j++) {
      if(!state.alive[j]||state.selected[j]) continue;
      const dx=ix-state.positions[j*3],dy=iy-state.positions[j*3+1],dz=iz-state.positions[j*3+2];
      if(dx*dx+dy*dy+dz*dz<=radius*radius) { hasUnsel=true; break; }
    }
    if(hasUnsel) newSel[i]=0;
  }
  state.selected=newSel; rebuildGeometry(); setStatus('Selection shrunk.');
}

// ── BRUSH OPERATIONS ─────────────────────────────────────────────────────────
function applyBrush(screenX, screenY) {
  if(!state.alive) return;
  const radius=state.brushSize, r2=radius*radius;
  let affected=0;
  const mode=state.mode;
  for (let i=0;i<state.alive.length;i++) {
    if(!state.alive[i]) continue;
    const p=projectPoint(i);
    if(p.z<-1||p.z>1) continue;
    const dx=p.x-screenX, dy=p.y-screenY;
    const dist2=dx*dx+dy*dy;
    if(dist2>r2) continue;
    // Soft falloff within brush — stronger at center
    const falloff=1-(Math.sqrt(dist2)/radius);
    const eff=falloff*state.brushStrength;
    if(mode==='brush-erase') {
      if(eff>0.3||Math.random()<eff) { state.alive[i]=0; state.selected[i]=0; affected++; }
    } else if(mode==='brush-select') {
      if(eff>0.2) { state.selected[i]=1; affected++; }
    } else if(mode==='paint') {
      if(!state.paintColors) {
        state.paintColors=new Float32Array(state.alive.length*3).fill(-1);
      }
      const hue=(_paintHue||0)/360;
      const [pr,pg,pb]=hslToRgb(hue,0.9,0.55);
      const blend=eff*0.7;
      if(state.paintColors[i*3]<0) {
        state.paintColors[i*3]=state.colors[i*3]; state.paintColors[i*3+1]=state.colors[i*3+1]; state.paintColors[i*3+2]=state.colors[i*3+2];
      }
      state.paintColors[i*3]=state.paintColors[i*3]*(1-blend)+pr*blend;
      state.paintColors[i*3+1]=state.paintColors[i*3+1]*(1-blend)+pg*blend;
      state.paintColors[i*3+2]=state.paintColors[i*3+2]*(1-blend)+pb*blend;
      affected++;
    }
  }
  if(affected>0) rebuildGeometry(false);
}
let _paintHue=0;
function hslToRgb(h,s,l){
  let r,g,b;
  if(s===0){r=g=b=l;}else{
    const q=l<.5?l*(1+s):l+s-l*s,p=2*l-q;
    r=hue2rgb(p,q,h+1/3);g=hue2rgb(p,q,h);b=hue2rgb(p,q,h-1/3);
  }
  return[r,g,b];
}
function hue2rgb(p,q,t){if(t<0)t++;if(t>1)t--;if(t<1/6)return p+(q-p)*6*t;if(t<1/2)return q;if(t<2/3)return p+(q-p)*(2/3-t)*6;return p;}

// ── SPATIAL GRID ──────────────────────────────────────────────────────────────
function buildGrid(radius) {
  const grid=new Map(), inv=1/radius;
  const key=(x,y,z)=>`${Math.floor(x*inv)},${Math.floor(y*inv)},${Math.floor(z*inv)}`;
  for (let i=0;i<state.alive.length;i++) {
    if(!state.alive[i]) continue;
    const k=key(state.positions[i*3],state.positions[i*3+1],state.positions[i*3+2]);
    if(!grid.has(k))grid.set(k,[]);
    grid.get(k).push(i);
  }
  return {grid,key};
}
function neighbourCount(i,radius,gp) {
  const {grid,key}=gp, r2=radius*radius;
  const x=state.positions[i*3],y=state.positions[i*3+1],z=state.positions[i*3+2];
  const inv=1/radius, cx=Math.floor(x*inv),cy=Math.floor(y*inv),cz=Math.floor(z*inv);
  let cnt=0;
  for(let dx=-1;dx<=1;dx++) for(let dy=-1;dy<=1;dy++) for(let dz=-1;dz<=1;dz++) {
    const arr=grid.get(`${cx+dx},${cy+dy},${cz+dz}`); if(!arr)continue;
    for(const j of arr) {
      if(j===i||!state.alive[j])continue;
      const qx=state.positions[j*3]-x,qy=state.positions[j*3+1]-y,qz=state.positions[j*3+2]-z;
      if(qx*qx+qy*qy+qz*qz<=r2) cnt++;
    }
  }
  return cnt;
}

// ── CLEANUP TOOLS ─────────────────────────────────────────────────────────────
function selectLowOpacity() {
  if(!state.opacity)return; clearSelection();
  const t=Number(el.opacityRange.value); let hits=0;
  for(let i=0;i<state.opacity.length;i++) if(state.alive[i]&&state.opacity[i]<=t){state.selected[i]=1;hits++;}
  rebuildGeometry(); setStatus(`Selected ${fmt(hits)} low-opacity gaussians.`);
}
function selectLargeScale() {
  if(!state.scale)return; clearSelection();
  const t=Number(el.scaleRange.value); let hits=0;
  for(let i=0;i<state.scale.length;i++) if(state.alive[i]&&state.scale[i]>=t){state.selected[i]=1;hits++;}
  rebuildGeometry(); setStatus(`Selected ${fmt(hits)} large-scale halos.`);
}
function opacitySharpen() {
  if(!state.opacity)return; pushHistory('opacity sharpen');
  const t=Number(el.opacityRange.value);
  const radius=Number(el.radiusRange.value)||0.08;
  const gp=buildGrid(radius);
  let killed=0, boosted=0;

  // Bilateral opacity sharpening:
  // 1. Ghost detection: low opacity AND isolated = floater → kill
  // 2. Core boost: high density neighbours AND decent opacity → amplify
  // 3. Smooth falloff: mid-range gaussians get gentle neighbourhood-weighted boost
  for(let i=0;i<state.opacity.length;i++) {
    if(!state.alive[i]) continue;
    const op=state.opacity[i];
    const n=neighbourCount(i,radius,gp);
    const sc=state.scale?.[i]??0.015;

    // Kill: transparent AND sparse (floater ghost)
    if(op<t && n<=2) { state.alive[i]=0; state.selected[i]=0; killed++; continue; }

    // Boost: well-supported, decent opacity splats — push to full solidity
    if(op>=t && n>=4) {
      const densityBoost = Math.min(1, n/12.0) * 0.25;
      const scaleBoost   = Math.max(0, 1.0 - sc/0.06) * 0.12;
      state.opacity[i]   = clamp(op + densityBoost + scaleBoost, 0, 1);
      boosted++;
    }

    // Mild suppression: orphaned mid-opacity splats
    if(op>=t && n<=1 && op<0.7) {
      state.opacity[i] = op * 0.55;
    }
  }
  rebuildGeometry(); setStatus(`Bilateral sharpen: killed ${fmt(killed)} ghosts, boosted ${fmt(boosted)} core splats.`);
}
function selectFloaters() {
  clearSelection();
  const radius=Number(el.radiusRange.value), minN=Number(el.neighbourRange.value);
  const gp=buildGrid(radius); let hits=0;

  // Enhanced floater detection: sparse + large-scale + low-opacity = floater
  // More precise than pure neighbour count — avoids cutting edge detail
  for(let i=0;i<state.alive.length;i++) {
    if(!state.alive[i]) continue;
    const n  = neighbourCount(i,radius,gp);
    const op = state.opacity?.[i] ?? 1.0;
    const sc = state.scale?.[i]   ?? 0.015;

    const isSparse   = n <= minN;
    const isLargeHalo= sc > 0.07;
    const isGhost    = op < 0.18;

    // A floater needs to fail at least 2 of 3 criteria
    const failScore = (isSparse?1:0) + (isLargeHalo?1:0) + (isGhost?1:0);
    if(failScore >= 2) { state.selected[i]=1; hits++; }
  }
  rebuildGeometry(); setStatus(`Selected ${fmt(hits)} floaters (sparse+halo+ghost scored).`);
}
function densityPrune() {
  const radius=Number(el.radiusRange.value), pct=Number(el.pruneRange.value);
  const gp=buildGrid(radius); const scored=[];

  // Multi-factor quality score: density + opacity + scale penalty
  // Mirrors PostShot's confidence-weighted pruning
  for(let i=0;i<state.alive.length;i++) {
    if(!state.alive[i]) continue;
    const n  = neighbourCount(i,radius,gp);
    const op = state.opacity?.[i] ?? 1.0;
    const sc = state.scale?.[i]   ?? 0.015;
    // Higher score = more valuable, keep it
    const qualityScore = n * 1.6 + op * 3.2 - Math.min(sc / 0.05, 2.0) * 1.4;
    scored.push([i, qualityScore]);
  }
  scored.sort((a,b)=>a[1]-b[1]); // lowest quality first
  const take=Math.max(1,Math.floor(scored.length*(pct/100)));
  pushHistory('density prune');
  for(let k=0;k<take;k++){state.alive[scored[k][0]]=0;state.selected[scored[k][0]]=0;}
  rebuildGeometry(); setStatus(`Smart prune removed ${fmt(take)} low-quality gaussians (density+opacity+scale scored).`);
}

function estimateCore() {
  if(!state.alive)return null;
  const radius=Math.max(0.03,Number(el.radiusRange.value));
  const gp=buildGrid(radius); const cands=[];
  for(let i=0;i<state.alive.length;i++) {
    if(!state.alive[i])continue;
    const n=neighbourCount(i,radius,gp), op=state.opacity?.[i]??1, sc=state.scale?.[i]??0.01;
    cands.push([i, n*1.8+op*2.5-sc*0.35]);
  }
  if(!cands.length)return null;
  cands.sort((a,b)=>b[1]-a[1]);
  const take=Math.max(24,Math.min(cands.length,Math.floor(cands.length*0.12)));
  let sw=0,cx=0,cy=0,cz=0;
  for(let k=0;k<take;k++){const[i,s]=cands[k];const w=Math.max(0.25,s);sw+=w;cx+=state.positions[i*3]*w;cy+=state.positions[i*3+1]*w;cz+=state.positions[i*3+2]*w;}
  cx/=sw;cy/=sw;cz/=sw;
  let sx=0,sy=0,sz=0;
  for(let k=0;k<take;k++){const[i,s]=cands[k];const w=Math.max(0.25,s);const dx=state.positions[i*3]-cx,dy=state.positions[i*3+1]-cy,dz=state.positions[i*3+2]-cz;sx+=dx*dx*w;sy+=dy*dy*w;sz+=dz*dz*w;}
  sx=Math.sqrt(sx/sw);sy=Math.sqrt(sy/sw);sz=Math.sqrt(sz/sw);
  const m=Math.max(radius*2.2,0.03);
  return {center:[cx,cy,cz],spread:[Math.max(sx*3.2,m),Math.max(sy*3.2,m),Math.max(sz*3.2,m)],gp};
}
function selectOuterNoise() {
  const core=estimateCore(); if(!core)return; clearSelection();
  const[cx,cy,cz]=core.center,[sx,sy,sz]=core.spread;
  const radius=Math.max(0.03,Number(el.radiusRange.value)); let hits=0;
  for(let i=0;i<state.alive.length;i++) {
    if(!state.alive[i])continue;
    const x=state.positions[i*3],y=state.positions[i*3+1],z=state.positions[i*3+2];
    const nx=Math.abs((x-cx)/sx),ny=Math.abs((y-cy)/sy),nz=Math.abs((z-cz)/sz);
    const n=neighbourCount(i,radius,core.gp), op=state.opacity?.[i]??1, sc=state.scale?.[i]??0.01;
    const far=nx>1.15||ny>1.15||nz>1.15||(nx+ny+nz)>2.35;
    const weak=n<=Number(el.neighbourRange.value)||op<Number(el.opacityRange.value)||sc>Number(el.scaleRange.value);
    if(far&&weak){state.selected[i]=1;hits++;}
  }
  rebuildGeometry(); setStatus(`Selected ${fmt(hits)} outer noise gaussians.`);
}
function autoCleanSubject() {
  const core=estimateCore(); if(!core)return; pushHistory('auto clean');
  const[cx,cy,cz]=core.center,[sx,sy,sz]=core.spread;
  const radius=Math.max(0.03,Number(el.radiusRange.value)); let removed=0;
  for(let i=0;i<state.alive.length;i++) {
    if(!state.alive[i])continue;
    const x=state.positions[i*3],y=state.positions[i*3+1],z=state.positions[i*3+2];
    const nx=Math.abs((x-cx)/sx),ny=Math.abs((y-cy)/sy),nz=Math.abs((z-cz)/sz);
    const n=neighbourCount(i,radius,core.gp), op=state.opacity?.[i]??1, sc=state.scale?.[i]??0.01;
    const far=nx>1.1||ny>1.1||nz>1.1||(nx+ny+nz)>2.2;
    const veryFar=nx>1.5||ny>1.5||nz>1.5||(nx+ny+nz)>3.0;
    const weak=n<=Number(el.neighbourRange.value)||op<Number(el.opacityRange.value)||sc>Number(el.scaleRange.value);
    if(veryFar||(far&&weak)){state.alive[i]=0;state.selected[i]=0;removed++;}
  }
  rebuildGeometry(); setStatus(`Auto clean removed ${fmt(removed)} noise gaussians around subject.`);
}

// ── EXPORT ────────────────────────────────────────────────────────────────────
function exportCleaned() {
  if(!state.alive)return;
  const idx=[]; for(let i=0;i<state.alive.length;i++) if(state.alive[i]) idx.push(i);
  let blob, name;
  if(state.fileType==='splat') {
    const src=new Uint8Array(state.sourceBuffer), out=new Uint8Array(idx.length*state.splatRowSize);
    idx.forEach((i,row)=>out.set(src.subarray(i*state.splatRowSize,(i+1)*state.splatRowSize),row*state.splatRowSize));
    blob=new Blob([out],{type:'application/octet-stream'});
    name=state.fileName.replace(/\.splat$/i,'')+'.cleaned.splat';
  } else {
    const lines=['ply','format ascii 1.0',`element vertex ${idx.length}`,'property float x','property float y','property float z','property uchar red','property uchar green','property uchar blue','end_header'];
    for(const i of idx) {
      const cx=state.paintColors&&state.paintColors[i*3]>=0?state.paintColors[i*3]:state.colors[i*3];
      const cy=state.paintColors&&state.paintColors[i*3+1]>=0?state.paintColors[i*3+1]:state.colors[i*3+1];
      const cz2=state.paintColors&&state.paintColors[i*3+2]>=0?state.paintColors[i*3+2]:state.colors[i*3+2];
      lines.push(`${state.positions[i*3]} ${state.positions[i*3+1]} ${state.positions[i*3+2]} ${Math.round(clamp(cx,0,1)*255)} ${Math.round(clamp(cy,0,1)*255)} ${Math.round(clamp(cz2,0,1)*255)}`);
    }
    blob=new Blob([lines.join('\n')],{type:'text/plain;charset=utf-8'});
    name=state.fileName.replace(/\.ply$/i,'')+'.cleaned.ply';
  }
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();URL.revokeObjectURL(a.href);
  setStatus(`Exported ${name} — ${fmt(idx.length)} gaussians surviving.`);
}

async function saveToSupabase() {
  const params=new URLSearchParams(location.search), splatId=params.get('splatId');
  if(!splatId){setStatus('No splatId in URL — open from feed to save.'); return;}
  if(!state.alive){setStatus('No file loaded.'); return;}
  setStatus('Saving to Supabase…', true);
  try {
    const {supabase}=await import('../supabaseClient.js');
    const idx=[]; for(let i=0;i<state.alive.length;i++) if(state.alive[i]) idx.push(i);
    let blob;
    if(state.fileType==='splat') {
      const src=new Uint8Array(state.sourceBuffer),out=new Uint8Array(idx.length*state.splatRowSize);
      idx.forEach((i,row)=>out.set(src.subarray(i*state.splatRowSize,(i+1)*state.splatRowSize),row*state.splatRowSize));
      blob=new Blob([out],{type:'application/octet-stream'});
    }
    if(!blob){setStatus('Only .splat can be saved back.');return;}
    const path=`splats/${splatId}/cleaned_${Date.now()}.splat`;
    const arr=await blob.arrayBuffer();
    const { publicUrl: _r2Url, error } = await r2.from('splat-files').upload(path, new Blob([arr], {type:'application/octet-stream'}), {contentType:'application/octet-stream'});
    if(error)throw error;
    const publicUrl = _r2Url;
    await supabase.from('splats').update({splat_url:publicUrl,output_url:publicUrl}).eq('id',splatId);
    setStatus(`Saved! ${fmt(idx.length)} gaussians → splats record updated.`);
  } catch(err) { setStatus(`Save failed: ${err.message}`); }
}

// ── LASSO OVERLAY ─────────────────────────────────────────────────────────────
function renderLasso() {
  el.lassoSvg.innerHTML='';
  if(state.mode==='box'&&state.dragStart&&state.dragCurrent) {
    const x=Math.min(state.dragStart.x,state.dragCurrent.x),y=Math.min(state.dragStart.y,state.dragCurrent.y);
    const w=Math.abs(state.dragCurrent.x-state.dragStart.x),h=Math.abs(state.dragCurrent.y-state.dragStart.y);
    const rect=document.createElementNS('http://www.w3.org/2000/svg','rect');
    rect.setAttribute('x',x);rect.setAttribute('y',y);rect.setAttribute('width',w);rect.setAttribute('height',h);
    rect.setAttribute('class','lasso-poly');el.lassoSvg.appendChild(rect);
  } else if(state.lassoPoints.length>=2) {
    const poly=document.createElementNS('http://www.w3.org/2000/svg','polyline');
    poly.setAttribute('points',state.lassoPoints.map(p=>`${p.x},${p.y}`).join(' '));
    poly.setAttribute('class','lasso-ghost');el.lassoSvg.appendChild(poly);
  }
}

// ── POINTER EVENTS ────────────────────────────────────────────────────────────
let _brushActive=false, _brushTimer=null;
renderer.domElement.addEventListener('pointerdown',e=>{
  if(state.mode==='orbit')return;
  _brushActive=true;
  state.dragging=true; state.dragStart={x:e.clientX,y:e.clientY}; state.dragCurrent={x:e.clientX,y:e.clientY};
  if(state.mode==='lasso') state.lassoPoints=[{x:e.clientX,y:e.clientY}];
  if(state.mode==='brush-erase'||state.mode==='brush-select'||state.mode==='paint') {
    pushHistory(state.mode);
    applyBrush(e.clientX,e.clientY);
  }
  renderLasso();
});
window.addEventListener('pointermove',e=>{
  // Update brush cursor
  if(state.mode.includes('brush')||state.mode==='paint') {
    const d=state.brushSize*2;
    el.brushCursor.style.left=e.clientX+'px';el.brushCursor.style.top=e.clientY+'px';
    el.brushCursor.style.width=d+'px';el.brushCursor.style.height=d+'px';
    el.brushCursor.style.display='block';
  } else { el.brushCursor.style.display='none'; }
  if(!state.dragging||state.mode==='orbit') return;
  state.dragCurrent={x:e.clientX,y:e.clientY};
  if(state.mode==='lasso') {
    const last=state.lassoPoints[state.lassoPoints.length-1];
    if(!last||Math.hypot(last.x-e.clientX,last.y-e.clientY)>4) state.lassoPoints.push({x:e.clientX,y:e.clientY});
  }
  if((state.mode==='brush-erase'||state.mode==='brush-select'||state.mode==='paint')&&_brushActive) {
    // Throttle brush to every 16ms for performance
    clearTimeout(_brushTimer);
    _brushTimer=setTimeout(()=>applyBrush(e.clientX,e.clientY),8);
  }
  renderLasso();
});
window.addEventListener('pointerup',e=>{
  _brushActive=false;
  if(!state.dragging||state.mode==='orbit'){state.dragging=false;return;}
  if(state.mode==='box'&&state.dragStart&&state.dragCurrent) selectByScreen([state.dragStart,state.dragCurrent],true);
  if(state.mode==='lasso'&&state.lassoPoints.length>=3) selectByScreen(state.lassoPoints,false);
  state.dragging=false;state.dragStart=null;state.dragCurrent=null;state.lassoPoints=[];
  renderLasso();
});
window.addEventListener('mouseleave',()=>{ el.brushCursor.style.display='none'; });

// ── MESH ENGINE INTEGRATION ───────────────────────────────────────────────────
let _meshEngine=null, _meshVisible=false, _soundEngine=null, _splatSettings={};

function getMeshEngine() {
  if(!_meshEngine) {
    _meshEngine=new MeshEngine(scene,camera,renderer,
      (pct,msg)=>{
        setProgress(pct); setStatus(msg,pct<100);
        const el2=document.getElementById('meshStatus');
        if(el2)el2.textContent=`${msg} (${pct}%)`;
      },
      (report)=>{
        const scoreEl=document.getElementById('meshPrintScore');
        const gradeEl=document.getElementById('meshPrintGrade');
        const warnEl=document.getElementById('meshPrintWarnings');
        const sc=report.printabilityScore;
        const scColor=sc>=80?'#C8FF00':sc>=55?'#ffcc00':'#ff6464';
        if(scoreEl){scoreEl.textContent=sc;scoreEl.style.color=scColor;}
        if(gradeEl){gradeEl.textContent=report.grade;gradeEl.style.color=scColor;}
        if(warnEl){
          const sizeInfo=(report.sizeX&&Number(report.sizeX)>0)?`<div style="color:#aaa;font-size:11px;">📐 ${report.sizeX}×${report.sizeY}×${report.sizeZ} mm</div>`:'';
          warnEl.innerHTML=[
            `<div style="color:#aaa;font-size:11px;">▸ ${(report.triCount||0).toLocaleString()} tris · ${(report.vertCount||0).toLocaleString()} verts</div>`,
            sizeInfo,
            `<div style="color:${report.isWatertight?'#C8FF00':'#ff9d9d'};font-size:11px;">${report.isWatertight?'✓ Watertight':'⚠ Not watertight'}</div>`,
            ...(report.warnings||[]).map(w=>`<div style="color:#ffcc00;font-size:11px;">⚠ ${w}</div>`),
            ...(report.suggestions||[]).map(s=>`<div style="color:#aaa;font-size:11px;">💡 ${s}</div>`),
          ].filter(Boolean).join('');
        }
      }
    );
  }
  return _meshEngine;
}

function initMeshPanel() {
  if(document.getElementById('meshEnginePanel')) return;
  const rp=el.rightPanel;
  rp.style.cssText='position:fixed;right:14px;top:78px;bottom:14px;width:320px;z-index:20;background:rgba(6,8,16,.96);border:1px solid rgba(255,255,255,.1);backdrop-filter:blur(24px);border-radius:20px;overflow:hidden;display:flex;flex-direction:column;transform:translateX(calc(100% + 14px));transition:transform .3s cubic-bezier(.4,0,.2,1)';
  const R=(id,mn,mx,st,v,c='#C8FF00')=>`<input id="${id}" type="range" min="${mn}" max="${mx}" step="${st}" value="${v}" style="width:100%;accent-color:${c};height:4px;cursor:pointer">`;
  const N=(id,v,mn,mx,st,ph='')=>`<input id="${id}" type="number" value="${v}" min="${mn}" max="${mx}" step="${st}" placeholder="${ph}" style="width:100%;padding:6px 10px;border-radius:8px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);color:#f5f5f5;font:inherit;font-size:12px;box-sizing:border-box">`;
  const C=(id,ch,label,c='#C8FF00')=>`<label style="display:flex;align-items:center;gap:7px;font-size:12px;cursor:pointer;user-select:none"><input id="${id}" type="checkbox" ${ch?'checked':''} style="accent-color:${c}">${label}</label>`;
  const B=(id,text,bg,bd,col)=>`<button id="${id}" style="padding:9px;border-radius:10px;background:${bg};border:1px solid ${bd};color:${col};font:700 12px/1 inherit;cursor:pointer;width:100%;margin-bottom:5px">${text}</button>`;
  const SEC=(title,body,c='#C8FF00')=>`<div style="padding:12px;border-radius:12px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);margin-bottom:8px"><div style="font-size:10px;font-weight:800;color:${c};letter-spacing:.08em;margin-bottom:9px">${title}</div>${body}</div>`;
  rp.innerHTML=`
    <div id="meshEnginePanel" style="display:flex;flex-direction:column;height:100%">
      <div style="padding:14px 16px 10px;border-bottom:1px solid rgba(255,255,255,.09);display:flex;justify-content:space-between;align-items:center;flex-shrink:0">
        <div style="font-size:14px;font-weight:800;color:#C8FF00;font-family:Syne,sans-serif">🧱 3D Print Studio</div>
        <button id="meshPanelCloseBtn" style="background:none;border:none;color:#aaa;font-size:18px;cursor:pointer;line-height:1">✕</button>
      </div>
      <div style="flex:1;overflow-y:auto;padding:12px">
        ${SEC('RECONSTRUCTION',`
          <div style="display:flex;justify-content:space-between;font-size:11px;color:#aaa"><span>Voxel Size</span><span id="meshVoxelLabel" style="color:#C8FF00">0.012</span></div>
          ${R('meshVoxelRange','0.003','0.08','0.001','0.012')}
          <div style="display:flex;justify-content:space-between;font-size:11px;color:#aaa;margin-top:8px"><span>Smooth Passes</span><span id="meshSmoothLabel" style="color:#C8FF00">2</span></div>
          ${R('meshSmoothRange','0','14','1','2')}
          <div style="display:flex;justify-content:space-between;font-size:11px;color:#aaa;margin-top:8px"><span>Keep Triangles</span><span id="meshDecimLabel" style="color:#C8FF00">100%</span></div>
          ${R('meshDecimRange','5','100','5','100')}
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px">
            ${C('meshFillHolesCheck',true,'Fill holes')} ${C('meshRepairCheck',true,'Repair manifold')}
            ${C('meshWireframeCheck',false,'Wireframe','#7b2fff')} ${C('meshOverhangCheck',false,'Overhangs','#ff4444')}
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px">
            <div><div style="font-size:10px;color:#aaa;margin-bottom:3px">Shading</div>
            <select id="meshShadingSelect" style="width:100%;padding:5px 8px;border-radius:8px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);color:#f5f5f5;font:inherit;font-size:11px"><option value="smooth">Smooth</option><option value="flat">Flat</option></select></div>
            <div><div style="font-size:10px;color:#aaa;margin-bottom:3px">Overhang °</div>${N('meshOverhangAngle','45','10','89','1')}</div>
          </div>`)}
        ${SEC('PRINT SIZING',`
          <div style="font-size:11px;color:#aaa;margin-bottom:5px">Scale longest axis to mm (0 = no scale)</div>
          ${N('meshScaleMM','0','0','9999','1','e.g. 100 = 10cm')}
          <div style="margin-top:8px">${C('meshHollowCheck',false,'Hollow shell')}</div>
          <div id="meshHollowWrap" style="display:none;margin-top:6px"><div style="font-size:10px;color:#aaa;margin-bottom:3px">Shell thickness (mm)</div>${N('meshShellThickMM','2','0.5','10','0.5')}</div>`,'#ffcc00')}
        <button id="meshBuildBtn" style="width:100%;padding:12px;border-radius:12px;background:rgba(200,255,0,.12);border:1px solid rgba(200,255,0,.3);color:#C8FF00;font:800 13px/1 inherit;cursor:pointer;margin-bottom:8px">⚙️ Build Mesh</button>
        ${SEC('SCULPT',`
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
            <button id="meshSmoothBtn" style="padding:9px;border-radius:9px;background:rgba(123,47,255,.1);border:1px solid rgba(123,47,255,.2);color:#b48fff;font:700 11px/1 inherit;cursor:pointer">💆 Smooth</button>
            <button id="meshSharpenBtn" style="padding:9px;border-radius:9px;background:rgba(255,170,0,.08);border:1px solid rgba(255,170,0,.2);color:#ffcc44;font:700 11px/1 inherit;cursor:pointer">✦ Sharpen</button>
            <button id="meshFillNowBtn" style="padding:9px;border-radius:9px;background:rgba(0,200,100,.08);border:1px solid rgba(0,200,100,.2);color:#44ffaa;font:700 11px/1 inherit;cursor:pointer">🕳 Fill Holes</button>
            <button id="meshRepairNowBtn" style="padding:9px;border-radius:9px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:#f5f5f5;font:700 11px/1 inherit;cursor:pointer">🔧 Fix Manifold</button>
            <button id="meshUndoBtn" style="padding:9px;border-radius:9px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);color:#aaa;font:700 11px/1 inherit;cursor:pointer">↩ Undo</button>
            <button id="meshToggleVisBtn" style="padding:9px;border-radius:9px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);color:#aaa;font:700 11px/1 inherit;cursor:pointer">👁 Toggle</button>
          </div>`,'#b48fff')}
        <button id="meshAutoRepairBtn" style="width:100%;padding:10px;border-radius:10px;background:rgba(0,200,100,.1);border:1px solid rgba(0,200,100,.25);color:#44ffaa;font:800 12px/1 inherit;cursor:pointer;margin-bottom:8px">🩺 Auto Repair for Print</button>
        ${SEC('PRINTABILITY',`
          <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:6px">
            <span id="meshPrintScore" style="font-size:36px;font-weight:900;color:#555;line-height:1">—</span>
            <span id="meshPrintGrade" style="font-size:22px;font-weight:900;color:#555"></span>
            <span style="font-size:10px;color:#444">/ 100</span>
          </div>
          <div id="meshPrintWarnings" style="display:flex;flex-direction:column;gap:4px"></div>`,'#ff9d9d')}
        <div id="meshStatus" style="font-size:11px;color:#aaa;padding:8px;border-radius:8px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);margin-bottom:8px">Load a splat or PLY, then click Build.</div>
        ${SEC('EXPORT',`
          ${B('meshExportStlBtn','📦 STL — Universal (Cura, Bambu, PrusaSlicer)','rgba(200,255,0,.08)','rgba(200,255,0,.2)','#C8FF00')}
          ${B('meshExport3mfBtn','📦 3MF — Bambu Studio native','rgba(123,47,255,.1)','rgba(123,47,255,.2)','#b48fff')}
          ${B('meshExportObjBtn','📦 OBJ + colours (Blender, Fusion 360)','rgba(255,255,255,.04)','rgba(255,255,255,.09)','#f5f5f5')}
          ${B('meshExportPlyBtn','📦 PLY mesh (MeshLab, CloudCompare)','rgba(255,255,255,.04)','rgba(255,255,255,.09)','#f5f5f5')}`)}
      </div>
    </div>`;

  const g=(id)=>document.getElementById(id);
  const vR=g('meshVoxelRange'),smR=g('meshSmoothRange'),dcR=g('meshDecimRange');
  const fillC=g('meshFillHolesCheck'),repC=g('meshRepairCheck'),wireC=g('meshWireframeCheck'),ovhC=g('meshOverhangCheck');
  const shadS=g('meshShadingSelect'),ovhA=g('meshOverhangAngle'),scMM=g('meshScaleMM'),holC=g('meshHollowCheck'),shlMM=g('meshShellThickMM');
  vR.addEventListener('input',e=>g('meshVoxelLabel').textContent=Number(e.target.value).toFixed(3));
  smR.addEventListener('input',e=>g('meshSmoothLabel').textContent=e.target.value);
  dcR.addEventListener('input',e=>g('meshDecimLabel').textContent=e.target.value+'%');
  wireC.addEventListener('change',e=>_meshEngine?.setShowWireframe(e.target.checked));
  ovhC.addEventListener('change',e=>_meshEngine?.setShowOverhangs(e.target.checked));
  shadS.addEventListener('change',e=>_meshEngine?.setShadingMode(e.target.value));
  holC.addEventListener('change',e=>{g('meshHollowWrap').style.display=e.target.checked?'block':'none';});
  function applyMeshParams(me){
    me.setVoxelSize(Number(vR.value));me.setSmoothIterations(Number(smR.value));me.setDecimationTarget(Number(dcR.value)/100);
    me.setFillHoles(fillC.checked);me.setRepairManifold(repC.checked);me.setShowWireframe(wireC.checked);me.setShowOverhangs(ovhC.checked);
    me.setShadingMode(shadS.value);me.setOverhangAngle(Number(ovhA.value)||45);
    const mm=Number(scMM.value)||0;me.setScaleToMM(mm>0?mm:null);
    me.setHollowShell(holC.checked,Number(shlMM.value)||2);
  }
  g('meshBuildBtn').addEventListener('click',async()=>{
    if(!state.positions){document.getElementById('meshStatus').textContent='Load a file first.';return;}
    const me=getMeshEngine();applyMeshParams(me);me.setPoints(state.positions,state.colors,state.alive);
    _meshVisible=true;me.show();await me.rebuildLive();
  });
  g('meshAutoRepairBtn').addEventListener('click',async()=>await getMeshEngine().autoRepairForPrint());
  g('meshSmoothBtn').addEventListener('click',async()=>await getMeshEngine().smoothSelected(Number(smR.value)||2));
  g('meshSharpenBtn').addEventListener('click',async()=>await getMeshEngine().sharpen(1));
  g('meshFillNowBtn').addEventListener('click',async()=>{
    const me=getMeshEngine();if(!me._vArr){document.getElementById('meshStatus').textContent='Build first.';return;}
    me._pushHistory();const r=me._fillHolesAdvanced(me._vArr,me._nArr,me._cArr,me._iArr);
    me._vArr=r.vArr;me._nArr=r.nArr;me._cArr=r.cArr;me._iArr=r.iArr;
    me._nArr=me._recomputeNormals(me._vArr,me._iArr);me._commitGeometry(me._vArr,me._nArr,me._cArr,me._iArr);
    const rp=me._checkPrintability(me._vArr,me._nArr,me._iArr);me._onPrintReport(rp);me._report(100,'Holes filled.');
  });
  g('meshRepairNowBtn').addEventListener('click',async()=>{
    const me=getMeshEngine();if(!me._vArr){return;}
    me._pushHistory();const r=me._repairNonManifold(me._vArr,me._nArr,me._cArr,me._iArr);
    me._vArr=r.vArr;me._nArr=r.nArr;me._cArr=r.cArr;me._iArr=r.iArr;
    me._commitGeometry(me._vArr,me._nArr,me._cArr,me._iArr);me._report(100,'Non-manifold removed.');
  });
  g('meshUndoBtn').addEventListener('click',()=>getMeshEngine().undo());
  g('meshToggleVisBtn').addEventListener('click',()=>{if(_meshEngine){_meshVisible=!_meshVisible;_meshVisible?_meshEngine.show():_meshEngine.hide();}});
  const bname=()=>(state.fileName||'fumoca').replace(/\.[^.]+$/,'');
  g('meshExportStlBtn').addEventListener('click',()=>getMeshEngine().exportSTL(bname()+'.stl'));
  g('meshExport3mfBtn').addEventListener('click',()=>getMeshEngine().export3MF(bname()+'.3mf'));
  g('meshExportObjBtn').addEventListener('click',()=>getMeshEngine().exportOBJ(bname()+'.obj'));
  g('meshExportPlyBtn').addEventListener('click',()=>getMeshEngine().exportPLY(bname()+'_mesh.ply'));
  g('meshPanelCloseBtn').addEventListener('click',()=>{rp.style.transform='translateX(calc(100% + 14px))';rp.classList.remove('open');});
}

// ── ANIMATE LOOP ──────────────────────────────────────────────────────────────
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  syncSplatCamera();
  renderer.render(scene,camera);
}
animate();
window.addEventListener('resize',()=>{
  camera.aspect=window.innerWidth/window.innerHeight;camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth,window.innerHeight);renderLasso();
});

// ── RANGE LABEL BINDINGS ──────────────────────────────────────────────────────
el.brushSizeRange.addEventListener('input',e=>{state.brushSize=Number(e.target.value);el.brushSizeVal.textContent=e.target.value;const d=state.brushSize*2;el.brushCursor.style.width=d+'px';el.brushCursor.style.height=d+'px';});
el.brushStrRange.addEventListener('input',e=>{state.brushStrength=Number(e.target.value)/100;el.brushStrVal.textContent=e.target.value+'%';});
el.brightnessRange.addEventListener('input',e=>{state.brightness=Number(e.target.value)/100;el.brightnessVal.textContent=(state.brightness).toFixed(1)+'×';rebuildGeometry();});
el.ptScaleRange.addEventListener('input',e=>{state.ptScale=Number(e.target.value)/100;el.ptScaleVal.textContent=(state.ptScale).toFixed(1)+'×';rebuildGeometry();});
el.radiusRange.addEventListener('input',e=>el.radiusVal.textContent=Number(e.target.value).toFixed(2));
el.neighbourRange.addEventListener('input',e=>el.neighbourVal.textContent=e.target.value);
el.opacityRange.addEventListener('input',e=>el.opacityVal.textContent=Number(e.target.value).toFixed(2));
el.scaleRange.addEventListener('input',e=>el.scaleVal.textContent=Number(e.target.value).toFixed(2));
el.pruneRange.addEventListener('input',e=>el.pruneVal.textContent=e.target.value+'%');

// ── BUTTON BINDINGS ───────────────────────────────────────────────────────────
el.orbitBtn.addEventListener('click',()=>setMode('orbit'));
el.boxBtn.addEventListener('click',()=>setMode('box'));
el.lassoBtn.addEventListener('click',()=>setMode('lasso'));
el.brushEraseBtn.addEventListener('click',()=>setMode('brush-erase'));
el.brushSelectBtn.addEventListener('click',()=>setMode('brush-select'));
el.paintBtn.addEventListener('click',()=>setMode('paint'));
el.deleteBtn.addEventListener('click',deleteSelected);
el.clearSelBtn.addEventListener('click',clearSelection);
el.undoBtn.addEventListener('click',undo);
el.invertSelBtn.addEventListener('click',invertSelection);
el.growSelBtn.addEventListener('click',growSelection);
el.shrinkSelBtn.addEventListener('click',shrinkSelection);
el.dispSplatBtn.addEventListener('click',()=>setDisplayMode(DISP.SPLAT));
el.dispBlobBtn.addEventListener('click',()=>setDisplayMode(DISP.BLOB));
el.dispDotBtn.addEventListener('click',()=>setDisplayMode(DISP.DOT));
el.dispColorBtn.addEventListener('click',()=>setDisplayMode(DISP.COLOR));
el.dispOpacBtn.addEventListener('click',()=>setDisplayMode(DISP.OPACITY));
el.dispScaleBtn.addEventListener('click',()=>setDisplayMode(DISP.SCALE));
el.autoCleanBtn.addEventListener('click',autoCleanSubject);
el.selectFloatersBtn.addEventListener('click',selectFloaters);
el.selectOuterBtn.addEventListener('click',selectOuterNoise);
el.selectLowOpBtn.addEventListener('click',selectLowOpacity);
el.selectLargeScaleBtn.addEventListener('click',selectLargeScale);
el.opacSharpenBtn.addEventListener('click',opacitySharpen);
el.densityPruneBtn.addEventListener('click',densityPrune);
el.exportCleanedBtn.addEventListener('click',exportCleaned);
el.exportBtn.addEventListener('click',exportCleaned);
el.saveToSupabaseBtn.addEventListener('click',saveToSupabase);
el.openBtn.addEventListener('click',()=>el.fileInput.click());
el.fileInput.addEventListener('change',async e=>{ const f=e.target.files?.[0]; if(f)await loadFile(f).catch(err=>setStatus(err.message)); });
el.backBtn.addEventListener('click',()=>{ if(document.referrer)history.back();else location.href='viewer.html'; });
el.meshToggleBtn.addEventListener('click',()=>{
  initMeshPanel();
  const rp=el.rightPanel;
  const isOpen=rp.style.transform==='translateX(0px)'||rp.style.transform.includes('translateX(0)');
  rp.style.transform=isOpen?'translateX(calc(100% + 14px))':'translateX(0)';
});

// ── KEYBOARD ─────────────────────────────────────────────────────────────────
window.addEventListener('keydown',e=>{
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();undo();return;}
  if(e.key==='Delete'||e.key==='Backspace'){if(document.activeElement.tagName!=='INPUT'){e.preventDefault();deleteSelected();return;}}
  if(e.key==='Escape'){e.preventDefault();clearSelection();state.lassoPoints=[];renderLasso();return;}
  if(e.key.toLowerCase()==='b')setMode('orbit');
  if(e.key.toLowerCase()==='x')setMode('box');
  if(e.key.toLowerCase()==='e')setMode('brush-erase');
  if(e.key.toLowerCase()==='g')setDisplayMode(state.displayMode===DISP.BLOB?DISP.DOT:DISP.BLOB);
});

// ── DRAG & DROP ───────────────────────────────────────────────────────────────
['dragenter','dragover'].forEach(t=>window.addEventListener(t,e=>{e.preventDefault();el.dropZone.classList.add('drag-over');}));
['dragleave','drop'].forEach(t=>window.addEventListener(t,e=>{e.preventDefault();el.dropZone.classList.remove('drag-over');}));
window.addEventListener('drop',async e=>{ const f=e.dataTransfer?.files?.[0];if(f)await loadFile(f).catch(err=>setStatus(err.message)); });
el.dropZone.addEventListener('click',()=>el.fileInput.click());

// ── SECTION TOGGLES ───────────────────────────────────────────────────────────
document.querySelectorAll('.section-head').forEach(h=>{
  h.addEventListener('click',()=>h.closest('.section').classList.toggle('collapsed'));
});

// ── BOOTSTRAP FROM URL ────────────────────────────────────────────────────────
(async function bootstrap(){
  const params=new URLSearchParams(location.search);
  const fileUrl=params.get('file'), back=params.get('back');
  if(back) el.backBtn.onclick=()=>{location.href=back;};
  if(!fileUrl) return;
  try {
    setStatus('Loading from viewer…',true);setProgress(20);
    const res=await fetch(fileUrl);
    if(!res.ok) throw new Error(`Fetch failed: ${res.status}`);
    const blob=await res.blob();
    const name=decodeURIComponent((fileUrl.split('/').pop()||'scene').split('?')[0]);
    const file=new File([blob],name,{type:blob.type||'application/octet-stream'});
    await loadFile(file,fileUrl);
  } catch(err) { setStatus(`Handoff failed: ${err.message}`); }
})();
