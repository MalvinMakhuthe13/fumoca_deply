/**
 * FUMOC v2 Encoder
 * ════════════════════════════════════════════════════════════════════════════
 * Takes a raw .splat binary (or .ply) and produces a compressed .fumoc v2
 * file using the four-stage codec in fumoc-codec.js.
 *
 * Usage:
 *   import FumocEncoder from './fumoc-encoder.js';
 *
 *   const result = await FumocEncoder.encode(splatArrayBuffer, {
 *     quality: 'medium',      // 'high' | 'medium' | 'low'
 *     meta: { title: 'My Car', mode: 'vehicle' },
 *     hotspots: [...],
 *     tour: [...],
 *     thumbnail: jpegUint8Array,
 *     onProgress: (pct, stage) => console.log(pct, stage),
 *   });
 *
 *   // result.buffer  — ArrayBuffer of the .fumoc v2 file
 *   // result.stats   — { inputBytes, outputBytes, ratio, stages }
 *
 * File format (v2):
 *   [8B magic: FUMOC2\0\0]
 *   [2B version: 0x0002]
 *   [4B header_len]
 *   [header JSON bytes]
 *   [sections...]
 *
 * Each compressed section:
 *   [4B id][1B flags][4B comp_len][4B raw_len][data]
 *
 * The SPLT section in v2 is NOT a raw splat binary — it is a structured
 * block of channel-compressed streams, one per Gaussian property:
 *   [4B n_gaussians]
 *   [4B n_channels]
 *   For each channel:
 *     [1B channel_id]
 *     [512B freq_table]
 *     [4B meta_json_len][meta JSON]
 *     [4B compressed_len][compressed bytes]
 *
 * Channel IDs:
 *   0x01 = position X
 *   0x02 = position Y
 *   0x03 = position Z
 *   0x04 = scale X
 *   0x05 = scale Y
 *   0x06 = scale Z
 *   0x07 = colour R (passthrough u8)
 *   0x08 = colour G
 *   0x09 = colour B
 *   0x0A = colour A (opacity)
 *   0x0B = rotation Q0
 *   0x0C = rotation Q1
 *   0x0D = rotation Q2
 *   0x0E = rotation Q3
 *   0x0F = sort_index (Uint32, maps compressed order → original order)
 * ════════════════════════════════════════════════════════════════════════════
 */

import FumocCodec from './fumoc-codec.js';

const MAGIC   = 'FUMOC2\0\0';
const VERSION = 2;

const CHANNEL = Object.freeze({
  POS_X:  0x01, POS_Y:  0x02, POS_Z:  0x03,
  SCL_X:  0x04, SCL_Y:  0x05, SCL_Z:  0x06,
  COL_R:  0x07, COL_G:  0x08, COL_B:  0x09, COL_A: 0x0A,
  ROT_Q0: 0x0B, ROT_Q1: 0x0C, ROT_Q2: 0x0D, ROT_Q3: 0x0E,
  SORT:   0x0F,
});

const enc = new TextEncoder();
const dec = new TextDecoder();

// ── Parse raw .splat binary ────────────────────────────────────────────────────

function parseSplat(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const N     = Math.floor(bytes.byteLength / FumocCodec.SPLAT_ROW);
  const view  = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const posX = new Float32Array(N), posY = new Float32Array(N), posZ = new Float32Array(N);
  const sclX = new Float32Array(N), sclY = new Float32Array(N), sclZ = new Float32Array(N);
  const colR = new Uint8Array(N),   colG = new Uint8Array(N);
  const colB = new Uint8Array(N),   colA = new Uint8Array(N);
  const rotQ0 = new Uint8Array(N), rotQ1 = new Uint8Array(N);
  const rotQ2 = new Uint8Array(N), rotQ3 = new Uint8Array(N);

  for (let i = 0; i < N; i++) {
    const b = i * FumocCodec.SPLAT_ROW;
    posX[i] = view.getFloat32(b,      true);
    posY[i] = view.getFloat32(b + 4,  true);
    posZ[i] = view.getFloat32(b + 8,  true);
    sclX[i] = view.getFloat32(b + 12, true);
    sclY[i] = view.getFloat32(b + 16, true);
    sclZ[i] = view.getFloat32(b + 20, true);
    colR[i] = view.getUint8  (b + 24);
    colG[i] = view.getUint8  (b + 25);
    colB[i] = view.getUint8  (b + 26);
    colA[i] = view.getUint8  (b + 27);
    rotQ0[i]= view.getUint8  (b + 28);
    rotQ1[i]= view.getUint8  (b + 29);
    rotQ2[i]= view.getUint8  (b + 30);
    rotQ3[i]= view.getUint8  (b + 31);
  }

  return { N, posX, posY, posZ, sclX, sclY, sclZ,
           colR, colG, colB, colA, rotQ0, rotQ1, rotQ2, rotQ3 };
}

// ── Reorder arrays by sort index ───────────────────────────────────────────────

function reorder(arr, indices) {
  const out = new arr.constructor(arr.length);
  for (let i = 0; i < indices.length; i++) out[i] = arr[indices[i]];
  return out;
}

// ── Pack channel into binary ───────────────────────────────────────────────────

function packChannel(channelId, compressed, freqTable, meta) {
  const metaJson    = enc.encode(JSON.stringify(meta));
  // v92: always 512 bytes for freq table (order-0 only)
  const freqBytes   = freqTable.length >= 512 ? freqTable.slice(0, 512) : freqTable;
  const totalBytes  = 1 + 512 + 4 + metaJson.length + 4 + compressed.length;
  const buf         = new Uint8Array(totalBytes);
  const view        = new DataView(buf.buffer);
  let   off         = 0;

  buf[off++] = channelId;
  buf.set(freqBytes, off); off += 512;
  view.setUint32(off, metaJson.length, true); off += 4;
  buf.set(metaJson, off); off += metaJson.length;
  view.setUint32(off, compressed.length, true); off += 4;
  buf.set(compressed, off);

  return buf;
}

// ── Build SPLT section v2 ──────────────────────────────────────────────────────

async function buildSpltSection(gaussians, quality, onProgress) {
  const q    = FumocCodec.QUALITY_PRESETS[quality] || FumocCodec.QUALITY_PRESETS.medium;
  const { N, posX, posY, posZ, sclX, sclY, sclZ,
          colR, colG, colB, colA, rotQ0, rotQ1, rotQ2, rotQ3 } = gaussians;

  onProgress?.(5, 'Sorting spatially…');

  // Stage 1: Morton sort
  const positions = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    positions[i*3]   = posX[i];
    positions[i*3+1] = posY[i];
    positions[i*3+2] = posZ[i];
  }
  const sortIdx = FumocCodec.mortonSort(positions);

  onProgress?.(15, 'Encoding positions…');

  // Reorder all channels by sort index
  const rPosX = reorder(posX, sortIdx), rPosY = reorder(posY, sortIdx), rPosZ = reorder(posZ, sortIdx);
  const rSclX = reorder(sclX, sortIdx), rSclY = reorder(sclY, sortIdx), rSclZ = reorder(sclZ, sortIdx);
  const rColR = reorder(colR, sortIdx), rColG = reorder(colG, sortIdx);
  const rColB = reorder(colB, sortIdx), rColA = reorder(colA, sortIdx);
  const rQ0   = reorder(rotQ0, sortIdx), rQ1 = reorder(rotQ1, sortIdx);
  const rQ2   = reorder(rotQ2, sortIdx), rQ3 = reorder(rotQ3, sortIdx);

  // Stages 2–4 per channel
  // Yield between channels so the browser stays responsive
  const channels = [];
  // v3 codec: order-1 ANS for position+scale (strong delta correlation)
  //            order-0 ANS for colour+rotation (weak correlation)
  //            Column 6: useOrder1
  const useOrder1 = false; // v92 fix: order-0 only until order-1 freq table format is stable
  const pipeline = [
    [CHANNEL.POS_X, rPosX, q.posBits,   true,  true,  'position X',  useOrder1],
    [CHANNEL.POS_Y, rPosY, q.posBits,   true,  true,  'position Y',  useOrder1],
    [CHANNEL.POS_Z, rPosZ, q.posBits,   true,  true,  'position Z',  useOrder1],
    [CHANNEL.SCL_X, rSclX, q.scaleBits, true,  true,  'scale X',     useOrder1],
    [CHANNEL.SCL_Y, rSclY, q.scaleBits, true,  true,  'scale Y',     useOrder1],
    [CHANNEL.SCL_Z, rSclZ, q.scaleBits, true,  true,  'scale Z',     useOrder1],
    [CHANNEL.COL_R, rColR, 8,           false, false, 'colour R',    false],
    [CHANNEL.COL_G, rColG, 8,           false, false, 'colour G',    false],
    [CHANNEL.COL_B, rColB, 8,           false, false, 'colour B',    false],
    [CHANNEL.COL_A, rColA, 8,           false, false, 'opacity',     false],
    [CHANNEL.ROT_Q0,rQ0,   q.rotBits,   false, false, 'rotation Q0', false],
    [CHANNEL.ROT_Q1,rQ1,   q.rotBits,   false, false, 'rotation Q1', false],
    [CHANNEL.ROT_Q2,rQ2,   q.rotBits,   false, false, 'rotation Q2', false],
    [CHANNEL.ROT_Q3,rQ3,   q.rotBits,   false, false, 'rotation Q3', false],
  ];

  for (let i = 0; i < pipeline.length; i++) {
    const [chanId, data, bits, delta, signed, label, order1Ch] = pipeline[i];
    const pct = 15 + Math.round((i / pipeline.length) * 60);
    onProgress?.(pct, `Compressing ${label}…`);

    // Yield to browser
    await new Promise(r => setTimeout(r, 0));

    // For colour channels (already u8), just run ANS directly
    if (!delta && !signed && bits === 8) {
      // Colour/rotation — order-0
      const { compressed, freqTable } = FumocCodec.ansEncode(data);
      const meta = { bits, delta: false, signed: false, length: data.length, min: 0, max: 255, order: 0 };
      channels.push(packChannel(chanId, compressed, freqTable, meta));
    } else {
      // Position/scale — adaptive quantise + optional order-1 ANS
      const floats = data instanceof Float32Array ? data : new Float32Array(data);
      let compressed, freqTable, meta;

      if (order1Ch && FumocCodec.quantiseAdaptive && FumocCodec.ansEncodeOrder1) {
        // v3 path: adaptive quantise → delta → zigzag → order-1 ANS
        const { quantised, min, max } = FumocCodec.quantiseAdaptive(floats, bits, signed);
        let q = quantised;
        if (delta) q = FumocCodec.deltaEncode(q);
        const bytesPer = bits > 8 ? 2 : 1;
        const bytes = new Uint8Array(q.length * bytesPer);
        if (bits > 8) {
          const view = new DataView(bytes.buffer);
          for (let j=0;j<q.length;j++) { const v=q[j]; view.setUint16(j*2,v>=0?v*2:(-v*2-1),true); }
        } else {
          for (let j=0;j<q.length;j++) { const v=q[j]; bytes[j]=v>=0?v*2:(-v*2-1); }
        }
        const r = FumocCodec.ansEncodeOrder1(bytes);
        compressed = r.compressed; freqTable = r.tables;
        meta = { bits, delta, signed, length: floats.length, min, max, order: 1 };
      } else {
        // v2 fallback path
        const result = FumocCodec.encodeChannel(floats, bits, delta, signed);
        compressed = result.compressed; freqTable = result.freqTable;
        meta = { ...result.meta, order: 0 };
      }
      channels.push(packChannel(chanId, compressed, freqTable, meta));
    }
  }

  onProgress?.(80, 'Encoding sort index…');

  // Store sort index so decoder can reconstruct original order if needed
  // (for compatibility with apps that need stable Gaussian IDs)
  const sortBytes  = new Uint8Array(sortIdx.buffer);
  const { compressed: sortComp, freqTable: sortFreq } = FumocCodec.ansEncode(sortBytes);
  const sortMeta   = { length: sortIdx.length, isIndex: true };
  channels.push(packChannel(CHANNEL.SORT, sortComp, sortFreq, sortMeta));

  // Pack all channels into SPLT section body
  const header = new Uint8Array(8);
  new DataView(header.buffer).setUint32(0, N, true);
  new DataView(header.buffer).setUint32(4, channels.length, true);

  const parts   = [header, ...channels];
  const total   = parts.reduce((n, p) => n + p.length, 0);
  const spltBody = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { spltBody.set(p, off); off += p.length; }

  return spltBody;
}

// ── Build a generic section (non-SPLT) ────────────────────────────────────────

async function _buildRawSection(id, rawData) {
  // For video — store as-is, no re-compression (video is already compressed)
  const raw = rawData instanceof Uint8Array ? rawData : new Uint8Array(rawData);
  const hdr = new Uint8Array(13);
  const dv  = new DataView(hdr.buffer);
  for (let i = 0; i < 4; i++) hdr[i] = id.charCodeAt(i);
  hdr[4] = 0x04; // flag: raw (not compressed by fumoc)
  dv.setUint32(5, raw.length, true);
  dv.setUint32(9, raw.length, true);
  const out = new Uint8Array(13 + raw.length);
  out.set(hdr, 0); out.set(raw, 13);
  return out;
}

async function buildSection(id, rawData) {
  const raw = rawData instanceof Uint8Array ? rawData : new Uint8Array(rawData);

  // Use browser CompressionStream for non-SPLT sections (they're small)
  let payload = raw, flags = 0;
  try {
    const cs     = new CompressionStream('deflate');
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
    const comp  = new Uint8Array(total);
    let o = 0; for (const c of chunks) { comp.set(c, o); o += c.length; }
    if (comp.length < raw.length * 0.98) { payload = comp; flags = 0x01; }
  } catch {}

  const hdr = new Uint8Array(13);
  const dv  = new DataView(hdr.buffer);
  for (let i = 0; i < 4; i++) hdr[i] = id.charCodeAt(i);
  hdr[4] = flags;
  dv.setUint32(5, payload.length, true);
  dv.setUint32(9, raw.length, true);

  const out = new Uint8Array(13 + payload.length);
  out.set(hdr, 0); out.set(payload, 13);
  return out;
}

// ── Main encode entry point ────────────────────────────────────────────────────

/**
 * Encode a raw splat buffer to .fumoc v2.
 *
 * @param {ArrayBuffer} splatBuffer  — raw .splat binary
 * @param {object}      options
 * @returns Promise<{ buffer: ArrayBuffer, stats: object }>
 */
async function encode(splatBuffer, options = {}) {
  const {
    quality    = 'medium',
    meta       = {},
    hotspots   = [],
    tour       = [],
    thumbnail  = null,
    portals    = null,
    sceneMeta  = null,
    annotations = null,
    videoPayload = null,   // Uint8Array — VIDP section
    pausePoints  = null,   // object    — IPTS section
    fillGaps     = false,  // boolean   — synthesise filler Gaussians (v92)
    gapAggressiveness = 0.5,// 0-1     — fill aggressiveness if fillGaps=true
    sondConfig   = null,   // object    — SOND section (sound config)
    branding   = null,
    motionStates = null,
    cameras    = null,
    meshSection  = null,   // Uint8Array — pre-built MESH section payload (from fumoc-draco-encoder.js)
    onProgress = null,
  } = options;

  const inputBytes = splatBuffer.byteLength;
  const stageStats = {};

  onProgress?.(1, 'Parsing splat data…');
  const gaussians = parseSplat(splatBuffer);

  // v92: optional gap filling — synthesise Gaussians in under-sampled regions
  if (fillGaps && window.FumocGapFiller) {
    onProgress?.(2, 'Analysing splat for gaps…');
    try {
      const filled = await window.FumocGapFiller.fillGaps(gaussians, {
        aggressiveness: gapAggressiveness,
        onProgress: (pct, label) => onProgress?.(2 + pct * 0.04, label),
      });
      if (filled.stats.addedN > 0) {
        gaussians = filled.gaussians;
        console.log(`[encoder] Gap filling added ${filled.stats.addedN.toLocaleString()} Gaussians (+${filled.stats.ratioPct}%)`);
      }
    } catch (e) {
      console.warn('[encoder] Gap filling skipped:', e.message);
    }
  }

  onProgress?.(3, 'Building compression pipeline…');
  const spltBody = await buildSpltSection(gaussians, quality, onProgress);
  stageStats.splt = spltBody.length;

  onProgress?.(82, 'Compressing metadata…');

  // Build all non-SPLT sections
  const fullMeta = {
    ...meta,
    fumoc_version:     VERSION,
    fumoc_spec:        '2.0',
    created:           meta.created || new Date().toISOString(),
    n_gaussians:       gaussians.N,
    quality,
    input_byte_length: inputBytes,
    has_tour:          tour.length > 0,
    has_hotspots:      hotspots.length > 0,
    has_thumbnail:     !!thumbnail,
    has_motion:        !!motionStates,
    has_portals:       !!(portals?.length),
    has_scene_meta:    !!sceneMeta,
    has_annotations:   !!(annotations?.length),
    has_video:         !!videoPayload,
    has_pause_points:  !!(pausePoints?.pause_points?.length),
    has_sound:         !!sondConfig,
    has_cameras:       !!cameras,
    has_branding:      !!branding,
    encoder:           'FUMOCA v82',
    open_spec:         'https://fumoca.io/spec/fumoc-v2',
  };

  const sections = await Promise.all([
    // SPLT gets special treatment — already compressed in place
    (async () => {
      const hdr = new Uint8Array(13);
      const dv  = new DataView(hdr.buffer);
      const id  = 'SPLT';
      for (let i = 0; i < 4; i++) hdr[i] = id.charCodeAt(i);
      hdr[4] = 0x02; // flag: v2 codec (not deflate)
      dv.setUint32(5, spltBody.length, true);
      dv.setUint32(9, gaussians.N * FumocCodec.SPLAT_ROW, true); // raw size
      const sec = new Uint8Array(13 + spltBody.length);
      sec.set(hdr, 0); sec.set(spltBody, 13);
      return sec;
    })(),
    buildSection('META', enc.encode(JSON.stringify(meta))),
    ...(tour.length      ? [buildSection('TOUR', enc.encode(JSON.stringify(tour)))]         : []),
    ...(hotspots.length  ? [buildSection('HOTS', enc.encode(JSON.stringify(hotspots)))]     : []),
    ...(thumbnail        ? [buildSection('THUM', thumbnail)]                                 : []),
    ...(motionStates     ? [buildSection('MOTN', enc.encode(JSON.stringify(motionStates)))]  : []),
    ...(cameras          ? [buildSection('CAMR', enc.encode(JSON.stringify(cameras)))]       : []),
    ...(branding         ? [buildSection('BRND', enc.encode(JSON.stringify(branding)))]      : []),
    ...(portals?.length  ? [buildSection('PORT', enc.encode(JSON.stringify(portals)))]       : []),
    ...(sceneMeta        ? [buildSection('SCNE', enc.encode(JSON.stringify(sceneMeta)))]       : []),
    ...(annotations?.length ? [buildSection('ANOT', enc.encode(JSON.stringify(annotations)))] : []),
    ...(pausePoints  ? [buildSection('IPTS', enc.encode(JSON.stringify(pausePoints)))]         : []),
    ...(sondConfig   ? [buildSection('SOND', enc.encode(JSON.stringify(sondConfig)))]       : []),
    // MESH: Draco-encoded triangle mesh (built externally by fumoc-draco-encoder.js)
    // Stored raw — Draco bitstream is already a compressed binary format.
    ...(meshSection  ? [await _buildRawSection('MESH', meshSection)]                        : []),
    // VIDP: video payload — stored raw (already compressed as MP4/WebM)
    // Flag 0x04 = raw (not deflate, not fumoc codec)
    ...(videoPayload ? [await _buildRawSection('VIDP', videoPayload)] : []),
  ]);

  onProgress?.(94, 'Writing file…');

  // Assemble final file
  const headerJson  = enc.encode(JSON.stringify(fullMeta));
  const magicBytes  = enc.encode(MAGIC).slice(0, 8);
  const versionBytes = new Uint8Array([VERSION & 0xFF, (VERSION >> 8) & 0xFF]);
  const headerLen   = new Uint8Array(4);
  new DataView(headerLen.buffer).setUint32(0, headerJson.length, true);

  const totalLen = 8 + 2 + 4 + headerJson.length
    + sections.reduce((n, s) => n + s.length, 0);
  const out = new Uint8Array(totalLen);
  let off = 0;

  out.set(magicBytes,   off); off += 8;
  out.set(versionBytes, off); off += 2;
  out.set(headerLen,    off); off += 4;
  out.set(headerJson,   off); off += headerJson.length;
  for (const s of sections) { out.set(s, off); off += s.length; }

  const outputBytes = out.byteLength;
  const ratio       = inputBytes / outputBytes;

  onProgress?.(100, `Done — ${ratio.toFixed(1)}× compression`);

  return {
    buffer: out.buffer,
    stats: {
      inputBytes,
      outputBytes,
      ratio,
      nGaussians: gaussians.N,
      quality,
      reductionPct: Math.round((1 - outputBytes / inputBytes) * 100),
      stages: stageStats,
    },
  };
}

/**
 * Convenience: encode from a Supabase splat record + fetched buffer.
 */
async function fromSplatRecord(record, splatArrayBuffer, extras = {}) {
  const meta = {
    id:          record.id,
    title:       record.title        || 'Untitled',
    description: record.description  || '',
    mode:        record.metadata?.mode || 'product',
    author:      record.user_id,
    created:     record.created_at,
    tags:        record.metadata?.tags || [],
    source_app:  'FUMOCA',
  };

  return encode(splatArrayBuffer, {
    quality:      extras.quality    || 'medium',
    meta,
    hotspots:     record.metadata?.hotspots     || [],
    tour:         record.metadata?.tourStops    || [],
    motionStates: record.metadata?.motionStates || null,
    cameras:      record.metadata?.savedCameras || null,
    thumbnail:    extras.thumbnailBuffer        || null,
    branding:     extras.branding               || record.metadata?.whitelabel || null,
    onProgress:   extras.onProgress,
  });
}

const FumocEncoder = { encode, fromSplatRecord, CHANNEL, VERSION, MAGIC };
window.FumocEncoder = FumocEncoder;
export default FumocEncoder;
