/**
 * Describe Gaussian PLY attributes that the CPU-only NIF bridge preserves.
 * The canonical 14-float geometry stores render-ready DC color; exact f_dc_*
 * and f_rest_* source coefficients are preserved in the optional GAUSSIAN_SH
 * sidecar so a NIF round-trip does not silently destroy SH data.
 */
export function inspectPlyAttributes(attributeNames = [], isGaussianPly = false) {
  const names = Array.from(attributeNames);
  const higherOrderShAttributes = names.filter(name => /^f_rest_\d+$/.test(name));
  const count = higherOrderShAttributes.length;
  const restIndices = higherOrderShAttributes.map(name => Number(name.slice(7))).sort((a, b) => a - b);
  const restIndicesContiguous = restIndices.every((index, position) => index === position);
  const candidate = count > 0 && count % 3 === 0
    ? Math.round(Math.sqrt(count / 3 + 1) - 1)
    : -1;
  const detectedShDegree = count === 0 ? 0
    : candidate >= 1 && 3 * ((candidate + 1) ** 2 - 1) === count
      ? candidate
      : 0;

  if (!isGaussianPly) {
    return {
      detectedShDegree: 0,
      higherOrderShCount: count,
      hasUnsupportedShLayout: false,
      discardedAttributes: [],
      qualityFlags: ['point_cloud_not_gaussian', 'mesh_reconstruction_not_run'],
    };
  }

  return {
    detectedShDegree,
    higherOrderShCount: count,
    hasUnsupportedShLayout: count > 0 && (detectedShDegree === 0 || !restIndicesContiguous),
    discardedAttributes: [],
    qualityFlags: count
      ? ['higher_order_sh_preserved_in_nif_sidecar']
      : [],
  };
}
