import { NIFReader } from '../format/NIFSpec.js';
import { NIFRenderer } from '../viewer-src/renderer/NIFRenderer.js';
import { NIFManualGaussianDeformAuthor } from '../animation/NIFManualGaussianDeformAuthor.js';

const $=id=>document.getElementById(id);
const canvas=$('scene');let renderer=null,author=null,gaussians=null;
const val=id=>Number($(id).value);
function message(s){$('message').textContent=s;}
function bounds(data,count){
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<count;i++)for(let a=0;a<3;a++){const v=data[i*14+a];min[a]=Math.min(min[a],v);max[a]=Math.max(max[a],v);}
  return {min,max,center:min.map((v,i)=>(v+max[i])/2)};
}
function set(id,v){$(id).value=Number(v.toFixed(4));}
function sync(){
  renderer._sortFrame=-999;
}
function selectionBox(){
  author.selectBox(['minx','miny','minz'].map(val),['maxx','maxy','maxz'].map(val),{falloff:val('falloff')});
  message('Selected '+author.selection.reduce((n,w)=>n+(w>0),0).toLocaleString()+' splats (weighted selection).');
}
$('file').addEventListener('change',async()=>{
  try{
    const file=$('file').files?.[0];if(!file)return;
    message('Reading NIF…');
    const reader=new NIFReader(await file.arrayBuffer());
    if(!reader.isVersionSupported||reader.isCorrupted)throw new Error('Invalid or unsupported NIF file');
    gaussians=await reader.getGeometry();if(!gaussians)throw new Error('NIF has no Gaussian geometry');
    renderer?.stop();renderer=new NIFRenderer(canvas);renderer.loadGaussians(gaussians);renderer.setVertical(reader.header.vertical);renderer.start();
    author=new NIFManualGaussianDeformAuthor(gaussians.data);
    const b=bounds(gaussians.data,gaussians.count);
    ['minx','miny','minz'].forEach((id,i)=>set(id,b.min[i]));
    ['maxx','maxy','maxz'].forEach((id,i)=>set(id,b.max[i]));
    ['px','py','pz'].forEach((id,i)=>set(id,b.center[i]));
    $('status').textContent=gaussians.count.toLocaleString()+' splats · manual mode';
    message('Ready. Select a region, set pivot and axis, then apply a transform.');
  }catch(e){message(e.stack||String(e));}
});
$('all').onclick=()=>{author?.selectIds(author.ids);message('All splats selected.');};
$('clear').onclick=()=>{author?.clearSelection();message('Selection cleared.');};
$('box').onclick=()=>{if(author)selectionBox();};
function apply(type){
  if(!author)return message('Load a NIF first.');
  author.apply({type,axis:[val('ax'),val('ay'),val('az')],pivot:[val('px'),val('py'),val('pz')],angle:val('angle')*Math.PI/180,scale:[val('sx'),val('sy'),val('sz')]});
  sync();message(type+' applied to selected splats.');
}
$('fold').onclick=()=>apply('fold');$('rotate').onclick=()=>apply('rotate');$('twist').onclick=()=>apply('twist');$('scale').onclick=()=>apply('scale');
$('key').onclick=()=>{if(!author)return;const tracks=author.capture(val('time'));message('Captured '+tracks.length+' Gaussian tracks at '+val('time')+'s.');};
$('reset').onclick=()=>{if(!author)return;author.reset();sync();message('Rest pose restored. Keyframes retained.');};
$('export').onclick=()=>{
  if(!author)return;
  const payload={format:'NIF_GAUSSIAN_ANIMATION_TRACKS',version:1,gaussianCount:gaussians.count,tracks:author.exportTracks()};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='fumoca-manual-gaussian-tracks.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);
  message('Exported '+payload.tracks.length+' manually authored Gaussian tracks.');
};
window.addEventListener('beforeunload',()=>renderer?.stop());
