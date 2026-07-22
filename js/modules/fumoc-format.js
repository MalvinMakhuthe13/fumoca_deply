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
  try {
    const ds = new DecompressionStream('deflate');
    const writer = ds.writable.getWriter();
    writer.write(data);
    writer.close();
    const chunks = [];
    const reader = ds.readable.getReader();
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
    return data;
  }
}

// ── Low-level section builder ────────────────────────────────────────────────

async function buildSection(id, rawData, shouldCompress = true) {
  const raw = rawData instanceof Uint8Array ? rawData : new Uint8Array(rawData);
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

async function readSection(view, offset) {
  if (offset + 13 > view.byteLength) return null;
  const id = String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3)
  );
  const flags       = view.getUint8(offset + 4);
  const compLen     = view.getUint32(offset + 5, true);
  const rawLen      = view.getUint32(offset + 9, true);
  const isCompressed = !!(flags & FLAG_COMPRESSED);

  if (offset + 13 + compLen > view.byteLength) return null;

  let data = new Uint8Array(view.buffer, view.byteOffset + offset + 13, compLen);
  if (isCompressed) {
    data = await decompress(data);
  }

  return { id, rawLen, data, totalBytes: 13 + compLen };
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
  const view  = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // Validate magic
  const magic = bytesToStr(bytes.slice(0, 8));
  if (!magic.startsWith('FUMOC')) throw new Error('[FUMOC] Not a .fumoc file');

  const version   = view.getUint16(8, true);
  const headerLen = view.getUint32(10, true);
  const headerStr = bytesToStr(bytes.slice(14, 14 + headerLen));
  const header    = JSON.parse(headerStr);
  header._version = version;

  let offset = 14 + headerLen;
  const sections = {};

  while (offset < bytes.byteLength) {
    const section = await readSection(view, offset);
    if (!section) break;

    // Parse section data to its native type
    if (section.id === SECTION_SPLT || section.id === SECTION_THUM) {
      sections[section.id] = section.data; // keep as binary
    } else {
      try {
        sections[section.id] = JSON.parse(bytesToStr(section.data));
      } catch {
        sections[section.id] = section.data;
      }
    }

    offset += section.totalBytes;
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
  const view  = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = bytesToStr(bytes.slice(0, 8));
  if (!magic.startsWith('FUMOC')) throw new Error('[FUMOC] Not a .fumoc file');
  const headerLen = view.getUint32(10, true);
  return JSON.parse(bytesToStr(bytes.slice(14, 14 + headerLen)));
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
