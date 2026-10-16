/**
 * Pure uncompressed LAS parser; isolated from browser/Three.js code for fixture tests.
 * This reads LAS point records only. CRS VLR/WKT is not decoded and units remain unknown.
 */
/** Parse uncompressed LAS 1.2–1.4 records, with a memory-safe point cap. */
export function parseLAS(buffer, maxPoints = 1_000_000) {
  if (!(buffer instanceof ArrayBuffer)) throw new TypeError('LAS input must be an ArrayBuffer.');
  if (!Number.isSafeInteger(maxPoints) || maxPoints < 1) throw new RangeError('maxPoints must be a positive safe integer.');
  const view = new DataView(buffer);
  if (buffer.byteLength < 227 || String.fromCharCode(...new Uint8Array(buffer, 0, 4)) !== 'LASF') {
    throw new Error('This does not look like a valid LAS file.');
  }
  const versionMajor = view.getUint8(24), versionMinor = view.getUint8(25);
  if (versionMajor !== 1 || versionMinor < 2 || versionMinor > 4) {
    throw new Error(`Unsupported LAS version: ${versionMajor}.${versionMinor}`);
  }
  const headerSize = view.getUint16(94, true);
  const minimumHeaderSize = versionMinor >= 4 ? 375 : 227;
  if (headerSize < minimumHeaderSize || headerSize > buffer.byteLength) {
    throw new Error(`LAS ${versionMajor}.${versionMinor} header size is invalid or truncated.`);
  }
  const pointOffset = view.getUint32(96, true);
  if (pointOffset < headerSize || pointOffset > buffer.byteLength) {
    throw new Error('LAS point data offset is outside the valid file range.');
  }
  const rawFormat = view.getUint8(104);
  if (rawFormat & 0x80) throw new Error('This LAS file uses LAZ compression. Convert it to uncompressed LAS or PLY first.');
  if (rawFormat & 0xc0) throw new Error('This LAS file uses point-record compression or reserved format bits. Convert it to uncompressed LAS or PLY first.');
  const format = rawFormat & 0x3f;
  const minimumRecordLength = ({0:20, 1:28, 2:26, 3:34, 4:57, 5:63, 6:30, 7:36, 8:38, 9:59, 10:67})[format];
  if (minimumRecordLength == null) throw new Error(`Unsupported LAS point format: ${format}`);
  const recordLength = view.getUint16(105, true);
  if (recordLength < minimumRecordLength) throw new Error(`LAS point format ${format} requires records of at least ${minimumRecordLength} bytes; file declares ${recordLength}.`);
  let total = view.getUint32(107, true);
  if (versionMinor >= 4 && buffer.byteLength >= 255) {
    const extended = Number(view.getBigUint64(247, true));
    if (extended > 0) total = extended;
  }
  if (!total || pointOffset >= buffer.byteLength) throw new Error('LAS header has no readable point records.');
  const availableRecords = Math.floor((buffer.byteLength - pointOffset) / recordLength);
  if (total > availableRecords) {
    throw new Error(`LAS declares ${total} point records but only ${availableRecords} complete records are available; file may be truncated.`);
  }
  const recordCount = total;
  if (!recordCount) throw new Error('LAS file contains no point records.');
  const stride = Math.max(1, Math.ceil(recordCount / maxPoints));
  const count = Math.ceil(recordCount / stride);
  const positions = new Float32Array(count * 3);
  const intensities = new Uint16Array(count);
  const classifications = new Uint8Array(count);
  const returnNumbers = new Uint8Array(count);
  const colorOffset = ({2:20, 3:28, 5:28, 7:30, 8:30, 10:30})[format];
  const colors = colorOffset != null && recordLength >= colorOffset + 6 ? new Float32Array(count * 3) : null;
  const sx = view.getFloat64(131, true), sy = view.getFloat64(139, true), sz = view.getFloat64(147, true);
  const ox = view.getFloat64(155, true), oy = view.getFloat64(163, true), oz = view.getFloat64(171, true);
  if (![sx, sy, sz].every(Number.isFinite) || [sx, sy, sz].some(value => value === 0) ||
      ![ox, oy, oz].every(Number.isFinite)) {
    throw new Error('LAS coordinate scale/offset values are invalid.');
  }
  const classificationOffset = format >= 6 ? 16 : 15;
  const returnMask = format >= 6 ? 0x0f : 0x07;
  let out = 0;
  for (let i = 0; i < recordCount; i += stride) {
    const at = pointOffset + i * recordLength;
    positions[out * 3] = view.getInt32(at, true) * sx + ox;
    positions[out * 3 + 1] = view.getInt32(at + 4, true) * sy + oy;
    positions[out * 3 + 2] = view.getInt32(at + 8, true) * sz + oz;
    intensities[out] = view.getUint16(at + 12, true);
    classifications[out] = view.getUint8(at + classificationOffset);
    const returnBits = view.getUint8(at + 14);
    returnNumbers[out] = returnBits & returnMask;
    if (colors) {
      for (let c = 0; c < 3; c++) colors[out * 3 + c] = view.getUint16(at + colorOffset + c * 2, true) / 65535;
    }
    out++;
  }
  return {
    positions, colors, intensities, classifications, returnNumbers,
    count: out, source: `las-format-${format}`, sourcePointCount: total,
    // LAS scale/offset are retained, but CRS VLR/WKT and units are not decoded here.
    // Never interpret these coordinates as metres or claim survey accuracy by default.
    coordinateMetadata: {
      source: 'LAS',
      pointFormat: format,
      scale: { x: sx, y: sy, z: sz },
      offset: { x: ox, y: oy, z: oz },
      crs: 'unknown_not_parsed',
      units: 'unknown',
      metricScaleVerified: false,
    },
  };
}
