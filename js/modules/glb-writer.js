/**
 * Minimal glTF 2.0 binary (.glb) + PNG writers for FUMOCA's solid meshes.
 * No dependencies; works in browsers, Web Workers and Node 18+.
 */

let _crcTable = null;
function crc32(bytes, start = 0, end = bytes.length) {
  if (!_crcTable) {
    _crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; _crcTable[n] = c >>> 0; }
  }
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = _crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function zlibDeflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** RGBA8 → PNG bytes (filter type 0 per row, zlib via CompressionStream). */
export async function encodePng(rgba, width, height) {
  const raw = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  }
  const idat = await zlibDeflate(raw);
  const chunk = (type, data) => {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const hv = new DataView(ihdr.buffer);
  hv.setUint32(0, width); hv.setUint32(4, height); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))];
  const total = parts.reduce((s, p) => s + p.length, 0);
  const png = new Uint8Array(total);
  let o = 0; for (const p of parts) { png.set(p, o); o += p.length; }
  return png;
}

/**
 * Write a single textured, unlit mesh as .glb (the photoreal look: colours
 * come straight from the splat renders, not from scene lighting).
 */
export function writeGlb({ positions, normals, uvs, indices, png, name = 'FUMOCA solid mesh', unlit = true }) {
  const align4 = (n) => (n + 3) & ~3;
  const blobs = [];
  let offset = 0;
  const view = (bytes, target) => {
    const v = { buffer: 0, byteOffset: offset, byteLength: bytes.byteLength };
    if (target) v.target = target;
    blobs.push({ bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), offset });
    offset = align4(offset + bytes.byteLength);
    return v;
  };
  const bufferViews = [view(positions, 34962), view(normals, 34962), view(uvs, 34962), view(indices, 34963), view(png)];
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], positions[i + k]); max[k] = Math.max(max[k], positions[i + k]); }
  const n = positions.length / 3;
  const gltf = {
    asset: { version: '2.0', generator: 'FUMOCA Solid Mesh' },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name }],
    meshes: [{ name, primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 }] }],
    materials: [{
      name: 'splat-baked', doubleSided: false,
      pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 1 },
      ...(unlit ? { extensions: { KHR_materials_unlit: {} } } : {}),
    }],
    textures: [{ source: 0, sampler: 0 }],
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }],
    images: [{ bufferView: 4, mimeType: 'image/png' }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: n, type: 'VEC3', min, max },
      { bufferView: 1, componentType: 5126, count: n, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: n, type: 'VEC2' },
      { bufferView: 3, componentType: 5125, count: indices.length, type: 'SCALAR' },
    ],
    bufferViews, buffers: [{ byteLength: offset }],
    ...(unlit ? { extensionsUsed: ['KHR_materials_unlit'] } : {}),
  };
  const json = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonLen = align4(json.length), binLen = align4(offset);
  const out = new Uint8Array(12 + 8 + jsonLen + 8 + binLen);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, out.length, true);
  dv.setUint32(12, jsonLen, true); dv.setUint32(16, 0x4e4f534a, true);
  out.set(json, 20); out.fill(0x20, 20 + json.length, 20 + jsonLen);
  const binStart = 20 + jsonLen;
  dv.setUint32(binStart, binLen, true); dv.setUint32(binStart + 4, 0x004e4942, true);
  for (const b of blobs) out.set(b.bytes, binStart + 8 + b.offset);
  return out;
}

/** Parse a .glb back (used by tests and to sanity-check output). */
export function readGlb(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('Not a GLB');
  const jsonLen = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLen)));
  const binStart = 20 + jsonLen + 8;
  return { json, bin: bytes.subarray(binStart, binStart + dv.getUint32(20 + jsonLen, true)) };
}
