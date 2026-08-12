/**
 * NIFHingeAuthor — persist a hinge/slide definition into a NIF's PHYSICS chunk
 * fumoca.co.za · © Fumoca Technologies
 *
 * WHY THIS FILE EXISTS
 * ─────────────────────
 * Without this, the only way to animate a layer was to hand-write pivot/
 * axis/angle into a single hotspot's action JSON — authored once, usable
 * from exactly that one hotspot, gone the moment someone edits the hotspot
 * away. This module is what NIFAnimator.js's own "still not built" list
 * calls out: a real (if not yet graphical) way to define a hinge/slide ONCE
 * per layer and have it live in the file itself, in the PHYSICS chunk
 * encodePhysicsChunk()/decodePhysicsChunk() already support in NIFSpec.js —
 * so `{type:'animate', layer:'door_front_left'}` with zero other fields is
 * enough on any hotspot, forever, because the renderer's NIFAnimator reads
 * the authored pivot/axis/angle straight from the file.
 *
 * WHAT THIS IS NOT: a 3D click-to-set-pivot UI. This is the API such a UI
 * would call — today it's called with explicit numbers (from devtools, a
 * simple form, or suggestHingePivot()'s heuristic below), not a click
 * gesture in the viewport. That gesture is real, separate, unbuilt work.
 *
 * USAGE (e.g. from a browser console against a loaded NIFViewer):
 *   import { defineHinge, suggestHingePivot } from './NIFHingeAuthor.js';
 *   const layer = viewer._layers.find(l => l.label === 'door_front_left');
 *   const pivot = suggestHingePivot(layer, [0,1,0]);
 *   const { physics, chunk } = defineHinge(viewer._physics, 'door_front_left', {
 *     axis: [0,1,0], pivot, angleMax: 55,
 *   });
 *   // `chunk` is a ready-to-persist NIFChunk — hand it to encodeNif()'s
 *   // passthroughChunks (replacing the existing PHYSICS entry) on next publish.
 */

import { v3 } from '../math/NIFMath.js';
import { encodePhysicsChunk } from '../format/NIFSpec.js';

/**
 * Build an updated {bodies, constraints} physics object with a hinge (or
 * slide) definition for `label` added/replaced, and the corresponding
 * encoded PHYSICS chunk ready to persist.
 *
 * @param {{bodies:Array, constraints:Array}} existingPhysics  current decoded PHYSICS chunk (or {bodies:[],constraints:[]})
 * @param {string} label     layer label this definition applies to (matches a LAYER_GEO label)
 * @param {object} def
 *   kind        'hinge' | 'slide', default 'hinge'
 *   // hinge:
 *   axis        [x,y,z]  default [0,1,0]
 *   pivot       [x,y,z]  required for a meaningful result — see suggestHingePivot() below
 *   angleMax    number    degrees, default 60
 *   // slide:
 *   direction   [x,y,z]  default [0,0,1]
 *   distance    number    world units, default 0.3
 * @returns {{physics: object, chunk: object}}
 */
export function defineHinge(existingPhysics, label, def = {}) {
  if (!label) throw new Error('defineHinge requires a label matching a LAYER_GEO layer');
  const kind = def.kind === 'slide' ? 'slide' : 'hinge';
  const constraintType = kind === 'slide' ? 'slide' : 'joint';

  const physics = {
    bodies: [...(existingPhysics?.bodies ?? [])],
    constraints: [...(existingPhysics?.constraints ?? [])],
  };

  if (!physics.bodies.find(b => b.objectId === label)) {
    physics.bodies.push({ objectId: label, type: 'rigid' });
  }

  // Replace any existing definition of the same kind for this label —
  // one hinge (or one slide) definition per label, last write wins.
  physics.constraints = physics.constraints.filter(
    c => !(c.bodyA === label && c.type === constraintType)
  );

  const params = kind === 'slide'
    ? { direction: v3.norm(def.direction ?? [0, 0, 1]), distance: def.distance ?? 0.3 }
    : { axis: v3.norm(def.axis ?? [0, 1, 0]), pivot: def.pivot ?? [0, 0, 0],
        angleMin: 0, angleMax: def.angleMax ?? 60 };

  if (kind === 'hinge' && !def.pivot) {
    console.warn(`[NIFHingeAuthor] defineHinge("${label}") called with no pivot — ` +
      `defaulting to [0,0,0], which is almost certainly wrong. Use suggestHingePivot() ` +
      `for a real starting guess, or pass the actual hinge-edge coordinates.`);
  }

  physics.constraints.push({ type: constraintType, bodyA: label, bodyB: 'world', params });

  const chunk = encodePhysicsChunk(physics);
  return { physics, chunk };
}

/**
 * Remove a layer's hinge/slide definition entirely.
 */
export function removeHinge(existingPhysics, label) {
  const physics = {
    bodies: (existingPhysics?.bodies ?? []).filter(b => b.objectId !== label),
    constraints: (existingPhysics?.constraints ?? []).filter(c => c.bodyA !== label),
  };
  return { physics, chunk: encodePhysicsChunk(physics) };
}

/**
 * A real geometric starting guess for a hinge pivot — the bounding-box edge
 * (perpendicular to `axis`) furthest from the layer's own centroid along its
 * widest dimension. Same heuristic NIFAnimator.js falls back to when no
 * pivot is authored at all; exposed here standalone so it can be called
 * without a live renderer/animator instance (e.g. from an authoring form
 * that only has the decoded layer data).
 *
 * This is a GUESS, not a measurement — it's picking a bbox extreme, not
 * finding the actual physical hinge line. Good enough to get a plausible
 * door-swing on the first try for a lot of real captures; wrong often
 * enough that anyone shipping a real configurator should override it with
 * a measured/clicked pivot.
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
