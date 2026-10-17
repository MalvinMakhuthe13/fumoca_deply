/**
 * NIF part toggle — live app version
 * fumoca.co.za · © Fumoca Technologies
 *
 * WHY THIS EXISTS, AND WHY IT'S NOT SMOOTH ANIMATION
 * ────────────────────────────────────────────────────
 * The live viewer renders through a third-party library
 * (@mkkellogg/gaussian-splats-3d). Its own author, in a public GitHub
 * discussion, confirmed the only way to move a splat after load is to
 * mutate its internal buffer directly and call a full reset — and says
 * outright "performance will not be good." There's no supported per-frame
 * position-update path. Separately, viewer.js already has a documented,
 * abandoned attempt at live blob-URL scene swapping
 * (_fumocaApplyRendererPreview's own comment: "This viewer build cannot
 * reliably ingest blob/object URLs as live nif scenes").
 *
 * So this does neither. It bakes a SECOND, complete .nif file with one
 * layer's points pre-rotated to their "open" position, uploads it as a real
 * R2 object (a real https:// URL, not a blob — sidestepping the documented
 * blob issue), and a toggle swaps the *whole loaded scene* between the
 * "closed" (original) and "open" (baked) file using
 * _fumocaApplyRendererPreview/_fumocaRestoreRendererPreview — real,
 * already-written functions in viewer.js that were sitting completely
 * unused (grep confirms zero callers) until this connected them.
 *
 * RESULT: a real, reliable snap open/close, not a smooth swing. The tradeoff
 * is explicit, not hidden — see the conversation this was scoped in.
 *
 * USAGE (from hotspot-actions.js's 'animate' case, or an authoring UI):
 *   import { authorPartToggle } from './nif-part-toggle.js';
 *   const { openNifUrl, fileKey } = await authorPartToggle(currentNifUrl, 'door_front_left', {
 *     axis: [0,1,0], pivot: [1.2, 0, 0.4], angleDeg: 55,
 *     recordId: currentNifRecord.id, ownerId: currentNifRecord.user_id,
 *   });
 *   // Save openNifUrl into that hotspot's action: {type:'animate', layer, openNifUrl}
 */

import { decodeNif, decodeLayers, decodePhysics, encodeNif } from './nif-format.js';
import { CHUNK } from '../../engine-next/format/NIFSpec.js';
import { GaussianEdit, Quat, v3 } from '../../engine-next/math/NIFMath.js';
import r2 from '../r2Client.js';

/**
 * Rotate one layer's points, by index, within the full 14-float-per-point
 * gaussians buffer. Returns a NEW buffer — does not mutate the input.
 */
function rotateLayer(gaussians, indices, pivot, axis, angleDeg) {
  const q = Quat.fromAxisAngle(v3.norm(axis), angleDeg * Math.PI / 180);
  const rotatedData = GaussianEdit.rotate(gaussians.data, indices, pivot, q);
  return { count: gaussians.count, data: rotatedData };
}

/**
 * A real geometric starting guess for a pivot, same heuristic used in
 * engine-next/animation/NIFHingeAuthor.js — duplicated here (not imported)
 * so the live authoring flow doesn't pull in anything from the engine-next
 * animation lane, which stays fully isolated from the live app on purpose.
 */
export function suggestHingePivot(layer, axis = [0, 1, 0]) {
  const { data, count } = layer;
  if (!count) return [0, 0, 0];
  const a = v3.norm(axis);
  let cx = 0, cy = 0, cz = 0;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < count; i++) {
    const x = data[i*14], y = data[i*14+1], z = data[i*14+2];
    cx += x; cy += y; cz += z;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const centroid = [cx/count, cy/count, cz/count];
  const extents = [
    { dim: 0, axisVec: [1,0,0], min: minX, max: maxX },
    { dim: 1, axisVec: [0,1,0], min: minY, max: maxY },
    { dim: 2, axisVec: [0,0,1], min: minZ, max: maxZ },
  ].filter(e => Math.abs(v3.dot(e.axisVec, a)) < 0.5);
  if (!extents.length) return centroid;
  extents.sort((p, q) => (q.max - q.min) - (p.max - p.min));
  const pivot = [...centroid];
  pivot[extents[0].dim] = extents[0].min;
  return pivot;
}

/**
 * Fetch a .nif, bake a rotated "open" variant, encode it as a complete
 * standalone .nif, and upload it to R2.
 *
 * @param {string} nifUrl              URL of the currently-loaded (closed) .nif
 * @param {string|Array} labelOrParts  either a single layer label (string —
 *   backward-compatible single-part toggle), or an array of
 *   `{label, axis?, pivot?, angleDeg?}` to rotate MULTIPLE parts together
 *   into one combined "open" file — e.g. a door AND a mirror folding in on
 *   the same click. This does not remove the documented limitation that
 *   independently-toggled parts can't both be open at once (see
 *   animatePartFlow's comment in hotspot-pro.js) — it solves the different,
 *   common case of wanting several parts to move together as one action.
 * @param {object} opts   pivot, axis, angleDeg plus required parent recordId/ownerId
 *   so the uploaded variant is authorized through its parent NIF.
 * @returns {{openNifUrl: string, fileKey: string, layers: Array}}
 */
export async function authorPartToggle(nifUrl, labelOrParts, opts = {}) {
  const res = await fetch(nifUrl);
  if (!res.ok) throw new Error(`Could not fetch ${nifUrl}: HTTP ${res.status}`);
  const buf = await res.arrayBuffer();

  const { reader, meta, gaussians, thumbnailBytes } = await decodeNif(buf);
  const layers = await decodeLayers(reader);
  const physics = await decodePhysics(reader);

  const parts = Array.isArray(labelOrParts)
    ? labelOrParts
    : [{ label: labelOrParts, axis: opts.axis, pivot: opts.pivot, angleDeg: opts.angleDeg }];

  let workingGaussians = gaussians;
  const appliedLabels = [];
  for (const part of parts) {
    const layer = layers.find(l => l.label === part.label);
    if (!layer || !layer.indices?.length) {
      throw new Error(`Layer "${part.label}" not found or has no indices — this .nif may predate ` +
        `pipeline.py's indices change, or the label doesn't exist. Available layers: ` +
        `${layers.map(l => l.label).join(', ') || '(none)'}`);
    }
    const jointDef = physics?.constraints?.find(c => c.bodyA === part.label && c.type === 'joint');
    const axis = part.axis ?? jointDef?.params?.axis ?? [0, 1, 0];
    if (!Array.isArray(axis) || axis.length !== 3 || axis.some(value => !Number.isFinite(value)) ||
        Math.hypot(...axis) < 1e-8) {
      throw new Error(`Layer "${part.label}" needs a finite, non-zero three-component rotation axis.`);
    }
    const pivot = part.pivot ?? jointDef?.params?.pivot ?? suggestHingePivot(layer, axis);
    if (!Array.isArray(pivot) || pivot.length !== 3 || pivot.some(value => !Number.isFinite(value))) {
      throw new Error(`Layer "${part.label}" needs a finite three-component rotation pivot.`);
    }
    const angleDeg = part.angleDeg ?? jointDef?.params?.angleMax ?? 60;
    if (!Number.isFinite(angleDeg) || Math.abs(angleDeg) > 360) {
      throw new Error(`Layer "${part.label}" rotation angle must be finite and between -360 and 360 degrees.`);
    }
    // Chained, not parallel — each call returns a full new buffer built from
    // the previous one. Safe as long as different layers' indices don't
    // overlap (they don't — LAYER_GEO layers are disjoint groups from
    // pipeline.py's split_layers()), so rotating them in sequence is
    // equivalent to rotating them all at once.
    workingGaussians = rotateLayer(workingGaussians, layer.indices, pivot, axis, angleDeg);
    appliedLabels.push(part.label);
  }

  // Pass the canonical 14-float buffer straight through via opts.geometry —
  // GaussianEdit.rotate() already correctly rotates the per-point orientation
  // quaternion and leaves scale untouched, so this keeps full anisotropic
  // splat fidelity. Round-tripping through positions/colors01/opacities01
  // (the PLY-style path) would have discarded scale and orientation entirely,
  // flattening every splat to an isotropic sphere for no reason.
  const recordId = opts.recordId;
  const ownerId = opts.ownerId;
  const sb = window._fumocaSupabase;
  if (!recordId || !ownerId || !sb) {
    throw new Error('Cannot publish an open-state variant without the current NIF record, owner, and Supabase session.');
  }

  const safeLabels = appliedLabels.join('_').replace(/[^a-z0-9_-]/gi, '_');
  const key = `${ownerId}/open-variants/${recordId}_${safeLabels}_${Date.now()}.nif`;
  const passthroughChunks = reader.chunks.filter(chunk =>
    ![CHUNK.KEYFRAME_GEO, CHUNK.META, CHUNK.THUMBNAIL].includes(chunk.type)
  );
  const openBuf = encodeNif({
    geometry: workingGaussians.data,
    meta: { ...meta, open_variant_of: recordId, open_variant_layers: appliedLabels },
    thumbnailBytes,
    passthroughChunks,
    vertical: meta.vertical || 'generic',
  });

  const blob = new Blob([openBuf], { type: 'application/octet-stream' });
  const { publicUrl, fileKey, error } = await r2.from('nif-files').upload(key, blob, { contentType: 'application/octet-stream' });
  if (error || !publicUrl || !fileKey) {
    throw new Error(`Upload failed: ${error?.message || 'storage returned no key or URL'}`);
  }

  let previewNifUrl = publicUrl;
  try {
    const { data: current, error: readError } = await sb.from('nif_files')
      .select('meta,is_public').eq('id', recordId).eq('user_id', ownerId).single();
    if (readError || !current) throw new Error(readError?.message || 'Parent NIF was not found or is not owned by the current user.');
    const previous = current.meta && typeof current.meta === 'object' ? current.meta : {};
    const keys = Array.isArray(previous.open_variant_r2_keys) ? previous.open_variant_r2_keys : [];
    const nextMeta = { ...previous, open_variant_r2_keys: [...new Set([...keys, fileKey])] };
    const { data: updated, error: updateError } = await sb.from('nif_files').update({
      meta: nextMeta,
    }).eq('id', recordId).eq('user_id', ownerId).select('id').maybeSingle();
    if (updateError || !updated) throw new Error(updateError?.message || 'Open-state variant could not be linked to its parent NIF.');
    // Keep the in-memory record in sync so the subsequent hotspot save does
    // not overwrite the newly registered variant key with stale metadata.
    if (window._fumocaCurrentRecord?.id === recordId) {
      window._fumocaCurrentRecord = { ...window._fumocaCurrentRecord, meta: nextMeta };
    }
    // A private parent needs a short-lived read ticket for the preview fetch.
    // Persist only the canonical URL in the hotspot action; never persist a
    // temporary ticket that will expire and break future toggles.
    if (current.is_public !== true) {
      previewNifUrl = await r2.from('nif-files').authenticatedUrl(fileKey);
    }
  } catch (error) {
    try {
      await discardPartToggleVariant(fileKey, recordId, ownerId);
    } catch (cleanupError) {
      console.error('[nif-part-toggle] Orphan cleanup failed:', cleanupError?.message || cleanupError);
      const { error: fallbackDeleteError } = await r2.from('nif-files').remove([fileKey]);
      if (fallbackDeleteError) console.error('[nif-part-toggle] Fallback object cleanup failed:', fallbackDeleteError.message);
    }
    throw error;
  }

  return { openNifUrl: publicUrl, previewNifUrl, fileKey, layers };
}

export async function discardPartToggleVariant(fileKey, recordId, ownerId) {
  if (!fileKey || !recordId || !ownerId || !fileKey.startsWith(`${ownerId}/open-variants/`)) {
    throw new Error('Refusing to discard an open-state variant without matching owner-scoped identifiers.');
  }
  const sb = window._fumocaSupabase;
  if (!sb) throw new Error('Supabase session is unavailable; cannot unregister the open-state variant.');
  const { data: current, error: readError } = await sb.from('nif_files')
    .select('meta').eq('id', recordId).eq('user_id', ownerId).single();
  if (readError || !current) throw new Error(readError?.message || 'Parent NIF was not found.');
  const previous = current.meta && typeof current.meta === 'object' ? current.meta : {};
  const keys = Array.isArray(previous.open_variant_r2_keys) ? previous.open_variant_r2_keys : [];
  const nextMeta = { ...previous, open_variant_r2_keys: keys.filter(key => key !== fileKey) };
  const { data: updated, error: updateError } = await sb.from('nif_files').update({ meta: nextMeta })
    .eq('id', recordId).eq('user_id', ownerId).select('id').maybeSingle();
  if (updateError || !updated) throw new Error(updateError?.message || 'Could not unregister open-state variant.');
  if (window._fumocaCurrentRecord?.id === recordId) {
    window._fumocaCurrentRecord = { ...window._fumocaCurrentRecord, meta: nextMeta };
  }
  const { error: deleteError } = await r2.from('nif-files').remove([fileKey]);
  if (deleteError) throw new Error(deleteError.message || 'Variant unregistered but storage cleanup failed.');
}
