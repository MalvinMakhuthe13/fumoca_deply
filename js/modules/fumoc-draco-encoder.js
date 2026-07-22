/**
 * fumoc-draco-encoder.js — Draco WASM mesh encoder for MESH section
 * ══════════════════════════════════════════════════════════════════════════════
 * Wraps Google's draco_encoder.js (WASM) to compress triangle meshes into
 * Draco-encoded MESH section payloads for .fumoc files.
 *
 * The encoder is loaded lazily and cached — the 400kB WASM is only fetched
 * the first time a mesh is encoded. Subsequent calls share the same module.
 *
 * Wire-format of the MESH section payload (same as Python encoder):
 *   [4B LE uint32: meta_json_len]
 *   [meta_json_len bytes: UTF-8 JSON]
 *   [remaining bytes: Draco-encoded triangle mesh]
 *
 * Draco encoding parameters (tuned to match Python encoder):
 *   quantization_bits = 14     (matches DracoPy default in fumoc_encoder.py)
 *   compression_level = 7      (DRACO_COMPRESSION_METHOD_EDGEBREAKER)
 *   positions, normals, colours each get their own quantization attribute
 *
 * Usage:
 *   import { buildMeshSection } from './fumoc-draco-encoder.js';
 *
 *   // mesh: { vertices: Float32Array (N*3), normals: Float32Array (N*3),
 *   //         colors: Float32Array (N*3, 0-1), triangles: Uint32Array (T*3) }
 *   const meshSectionBytes = await buildMeshSection(mesh);
 *   // Pass as the 'meshSection' option to FumocEncoder.encode()
 *
 * Falls back to OBJ+deflate if Draco WASM fails to load or encode.
 * ══════════════════════════════════════════════════════════════════════════════
 */

// Draco encoder WASM — use the same CDN path as the decoder in fumoc-player.js
// but from the encoder distribution (separate bundle from the decoder).
const DRACO_ENCODER_URL =
  'https://www.gstatic.com/draco/versioned/encoders/1.5.7/draco_encoder.js';

let _dracoEncPromise = null;

/**
 * Lazily load and cache the Draco encoder WASM module.
 * @returns {Promise<object>} — the initialised DracoEncoder instance
 */
function _loadDracoEncoder() {
  if (_dracoEncPromise) return _dracoEncPromise;
  _dracoEncPromise = new Promise((resolve, reject) => {
    if (typeof DracoEncoderModule !== 'undefined') {
      // Already in scope (e.g. loaded via <script> tag)
      DracoEncoderModule().then(resolve).catch(reject);
      return;
    }
    const s = document.createElement('script');
    s.src = DRACO_ENCODER_URL;
    s.onload = () => {
      if (typeof DracoEncoderModule === 'undefined') {
        reject(new Error('DracoEncoderModule not defined after script load'));
        return;
      }
      DracoEncoderModule().then(resolve).catch(reject);
    };
    s.onerror = () => reject(new Error('Failed to load Draco encoder WASM: ' + DRACO_ENCODER_URL));
    document.head.appendChild(s);
  });
  return _dracoEncPromise;
}

/**
 * Encode a triangle mesh to a Draco byte buffer.
 *
 * @param {object} mesh
 *   .vertices  Float32Array  — interleaved XYZ, length = V*3
 *   .normals   Float32Array  — interleaved XYZ normals, length = V*3 (optional)
 *   .colors    Float32Array  — interleaved RGB 0-1, length = V*3 (optional)
 *   .triangles Uint32Array   — triangle indices, length = T*3
 * @returns {Promise<Uint8Array>}  — Draco-encoded bytes
 */
async function _dracoEncode(mesh) {
  const draco  = await _loadDracoEncoder();
  const encoder = new draco.Encoder();
  const builder = new draco.MeshBuilder();
  const dracoMesh = new draco.Mesh();

  const V = mesh.vertices.length / 3;
  const T = mesh.triangles.length / 3;

  // ── Position attribute ──────────────────────────────────────────────────────
  {
    const attr = new draco.GeometryAttribute();
    attr.Init(
      draco.GeometryAttribute.POSITION,
      new Float32Array(mesh.vertices),   // will be copied into WASM heap
      3,                                 // components
      draco.DataType.DT_FLOAT32,
      false                              // not normalised
    );
    builder.AddFloatAttributeToMesh(dracoMesh, attr, V, mesh.vertices);
    draco.destroy(attr);
  }

  // ── Normal attribute (optional) ─────────────────────────────────────────────
  if (mesh.normals && mesh.normals.length === mesh.vertices.length) {
    const attr = new draco.GeometryAttribute();
    attr.Init(
      draco.GeometryAttribute.NORMAL,
      new Float32Array(mesh.normals),
      3,
      draco.DataType.DT_FLOAT32,
      false
    );
    builder.AddFloatAttributeToMesh(dracoMesh, attr, V, mesh.normals);
    draco.destroy(attr);
  }

  // ── Color attribute (optional) ──────────────────────────────────────────────
  if (mesh.colors && mesh.colors.length === mesh.vertices.length) {
    // Convert float [0,1] → uint8 [0,255] — Draco colours are uint8
    const colorsU8 = new Uint8Array(mesh.colors.length);
    for (let i = 0; i < mesh.colors.length; i++) {
      colorsU8[i] = Math.round(Math.min(1, Math.max(0, mesh.colors[i])) * 255);
    }
    const attr = new draco.GeometryAttribute();
    attr.Init(
      draco.GeometryAttribute.COLOR,
      colorsU8,
      3,
      draco.DataType.DT_UINT8,
      true  // normalised — Draco maps [0,255] back to [0,1] on decode
    );
    builder.AddUInt8AttributeToMesh(dracoMesh, attr, V, colorsU8);
    draco.destroy(attr);
  }

  // ── Faces ───────────────────────────────────────────────────────────────────
  builder.AddFacesToMesh(dracoMesh, T, new Uint32Array(mesh.triangles));

  // ── Encoder settings (mirroring Python fumoc_encoder.py) ───────────────────
  encoder.SetSpeedOptions(
    10 - 7,   // encode_speed  (0=slowest/best, 10=fastest) → 3
    10 - 7    // decode_speed
  );
  encoder.SetAttributeQuantization(draco.GeometryAttribute.POSITION, 14);
  encoder.SetAttributeQuantization(draco.GeometryAttribute.NORMAL,   10);
  encoder.SetAttributeQuantization(draco.GeometryAttribute.COLOR,     8);
  encoder.SetEncodingMethod(draco.MESH_EDGEBREAKER_ENCODING);

  // ── Encode ──────────────────────────────────────────────────────────────────
  const buf = new draco.DracoInt8Array();
  const encSize = encoder.EncodeMeshToDracoBuffer(dracoMesh, buf);

  if (encSize === 0) {
    draco.destroy(buf);
    draco.destroy(dracoMesh);
    throw new Error('Draco encoder returned 0 bytes');
  }

  // Copy out of WASM heap
  const result = new Uint8Array(encSize);
  for (let i = 0; i < encSize; i++) result[i] = buf.GetValue(i);

  draco.destroy(buf);
  draco.destroy(dracoMesh);

  return result;
}

/**
 * Fallback: encode mesh as OBJ text + deflate (matches Python OBJ fallback).
 * Larger than Draco but always works without WASM.
 */
async function _objDeflateEncode(mesh) {
  const V = mesh.vertices.length / 3;
  const T = mesh.triangles.length / 3;
  const lines = [];

  for (let i = 0; i < V; i++) {
    const b = i * 3;
    lines.push(`v ${mesh.vertices[b].toFixed(5)} ${mesh.vertices[b+1].toFixed(5)} ${mesh.vertices[b+2].toFixed(5)}`);
  }
  if (mesh.normals) {
    for (let i = 0; i < V; i++) {
      const b = i * 3;
      lines.push(`vn ${mesh.normals[b].toFixed(4)} ${mesh.normals[b+1].toFixed(4)} ${mesh.normals[b+2].toFixed(4)}`);
    }
  }
  for (let i = 0; i < T; i++) {
    const b = i * 3;
    const a = mesh.triangles[b]+1, bb = mesh.triangles[b+1]+1, c = mesh.triangles[b+2]+1;
    lines.push(mesh.normals ? `f ${a}//${a} ${bb}//${bb} ${c}//${c}` : `f ${a} ${bb} ${c}`);
  }

  const raw = new TextEncoder().encode(lines.join('\n'));

  // Deflate via CompressionStream
  const cs = new CompressionStream('deflate');
  const writer = cs.writable.getWriter();
  writer.write(raw); writer.close();
  const chunks = [];
  const reader = cs.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

/**
 * Build a complete MESH section payload from a triangle mesh.
 *
 * Wire format (matches _build_mesh_section in fumoc_encoder.py):
 *   [4B LE: meta_json_len][meta_json bytes][encoded_mesh bytes]
 *
 * @param {object} mesh  — { vertices, normals?, colors?, triangles }
 * @returns {Promise<Uint8Array>}  — raw MESH section payload (NOT section-wrapped)
 */
export async function buildMeshSection(mesh) {
  const V = mesh.vertices.length / 3;
  const T = mesh.triangles.length / 3;

  let format = 'draco';
  let payload;

  try {
    console.log(`[fumoc-draco] Encoding ${V} vertices, ${T} triangles with Draco WASM…`);
    const t0 = performance.now();
    payload = await _dracoEncode(mesh);
    console.log(`[fumoc-draco] Draco: ${payload.length.toLocaleString()} bytes in ${(performance.now()-t0).toFixed(0)}ms`);
  } catch (err) {
    console.warn('[fumoc-draco] Draco WASM encode failed, falling back to OBJ+deflate:', err.message);
    format = 'obj_deflate';
    payload = await _objDeflateEncode(mesh);
    console.log(`[fumoc-draco] OBJ deflate: ${payload.length.toLocaleString()} bytes`);
  }

  const meta = {
    format,
    triangles:  T,
    vertices:   V,
    watertight: true,
    scale:      1.0,
    origin:     [0, 0, 0],
  };
  const metaJson = new TextEncoder().encode(JSON.stringify(meta));

  // Pack: [4B metaLen][metaJson][payload]
  const out = new Uint8Array(4 + metaJson.length + payload.length);
  const dv  = new DataView(out.buffer);
  dv.setUint32(0, metaJson.length, true);
  out.set(metaJson, 4);
  out.set(payload, 4 + metaJson.length);
  return out;
}

/**
 * Convenience: is Draco encoding likely to succeed in this browser?
 * Checks for WASM + fetch support only — doesn't actually load the module.
 */
export function isDracoEncoderAvailable() {
  return typeof WebAssembly !== 'undefined' && typeof fetch !== 'undefined';
}

export default { buildMeshSection, isDracoEncoderAvailable };
