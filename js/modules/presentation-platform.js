import { fitSelectedSupportPlane, previewSupportPlaneTrim } from './support-plane.js';
/* FUMOCA Presentation Platform — non-destructive Three.js display base */
const VERSION = '1.0.0';
const $ = (id) => document.getElementById(id);
const state = {
  enabled: true, shape: 'circle', material: 'black',
  width: 460, height: 24, edge: 18, offsetY: 0,
  led: true, logoUrl: null, logoSize: 400, logoRotation: 0, logoOffset: -5,
  group: null, top: null, body: null, ring: null, logo: null,
  texture: null, unit: 1, lastBounds: null, dirty: true, logoDataUrl: null, gestureStart: null, suspendAutoFit: false, supportPlanePreview: null, supportBackup: null
};
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
function boundsFromSplat(){
  const S=window.S;if(!S?.positions||!S?.alive)return null;
  const values=[[],[],[]];
  for(let i=0;i<S.alive.length;i++)if(S.alive[i]){
    const x=S.positions[i*3],y=S.positions[i*3+1],z=S.positions[i*3+2];
    if(Number.isFinite(x)&&Number.isFinite(y)&&Number.isFinite(z)){values[0].push(x);values[1].push(y);values[2].push(z);}
  }
  if(!values[0].length)return null;
  const quantile=(a,q)=>{a.sort((x,y)=>x-y);return a[Math.min(a.length-1,Math.max(0,Math.floor((a.length-1)*q)))];};
  const min=values.map(a=>quantile(a,.015)),max=values.map(a=>quantile(a,.985));
  const size=max.map((v,i)=>Math.max(v-min[i],1e-4));
  return {min,max,size,center:min.map((v,i)=>(v+max[i])*.5)};
}
function makeShape(w,d,r){
  const s=new THREE.Shape(),x=-w/2,z=-d/2;
  if(state.shape==='circle'){s.absarc(0,0,w/2,0,Math.PI*2,false);return s;}
  if(state.shape==='square'){d=w;}
  const rr=clamp(r*state.unit,0,Math.min(w,d)*.48);
  s.moveTo(x+rr,z);s.lineTo(x+w-rr,z);s.quadraticCurveTo(x+w,z,x+w,z+rr);
  s.lineTo(x+w,z+d-rr);s.quadraticCurveTo(x+w,z+d,x+w-rr,z+d);
  s.lineTo(x+rr,z+d);s.quadraticCurveTo(x,z+d,x,z+d-rr);
  s.lineTo(x,z+rr);s.quadraticCurveTo(x,z,x+rr,z);return s;
}
function materialFor(kind){
  if(kind==='wood')return new THREE.MeshStandardMaterial({color:0x795333,roughness:.72,metalness:.02});
  if(kind==='white')return new THREE.MeshStandardMaterial({color:0xe9edf0,roughness:.38,metalness:.04});
  if(kind==='metal')return new THREE.MeshStandardMaterial({color:0x9ba7b0,roughness:.24,metalness:.82});
  if(kind==='glass')return new THREE.MeshPhysicalMaterial({color:0xb9e6ee,roughness:.16,metalness:.08,transparent:true,opacity:.82,thickness:.35});
  return new THREE.MeshStandardMaterial({color:0x11151b,roughness:.3,metalness:.32});
}
function disposeObject(obj){
  if(!obj)return;obj.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material){for(const m of (Array.isArray(o.material)?o.material:[o.material])){if(m.map&&m.map!==state.texture)m.map.dispose();m.dispose();}}});
}
function build(){
  const T=window.THREE;if(!T||!window.scene)return;
  const b=boundsFromSplat();if(!b)return;
  state.lastBounds=b;
  const footprint=Math.max(b.size[0],b.size[2],.01);
  state.unit=footprint/400;
  const width=footprint*(state.width/400);
  const depth=(state.shape==='circle'||state.shape==='square')?width:width*.78;
  const thick=Math.max(state.height*state.unit,.006);
  const edge=clamp(state.edge*state.unit,0,Math.min(width,depth)*.18);
  const g=new T.Group();g.name='FUMOCA Presentation Platform';g.userData.fumocaPresentationPlatform=true;
  const shape=makeShape(width,depth,state.edge);
  const bevel=Math.min(edge*.42,thick*.22);
  const geo=new T.ExtrudeGeometry(shape,{depth:thick,bevelEnabled:bevel>0,bevelSegments:4,steps:1,bevelSize:bevel,bevelThickness:bevel,curveSegments:64});
  geo.rotateX(-Math.PI/2);geo.computeVertexNormals();
  const base=new T.Mesh(geo,materialFor(state.material));
  base.name='Solid presentation pedestal';base.castShadow=true;base.receiveShadow=true;g.add(base);
  const ring=new T.Mesh(new T.TorusGeometry(Math.min(width,depth)*.475,Math.max(thick*.018,.0015),8,128),new T.MeshBasicMaterial({color:0xc6a56a}));
  ring.rotation.x=Math.PI/2;ring.position.y=-thick*.06;ring.name='LED accent ring';ring.visible=state.led;g.add(ring);
  if(state.logoDataUrl||state.logoUrl){
    const img=new Image();img.onload=()=>{
      if(state.group!==g)return;
      const c=document.createElement('canvas');c.width=512;c.height=512;const ctx=c.getContext('2d');
      ctx.clearRect(0,0,512,512);ctx.drawImage(img,32,32,448,448);
      const tex=new T.CanvasTexture(c);tex.colorSpace=T.SRGBColorSpace;
      const size=Math.min(width,depth)*(state.logoSize/600);
      const plane=new T.Mesh(new T.PlaneGeometry(size,size),new T.MeshBasicMaterial({map:tex,transparent:true,side:T.DoubleSide,depthWrite:false,toneMapped:false}));
      plane.rotation.x=Math.PI/2;plane.rotation.z=state.logoRotation*Math.PI/180;
      plane.position.set(0,-thick*.98+state.logoOffset*state.unit,0);plane.name='Underside brand logo';g.add(plane);state.logo=plane;
    };img.onerror=()=>console.warn('[FUMOCA Platform] Logo image could not be loaded');img.src=state.logoDataUrl||state.logoUrl;
  }
  const gap=Math.max(footprint*.006,.001);
  g.position.set(b.center[0],b.min[1]-gap-thick+state.offsetY*state.unit,b.center[2]);
  g.visible=state.enabled;
  if(state.group){window.scene.remove(state.group);disposeObject(state.group);}
  state.group=g;state.top=base;state.body=base;state.ring=ring;window.scene.add(g);
  window.dispatchEvent(new CustomEvent('fumoca:presentation-platform-updated',{detail:{config:getConfig()}}));
}
function getConfig(){return {version:VERSION,enabled:state.enabled,shape:state.shape,material:state.material,width:state.width,height:state.height,edge:state.edge,offsetY:state.offsetY,led:state.led,logoSize:state.logoSize,logoRotation:state.logoRotation,logoOffset:state.logoOffset,logoDataUrl:state.logoDataUrl||null};}
function beginSplatTransform(centroid){if(!state.group||!centroid)return;state.gestureStart={position:state.group.position.clone(),quaternion:state.group.quaternion.clone(),scale:state.group.scale.clone(),centroid:new THREE.Vector3(centroid.x,centroid.y,centroid.z)};}
function updateSplatTransform({move={x:0,y:0,z:0},quaternion={x:0,y:0,z:0,w:1},scale={x:1,y:1,z:1}}={}){const start=state.gestureStart,g=state.group;if(!start||!g)return;const q=new THREE.Quaternion(quaternion.x,quaternion.y,quaternion.z,quaternion.w).normalize();const d=new THREE.Vector3(start.position.x-start.centroid.x,start.position.y-start.centroid.y,start.position.z-start.centroid.z);d.set(d.x*scale.x,d.y*scale.y,d.z*scale.z).applyQuaternion(q);g.position.set(start.centroid.x+move.x+d.x,start.centroid.y+move.y+d.y,start.centroid.z+move.z+d.z);g.quaternion.copy(q).multiply(start.quaternion).normalize();g.scale.set(start.scale.x*scale.x,start.scale.y*scale.y,start.scale.z*scale.z);}
function endSplatTransform(){state.gestureStart=null;save();}
function save(){
  try{localStorage.setItem('fumoca-platform:'+((window.S?.fileName)||'untitled'),JSON.stringify(getConfig()));}catch(e){}
  window.dispatchEvent(new CustomEvent('fumoca:presentation-platform-save',{detail:{config:getConfig()}}));
}
function restore(){
  try{const raw=localStorage.getItem('fumoca-platform:'+((window.S?.fileName)||'untitled'));if(raw){const c=JSON.parse(raw);Object.assign(state,c);state.logoUrl=null;}}catch(e){}
}
function addStyles(){
  if($('fumocaPlatformStyles'))return;
  const st=document.createElement('style');st.id='fumocaPlatformStyles';st.textContent=`
  #fumocaPlatformRoot{padding:8px;color:#e8edf2;font:12px Outfit,Arial,sans-serif}
  #fumocaPlatformRoot .fp-section{border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:10px;margin-bottom:9px;background:rgba(255,255,255,.025)}
  #fumocaPlatformRoot .fp-title{font-weight:800;letter-spacing:.08em;color:#d4ff00;font-size:10px;margin-bottom:9px;text-transform:uppercase}
  #fumocaPlatformRoot .fp-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:5px}
  #fumocaPlatformRoot button{background:#171b23;border:1px solid rgba(255,255,255,.12);color:#e9edf2;border-radius:7px;padding:8px 4px;font-size:11px;cursor:pointer}
  #fumocaPlatformRoot button.active{border-color:#d4ff00;color:#d4ff00;background:rgba(212,255,0,.09)}
  #fumocaPlatformRoot .fp-row{display:grid;grid-template-columns:75px 1fr 54px;align-items:center;gap:6px;margin:8px 0}
  #fumocaPlatformRoot input[type=range]{width:100%;accent-color:#00c8ff}
  #fumocaPlatformRoot output{background:#202630;border-radius:5px;padding:5px;text-align:right;font-variant-numeric:tabular-nums}
  #fumocaPlatformRoot .fp-swatches{display:grid;grid-template-columns:repeat(5,1fr);gap:6px}
  #fumocaPlatformRoot .fp-swatch{height:34px;border-radius:50%;border:2px solid rgba(255,255,255,.3);padding:0}
  #fumocaPlatformRoot .fp-primary{width:100%;padding:11px!important;background:#078ee9!important;border:0!important;font-weight:800!important;margin-top:5px}
  #fumocaPlatformRoot .fp-note{color:#8d99a8;font-size:10px;line-height:1.5}
  `;document.head.appendChild(st);
}
function renderUI(){
  const root=$('fumocaPlatformRoot');if(!root)return;
  root.innerHTML=`
  <div class="fp-section"><div class="fp-title">Presentation base</div>
    <label><input id="fpEnabled" type="checkbox" checked> Show platform</label>
    <div class="fp-grid" style="margin-top:9px">
      <button data-shape="circle" class="active">◯<br>Circle</button><button data-shape="square">□<br>Square</button><button data-shape="rectangle">▭<br>Rectangle</button><button data-shape="custom">⌘<br>Custom</button>
    </div>
    <div class="fp-row"><span>Width</span><input id="fpWidth" type="range" min="150" max="1200" value="460"><output id="fpWidthOut">460 mm</output></div>
    <div class="fp-row"><span>Height</span><input id="fpHeight" type="range" min="8" max="80" value="24"><output id="fpHeightOut">80 mm</output></div>
    <div class="fp-row"><span>Edge radius</span><input id="fpEdge" type="range" min="0" max="80" value="20"><output id="fpEdgeOut">20 mm</output></div>
    <div class="fp-row"><span>Position Y</span><input id="fpOffset" type="range" min="-300" max="100" value="0"><output id="fpOffsetOut">0 mm</output></div>
  </div>
  <div class="fp-section"><div class="fp-title">Material</div><div class="fp-swatches">
    <button class="fp-swatch" data-material="wood" title="Wood" style="background:repeating-linear-gradient(12deg,#5b2e14,#bd8750 5px,#3b1b0c 9px)"></button>
    <button class="fp-swatch active" data-material="black" title="Black" style="background:#101216"></button>
    <button class="fp-swatch" data-material="white" title="White" style="background:#eee"></button>
    <button class="fp-swatch" data-material="metal" title="Metal" style="background:linear-gradient(135deg,#555,#ddd,#666)"></button>
    <button class="fp-swatch" data-material="glass" title="Glass" style="background:linear-gradient(135deg,#b9e6ee,#526b7a)"></button>
  </div><label style="display:block;margin-top:9px"><input id="fpLed" type="checkbox" checked> LED accent ring</label></div>
  <div class="fp-section"><div class="fp-title">Logo · underside</div>
    <input id="fpLogo" type="file" accept="image/png,image/jpeg,image/webp" hidden>
    <button id="fpUpload">Upload logo</button> <button id="fpRemove">Remove</button>
    <div class="fp-row"><span>Size</span><input id="fpLogoSize" type="range" min="80" max="600" value="400"><output id="fpLogoSizeOut">400 mm</output></div>
    <div class="fp-row"><span>Rotation</span><input id="fpLogoRot" type="range" min="0" max="360" value="0"><output id="fpLogoRotOut">0°</output></div>
    <div class="fp-row"><span>Offset</span><input id="fpLogoOff" type="range" min="-30" max="30" value="-5"><output id="fpLogoOffOut">-5 mm</output></div>
    <div class="fp-note">Logo is attached to the underside of the platform. Transparent PNG works best.</div>
  </div>
  <div class="fp-section"><div class="fp-title">Scene integration</div><div class="fp-note" id="fpBuildStamp">Support analysis build 2026.10.30.3</div>
    <div class="fp-note">The platform is a separate Three.js object. Your original Gaussian scan remains untouched.</div>
    <button id="fpApply" class="fp-primary">Apply to scene</button>
    <button id="fpAnalyseSupport" style="width:100%;margin-top:7px;border-color:#d4ff00;color:#d4ff00">Analyse selected support area</button>
    <div id="fpSupportReport" class="fp-note" style="margin-top:8px">Select a broad patch on the cap's actual underside, then analyse. Nothing changes until you approve a safe preview.</div>
    <button id="fpApplyCorrection" class="fp-primary" style="background:#16865b!important" disabled>Level, trim & seat cap</button>
    <button id="fpRestoreCorrection" style="width:100%;margin-top:7px" disabled>Undo correction / restore original</button>
    <button id="fpSave" style="width:100%;margin-top:7px">Save platform settings</button>
  </div>`;
  const bindRange=(id,key,out,suffix=' mm')=>$(id).addEventListener('input',e=>{state[key]=+e.target.value;$(out).textContent=state[key]+suffix;build();});
  $('fpEnabled').addEventListener('change',e=>{state.enabled=e.target.checked;if(state.group)state.group.visible=state.enabled;});
  root.querySelectorAll('[data-shape]').forEach(b=>b.addEventListener('click',()=>{state.shape=b.dataset.shape;root.querySelectorAll('[data-shape]').forEach(x=>x.classList.toggle('active',x===b));build();}));
  root.querySelectorAll('[data-material]').forEach(b=>b.addEventListener('click',()=>{state.material=b.dataset.material;root.querySelectorAll('[data-material]').forEach(x=>x.classList.toggle('active',x===b));build();}));
  bindRange('fpWidth','width','fpWidthOut');bindRange('fpHeight','height','fpHeightOut');bindRange('fpEdge','edge','fpEdgeOut');bindRange('fpOffset','offsetY','fpOffsetOut');
  bindRange('fpLogoSize','logoSize','fpLogoSizeOut');bindRange('fpLogoRot','logoRotation','fpLogoRotOut','°');bindRange('fpLogoOff','logoOffset','fpLogoOffOut');
  $('fpLed').addEventListener('change',e=>{state.led=e.target.checked;build();});
  $('fpUpload').addEventListener('click',()=>$('fpLogo').click());
  $('fpLogo').addEventListener('change',e=>{const file=e.target.files?.[0];if(!file)return;if(file.size>1024*1024){alert('Please use a logo image smaller than 1 MB.');e.target.value='';return;}const reader=new FileReader();reader.onload=()=>{state.logoDataUrl=String(reader.result||'');state.logoUrl=null;build();save();};reader.onerror=()=>alert('Could not read that logo file.');reader.readAsDataURL(file);});
  $('fpRemove').addEventListener('click',()=>{if(state.logoUrl)URL.revokeObjectURL(state.logoUrl);state.logoUrl=null;state.logoDataUrl=null;build();save();});
  $('fpApply').addEventListener('click',()=>{build();save();});
  $('fpAnalyseSupport').addEventListener('click',()=>{const S=window.S,report=$('fpSupportReport'),indices=[];if(S?.selected)for(let i=0;i<S.selected.length;i++)if(S.selected[i]&&S.alive?.[i])indices.push(i);if(indices.length<30){report.textContent='Select at least 30 points on the cap underside. Use a close underside view and avoid the brim edge and floating noise.';return;}const interior=[0,0,0];let interiorCount=0;for(let i=0;i<S.alive.length;i++)if(S.alive[i]){interior[0]+=S.positions[i*3];interior[1]+=S.positions[i*3+1];interior[2]+=S.positions[i*3+2];interiorCount++;}if(interiorCount)for(let a=0;a<3;a++)interior[a]/=interiorCount;const plane=fitSelectedSupportPlane(S.positions,indices,{orientationPoint:interior});if(!plane){report.textContent='No reliable support plane found. Select a broader, flatter patch on the actual underside and try again.';return;}const preview=previewSupportPlaneTrim(S.positions,S.alive,plane,{maxTrimRatio:.35});state.supportPlanePreview={plane,preview,sourceCount:indices.length};$('fpApplyCorrection').disabled=!preview.safe||!!state.supportBackup;report.textContent='Plane detected from '+plane.inlierCount.toLocaleString()+' / '+plane.sampleCount.toLocaleString()+' selected samples ('+Math.round(plane.inlierRatio*100)+'% consensus). Estimated trim: '+preview.below.toLocaleString()+' points; retained side: '+preview.above.toLocaleString()+'. '+(preview.safe?'Review the result, then choose Level, trim & seat cap.':'Preview rejected by safety gate. No points changed.');window.dispatchEvent(new CustomEvent('fumoca:support-plane-preview',{detail:state.supportPlanePreview}));});
  $('fpApplyCorrection').disabled=true;\n  $('fpRestoreCorrection').disabled=!state.supportBackup;\n  $('fpApplyCorrection').addEventListener('click',()=>{
    const S=window.S,entry=state.supportPlanePreview;
    if(!S?.positions||!S?.alive||!entry?.preview?.safe||!state.group){alert('Run a safe support-plane analysis first.');return;}
    if(state.supportBackup){alert('A correction backup already exists. Restore it before applying another correction.');return;}
    const confirmText='Apply the reviewed support plane? This levels the scan, trims points below the plane and seats the flat underside on the platform. A full in-memory backup is kept for Undo.';
    if(!confirm(confirmText))return;
    const live=S.alive.reduce((n,v)=>n+(v?1:0),0),p=entry.plane,preview=entry.preview;
    state.supportBackup={positions:S.positions.slice(),alive:S.alive.slice(),rotation:S.rotation?.slice()||null,rotationOrder:S.rotationOrder||null};
    const q=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(...p.normal).normalize(),new THREE.Vector3(0,-1,0));
    const pivot=new THREE.Vector3(...p.point),v=new THREE.Vector3();
    const topY=state.group.position.y+Math.max(state.height*state.unit,.006)+Math.min(clamp(state.edge*state.unit,0,Math.min(state.lastBounds?.size?.[0]||1,state.lastBounds?.size?.[2]||1)*.18)*.42,Math.max(state.height*state.unit,.006)*.22);
    const deltaY=topY;
    let removed=0;
    for(let i=0;i<S.alive.length;i++)if(S.alive[i]){
      v.set(S.positions[i*3],S.positions[i*3+1],S.positions[i*3+2]);
      const signed=p.normal[0]*(v.x-p.point[0])+p.normal[1]*(v.y-p.point[1])+p.normal[2]*(v.z-p.point[2]);
      if(signed < -preview.margin){S.alive[i]=0;removed++;continue;}
      v.sub(pivot).applyQuaternion(q);v.y+=deltaY;
      S.positions[i*3]=v.x;S.positions[i*3+1]=v.y;S.positions[i*3+2]=v.z;
      if(S.rotation){const o=i*4,r=new THREE.Quaternion();if(S.rotationOrder==='xyzw'||(!S.rotationOrder&&S.fileType!=='ply'))r.set(S.rotation[o],S.rotation[o+1],S.rotation[o+2],S.rotation[o+3]);else r.set(S.rotation[o+1],S.rotation[o+2],S.rotation[o+3],S.rotation[o]);r.premultiply(q).normalize();if(S.rotationOrder==='xyzw'||(!S.rotationOrder&&S.fileType!=='ply')){S.rotation[o]=r.x;S.rotation[o+1]=r.y;S.rotation[o+2]=r.z;S.rotation[o+3]=r.w;}else{S.rotation[o]=r.w;S.rotation[o+1]=r.x;S.rotation[o+2]=r.y;S.rotation[o+3]=r.z;}}
    }
    if(S.alive.reduce((n,v)=>n+(v?1:0),0)<Math.max(30,live*.5)){const b=state.supportBackup;S.positions.set(b.positions);S.alive.set(b.alive);if(S.rotation&&b.rotation)S.rotation.set(b.rotation);state.supportBackup=null;alert('Correction cancelled: too many points would be removed. Original scan restored.');return;}
    state.suspendAutoFit=true;window.FumocaSparkGaussian?.syncEditorState?.(S);window.FumocaGaussianRenderer?.invalidateSort?.();window.rebuildGeometry?.();state.suspendAutoFit=false;
    state.supportPlanePreview=null;$('fpApplyCorrection').disabled=true;$('fpRestoreCorrection').disabled=false;
    $('fpSupportReport').textContent='Correction applied: '+removed.toLocaleString()+' lower/noise points trimmed; support plane levelled and seated. Original arrays are backed up until you restore or save a new source copy.';
  });
  $('fpRestoreCorrection').addEventListener('click',()=>{
    const S=window.S,b=state.supportBackup;if(!S||!b)return;
    if(!confirm('Restore the exact pre-correction positions, rotations and visibility?'))return;
    S.positions.set(b.positions);S.alive.set(b.alive);if(S.rotation&&b.rotation)S.rotation.set(b.rotation);
    state.supportBackup=null;state.suspendAutoFit=true;window.FumocaSparkGaussian?.syncEditorState?.(S);window.FumocaGaussianRenderer?.invalidateSort?.();window.rebuildGeometry?.();state.suspendAutoFit=false;
    $('fpRestoreCorrection').disabled=true;$('fpSupportReport').textContent='Original scan restored exactly.';
  });
  $('fpSave').addEventListener('click',save);
  $('fpEnabled').checked=state.enabled;
  for(const [id,key] of [['fpWidth','width'],['fpHeight','height'],['fpEdge','edge'],['fpOffset','offsetY'],['fpLogoSize','logoSize'],['fpLogoRot','logoRotation'],['fpLogoOff','logoOffset']]){$(id).value=state[key];$(id).dispatchEvent(new Event('input',{bubbles:true}));}
  $('fpLed').checked=state.led;
  root.querySelectorAll('[data-shape]').forEach(b=>b.classList.toggle('active',b.dataset.shape===state.shape));
  root.querySelectorAll('[data-material]').forEach(b=>b.classList.toggle('active',b.dataset.material===state.material));
}
function boot(){
  if(!window.THREE||!window.scene||!window.S){setTimeout(boot,100);return;}
  addStyles();restore();renderUI();build();
  window.addEventListener('fumoca:rebuildGeometry',()=>{if(state.group&&!state.suspendAutoFit)build();});
  window.addEventListener('fumoca:fileLoaded',()=>{if(state.enabled)build();});
  window.addEventListener('fumoca:splat-loaded',()=>{if(state.enabled)build();});
  console.info('[FUMOCA Platform] ready');
}
window.FumocaPresentationPlatform={getConfig,build,save,analyseSelectedSupport(){const S=window.S,indices=[];if(S?.selected)for(let i=0;i<S.selected.length;i++)if(S.selected[i]&&S.alive?.[i])indices.push(i);const interior=[0,0,0];let interiorCount=0;if(S?.alive)for(let i=0;i<S.alive.length;i++)if(S.alive[i]){interior[0]+=S.positions[i*3];interior[1]+=S.positions[i*3+1];interior[2]+=S.positions[i*3+2];interiorCount++;}if(interiorCount)for(let a=0;a<3;a++)interior[a]/=interiorCount;const plane=fitSelectedSupportPlane(S?.positions,indices,{orientationPoint:interior});const preview=plane?previewSupportPlaneTrim(S.positions,S.alive,plane):null;return plane?{plane,preview}:null;},beginSplatTransform,updateSplatTransform,endSplatTransform,enable(v=true){state.enabled=!!v;if(state.group)state.group.visible=state.enabled;},get object(){return state.group;}};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else window.addEventListener('load',boot,{once:true});
