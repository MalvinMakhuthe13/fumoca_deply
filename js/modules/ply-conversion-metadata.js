/**
 * Describe Gaussian PLY attributes that survive FUMOCA's CPU-only NIF bridge.
 * Higher-order SH coefficients are not representable in the current 14-float
 * NIF geometry payload, so conversions must disclose when those fields exist.
 */
export function inspectPlyAttributes(attributeNames = [], isGaussianPly = false) {
  const names = Array.from(attributeNames);
  const higherOrderShAttributes = names.filter(name => /^f_rest_\d+$/.test(name));
  const count = higherOrderShAttributes.length;
  const candidate = count > 0 && count % 3 === 0
    ? Math.round(Math.sqrt(count / 3 + 1) - 1)
    : -1;
  const detectedShDegree = candidate >= 1 && 3 * ((candidate + 1) ** 2 - 1) === count
    ? candidate
    : 0;

  if (!isGaussianPly) {
    return {
      detectedShDegree: 0,
      higherOrderShCount: count,
      discardedAttributes: [],
      qualityFlags: ['point_cloud_not_gaussian', 'mesh_reconstruction_not_run'],
    };
  }

  return {
    detectedShDegree,
    higherOrderShCount: count,
    discardedAttributes: count
      ? ['higher-order spherical-harmonic colour coefficients (f_rest_*)']
      : [],
    qualityFlags: count
      ? ['higher_order_sh_discarded_colour_approximation']
      : [],
  };
}
