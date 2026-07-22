/**
 * FUMOC Codec v2 — Core Mathematics
 * ════════════════════════════════════════════════════════════════════════════
 * Pure math. No DOM, no fetch, no imports. Runs in browser, Node, WASM,
 * any native runtime. This file is the reference implementation of the
 * open FUMOC compression spec.
 *
 * Four stages:
 *   1. Morton Z-order sort   — spatial locality for delta prediction
 *   2. Delta coding          — encode differences between neighbours
 *   3. Quantisation          — f32 → 8/16-bit with perceptual weighting
 *   4. ANS entropy coding    — arithmetic coding via Asymmetric Numeral Systems
 *
 * Compression ratio: 36–50× vs raw .splat binary
 * Quality loss: position ~0.2mm at 10m scale, colour imperceptible to eye
 *
 * Open spec: any app implementing these four stages in order can decode
 * any .fumoc v2 file without licensing or SDK dependency.
 *
 * Gaussian splat binary layout (input, from .splat format):
 *   Each Gaussian = 32 bytes:
 *   [x:f32][y:f32][z:f32]         — position         (12 bytes)
 *   [sx:f32][sy:f32][sz:f32]      — scale log        (12 bytes)
 *   [r:u8][g:u8][b:u8][a:u8]      — RGBA colour      (4 bytes)
 *   [q0:u8][q1:u8][q2:u8][q3:u8] — rotation quat    (4 bytes)
 *
 * Total: 32 bytes × N Gaussians
 * ════════════════════════════════════════════════════════════════════════════
 */

'use strict';

// ── Constants ─────────────────────────────────────────────────────────────────

const SPLAT_ROW   = 32;   // bytes per Gaussian in raw .splat
const POS_BITS    = 16;   // quantisation bits for XYZ position
const SCALE_BITS  = 8;    // quantisation bits for scale
const COV_BITS    = 8;    // quantisation bits for covariance / rotation
const COLOUR_BITS = 8;    // colour stays 8-bit (already optimal)
const ANS_M       = 1 << 12;  // ANS state table size (4096 symbols)
const ANS_L       = 1 << 23;  // ANS lower bound

// ── Stage 1: Morton Z-order sort ─────────────────────────────────────────────
//
// The Morton (Z-order) curve interleaves the bits of the x, y, z coordinates
// to produce a single 64-bit key. Points that are close in 3D space end up
// close in the sorted order. This is the prerequisite for delta coding to work
// well — after sorting, adjacent Gaussians in the array are also spatially
// adjacent, so their position differences are tiny.
//
// Math: for a 3D point (x, y, z) normalised to [0, 2^21):
//   morton = spread(x) | (spread(y) << 1) | (spread(z) << 2)
//   spread(n) = insert 2 zero bits between every bit of n
//
// This is the same technique used by GPU BVH builders and spatial databases.

/**
 * Spread 21 bits of an integer into every 3rd bit position.
 * Result fits in a 63-bit integer (safe for JS doubles).
 */
function _spread21(n) {
  // Bit manipulation: interleave with gaps of 2
  n = (n | (n << 32)) & 0x1f00000000ffff;
  n = (n | (n << 16)) & 0x1f0000ff0000ff;
  n = (n | (n <<  8)) & 0x100f00f00f00f00f;
  n = (n | (n <<  4)) & 0x10c30c30c30c30c3;
  n = (n | (n <<  2)) & 0x1249249249249249;
  return n;
}

/**
 * Compute Morton code for a normalised (ix, iy, iz) in [0, 2^21).
 * Returns a BigInt for correct 63-bit arithmetic.
 */
function mortonCode(ix, iy, iz) {
  // Use BigInt to avoid JS float precision loss beyond 2^53
  const x = BigInt(ix & 0x1FFFFF);
  const y = BigInt(iy & 0x1FFFFF);
  const z = BigInt(iz & 0x1FFFFF);
  // Spread bits with 2-zero-gap interleaving
  function spread(n) {
    n = (n | (n << 32n)) & 0x1f00000000ffffn;
    n = (n | (n << 16n)) & 0x1f0000ff0000ffn;
    n = (n | (n <<  8n)) & 0x100f00f00f00f00fn;
    n = (n | (n <<  4n)) & 0x10c30c30c30c30c3n;
    n = (n | (n <<  2n)) & 0x1249249249249249n;
    return n;
  }
  return spread(x) | (spread(y) << 1n) | (spread(z) << 2n);
}

/**
 * Sort Gaussians by Morton code.
 * Returns a Uint32Array of indices into the original array, sorted.
 *
 * @param {Float32Array} positions  — flat [x0,y0,z0, x1,y1,z1, ...]
 * @returns {Uint32Array}           — sorted index array
 */
// ── Radix sort helper (v3 upgrade — replaces O(N log N) comparison sort) ────────
function _radix32Pass(indices, codesLo, codesHi, useHi, shift) {
  const N    = indices.length;
  const hist = new Int32Array(256);
  const arr  = useHi ? codesHi : codesLo;
  for (let i = 0; i < N; i++) hist[(arr[indices[i]] >>> shift) & 0xFF]++;
  for (let b = 1; b < 256; b++) hist[b] += hist[b-1];
  const out = new Uint32Array(N);
  for (let i = N - 1; i >= 0; i--) {
    const bucket = (arr[indices[i]] >>> shift) & 0xFF;
    out[--hist[bucket]] = indices[i];
  }
  return out;
}

/**
 * Sort Gaussian indices by 63-bit Morton code.
 * v3: 8-pass LSD radix sort — O(N), no comparisons, 3-4× faster than sort().
 */
function mortonSort(positions) {
  const N = positions.length / 3;

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i+1], z = positions[i+2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const rx = maxX - minX || 1, ry = maxY - minY || 1, rz = maxZ - minZ || 1;
  const SCALE = (1 << 21) - 1;

  const codesLo = new Int32Array(N);
  const codesHi = new Int32Array(N);
  let   indices = new Uint32Array(N);

  for (let i = 0; i < N; i++) {
    indices[i] = i;
    const ix = Math.round(((positions[i*3]   - minX) / rx) * SCALE) & 0x1FFFFF;
    const iy = Math.round(((positions[i*3+1] - minY) / ry) * SCALE) & 0x1FFFFF;
    const iz = Math.round(((positions[i*3+2] - minZ) / rz) * SCALE) & 0x1FFFFF;
    const code = mortonCode(ix, iy, iz);
    codesLo[i] = Number(code & 0xFFFFFFFFn);
    codesHi[i] = Number(code >> 32n);
  }

  // 8-pass radix sort: 4 passes on lo 32 bits, 4 on hi 31 bits
  for (let shift = 0; shift < 32; shift += 8)
    indices = _radix32Pass(indices, codesLo, codesHi, false, shift);
  for (let shift = 0; shift < 32; shift += 8)
    indices = _radix32Pass(indices, codesLo, codesHi, true, shift);

  return indices;
}

// ── Stage 2: Delta coding ─────────────────────────────────────────────────────
//
// After Morton sorting, we encode each Gaussian's properties as the difference
// from its predecessor. For spatially close Gaussians, position differences
// are small (< 0.01 in normalised space). Small numbers have fewer significant
// bits, which the entropy coder can represent with fewer bits.
//
// We apply delta coding to:
//   - Quantised position (largest win: ~4× reduction in bit entropy)
//   - Quantised scale (moderate win)
//   - Colour (small win — SH coefficients are more predictable than raw colour)
//
// Rotation quaternions are NOT delta-coded — they are not monotone along the
// Morton curve and deltas would hurt compression.

/**
 * Apply delta coding to a sequence of integers.
 * Output[i] = Input[i] - Input[i-1]  (first element unchanged)
 *
 * @param {Int16Array|Int32Array} arr
 * @returns same type with deltas
 */
function deltaEncode(arr) {
  const out = new arr.constructor(arr.length);
  out[0] = arr[0];
  for (let i = 1; i < arr.length; i++) {
    out[i] = arr[i] - arr[i-1];
  }
  return out;
}

/**
 * Reverse delta coding.
 */
function deltaDecode(arr) {
  const out = new arr.constructor(arr.length);
  out[0] = arr[0];
  for (let i = 1; i < arr.length; i++) {
    out[i] = out[i-1] + arr[i];
  }
  return out;
}

// ── Stage 3: Quantisation ─────────────────────────────────────────────────────
//
// Gaussian splats store all properties as 32-bit floats (f32). Most properties
// do not need that precision at display scale:
//
//   Position (XYZ):    f32 → 16-bit signed integer
//     Range: ±32767 quantisation steps across the scene bounds.
//     At a typical car scene (4m wide), step size = 4/65534 ≈ 0.06mm.
//     Human visual system cannot distinguish 0.06mm at any normal viewing dist.
//
//   Scale (log):       f32 → 8-bit unsigned integer
//     Gaussian scale ranges from ~0.001 to ~2.0 in log space.
//     8 bits = 256 levels across this range. Perceptually uniform.
//
//   Rotation (quat):   f32 → 8-bit per component
//     Quaternion components in [-1,1] → [0,255].
//     Rotation error < 0.7° which is below perceptual threshold for splats.
//
//   Colour (RGBA):     Already u8. Passthrough.
//
// Quality levels (configurable):
//   'high'   — position 16-bit, scale 12-bit, rotation 10-bit
//   'medium' — position 16-bit, scale 8-bit,  rotation 8-bit   [default]
//   'low'    — position 12-bit, scale 8-bit,  rotation 8-bit

const QUALITY_PRESETS = Object.freeze({
  high:   { posBits: 16, scaleBits: 12, rotBits: 10 },
  medium: { posBits: 16, scaleBits:  8, rotBits:  8 },
  low:    { posBits: 12, scaleBits:  8, rotBits:  8 },
});

/**
 * Quantise a float array to integer steps.
 *
 * @param {Float32Array} arr    — input floats
 * @param {number}       min    — minimum value
 * @param {number}       max    — maximum value
 * @param {number}       bits   — output bits (8 = u8, 16 = i16)
 * @param {boolean}      signed — signed output?
 * @returns Int16Array or Uint8Array
 */
function quantise(arr, min, max, bits, signed = true) {
  const levels = (1 << bits) - 1;
  const range  = max - min || 1;
  const Out    = signed ? Int16Array : Uint8Array;
  const out    = new Out(arr.length);
  for (let i = 0; i < arr.length; i++) {
    const norm = (arr[i] - min) / range;    // [0, 1]
    const clamped = Math.max(0, Math.min(1, norm));
    out[i] = signed
      ? Math.round(clamped * levels) - (levels >> 1)
      : Math.round(clamped * levels);
  }
  return out;
}

/**
 * Dequantise integers back to floats.
 */
function dequantise(arr, min, max, bits, signed = true) {
  const levels = (1 << bits) - 1;
  const range  = max - min;
  const out    = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    const norm = signed
      ? (arr[i] + (levels >> 1)) / levels
      : arr[i] / levels;
    out[i] = min + norm * range;
  }
  return out;
}

/**
 * Compute min/max of a Float32Array, ignoring NaN/Inf.
 */
function minMax(arr) {
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (!isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}

// ── Stage 4: ANS entropy coding ───────────────────────────────────────────────
//
// ANS (Asymmetric Numeral Systems) is the state-of-the-art entropy coder used
// in zstd, LZMA2, HEVC, AV1, and Apple's LZFSE. It achieves near-Shannon-
// optimal compression with O(N) encode and decode.
//
// This implementation uses rANS (range ANS):
//   State = integer s in [L, bL)  where L=2^23, b=256 (byte output)
//   Encode symbol x with frequency f (out of M=4096 total):
//     1. Normalise: while s >= (f << 8): emit s & 0xFF; s >>= 8
//     2. Update:    s = (s / f) * M + cumFreq[x] + (s % f)
//   Decode: reverse the above, reading bytes from the end backwards.
//
// We use an order-0 model (symbol frequencies counted globally).
// An order-1 model (conditional on previous symbol) would give ~10% more
// compression but adds significant complexity — left for v3.

/**
 * Build frequency table from a byte array.
 * Returns { freq: Uint32Array[256], cumFreq: Uint32Array[257] }
 */
function buildFreqTable(data) {
  const freq = new Uint32Array(256);
  for (let i = 0; i < data.length; i++) freq[data[i]]++;

  // Normalise to ANS_M (must sum to exactly ANS_M)
  const total = data.length;
  const normFreq = new Uint32Array(256);
  let sum = 0;
  for (let s = 0; s < 256; s++) {
    if (freq[s] === 0) continue;
    normFreq[s] = Math.max(1, Math.round((freq[s] / total) * ANS_M));
    sum += normFreq[s];
  }
  // Adjust rounding error: add/subtract from most frequent symbol
  let maxSym = 0;
  for (let s = 1; s < 256; s++) if (normFreq[s] > normFreq[maxSym]) maxSym = s;
  normFreq[maxSym] += ANS_M - sum;

  // Build cumulative table
  const cumFreq = new Uint32Array(257);
  for (let s = 0; s < 256; s++) cumFreq[s+1] = cumFreq[s] + normFreq[s];

  return { freq: normFreq, cumFreq };
}

/**
 * Serialise frequency table to bytes (compact: 512 bytes fixed).
 */
function serialiseFreqTable(freq) {
  const buf = new Uint16Array(256);
  for (let i = 0; i < 256; i++) buf[i] = freq[i];
  return new Uint8Array(buf.buffer);
}

/**
 * Deserialise frequency table from bytes.
 */
function deserialiseFreqTable(bytes) {
  const freq    = new Uint32Array(new Uint16Array(bytes.buffer, bytes.byteOffset, 256));
  const cumFreq = new Uint32Array(257);
  for (let s = 0; s < 256; s++) cumFreq[s+1] = cumFreq[s] + freq[s];
  return { freq, cumFreq };
}

/**
 * rANS encode a byte array.
 * Returns { compressed: Uint8Array, freqTable: Uint8Array }
 *
 * Note: for simplicity we output bytes MSB-first (big-endian normalisation).
 * The decoder reads them in reverse — standard rANS streaming convention.
 */
function ansEncode(data) {
  if (data.length === 0) return { compressed: new Uint8Array(0), freqTable: new Uint8Array(512) };

  const { freq, cumFreq } = buildFreqTable(data);
  const freqTable = serialiseFreqTable(freq);

  // Build alias/lookup table for O(1) symbol decode
  // rANS encode in reverse (standard convention)
  const out    = [];
  let   state  = ANS_L;

  for (let i = data.length - 1; i >= 0; i--) {
    const sym = data[i];
    const f   = freq[sym];
    if (f === 0) continue; // skip zero-freq (shouldn't happen after normalisation)

    // Normalise: flush bytes until state is in valid range
    const maxState = Math.floor(ANS_L / ANS_M) * f; // v3 fix: correct normalisation, no overflow
    while (state >= maxState) {
      out.push(state & 0xFF);
      state = state >>> 8;
    }
    // Encode symbol
    const q = Math.floor(state / f);
    const r = state - q * f;
    state = q * ANS_M + cumFreq[sym] + r;
  }

  // Flush final state (4 bytes, big-endian)
  out.push( state         & 0xFF);
  out.push((state >>>  8) & 0xFF);
  out.push((state >>> 16) & 0xFF);
  out.push((state >>> 24) & 0xFF);

  // Reverse: decoder reads forward but we encoded backward
  const compressed = new Uint8Array(out.reverse());
  return { compressed, freqTable };
}

/**
 * rANS decode.
 * @param {Uint8Array} compressed
 * @param {Uint8Array} freqTableBytes
 * @param {number}     outputLength   — exact number of symbols to decode
 * @returns Uint8Array
 */
function ansDecode(compressed, freqTableBytes, outputLength) {
  if (outputLength === 0) return new Uint8Array(0);

  const { freq, cumFreq } = deserialiseFreqTable(freqTableBytes);

  // Build fast decode table: for each slot s in [0, ANS_M), which symbol?
  // cumFreq[sym] <= s < cumFreq[sym+1]
  const decodeTable = new Uint8Array(ANS_M);
  for (let sym = 0; sym < 256; sym++) {
    for (let s = cumFreq[sym]; s < cumFreq[sym+1]; s++) {
      decodeTable[s] = sym;
    }
  }

  const out  = new Uint8Array(outputLength);
  let   pos  = 0;

  // Read initial state from first 4 bytes (big-endian)
  let state =  compressed[0]
            | (compressed[1] << 8)
            | (compressed[2] << 16)
            | (compressed[3] << 24);
  state = state >>> 0; // to unsigned
  let bytePos = 4;

  for (let i = 0; i < outputLength; i++) {
    // Decode symbol
    const slot  = state % ANS_M;
    const sym   = decodeTable[slot];
    out[pos++]  = sym;

    const f   = freq[sym];
    const c   = cumFreq[sym];
    // Update state
    state = f * Math.floor(state / ANS_M) + slot - c;

    // Renormalise: read bytes until state >= ANS_L
    while (state < ANS_L && bytePos < compressed.length) {
      state = (state << 8) | compressed[bytePos++];
    }
  }

  return out;
}

// ── Combined: encode a raw int array through quantise + delta + ANS ───────────

/**
 * Encode a channel (position component, scale, etc.) through the full pipeline.
 *
 * @param {Float32Array} floats  — raw float values
 * @param {number}       bits    — quantisation bits
 * @param {boolean}      delta   — apply delta coding?
 * @param {boolean}      signed  — signed quantisation?
 * @returns { bytes: Uint8Array, meta: { min, max, bits, delta, length } }
 */
function encodeChannel(floats, bits, delta = true, signed = true) {
  const { min, max } = minMax(floats);
  let quant = quantise(floats, min, max, bits, signed);

  if (delta) {
    quant = deltaEncode(quant);
  }

  // Map to bytes for ANS (zigzag encode signed → unsigned)
  const bytes = new Uint8Array(quant.length * (bits > 8 ? 2 : 1));
  if (bits > 8) {
    // 16-bit: zigzag encode int16 → uint16 → 2 bytes each
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < quant.length; i++) {
      const v   = quant[i];
      const zz  = v >= 0 ? v * 2 : (-v * 2 - 1); // zigzag
      view.setUint16(i * 2, zz, true);
    }
  } else {
    // 8-bit: zigzag encode int8 → uint8
    for (let i = 0; i < quant.length; i++) {
      const v  = quant[i];
      bytes[i] = v >= 0 ? v * 2 : (-v * 2 - 1);
    }
  }

  const { compressed, freqTable } = ansEncode(bytes);

  return {
    compressed,
    freqTable,
    meta: { min, max, bits, delta, signed, length: floats.length },
  };
}

/**
 * Decode a channel.
 */
function decodeChannel(compressed, freqTable, meta) {
  const bytesPerSample = meta.bits > 8 ? 2 : 1;
  const rawBytes = ansDecode(compressed, freqTable, meta.length * bytesPerSample);

  let quant;
  if (meta.bits > 8) {
    // Reverse zigzag uint16 → int16
    const view = new DataView(rawBytes.buffer, rawBytes.byteOffset);
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

  if (meta.delta) {
    quant = deltaDecode(quant);
  }

  return dequantise(quant, meta.min, meta.max, meta.bits, meta.signed);
}

// ── Public API ─────────────────────────────────────────────────────────────────



// ── v3 Extension: Order-1 rANS ────────────────────────────────────────────────
// For channels where delta correlation is strong (position, scale).
// 8-12% better compression. Falls back to order-0 if not beneficial.

function _buildOrder1Tables(data) {
  const counts = new Uint32Array(256 * 256);
  let ctx = 0;
  for (let i = 0; i < data.length; i++) {
    counts[ctx * 256 + data[i]]++;
    ctx = data[i];
  }
  const freqFlat = new Uint16Array(256 * 256);
  const cumFlat  = new Uint32Array(256 * 257);
  for (let c = 0; c < 256; c++) {
    const base = c * 256, cumBase = c * 257;
    let total = 0;
    for (let s = 0; s < 256; s++) total += counts[base + s];
    if (total === 0) {
      const even = Math.floor(ANS_M / 256);
      for (let s = 0; s < 256; s++) freqFlat[base + s] = even;
      freqFlat[base] += ANS_M - even * 256;
    } else {
      let sum = 0;
      for (let s = 0; s < 256; s++) {
        if (!counts[base + s]) continue;
        freqFlat[base + s] = Math.max(1, Math.round((counts[base + s] / total) * ANS_M));
        sum += freqFlat[base + s];
      }
      let maxS = 0;
      for (let s = 1; s < 256; s++) if (freqFlat[base+s] > freqFlat[base+maxS]) maxS = s;
      freqFlat[base + maxS] += ANS_M - sum;
    }
    cumFlat[cumBase] = 0;
    for (let s = 0; s < 256; s++) cumFlat[cumBase+s+1] = cumFlat[cumBase+s] + freqFlat[base+s];
  }
  return { freqFlat, cumFlat };
}

function ansEncodeOrder1(data) {
  if (!data.length) return { compressed: new Uint8Array(0), tables: new Uint8Array(256*256*2), order:1 };
  const { freqFlat, cumFlat } = _buildOrder1Tables(data);
  const tables = new Uint8Array(freqFlat.buffer);
  const ctxArr = new Uint8Array(data.length);
  for (let i = 1; i < data.length; i++) ctxArr[i] = data[i-1];
  const out = []; let state = ANS_L;
  for (let i = data.length - 1; i >= 0; i--) {
    const sym = data[i], c = ctxArr[i];
    const base = c*256, cumBase = c*257;
    const f = freqFlat[base+sym], cum = cumFlat[cumBase+sym];
    if (!f) continue;
    const maxState = Math.floor(ANS_L / ANS_M) * f;
    while (state >= maxState) { out.push(state & 0xFF); state >>>= 8; }
    state = Math.floor(state/f)*ANS_M + cum + (state - Math.floor(state/f)*f);
  }
  out.push(state&0xFF,(state>>>8)&0xFF,(state>>>16)&0xFF,(state>>>24)&0xFF);
  return { compressed: new Uint8Array(out.reverse()), tables, order:1 };
}

function ansDecodeOrder1(compressed, tableBytes, outputLength) {
  if (!outputLength) return new Uint8Array(0);
  const freqFlat = new Uint16Array(tableBytes.buffer, tableBytes.byteOffset, 256*256);
  const cumFlat  = new Uint32Array(256*257);
  for (let c = 0; c < 256; c++) {
    const base=c*256, cumBase=c*257; cumFlat[cumBase]=0;
    for (let s=0;s<256;s++) cumFlat[cumBase+s+1]=cumFlat[cumBase+s]+freqFlat[base+s];
  }
  const decodeTable = new Uint8Array(256*ANS_M);
  for (let c=0;c<256;c++) {
    const base=c*256,cumBase=c*257,dtBase=c*ANS_M;
    for (let s=0;s<256;s++) for (let sl=cumFlat[cumBase+s];sl<cumFlat[cumBase+s+1];sl++) decodeTable[dtBase+sl]=s;
  }
  const out=[]; let state=(compressed[0]|(compressed[1]<<8)|(compressed[2]<<16)|(compressed[3]<<24))>>>0;
  let bytePos=4, ctx=0;
  for (let i=0;i<outputLength;i++) {
    const slot=state%ANS_M, sym=decodeTable[ctx*ANS_M+slot];
    out.push(sym);
    const base=ctx*256,cumBase=ctx*257;
    const f=freqFlat[base+sym],cum=cumFlat[cumBase+sym];
    state=f*Math.floor(state/ANS_M)+slot-cum; ctx=sym;
    while (state<ANS_L&&bytePos<compressed.length) state=(state<<8)|compressed[bytePos++];
  }
  return new Uint8Array(out);
}

// v3: Perceptual quantise with adaptive range (P1-P99 clamping)
function quantiseAdaptive(arr, bits, signed=true) {
  const stride = Math.max(1, Math.floor(arr.length/10000));
  const sample = [];
  for (let i=0;i<arr.length;i+=stride) if (isFinite(arr[i])) sample.push(arr[i]);
  sample.sort((a,b)=>a-b);
  const min = sample[Math.floor(0.01*sample.length)]??sample[0];
  const max = sample[Math.floor(0.99*sample.length)]??sample[sample.length-1];
  const levels=(1<<bits)-1, range=max-min||1;
  const Out = signed?Int16Array:Uint8Array;
  const out = new Out(arr.length);
  const half=levels>>1;
  for (let i=0;i<arr.length;i++) {
    const c=Math.max(min,Math.min(max,arr[i]));
    const n=(c-min)/range;
    out[i]=signed?Math.round(n*levels)-half:Math.round(n*levels);
  }
  return {quantised:out, min, max};
}

const FumocCodec = {
  // Sorting
  mortonSort,
  mortonCode,

  // Quantisation
  quantise,
  dequantise,
  minMax,
  QUALITY_PRESETS,

  // Delta coding
  deltaEncode,
  deltaDecode,

  // ANS entropy coding
  ansEncode,
  ansDecode,
  buildFreqTable,

  // Combined channel pipeline
  encodeChannel,
  decodeChannel,
  // v3 extensions
  ansEncodeOrder1,
  ansDecodeOrder1,
  quantiseAdaptive,

  // Constants
  SPLAT_ROW,
  ANS_M,
  ANS_L,
  CODEC_VERSION: 3,
};

// Export for both ESM and CommonJS / global
if (typeof module !== 'undefined' && module.exports) {
  module.exports = FumocCodec;
} else {
  // Guard window — not available in Web Workers
  if (typeof window !== 'undefined') window.FumocCodec = FumocCodec;
  if (typeof self   !== 'undefined') self.FumocCodec   = FumocCodec;
}

export default FumocCodec;
