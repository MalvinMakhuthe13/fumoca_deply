/**
 * FUMOCA document model — canonical identity and edit-history primitives.
 *
 * Geometry remains in the Gaussian and mesh payloads. This module owns the
 * stable identities and relationships that make those payloads editable as
 * one document. It is deliberately renderer- and reconstruction-engine agnostic.
 */

export const DOCUMENT_MODEL_VERSION = 1;
export const DOCUMENT_MODEL_KIND = 'fumoca.document';

function makeUuid() {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (typeof randomUUID !== 'function') {
    throw new Error('[document-model] crypto.randomUUID is required; inject idFactory in unsupported runtimes');
  }
  return randomUUID.call(globalThis.crypto);
}

function cloneValue(value) {
  if (value == null || typeof value !== 'object') return value;
  if (ArrayBuffer.isView(value)) return new value.constructor(value);
  if (value instanceof ArrayBuffer) return value.slice(0);
  if (Array.isArray(value)) return value.map(cloneValue);
  if (value instanceof Map) return new Map([...value].map(([k, v]) => [cloneValue(k), cloneValue(v)]));
  if (value instanceof Set) return new Set([...value].map(cloneValue));
  const out = {};
  for (const [key, item] of Object.entries(value)) out[key] = cloneValue(item);
  return out;
}

function maxId(ids) {
  let maximum = 0;
  for (const id of ids) if (id > maximum) maximum = id;
  return maximum;
}

function asUint32Ids(value, label, { allowEmpty = true } = {}) {
  if (value == null && allowEmpty) return new Uint32Array();
  const values = Array.from(value || []);
  if (!allowEmpty && values.length === 0) throw new Error(`[document-model] ${label} cannot be empty`);
  const seen = new Set();
  for (const id of values) {
    if (!Number.isInteger(id) || id < 1 || id > 0xffffffff) {
      throw new Error(`[document-model] ${label} contains an invalid uint32 identity`);
    }
    if (seen.has(id)) throw new Error(`[document-model] ${label} contains duplicate ID ${id}`);
    seen.add(id);
  }
  return Uint32Array.from(values);
}

/** Allocate monotonically increasing point identities; 0 is permanently reserved. */
export function allocateGaussianIds(count, nextId = 1) {
  if (!Number.isSafeInteger(count) || count < 0) throw new RangeError('count must be a non-negative safe integer');
  if (!Number.isSafeInteger(nextId) || nextId < 1 || nextId > 0xffffffff) {
    throw new RangeError('nextId must be in the uint32 identity range');
  }
  if (count && nextId + count - 1 > 0xffffffff) throw new RangeError('Gaussian identity space exhausted');
  const ids = new Uint32Array(count);
  for (let i = 0; i < count; i++) ids[i] = nextId + i;
  return { ids, nextId: nextId + count };
}

function normalizeComponent(component, idFactory) {
  if (!component || typeof component !== 'object') throw new TypeError('component must be an object');
  const id = String(component.id || idFactory());
  if (!id.trim()) throw new Error('component ID cannot be empty');
  const parentIds = [...new Set((component.parentIds || []).map(String))];
  if (parentIds.includes(id)) throw new Error(`component ${id} cannot be its own parent`);
  const gaussianIds = asUint32Ids(component.gaussianIds, `component ${id} Gaussian membership`);
  const provenance = component.provenance && typeof component.provenance === 'object'
    ? cloneValue(component.provenance) : null;
  return {
    ...cloneValue(component),
    id,
    parentIds,
    gaussianIds,
    provenance,
    visible: component.visible !== false,
    selected: component.selected === true,
    geometrySource: component.geometrySource || (gaussianIds.length ? 'gaussian-derived' : 'mesh-authored'),
  };
}

/**
 * Create the canonical in-memory document model. Gaussian IDs are document-
 * scoped uint32 identities, not array offsets; component IDs are UUIDs.
 */
export function createDocumentModel(options = {}) {
  const idFactory = options.idFactory || makeUuid;
  const documentId = String(options.documentId || idFactory());
  const gaussianIds = asUint32Ids(options.gaussianIds, 'Gaussian IDs');
  const components = (options.components || []).map(item => normalizeComponent(item, idFactory));
  const model = {
    kind: DOCUMENT_MODEL_KIND,
    version: DOCUMENT_MODEL_VERSION,
    documentId,
    revision: Number.isSafeInteger(options.revision) && options.revision >= 0 ? options.revision : 0,
    nextGaussianId: options.nextGaussianId ?? (maxId(gaussianIds) + 1),
    gaussianIds,
    source: cloneValue(options.source || { geometrySignature: null, appearanceSignature: null }),
    reconstruction: cloneValue(options.reconstruction || null),
    components,
    lineage: cloneValue(options.lineage || []),
  };
  validateDocumentModel(model);
  return model;
}

export function validateDocumentModel(model) {
  if (!model || model.kind !== DOCUMENT_MODEL_KIND) throw new Error('invalid FUMOCA document model kind');
  if (model.version !== DOCUMENT_MODEL_VERSION) throw new Error(`unsupported document model version: ${model.version}`);
  if (typeof model.documentId !== 'string' || !model.documentId.trim()) throw new Error('documentId is required');
  if (!Number.isSafeInteger(model.revision) || model.revision < 0) throw new Error('revision must be a non-negative integer');
  const gaussianIds = asUint32Ids(model.gaussianIds, 'document Gaussian IDs');
  const known = new Set(gaussianIds);
  const componentIds = new Set();
  for (const component of model.components || []) {
    if (!component?.id || componentIds.has(component.id)) throw new Error('component IDs must be non-empty and unique');
    componentIds.add(component.id);
    for (const parentId of component.parentIds || []) {
      if (parentId === component.id) throw new Error(`component ${component.id} cannot parent itself`);
    }
    const membership = asUint32Ids(component.gaussianIds, `component ${component.id} Gaussian membership`);
    for (const gaussianId of membership) {
      if (!known.has(gaussianId)) throw new Error(`component ${component.id} references unknown Gaussian ID ${gaussianId}`);
    }
  }
  if (!Number.isSafeInteger(model.nextGaussianId) || model.nextGaussianId < 1 || model.nextGaussianId > 0x100000000) {
    throw new Error('nextGaussianId is outside the supported range');
  }
  if (gaussianIds.length && model.nextGaussianId <= maxId(gaussianIds)) {
    throw new Error('nextGaussianId must exceed every allocated Gaussian ID');
  }
  return { valid: true, gaussianCount: gaussianIds.length, componentCount: componentIds.size };
}

/** Make an independent snapshot, including typed geometry and identity arrays. */
export function cloneDocumentModel(model) {
  validateDocumentModel(model);
  return cloneValue(model);
}

/**
 * Transactional in-memory history. A failed mutation is rolled back; undo and
 * redo restore exact snapshots, including typed arrays, visibility and lineage.
 * Persisted history can be added as a separate journal format without coupling
 * the document model to UI callbacks.
 */
export class DocumentHistory {
  constructor(model, { limit = 100, onRestore = null } = {}) {
    validateDocumentModel(model);
    this.current = cloneDocumentModel(model);
    this.limit = Math.max(1, Math.floor(limit));
    this.onRestore = typeof onRestore === 'function' ? onRestore : null;
    this.undoStack = [];
    this.redoStack = [];
  }

  transact(label, mutate) {
    if (typeof mutate !== 'function') throw new TypeError('mutate must be a function');
    const before = cloneDocumentModel(this.current);
    try {
      const result = mutate(this.current);
      this.current.revision += 1;
      validateDocumentModel(this.current);
      const after = cloneDocumentModel(this.current);
      this.undoStack.push({ label: String(label || 'Edit'), before, after });
      if (this.undoStack.length > this.limit) this.undoStack.shift();
      this.redoStack.length = 0;
      return result;
    } catch (error) {
      this.current = before;
      throw error;
    }
  }

  undo() {
    const entry = this.undoStack.pop();
    if (!entry) return false;
    this.redoStack.push(entry);
    this.current = cloneDocumentModel(entry.before);
    this.onRestore?.(this.current, { direction: 'undo', label: entry.label });
    return true;
  }

  redo() {
    const entry = this.redoStack.pop();
    if (!entry) return false;
    this.undoStack.push(entry);
    this.current = cloneDocumentModel(entry.after);
    this.onRestore?.(this.current, { direction: 'redo', label: entry.label });
    return true;
  }

  canUndo() { return this.undoStack.length > 0; }
  canRedo() { return this.redoStack.length > 0; }
  snapshot() { return cloneDocumentModel(this.current); }
}

/** Split lineage helper: child components retain ancestry and source membership. */
export function createComponentChildren(parent, children, { idFactory = makeUuid } = {}) {
  if (!parent?.id || !Array.isArray(children) || children.length < 2) {
    throw new Error('a split requires a parent and at least two child components');
  }
  return children.map(child => normalizeComponent({
    ...child,
    id: child.id || idFactory(),
    parentIds: [...new Set([...(child.parentIds || []), parent.id])],
  }, idFactory));
}


/**
 * Compact a document model to the Gaussian rows retained by a save/export.
 * The input indices refer to the model's current Gaussian array order. Stable
 * identities survive filtering; deleted rows are not renumbered or reused.
 */
export function compactDocumentModel(model, retainedIndices) {
  validateDocumentModel(model);
  if (!Array.isArray(retainedIndices) && !ArrayBuffer.isView(retainedIndices)) {
    throw new TypeError('retainedIndices must be an array of Gaussian row indices');
  }
  const seen = new Set();
  const gaussianIds = [];
  for (const rawIndex of retainedIndices) {
    const index = Number(rawIndex);
    if (!Number.isInteger(index) || index < 0 || index >= model.gaussianIds.length || seen.has(index)) {
      throw new RangeError('retained Gaussian row index is invalid or duplicated');
    }
    seen.add(index);
    gaussianIds.push(model.gaussianIds[index]);
  }
  const retained = new Set(gaussianIds);
  const components = (model.components || []).map(component => ({
    ...cloneValue(component),
    gaussianIds: Array.from(component.gaussianIds || []).filter(id => retained.has(id)),
  }));
  return createDocumentModel({
    ...cloneValue(model),
    gaussianIds: Uint32Array.from(gaussianIds),
    components,
    nextGaussianId: model.nextGaussianId,
  });
}
