/**
 * FUMOC File Format — v1.0
 * ════════════════════════════════════════════════════════════════════════════
 *
 * .fumoc is a compressed, self-contained container format for Gaussian splats.
 * It bundles everything needed to view, share, and interact with a splat into
 * a single portable file:
 *
 *   [MAGIC 8B][VERSION 2B][HEADER_LEN 4B][HEADER JSON][SECTIONS...]
 *
 * Each SECTION:
 *   [SECTION_ID 4B][FLAGS 1B][COMPRESSED_LEN 4B][RAW_LEN 4B][DATA...]
 *
 * Section IDs (ASCII 4-char):
 *   "SPLT" — Gaussian splat binary data (compressed)
 *   "META" — JSON metadata (title, description, created, author, mode)
 *   "TOUR" — Tour stops JSON array
 *   "HOTS" — Hotspots JSON array
 *   "THUM" — Thumbnail image (JPEG bytes)
 *   "MOTN" — Motion states JSON
 *   "CAMR" — Saved camera positions JSON
 *   "BRND" — Branding / whitelabel config JSON
 *
 * Compression: zlib deflate via CompressionStream (browser native, no deps).
 * Flag byte bit 0 = is_compressed. Other bits reserved.
 *
 * Design goals:
 *   - No external dependencies (browser APIs only)
 *   - Works with .ply, .splat, .ksplat source files
 *   - Importable by any app that implements this spec
 *   - Small: a typical car splat (8MB .splat) compresses to ~5.5MB .fumoc
 *   - Self-describing: open the HEADER and you know everything without parsing
 *     the splat binary
 *   - Social-ready: THUM section means any app can show a preview without
 *     loading the 3D data
 *
 * ════════════════════════════════════════════════════════════════════════════
 */

const MAGIC         = 'FUMOC1\0\0'; // 8 bytes, last 2 are padding
const VERSION       = 2; // v2 uses fumoc-codec.js; v1 files still read via this module
const SECTION_SPLT  = 'SPLT';
const SECTION_META  = 'META';
const SECTION_TOUR  = 'TOUR';
const SECTION_HOTS  = 'HOTS';
const SECTION_THUM  = 'THUM';
const SECTION_MOTN  = 'MOTN';
const SECTION_CAMR  = 'CAMR';
const SECTION_BRND  = 'BRND';

const FLAG_COMPRESSED = 0x01;
const MAX_FUMOC_HEADER_BYTES = 1024 * 1024;
const MAX_FUMOC_SECTION_BYTES = 512 * 1024 * 1024;
const MAX_FUMOC_FILE_BYTES = 2 * 1024 * 1024 * 1024;

// ── Utility: text encode/decode ──────────────────────────────────────────────

const enc = new TextEncoder();
const dec = new TextDecoder();

function strToBytes(s) { return enc.encode(s); }
function bytesToStr(b) { return dec.decode(b); }

function fourCC(s) {
  const b = new Uint8Array(4);
  for (let i = 0; i < 4; i++) b[i] = s.charCodeAt(i) & 0xff;
  return b;
}

// ── Compression ──────────────────────────────────────────────────────────────

async function compress(data) {
  try {
    const cs = new CompressionStream('deflate');
    const writer = cs.writable.getWriter();
    writer.write(data instanceof Uint8Array ? data : new Uint8Array(data));
    writer.close();
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
  } catch {
    // CompressionStream not available (old browser) — return uncompressed
    return data instanceof Uint8Array ? data : new Uint8Array(data);
  }
}

async function decompress(data) {
  let reader = null;
  try {
    const ds = new DecompressionStream('deflate');
    const writer = ds.writable.getWriter();
    const writePromise = writer.write(data);
    const closePromise = writer.close();
    // Attach handlers immediately so a cancelled oversized stream cannot
    // leave unhandled writer rejections behind.
    writePromise.catch(() => {});
    closePromise.catch(() => {});
    const chunks = [];
    let total = 0;
    reader = ds.readable.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (total + value.byteLength > MAX_FUMOC_SECTION_BYTES) {
        await reader.cancel('FUMOC decompressed section exceeds 512 MiB').catch(() => {});
        throw new Error('[FUMOC] Decompressed section exceeds the 512 MiB safety limit');
      }
      chunks.push(value);
      total += value.byteLength;
    }
    await Promise.all([writePromise, closePromise]);
    const out = new Uint8Array(total);
    let off = 0;
    for (const chunk of chunks) { out.set(chunk, off); off += chunk.byteLength; }
    return out;
  } catch (error) {
    await reader?.cancel().catch(() => {});
    if (error instanceof Error && error.message.includes('512 MiB safety limit')) throw error;
    throw new Error('[FUMOC] Invalid or truncated compressed section', { cause: error });
  }
}

// ── Low-level section builder ────────────────────────────────────────────────

async function buildSection(id, rawData, shouldCompress = true) {
  const raw = rawData instanceof Uint8Array ? rawData : new Uint8Array(rawData);
  if (raw.byteLength > MAX_FUMOC_SECTION_BYTES) {
    throw new Error('[FUMOC] Section exceeds the 512 MiB safety limit');
  }
  let payload = raw;
  let flags = 0;

  if (shouldCompress && raw.length > 512) {
    const compressed = await compress(raw);
    // Only use compression if it actually helps
    if (compressed.length < raw.length * 0.98) {
      payload = compressed;
      flags |= FLAG_COMPRESSED;
    }
  }

  // Section layout: [4B id][1B flags][4B compressed_len][4B raw_len][data]
  const header = new Uint8Array(13);
  const dv = new DataView(header.buffer);
  header.set(fourCC(id), 0);
  header[4] = flags;
  dv.setUint32(5, payload.length, true);
  dv.setUint32(9, raw.length, true);

  const section = new Uint8Array(13 + payload.length);
  section.set(header, 0);
  section.set(payload, 13);
  return section;
}

async function readSection(view, offset, decodePayload = true) {
  if (!Number.isInteger(offset) || offset < 0 || offset + 13 > view.byteLength) {
    throw new Error('[FUMOC] Truncated section header');
  }
  const id = String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3)
  );
  const flags = view.getUint8(offset + 4);
  const compLen = view.getUint32(offset + 5, true);
  const rawLen = view.getUint32(offset + 9, true);
  if (flags & ~FLAG_COMPRESSED) throw new Error(`[FUMOC] Section ${id} uses unsupported flag bits`);
  const isCompressed = !!(flags & FLAG_COMPRESSED);
  if (compLen > MAX_FUMOC_SECTION_BYTES || rawLen > MAX_FUMOC_SECTION_BYTES) {
    throw new Error(`[FUMOC] Section ${id} exceeds the 512 MiB safety limit`);
  }
  if (offset + 13 + compLen > view.byteLength) throw new Error(`[FUMOC] Section ${id} is truncated`);
  if (!isCompressed && rawLen !== compLen) {
    throw new Error(`[FUMOC] Uncompressed section ${id} has mismatched lengths`);
  }

  let data = new Uint8Array(view.buffer, view.byteOffset + offset + 13, compLen);
  if (isCompressed && decodePayload) data = await decompress(data);
  if (decodePayload && data.byteLength !== rawLen) {
    throw new Error(`[FUMOC] Section ${id} decoded length does not match its header`);
  }
  return { id, flags, compLen, rawLen, isCompressed, data, totalBytes: 13 + compLen };
}

function parseFileHeader(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 14) {
    throw new Error('[FUMOC] File is shorter than its 14-byte header');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = bytesToStr(bytes.subarray(0, 8));
  if (!magic.startsWith('FUMOC')) throw new Error('[FUMOC] Not a .fumoc file');
  const version = view.getUint16(8, true);
  if (version < 1 || version > VERSION) throw new Error(`[FUMOC] Unsupported file version ${version}`);
  const headerLen = view.getUint32(10, true);
  if (headerLen > MAX_FUMOC_HEADER_BYTES || 14 + headerLen > bytes.byteLength) {
    throw new Error('[FUMOC] Header length is invalid, truncated or exceeds 1 MiB');
  }
  let header;
  try {
    header = JSON.parse(bytesToStr(bytes.subarray(14, 14 + headerLen)));
  } catch (error) {
    throw new Error('[FUMOC] Header JSON is invalid', { cause: error });
  }
  if (!header || typeof header !== 'object' || Array.isArray(header)) {
    throw new Error('[FUMOC] Header must be a JSON object');
  }
  return { version, header, dataOffset: 14 + headerLen };
}

// ── ENCODER (public) ─────────────────────────────────────────────────────────

/**
 * encode(payload) → ArrayBuffer
 *
 * payload = {
 *   splatBuffer:   ArrayBuffer | Uint8Array  (required — the .splat/.ply binary)
 *   meta:          Object                    (title, description, mode, author, …)
 *   tour:          Array                     (tour stops from tour-builder.js)
 *   hotspots:      Array                     (hotspot records)
 *   thumbnail:     Uint8Array | null         (JPEG bytes of the thumbnail)
 *   motionStates:  Object | null
 *   cameras:       Array | null
 *   branding:      Object | null
 * }
 */
async function encode(payload) {
  const {
    splatBuffer,
    meta          = {},
    tour          = [],
    hotspots      = [],
    thumbnail     = null,
    motionStates  = null,
    cameras       = null,
    branding      = null,
  } = payload;

  if (!splatBuffer) throw new Error('[FUMOC] splatBuffer is required');

  const splatBytes = splatBuffer instanceof Uint8Array
    ? splatBuffer
    : new Uint8Array(splatBuffer);
  if (splatBytes.byteLength < 1 || splatBytes.byteLength > MAX_FUMOC_SECTION_BYTES) {
    throw new Error('[FUMOC] SPLT section must be non-empty and no larger than 512 MiB');
  }

  // Build full header JSON (before sections, describes everything)
  const fullMeta = {
    ...meta,
    fumoc_version: VERSION,
    created: meta.created || new Date().toISOString(),
    splat_byte_length: splatBytes.length,
    has_tour: tour.length > 0,
    has_hotspots: hotspots.length > 0,
    has_thumbnail: !!thumbnail,
    has_motion: !!motionStates,
    has_cameras: !!cameras,
    has_branding: !!branding,
  };
  const headerJson = strToBytes(JSON.stringify(fullMeta));
  if (headerJson.byteLength > MAX_FUMOC_HEADER_BYTES) {
    throw new Error('[FUMOC] Header metadata exceeds the 1 MiB safety limit');
  }

  // Build all sections in parallel where possible
  const sections = await Promise.all([
    buildSection(SECTION_SPLT, splatBytes,       true),
    buildSection(SECTION_META, strToBytes(JSON.stringify(meta)), true),
    ...(tour.length      ? [buildSection(SECTION_TOUR, strToBytes(JSON.stringify(tour)), true)]    : []),
    ...(hotspots.length  ? [buildSection(SECTION_HOTS, strToBytes(JSON.stringify(hotspots)), true)] : []),
    ...(thumbnail        ? [buildSection(SECTION_THUM, thumbnail, true)]                            : []),
    ...(motionStates     ? [buildSection(SECTION_MOTN, strToBytes(JSON.stringify(motionStates)), true)] : []),
    ...(cameras          ? [buildSection(SECTION_CAMR, strToBytes(JSON.stringify(cameras)), true)]   : []),
    ...(branding         ? [buildSection(SECTION_BRND, strToBytes(JSON.stringify(branding)), true)]  : []),
  ]);

  // File layout: [8B magic][2B version][4B header_len][header_json][sections…]
  const magicBytes   = strToBytes(MAGIC).slice(0, 8);
  const versionBytes = new Uint8Array([VERSION & 0xff, (VERSION >> 8) & 0xff]);
  const headerLen    = new Uint8Array(4);
  new DataView(headerLen.buffer).setUint32(0, headerJson.length, true);

  const totalLen = 8 + 2 + 4 + headerJson.length + sections.reduce((n, s) => n + s.length, 0);
  if (!Number.isSafeInteger(totalLen) || totalLen > MAX_FUMOC_FILE_BYTES) {
    throw new Error('[FUMOC] Encoded file exceeds the 2 GiB safety limit');
  }
  const out = new Uint8Array(totalLen);
  let off = 0;

  out.set(magicBytes,   off); off += 8;
  out.set(versionBytes, off); off += 2;
  out.set(headerLen,    off); off += 4;
  out.set(headerJson,   off); off += headerJson.length;
  for (const s of sections) { out.set(s, off); off += s.length; }

  return out.buffer;
}

// ── DECODER (public) ─────────────────────────────────────────────────────────

/**
 * decode(buffer) → { header, sections: { SPLT, META, TOUR, HOTS, THUM, … } }
 *
 * Sections are returned as their natural JS types:
 *   SPLT → Uint8Array  (raw splat binary, ready for the viewer)
 *   THUM → Uint8Array  (JPEG bytes, create a Blob URL to use as <img> src)
 *   everything else → parsed JSON (objects / arrays)
 */
async function decode(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.byteLength > MAX_FUMOC_FILE_BYTES) throw new Error('[FUMOC] File exceeds the 2 GiB safety limit');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const { version, header, dataOffset } = parseFileHeader(bytes);
  header._version = version;

  let offset = dataOffset;
  const sections = {};
  while (offset < bytes.byteLength) {
    if (bytes.byteLength - offset < 13) throw new Error('[FUMOC] Trailing bytes do not form a complete section header');
    const section = await readSection(view, offset);
    if (sections[section.id] !== undefined) throw new Error(`[FUMOC] Duplicate section ${section.id}`);

    if (section.id === SECTION_SPLT || section.id === SECTION_THUM) {
      sections[section.id] = section.data;
    } else {
      try {
        sections[section.id] = JSON.parse(bytesToStr(section.data));
      } catch {
        sections[section.id] = section.data;
      }
    }
    offset += section.totalBytes;
  }

  if (!(sections[SECTION_SPLT] instanceof Uint8Array) || sections[SECTION_SPLT].byteLength === 0) {
    throw new Error('[FUMOC] Required SPLT section is missing or empty');
  }
  if (header.splat_byte_length != null &&
      (!Number.isSafeInteger(Number(header.splat_byte_length)) ||
       Number(header.splat_byte_length) !== sections[SECTION_SPLT].byteLength)) {
    throw new Error('[FUMOC] Header splat_byte_length does not match the decoded SPLT section');
  }
  return { header, sections, version };
}

// ── QUICK HELPERS (public) ────────────────────────────────────────────────────

/**
 * readHeader(buffer) — reads only the header JSON without parsing sections.
 * Useful for showing a preview card without loading the full 3D data.
 */
function readHeader(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return parseFileHeader(bytes).header;
}

/**
 * thumbnailURL(buffer) — extracts the THUM section and returns a blob URL.
 * Caller must revoke it when done.
 */
async function thumbnailURL(buffer) {
  const { sections } = await decode(buffer);
  if (!sections[SECTION_THUM]) return null;
  return URL.createObjectURL(new Blob([sections[SECTION_THUM]], { type: 'image/jpeg' }));
}

/**
 * fromSplatRecord(splatRecord, splatArrayBuffer, extras)
 * Convenience builder that converts an existing Fumoca splat DB record
 * directly into a .fumoc file.
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
    location:    record.metadata?.location || null,
    source_app:  'FUMOCA',
    source_version: 'v80',
  };

  const hotspots    = record.metadata?.hotspots    || [];
  const tour        = record.metadata?.tourStops   || [];
  const motionStates = record.metadata?.motionStates || null;
  const cameras     = record.metadata?.savedCameras || null;
  const branding    = extras.branding || record.metadata?.whitelabel || null;

  let thumbnail = null;
  if (extras.thumbnailBuffer) {
    thumbnail = extras.thumbnailBuffer instanceof Uint8Array
      ? extras.thumbnailBuffer
      : new Uint8Array(extras.thumbnailBuffer);
  }

  return encode({
    splatBuffer: splatArrayBuffer,
    meta,
    tour,
    hotspots,
    thumbnail,
    motionStates,
    cameras,
    branding,
  });
}

/**
 * loadIntoViewer(fumocBuffer) — decodes a .fumoc file and loads it into the
 * active Fumoca viewer (window.S + window._fumocaRenderer).
 * Returns the decoded header for the caller to update UI.
 */
async function loadIntoViewer(fumocBuffer) {
  const { header, sections } = await decode(fumocBuffer);

  const splatBytes = sections[SECTION_SPLT];
  if (!splatBytes) throw new Error('[FUMOC] No splat section found');

  // Store decoded metadata where the viewer can access it
  if (sections[SECTION_TOUR])  window._fumocaTourStops    = sections[SECTION_TOUR];
  if (sections[SECTION_HOTS])  window._fumocaHotspots     = sections[SECTION_HOTS];
  if (sections[SECTION_MOTN])  window._fumocaMotionStates = sections[SECTION_MOTN];
  if (sections[SECTION_CAMR])  window._fumocaSavedCameras = sections[SECTION_CAMR];
  if (sections[SECTION_BRND])  window._fumocaBranding     = sections[SECTION_BRND];

  // Create a blob URL for the splat binary and trigger load
  const splatBlob = new Blob([splatBytes], { type: 'application/octet-stream' });
  const splatUrl  = URL.createObjectURL(splatBlob);

  // Dispatch custom event so the viewer module can pick it up
  window.dispatchEvent(new CustomEvent('fumoc:load', {
    detail: { splatUrl, header, sections },
  }));

  return { header, sections, splatUrl };
}

// ── File download helper ─────────────────────────────────────────────────────

function downloadFumoc(buffer, filename = 'scene.fumoc') {
  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename.endsWith('.fumoc') ? filename : filename + '.fumoc';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 3000);
}

// ── File size estimate ───────────────────────────────────────────────────────

function estimateSize(splatByteLength) {
  // Empirical: splat data compresses ~30-35%, metadata ~70%
  const estimatedMB = ((splatByteLength * 0.68) / 1048576).toFixed(1);
  return `~${estimatedMB} MB`;
}

// ── Public API ────────────────────────────────────────────────────────────────

const FumocFormat = {
  encode,
  decode,
  readHeader,
  thumbnailURL,
  fromSplatRecord,
  loadIntoViewer,
  downloadFumoc,
  estimateSize,
  SECTIONS: { SPLT: SECTION_SPLT, META: SECTION_META, TOUR: SECTION_TOUR,
              HOTS: SECTION_HOTS, THUM: SECTION_THUM, MOTN: SECTION_MOTN,
              CAMR: SECTION_CAMR, BRND: SECTION_BRND },
  VERSION,
  MAGIC,
};

// v82: loadIntoViewer now routes through FumocDecoder for v2 files
// FumocDecoder is imported separately and handles both v1 and v2
window.FumocFormat = FumocFormat;
export default FumocFormat;
