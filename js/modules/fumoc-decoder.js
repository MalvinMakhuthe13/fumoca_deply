/**
 * FUMOC v2 Decoder — Open Spec Reference Implementation
 * ════════════════════════════════════════════════════════════════════════════
 * This is the canonical decoder for the FUMOC v2 format.
 * Published under MIT licence. Any app may ship this file verbatim.
 *
 * No dependencies. Runs in:
 *   - Any modern browser (Chrome 80+, Firefox 75+, Safari 14+)
 *   - Node.js 14+
 *   - React Native (with ArrayBuffer support)
 *   - Unity WebGL builds
 *   - Any WASM host
 *
 * Usage (browser / ESM):
 *   import FumocDecoder from './fumoc-decoder.js';
 *   const { header, gaussians, meta, hotspots, tour, thumbnail }
 *     = await FumocDecoder.decode(arrayBuffer);
 *
 *   // gaussians is a Float32Array ready to pass to any Gaussian splat renderer:
 *   //   [x0,y0,z0, sx0,sy0,sz0, r0,g0,b0,a0, q00,q10,q20,q30,  x1,y1,z1, ...]
 *   // Or get the raw .splat binary for drop-in compatibility:
 *   const splatBinary = FumocDecoder.toSplatBinary(gaussians);
 *
 * Usage (Node.js / CommonJS):
 *   const { FumocDecoder } = require('./fumoc-decoder.js');
 *
 * FUMOC v1 files (simple deflate) are also supported — the decoder
 * detects the magic bytes and routes accordingly.
 * ════════════════════════════════════════════════════════════════════════════
 */

'use strict';

import FumocCodec from './fumoc-codec.js';

const dec = new TextDecoder();
const enc = new TextEncoder();

const MAGIC_V1 = 'FUMOC1';
const CODEC_VERSION = 3; // v3: radix sort, order-1 ANS, perceptual quantise
const MAGIC_V2 = 'FUMOC2';

const CHANNEL = Object.freeze({
  0x01: 'POS_X', 0x02: 'POS_Y', 0x03: 'POS_Z',
  0x04: 'SCL_X', 0x05: 'SCL_Y', 0x06: 'SCL_Z',
  0x07: 'COL_R', 0x08: 'COL_G', 0x09: 'COL_B', 0x0A: 'COL_A',
  0x0B: 'ROT_Q0',0x0C: 'ROT_Q1',0x0D: 'ROT_Q2',0x0E: 'ROT_Q3',
  0x0F: 'SORT',
});

// ── File-level reader ─────────────────────────────────────────────────────────

function readFileHeader(bytes) {
  const magic = dec.decode(bytes.slice(0, 6));
  if (!magic.startsWith('FUMOC')) throw new Error('[FUMOC] Not a .fumoc file');
  const version   = bytes[8] | (bytes[9] << 8);
  const headerLen = new DataView(bytes.buffer, bytes.byteOffset + 10, 4).getUint32(0, true);
  const headerStr = dec.decode(bytes.slice(14, 14 + headerLen));
  const header    = JSON.parse(headerStr);
  return { version, header, dataOffset: 14 + headerLen };
}

// ── Section reader ─────────────────────────────────────────────────────────────

function* readSections(bytes, startOffset) {
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  let   off  = startOffset;

  while (off + 13 <= bytes.length) {
    const id = String.fromCharCode(
      bytes[off], bytes[off+1], bytes[off+2], bytes[off+3]);
    const flags   = bytes[off + 4];
    const compLen = view.getUint32(off + 5, true);
    const rawLen  = view.getUint32(off + 9, true);

    if (off + 13 + compLen > bytes.length) break;

    const data = bytes.slice(off + 13, off + 13 + compLen);
    yield { id, flags, compLen, rawLen, data, offset: off };
    off += 13 + compLen;
  }
}

// ── Decompress non-SPLT sections (deflate) ────────────────────────────────────

async function inflate(data) {
  try {
    const ds     = new DecompressionStream('deflate');
    const writer = ds.writable.getWriter();
    writer.write(data); writer.close();
    const chunks = [];
    const reader = ds.readable.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const out   = new Uint8Array(total);
    let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
  } catch {
    return data; // Not compressed — return as-is (v1 fallback)
  }
}

// ── SPLT v2 section decoder ────────────────────────────────────────────────────

function decodeSpltV2(spltData) {
  const view  = new DataView(spltData.buffer, spltData.byteOffset);
  const N     = view.getUint32(0, true);
  const nChan = view.getUint32(4, true);
  let   off   = 8;

  const channels = {};

  for (let c = 0; c < nChan; c++) {
    const chanId    = spltData[off++];
    // v92: order-0 only — freq table is always 512 bytes
    // order-1 (131072 byte tables) disabled until format is stabilised
    const freqLen   = 512;
    const freqBytes = spltData.slice(off, off + freqLen); off += freqLen;
    const metaLen   = view.getUint32(off, true); off += 4;
    const metaJson  = dec.decode(spltData.slice(off, off + metaLen)); off += metaLen;
    const compLen   = view.getUint32(off, true); off += 4;
    const compData  = spltData.slice(off, off + compLen); off += compLen;

    const meta      = JSON.parse(metaJson);
    const chanName  = CHANNEL[chanId] || `CH_${chanId.toString(16)}`;

    if (chanName === 'SORT') {
      // Decode sort index
      const sortBytes = FumocCodec.ansDecode(compData, freqBytes, meta.length * 4);
      channels.SORT   = new Uint32Array(sortBytes.buffer, sortBytes.byteOffset, meta.length);
    } else if (chanName.startsWith('COL_') || chanName.startsWith('ROT_')) {
      // Colour and rotation: ANS only (no quantise/delta pipeline)
      const raw = FumocCodec.ansDecode(compData, freqBytes, meta.length);
      channels[chanName] = raw;
    } else {
      // Position and scale: full decode pipeline
      // v3: check order flag in meta (order:1 = order-1 ANS tables)
      if (meta.order === 1 && FumocCodec.ansDecodeOrder1) {
        // order-1 decode — freqBytes is 256*256*2 = 131072 bytes
        channels[chanName] = FumocCodec.decodeChannel(compData, freqBytes, meta);
      } else {
        channels[chanName] = FumocCodec.decodeChannel(compData, freqBytes, meta);
      }
    }
  }

  return { N, channels };
}

// ── Assemble Gaussian struct from decoded channels ─────────────────────────────

/**
 * Build a structured Gaussians object from decoded channels.
 * Returns { N, posX, posY, posZ, sclX, sclY, sclZ,
 *           colR, colG, colB, colA, rotQ0, rotQ1, rotQ2, rotQ3 }
 */
function assembleGaussians(N, channels) {
  return {
    N,
    posX:  channels.POS_X  || new Float32Array(N),
    posY:  channels.POS_Y  || new Float32Array(N),
    posZ:  channels.POS_Z  || new Float32Array(N),
    sclX:  channels.SCL_X  || new Float32Array(N),
    sclY:  channels.SCL_Y  || new Float32Array(N),
    sclZ:  channels.SCL_Z  || new Float32Array(N),
    colR:  channels.COL_R  || new Uint8Array(N),
    colG:  channels.COL_G  || new Uint8Array(N),
    colB:  channels.COL_B  || new Uint8Array(N),
    colA:  channels.COL_A  || new Uint8Array(N).fill(255),
    rotQ0: channels.ROT_Q0 || new Uint8Array(N).fill(128),
    rotQ1: channels.ROT_Q1 || new Uint8Array(N),
    rotQ2: channels.ROT_Q2 || new Uint8Array(N),
    rotQ3: channels.ROT_Q3 || new Uint8Array(N),
  };
}

/**
 * Convert structured Gaussians to the standard .splat binary format.
 * Output is compatible with @mkkellogg/gaussian-splats-3d and all
 * other renderers that accept .splat files.
 *
 * @param {object} gaussians  — from assembleGaussians()
 * @returns Uint8Array        — raw .splat binary (32 bytes × N)
 */
function toSplatBinary(gaussians) {
  const { N, posX, posY, posZ, sclX, sclY, sclZ,
          colR, colG, colB, colA, rotQ0, rotQ1, rotQ2, rotQ3 } = gaussians;
  const out  = new Uint8Array(N * FumocCodec.SPLAT_ROW);
  const view = new DataView(out.buffer);

  for (let i = 0; i < N; i++) {
    const b = i * FumocCodec.SPLAT_ROW;
    view.setFloat32(b,      posX[i], true);
    view.setFloat32(b + 4,  posY[i], true);
    view.setFloat32(b + 8,  posZ[i], true);
    view.setFloat32(b + 12, sclX[i], true);
    view.setFloat32(b + 16, sclY[i], true);
    view.setFloat32(b + 20, sclZ[i], true);
    view.setUint8  (b + 24, colR[i]);
    view.setUint8  (b + 25, colG[i]);
    view.setUint8  (b + 26, colB[i]);
    view.setUint8  (b + 27, colA[i]);
    view.setUint8  (b + 28, rotQ0[i]);
    view.setUint8  (b + 29, rotQ1[i]);
    view.setUint8  (b + 30, rotQ2[i]);
    view.setUint8  (b + 31, rotQ3[i]);
  }

  return out;
}

// ── SPLT v1 section (plain .splat binary wrapped in deflate) ──────────────────

async function decodeSpltV1(data, flags) {
  let raw = data;
  if (flags & 0x01) raw = await inflate(data); // only inflate if not already done
  const N  = Math.floor(raw.length / FumocCodec.SPLAT_ROW);
  const dv = new DataView(raw.buffer, raw.byteOffset);

  const posX  = new Float32Array(N), posY  = new Float32Array(N), posZ  = new Float32Array(N);
  const sclX  = new Float32Array(N), sclY  = new Float32Array(N), sclZ  = new Float32Array(N);
  const colR  = new Uint8Array(N),   colG  = new Uint8Array(N);
  const colB  = new Uint8Array(N),   colA  = new Uint8Array(N);
  const rotQ0 = new Uint8Array(N),   rotQ1 = new Uint8Array(N);
  const rotQ2 = new Uint8Array(N),   rotQ3 = new Uint8Array(N);

  for (let i = 0; i < N; i++) {
    const b = i * FumocCodec.SPLAT_ROW;
    posX[i]  = dv.getFloat32(b,      true);
    posY[i]  = dv.getFloat32(b + 4,  true);
    posZ[i]  = dv.getFloat32(b + 8,  true);
    sclX[i]  = dv.getFloat32(b + 12, true);
    sclY[i]  = dv.getFloat32(b + 16, true);
    sclZ[i]  = dv.getFloat32(b + 20, true);
    colR[i]  = dv.getUint8  (b + 24);
    colG[i]  = dv.getUint8  (b + 25);
    colB[i]  = dv.getUint8  (b + 26);
    colA[i]  = dv.getUint8  (b + 27);
    rotQ0[i] = dv.getUint8  (b + 28);
    rotQ1[i] = dv.getUint8  (b + 29);
    rotQ2[i] = dv.getUint8  (b + 30);
    rotQ3[i] = dv.getUint8  (b + 31);
  }

  return { N, posX, posY, posZ, sclX, sclY, sclZ,
           colR, colG, colB, colA, rotQ0, rotQ1, rotQ2, rotQ3 };
}

// ── Main decode entry point ────────────────────────────────────────────────────

/**
 * Decode a .fumoc file (v1 or v2).
 *
 * @param {ArrayBuffer} buffer
 * @param {object}      options
 *   onProgress: (pct, label) => void
 *   splatBinary: boolean  — if true, also return raw .splat Uint8Array
 *
 * @returns Promise<{
 *   header:    object,        — file header JSON
 *   version:   number,        — 1 or 2
 *   gaussians: object,        — structured { N, posX, posY, posZ, ... }
 *   splatBinary: Uint8Array,  — raw .splat (if requested or always for v2)
 *   meta:      object,        — metadata section
 *   hotspots:  array,
 *   tour:      array,
 *   thumbnail: Uint8Array | null,  — JPEG bytes
 *   motionStates: object | null,
 *   cameras:   array | null,
 *   branding:  object | null,
 * }>
 */
async function decode(buffer, options = {}) {
  const { onProgress, splatBinary: wantBinary = true } = options;
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);

  // Update loading overlay if present
  const _overlay = (typeof window !== 'undefined') ? window._fumocaLoadingMsg : null;
  const _prog = (pct, label) => {
    if (_overlay) _overlay.textContent = label;
    onProgress?.(pct, label);
  };
  _prog(2, 'Reading file…');
  const { version, header, dataOffset } = readFileHeader(bytes);

  const result = {
    header,
    version,
    gaussians:    null,
    splatBinary:  null,
    meta:         {},
    hotspots:     [],
    tour:         [],
    thumbnail:    null,
    motionStates: null,
    cameras:      null,
    branding:     null,
    portals:      [],
    sceneMeta:    null,
    annotations:  [],
    videoPayload: null,
    pausePoints:  null,
    soundConfig:  null,
  };

  _prog(8, 'Reading sections…');

  for (const section of readSections(bytes, dataOffset)) {
    const { id, flags, data } = section;

    if (id === 'SPLT') {
      _prog(15, 'Decoding splat data…');

      // Decompress first if deflate-compressed (flag 0x01).
      // fumoc-format.js (v1-style encoder) writes flag 0x01 even for v2 codec
      // SPLT sections, so we must decompress before we can probe the structure.
      let spltData = data;
      if (flags & 0x01) spltData = await inflate(data);

      // Detect v2 codec SPLT by peeking at the internal structure:
      //   bytes 0-3: N (Gaussian count, u32) — must be > 0
      //   bytes 4-7: nChan (channel count, u32) — must be 1-15
      // A raw .splat binary starts with an XYZ float32, which interpreted as
      // a u32 would never land cleanly in [1,15], so this probe is reliable.
      let looksV2 = false;
      if (spltData.length >= 8) {
        const probe = new DataView(spltData.buffer, spltData.byteOffset, 8);
        const peekN    = probe.getUint32(0, true);
        const peekChan = probe.getUint32(4, true);
        looksV2 = peekN > 0 && peekChan >= 1 && peekChan <= 15
                  && spltData.length > peekN * 32; // channel-packed < raw .splat
      }

      if ((version >= 2 && (flags & 0x02)) || looksV2) {
        // v2 codec — channel-structured SPLT (already decompressed above)
        const { N, channels } = decodeSpltV2(spltData);
        result.gaussians = assembleGaussians(N, channels);
      } else {
        // v1: raw .splat binary (already decompressed — pass flags=0 to skip re-inflate)
        result.gaussians = await decodeSpltV1(spltData, 0);
      }

      _prog(85, 'Reconstructing geometry…');
      if (wantBinary) {
        result.splatBinary = toSplatBinary(result.gaussians);
      }

    } else if (id === 'META') {
      const raw = (flags & 0x01) ? await inflate(data) : data;
      try { result.meta = JSON.parse(dec.decode(raw)); } catch {}

    } else if (id === 'TOUR') {
      const raw = (flags & 0x01) ? await inflate(data) : data;
      try { result.tour = JSON.parse(dec.decode(raw)); } catch {}

    } else if (id === 'HOTS') {
      const raw = (flags & 0x01) ? await inflate(data) : data;
      try { result.hotspots = JSON.parse(dec.decode(raw)); } catch {}

    } else if (id === 'THUM') {
      result.thumbnail = (flags & 0x01) ? await inflate(data) : data;

    } else if (id === 'MOTN') {
      const raw = (flags & 0x01) ? await inflate(data) : data;
      try { result.motionStates = JSON.parse(dec.decode(raw)); } catch {}

    } else if (id === 'CAMR') {
      const raw = (flags & 0x01) ? await inflate(data) : data;
      try { result.cameras = JSON.parse(dec.decode(raw)); } catch {}

    } else if (id === 'SOND') {
      const raw = (flags & 0x01) ? await inflate(data) : data;
      try { result.soundConfig = JSON.parse(dec.decode(raw)); } catch {}

    } else if (id === 'VIDP') {
      // Video payload — raw, no decompression needed
      result.videoPayload = data; // Uint8Array (MP4/WebM bytes)

    } else if (id === 'IPTS') {
      const raw = (flags & 0x01) ? await inflate(data) : data;
      try { result.pausePoints = JSON.parse(dec.decode(raw)); } catch {}

    } else if (id === 'SCNE') {
      const raw = (flags & 0x01) ? await inflate(data) : data;
      try { result.sceneMeta = JSON.parse(dec.decode(raw)); } catch {}

    } else if (id === 'ANOT') {
      const raw = (flags & 0x01) ? await inflate(data) : data;
      try { result.annotations = JSON.parse(dec.decode(raw)); } catch {}

    } else if (id === 'PORT') {
      const raw = (flags & 0x01) ? await inflate(data) : data;
      try { result.portals = JSON.parse(dec.decode(raw)); } catch {}

    } else if (id === 'BRND') {
      const raw = (flags & 0x01) ? await inflate(data) : data;
      try { result.branding = JSON.parse(dec.decode(raw)); } catch {}
    }
    // Unknown sections silently ignored — forward compatibility
  }

  _prog(100, 'Done');
  return result;
}

/**
 * Read only the header + non-SPLT sections — fast path for preview cards,
 * share thumbnails, and social rich previews. Does NOT decode the splat data.
 */
async function decodePreview(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const { version, header, dataOffset } = readFileHeader(bytes);

  const result = { header, version, meta: {}, thumbnail: null, hotspots: [], tour: [] };

  for (const section of readSections(bytes, dataOffset)) {
    const { id, flags, data } = section;
    if (id === 'SPLT') continue; // skip the heavy part
    if (id === 'META') {
      const raw = (flags & 0x01) ? await inflate(data) : data;
      try { result.meta = JSON.parse(dec.decode(raw)); } catch {}
    } else if (id === 'THUM') {
      result.thumbnail = (flags & 0x01) ? await inflate(data) : data;
    } else if (id === 'HOTS') {
      const raw = (flags & 0x01) ? await inflate(data) : data;
      try { result.hotspots = JSON.parse(dec.decode(raw)); } catch {}
    } else if (id === 'TOUR') {
      const raw = (flags & 0x01) ? await inflate(data) : data;
      try { result.tour = JSON.parse(dec.decode(raw)); } catch {}
    }
  }
  return result;
}

/**
 * Decode and immediately load into the active FUMOCA viewer.
 * Stores decoded sections in window globals the viewer modules read.
 * Returns a blob URL for the .splat binary — pass to the viewer loader.
 */
async function loadIntoViewer(buffer, onProgress) {
  const decoded = await decode(buffer, { onProgress, splatBinary: true });

  // Expose to viewer modules
  if (decoded.tour && typeof window !== 'undefined')         window._fumocaTourStops    = decoded.tour;
  if (decoded.hotspots && typeof window !== 'undefined')     window._fumocaHotspots     = decoded.hotspots;
  if (decoded.motionStates && typeof window !== 'undefined') window._fumocaMotionStates = decoded.motionStates;
  if (decoded.cameras && typeof window !== 'undefined')      window._fumocaSavedCameras  = decoded.cameras;
  if (decoded.branding && typeof window !== 'undefined')     window._fumocaBranding      = decoded.branding;
  if (decoded.meta && typeof window !== 'undefined')         window._fumocaOpenedMeta    = decoded.meta;

  const splatBlob = new Blob([decoded.splatBinary], { type: 'application/octet-stream' });
  const splatUrl  = URL.createObjectURL(splatBlob);

  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('fumoc:load', {
    detail: { splatUrl, header: decoded.header, meta: decoded.meta, decoded }
  }));

  return { splatUrl, decoded };
}

/**
 * Get a thumbnail blob URL from a .fumoc file without full decode.
 */
async function thumbnailURL(buffer) {
  const { thumbnail } = await decodePreview(buffer);
  if (!thumbnail) return null;
  return URL.createObjectURL(new Blob([thumbnail], { type: 'image/jpeg' }));
}

// ── Utility: estimate compression quality ─────────────────────────────────────

function analyseFile(buffer) {
  const bytes   = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const { header } = readFileHeader(bytes);
  const ratio   = header.input_byte_length
    ? (header.input_byte_length / bytes.length).toFixed(1)
    : '?';
  return {
    version:      header.fumoc_version,
    quality:      header.quality || 'v1',
    nGaussians:   header.n_gaussians,
    fileSizeMB:   (bytes.length / 1048576).toFixed(2),
    inputSizeMB:  header.input_byte_length
      ? (header.input_byte_length / 1048576).toFixed(2) : '?',
    compressionRatio: ratio,
    hasTour:      header.has_tour,
    hasHotspots:  header.has_hotspots,
    hasThumbnail: header.has_thumbnail,
    encoder:      header.encoder || 'unknown',
    openSpec:     header.open_spec || 'fumoca.io/spec',
  };
}

const FumocDecoder = {
  decode,
  decodePreview,
  loadIntoViewer,
  thumbnailURL,
  toSplatBinary,
  assembleGaussians,
  analyseFile,
};

// CommonJS compat
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FumocDecoder };
}

if (typeof window !== 'undefined') window.FumocDecoder = FumocDecoder;
if (typeof self !== 'undefined') self.FumocDecoder = FumocDecoder;
export default FumocDecoder;
