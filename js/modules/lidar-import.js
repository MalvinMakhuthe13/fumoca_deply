import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { parseXYZ } from './lidar-text-parser.mjs';
import { parseLAS } from './lidar-las-parser.mjs';
import { parsePlyCoordinateMetadata, serializePlyCoordinateMetadata } from './lidar-coordinate-metadata.mjs';

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
    const headerProbe = new TextDecoder().decode(buf.slice(0, Math.min(buf.byteLength, 65536)));
    const plyHeader = headerProbe.split(/\r?\nend_header\r?\n/, 1)[0];
    const coordinateMetadata = parsePlyCoordinateMetadata(plyHeader);
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
      coordinateMetadata,
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
    ...(cloud.coordinateMetadata ? [serializePlyCoordinateMetadata(cloud.coordinateMetadata)].filter(Boolean) : []),
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
