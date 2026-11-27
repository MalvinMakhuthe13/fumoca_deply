/**
 * Binary persistence for the FUMOCA document model.
 *
 * The document's Gaussian identities and component memberships are stored as
 * uint32 values, not JSON number arrays. Human-readable metadata stays JSON.
 * All integers are big-endian. The chunk is optional; legacy NIF files remain
 * valid and are upgraded when saved by a document-model-aware editor.
 */
import { createDocumentModel, validateDocumentModel } from './document-model.js';

const VERSION = 1;
const MAX_GAUSSIANS = 100_000_000;
const MAX_COMPONENTS = 100_000;
const MAX_METADATA_BYTES = 16 * 1024 * 1024;

function asBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError('document model chunk must be bytes');
}

function checkedIds(value, label) {
  const ids = value == null ? new Uint32Array() : value;
  if (!ArrayBuffer.isView(ids) && !Array.isArray(ids)) throw new TypeError(label + ' must be an array');
  if (ids.length > MAX_GAUSSIANS) throw new RangeError(label + ' exceeds safety limit');
  const seen = new Set();
  for (const id of ids) {
    if (!Number.isInteger(id) || id < 1 || id > 0xffffffff || seen.has(id)) {
      throw new Error(label + ' contains an invalid or duplicate uint32 identity');
    }
    seen.add(id);
  }
  return ids;
}

export function encodeDocumentModelChunk(model) {
  validateDocumentModel(model);
  const encoder = new TextEncoder();
  const components = model.components || [];
  if (components.length > MAX_COMPONENTS) throw new RangeError('too many document components');
  const metadata = {
    kind: model.kind,
    version: model.version,
    documentId: model.documentId,
    revision: model.revision,
    nextGaussianId: model.nextGaussianId,
    activeComponentId: model.activeComponentId ?? null,
    source: model.source ?? null,
    reconstruction: model.reconstruction ?? null,
    lineage: model.lineage ?? [],
    components: components.map((component) => {
      const { gaussianIds, vertices, triangles, faces, positions, colors, colours, normals, indices, ...identity } = component;
      return identity;
    }),
  };
  const metadataBytes = encoder.encode(JSON.stringify(metadata));
  if (metadataBytes.length > MAX_METADATA_BYTES) throw new RangeError('document metadata exceeds safety limit');
  const gaussianIds = checkedIds(model.gaussianIds, 'document Gaussian IDs');
  let size = 13 + metadataBytes.length + gaussianIds.length * 4;
  const componentMemberships = components.map((component, index) => {
    const id = String(component.id || '');
    const idBytes = encoder.encode(id);
    if (!idBytes.length || idBytes.length > 65535) throw new Error('invalid component ID length');
    const ids = checkedIds(component.gaussianIds, 'component ' + id + ' membership');
    size += 4 + ids.length * 4;
    return ids;
  });
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, VERSION);
  view.setUint32(1, metadataBytes.length, false);
  view.setUint32(5, gaussianIds.length, false);
  view.setUint32(9, components.length, false);
  let at = 13;
  bytes.set(metadataBytes, at); at += metadataBytes.length;
  for (const id of gaussianIds) { view.setUint32(at, id, false); at += 4; }
  for (const ids of componentMemberships) {
    view.setUint32(at, ids.length, false); at += 4;
    for (const id of ids) { view.setUint32(at, id, false); at += 4; }
  }
  return bytes;
}

export function decodeDocumentModelChunk(input) {
  if (!input) return null;
  const bytes = asBytes(input);
  try {
    if (bytes.byteLength < 13) throw new Error('truncated document model header');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint8(0) !== VERSION) throw new Error('unsupported document model chunk version');
    const metadataLength = view.getUint32(1, false);
    const gaussianCount = view.getUint32(5, false);
    const componentCount = view.getUint32(9, false);
    if (metadataLength > MAX_METADATA_BYTES || gaussianCount > MAX_GAUSSIANS || componentCount > MAX_COMPONENTS) {
      throw new Error('document model chunk exceeds safety limits');
    }
    let at = 13;
    if (metadataLength > bytes.byteLength - at) throw new Error('truncated document metadata');
    const metadata = JSON.parse(new TextDecoder().decode(bytes.subarray(at, at + metadataLength)));
    at += metadataLength;
    const gaussianBytes = gaussianCount * 4;
    if (!Number.isSafeInteger(gaussianBytes) || gaussianBytes > bytes.byteLength - at) throw new Error('truncated Gaussian identity array');
    const gaussianIds = new Uint32Array(gaussianCount);
    for (let i = 0; i < gaussianCount; i++) { gaussianIds[i] = view.getUint32(at, false); at += 4; }
    const components = metadata.components || [];
    if (!Array.isArray(components) || components.length !== componentCount) throw new Error('component metadata count mismatch');
    for (let i = 0; i < componentCount; i++) {
      if (at + 4 > bytes.byteLength) throw new Error('truncated component membership count');
      const count = view.getUint32(at, false); at += 4;
      if (count > MAX_GAUSSIANS || count * 4 > bytes.byteLength - at) throw new Error('invalid component membership length');
      const ids = new Uint32Array(count);
      for (let j = 0; j < count; j++) { ids[j] = view.getUint32(at, false); at += 4; }
      components[i] = { ...components[i], gaussianIds: ids };
    }
    if (at !== bytes.byteLength) throw new Error('unexpected trailing document model bytes');
    return createDocumentModel({ ...metadata, gaussianIds, components });
  } catch (error) {
    console.warn('[nif-format] DOCUMENT_MODEL ignored:', error.message);
    return null;
  }
}
