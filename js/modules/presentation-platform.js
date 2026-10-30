/* FUMOCA Presentation Platform — non-destructive Three.js display base */
const VERSION = '1.0.0';
const $ = (id) => document.getElementById(id);
const state = {
  enabled: true, shape: 'circle', material: 'wood',
  width: 600, height: 80, edge: 20, offsetY: 0,
  led: true, logoUrl: null, logoSize: 400, logoRotation: 0, logoOffset: -5,
  group: null, top: null, body: null, ring: null, logo: null,
  texture: null, unit: 1, lastBounds: null, dirty: true
};
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
function boundsFromSplat(){
  const S=window.S;if(!S?.positions||!S?.alive)return null;
  const mn=[Infinity,Infinity,Infinity],mx=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<S.alive.length;i++)if(S.alive[i]){
    for(let k=0;k<3;k++){const v=S.positions[i*3+k];if(Number.isFinite(v)){mn[k]=Math.min(mn[k],v);mx[k]=Math.max(mx[k],v);}}
  }
  if(!Number.isFinite(mn[0]))return null;
  return {min:mn,max:mx,size:mx.map((v,i)=>v-mn[i]),center:mn.map((v,i)=>(v+mx[i])*.5)};
}
function makeWoodTexture(){
  const c=document.createElement('canvas');c.width=512;c.height=512;
  const x=c.getContext('2d');x.fillStyle='#70421f';x.fillRect(0,0,512,512);
  for(let i=0;i<220;i++){
    const y=Math.random()*512,amp=2+Math.random()*10;
    x.beginPath();x.moveTo(0,y);
    for(let px=0;px<=512;px+=8)x.lineTo(px,y+Math.sin(px*.018+i)*amp+Math.sin(px*.047+i*2)*2);
    x.strokeStyle=i%5===0?'rgba(35,15,5,.38)':'rgba(220,160,90,.12)';x.lineWidth=.5+Math.random()*3;x.stroke();
  }
  const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.colorSpace=THREE.SRGBColorSpace;return t;
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
  if(kind==='wood')return new THREE.MeshStandardMaterial({map:state.texture,roughness:.62,metalness:.04});
  if(kind==='black')return new THREE.MeshStandardMaterial({color:0x101216,roughness:.28,metalness:.42});
  if(kind==='white')return new THREE.MeshStandardMaterial({color:0xe9edf0,roughness:.32,metalness:.08});
  if(kind==='metal')return new THREE.MeshStandardMaterial({color:0x9ba7b0,roughness:.22,metalness:.88});
  return new THREE.MeshPhysicalMaterial({color:0xb9e6ee,roughness:.08,metalness:.12,transmission:.55,transparent:true,opacity:.72,thickness:.2});
}
function disposeObject(obj){
  if(!obj)return;obj.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material){for(const m of (Array.isArray(o.material)?o.material:[o.material])){if(m.map&&m.map!==state.texture)m.map.dispose();m.dispose();}}});
}
function build(){
  const T=window.THREE;if(!T||!window.scene)return;
  if(!state.texture)state.texture=makeWoodTexture();
  const b=boundsFromSplat();if(!b)return;
  state.lastBounds=b;state.unit=Math.max(...b.size,0.1)/400;
  const width=state.width*state.unit,depth=(state.shape==='circle'||state.shape==='square')?width:width*.72;
  const thick=Math.max(state.height*state.unit,.004),edge=state.edge;
  const g=new T.Group();g.name='FUMOCA Presentation Platform';g.userData.fumocaPresentationPlatform=true;
  const shape=makeShape(width,depth,edge);
  const geo=new T.ExtrudeGeometry(shape,{depth:thick,bevelEnabled:true,bevelSegments:3,steps:1,bevelSize:Math.min(edge*state.unit*.35,thick*.18),bevelThickness:Math.min(edge*state.unit*.35,thick*.18),curveSegments:48});
  geo.rotateX(-Math.PI/2);
  const top=new T.Mesh(geo,materialFor(state.material));top.name='Platform top';top.castShadow=true;top.receiveShadow=true;g.add(top);
  const bodyShape=makeShape(width,depth,edge);
  const bodyGeo=new T.ExtrudeGeometry(bodyShape,{depth:thick*1.5,bevelEnabled:false,curveSegments:48});
  bodyGeo.rotateX(-Math.PI/2);
  const body=new T.Mesh(bodyGeo,new T.MeshStandardMaterial({color:0x111318,metalness:.72,roughness:.28}));
  body.position.y=-thick*1.5;body.name='Pedestal body';g.add(body);
  const ring=new T.Mesh(new T.TorusGeometry(width*.485,Math.max(thick*.035,.003),8,96),new T.MeshBasicMaterial({color:0xffc96b}));
  ring.rotation.x=Math.PI/2;ring.position.y=-thick*.58;ring.name='LED accent ring';ring.visible=state.led;g.add(ring);
  if(state.logoUrl){
    const img=new Image();img.onload=()=>{
      if(!state.group||state.group!==g)return;
      const c=document.createElement('canvas');c.width=512;c.height=512;const ctx=c.getContext('2d');
      ctx.clearRect(0,0,512,512);ctx.drawImage(img,32,32,448,448);
      const tex=new T.CanvasTexture(c);tex.colorSpace=T.SRGBColorSpace;
      const plane=new T.Mesh(new T.PlaneGeometry(width*(state.logoSize/600),width*(state.logoSize/600)),new T.MeshBasicMaterial({map:tex,transparent:true,side:T.DoubleSide,depthWrite:false}));
      plane.rotation.x=Math.PI/2;plane.rotation.z=state.logoRotation*Math.PI/180;
      plane.position.set(0,-thick*1.7+state.logoOffset*state.unit,0);plane.name='Underside brand logo';g.add(plane);state.logo=plane;
    };img.src=state.logoUrl;
  }
  g.position.set(b.center[0],b.min[1]-thick+state.offsetY*state.unit,b.center[2]);
  g.visible=state.enabled;
  if(state.group){window.scene.remove(state.group);disposeObject(state.group);}
  state.group=g;state.top=top;state.body=g.getObjectByName('Pedestal body');state.ring=ring;window.scene.add(g);
  window.dispatchEvent(new CustomEvent('fumoca:presentation-platform-updated',{detail:{config:getConfig()}}));
}
function getConfig(){return {version:VERSION,enabled:state.enabled,shape:state.shape,material:state.material,width:state.width,height:state.height,edge:state.edge,offsetY:state.offsetY,led:state.led,logoSize:state.logoSize,logoRotation:state.logoRotation,logoOffset:state.logoOffset};}
function save(){
  try{localStorage.setItem('fumoca-platform:'+((window.S?.fileName)||'untitled'),JSON.stringify(getConfig()));}catch(e){}
  window.dispatchEvent(new CustomEvent('fumoca:presentation-platform-save',{detail:{config:getConfig()}}));
}
function restore(){
  try{const raw=localStorage.getItem('fumoca-platform:'+((window.S?.fileName)||'untitled'));if(raw){const c=JSON.parse(raw);Object.assign(state,c);}}catch(e){}
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
    <div class="fp-row"><span>Width</span><input id="fpWidth" type="range" min="150" max="1200" value="600"><output id="fpWidthOut">600 mm</output></div>
    <div class="fp-row"><span>Height</span><input id="fpHeight" type="range" min="20" max="240" value="80"><output id="fpHeightOut">80 mm</output></div>
    <div class="fp-row"><span>Edge radius</span><input id="fpEdge" type="range" min="0" max="80" value="20"><output id="fpEdgeOut">20 mm</output></div>
    <div class="fp-row"><span>Position Y</span><input id="fpOffset" type="range" min="-300" max="100" value="0"><output id="fpOffsetOut">0 mm</output></div>
  </div>
  <div class="fp-section"><div class="fp-title">Material</div><div class="fp-swatches">
    <button class="fp-swatch active" data-material="wood" title="Wood" style="background:repeating-linear-gradient(12deg,#5b2e14,#bd8750 5px,#3b1b0c 9px)"></button>
    <button class="fp-swatch" data-material="black" title="Black" style="background:#101216"></button>
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
  <div class="fp-section"><div class="fp-title">Scene integration</div>
    <div class="fp-note">The platform is a separate Three.js object. Your original Gaussian scan remains untouched.</div>
    <button id="fpApply" class="fp-primary">Apply to scene</button>
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
  $('fpLogo').addEventListener('change',e=>{const file=e.target.files?.[0];if(!file)return;if(state.logoUrl)URL.revokeObjectURL(state.logoUrl);state.logoUrl=URL.createObjectURL(file);build();});
  $('fpRemove').addEventListener('click',()=>{if(state.logoUrl)URL.revokeObjectURL(state.logoUrl);state.logoUrl=null;build();});
  $('fpApply').addEventListener('click',()=>{build();save();});
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
  window.addEventListener('fumoca:rebuildGeometry',()=>{if(state.group)build();});
  window.addEventListener('fumoca:splat-loaded',()=>{if(state.enabled)build();});
  console.info('[FUMOCA Platform] ready');
}
window.FumocaPresentationPlatform={getConfig,build,save,enable(v=true){state.enabled=!!v;if(state.group)state.group.visible=state.enabled;},get object(){return state.group;}};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else window.addEventListener('load',boot,{once:true});
