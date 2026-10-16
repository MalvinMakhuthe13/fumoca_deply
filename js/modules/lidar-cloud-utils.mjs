import { serializePlyCoordinateMetadata } from './lidar-coordinate-metadata.mjs';

export function downsample(cloud, maxPoints = 800_000) {
  if (!Number.isSafeInteger(maxPoints) || maxPoints < 1) {
    throw new RangeError('maxPoints must be a positive safe integer.');
  }
  if (!cloud || !Number.isSafeInteger(cloud.count) || cloud.count < 0 ||
      !cloud.positions || cloud.positions.length < cloud.count * 3) {
    throw new TypeError('Point cloud has an invalid count or position buffer.');
  }
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
