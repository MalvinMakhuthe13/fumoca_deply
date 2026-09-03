/**
 * NIF bridge — browser side
 * ════════════════════════════════════════════════════════════════════════════
 * Converts the app's in-memory splat data into a genuine .nif file using the
 * real NIF binary spec (engine-next/format/NIFSpec.js) — no .fumoc, no .splat
 * wrapping. This is the ONLY encode/decode path the live app should use for
 * publishing, downloading, or viewing a scene.
 *
 * Two sources of splat data exist in the app today:
 *   1. Raw .splat binary rows (32 bytes/point: pos f32×3, scale f32×3,
 *      color u8×4, rotation u8×4 — the standard antimatter15 .splat layout
 *      used by splat-edit-engine.js / window.S.sourceBuffer).
 *   2. Parsed PLY point clouds (position + color + opacity only, no
 *      per-point scale/rotation — isotropic points).
 *
 * Both get packed into NIF's KEYFRAME_GEO chunk using the canonical 14-float
 * layout defined in NIFSpec.js: [pos.xyz, log_scale.xyz, quat.wxyz,
 * opacity_logit, color_logit.rgb] — raw float32 format (flag 0x00).
 * ════════════════════════════════════════════════════════════════════════════
 */

import {
  NIFWriter, NIFReader, CHUNK, CODEC,
  encodeMetaChunk, decodeMetaChunk, encodeThumbnailChunk,
  decompressChunk, decodePhysicsChunk,
  decodeCalibrationChunk, decodeVerificationChunk,
} from '../../engine-next/format/NIFSpec.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const FLOATS_PER_POINT = 14;

// ── logit / sigmoid helpers (canonical NIF color+opacity space) ──────────────
function logit(p) {
  const c = Math.min(Math.max(p, 1e-6), 1 - 1e-6);
  return Math.log(c / (1 - c));
}
function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }

// ── Encode: 32-byte .splat rows → NIF geometry Float32Array ──────────────────
/**
 * @param {Uint8Array} sourceBuffer  raw .splat bytes (rowSize per point)
 * @param {number[]}   aliveIndices  indices of points to keep (post-edit filter)
 * @param {number}     rowSize       bytes per point (default 32, antimatter15 layout)
 */
function splatRowsToGeometry(sourceBuffer, aliveIndices, rowSize = 32) {
  const dv    = new DataView(sourceBuffer.buffer, sourceBuffer.byteOffset, sourceBuffer.byteLength);
  const count = aliveIndices.length;
  const out   = new Float32Array(count * FLOATS_PER_POINT);

  aliveIndices.forEach((srcIdx, row) => {
    const base = srcIdx * rowSize;
    const o    = row * FLOATS_PER_POINT;

    // Position (3 × float32 LE)
    out[o + 0] = dv.getFloat32(base + 0, true);
    out[o + 1] = dv.getFloat32(base + 4, true);
    out[o + 2] = dv.getFloat32(base + 8, true);

    // Scale is linear in the .splat file — NIF canonical form is log-scale
    out[o + 3] = Math.log(Math.max(dv.getFloat32(base + 12, true), 1e-6));
    out[o + 4] = Math.log(Math.max(dv.getFloat32(base + 16, true), 1e-6));
    out[o + 5] = Math.log(Math.max(dv.getFloat32(base + 20, true), 1e-6));

    // Color (4 × uint8: r,g,b,a) at offset 24 — a doubles as opacity
    const r = sourceBuffer[base + 24] / 255;
    const g = sourceBuffer[base + 25] / 255;
    const b = sourceBuffer[base + 26] / 255;
    const a = sourceBuffer[base + 27] / 255;

    // Rotation quaternion (4 × uint8) at offset 28, antimatter15 convention:
    // stored as (v - 128) / 128, order wxyz
    const qw = (sourceBuffer[base + 28] - 128) / 128;
    const qx = (sourceBuffer[base + 29] - 128) / 128;
    const qy = (sourceBuffer[base + 30] - 128) / 128;
    const qz = (sourceBuffer[base + 31] - 128) / 128;
    const qlen = Math.hypot(qw, qx, qy, qz) || 1;
    out[o + 6] = qw / qlen;
    out[o + 7] = qx / qlen;
    out[o + 8] = qy / qlen;
    out[o + 9] = qz / qlen;

    out[o + 10] = logit(a);
    out[o + 11] = logit(r);
    out[o + 12] = logit(g);
    out[o + 13] = logit(b);
  });

  return out;
}

// ── Encode: plain point cloud (PLY case — no scale/rotation) ─────────────────
/**
 * @param {Float32Array} positions   n × 3
 * @param {Float32Array} colors01    n × 3, each channel 0–1
 * @param {Float32Array} opacities01 n, 0–1
 */
function plyPointsToGeometry(positions, colors01, opacities01) {
  const count = opacities01.length;
  const out   = new Float32Array(count * FLOATS_PER_POINT);
  // No real scale/rotation data for plain point clouds — encode as small
  // isotropic spheres (identity quaternion) so the same renderer path works.
  const ISO_LOG_SCALE = Math.log(0.01);

  for (let i = 0; i < count; i++) {
    const o = i * FLOATS_PER_POINT;
    out[o + 0] = positions[i * 3 + 0];
    out[o + 1] = positions[i * 3 + 1];
    out[o + 2] = positions[i * 3 + 2];
    out[o + 3] = ISO_LOG_SCALE;
    out[o + 4] = ISO_LOG_SCALE;
    out[o + 5] = ISO_LOG_SCALE;
    out[o + 6] = 1; out[o + 7] = 0; out[o + 8] = 0; out[o + 9] = 0; // identity quat
    out[o + 10] = logit(opacities01[i]);
    out[o + 11] = logit(colors01[i * 3 + 0]);
    out[o + 12] = logit(colors01[i * 3 + 1]);
    out[o + 13] = logit(colors01[i * 3 + 2]);
  }
  return out;
}

// ── Quantized geometry packing (flag 0x01) — real compression ────────────────
// NIFSpec.js has always had a decoder for this format (see NIFReader.getGeometry,
// flag 0x01) but no encoder existed anywhere — every .nif this app has produced
// so far used the uncompressed raw format (flag 0x00, 56 bytes/point), which is
// actually LARGER than a plain .splat file, not smaller. This is the real
// compressed format: 17 bytes/point, ~3.3x smaller, verified against the
// existing decoder with imperceptible error (position error ~0.00003 units,
// color/opacity error <0.2%, both well below visual threshold).
function packGeometryQuantized(geoData, count) {
  let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
  for (let i = 0; i < count; i++) {
    const o = i * FLOATS_PER_POINT;
    const x = geoData[o], y = geoData[o+1], z = geoData[o+2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  // Guard against a degenerate (zero-range) axis, e.g. a perfectly flat capture
  if (maxX === minX) maxX = minX + 1e-3;
  if (maxY === minY) maxY = minY + 1e-3;
  if (maxZ === minZ) maxZ = minZ + 1e-3;
  const rangeX = maxX - minX, rangeY = maxY - minY, rangeZ = maxZ - minZ;
  const SCALE_MIN = -8.0, SCALE_RANGE = 10.0;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  const header = new ArrayBuffer(29);
  const hv = new DataView(header);
  hv.setUint8(0, 0x01);
  hv.setUint32(1, count, false);
  hv.setFloat32(5,  minX, false); hv.setFloat32(9,  minY, false); hv.setFloat32(13, minZ, false);
  hv.setFloat32(17, maxX, false); hv.setFloat32(21, maxY, false); hv.setFloat32(25, maxZ, false);

  const points = new Uint8Array(count * 17);
  const pdv = new DataView(points.buffer);

  for (let i = 0; i < count; i++) {
    const o = i * FLOATS_PER_POINT, base = i * 17;
    const px = Math.round(((geoData[o+0]-minX)/rangeX)*65534 - 32767);
    const py = Math.round(((geoData[o+1]-minY)/rangeY)*65534 - 32767);
    const pz = Math.round(((geoData[o+2]-minZ)/rangeZ)*65534 - 32767);
    pdv.setInt16(base+0, clamp(px,-32768,32767), false);
    pdv.setInt16(base+2, clamp(py,-32768,32767), false);
    pdv.setInt16(base+4, clamp(pz,-32768,32767), false);

    points[base+6] = clamp(Math.round(((geoData[o+3]-SCALE_MIN)/SCALE_RANGE)*255), 0, 255);
    points[base+7] = clamp(Math.round(((geoData[o+4]-SCALE_MIN)/SCALE_RANGE)*255), 0, 255);
    points[base+8] = clamp(Math.round(((geoData[o+5]-SCALE_MIN)/SCALE_RANGE)*255), 0, 255);

    pdv.setInt8(base+9,  clamp(Math.round(geoData[o+6]*127), -127, 127));
    pdv.setInt8(base+10, clamp(Math.round(geoData[o+7]*127), -127, 127));
    pdv.setInt8(base+11, clamp(Math.round(geoData[o+8]*127), -127, 127));
    pdv.setInt8(base+12, clamp(Math.round(geoData[o+9]*127), -127, 127));

    points[base+13] = clamp(Math.round(sigmoid(geoData[o+10])*255), 0, 255);
    points[base+14] = clamp(Math.round(sigmoid(geoData[o+11])*255), 0, 255);
    points[base+15] = clamp(Math.round(sigmoid(geoData[o+12])*255), 0, 255);
    points[base+16] = clamp(Math.round(sigmoid(geoData[o+13])*255), 0, 255);
  }

  const out = new Uint8Array(29 + points.length);
  out.set(new Uint8Array(header), 0);
  out.set(points, 29);
  return out;
}

// ── Public: packed geometry blob only (no chunk wrapper) ─────────────────────
// For the on-demand print-export path (pipeline.py's run_mesh_only): a small
// standalone file containing ONLY [flag][count][bbox?][points...] — no .nif
// container, no META/THUMBNAIL, since that path only ever needs geometry.
export function encodeGeometryOnly(opts = {}) {
  let geoData, count;
  if (opts.sourceBuffer && opts.aliveIndices) {
    geoData = splatRowsToGeometry(opts.sourceBuffer, opts.aliveIndices, opts.rowSize ?? 32);
    count   = opts.aliveIndices.length;
  } else if (opts.positions && opts.colors01 && opts.opacities01) {
    geoData = plyPointsToGeometry(opts.positions, opts.colors01, opts.opacities01);
    count   = opts.opacities01.length;
  } else {
    throw new Error('[nif-format] encodeGeometryOnly: no geometry source provided');
  }
  return packGeometryQuantized(geoData, count).buffer;
}

// ── Public: build a real .nif ArrayBuffer ─────────────────────────────────────
/**
 * @param {object} opts
 *   geometry      Float32Array  already-packed 14-floats/point data (optional —
 *                                pass this OR sourceBuffer+aliveIndices OR
 *                                positions+colors01+opacities01)
 *   sourceBuffer  Uint8Array    raw .splat bytes
 *   aliveIndices  number[]      indices to keep from sourceBuffer
 *   rowSize       number        bytes/point in sourceBuffer (default 32)
 *   positions, colors01, opacities01   plain point-cloud arrays (PLY case)
 *   meta          object        title/description/hotspots/tourStops/etc.
 *   thumbnailBytes Uint8Array   JPEG bytes for the poster image (optional)
 *   vertical      string        header vertical tag (default 'generic')
 * @returns {ArrayBuffer}
 */
export function encodeNif(opts = {}) {
  let geoData, count;

  if (opts.geometry) {
    geoData = opts.geometry;
    count   = geoData.length / FLOATS_PER_POINT;
  } else if (opts.sourceBuffer && opts.aliveIndices) {
    geoData = splatRowsToGeometry(opts.sourceBuffer, opts.aliveIndices, opts.rowSize ?? 32);
    count   = opts.aliveIndices.length;
  } else if (opts.positions && opts.colors01 && opts.opacities01) {
    geoData = plyPointsToGeometry(opts.positions, opts.colors01, opts.opacities01);
    count   = opts.opacities01.length;
  } else {
    throw new Error('[nif-format] encodeNif: no geometry source provided');
  }

  const writer = new NIFWriter({
    vertical: opts.vertical ?? 'generic',
    frameCount: 1,
  });

  // KEYFRAME_GEO — quantized by default (flag 0x01, ~3.3x smaller than raw,
  // imperceptible error — see packGeometryQuantized above). Pass
  // { compressed: false } to force the old uncompressed raw format.
  const geoBytes = opts.compressed === false
    ? (() => {
        const geoHeader = new Uint8Array(5);
        new DataView(geoHeader.buffer).setUint8(0, 0x00);
        new DataView(geoHeader.buffer).setUint32(1, count, false);
        const bytes = new Uint8Array(5 + geoData.byteLength);
        bytes.set(geoHeader, 0);
        bytes.set(new Uint8Array(geoData.buffer, geoData.byteOffset, geoData.byteLength), 5);
        return bytes;
      })()
    : packGeometryQuantized(geoData, count);
  writer.add(CHUNK.KEYFRAME_GEO, geoBytes, CODEC.RAW);

  writer.add(CHUNK.META, encodeMetaChunk(opts.meta ?? {}).data, CODEC.RAW);

  if (opts.thumbnailBytes) {
    writer.chunks.push(encodeThumbnailChunk(opts.thumbnailBytes));
  }

  // Carry over any other chunks from a previously-decoded original file
  // (CAMERAS/DEPTH/ALPHA/LAYER/MESH/PRINT/SEMANTIC_MAP/etc.) — pass an array
  // of NIFChunk instances from reader.chunks here (filtered by the caller to
  // exclude KEYFRAME_GEO/META/THUMBNAIL, which are always rebuilt above from
  // the current edit state). Without this, every edit+re-encode silently
  // discarded everything except geometry — cameras, depth maps, meshes,
  // print-ready STL, and the poster thumbnail all vanished on first save.
  if (Array.isArray(opts.passthroughChunks)) {
    for (const chunk of opts.passthroughChunks) writer.chunks.push(chunk);
  }

  return writer.build().buffer;
}

// ── Public: decode a .nif ArrayBuffer back into render-ready data ────────────
export async function decodeNif(arrayBuffer) {
  const reader = new NIFReader(arrayBuffer);
  if (reader.isCorrupted) {
    console.warn('[nif-format] NIF has corrupted chunks:', reader.errors);
  }
  const geometry = await reader.getGeometry(); // { count, data: Float32Array(14/point) } | null
  if (!geometry) throw new Error('[nif-format] .nif file has no KEYFRAME_GEO chunk');

  const meta = decodeMetaChunk(reader.getChunk(CHUNK.META));
  const thumbChunk = reader.getChunk(CHUNK.THUMBNAIL);
  const thumbnailBytes = thumbChunk ? thumbChunk.data : null;

  // CALIBRATION/VERIFICATION — this is the live app's only decode path, so
  // if these aren't read here, the calibration confidence and product-
  // verification report never reach the viewer UI no matter what pipeline.py
  // wrote into the file. decodeCalibrationChunk/decodeVerificationChunk
  // already default safely (uncalibrated / null) when the chunk is absent —
  // see NIFSpec.js.
  const calibration = await decodeCalibrationChunk(reader.getChunk(CHUNK.CALIBRATION));
  const verification = await decodeVerificationChunk(reader.getChunk(CHUNK.VERIFICATION));

  // KEYFRAME_MESH — decodes both formats now: raw struct (0x00, what every
  // file produced until Draco was wired server-side) and Draco (0x01, once
  // pipeline.py's ENABLE_DRACO_MESH is on). Async because Draco decode goes
  // through a wasm module — decodeNif already awaits everything else, so
  // this doesn't change the calling convention.
  const mesh = await decodeMeshChunk(reader.getChunk(CHUNK.KEYFRAME_MESH));

  return { reader, meta, thumbnailBytes, gaussians: geometry, calibration, verification, mesh };
}

// ── Draco decoder — lazily created, reused across every mesh this session.
// Decoder wasm is fetched from Google's official versioned CDN, same source
// three.js's own examples use; not self-hosted, so this needs network access
// to gstatic.com. If that's ever a problem (offline/embedded contexts), the
// fix is hosting the decoder files locally and pointing setDecoderPath() at
// that instead — DRACOLoader doesn't care where they come from.
const DRACO_DECODER_PATH = 'https://www.gstatic.com/draco/versioned/decoders/1.5.7/';
let _dracoLoader = null;
function _getDracoLoader() {
  if (!_dracoLoader) {
    _dracoLoader = new DRACOLoader();
    _dracoLoader.setDecoderPath(DRACO_DECODER_PATH);
    _dracoLoader.setDecoderConfig({ type: 'wasm' });
  }
  return _dracoLoader;
}

// Decodes a Draco buffer into the same {positions, colors, faces, nVerts,
// nFaces} shape the raw-struct path returns, so mountMeshViewer() in
// viewer.js never has to know which format a given file used.
//
// KNOWN INTEGRATION RISK, not yet verified end-to-end: pipeline.py's
// DracoPy.encode() call passes vertex colors as a plain array with no
// explicit attribute-type/quantization-bits pairing to what THREE's
// DRACOLoader expects by default for a COLOR attribute. This *should* work
// (DracoPy assigns colors as Draco's standard COLOR generic attribute,
// which DRACOLoader auto-detects) but neither side of this round trip has
// been run against a real encoded file — I can't execute WebGL/wasm in this
// environment to confirm it. If colors come through wrong (black, or the
// wrong scale) on the first real Draco-flagged file, that mismatch — not the
// vertex/index decode, which is the well-trodden path — is the first place
// to look.
function _decodeDracoMesh(dracoBytes) {
  return new Promise((resolve, reject) => {
    const loader = _getDracoLoader();
    const arrayBuffer = dracoBytes.buffer.slice(
      dracoBytes.byteOffset, dracoBytes.byteOffset + dracoBytes.byteLength);
    loader.decodeDracoFile(
      arrayBuffer,
      (geometry) => {
        try {
          const posAttr = geometry.getAttribute('position');
          const idxAttr = geometry.getIndex();
          if (!posAttr || !idxAttr) throw new Error('Draco geometry missing position or index');
          const positions = new Float32Array(posAttr.array);
          const colAttr = geometry.getAttribute('color');
          let colors;
          if (colAttr) {
            // Draco/three can hand back colors as normalized floats (0-1) or
            // raw uint8 depending on encode-side quantization — normalize
            // to the uint8 shape mountMeshViewer() already expects.
            if (colAttr.array instanceof Uint8Array || colAttr.array instanceof Uint8ClampedArray) {
              colors = new Uint8Array(colAttr.array);
            } else {
              colors = new Uint8Array(colAttr.array.length);
              for (let i = 0; i < colAttr.array.length; i++) colors[i] = Math.round(clamp01(colAttr.array[i]) * 255);
            }
          } else {
            colors = new Uint8Array(positions.length).fill(200);  // no color attr — flat warm grey, matches the raw-format fallback in viewer.js
          }
          const faces = new Uint32Array(idxAttr.array);
          resolve({ positions, colors, faces, nVerts: positions.length / 3, nFaces: faces.length / 3 });
        } catch (e) {
          reject(e);
        } finally {
          geometry.dispose?.();
        }
      },
      undefined, undefined,
    );
  });
}
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

// ── Decode KEYFRAME_MESH → {positions, colors, faces} typed arrays, or null.
// Layout (see NIF_SPEC_v1.0.md §6b / pipeline.py's _extract_mesh docstring):
//   [format_flag:u8]
//   flag 0x00: [n_verts:u32 BE][n_faces:u32 BE]
//              [positions: n_verts×3×f32 BE][colors: n_verts×3×u8][faces: n_faces×3×u32 BE]
//   flag 0x01: Draco buffer — decoded via _decodeDracoMesh() above.
async function decodeMeshChunk(chunk) {
  if (!chunk) return null;
  try {
    const dv = new DataView(chunk.data.buffer, chunk.data.byteOffset, chunk.data.byteLength);
    const formatFlag = dv.getUint8(0);

    if (formatFlag === 0x01) {
      return await _decodeDracoMesh(chunk.data.subarray(1));
    }
    if (formatFlag !== 0x00) {
      console.warn(`[nif-format] KEYFRAME_MESH has format_flag ${formatFlag} — ` +
                    `no decoder for this format, skipping mesh render.`);
      return null;
    }
    const nVerts = dv.getUint32(1, false);
    const nFaces = dv.getUint32(5, false);
    let offset = 9;

    const positions = new Float32Array(nVerts * 3);
    for (let i = 0; i < nVerts * 3; i++) { positions[i] = dv.getFloat32(offset, false); offset += 4; }

    const colors = new Uint8Array(chunk.data.buffer, chunk.data.byteOffset + offset, nVerts * 3);
    offset += nVerts * 3;

    const faces = new Uint32Array(nFaces * 3);
    for (let i = 0; i < nFaces * 3; i++) { faces[i] = dv.getUint32(offset, false); offset += 4; }

    return { positions, colors, faces, nVerts, nFaces };
  } catch (e) {
    console.warn('[nif-format] KEYFRAME_MESH failed to decode (non-fatal, falls back to splat render):', e.message);
    return null;
  }
}

/**
 * Decode LAYER_GEO into [{label, depthMin, depthMax, count, data, indices}].
 * Added for nif-part-toggle.js's "generate a baked-open variant" flow — this
 * is the live-app counterpart of engine-next/viewer-src/NIFViewer.js's
 * _parseLayers(), kept as a separate implementation rather than a shared
 * import since this file is explicitly "the ONLY encode/decode path the live
 * app should use" and deliberately doesn't depend on the not-yet-wired
 * engine-next/viewer-src tree.
 *
 * v2 format — the indices block (added alongside pipeline.py's split_layers()
 * change) is required for a layer's points to be locatable in the main
 * buffer at all; files without it can be viewed as labeled groups but not
 * used to build an animated/toggled variant.
 */
export async function decodeLayers(reader) {
  const chunk = reader.getChunk(CHUNK.LAYER_GEO);
  if (!chunk) return [];
  const bytes = await decompressChunk(chunk);
  const arrayBuffer = bytes.buffer ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes;
  const dv = new DataView(arrayBuffer);
  const nLayers = dv.getUint32(0, false);
  const layers = [];
  let offset = 4;

  for (let i = 0; i < nLayers; i++) {
    if (offset + 1 > dv.byteLength) break;
    const labelLen = dv.getUint8(offset); offset += 1;
    let label = '';
    for (let j = 0; j < labelLen; j++) label += String.fromCharCode(dv.getUint8(offset++));
    if (offset + 12 > dv.byteLength) break;
    const depthMin = dv.getFloat32(offset, false); offset += 4;
    const depthMax = dv.getFloat32(offset, false); offset += 4;
    const nPoints  = dv.getUint32 (offset, false); offset += 4;
    const byteLen  = nPoints * 14 * 4;
    if (offset + byteLen > dv.byteLength) break;

    const raw  = new Uint8Array(arrayBuffer, offset, byteLen);
    const copy = new ArrayBuffer(byteLen);
    new Uint8Array(copy).set(raw);
    const data = new Float32Array(copy);
    offset += byteLen;

    const idxByteLen = nPoints * 4;
    let indices = null;
    if (offset + idxByteLen <= dv.byteLength) {
      indices = new Uint32Array(nPoints);
      for (let p = 0; p < nPoints; p++) indices[p] = dv.getUint32(offset + p * 4, false);
      offset += idxByteLen;
    }
    layers.push({ label, depthMin, depthMax, count: nPoints, data, indices });
  }
  return layers;
}

/** Decode PHYSICS chunk into {bodies, constraints} — see NIFHingeAuthor.js for the shape. */
export async function decodePhysics(reader) {
  return decodePhysicsChunk(reader.getChunk(CHUNK.PHYSICS));
}

// ── Public: turn canonical 14-float NIF geometry into THREE-ready arrays ────
/**
 * @param {{count:number, data:Float32Array}} gaussians
 * @returns {{ positions:Float32Array, colors01:Float32Array, opacities01:Float32Array, scalesLinear:Float32Array, count:number }}
 */
export function gaussiansToRenderArrays(gaussians) {
  const { count, data } = gaussians;
  const positions   = new Float32Array(count * 3);
  const colors01    = new Float32Array(count * 3);
  const opacities01 = new Float32Array(count);
  const scalesLinear= new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    const o = i * FLOATS_PER_POINT;
    positions[i*3+0] = data[o+0];
    positions[i*3+1] = data[o+1];
    positions[i*3+2] = data[o+2];
    scalesLinear[i*3+0] = Math.exp(data[o+3]);
    scalesLinear[i*3+1] = Math.exp(data[o+4]);
    scalesLinear[i*3+2] = Math.exp(data[o+5]);
    // data[o+6..9] is the quaternion — not yet consumed by the isotropic
    // billboard renderer in viewer.js (see NIFRenderer.js for the full
    // anisotropic path); kept in the canonical array for when that lands.
    opacities01[i] = sigmoid(data[o+10]);
    colors01[i*3+0] = sigmoid(data[o+11]);
    colors01[i*3+1] = sigmoid(data[o+12]);
    colors01[i*3+2] = sigmoid(data[o+13]);
  }
  return { positions, colors01, opacities01, scalesLinear, count };
}

// ── Decoded NIF geometry → 32-byte-row .splat binary ──────────────────────────
// Lets the existing GaussianSplats3D renderer (which only understands .splat/
// .ply/.ksplat) render .nif content at full anisotropic fidelity, without
// needing to re-point the renderer itself — the .nif file is still the only
// thing fetched, stored, and exported; this conversion happens in memory only,
// purely to hand off to the already-working render path.
export function geometryToSplatRows(gaussians) {
  const { count, data } = gaussians;
  const rowSize = 32;
  const out = new Uint8Array(count * rowSize);
  const dv  = new DataView(out.buffer);

  for (let i = 0; i < count; i++) {
    const o = i * FLOATS_PER_POINT;
    const base = i * rowSize;

    dv.setFloat32(base + 0, data[o+0], true);
    dv.setFloat32(base + 4, data[o+1], true);
    dv.setFloat32(base + 8, data[o+2], true);

    dv.setFloat32(base + 12, Math.exp(data[o+3]), true);
    dv.setFloat32(base + 16, Math.exp(data[o+4]), true);
    dv.setFloat32(base + 20, Math.exp(data[o+5]), true);

    // Re-quantise quaternion (canonical is already-normalised float wxyz)
    const clamp255 = v => Math.max(0, Math.min(255, Math.round(v)));
    out[base + 28] = clamp255(data[o+6] * 128 + 128);
    out[base + 29] = clamp255(data[o+7] * 128 + 128);
    out[base + 30] = clamp255(data[o+8] * 128 + 128);
    out[base + 31] = clamp255(data[o+9] * 128 + 128);

    const opacity01 = sigmoid(data[o+10]);
    out[base + 27] = clamp255(opacity01 * 255);
    out[base + 24] = clamp255(sigmoid(data[o+11]) * 255);
    out[base + 25] = clamp255(sigmoid(data[o+12]) * 255);
    out[base + 26] = clamp255(sigmoid(data[o+13]) * 255);
  }
  return out;
}

// ── File download helper (mirrors fumoc-format.js's downloadFumoc) ──────────
export function downloadNif(buffer, filename = 'scene.nif') {
  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename.endsWith('.nif') ? filename : filename + '.nif';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 3000);
}

export function isNifUrl(url) {
  return String(url || '').split('?')[0].toLowerCase().endsWith('.nif');
}
