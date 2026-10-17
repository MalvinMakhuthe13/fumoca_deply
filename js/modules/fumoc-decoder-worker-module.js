// FUMOCA Decoder Worker — runs the full decode off the main thread
// importScripts approach for maximum browser compatibility

const SPLAT_ROW = 32;
const ANS_M = 1 << 12;
const ANS_L = 1 << 23;
const MAX_GAUSSIANS = 5_000_000;
const MAX_SECTION_BYTES = 512 * 1024 * 1024;
const MAX_HEADER_BYTES = 1024 * 1024;
const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;

// ── Minimal ANS decoder (order-0 only) ────────────────────────────────────────
function deserialiseFreqTable(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== 512) {
    throw new Error('[FUMOC Worker] ANS frequency table must be exactly 512 bytes');
  }
  const freq = new Uint32Array(256);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < 256; i++) freq[i] = view.getUint16(i * 2, true);
  const cumFreq = new Uint32Array(257);
  for (let s = 0; s < 256; s++) cumFreq[s+1] = cumFreq[s] + freq[s];
  if (cumFreq[256] !== ANS_M) throw new Error('[FUMOC Worker] ANS frequencies do not sum to the expected table size');
  return { freq, cumFreq };
}

function ansDecode(compressed, freqTableBytes, outputLength) {
  if (!Number.isSafeInteger(outputLength) || outputLength < 0 || outputLength > MAX_GAUSSIANS * 4) {
    throw new Error('[FUMOC Worker] ANS output length is invalid or exceeds the safety limit');
  }
  if (outputLength === 0) return new Uint8Array(0);
  if (!(compressed instanceof Uint8Array) || compressed.byteLength < 4 || compressed.byteLength > MAX_SECTION_BYTES) {
    throw new Error('[FUMOC Worker] ANS compressed stream is truncated or oversized');
  }
  const { freq, cumFreq } = deserialiseFreqTable(freqTableBytes);
  const decodeTable = new Uint8Array(ANS_M);
  for (let sym = 0; sym < 256; sym++)
    for (let s = cumFreq[sym]; s < cumFreq[sym+1]; s++) decodeTable[s] = sym;
  const out = new Uint8Array(outputLength);
  let state = ((compressed[0]<<24) | (compressed[1]<<16) | (compressed[2]<<8) | compressed[3]) >>> 0;
  let bytePos = 4;
  for (let i = 0; i < outputLength; i++) {
    const slot = state % ANS_M;
    const sym  = decodeTable[slot];
    out[i] = sym;
    state = freq[sym] * Math.floor(state / ANS_M) + slot - cumFreq[sym];
    while (state < ANS_L) {
      if (bytePos >= compressed.length) throw new Error('[FUMOC Worker] ANS stream ended before renormalization completed');
      state = (state << 8) | compressed[bytePos++];
    }
  }
  return out;
}

function ansDecodeOrder1(compressed, tableBytes, outputLength) {
  if (!Number.isSafeInteger(outputLength) || outputLength < 0 || outputLength > MAX_GAUSSIANS * 4) {
    throw new Error('[FUMOC Worker] Order-1 ANS output length is invalid');
  }
  if (outputLength === 0) return new Uint8Array(0);
  if (!(compressed instanceof Uint8Array) || compressed.byteLength < 4 || compressed.byteLength > MAX_SECTION_BYTES ||
      !(tableBytes instanceof Uint8Array) || tableBytes.byteLength !== 131072) {
    throw new Error('[FUMOC Worker] Order-1 ANS stream or frequency table is invalid');
  }
  const tableView = new DataView(tableBytes.buffer, tableBytes.byteOffset, tableBytes.byteLength);
  const freqFlat = new Uint16Array(256 * 256);
  for (let i = 0; i < freqFlat.length; i++) freqFlat[i] = tableView.getUint16(i * 2, true);
  const cumFlat = new Uint32Array(256 * 257);
  for (let ctx = 0; ctx < 256; ctx++) {
    const base = ctx * 256, cumBase = ctx * 257;
    let sum = 0;
    for (let sym = 0; sym < 256; sym++) {
      sum += freqFlat[base + sym];
      cumFlat[cumBase + sym + 1] = sum;
    }
    if (sum !== ANS_M) throw new Error(`[FUMOC Worker] Order-1 frequency context ${ctx} is invalid`);
  }
  const decodeTable = new Uint8Array(256 * ANS_M);
  for (let ctx = 0; ctx < 256; ctx++) {
    const base = ctx * 256, cumBase = ctx * 257, tableBase = ctx * ANS_M;
    for (let sym = 0; sym < 256; sym++) {
      for (let slot = cumFlat[cumBase + sym]; slot < cumFlat[cumBase + sym + 1]; slot++) {
        decodeTable[tableBase + slot] = sym;
      }
    }
  }
  const out = new Uint8Array(outputLength);
  let state = ((compressed[0] << 24) | (compressed[1] << 16) | (compressed[2] << 8) | compressed[3]) >>> 0;
  let bytePos = 4, ctx = 0;
  for (let i = 0; i < outputLength; i++) {
    const slot = state % ANS_M;
    const sym = decodeTable[ctx * ANS_M + slot];
    out[i] = sym;
    const base = ctx * 256, cumBase = ctx * 257;
    state = freqFlat[base + sym] * Math.floor(state / ANS_M) + slot - cumFlat[cumBase + sym];
    ctx = sym;
    while (state < ANS_L) {
      if (bytePos >= compressed.byteLength) throw new Error('[FUMOC Worker] Order-1 ANS stream is truncated');
      state = (state << 8) | compressed[bytePos++];
    }
  }
  return out;
}

function decodeChannelOrder1(compressed, tableBytes, meta) {
  if (!meta || !Number.isInteger(meta.length) || meta.length < 1 || meta.length > MAX_GAUSSIANS ||
      !Number.isInteger(meta.bits) || meta.bits < 1 || meta.bits > 16 ||
      !Number.isFinite(meta.min) || !Number.isFinite(meta.max) || meta.max < meta.min || meta.order !== 1) {
    throw new Error('[FUMOC Worker] Order-1 channel metadata is invalid');
  }
  const bytesPerSample = meta.bits > 8 ? 2 : 1;
  const rawBytes = ansDecodeOrder1(compressed, tableBytes, meta.length * bytesPerSample);
  let quant;
  if (meta.bits > 8) {
    const view = new DataView(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength);
    quant = new Int16Array(meta.length);
    for (let i = 0; i < meta.length; i++) {
      const zz = view.getUint16(i * 2, true);
      quant[i] = zz & 1 ? -((zz + 1) >> 1) : zz >> 1;
    }
  } else {
    quant = new Int8Array(meta.length);
    for (let i = 0; i < meta.length; i++) {
      const zz = rawBytes[i];
      quant[i] = zz & 1 ? -((zz + 1) >> 1) : zz >> 1;
    }
  }
  if (meta.delta) quant = deltaDecode(quant);
  return dequantise(quant, meta.min, meta.max, meta.bits, meta.signed);
}

// ── Quantisation ──────────────────────────────────────────────────────────────
function deltaDecode(arr) {
  const out = new arr.constructor(arr.length);
  out[0] = arr[0];
  for (let i = 1; i < arr.length; i++) out[i] = out[i-1] + arr[i];
  return out;
}

function dequantise(arr, min, max, bits, signed) {
  const levels = (1 << bits) - 1;
  const range  = max - min;
  const out    = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    const norm = signed ? (arr[i] + (levels >> 1)) / levels : arr[i] / levels;
    out[i] = min + norm * range;
  }
  return out;
}

function decodeChannel(compressed, freqBytes, meta) {
  if (!meta || !Number.isInteger(meta.length) || meta.length < 1 || meta.length > MAX_GAUSSIANS ||
      !Number.isInteger(meta.bits) || meta.bits < 1 || meta.bits > 16 ||
      !Number.isFinite(meta.min) || !Number.isFinite(meta.max) || meta.max < meta.min) {
    throw new Error('[FUMOC Worker] Channel quantization metadata is invalid');
  }
  if (meta.order === 1) throw new Error('[FUMOC Worker] Order-1 ANS is not supported by this legacy worker; use the canonical FumocDecoder.');
  const bytesPerSample = meta.bits > 8 ? 2 : 1;
  const rawBytes = ansDecode(compressed, freqBytes, meta.length * bytesPerSample);
  if (rawBytes.byteLength !== meta.length * bytesPerSample) throw new Error('[FUMOC Worker] Decoded channel length mismatch');
  let quant;
  if (meta.bits > 8) {
    const view = new DataView(rawBytes.buffer, rawBytes.byteOffset);
    quant = new Int16Array(meta.length);
    for (let i = 0; i < meta.length; i++) {
      const zz = view.getUint16(i*2, true);
      quant[i] = zz & 1 ? -((zz+1)>>1) : zz>>1;
    }
  } else {
    quant = new Int8Array(meta.length);
    for (let i = 0; i < meta.length; i++) {
      const zz = rawBytes[i];
      quant[i] = zz & 1 ? -((zz+1)>>1) : zz>>1;
    }
  }
  if (meta.delta) quant = deltaDecode(quant);
  return dequantise(quant, meta.min, meta.max, meta.bits, meta.signed);
}

// ── SPLT decoder ──────────────────────────────────────────────────────────────
function decodeSplt(spltData) {
  if (!(spltData instanceof Uint8Array) || spltData.byteLength < 8) throw new Error('[FUMOC Worker] SPLT header is truncated');
  const view = new DataView(spltData.buffer, spltData.byteOffset, spltData.byteLength);
  const N = view.getUint32(0, true);
  const nChan = view.getUint32(4, true);
  if (!Number.isInteger(N) || N < 1 || N > MAX_GAUSSIANS) throw new Error('[FUMOC Worker] SPLT point count is invalid');
  if (!Number.isInteger(nChan) || nChan < 1 || nChan > 15) throw new Error('[FUMOC Worker] SPLT channel count is invalid');
  let off = 8;
  const channels = {};
  const dec = new TextDecoder();
  const CHANNEL = {
    1:'POS_X',2:'POS_Y',3:'POS_Z',4:'SCL_X',5:'SCL_Y',6:'SCL_Z',
    7:'COL_R',8:'COL_G',9:'COL_B',10:'COL_A',
    11:'ROT_Q0',12:'ROT_Q1',13:'ROT_Q2',14:'ROT_Q3',15:'SORT'
  };
  const u32 = (offset, label) => {
    if (offset < 0 || offset + 4 > spltData.byteLength) throw new Error(`[FUMOC Worker] Truncated ${label}`);
    return view.getUint32(offset, true);
  };
  for (let c = 0; c < nChan; c++) {
    if (off >= spltData.byteLength) throw new Error('[FUMOC Worker] Channel ID is missing');
    const chanId = spltData[off++];
    const chanName = CHANNEL[chanId];
    if (!chanName) throw new Error(`[FUMOC Worker] Unsupported channel ID ${chanId}`);
    if (channels[chanName] !== undefined) throw new Error(`[FUMOC Worker] Duplicate channel ${chanName}`);
    let selected = null;
    for (const freqLen of [512, 131072]) {
      const metaLenOffset = off + freqLen;
      if (metaLenOffset + 4 > spltData.byteLength) continue;
      const candidateMetaLen = u32(metaLenOffset, 'channel metadata length');
      if (candidateMetaLen < 2 || candidateMetaLen > MAX_HEADER_BYTES ||
          metaLenOffset + 4 + candidateMetaLen + 4 > spltData.byteLength) continue;
      let candidateMeta;
      try { candidateMeta = JSON.parse(dec.decode(spltData.subarray(metaLenOffset + 4, metaLenOffset + 4 + candidateMetaLen))); }
      catch { continue; }
      if (!candidateMeta || typeof candidateMeta !== 'object' || Array.isArray(candidateMeta)) continue;
      if (freqLen === 131072 && candidateMeta.order !== 1) continue;
      if (freqLen === 512 && candidateMeta.order === 1) continue;
      selected = { freqLen, metaLen: candidateMetaLen, meta: candidateMeta };
      break;
    }
    if (!selected) throw new Error('[FUMOC Worker] Channel metadata is truncated, oversized or invalid');
    const { freqLen, metaLen, meta } = selected;
    if ((meta.order === 1 && freqLen !== 131072) || (meta.order !== 1 && freqLen !== 512)) {
      throw new Error('[FUMOC Worker] Frequency table size does not match channel order');
    }
    const freqBytes = spltData.subarray(off, off + freqLen);
    off += freqLen + 4 + metaLen;
    const compLen = u32(off, 'compressed channel length'); off += 4;
    if (compLen < 4 || compLen > MAX_SECTION_BYTES || off + compLen > spltData.byteLength) {
      throw new Error('[FUMOC Worker] Compressed channel is truncated or oversized');
    }
    const compData = spltData.subarray(off, off + compLen); off += compLen;
    if (!Number.isInteger(meta.length) || meta.length !== N) throw new Error('[FUMOC Worker] Channel length must match point count');
    const decodeAns = meta.order === 1 ? ansDecodeOrder1 : ansDecode;
    if (chanName === 'SORT') {
      const sortBytes = decodeAns(compData, freqBytes, N * 4);
      const sort = new Uint32Array(sortBytes.buffer, sortBytes.byteOffset, N);
      for (let i = 0; i < N; i++) if (sort[i] >= N) throw new Error('[FUMOC Worker] SORT index is out of range');
      channels.SORT = sort;
    } else if (chanName.startsWith('COL_') || chanName.startsWith('ROT_')) {
      channels[chanName] = decodeAns(compData, freqBytes, N);
    } else {
      channels[chanName] = meta.order === 1
        ? decodeChannelOrder1(compData, freqBytes, meta)
        : decodeChannel(compData, freqBytes, meta);
      for (let i = 0; i < N; i++) if (!Number.isFinite(channels[chanName][i])) throw new Error(`[FUMOC Worker] Channel ${chanName} has a non-finite value`);
    }
    if (channels[chanName]?.length !== N) throw new Error(`[FUMOC Worker] Channel ${chanName} decoded length mismatch`);
  }
  if (off !== spltData.byteLength) throw new Error('[FUMOC Worker] SPLT has trailing or unparsed bytes');
  return { N, channels };
}

// ── Inflate ───────────────────────────────────────────────────────────────────
async function inflate(data) {
  let reader = null;
  try {
    const ds = new DecompressionStream('deflate');
    const writer = ds.writable.getWriter();
    const writePromise = writer.write(data);
    const closePromise = writer.close();
    writePromise.catch(() => {});
    closePromise.catch(() => {});
    const chunks = [];
    let total = 0;
    reader = ds.readable.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (total + value.byteLength > MAX_SECTION_BYTES) {
        await reader.cancel('FUMOC Worker section exceeds 512 MiB').catch(() => {});
        throw new Error('[FUMOC Worker] Decompressed section exceeds the 512 MiB safety limit');
      }
      chunks.push(value); total += value.byteLength;
    }
    await Promise.all([writePromise, closePromise]);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
    return out;
  } catch (error) {
    await reader?.cancel().catch(() => {});
    if (error instanceof Error && error.message.includes('512 MiB safety limit')) throw error;
    throw new Error('[FUMOC Worker] Invalid or truncated compressed section', { cause: error });
  }
}

// ── Full .fumoc decode ────────────────────────────────────────────────────────
async function decodeFumoc(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.byteLength < 14) throw new Error('[FUMOC Worker] File header is truncated');
  if (bytes.byteLength > MAX_FILE_BYTES) throw new Error('[FUMOC Worker] File exceeds the 2 GiB safety limit');
  const magic = String.fromCharCode(...bytes.subarray(0, 6));
  if (magic !== 'FUMOC1' && magic !== 'FUMOC2') throw new Error('[FUMOC Worker] Unsupported file magic');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint16(8, true);
  if (version < 1 || version > 2) throw new Error('[FUMOC Worker] Unsupported file version');
  const headerLen = view.getUint32(10, true);
  if (headerLen > MAX_HEADER_BYTES || 14 + headerLen > bytes.byteLength) {
    throw new Error('[FUMOC Worker] Header length is invalid or truncated');
  }
  let header;
  try { header = JSON.parse(new TextDecoder().decode(bytes.subarray(14, 14 + headerLen))); }
  catch (error) { throw new Error('[FUMOC Worker] Header JSON is invalid', { cause: error }); }
  if (!header || typeof header !== 'object' || Array.isArray(header)) throw new Error('[FUMOC Worker] Header must be a JSON object');

  let off = 14 + headerLen;
  const sections = {};
  while (off < bytes.byteLength) {
    if (bytes.byteLength - off < 13) throw new Error('[FUMOC Worker] Truncated section header');
    const id = String.fromCharCode(bytes[off],bytes[off+1],bytes[off+2],bytes[off+3]);
    const flags = bytes[off+4];
    const compLen = view.getUint32(off+5, true);
    const rawLen = view.getUint32(off+9, true);
    if (flags & ~0x03) throw new Error(`[FUMOC Worker] Section ${id} has unsupported flag bits`);
    if (compLen > MAX_SECTION_BYTES || rawLen > MAX_SECTION_BYTES) throw new Error(`[FUMOC Worker] Section ${id} exceeds the safety limit`);
    if (off + 13 + compLen > bytes.byteLength) throw new Error(`[FUMOC Worker] Section ${id} is truncated`);
    if (!(flags & 0x01) && rawLen !== compLen) throw new Error(`[FUMOC Worker] Section ${id} has mismatched lengths`);
    if (sections[id]) throw new Error(`[FUMOC Worker] Duplicate section ${id}`);
    sections[id] = { flags, data: bytes.slice(off+13, off+13+compLen), compLen, rawLen };
    off += 13 + compLen;
  }

  const spltSec = sections.SPLT;
  if (!spltSec) throw new Error('[FUMOC Worker] Required SPLT section is missing');
  self.postMessage({ type: 'progress', pct: 25, label: 'Decompressing splat data...' });
  const spltData = (spltSec.flags & 0x01) ? await inflate(spltSec.data) : spltSec.data;
  if (spltData.byteLength !== spltSec.rawLen) throw new Error('[FUMOC Worker] SPLT length does not match its section header');
  if (header.splat_byte_length != null && Number(header.splat_byte_length) !== spltData.byteLength) {
    throw new Error('[FUMOC Worker] Header SPLT length does not match the decoded payload');
  }
  self.postMessage({ type: 'progress', pct: 40, label: 'Decoding Gaussian channels...' });

  let N, channels;
  if (spltData.byteLength >= 8) {
    const probe = new DataView(spltData.buffer, spltData.byteOffset, spltData.byteLength);
    const peekN = probe.getUint32(0, true);
    const peekChan = probe.getUint32(4, true);
    const isV2 = peekN > 0 && peekN <= MAX_GAUSSIANS && peekChan >= 1 && peekChan <= 15;
    if (isV2) {
      ({ N, channels } = decodeSplt(spltData));
    } else {
      if (spltData.byteLength === 0 || spltData.byteLength % SPLAT_ROW !== 0) {
        throw new Error('[FUMOC Worker] Raw SPLT payload must contain complete 32-byte rows');
      }
      N = spltData.byteLength / SPLAT_ROW;
      if (N < 1 || N > MAX_GAUSSIANS) throw new Error('[FUMOC Worker] Raw SPLT point count is invalid');
      const rawDv = new DataView(spltData.buffer, spltData.byteOffset, spltData.byteLength);
      channels = {
        POS_X: new Float32Array(N), POS_Y: new Float32Array(N), POS_Z: new Float32Array(N),
        SCL_X: new Float32Array(N), SCL_Y: new Float32Array(N), SCL_Z: new Float32Array(N),
        COL_R: new Uint8Array(N), COL_G: new Uint8Array(N), COL_B: new Uint8Array(N), COL_A: new Uint8Array(N),
        ROT_Q0: new Uint8Array(N), ROT_Q1: new Uint8Array(N), ROT_Q2: new Uint8Array(N), ROT_Q3: new Uint8Array(N),
      };
      for (let i = 0; i < N; i++) {
        const b = i * SPLAT_ROW;
        channels.POS_X[i] = rawDv.getFloat32(b, true);
        channels.POS_Y[i] = rawDv.getFloat32(b+4, true);
        channels.POS_Z[i] = rawDv.getFloat32(b+8, true);
        channels.SCL_X[i] = rawDv.getFloat32(b+12, true);
        channels.SCL_Y[i] = rawDv.getFloat32(b+16, true);
        channels.SCL_Z[i] = rawDv.getFloat32(b+20, true);
        if (![channels.POS_X[i], channels.POS_Y[i], channels.POS_Z[i], channels.SCL_X[i], channels.SCL_Y[i], channels.SCL_Z[i]].every(Number.isFinite) ||
            channels.SCL_X[i] <= 0 || channels.SCL_Y[i] <= 0 || channels.SCL_Z[i] <= 0) {
          throw new Error(`[FUMOC Worker] Raw SPLT point ${i} has invalid position or scale values`);
        }
        channels.COL_R[i] = splatData[b+24]; channels.COL_G[i] = splatData[b+25];
        channels.COL_B[i] = splatData[b+26]; channels.COL_A[i] = splatData[b+27];
        channels.ROT_Q0[i] = splatData[b+28]; channels.ROT_Q1[i] = splatData[b+29];
        channels.ROT_Q2[i] = splatData[b+30]; channels.ROT_Q3[i] = splatData[b+31];
      }
    }
  } else {
    throw new Error('[FUMOC Worker] SPLT payload is too short');
  }

  self.postMessage({ type: 'progress', pct: 80, label: `Assembling ${N.toLocaleString()} Gaussians...` });

  // Build .splat binary (32 bytes per Gaussian)
  // Apply sort index if present
  const sortIndex = channels.SORT;
  const out = new Uint8Array(N * SPLAT_ROW);
  const dv  = new DataView(out.buffer);

  for (let i = 0; i < N; i++) {
    const src = sortIndex ? sortIndex[i] : i;
    const b   = i * SPLAT_ROW;
    dv.setFloat32(b,    channels.POS_X?.[src] ?? 0, true);
    dv.setFloat32(b+4,  channels.POS_Y?.[src] ?? 0, true);
    dv.setFloat32(b+8,  channels.POS_Z?.[src] ?? 0, true);
    dv.setFloat32(b+12, channels.SCL_X?.[src] ?? -5, true);
    dv.setFloat32(b+16, channels.SCL_Y?.[src] ?? -5, true);
    dv.setFloat32(b+20, channels.SCL_Z?.[src] ?? -5, true);
    out[b+24] = channels.COL_R?.[src] ?? 128;
    out[b+25] = channels.COL_G?.[src] ?? 128;
    out[b+26] = channels.COL_B?.[src] ?? 128;
    out[b+27] = channels.COL_A?.[src] ?? 255;
    out[b+28] = channels.ROT_Q0?.[src] ?? 128;
    out[b+29] = channels.ROT_Q1?.[src] ?? 128;
    out[b+30] = channels.ROT_Q2?.[src] ?? 128;
    out[b+31] = channels.ROT_Q3?.[src] ?? 128;
  }

  // Extract thumbnail
  let thumbnail = null;
  if (sections['THUM']) {
    const thumbSection = sections['THUM'];
    thumbnail = (thumbSection.flags & 0x01) ? await inflate(thumbSection.data) : thumbSection.data;
    if (thumbnail.byteLength !== thumbSection.rawLen) throw new Error('[FUMOC Worker] Thumbnail length does not match its section header');
  }

  return { splatBinary: out, header, thumbnail, N };
}

// ── Worker message handler ────────────────────────────────────────────────────
self.onmessage = async function(e) {
  const { buffer } = e.data;
  try {
    self.postMessage({ type: 'progress', pct: 5, label: 'Reading .fumoc file...' });
    const result = await decodeFumoc(buffer);
    self.postMessage({ type: 'progress', pct: 98, label: 'Done — ' + result.N.toLocaleString() + ' Gaussians' });
    self.postMessage({
      type:        'result',
      splatBinary: result.splatBinary.buffer,
      header:      result.header,
      thumbnail:   result.thumbnail ? result.thumbnail.buffer : null,
      N:           result.N,
    }, [
      result.splatBinary.buffer,
      ...(result.thumbnail ? [result.thumbnail.buffer] : []),
    ]);
  } catch(err) {
    self.postMessage({ type: 'error', message: err.message });
  }
};
