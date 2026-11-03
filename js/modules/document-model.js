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
    activeComponentId: options.activeComponentId == null ? null : String(options.activeComponentId),
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
  const gaussianOwners = new Map();
  for (const component of model.components || []) {
    if (!component?.id || componentIds.has(component.id)) throw new Error('component IDs must be non-empty and unique');
    componentIds.add(component.id);
    for (const parentId of component.parentIds || []) {
      if (parentId === component.id) throw new Error(`component ${component.id} cannot parent itself`);
    }
    const membership = asUint32Ids(component.gaussianIds, `component ${component.id} Gaussian membership`);
    for (const gaussianId of membership) {
      if (!known.has(gaussianId)) throw new Error(`component ${component.id} references unknown Gaussian ID ${gaussianId}`);
      // Deleted ancestors remain in the document graph for lineage, but live
      // Gaussian ownership must be exclusive so trim/delete cannot hit siblings.
      if (component.deleted !== true) {
        const previousOwner = gaussianOwners.get(gaussianId);
        if (previousOwner) {
          throw new Error(`Gaussian ID ${gaussianId} is owned by both ${previousOwner} and ${component.id}`);
        }
        gaussianOwners.set(gaussianId, component.id);
      }
    }
  }
  if (model.activeComponentId != null && !componentIds.has(model.activeComponentId)) {
    throw new Error('activeComponentId must reference a document component');
  }
  if (!Number.isSafeInteger(model.nextGaussianId) || model.nextGaussianId < 1 || model.nextGaussianId > 0x100000000) {
    throw new Error('nextGaussianId is outside the supported range');
  }
  if (gaussianIds.length && model.nextGaussianId <= maxId(gaussianIds)) {
    throw new Error('nextGaussianId must exceed every allocated Gaussian ID');
  }
  return { valid: true, gaussianCount: gaussianIds.length, componentCount: componentIds.size };
}

/**
 * Reconcile the canonical component graph from Studio's live mesh-component
 * collection. Deleted records remain in the graph for lineage; live Gaussian
 * ownership is rebuilt from the mesh list and validated before it is returned.
 * This function is pure: callers may safely validate first and assign second.
 */
export function syncDocumentComponentsFromMesh(model, liveComponents, activeComponentId = null) {
  if (!model) return null;
  if (!Array.isArray(liveComponents)) throw new TypeError('liveComponents must be an array');
  const liveById = new Map();
  for (const component of liveComponents) {
    if (!component?.id || liveById.has(component.id)) {
      throw new Error('live mesh component IDs must be non-empty and unique');
    }
    liveById.set(component.id, component);
  }
  const arraysEqual = (a, b) => {
    const left = a || [], right = b || [];
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return false;
    return true;
  };
  let changed = false;
  const knownIds = new Set((model.components || []).map(component => component.id));
  const components = (model.components || []).map(component => {
    const live = liveById.get(component.id);
    if (!live) {
      if (component.deleted !== true || component.visible !== false || component.selected === true) changed = true;
      return { ...component, visible: false, selected: false, deleted: true };
    }
    const gaussianIds = live.gaussianIds || [];
    const parentIds = [...new Set((live.parentIds || component.parentIds || []).map(String))];
    const visible = live.visible !== false;
    const selected = live.selected === true;
    const geometrySource = live.geometrySource || component.geometrySource || 'gaussian-derived';
    const provenance = live.provenance || component.provenance || null;
    if (!arraysEqual(component.gaussianIds, gaussianIds)
        || JSON.stringify(component.parentIds || []) !== JSON.stringify(parentIds)
        || component.visible !== visible || component.selected !== selected
        || component.deleted === true || component.geometrySource !== geometrySource
        || JSON.stringify(component.provenance || null) !== JSON.stringify(provenance)
        || (live.watertight !== undefined && component.watertight !== (live.watertight === true))
        || (live.supportSurfaceCandidate !== undefined && component.supportSurfaceCandidate !== (live.supportSurfaceCandidate === true))) changed = true;
    return {
      ...component, parentIds, gaussianIds, visible, selected, geometrySource, provenance, deleted: false,
      ...(live.watertight !== undefined ? { watertight: live.watertight === true } : {}),
      ...(live.supportSurfaceCandidate !== undefined ? { supportSurfaceCandidate: live.supportSurfaceCandidate === true } : {}),
    };
  });
  for (const live of liveComponents) {
    if (knownIds.has(live.id)) continue;
    changed = true;
    components.push({
      id: live.id,
      parentIds: live.parentIds || [],
      gaussianIds: live.gaussianIds || [],
      visible: live.visible !== false,
      selected: live.selected === true,
      ...(live.watertight !== undefined ? { watertight: live.watertight === true } : {}),
      ...(live.supportSurfaceCandidate !== undefined ? { supportSurfaceCandidate: live.supportSurfaceCandidate === true } : {}),
      geometrySource: live.geometrySource || 'gaussian-derived',
      provenance: live.provenance || { source: 'mesh-reconstruction' },
    });
  }
  const nextActive = liveById.has(activeComponentId) ? activeComponentId : null;
  if ((model.activeComponentId || null) !== nextActive) changed = true;
  if (!changed) return model;
  return createDocumentModel({
    ...model,
    revision: model.revision + 1,
    components,
    activeComponentId: nextActive,
  });
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


/*
 * Unified, document-scoped edit journal.
 *
 * The journal stores domain snapshots (Gaussian buffers, component geometry,
 * identities, visibility, selection and metadata) supplied by a Studio adapter.
 * It deliberately excludes transient renderer objects.
 */
function cloneHistoryValue(value) {
  if (value == null || typeof value !== 'object') return value;
  if (ArrayBuffer.isView(value)) return new value.constructor(value);
  if (value instanceof ArrayBuffer) return value.slice(0);
  if (Array.isArray(value)) return value.map(cloneHistoryValue);
  if (value instanceof Map) return new Map([...value].map(([key, item]) => [cloneHistoryValue(key), cloneHistoryValue(item)]));
  if (value instanceof Set) return new Set([...value].map(cloneHistoryValue));
  const copy = {};
  for (const [key, item] of Object.entries(value)) copy[key] = cloneHistoryValue(item);
  return copy;
}

function historyValuesEqual(a, b, seen = new WeakMap()) {
  if (Object.is(a, b)) return true;
  if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  if (ArrayBuffer.isView(a)) {
    if (a.constructor !== b.constructor || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
    return true;
  }
  if (a instanceof ArrayBuffer) {
    if (a.byteLength !== b.byteLength) return false;
    const av = new Uint8Array(a), bv = new Uint8Array(b);
    for (let i = 0; i < av.length; i++) if (av[i] !== bv[i]) return false;
    return true;
  }
  if (seen.get(a) === b) return true;
  seen.set(a, b);
  if (a instanceof Map) {
    if (a.size !== b.size) return false;
    const ai = a.entries(), bi = b.entries();
    while (true) {
      const x = ai.next(), y = bi.next();
      if (x.done || y.done) return x.done === y.done;
      if (!historyValuesEqual(x.value[0], y.value[0], seen) || !historyValuesEqual(x.value[1], y.value[1], seen)) return false;
    }
  }
  if (a instanceof Set) {
    if (a.size !== b.size) return false;
    const ai = a.values(), bi = b.values();
    while (true) {
      const x = ai.next(), y = bi.next();
      if (x.done || y.done) return x.done === y.done;
      if (!historyValuesEqual(x.value, y.value, seen)) return false;
    }
  }
  const ak = Object.keys(a), bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const key of ak) {
    if (!Object.prototype.hasOwnProperty.call(b, key) || !historyValuesEqual(a[key], b[key], seen)) return false;
  }
  return true;
}

function estimateHistoryBytes(value, seen = new Set()) {
  if (value == null) return 0;
  if (typeof value === 'string') return value.length * 2;
  if (typeof value === 'number' || typeof value === 'bigint') return 8;
  if (typeof value === 'boolean') return 4;
  if (typeof value !== 'object' || seen.has(value)) return 0;
  seen.add(value);
  if (ArrayBuffer.isView(value)) return value.byteLength + 16;
  if (value instanceof ArrayBuffer) return value.byteLength + 16;
  if (value instanceof Map) {
    let bytes = 48;
    for (const [key, item] of value) bytes += 16 + estimateHistoryBytes(key, seen) + estimateHistoryBytes(item, seen);
    return bytes;
  }
  if (value instanceof Set) {
    let bytes = 40;
    for (const item of value) bytes += 8 + estimateHistoryBytes(item, seen);
    return bytes;
  }
  if (Array.isArray(value)) {
    let bytes = 24 + value.length * 8;
    for (const item of value) bytes += estimateHistoryBytes(item, seen);
    return bytes;
  }
  let bytes = 32;
  for (const [key, item] of Object.entries(value)) {
    bytes += key.length * 2 + 8 + estimateHistoryBytes(item, seen);
  }
  return bytes;
}

/**
 * Bounded atomic snapshot journal shared by all Studio editing domains.
 * capture() returns detached data; restore() replaces authored document state
 * and refreshes previews. Both callbacks must be synchronous.
 */
export class UnifiedEditHistory {
  constructor({ capture, restore, limit = 80, maxBytes = 512 * 1024 * 1024, equals = null, onChange = null } = {}) {
    if (typeof capture !== 'function' || typeof restore !== 'function') {
      throw new TypeError('UnifiedEditHistory requires capture and restore functions');
    }
    this.capture = capture;
    this.restore = restore;
    this.limit = Math.max(1, Math.floor(Number(limit) || 80));
    this.maxBytes = Math.max(1024 * 1024, Math.floor(Number(maxBytes) || 512 * 1024 * 1024));
    this.equals = typeof equals === 'function' ? equals : historyValuesEqual;
    this.onChange = typeof onChange === 'function' ? onChange : null;
    this.entries = [];
    this.cursor = 0;
    this.bytes = 0;
    this.transactionOpen = false;
    this.lastError = null;
    this.baseline = this.#capture();
  }

  #capture() {
    const snapshot = this.capture();
    if (!snapshot || typeof snapshot !== 'object') throw new TypeError('history capture must return an object snapshot');
    return cloneHistoryValue(snapshot);
  }

  #notify() { this.onChange?.(this.state()); }

  #push(entry) {
    while (this.entries.length > this.cursor) this.bytes -= this.entries.pop().bytes;
    this.entries.push(entry);
    this.cursor = this.entries.length;
    this.bytes += entry.bytes;
    while (this.entries.length > this.limit || (this.bytes > this.maxBytes && this.entries.length > 1)) {
      this.bytes -= this.entries.shift().bytes;
      this.cursor = Math.max(0, this.cursor - 1);
    }
  }

  /** Commit one completed user gesture, not every frame of a drag. */
  commit(label = 'Edit', { coalesceKey = null } = {}) {
    if (this.transactionOpen) throw new Error('cannot commit while a history transaction is open');
    const after = this.#capture();
    const before = this.baseline;
    if (this.equals && this.equals(before, after)) return false;
    const entry = {
      id: Date.now().toString(36) + '-' + this.cursor.toString(36),
      label: String(label || 'Edit'),
      coalesceKey: coalesceKey == null ? null : String(coalesceKey),
      before,
      after,
      bytes: estimateHistoryBytes(before) + estimateHistoryBytes(after),
      committedAt: Date.now(),
    };

    // A single before/after pair can exceed the entire history budget (common
    // for very large scans). Never retain that entry as an exception to the
    // configured cap: discard stale undo/redo entries, advance the baseline
    // to the current authored state, and expose the reason to the UI.
    if (entry.bytes > this.maxBytes) {
      this.entries.length = 0;
      this.cursor = 0;
      this.bytes = 0;
      this.baseline = after;
      this.lastError = new Error(`"${entry.label}" was applied, but its snapshot (${entry.bytes} bytes) exceeds the ${this.maxBytes}-byte history budget; undo history was cleared to protect memory.`);
      this.#notify();
      return false;
    }

    const current = this.entries[this.cursor - 1];
    if (entry.coalesceKey && current?.coalesceKey === entry.coalesceKey && this.cursor === this.entries.length) {
      this.bytes -= current.bytes;
      entry.before = current.before;
      entry.bytes = estimateHistoryBytes(entry.before) + estimateHistoryBytes(entry.after);
      this.entries[this.cursor - 1] = entry;
      this.bytes += entry.bytes;
      // Coalescing replaces an entry and can make it larger than the budget
      // even when the original entry fitted. Apply the same strict cap used
      // for ordinary commits.
      while (this.bytes > this.maxBytes && this.entries.length > 1) {
        this.bytes -= this.entries.shift().bytes;
        this.cursor = Math.max(0, this.cursor - 1);
      }
      if (this.bytes > this.maxBytes) {
        this.entries.length = 0;
        this.cursor = 0;
        this.bytes = 0;
        this.baseline = after;
        this.lastError = new Error(`"${entry.label}" was applied, but its coalesced snapshot exceeds the ${this.maxBytes}-byte history budget; undo history was cleared to protect memory.`);
        this.#notify();
        return false;
      }
    } else {
      this.#push(entry);
    }
    this.baseline = after;
    this.lastError = null;
    this.#notify();
    return true;
  }

  /** Synchronous transaction with exact rollback if mutation or validation fails. */
  transact(label, mutate, options = {}) {
    if (typeof mutate !== 'function') throw new TypeError('history mutation must be a function');
    if (this.transactionOpen) throw new Error('nested history transactions are not supported');
    const before = this.#capture();
    this.transactionOpen = true;
    try {
      const result = mutate();
      if (result && typeof result.then === 'function') {
        throw new TypeError('history transactions must be synchronous; prepare async work before committing');
      }
      this.transactionOpen = false;
      this.baseline = before;
      this.commit(label, options);
      return result;
    } catch (error) {
      this.transactionOpen = false;
      try {
        this.restore(cloneHistoryValue(before), { direction: 'rollback', label: String(label || 'Edit') });
        this.baseline = this.#capture();
      } catch (restoreError) {
        error.restoreError = restoreError;
      }
      this.lastError = error;
      this.#notify();
      throw error;
    }
  }

  /**
   * Cancel an in-progress legacy pre-mutation gesture. The baseline is the
   * detached state captured before the caller mutated authored data.
   */
  cancelPending() {
    if (this.transactionOpen) throw new Error('cannot cancel while a history transaction is open');
    const current = this.#capture();
    try {
      this.restore(cloneHistoryValue(this.baseline), { direction: 'cancel', label: 'Cancelled edit' });
      this.baseline = this.#capture();
      this.lastError = null;
      this.#notify();
      return true;
    } catch (error) {
      try {
        this.restore(cloneHistoryValue(current), { direction: 'rollback', label: 'Cancelled edit', failedDirection: 'cancel' });
        this.baseline = this.#capture();
      } catch (restoreError) {
        error.restoreError = restoreError;
      }
      this.lastError = error;
      this.#notify();
      throw error;
    }
  }

  undo() {
    if (this.transactionOpen || !this.canUndo()) return false;
    const entry = this.entries[this.cursor - 1];
    const current = this.#capture();
    try {
      this.restore(cloneHistoryValue(entry.before), { direction: 'undo', label: entry.label, entryId: entry.id });
      const restored = this.#capture();
      this.cursor--;
      this.baseline = restored;
      this.lastError = null;
      this.#notify();
      return true;
    } catch (error) {
      // A restore adapter can fail after partially changing scene state.
      // Best-effort rollback keeps the cursor and visible document in sync.
      try {
        this.restore(cloneHistoryValue(current), { direction: 'rollback', label: entry.label, failedDirection: 'undo' });
        this.baseline = this.#capture();
      } catch (restoreError) {
        error.restoreError = restoreError;
      }
      this.lastError = error;
      this.#notify();
      throw error;
    }
  }

  redo() {
    if (this.transactionOpen || !this.canRedo()) return false;
    const entry = this.entries[this.cursor];
    const current = this.#capture();
    try {
      this.restore(cloneHistoryValue(entry.after), { direction: 'redo', label: entry.label, entryId: entry.id });
      const restored = this.#capture();
      this.cursor++;
      this.baseline = restored;
      this.lastError = null;
      this.#notify();
      return true;
    } catch (error) {
      try {
        this.restore(cloneHistoryValue(current), { direction: 'rollback', label: entry.label, failedDirection: 'redo' });
        this.baseline = this.#capture();
      } catch (restoreError) {
        error.restoreError = restoreError;
      }
      this.lastError = error;
      this.#notify();
      throw error;
    }
  }

  canUndo() { return this.cursor > 0; }
  canRedo() { return this.cursor < this.entries.length; }

  clear() {
    this.entries.length = 0;
    this.cursor = 0;
    this.bytes = 0;
    this.baseline = this.#capture();
    this.lastError = null;
    this.#notify();
  }

  state() {
    return {
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
      undoLabel: this.canUndo() ? this.entries[this.cursor - 1].label : null,
      redoLabel: this.canRedo() ? this.entries[this.cursor].label : null,
      count: this.entries.length,
      cursor: this.cursor,
      bytes: this.bytes,
      transactionOpen: this.transactionOpen,
      error: this.lastError?.message || null,
    };
  }
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
