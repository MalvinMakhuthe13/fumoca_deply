import { NIFReader } from '../format/NIFSpec.js';
import { NIFRenderer } from '../viewer-src/renderer/NIFRenderer.js';
import { NIFManualGaussianDeformAuthor } from '../animation/NIFManualGaussianDeformAuthor.js';
import { encodeManualAnimationNif, verifyManualAnimationNif } from '../animation/NIFManualAnimationExport.js';

const $=id=>document.getElementById(id);
const canvas=$('scene');let renderer=null,author=null,gaussians=null,sourceBytes=null,selectMode=null,lassoPoints=[];
const projectMatrix=(m,v)=>[m[0]*v[0]+m[4]*v[1]+m[8]*v[2]+m[12],m[1]*v[0]+m[5]*v[1]+m[9]*v[2]+m[13],m[2]*v[0]+m[6]*v[1]+m[10]*v[2]+m[14],m[3]*v[0]+m[7]*v[1]+m[11]*v[2]+m[15]];
function projectedCenters(){const w=canvas.clientWidth,h=canvas.clientHeight,view=renderer.camera.viewMatrix(),proj=renderer.camera.projMatrix(w/h),out=new Float32Array(gaussians.count*2);for(let i=0;i<gaussians.count;i++){const o=i*14,p=[author.rest[o],author.rest[o+1],author.rest[o+2]],v=projectMatrix(view,p),c=projectMatrix(proj,v);if(c[3]<=0){out[i*2]=-1e6;out[i*2+1]=-1e6;continue;}out[i*2]=(c[0]/c[3]*.5+.5)*w;out[i*2+1]=(1-(c[1]/c[3]*.5+.5))*h;}return out;}
const val=id=>Number($(id).value);
function message(s){$('message').textContent=s;}
function bounds(data,count){
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<count;i++)for(let a=0;a<3;a++){const v=data[i*14+a];min[a]=Math.min(min[a],v);max[a]=Math.max(max[a],v);}
  return {min,max,center:min.map((v,i)=>(v+max[i])/2)};
}
function set(id,v){$(id).value=Number(v.toFixed(4));}
function sync(){if(renderer){renderer.gaussians.data=author.data;renderer._sortFrame=-999;}}
function selectionBox(){
  author.selectBox(['minx','miny','minz'].map(val),['maxx','maxy','maxz'].map(val),{falloff:val('falloff')});
  message('Selected '+author.selection.reduce((n,w)=>n+(w>0),0).toLocaleString()+' splats (weighted selection).');
}
$('file').addEventListener('change',async()=>{
  try{
    const file=$('file').files?.[0];if(!file)return;
    message('Reading NIF…');sourceBytes=await file.arrayBuffer();
    const reader=new NIFReader(sourceBytes);
    if(!reader.isVersionSupported||reader.isCorrupted)throw new Error('Invalid or unsupported NIF file');
    gaussians=await reader.getGeometry();if(!gaussians)throw new Error('NIF has no Gaussian geometry');
    renderer?.stop();renderer=new NIFRenderer(canvas);renderer.loadGaussians(gaussians);renderer.setVertical(reader.header.vertical);renderer.start();
    author=new NIFManualGaussianDeformAuthor(gaussians.data);
    const b=bounds(gaussians.data,gaussians.count);
    ['minx','miny','minz'].forEach((id,i)=>set(id,b.min[i]));
    ['maxx','maxy','maxz'].forEach((id,i)=>set(id,b.max[i]));
    ['px','py','pz'].forEach((id,i)=>set(id,b.center[i]));
    $('status').textContent=gaussians.count.toLocaleString()+' splats · manual mode';
    message('Ready. Source loaded locally; no upload or production write.');
  }catch(e){message(e.stack||String(e));}
});
$('all').onclick=()=>{author?.selectIds(author.ids);message('All splats selected.');};
$('clear').onclick=()=>{author?.clearSelection();message('Selection cleared.');};
$('undo').onclick=()=>{if(author?.undo()){sync();message('Undo complete.');}else message('Nothing to undo.');};
$('redo').onclick=()=>{if(author?.redo()){sync();message('Redo complete.');}else message('Nothing to redo.');};
$('box').onclick=()=>{if(author)selectionBox();};
$('brushMode').onclick=()=>{selectMode='brush';lassoPoints=[];message('Viewport brush active: drag on the object to select splats.');};
$('lassoMode').onclick=()=>{selectMode='lasso';lassoPoints=[];message('Viewport lasso active: draw a closed selection polygon on the object.');};
$('stopSelect').onclick=()=>{selectMode=null;lassoPoints=[];message('Viewport selection stopped.');};
canvas.addEventListener('pointerdown',e=>{
  if(!author||!selectMode)return;
  const r=canvas.getBoundingClientRect(),p=[e.clientX-r.left,e.clientY-r.top];
  if(selectMode==='brush'){author.selectScreenBrush(projectedCenters(),p,val('brushRadius'),{falloff:.35,mode:e.shiftKey?'add':e.altKey?'subtract':'replace'});message('Brush selected '+author.selection.filter(w=>w>0).length.toLocaleString()+' splats.');}
  else {lassoPoints=[p];canvas.setPointerCapture(e.pointerId);}
});
canvas.addEventListener('pointermove',e=>{
  if(!author||!(e.buttons&1))return;
  const r=canvas.getBoundingClientRect();
  if(selectMode==='lasso'){const p=[e.clientX-r.left,e.clientY-r.top],last=lassoPoints[lassoPoints.length-1];if(!last||Math.hypot(p[0]-last[0],p[1]-last[1])>=4)lassoPoints.push(p);return;}
  if(selectMode!=='brush')return;
  author.selectScreenBrush(projectedCenters(),[e.clientX-r.left,e.clientY-r.top],val('brushRadius'),{falloff:.35,mode:'add'});
});
canvas.addEventListener('pointerup',e=>{
  if(!author||selectMode!=='lasso'||lassoPoints.length<1)return;
  const r=canvas.getBoundingClientRect();lassoPoints.push([e.clientX-r.left,e.clientY-r.top]);
  if(lassoPoints.length>=3){author.selectLasso(projectedCenters(),lassoPoints,{mode:e.shiftKey?'add':e.altKey?'subtract':'replace'});message('Lasso selected '+author.selection.filter(w=>w>0).length.toLocaleString()+' splats.');}
  lassoPoints=[];
});
function apply(type){
  if(!author)return message('Load a NIF first.');
  author.apply({type,axis:[val('ax'),val('ay'),val('az')],pivot:[val('px'),val('py'),val('pz')],angle:val('angle')*Math.PI/180,scale:[val('sx'),val('sy'),val('sz')]});
  sync();message(type+' applied to selected splats.');
}
$('fold').onclick=()=>apply('fold');$('rotate').onclick=()=>apply('rotate');$('twist').onclick=()=>apply('twist');$('scale').onclick=()=>apply('scale');
$('key').onclick=()=>{if(!author)return;const tracks=author.capture(val('time'));message('Captured '+tracks.length+' Gaussian tracks at '+val('time')+'s.');};
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
window.addEventListener('beforeunload',()=>renderer?.stop());
