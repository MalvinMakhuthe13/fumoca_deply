/**
 * Web Worker: Gaussian splat → textured solid mesh (.glb), off the UI thread.
 * message in:  { gaussians: {count, positions, colors, opacities, scales, rotations}, options }
 * messages out: { type:'progress', fraction, message } … { type:'done', glb, mesh, stats } | { type:'error', message }
 */
import { gaussiansToSolidMesh } from './solid-mesh.js';
import { encodePng, writeGlb } from './glb-writer.js';

self.onmessage = async (event) => {
  const { gaussians, options } = event.data || {};
  try {
    const mesh = await gaussiansToSolidMesh(gaussians, options, (fraction, message) => self.postMessage({ type: 'progress', fraction, message }));
    self.postMessage({ type: 'progress', fraction: 0.97, message: 'Packing .glb' });
    const png = await encodePng(mesh.atlas.rgba, mesh.atlas.width, mesh.atlas.height);
    const glb = writeGlb({ positions: mesh.positions, normals: mesh.normals, uvs: mesh.uvs, indices: mesh.indices, png });
    self.postMessage({ type: 'done', glb, png, mesh: { positions: mesh.positions, normals: mesh.normals, uvs: mesh.uvs, indices: mesh.indices, atlas: mesh.atlas }, stats: mesh.stats },
      [glb.buffer, png.buffer, mesh.positions.buffer, mesh.normals.buffer, mesh.uvs.buffer, mesh.indices.buffer, mesh.atlas.rgba.buffer]);
  } catch (error) {
    self.postMessage({ type: 'error', message: error?.message || String(error) });
  }
};
