/**
 * Canonical mesh-component contract shared by browser density extraction,
 * oriented-surfel worker NIF output, Studio editing and NIF persistence.
 *
 * This is connected-surface identity, not semantic object recognition.
 */
function asFloat32(source, label) {
  if (!source || typeof source.length !== 'number' || source.length % 3) {
    throw new TypeError(label + ' must be a flat xyz array');
  }
  const values = source instanceof Float32Array ? source : Float32Array.from(source);
  for (const value of values) if (!Number.isFinite(value)) throw new Error(label + ' contains a non-finite value');
  return values;
}

function asUint32(source, label) {
  if (!source || typeof source.length !== 'number' || source.length % 3) {
    throw new TypeError(label + ' must contain triangle indices');
  }
  for (const raw of source) {
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
      throw new Error(label + ' contains an invalid uint32 index');
    }
  }
  return source instanceof Uint32Array ? source : Uint32Array.from(source);
}

export function normalizeMeshComponent(input) {
  if (!input || typeof input !== 'object') throw new TypeError('mesh component must be an object');
  const id = String(input.id ?? '').trim();
  if (!id || new TextEncoder().encode(id).byteLength > 255) throw new Error('mesh component ID must contain 1–255 UTF-8 bytes');
  const vertices = asFloat32(input.vertices ?? input.positions, 'mesh component vertices');
  const triangles = asUint32(input.triangles ?? input.faces, 'mesh component triangles');
  if (vertices.length < 9 || triangles.length < 3) throw new Error('mesh component must contain at least one triangle');
  const vertexCount = vertices.length / 3;
  for (const index of triangles) if (index >= vertexCount) throw new RangeError('mesh component triangle index is outside its vertex array');

  const rawColours = input.colours ?? input.colors ?? null;
  let colours = null;
  if (rawColours != null) {
    if (typeof rawColours.length !== 'number' || rawColours.length !== vertices.length) {
      throw new Error('mesh component colour count must match its vertex count');
    }
    if (rawColours instanceof Uint8Array) colours = rawColours;
    else {
      colours = new Uint8Array(rawColours.length);
      for (let i = 0; i < rawColours.length; i++) {
        const value = Number(rawColours[i]);
        if (!Number.isFinite(value) || value < 0 || value > 255) throw new Error('mesh component colours must be bytes in [0,255]');
        colours[i] = Math.round(value);
      }
    }
  }

  const rawGaussianIds = input.gaussianIds == null ? [] : Array.from(input.gaussianIds, Number);
  const seenGaussianIds = new Set();
  for (const gaussianId of rawGaussianIds) {
    if (!Number.isInteger(gaussianId) || gaussianId < 1 || gaussianId > 0xffffffff || seenGaussianIds.has(gaussianId)) {
      throw new Error('mesh component Gaussian membership contains an invalid or duplicate identity');
    }
    seenGaussianIds.add(gaussianId);
  }
  const gaussianIds = input.gaussianIds instanceof Uint32Array ? input.gaussianIds : Uint32Array.from(rawGaussianIds);
  return {
    id,
    vertices,
    triangles,
    colours,
    watertight: input.watertight === true,
    visible: input.visible !== false,
    selected: input.selected === true,
    supportSurfaceCandidate: input.supportSurfaceCandidate === true,
    diagnostics: input.diagnostics ?? input.stats ?? null,
    parentIds: [...new Set((input.parentIds || []).map(String))],
    gaussianIds,
    geometrySource: input.geometrySource || 'gaussian-derived',
    provenance: input.provenance && typeof input.provenance === 'object' ? input.provenance : null,
  };
}

export function normalizeMeshComponents(components) {
  if (!Array.isArray(components)) throw new TypeError('mesh components must be an array');
  const ids = new Set();
  return components.map(component => {
    const normalized = normalizeMeshComponent(component);
    if (ids.has(normalized.id)) throw new Error('mesh component IDs must be unique');
    ids.add(normalized.id);
    return normalized;
  });
}

/**
 * Build a legacy-compatible combined mesh view without changing the
 * independently editable component records. Hidden components can be omitted
 * from print/library exports while the NIF compatibility mesh keeps all parts.
 */
export function combineMeshComponents(components, { visibleOnly = false } = {}) {
  const items = normalizeMeshComponents(components || []).filter(component =>
    !visibleOnly || component.visible !== false);
  let vertexCount = 0, faceIndexCount = 0, hasColours = false;
  for (const component of items) {
    vertexCount += component.vertices.length / 3;
    faceIndexCount += component.triangles.length;
    hasColours ||= !!component.colours;
  }
  if (vertexCount > 0xffffffff) throw new RangeError('combined mesh exceeds uint32 vertex indexing');
  const vertices = new Float32Array(vertexCount * 3);
  const triangles = new Uint32Array(faceIndexCount);
  const colours = hasColours ? new Uint8Array(vertexCount * 3) : null;
  let vertexOffset = 0, faceOffset = 0;
  for (const component of items) {
    vertices.set(component.vertices, vertexOffset * 3);
    if (colours) {
      if (component.colours) colours.set(component.colours, vertexOffset * 3);
      else colours.fill(200, vertexOffset * 3, (vertexOffset + component.vertices.length / 3) * 3);
    }
    for (let i = 0; i < component.triangles.length; i++) {
      triangles[faceOffset + i] = component.triangles[i] + vertexOffset;
    }
    vertexOffset += component.vertices.length / 3;
    faceOffset += component.triangles.length;
  }
  return {
    vertices,
    triangles,
    colours,
    componentCount: items.length,
    componentIds: items.map(component => component.id),
  };
}
