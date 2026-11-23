import { NIFReader } from '../format/NIFSpec.js';
import { NIFRenderer } from '../viewer-src/renderer/NIFRenderer.js';
import { NIFManualGaussianDeformAuthor } from '../animation/NIFManualGaussianDeformAuthor.js';
import { NIFGaussianAnimator } from '../animation/NIFGaussianAnimator.js';
import { encodeManualAnimationNif, verifyManualAnimationNif } from '../animation/NIFManualAnimationExport.js';

const $=id=>document.getElementById(id);
const canvas=$('scene'),gizmoCanvas=$('gizmo'),gctx=gizmoCanvas.getContext('2d');let gizmoEnabled=true,gizmoOperation='translate',gizmoDrag=null,gizmoWorldSize=1;let renderer=null,author=null,gaussians=null,sourceBytes=null,selectMode=null,lassoPoints=[],previewAnimator=null,previewSet=null,previewRaf=null,previewStart=0,previewDuration=0,projectionCache=null;
const projectMatrix=(m,v)=>[m[0]*v[0]+m[4]*v[1]+m[8]*v[2]+m[12],m[1]*v[0]+m[5]*v[1]+m[9]*v[2]+m[13],m[2]*v[0]+m[6]*v[1]+m[10]*v[2]+m[14],m[3]*v[0]+m[7]*v[1]+m[11]*v[2]+m[15]];
function projectionSnapshot(){const w=canvas.clientWidth,h=canvas.clientHeight,camera=renderer.camera,key=[w,h,...camera.position,...camera.target].join('|');if(projectionCache?.key===key)return projectionCache;const view=camera.viewMatrix(),proj=camera.projMatrix(w/h),xy=new Float32Array(gaussians.count*2),depths=new Float32Array(gaussians.count);for(let i=0;i<gaussians.count;i++){const o=i*14,v=projectMatrix(view,[author.rest[o],author.rest[o+1],author.rest[o+2]]),q=projectMatrix(proj,v);depths[i]=v[2]<0?-v[2]:Infinity;if(q[3]<=0){xy[i*2]=-1e6;xy[i*2+1]=-1e6;continue;}xy[i*2]=(q[0]/q[3]*.5+.5)*w;xy[i*2+1]=(1-(q[1]/q[3]*.5+.5))*h;}projectionCache={key,xy,depths};return projectionCache;}
function projectedDepths(){return projectionSnapshot().depths;}
function brushDepthRange(xy,depths,center,radius){if(!$('frontOnly').checked)return null;let nearest=Infinity;for(let i=0;i<depths.length;i++)if(Math.hypot(xy[i*2]-center[0],xy[i*2+1]-center[1])<=radius)nearest=Math.min(nearest,depths[i]);return Number.isFinite(nearest)?[Math.max(0,nearest-Math.max(.01,nearest*.002)),nearest+Math.max(.03,nearest*.015)]:null;}
function lassoDepthRange(xy,depths,polygon){if(!$('frontOnly').checked)return null;let nearest=Infinity;for(let i=0;i<depths.length;i++){const x=xy[i*2],y=xy[i*2+1];let inside=false;for(let a=0,b=polygon.length-1;a<polygon.length;b=a++){const p=polygon[a],q=polygon[b];if(((p[1]>y)!==(q[1]>y))&&(x<(q[0]-p[0])*(y-p[1])/(q[1]-p[1])+p[0]))inside=!inside;}if(inside)nearest=Math.min(nearest,depths[i]);}return Number.isFinite(nearest)?[Math.max(0,nearest-Math.max(.01,nearest*.002)),nearest+Math.max(.03,nearest*.015)]:null;}
function projectedCenters(){return projectionSnapshot().xy;}
const val=id=>Number($(id).value);
function projectPoint(p){const w=canvas.clientWidth,h=canvas.clientHeight,view=renderer.camera.viewMatrix(),proj=renderer.camera.projMatrix(w/h),v=projectMatrix(view,p),q=projectMatrix(proj,v);if(q[3]<=0)return null;return [(q[0]/q[3]*.5+.5)*w,(1-(q[1]/q[3]*.5+.5))*h,-v[2]];}
function gizmoAxes(){if(!author||!renderer||!gizmoEnabled)return [];const pivot=['px','py','pz'].map(val),size=gizmoWorldSize,origin=projectPoint(pivot);if(!origin)return [];return [[1,0,0],[0,1,0],[0,0,1]].map(axis=>({axis,origin,end:projectPoint([pivot[0]+axis[0]*size,pivot[1]+axis[1]*size,pivot[2]+axis[2]*size]),size})).filter(a=>a.end);}
function drawGizmo(){if(!gctx)return;const w=canvas.clientWidth,h=canvas.clientHeight,dpr=Math.min(devicePixelRatio||1,2);if(gizmoCanvas.width!==Math.round(w*dpr)||gizmoCanvas.height!==Math.round(h*dpr)){gizmoCanvas.width=Math.round(w*dpr);gizmoCanvas.height=Math.round(h*dpr);gizmoCanvas.style.width=w+'px';gizmoCanvas.style.height=h+'px';}gctx.setTransform(dpr,0,0,dpr,0,0);gctx.clearRect(0,0,w,h);if(!gizmoEnabled||!author)return;const axes=gizmoAxes();if(!axes.length)return;const o=axes[0].origin,colors=['#ff5b5b','#62e28b','#65a9ff'];gctx.lineWidth=3;axes.forEach((a,i)=>{gctx.strokeStyle=colors[i];gctx.fillStyle=colors[i];gctx.beginPath();gctx.moveTo(o[0],o[1]);gctx.lineTo(a.end[0],a.end[1]);gctx.stroke();gctx.beginPath();gctx.arc(a.end[0],a.end[1],6,0,Math.PI*2);gctx.fill();gctx.font='bold 12px system-ui';gctx.fillText(['X','Y','Z'][i],a.end[0]+8,a.end[1]-8);});gctx.fillStyle='#fff';gctx.beginPath();gctx.arc(o[0],o[1],4,0,Math.PI*2);gctx.fill();}

function message(s){$('message').textContent=s;}
function bounds(data,count){
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<count;i++)for(let a=0;a<3;a++){const v=data[i*14+a];min[a]=Math.min(min[a],v);max[a]=Math.max(max[a],v);}
  return {min,max,center:min.map((v,i)=>(v+max[i])/2)};
}
function set(id,v){$(id).value=Number(v.toFixed(4));}
function renderSelection(){if(!renderer||!author)return;const preview=author.data.slice();for(let i=0;i<author.count;i++){const w=author.selection[i];if(w<=0)continue;const o=i*14;preview[o+11]=preview[o+11]*(1-w)+2.0*w;preview[o+12]=preview[o+12]*(1-w)+1.5*w;preview[o+13]=preview[o+13]*(1-w)-1.5*w;}renderer.gaussians=gaussians;gaussians.data=preview;renderer._sortFrame=-999;drawGizmo();}
function sync(){stopPreview();if(renderer){gaussians.data=author.data;renderSelection();drawGizmo();}}
function stopPreview(){if(previewRaf!=null)cancelAnimationFrame(previewRaf);previewRaf=null;previewAnimator=null;previewSet=null;if(renderer&&author){renderer.gaussians=gaussians;gaussians.data=author.data;renderer._sortFrame=-999;}}
function evaluatePreview(t){if(!previewAnimator)return;previewAnimator.evaluate(Math.max(0,Math.min(previewDuration,t)));renderer.gaussians=previewSet;renderer._sortFrame=-999;$('timeline').value=String(t);$('timelineTime').textContent=t.toFixed(2)+'s';}
window.addEventListener('load',()=>{if(window.opener)window.opener.postMessage({type:'FUMOCA_MANUAL_GAUSSIAN_READY'},location.origin);},{once:true});
window.addEventListener('message',event=>{
  if(event.origin!==location.origin||event.source!==window.opener||event.data?.type!=='FUMOCA_MANUAL_GAUSSIAN_SOURCE')return;
  try{const transfer=new DataTransfer();transfer.items.add(new File([event.data.buffer],event.data.name||'studio-source.nif',{type:'application/octet-stream'}));$('file').files=transfer.files;$('file').dispatchEvent(new Event('change'));message('Receiving active Studio NIF…');}catch(error){message('Could not receive Studio NIF: '+error.message);}
});
function selectionBox(){
  author.selectBox(['minx','miny','minz'].map(val),['maxx','maxy','maxz'].map(val),{falloff:val('falloff')});
  message('Selected '+author.selection.reduce((n,w)=>n+(w>0),0).toLocaleString()+' splats (weighted selection).');
}
$('file').addEventListener('change',async()=>{
  try{
    const file=$('file').files?.[0];if(!file)return;
    stopPreview();message('Reading NIF…');sourceBytes=await file.arrayBuffer();
    const reader=new NIFReader(sourceBytes);
    if(!reader.isVersionSupported||reader.isCorrupted)throw new Error('Invalid or unsupported NIF file');
    gaussians=await reader.getGeometry();if(!gaussians)throw new Error('NIF has no Gaussian geometry');
    renderer?.stop();renderer=new NIFRenderer(canvas);renderer.loadGaussians(gaussians);renderer.setVertical(reader.header.vertical);renderer.start();
    author=new NIFManualGaussianDeformAuthor(gaussians.data);projectionCache=null;startGizmoAnimation();
    const b=bounds(gaussians.data,gaussians.count);gizmoWorldSize=Math.max(.1,...b.max.map((v,i)=>v-b.min[i]))*.22;
    ['minx','miny','minz'].forEach((id,i)=>set(id,b.min[i]));
    ['maxx','maxy','maxz'].forEach((id,i)=>set(id,b.max[i]));
    ['px','py','pz'].forEach((id,i)=>set(id,b.center[i]));
    $('status').textContent=gaussians.count.toLocaleString()+' splats · manual mode';
    drawGizmo();message('Ready. Source loaded locally; no upload or production write.');
  }catch(e){message(e.stack||String(e));}
});
$('all').onclick=()=>{author?.selectIds(author.ids);renderSelection();message('All splats selected.');};
$('clear').onclick=()=>{author?.clearSelection();renderSelection();message('Selection cleared.');};
$('invert').onclick=()=>{author?.invertSelection();renderSelection();message('Selection inverted.');};
$('saveSelection').onclick=()=>{try{author?.saveSelection($('selectionName').value);message('Selection set saved in this session.');}catch(e){message(e.message);}};
$('loadSelection').onclick=()=>{if(author?.loadSelection($('selectionName').value)){renderSelection();message('Selection set loaded.');}else message('No selection set with that name.');};
$('undo').onclick=()=>{if(author?.undo()){sync();message('Undo complete.');}else message('Nothing to undo.');};
$('redo').onclick=()=>{if(author?.redo()){sync();message('Redo complete.');}else message('Nothing to redo.');};
$('box').onclick=()=>{if(author){selectionBox();renderSelection();}};
$('grow').onclick=()=>{if(!author)return;author.growSelection(val('growRadius'),{iterations:1,falloff:.5});renderSelection();message('Expanded connected selection to '+author.selection.filter(w=>w>0).length.toLocaleString()+' splats.');};
$('brushMode').onclick=()=>{selectMode='brush';lassoPoints=[];message('Viewport brush active: drag on the object to select splats.');};
$('lassoMode').onclick=()=>{selectMode='lasso';lassoPoints=[];message('Viewport lasso active: draw a closed selection polygon on the object.');};
$('stopSelect').onclick=()=>{selectMode=null;lassoPoints=[];message('Viewport selection stopped.');};
canvas.addEventListener('pointerdown',e=>{
  if(author&&gizmoEnabled&&!selectMode){const r=canvas.getBoundingClientRect(),p=[e.clientX-r.left,e.clientY-r.top],axes=gizmoAxes();let best=null,bestD=14;for(const a of axes){const dx=a.end[0]-a.origin[0],dy=a.end[1]-a.origin[1],len2=dx*dx+dy*dy;if(len2<1)continue;const t=Math.max(0,Math.min(1,((p[0]-a.origin[0])*dx+(p[1]-a.origin[1])*dy)/len2)),d=Math.hypot(p[0]-(a.origin[0]+t*dx),p[1]-(a.origin[1]+t*dy));if(d<bestD){bestD=d;best={...a,screen:[dx,dy],pixelsPerUnit:Math.sqrt(len2)/a.size,start:p,operation:gizmoOperation};}}if(best){author.checkpoint('gizmo-translate');gizmoDrag=best;canvas.setPointerCapture(e.pointerId);e.preventDefault();return;}}
  if(!author||!selectMode)return;
  const r=canvas.getBoundingClientRect(),p=[e.clientX-r.left,e.clientY-r.top];
  if(selectMode==='brush'){{const xy=projectedCenters(),depths=projectedDepths();author.selectScreenBrush(xy,p,val('brushRadius'),{falloff:.35,mode:e.shiftKey?'add':e.altKey?'subtract':'replace',depths,depthRange:brushDepthRange(xy,depths,p,val('brushRadius'))});}renderSelection();message('Brush selected '+author.selection.filter(w=>w>0).length.toLocaleString()+' splats.');}
  else {lassoPoints=[p];canvas.setPointerCapture(e.pointerId);}
});
canvas.addEventListener('pointermove',e=>{
  if(gizmoDrag&&author&&(e.buttons&1)){const r=canvas.getBoundingClientRect(),p=[e.clientX-r.left,e.clientY-r.top],dx=gizmoDrag.screen[0],dy=gizmoDrag.screen[1],len=Math.hypot(dx,dy),unit=[dx/len,dy/len],pixels=(p[0]-gizmoDrag.start[0])*unit[0]+(p[1]-gizmoDrag.start[1])*unit[1],amount=pixels/gizmoDrag.pixelsPerUnit;if(gizmoDrag.operation==='translate'){author.apply({type:'translate',direction:gizmoDrag.axis,amount,pivot:['px','py','pz'].map(val),history:false});$('amount').value=amount.toFixed(4);}else if(gizmoDrag.operation==='rotate'){const angle=amount/Math.max(.001,gizmoDrag.size);author.apply({type:'rotate',axis:gizmoDrag.axis,angle,pivot:['px','py','pz'].map(val),history:false});$('angle').value=(angle*180/Math.PI).toFixed(2);}else{const factor=Math.exp(amount/Math.max(.001,gizmoDrag.size)),scale=[1,1,1];scale[gizmoDrag.axis.findIndex(v=>v===1)]=Math.max(.01,Math.min(100,factor));author.apply({type:'scale',scale,pivot:['px','py','pz'].map(val),history:false});$('sx').value=scale[0].toFixed(3);$('sy').value=scale[1].toFixed(3);$('sz').value=scale[2].toFixed(3);}sync();return;}
  if(!author||!(e.buttons&1))return;
  const r=canvas.getBoundingClientRect();
  if(selectMode==='lasso'){const p=[e.clientX-r.left,e.clientY-r.top],last=lassoPoints[lassoPoints.length-1];if(!last||Math.hypot(p[0]-last[0],p[1]-last[1])>=4)lassoPoints.push(p);return;}
  if(selectMode!=='brush')return;
  {const p=[e.clientX-r.left,e.clientY-r.top],xy=projectedCenters(),depths=projectedDepths();author.selectScreenBrush(xy,p,val('brushRadius'),{falloff:.35,mode:'add',depths,depthRange:brushDepthRange(xy,depths,p,val('brushRadius'))});}renderSelection();
});
canvas.addEventListener('pointercancel',()=>{gizmoDrag=null;lassoPoints=[];});
canvas.addEventListener('pointerup',e=>{
  if(gizmoDrag){gizmoDrag=null;return;}
  if(!author||selectMode!=='lasso'||lassoPoints.length<1)return;
  const r=canvas.getBoundingClientRect();lassoPoints.push([e.clientX-r.left,e.clientY-r.top]);
  if(lassoPoints.length>=3){{const xy=projectedCenters(),depths=projectedDepths();author.selectLasso(xy,lassoPoints,{mode:e.shiftKey?'add':e.altKey?'subtract':'replace',depths,depthRange:lassoDepthRange(xy,depths,lassoPoints)});}renderSelection();message('Lasso selected '+author.selection.filter(w=>w>0).length.toLocaleString()+' splats.');}
  lassoPoints=[];
});
function apply(type){
  if(!author)return message('Load a NIF first.');
  author.apply({type,axis:[val('ax'),val('ay'),val('az')],pivot:[val('px'),val('py'),val('pz')],angle:val('angle')*Math.PI/180,amount:val('amount'),direction:[val('ax'),val('ay'),val('az')],scale:[val('sx'),val('sy'),val('sz')]});
  sync();message(type+' applied to selected splats.');
}
$('gizmoMove').onclick=()=>{gizmoEnabled=true;gizmoOperation='translate';message('Move gizmo active.');drawGizmo();};
$('gizmoRotate').onclick=()=>{gizmoEnabled=true;gizmoOperation='rotate';message('Rotate gizmo active. Drag an axis handle to rotate selected splats.');drawGizmo();};
$('gizmoScale').onclick=()=>{gizmoEnabled=true;gizmoOperation='scale';message('Scale gizmo active. Drag an axis handle to scale selected splats.');drawGizmo();};
$('fold').onclick=()=>apply('fold');$('rotate').onclick=()=>apply('rotate');$('twist').onclick=()=>apply('twist');$('scale').onclick=()=>apply('scale');$('translate').onclick=()=>apply('translate');$('inflate').onclick=()=>apply('inflate');$('deflate').onclick=()=>apply('deflate');

$('timeline').oninput=()=>{if(!author)return;const tracks=author.exportTracks();if(!tracks.length)return message('Capture keyframes first.');if(!previewAnimator){previewSet={count:gaussians.count,data:author.rest.slice()};previewAnimator=new NIFGaussianAnimator(previewSet,tracks,author.ids);previewDuration=Math.max(.001,...tracks.flatMap(t=>t.keyframes.map(k=>k.time)));$('timeline').max=String(previewDuration);}evaluatePreview(val('timeline'));};
$('previewStop').onclick=()=>{stopPreview();$('timeline').value='0';$('timelineTime').textContent='0.00s';message('Animation preview stopped.');};
$('previewPlay').onclick=()=>{
  if(!author)return message('Load a NIF first.');
  const tracks=author.exportTracks();if(!tracks.length)return message('Capture keyframes first.');
  stopPreview();previewSet={count:gaussians.count,data:author.rest.slice()};previewAnimator=new NIFGaussianAnimator(previewSet,tracks,author.ids);
  previewDuration=Math.max(.001,...tracks.flatMap(t=>t.keyframes.map(k=>k.time)));$('timeline').max=String(previewDuration);
  previewStart=performance.now()-val('timeline')*1000;
  const tick=now=>{const t=((now-previewStart)/1000)%previewDuration;evaluatePreview(t);previewRaf=requestAnimationFrame(tick);};previewRaf=requestAnimationFrame(tick);
  message('Playing manually-authored Gaussian animation preview.');
};

$('addLayer').onclick=()=>{if(!author)return;try{author.createLayer($('layerName').value);message('Created and activated layer '+author.activeLayer+'.');}catch(e){message(e.message);}};
$('toggleLayer').onclick=()=>{if(!author)return;author.setLayerEnabled(author.activeLayer,!author.layers.get(author.activeLayer));message('Layer '+author.activeLayer+' '+(author.layers.get(author.activeLayer)?'enabled':'muted')+'.');};
$('deleteKey').onclick=()=>{if(!author)return;message('Deleted '+author.deleteKeyframe(val('time'))+' keyframes at '+val('time')+'s.');};
$('moveKey').onclick=()=>{if(!author)return;message('Moved '+author.moveKeyframe(val('moveFrom'),val('time'))+' keyframes to '+val('time')+'s.');};
$('key').onclick=()=>{if(!author)return;const tracks=author.capture(val('time'),{easing:$('easing').value});message('Captured '+tracks.length+' Gaussian tracks at '+val('time')+'s.');};
$('reset').onclick=()=>{if(!author)return;author.reset();sync();message('Rest pose restored. Keyframes retained.');};
function download(bytes,name,type){
  const blob=new Blob([bytes],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
$('export').onclick=()=>{
  if(!author)return;
  const payload={format:'NIF_GAUSSIAN_ANIMATION_TRACKS',version:1,duration:Math.max(0,...author.exportTracks().flatMap(t=>t.keyframes.map(k=>k.time))),gaussianCount:gaussians.count,tracks:author.exportTracks()};
  download(JSON.stringify(payload,null,2),'fumoca-manual-gaussian-tracks.json','application/json');
  message('Exported '+payload.tracks.length+' manually-authored Gaussian tracks.');
};
$('exportNif').onclick=async()=>{
  try{
    if(!author||!sourceBytes)return message('Load a source NIF first.');
    const tracks=author.exportTracks();if(!tracks.length)return message('Capture at least one keyframe before exporting.');
    message('Packaging animation and verifying NIF…');
    const duration=Math.max(0,...tracks.flatMap(t=>t.keyframes.map(k=>k.time)));
    const bytes=await encodeManualAnimationNif(sourceBytes,tracks,{duration});
    const report=await verifyManualAnimationNif(bytes);
    download(bytes,'fumoca-manual-animated.nif','application/octet-stream');
    message('Verified NIF '+report.version+' · '+report.geometryCount.toLocaleString()+' splats · '+report.trackCount.toLocaleString()+' tracks · '+report.duration+'s. Original untouched.');
  }catch(e){message('Export failed: '+(e.stack||String(e)));}
};
let gizmoRaf=0;function animateGizmo(){if(!author){gizmoRaf=0;return;}drawGizmo();gizmoRaf=requestAnimationFrame(animateGizmo);}function startGizmoAnimation(){if(!gizmoRaf)gizmoRaf=requestAnimationFrame(animateGizmo);}
window.addEventListener('resize',drawGizmo);
window.addEventListener('beforeunload',()=>{stopPreview();renderer?.stop();});
