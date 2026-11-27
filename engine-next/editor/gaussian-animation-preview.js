import { NIFReader, CHUNK, decodeGaussianAnimationChunk } from '../format/NIFSpec.js';
import { NIFRenderer } from '../viewer-src/renderer/NIFRenderer.js';
import { NIFViewer } from '../viewer-src/NIFViewer.js';
import { NIFGaussianTimelinePanel } from './NIFGaussianTimelinePanel.js';

const fileInput=document.getElementById('file');
const canvas=document.getElementById('scene');
const status=document.getElementById('status');
const error=document.getElementById('error');
const help=document.getElementById('help');
let renderer=null,panel=null,controller=null;

function cleanup(){
  panel?.destroy();panel=null;
  if(controller)controller.pauseGaussianAnimation();
  renderer?.stop();renderer=null;controller=null;
}
fileInput.addEventListener('change',async()=>{
  cleanup();error.textContent='';
  const file=fileInput.files?.[0];if(!file)return;
  status.textContent='Reading NIF…';
  try{
    const bytes=await file.arrayBuffer();
    const reader=new NIFReader(bytes);
    if(!reader.isVersionSupported)throw new Error('Unsupported NIF major version');
    if(reader.isCorrupted)throw new Error('NIF contains corrupt chunks: '+reader.errors.map(e=>e.message).join('; '));
    const gaussians=await reader.getGeometry();
    if(!gaussians)throw new Error('No KEYFRAME_GEO chunk found');
    const chunk=reader.getChunk(CHUNK.GAUSSIAN_ANIMATION);
    if(!chunk)throw new Error('No GAUSSIAN_ANIMATION chunk. Create a QA copy with scripts/add-gaussian-animation-demo.mjs.');
    const animation=await decodeGaussianAnimationChunk(chunk);
    if(animation.gaussianIds.length!==gaussians.count)throw new Error('Stable Gaussian ID table does not match the geometry count');

    renderer=new NIFRenderer(canvas);
    renderer.loadGaussians(gaussians);
    renderer.bindGaussianAnimation(animation);
    renderer.setVertical(reader.header.vertical);
    renderer.start();

    // Reuse the exact NIFViewer playback methods without making an API request.
    controller=Object.create(NIFViewer.prototype);
    Object.assign(controller,{
      _renderer:renderer,
      _gaussianAnimation:animation,
      _gaussianAnimationFrame:null,
      _gaussianAnimationStart:0,
      _gaussianAnimationFrom:0,
      _gaussianAnimationSpeed:1,
      _gaussianAnimationLoop:false,
      _gaussianAnimationTime:0,
    });
    panel=new NIFGaussianTimelinePanel(document.getElementById('stage'),controller);
    help.style.display='none';
    status.textContent=`${gaussians.count.toLocaleString()} splats · ${animation.tracks.length.toLocaleString()} animated · ${animation.duration}s`;
  }catch(e){
    cleanup();status.textContent='Could not load animation';
    error.textContent=e?.stack||String(e);
  }
});
window.addEventListener('beforeunload',cleanup);
