const SH_C0 = 0.28209479177387814;

function canonicalProperties(coefficientCount) {
  if (!Number.isInteger(coefficientCount) || coefficientCount < 3) return null;
  const degree = Math.round(Math.sqrt(coefficientCount / 3) - 1);
  if (degree < 0 || 3 * (degree + 1) ** 2 !== coefficientCount) return null;
  return {
    degree,
    properties: [
      'f_dc_0', 'f_dc_1', 'f_dc_2',
      ...Array.from({ length: coefficientCount - 3 }, (_, i) => `f_rest_${i}`),
    ],
  };
}

/**
 * Compact the editor's retained Gaussian SH values to match a filtered,
 * alive-only point list. Supports the renderer's interleaved Float32Array
 * layout and the per-property typed arrays returned by PLYLoader.
 *
 * Painted points receive updated DC coefficients and zero higher-order bands,
 * matching the Studio's Gaussian PLY export policy. Unpainted coefficients are
 * preserved exactly. Invalid/incomplete SH layouts fail closed.
 */
export function compactGaussianSHSidecar({
  indices,
  attributes,
  coefficients,
  pointCount,
  paintColors = null,
  colors = null,
}) {
  if (!Array.isArray(attributes) || !attributes.length) return null;
  if (!Array.isArray(indices)) {
    throw new Error('[nif-sh-sidecar] compact indices must be an array');
  }
  if (!coefficients) {
    throw new Error('[nif-sh-sidecar] SH attributes exist but coefficient values are unavailable; refusing lossy NIF export');
  }
  if (!Number.isInteger(pointCount) || pointCount < 1 || indices.length < 1 ||
      indices.some(i => !Number.isInteger(i) || i < 0 || i >= pointCount) ||
      new Set(indices).size !== indices.length) {
    throw new Error('[nif-sh-sidecar] invalid source point count or compact index');
  }
  const descriptor = canonicalProperties(attributes.length);
  if (!descriptor || attributes.some((name, i) => name !== descriptor.properties[i])) {
    throw new Error('[nif-sh-sidecar] unsupported or non-contiguous Gaussian SH property layout; refusing lossy NIF export');
  }
  const valueCount = indices.length * attributes.length;
  if (!Number.isSafeInteger(valueCount) || 8 + valueCount * 4 > 512 * 1024 * 1024) {
    throw new Error('[nif-sh-sidecar] compacted SH sidecar exceeds the 512 MiB safety limit');
  }
  const flat = ArrayBuffer.isView(coefficients);
  if (flat) {
    if (!(coefficients instanceof Float32Array) || coefficients.length !== pointCount * attributes.length) {
      throw new Error('[nif-sh-sidecar] interleaved SH values must be Float32Array data matching source geometry');
    }
  } else {
    for (const name of attributes) {
      if (!(coefficients[name] instanceof Float32Array) || coefficients[name].length !== pointCount) {
        throw new Error(`[nif-sh-sidecar] property ${name} does not match source geometry`);
      }
    }
  }
  const hasPaint = !!paintColors && indices.some(sourceIndex =>
    [0, 1, 2].some(c => paintColors[sourceIndex * 3 + c] >= 0));
  if (flat && !hasPaint && indices.length === pointCount &&
      indices.every((sourceIndex, row) => sourceIndex === row)) {
    for (let i = 0; i < coefficients.length; i++) {
      if (!Number.isFinite(coefficients[i])) {
        throw new Error(`[nif-sh-sidecar] non-finite coefficient at flat index ${i}`);
      }
    }
    return {
      version: 1,
      degree: descriptor.degree,
      pointCount: indices.length,
      coefficientCount: attributes.length,
      values: coefficients,
    };
  }
  const values = new Float32Array(valueCount);
  for (let row = 0; row < indices.length; row++) {
    const sourceIndex = indices[row];
    const paintOffset = sourceIndex * 3;
    const painted = !!paintColors && [0, 1, 2].some(c => paintColors[paintOffset + c] >= 0);
    for (let j = 0; j < attributes.length; j++) {
      let value;
      if (painted && j >= 3) {
        value = 0;
      } else if (painted && j < 3) {
        const channel = j;
        const paint = paintColors?.[paintOffset + channel];
        const color = Math.max(0, Math.min(1, paint >= 0 ? paint : (colors?.[paintOffset + channel] ?? 0.7)));
        value = (color - 0.5) / SH_C0;
      } else {
        value = flat ? coefficients[sourceIndex * attributes.length + j] : coefficients[attributes[j]][sourceIndex];
      }
      if (!Number.isFinite(value)) {
        throw new Error(`[nif-sh-sidecar] non-finite coefficient at source point ${sourceIndex}, property ${attributes[j]}`);
      }
      values[row * attributes.length + j] = value;
    }
  }
  return {
    version: 1,
    degree: descriptor.degree,
    pointCount: indices.length,
    coefficientCount: attributes.length,
    values,
  };
}

export function gaussianSHMetadata(sidecar, attributes) {
  if (!sidecar) return null;
  const descriptor = canonicalProperties(sidecar.coefficientCount);
  if (!descriptor || descriptor.degree !== sidecar.degree ||
      !Array.isArray(attributes) || attributes.length !== sidecar.coefficientCount ||
      attributes.some((name, i) => name !== descriptor.properties[i])) {
    throw new Error('[nif-sh-sidecar] metadata does not match the encoded sidecar');
  }
  return {
    degree: sidecar.degree,
    properties: [...attributes],
    coefficient_count: sidecar.coefficientCount,
  };
}
