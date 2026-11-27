/**
 * FUMOCA LiDAR preflight report.
 *
 * Inspired by LichtFeld Studio's discovery-first workflow: inspect the data and
 * available attributes before allowing downstream actions. This module reports
 * facts and cautions only; it never upgrades a point cloud into a metric,
 * registered, or reconstruction-grade asset.
 */
export function buildLidarQualityReport(cloud) {
  if (!cloud || !Number.isSafeInteger(cloud.count) || cloud.count < 0 ||
      !cloud.positions || cloud.positions.length < cloud.count * 3) {
    throw new TypeError('Cannot inspect LiDAR data: invalid point count or position buffer.');
  }

  const finitePoints = countFinitePoints(cloud.positions, cloud.count);
  const attributes = {
    rgb: hasAligned(cloud.colors, cloud.count * 3),
    intensity: hasAligned(cloud.intensities, cloud.count),
    classification: hasAligned(cloud.classifications, cloud.count),
    returnNumber: hasAligned(cloud.returnNumbers, cloud.count),
  };
  const metadata = cloud.coordinateMetadata && typeof cloud.coordinateMetadata === 'object'
    ? cloud.coordinateMetadata : null;
  const sourcePoints = Number.isSafeInteger(cloud.sourcePointCount) && cloud.sourcePointCount >= cloud.count
    ? cloud.sourcePointCount : cloud.count;
  const sampled = sourcePoints > cloud.count;
  const localCoordinates = metadata?.positionCoordinates === 'local_relative_to_render_origin';

  const warnings = [];
  if (finitePoints !== cloud.count) warnings.push({
    code: 'NON_FINITE_COORDINATES',
    severity: 'error',
    message: `${cloud.count - finitePoints} point(s) have non-finite coordinates.`,
  });
  if (sampled) warnings.push({
    code: 'DOWNSAMPLED',
    severity: 'info',
    message: `Preview uses ${cloud.count.toLocaleString()} of ${sourcePoints.toLocaleString()} source points.`,
  });
  if (!attributes.rgb) warnings.push({
    code: 'RGB_MISSING',
    severity: 'info',
    message: 'RGB colour is absent; preview colour may use a neutral fallback.',
  });
  if (!attributes.intensity) warnings.push({
    code: 'INTENSITY_MISSING',
    severity: 'info',
    message: 'Intensity is not present in this file; intensity display is unavailable.',
  });
  if (!attributes.classification) warnings.push({
    code: 'CLASSIFICATION_MISSING',
    severity: 'info',
    message: 'Classification is not present in this file; classification display is unavailable.',
  });
  if (!attributes.returnNumber) warnings.push({
    code: 'RETURN_NUMBER_MISSING',
    severity: 'info',
    message: 'Return-number data is not present in this file; return display is unavailable.',
  });
  if (!metadata?.crs || String(metadata.crs).startsWith('unknown')) warnings.push({
    code: 'CRS_UNKNOWN',
    severity: 'warning',
    message: 'Coordinate reference system is unknown or was not parsed.',
  });
  if (!metadata?.units || metadata.units === 'unknown') warnings.push({
    code: 'UNITS_UNKNOWN',
    severity: 'warning',
    message: 'Coordinate units are unverified. Do not report real-world dimensions yet.',
  });
  if (localCoordinates && !isFiniteOrigin(metadata?.renderOrigin)) warnings.push({
    code: 'ORIGIN_MISSING',
    severity: 'error',
    message: 'Cloud uses local coordinates but has no valid render origin.',
  });
  if (metadata?.metricScaleVerified !== true) warnings.push({
    code: 'METRIC_SCALE_UNVERIFIED',
    severity: 'warning',
    message: 'Metric scale has not been independently verified.',
  });

  const errors = warnings.filter(item => item.severity === 'error');
  const canPreview = finitePoints >= 3 && errors.length === 0;
  return {
    status: canPreview ? 'ready_with_cautions' : 'blocked',
    pointCount: cloud.count,
    sourcePointCount: sourcePoints,
    finitePointCount: finitePoints,
    sampled,
    attributes,
    coordinateMetadata: metadata,
    warnings,
    gates: {
      preview: canPreview,
      merge: canPreview && cloud.count >= 3,
      metricMeasurement: metadata?.metricScaleVerified === true &&
        !!metadata?.crs && metadata?.crs !== 'unknown_not_parsed' &&
        !!metadata?.units && metadata?.units !== 'unknown',
      gaussianFusion: false,
    },
  };
}

function hasAligned(values, expectedLength) {
  return values != null && Number.isSafeInteger(values.length) && values.length >= expectedLength;
}

function countFinitePoints(positions, count) {
  let finite = 0;
  for (let i = 0; i < count; i++) {
    if (Number.isFinite(positions[i * 3]) &&
        Number.isFinite(positions[i * 3 + 1]) &&
        Number.isFinite(positions[i * 3 + 2])) finite++;
  }
  return finite;
}

function isFiniteOrigin(origin) {
  return !!origin && ['x', 'y', 'z'].every(axis => Number.isFinite(origin[axis]));
}

export function formatLidarQualitySummary(report) {
  if (!report || typeof report !== 'object') throw new TypeError('A LiDAR quality report is required.');
  const present = Object.entries(report.attributes || {}).filter(([, available]) => available).map(([key]) => key);
  const missing = Object.entries(report.attributes || {}).filter(([, available]) => !available).map(([key]) => key);
  const summary = [
    `Points: ${Number(report.pointCount || 0).toLocaleString()}`,
    `Attributes: ${present.length ? present.join(', ') : 'none detected'}`,
  ];
  if (missing.length) summary.push(`Missing attributes: ${missing.join(', ')}`);
  summary.push(report.gates?.metricMeasurement
    ? 'Metric scale: verified'
    : 'Metric scale: NOT verified (do not trust dimensions)');
  summary.push(report.gates?.gaussianFusion
    ? 'Gaussian fusion: available'
    : 'Gaussian fusion: not performed');
  return summary.join(' · ');
}
