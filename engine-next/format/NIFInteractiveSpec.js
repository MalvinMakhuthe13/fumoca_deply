/**
 * NIF Interactive Asset Manifest — v1
 * FUMOCA · Optional declarative interaction data for product assets.
 *
 * This module deliberately does not modify the existing NIF wire format.
 * It uses the already-reserved CHUNK.INTERACTION (0x0600) slot and writes
 * JSON/RAW so older NIF readers can safely ignore the unknown chunk.
 *
 * Security boundary:
 * - No executable scripts, expressions, callbacks, or arbitrary URLs.
 * - Asset references are relative storage keys, not network locations.
 * - Actions and events are allowlisted and reference validated IDs.
 * - Interactive props are separate assets; the environment Gaussian data
 *   remains immutable and is never used as the moving-object geometry.
 */

import { CHUNK, CODEC, NIFChunk, decompressChunk } from './NIFSpec.js';

export const INTERACTIVE_MANIFEST_VERSION = 1;
export const INTERACTIVE_MANIFEST_MAX_BYTES = 2 * 1024 * 1024;

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const STORAGE_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,511}$/;
const HASH_RE = /^[a-f0-9]{64}$/i;

const MIME_TYPES = new Set([
  'model/gltf-binary',
  'model/gltf+json',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
]);

const EVENTS = new Set([
  'tap', 'press_start', 'press_move', 'press_end', 'drag_start', 'drag', 'drag_end',
  'object_picked_up', 'object_dropped', 'entered_zone', 'left_zone',
  'animation_completed',
]);

const ACTIONS = new Set([
  'play_animation', 'set_visibility', 'set_transform', 'set_state',
  'attach_to_hand', 'release_object', 'show_hint', 'play_audio', 'load_scene',
]);

const TOP_LEVEL_KEYS = new Set([
  'schemaVersion', 'sceneId', 'coordinateSystem', 'assets', 'objects',
  'zones', 'animations', 'interactions', 'metadata',
]);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isVec3(value, positive = false) {
  return Array.isArray(value) && value.length === 3 &&
    value.every(v => finiteNumber(v) && (!positive || v > 0));
}

function add(errors, path, message) {
  errors.push(`${path}: ${message}`);
}

function checkId(value, path, errors) {
  if (typeof value !== 'string' || !ID_RE.test(value)) {
    add(errors, path, 'must be a stable ID (1–64 safe characters)');
    return false;
  }
  return true;
}

function checkKeys(value, allowed, path, errors) {
  if (!isRecord(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) add(errors, path + '.' + key, 'unknown field');
  }
}

function checkTransform(value, path, errors) {
  if (!isRecord(value)) {
    add(errors, path, 'must be an object');
    return;
  }
  checkKeys(value, new Set(['position', 'rotation', 'scale']), path, errors);
  if (value.position !== undefined && !isVec3(value.position)) {
    add(errors, path + '.position', 'must be a finite [x,y,z] vector');
  }
  if (value.rotation !== undefined && !(
    Array.isArray(value.rotation) && value.rotation.length === 4 &&
    value.rotation.every(finiteNumber)
  )) {
    add(errors, path + '.rotation', 'must be a finite [x,y,z,w] quaternion');
  }
  if (value.scale !== undefined && !isVec3(value.scale, true)) {
    add(errors, path + '.scale', 'must be a positive finite [x,y,z] vector');
  }
}

function checkCondition(condition, path, errors, depth = 0) {
  if (depth > 4) {
    add(errors, path, 'condition nesting exceeds four levels');
    return;
  }
  if (!isRecord(condition) || typeof condition.type !== 'string') {
    add(errors, path, 'must be a typed condition object');
    return;
  }
  const conditionKeys = condition.type === 'state_is'
    ? ['type', 'objectId', 'state']
    : condition.type === 'zone_contains'
      ? ['type', 'zoneId']
      : ['type', 'conditions'];
  checkKeys(condition, new Set(conditionKeys), path, errors);
  if (condition.type === 'state_is') {
    checkId(condition.objectId, path + '.objectId', errors);
    if (typeof condition.state !== 'string' || condition.state.length > 64) {
      add(errors, path + '.state', 'must be a string of at most 64 characters');
    }
  } else if (condition.type === 'zone_contains') {
    checkId(condition.zoneId, path + '.zoneId', errors);
  } else if (condition.type === 'all' || condition.type === 'any') {
    if (!Array.isArray(condition.conditions) || condition.conditions.length < 1 ||
        condition.conditions.length > 16) {
      add(errors, path + '.conditions', 'must contain 1–16 conditions');
    } else {
      condition.conditions.forEach((item, i) =>
        checkCondition(item, `${path}.conditions[${i}]`, errors, depth + 1));
    }
  } else {
    add(errors, path + '.type', 'unsupported condition type');
  }
}

function checkAction(action, path, errors) {
  if (!isRecord(action) || !ACTIONS.has(action.type)) {
    add(errors, path + '.type', 'unsupported action; executable actions are forbidden');
    return;
  }
  const actionKeys = {
    play_animation: ['type', 'animationId'],
    set_visibility: ['type', 'objectId', 'visible'],
    set_transform: ['type', 'objectId', 'transform', 'durationMs'],
    set_state: ['type', 'objectId', 'state'],
    attach_to_hand: ['type', 'objectId', 'hand'],
    release_object: ['type', 'objectId'],
    show_hint: ['type', 'text', 'durationMs'],
    play_audio: ['type', 'assetId', 'volume'],
    load_scene: ['type', 'sceneId'],
  }[action.type];
  checkKeys(action, new Set(actionKeys), path, errors);
  switch (action.type) {
    case 'play_animation':
      checkId(action.animationId, path + '.animationId', errors);
      break;
    case 'set_visibility':
      checkId(action.objectId, path + '.objectId', errors);
      if (typeof action.visible !== 'boolean') add(errors, path + '.visible', 'must be boolean');
      break;
    case 'set_transform':
      checkId(action.objectId, path + '.objectId', errors);
      checkTransform(action.transform, path + '.transform', errors);
      if (action.durationMs !== undefined &&
          (!finiteNumber(action.durationMs) || action.durationMs < 0 || action.durationMs > 60000)) {
        add(errors, path + '.durationMs', 'must be between 0 and 60000');
      }
      break;
    case 'set_state':
      checkId(action.objectId, path + '.objectId', errors);
      if (typeof action.state !== 'string' || action.state.length > 64) {
        add(errors, path + '.state', 'must be a string of at most 64 characters');
      }
      break;
    case 'attach_to_hand':
    case 'release_object':
      checkId(action.objectId, path + '.objectId', errors);
      if (action.hand !== undefined && !['left', 'right', 'auto'].includes(action.hand)) {
        add(errors, path + '.hand', 'must be left, right, or auto');
      }
      break;
    case 'show_hint':
      if (typeof action.text !== 'string' || action.text.length > 240) {
        add(errors, path + '.text', 'must be a string of at most 240 characters');
      }
      if (action.durationMs !== undefined &&
          (!finiteNumber(action.durationMs) || action.durationMs < 0 || action.durationMs > 30000)) {
        add(errors, path + '.durationMs', 'must be between 0 and 30000');
      }
      break;
    case 'play_audio':
      checkId(action.assetId, path + '.assetId', errors);
      if (action.volume !== undefined &&
          (!finiteNumber(action.volume) || action.volume < 0 || action.volume > 1)) {
        add(errors, path + '.volume', 'must be between 0 and 1');
      }
      break;
    case 'load_scene':
      checkId(action.sceneId, path + '.sceneId', errors);
      break;
  }
}

export function validateInteractiveManifest(manifest) {
  const errors = [];
  if (!isRecord(manifest)) return { valid: false, errors: ['manifest: must be a JSON object'] };

  for (const key of Object.keys(manifest)) {
    if (!TOP_LEVEL_KEYS.has(key)) add(errors, key, 'unknown top-level field');
  }

  if (manifest.schemaVersion !== INTERACTIVE_MANIFEST_VERSION) {
    add(errors, 'schemaVersion', `must equal ${INTERACTIVE_MANIFEST_VERSION}`);
  }
  checkId(manifest.sceneId, 'sceneId', errors);

  const cs = manifest.coordinateSystem;
  if (!isRecord(cs)) {
    add(errors, 'coordinateSystem', 'is required');
  } else {
    checkKeys(cs, new Set(['units', 'upAxis', 'handedness', 'calibrationStatus']), 'coordinateSystem', errors);
    if (!['m', 'cm', 'mm', 'unknown'].includes(cs.units)) {
      add(errors, 'coordinateSystem.units', 'must be m, cm, mm, or unknown');
    }
    if (!['Y', 'Z'].includes(cs.upAxis)) add(errors, 'coordinateSystem.upAxis', 'must be Y or Z');
    if (!['right', 'left'].includes(cs.handedness)) {
      add(errors, 'coordinateSystem.handedness', 'must be right or left');
    }
    if (!['calibrated', 'uncalibrated', 'unknown'].includes(cs.calibrationStatus)) {
      add(errors, 'coordinateSystem.calibrationStatus', 'must explicitly state calibration status');
    }
  }

  const arrays = [
    ['assets', 256], ['objects', 1000], ['zones', 512],
    ['animations', 512], ['interactions', 2048],
  ];
  for (const [key, max] of arrays) {
    if (!Array.isArray(manifest[key]) || manifest[key].length > max) {
      add(errors, key, `must be an array containing at most ${max} entries`);
    }
  }

  const assets = new Map();
  (Array.isArray(manifest.assets) ? manifest.assets : []).forEach((asset, i) => {
    const p = `assets[${i}]`;
    if (!isRecord(asset)) { add(errors, p, 'must be an object'); return; }
    checkKeys(asset, new Set(['id', 'storageKey', 'mimeType', 'sha256', 'byteLength']), p, errors);
    checkId(asset.id, p + '.id', errors);
    if (assets.has(asset.id)) add(errors, p + '.id', 'duplicate asset ID');
    assets.set(asset.id, asset);
    if (typeof asset.storageKey !== 'string' || !STORAGE_KEY_RE.test(asset.storageKey) ||
        asset.storageKey.startsWith('/') || asset.storageKey.split('/').some(part => !part || part === '.' || part === '..') ||
        asset.storageKey.includes('\\')) {
      add(errors, p + '.storageKey', 'must be a relative approved storage key, not a URL or path traversal');
    }
    if (!MIME_TYPES.has(asset.mimeType)) add(errors, p + '.mimeType', 'unsupported asset MIME type');
    if (asset.sha256 !== undefined &&
        (typeof asset.sha256 !== 'string' || !HASH_RE.test(asset.sha256))) {
      add(errors, p + '.sha256', 'must be a 64-character SHA-256 hex digest');
    }
    if (asset.byteLength !== undefined &&
        (!Number.isInteger(asset.byteLength) || asset.byteLength < 1 || asset.byteLength > 100 * 1024 * 1024)) {
      add(errors, p + '.byteLength', 'must be an integer between 1 and 100 MB');
    }
  });

  const objects = new Map();
  (Array.isArray(manifest.objects) ? manifest.objects : []).forEach((object, i) => {
    const p = `objects[${i}]`;
    if (!isRecord(object)) { add(errors, p, 'must be an object'); return; }
    checkKeys(object, new Set(['id', 'assetId', 'role', 'transform', 'parentObjectId', 'nodePath', 'collision']), p, errors);
    checkId(object.id, p + '.id', errors);
    if (objects.has(object.id)) add(errors, p + '.id', 'duplicate object ID');
    objects.set(object.id, object);
    if (!assets.has(object.assetId)) add(errors, p + '.assetId', 'must reference an asset in this manifest');
    if (typeof object.role !== 'string' || object.role.length < 1 || object.role.length > 64) {
      add(errors, p + '.role', 'must be a semantic role of 1–64 characters');
    }
    checkTransform(object.transform, p + '.transform', errors);
    if (object.parentObjectId !== undefined) checkId(object.parentObjectId, p + '.parentObjectId', errors);
    if (object.nodePath !== undefined &&
        (typeof object.nodePath !== 'string' || object.nodePath.length > 256 || object.nodePath.startsWith('/'))) {
      add(errors, p + '.nodePath', 'must be a bounded relative glTF node path');
    }
    if (object.collision !== undefined) {
      const c = object.collision;
      if (isRecord(c)) checkKeys(c, new Set(['type', 'assetId']), p + '.collision', errors);
      if (!isRecord(c) || !['box', 'sphere', 'capsule', 'mesh'].includes(c.type)) {
        add(errors, p + '.collision', 'must declare box, sphere, capsule, or mesh');
      } else if (c.assetId !== undefined && !assets.has(c.assetId)) {
        add(errors, p + '.collision.assetId', 'must reference an asset in this manifest');
      }
    }
  });

  const zones = new Map();
  (Array.isArray(manifest.zones) ? manifest.zones : []).forEach((zone, i) => {
    const p = `zones[${i}]`;
    if (!isRecord(zone)) { add(errors, p, 'must be an object'); return; }
    checkKeys(zone, new Set(['id', 'shape', 'objectId', 'transform', 'size', 'radius']), p, errors);
    checkId(zone.id, p + '.id', errors);
    if (zones.has(zone.id)) add(errors, p + '.id', 'duplicate zone ID');
    zones.set(zone.id, zone);
    if (!['box', 'sphere'].includes(zone.shape)) add(errors, p + '.shape', 'must be box or sphere');
    if (zone.objectId !== undefined && !objects.has(zone.objectId)) {
      add(errors, p + '.objectId', 'must reference an object in this manifest');
    }
    checkTransform(zone.transform, p + '.transform', errors);
    if (zone.size !== undefined && !isVec3(zone.size, true)) {
      add(errors, p + '.size', 'must be a positive finite [x,y,z] vector');
    }
    if (zone.radius !== undefined && (!finiteNumber(zone.radius) || zone.radius <= 0)) {
      add(errors, p + '.radius', 'must be a positive finite number');
    }
  });

  const animations = new Map();
  (Array.isArray(manifest.animations) ? manifest.animations : []).forEach((animation, i) => {
    const p = `animations[${i}]`;
    if (!isRecord(animation)) { add(errors, p, 'must be an object'); return; }
    checkKeys(animation, new Set(['id', 'objectId', 'kind', 'durationMs', 'clipName', 'loop']), p, errors);
    checkId(animation.id, p + '.id', errors);
    if (animations.has(animation.id)) add(errors, p + '.id', 'duplicate animation ID');
    animations.set(animation.id, animation);
    if (!objects.has(animation.objectId)) add(errors, p + '.objectId', 'must reference an object in this manifest');
    if (animation.kind !== 'gltf_clip' && animation.kind !== 'transform') {
      add(errors, p + '.kind', 'must be gltf_clip or transform');
    }
    if (!finiteNumber(animation.durationMs) || animation.durationMs <= 0 || animation.durationMs > 300000) {
      add(errors, p + '.durationMs', 'must be between 1 and 300000');
    }
    if (animation.kind === 'gltf_clip' &&
        (typeof animation.clipName !== 'string' || !animation.clipName || animation.clipName.length > 128)) {
      add(errors, p + '.clipName', 'is required for gltf_clip animations');
    }
  });

  const interactionIds = new Set();
  (Array.isArray(manifest.interactions) ? manifest.interactions : []).forEach((interaction, i) => {
    const p = `interactions[${i}]`;
    if (!isRecord(interaction)) { add(errors, p, 'must be an object'); return; }
    checkKeys(interaction, new Set(['id', 'sourceObjectId', 'event', 'targetZoneId', 'condition', 'actions']), p, errors);
    checkId(interaction.id, p + '.id', errors);
    if (interactionIds.has(interaction.id)) add(errors, p + '.id', 'duplicate interaction ID');
    interactionIds.add(interaction.id);
    if (!objects.has(interaction.sourceObjectId)) {
      add(errors, p + '.sourceObjectId', 'must reference an object in this manifest');
    }
    if (!EVENTS.has(interaction.event)) add(errors, p + '.event', 'unsupported event');
    if (interaction.targetZoneId !== undefined && !zones.has(interaction.targetZoneId)) {
      add(errors, p + '.targetZoneId', 'must reference a zone in this manifest');
    }
    if (interaction.condition !== undefined) checkCondition(interaction.condition, p + '.condition', errors);
    if (!Array.isArray(interaction.actions) || interaction.actions.length < 1 || interaction.actions.length > 16) {
      add(errors, p + '.actions', 'must contain 1–16 allowlisted actions');
    } else {
      interaction.actions.forEach((action, j) => checkAction(action, `${p}.actions[${j}]`, errors));
    }
  });

  // Validate cross-references after all IDs have been collected.
  (Array.isArray(manifest.objects) ? manifest.objects : []).forEach((object, i) => {
    if (object?.parentObjectId && !objects.has(object.parentObjectId)) {
      add(errors, `objects[${i}].parentObjectId`, 'references an unknown parent object');
    }
  });
  (Array.isArray(manifest.animations) ? manifest.animations : []).forEach((animation, i) => {
    if (animation?.objectId && !objects.has(animation.objectId)) {
      add(errors, `animations[${i}].objectId`, 'references an unknown object');
    }
  });
  (Array.isArray(manifest.interactions) ? manifest.interactions : []).forEach((interaction, i) => {
    const condition = interaction?.condition;
    const validateConditionRefs = (node, path) => {
      if (!isRecord(node)) return;
      if (node.type === 'state_is' && !objects.has(node.objectId)) {
        add(errors, path + '.objectId', 'references an unknown object');
      } else if (node.type === 'zone_contains' && !zones.has(node.zoneId)) {
        add(errors, path + '.zoneId', 'references an unknown zone');
      } else if (node.type === 'all' || node.type === 'any') {
        (node.conditions ?? []).forEach((child, index) =>
          validateConditionRefs(child, path + '.conditions[' + index + ']'));
      }
    };
    if (condition) validateConditionRefs(condition, `interactions[${i}].condition`);
    for (const [j, action] of (interaction?.actions ?? []).entries()) {
      if (action?.type === 'play_animation' && !animations.has(action.animationId)) {
        add(errors, `interactions[${i}].actions[${j}].animationId`, 'references an unknown animation');
      }
      if (action?.type === 'play_audio') {
        const asset = assets.get(action.assetId);
        if (!asset || !String(asset.mimeType).startsWith('audio/')) {
          add(errors, `interactions[${i}].actions[${j}].assetId`, 'must reference an audio asset');
        }
      }
      if (action?.type === 'set_visibility' || action?.type === 'set_transform' ||
          action?.type === 'set_state' || action?.type === 'attach_to_hand' ||
          action?.type === 'release_object') {
        if (!objects.has(action.objectId)) {
          add(errors, `interactions[${i}].actions[${j}].objectId`, 'references an unknown object');
        }
      }
    }
  });

  if (manifest.metadata !== undefined && !isRecord(manifest.metadata)) {
    add(errors, 'metadata', 'must be a JSON object');
  }

  return { valid: errors.length === 0, errors };
}

export function encodeInteractiveChunk(manifest) {
  const result = validateInteractiveManifest(manifest);
  if (!result.valid) {
    throw new Error('Invalid NIF interactive manifest:\n- ' + result.errors.join('\n- '));
  }
  const bytes = new TextEncoder().encode(JSON.stringify(manifest));
  if (bytes.byteLength > INTERACTIVE_MANIFEST_MAX_BYTES) {
    throw new Error(`Interactive manifest exceeds ${INTERACTIVE_MANIFEST_MAX_BYTES} bytes`);
  }
  return new NIFChunk(CHUNK.INTERACTION, bytes, CODEC.RAW);
}

export async function decodeInteractiveChunk(chunk) {
  if (!chunk) return null;
  if (chunk.type !== CHUNK.INTERACTION) throw new Error('Not an INTERACTION chunk');
  const bytes = await decompressChunk(chunk);
  if (!bytes || bytes.byteLength > INTERACTIVE_MANIFEST_MAX_BYTES) {
    throw new Error('NIF interactive manifest is empty or exceeds the size limit');
  }
  let manifest;
  try {
    manifest = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('NIF INTERACTION chunk is not valid UTF-8 JSON');
  }
  const result = validateInteractiveManifest(manifest);
  if (!result.valid) {
    throw new Error('Invalid NIF interactive manifest:\n- ' + result.errors.join('\n- '));
  }
  return manifest;
}

/** Minimal valid starting manifest for authoring tools and test fixtures. */
export function createInteractiveManifest(sceneId, coordinateSystem = {}) {
  return {
    schemaVersion: INTERACTIVE_MANIFEST_VERSION,
    sceneId,
    coordinateSystem: {
      units: coordinateSystem.units ?? 'unknown',
      upAxis: coordinateSystem.upAxis ?? 'Y',
      handedness: coordinateSystem.handedness ?? 'right',
      calibrationStatus: coordinateSystem.calibrationStatus ?? 'unknown',
    },
    assets: [],
    objects: [],
    zones: [],
    animations: [],
    interactions: [],
  };
}
