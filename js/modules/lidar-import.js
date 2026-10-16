import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { parseXYZ } from './lidar-text-parser.mjs';

/**
 * FUMOCA LiDAR / dense point import
 *
 * Browser-side: ASCII/binary PLY + XYZ/CSV point dumps.
 * Full LAS/LAZ → queue to worker (same pattern as video jobs) when available.
 *
 * Integrity boundary: this module imports and preserves point-cloud data.
 * It does NOT register LiDAR to cameras/Gaussians or fuse it into training.
 * Coordinate units/CRS must remain explicitly unknown unless verified.
 */

/**
 * Minimal ASCII PLY reader (x y z [red green blue] [nx ny nz]).
 */
export function parseAsciiPLY(text) {
  const lines = text.split(/\r?\n/);
  let i = 0;
  let vertexCount = 0;
  const props = [];

  if (!lines[0] || !lines[0].includes('ply')) {
    throw new Error('Not a PLY file');
  }

  for (; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('element vertex')) {
      vertexCount = parseInt(line.split(/\s+/).pop(), 10);
    } else if (line.startsWith('property')) {
      props.push(line.split(/\s+/).pop());
    } else if (line === 'end_header') {
      i++;
      break;
    }
  }

  const ix = props.indexOf('x');
  const iy = props.indexOf('y');
  const iz = props.indexOf('z');
  if (ix < 0 || iy < 0 || iz < 0) throw new Error('PLY missing x/y/z');

  const ir = props.indexOf('red') >= 0 ? props.indexOf('red') : props.indexOf('r');
  const ig = props.indexOf('green') >= 0 ? props.indexOf('green') : props.indexOf('g');
  const ib = props.indexOf('blue') >= 0 ? props.indexOf('blue') : props.indexOf('b');
  const hasColor = ir >= 0 && ig >= 0 && ib >= 0;

  const positions = new Float32Array(vertexCount * 3);
  const colors = hasColor ? new Float32Array(vertexCount * 3) : null;

  let v = 0;
  for (; i < lines.length && v < vertexCount; i++) {
    const t = lines[i].trim();
    if (!t) continue;
    const parts = t.split(/\s+/).map(Number);
    positions[v * 3] = parts[ix];
    positions[v * 3 + 1] = parts[iy];
    positions[v * 3 + 2] = parts[iz];
    if (hasColor) {
      const scale = parts[ir] > 1 ? 1 / 255 : 1;
      colors[v * 3] = parts[ir] * scale;
      colors[v * 3 + 1] = parts[ig] * scale;
      colors[v * 3 + 2] = parts[ib] * scale;
    }
    v++;
  }

  return { positions, colors, count: v, source: 'ply' };
}

/**
 * Detect format from filename + content and parse.
 */
export async function importPointCloud(file) {
  const name = (file.name || '').toLowerCase();
  const buf = await file.arrayBuffer();
  if (name.endsWith('.laz')) {
    throw new Error('Compressed LAZ files need to be converted to LAS or PLY before import. Uncompressed LAS is supported here.');
  }
  if (name.endsWith('.las')) {
    return parseLAS(buf);
  }
  if (name.endsWith('.ply')) {
    const geometry = new PLYLoader().parse(buf);
    const position = geometry.getAttribute('position');
    if (!position) throw new Error('PLY file has no vertex positions.');
    const color = geometry.getAttribute('color');
    const intensityAttr = geometry.getAttribute('intensity');
    const classificationAttr = geometry.getAttribute('classification');
    const returnAttr = geometry.getAttribute('return_number') || geometry.getAttribute('returnNumber');
    let intensities = null;
    if (intensityAttr) {
      intensities = new Uint16Array(position.count);
      let maxIntensity = 0;
      for (let i = 0; i < position.count; i++) maxIntensity = Math.max(maxIntensity, Number(intensityAttr.array[i]) || 0);
      for (let i = 0; i < position.count; i++) {
        const value = Number(intensityAttr.array[i]) || 0;
        intensities[i] = Math.round(maxIntensity <= 1 ? value * 65535 : value);
      }
    }
    const colors = color ? new Float32Array(position.count * 3) : null;
    if (color) {
      for (let i = 0; i < position.count; i++) {
        for (let c = 0; c < 3; c++) colors[i * 3 + c] = color.array[i * color.itemSize + c];
      }
    }
    return {
      positions: new Float32Array(position.array), colors,
      intensities,
      classifications: classificationAttr ? new Uint8Array(classificationAttr.array) : null,
      returnNumbers: returnAttr ? new Uint8Array(returnAttr.array) : null,
      count: position.count, source: 'ply',
    };
  }
  const text = new TextDecoder().decode(buf);
  if (name.endsWith('.xyz') || name.endsWith('.txt') || name.endsWith('.csv')) {
    return parseXYZ(text);
  }

  // Heuristic: if first non-empty line has 3+ numbers → XYZ
  try {
    return parseXYZ(text);
  } catch {
    throw new Error('Unsupported point format. Use PLY, XYZ, or CSV (x y z [r g b]).');
  }
}

/** Parse uncompressed LAS 1.2–1.4 records, with a memory-safe point cap. */
export function parseLAS(buffer, maxPoints = 1_000_000) {
  const view = new DataView(buffer);
  if (buffer.byteLength < 227 || String.fromCharCode(...new Uint8Array(buffer, 0, 4)) !== 'LASF') {
    throw new Error('This does not look like a valid LAS file.');
  }
  const pointOffset = view.getUint32(96, true);
  const rawFormat = view.getUint8(104);
  if (rawFormat & 0x80) throw new Error('This LAS file uses LAZ compression. Convert it to uncompressed LAS or PLY first.');
  if (rawFormat & 0xc0) throw new Error('This LAS file uses point-record compression or reserved format bits. Convert it to uncompressed LAS or PLY first.');
  const format = rawFormat & 0x3f;
  const minimumRecordLength = ({0:20, 1:28, 2:26, 3:34, 4:57, 5:63, 6:30, 7:36, 8:38, 9:59, 10:67})[format];
  if (minimumRecordLength == null) throw new Error(`Unsupported LAS point format: ${format}`);
  const recordLength = view.getUint16(105, true);
  if (recordLength < minimumRecordLength) throw new Error(`LAS point format ${format} requires records of at least ${minimumRecordLength} bytes; file declares ${recordLength}.`);
  let total = view.getUint32(107, true);
  if (view.getUint8(24) === 1 && view.getUint8(25) >= 4 && buffer.byteLength >= 255) {
    const extended = Number(view.getBigUint64(247, true));
    if (extended > 0) total = extended;
  }
  if (!total || pointOffset < 227 || pointOffset >= buffer.byteLength) throw new Error('LAS header has no readable point records.');
  const recordCount = Math.min(total, Math.floor((buffer.byteLength - pointOffset) / recordLength));
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

/**
 * Downsample for browser safety (max points).
 */
export function downsample(cloud, maxPoints = 800_000) {
  if (cloud.count <= maxPoints) return cloud;
  const step = Math.ceil(cloud.count / maxPoints);
  const n = Math.ceil(cloud.count / step);
  const positions = new Float32Array(n * 3);
  const colors = cloud.colors ? new Float32Array(n * 3) : null;
  const intensities = cloud.intensities ? new cloud.intensities.constructor(n) : null;
  const classifications = cloud.classifications ? new Uint8Array(n) : null;
  const returnNumbers = cloud.returnNumbers ? new Uint8Array(n) : null;
  let j = 0;
  for (let i = 0; i < cloud.count; i += step) {
    positions[j * 3] = cloud.positions[i * 3];
    positions[j * 3 + 1] = cloud.positions[i * 3 + 1];
    positions[j * 3 + 2] = cloud.positions[i * 3 + 2];
    if (colors) {
      colors[j * 3] = cloud.colors[i * 3];
      colors[j * 3 + 1] = cloud.colors[i * 3 + 1];
      colors[j * 3 + 2] = cloud.colors[i * 3 + 2];
    }
    if (intensities) intensities[j] = cloud.intensities[i];
    if (classifications) classifications[j] = cloud.classifications[i];
    if (returnNumbers) returnNumbers[j] = cloud.returnNumbers[i];
    j++;
  }
  return {
    positions, colors, intensities, classifications, returnNumbers, count: j,
    source: cloud.source + '+downsampled',
    sourcePointCount: cloud.sourcePointCount || cloud.count,
    // Preserve source coordinate/calibration claims across downsampling.
    coordinateMetadata: cloud.coordinateMetadata || null,
  };
}

/** Encode an imported point cloud as binary PLY for direct Studio loading. */
export function encodePointCloudPLY(cloud) {
  const count = Math.min(cloud?.count || 0, Math.floor((cloud?.positions?.length || 0) / 3));
  if (count < 3) throw new Error('The LiDAR file must contain at least 3 valid points.');
  const hasIntensity = !!cloud.intensities;
  const hasClassification = !!cloud.classifications;
  const hasReturnNumber = !!cloud.returnNumbers;
  const properties = [
    'property float x', 'property float y', 'property float z',
    'property uchar red', 'property uchar green', 'property uchar blue',
    ...(hasIntensity ? ['property ushort intensity'] : []),
    ...(hasClassification ? ['property uchar classification'] : []),
    ...(hasReturnNumber ? ['property uchar return_number'] : []),
  ];
  const header = [
    'ply', 'format binary_little_endian 1.0', `element vertex ${count}`,
    ...properties,
    'end_header', '',
  ].join('\n');
  const headerBytes = new TextEncoder().encode(header);
  const recordSize = 15 + (hasIntensity ? 2 : 0) + (hasClassification ? 1 : 0) + (hasReturnNumber ? 1 : 0);
  const output = new Uint8Array(headerBytes.length + count * recordSize);
  output.set(headerBytes);
  const view = new DataView(output.buffer, headerBytes.length);
  for (let i = 0; i < count; i++) {
    const at = i * recordSize, p = i * 3;
    view.setFloat32(at, cloud.positions[p], true);
    view.setFloat32(at + 4, cloud.positions[p + 1], true);
    view.setFloat32(at + 8, cloud.positions[p + 2], true);
    for (let c = 0; c < 3; c++) {
      const color = cloud.colors?.[p + c] ?? 0.72;
      view.setUint8(at + 12 + c, Math.round(Math.min(1, Math.max(0, color)) * 255));
    }
    let extraAt = at + 15;
    if (hasIntensity) {
      const rawIntensity = Number(cloud.intensities[i]) || 0;
      view.setUint16(extraAt, Math.round(Math.max(0, Math.min(65535, rawIntensity))), true);
      extraAt += 2;
    }
    if (hasClassification) { view.setUint8(extraAt, cloud.classifications[i]); extraAt++; }
    if (hasReturnNumber) view.setUint8(extraAt, cloud.returnNumbers[i]);
  }
  return output;
}

/**
 * Attach to studio UI: file input + status.
 */
export function mountLidarImport({ dropEl, onCloud, onStatus } = {}) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.ply,.xyz,.txt,.csv,.las,.laz';
  input.style.display = 'none';
  document.body.appendChild(input);

  async function handle(file) {
    onStatus?.(`Reading ${file.name}…`);
    try {
      let cloud = await importPointCloud(file);
      if (cloud.deferred) {
        onStatus?.(cloud.message);
        onCloud?.(cloud);
        return;
      }
      cloud = downsample(cloud);
      cloud.filename = file.name;
      cloud.originalFile = file;
      onStatus?.(`Loaded ${cloud.count.toLocaleString()} points (${cloud.source}${cloud.sourcePointCount ? `, sampled from ${cloud.sourcePointCount.toLocaleString()}` : ''})`);
      onCloud?.(cloud);
    } catch (err) {
      onStatus?.(err.message || String(err));
      console.error('[lidar]', err);
    }
  }

  input.addEventListener('change', () => {
    const f = input.files?.[0];
    if (f) handle(f);
    input.value = '';
  });

  if (dropEl) {
    dropEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropEl.classList.add('drag');
    });
    dropEl.addEventListener('dragleave', () => dropEl.classList.remove('drag'));
    dropEl.addEventListener('drop', (e) => {
      e.preventDefault();
      dropEl.classList.remove('drag');
      const f = e.dataTransfer?.files?.[0];
      if (f) handle(f);
    });
  }

  return {
    openPicker: () => input.click(),
    importPointCloud,
    downsample,
  };
}

if (typeof window !== 'undefined') {
  window.FUMOCA_LidarImport = { importPointCloud, parseLAS, parseXYZ, parseAsciiPLY, downsample, encodePointCloudPLY, mountLidarImport };
}
