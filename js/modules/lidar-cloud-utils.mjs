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
