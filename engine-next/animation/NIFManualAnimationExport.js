import {
  CHUNK, CODEC, NIFChunk, NIFReader, encodeGaussianAnimationChunk,
} from '../format/NIFSpec.js';

/**
 * Rebuilds a NIF with manually-authored Gaussian tracks.
 * Every original chunk is preserved byte-for-byte at the chunk payload level;
 * only an older GAUSSIAN_ANIMATION chunk is replaced and the header version /
 * duration metadata are updated. The caller's original byte array is untouched.
 */
export async function encodeManualAnimationNif(sourceBytes, tracks, options={}) {
  const reader=new NIFReader(sourceBytes);
  if(!reader.isVersionSupported)throw new Error('Cannot safely edit an unsupported NIF major version');
  if(reader.isCorrupted)throw new Error('Cannot export from a NIF with corrupt chunks');
  const geometry=await reader.getGeometry();
  if(!geometry?.count)throw new Error('NIF has no Gaussian geometry');
  if(!Array.isArray(tracks)||!tracks.length)throw new Error('No manually-authored Gaussian tracks to export');
  const duration=Number.isFinite(options.duration)?options.duration:Math.max(0,...tracks.flatMap(t=>(t.keyframes||[]).map(k=>k.time)));
  if(duration<0)throw new RangeError('Animation duration must be non-negative');
  const gaussianIds=Array.from({length:geometry.count},(_,i)=>i);
  const animationChunk=encodeGaussianAnimationChunk({
    schema:'fumoca.gaussian-animation',version:1,duration,gaussianIds,tracks,
  });
  const header=reader.header;
  header.versionMinor=Math.max(2,header.versionMinor);
  header.duration=duration;
  header.frameCount=Math.max(1,Math.min(65535,Math.round(duration*(header.fps||30))+1));
  const chunks=reader.chunks.filter(c=>c.type!==CHUNK.GAUSSIAN_ANIMATION);
  chunks.push(animationChunk);
  const parts=[header.toUint8Array(),...chunks.map(chunk=>new NIFChunk(chunk.type,chunk.data,chunk.codec).toUint8Array())];
  const total=parts.reduce((n,p)=>n+p.byteLength,0),out=new Uint8Array(total);
  let offset=0;for(const part of parts){out.set(part,offset);offset+=part.byteLength;}
  // Verify the exact output before returning it to the UI for download.
  const check=new NIFReader(out);
  if(check.isCorrupted||!check.hasChunk(CHUNK.GAUSSIAN_ANIMATION))throw new Error('Export verification failed: output NIF is corrupt or missing animation');
  return out;
}

export async function verifyManualAnimationNif(bytes) {
  const reader=new NIFReader(bytes);
  if(!reader.isVersionSupported||reader.isCorrupted)throw new Error('Exported NIF failed structural validation');
  const geometry=await reader.getGeometry();
  const chunk=reader.getChunk(CHUNK.GAUSSIAN_ANIMATION);
  if(!geometry||!chunk)throw new Error('Exported NIF is missing geometry or animation');
  const {decodeGaussianAnimationChunk}=await import('../format/NIFSpec.js');
  const animation=await decodeGaussianAnimationChunk(chunk);
  if(animation.gaussianIds.length!==geometry.count)throw new Error('Animation ID table does not match Gaussian geometry');
  return {geometryCount:geometry.count,trackCount:animation.tracks.length,duration:animation.duration,version:reader.header.versionMajor+'.'+reader.header.versionMinor};
}
