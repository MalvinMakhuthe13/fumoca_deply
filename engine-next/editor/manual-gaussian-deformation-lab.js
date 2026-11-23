import { NIFReader } from '../format/NIFSpec.js';
import { NIFRenderer } from '../viewer-src/renderer/NIFRenderer.js';
import { NIFManualGaussianDeformAuthor } from '../animation/NIFManualGaussianDeformAuthor.js';
import { encodeManualAnimationNif, verifyManualAnimationNif } from '../animation/NIFManualAnimationExport.js';

const $=id=>document.getElementById(id);
const canvas=$('scene');let renderer=null,author=null,gaussians=null,sourceBytes=null;
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
