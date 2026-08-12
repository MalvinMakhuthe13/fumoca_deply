/**
 * NIFAnimator — part-level hinge & slide animation
 * fumoca.co.za · © Fumoca Technologies
 *
 * WHY THIS FILE EXISTS
 * ─────────────────────
 * Before this session: engine-next/physics/NIFPhysics.js has a genuinely real
 * physics engine (RigidBody, ConstraintNetwork with hinges, SpringDamper —
 * explicitly commented "automotive suspension, elastic joints, furniture
 * springs"). But grep the whole repo and NOTHING ever imports RigidBody,
 * ConstraintNetwork, or SpringDamper outside NIFPhysics.js itself.
 * hotspot-actions.js already had a `case 'state'` whose comment says
 * "Configurators use this to change colours, toggle doors, etc." — but
 * nothing listened for that event. NIFRenderer.loadLayers() stored layer
 * data and logged it — no layer was ever rendered or moved. Every
 * ingredient for "click a hotspot, watch a car door open" existed in
 * isolation. This file — plus the LAYER_GEO indices added to pipeline.py
 * and NIFViewer.js the same session — is the connection.
 *
 * v2 (this pass) — two upgrades from the first working version:
 *   1. Reads the PHYSICS chunk (bodies/constraints — encodePhysicsChunk()/
 *      decodePhysicsChunk() already existed in NIFSpec.js, unused by any
 *      writer or by this animator until now) as the persisted source of
 *      hinge/slide definitions. Previously pivot/axis/angle had to be
 *      hand-authored into every hotspot's action JSON, per hotspot, with no
 *      way to save it back to the file. Now: define it once (see
 *      NIFHingeAuthor.js), it lives in the .nif, and a hotspot action can
 *      just say `{type:'animate', layer:'door_front_left'}`.
 *   2. Adds playSlide() (linear translation) alongside playHinge() —
 *      drawers, trays, sliding covers — not just rotating parts.
 *
 * STILL NOT BUILT — flagging rather than implying it exists:
 *   - A click-to-set-pivot 3D authoring UI. NIFHingeAuthor.js gives a real,
 *     callable API and a much better geometric default than pure centroid,
 *     but "click the actual hinge edge in the viewport" is a 3D-picking UI
 *     feature that doesn't exist yet.
 *   - Multi-step choreography / timelines (open door, THEN open trunk, THEN
 *     ...). Each trigger plays exactly one animation on one layer. Sequencing
 *     is possible today via the existing `'multi'` action type with `delay`,
 *     calling several `'animate'` actions in order — but there's no
 *     dedicated timeline/keyframe editor for it.
 *   - Anisotropic splat rotation — this only moves point positions, not the
 *     per-splat orientation quaternion, because the live NIFRenderer's
 *     shader treats splats as isotropic billboards and doesn't consume
 *     orientation yet (see nif-format.js's comment on that).
 */

import { GaussianEdit, Quat, v3, clamp, smoothstep } from '../math/NIFMath.js';

export class NIFAnimator {
  /**
   * @param {{count:number, data:Float32Array}} gaussians  same object NIFRenderer holds —
   *   mutated in place (data is reassigned) so the renderer's existing
   *   `this.gaussians.data` reference stays the source of truth.
   * @param {Array} layers    decoded LAYER_GEO layers, each optionally carrying `.indices`
   * @param {{bodies:Array, constraints:Array}} physics   decoded PHYSICS chunk, if any
   */
  constructor(gaussians, layers = [], physics = { bodies: [], constraints: [] }) {
    this.gaussians = gaussians;
    this.layersByLabel = new Map(layers.filter(l => l?.label).map(l => [l.label, l]));
    this._active = null;         // in-flight animation state, or null
    this._openAngle = new Map(); // label -> current accumulated angle (radians), for toggle support
    this._slideOffset = new Map(); // label -> current accumulated offset [x,y,z], for toggle support

    // Index PHYSICS constraints by the layer (objectId) they move, so
    // playHinge()/playSlide() can be called with just a label and pick up
    // an authored pivot/axis/angle instead of requiring per-call opts.
    this._jointDefs = new Map();   // label -> {type:'joint', params}
    this._slideDefs = new Map();   // label -> {type:'slide', params}
    for (const c of physics?.constraints ?? []) {
      if (c.type === 'joint' && c.bodyA) this._jointDefs.set(c.bodyA, c);
      if (c.type === 'slide' && c.bodyA) this._slideDefs.set(c.bodyA, c);
    }
  }

  hasAnimatableLayer(label) {
    const l = this.layersByLabel.get(label);
    return !!(l && l.indices && l.indices.length);
  }

  isAnimating() { return !!this._active; }

  /**
   * Trigger a hinge rotation on a named layer.
   * @param {string} label   layer label, e.g. "segment_3" or "door_front_left"
   * @param {object} opts    all optional — each falls back to an authored
   *   PHYSICS joint definition for this label if one exists, then to a
   *   computed default:
   *     pivot        [x,y,z]   rotation pivot. Default: see _defaultHingePivot()
   *                            below — a bounding-box-edge heuristic, not a
   *                            substitute for an authored pivot.
   *     axis         [x,y,z]   rotation axis, default [0,1,0] (yaw). Normalized internally.
   *     angleDeg     number    target open angle in degrees, default 60
   *     durationMs   number    animation duration, default 900
   *     toggle       boolean   if true (default) and already open, animates closed instead
   *     onDone       function
   * @returns {boolean} true if the animation started
   */
  playHinge(label, opts = {}) {
    if (!this.hasAnimatableLayer(label)) {
      console.warn(`[NIFAnimator] Layer "${label}" has no usable indices — ` +
        `either the label doesn't exist in this file's LAYER_GEO chunk, or ` +
        `it was written before pipeline.py started packing indices. Can't animate it.`);
      return false;
    }
    const layer = this.layersByLabel.get(label);
    const joint = this._jointDefs.get(label);
    const axis  = v3.norm(opts.axis ?? joint?.params?.axis ?? [0, 1, 0]);
    const pivot = opts.pivot ?? joint?.params?.pivot ?? this._defaultHingePivot(layer, axis);
    const targetAngle = (opts.angleDeg ?? joint?.params?.angleMax ?? 60) * Math.PI / 180;
    const currentAngle = this._openAngle.get(label) ?? 0;
    const toggle = opts.toggle !== false;
    const toAngle = (toggle && Math.abs(currentAngle) > 1e-3) ? 0 : targetAngle;

    this._active = {
      kind: 'hinge', label,
      indices: layer.indices,
      pivot, axis,
      fromAngle: currentAngle, toAngle, lastAppliedAngle: currentAngle,
      elapsed: 0,
      duration: Math.max(0.05, (opts.durationMs ?? 900) / 1000),
      onDone: opts.onDone,
    };
    return true;
  }

  /**
   * Trigger a linear slide on a named layer — a drawer, a tray, a sliding cover.
   * @param {string} label
   * @param {object} opts
   *   direction    [x,y,z]   slide direction (normalized internally), default authored
   *                          slide def's direction, or [0,0,1] if none
   *   distance     number    slide distance in world units, default authored def's
   *                          distance, or 0.3
   *   durationMs, toggle, onDone — same as playHinge
   */
  playSlide(label, opts = {}) {
    if (!this.hasAnimatableLayer(label)) {
      console.warn(`[NIFAnimator] Layer "${label}" has no usable indices — can't slide it.`);
      return false;
    }
    const layer = this.layersByLabel.get(label);
    const slideDef = this._slideDefs.get(label);
    const direction = v3.norm(opts.direction ?? slideDef?.params?.direction ?? [0, 0, 1]);
    const distance  = opts.distance ?? slideDef?.params?.distance ?? 0.3;
    const currentOffset = this._slideOffset.get(label) ?? [0, 0, 0];
    const currentDist   = v3.len(currentOffset);
    const toggle = opts.toggle !== false;
    const toDistance = (toggle && currentDist > 1e-3) ? 0 : distance;

    this._active = {
      kind: 'slide', label,
      indices: layer.indices,
      direction,
      fromOffset: currentOffset, toDistance,
      lastAppliedOffset: currentOffset,
      elapsed: 0,
      duration: Math.max(0.05, (opts.durationMs ?? 900) / 1000),
      onDone: opts.onDone,
    };
    return true;
  }

  /** Call once per render frame with real elapsed seconds. No-op if nothing is animating. */
  tick(dt) {
    const a = this._active;
    if (!a) return;

    a.elapsed += dt;
    const t = clamp(a.elapsed / a.duration, 0, 1);
    const eased = smoothstep(0, 1, t);

    if (a.kind === 'hinge') {
      const angle = a.fromAngle + (a.toAngle - a.fromAngle) * eased;
      // Apply only the INCREMENTAL rotation since last frame — rotations
      // about a fixed shared axis commute, so accumulating small per-frame
      // deltas gives the same result as rotating from a pristine base by
      // the absolute angle each time, without keeping a separate copy around.
      const delta = angle - a.lastAppliedAngle;
      if (Math.abs(delta) > 1e-7) {
        const q = Quat.fromAxisAngle(a.axis, delta);
        this.gaussians.data = GaussianEdit.rotate(this.gaussians.data, a.indices, a.pivot, q);
        a.lastAppliedAngle = angle;
      }
      if (t >= 1) { this._openAngle.set(a.label, a.toAngle); this._finish(a); }
    } else { // slide
      const dist = eased * a.toDistance;
      const targetOffset = v3.scale(a.direction, dist);
      const delta = v3.sub(targetOffset, a.lastAppliedOffset);
      if (v3.len(delta) > 1e-7) {
        this.gaussians.data = GaussianEdit.translate(this.gaussians.data, a.indices, delta);
        a.lastAppliedOffset = targetOffset;
      }
      if (t >= 1) { this._slideOffset.set(a.label, targetOffset); this._finish(a); }
    }
  }

  _finish(a) {
    const done = a.onDone;
    this._active = null;
    done?.();
  }

  // Default hinge pivot when neither an authored PHYSICS joint definition
  // nor an explicit opts.pivot is given: the bounding-box edge midpoint on
  // the side FARTHEST from the layer's own centroid along the plane
  // perpendicular to the rotation axis. For a side-hinged door (axis =
  // world-up), this picks whichever vertical edge of the door's bounding
  // box is furthest from its own center — the far edge from a hinge is
  // never the hinge itself, but the NEAR edge usually is, so this is a
  // meaningfully better guess than dead-center. Still a heuristic, not a
  // substitute for an authored pivot (see NIFHingeAuthor.js) — most real
  // hinges aren't at either literal bbox corner.
  _defaultHingePivot(layer, axis) {
    const { data, count } = layer;
    if (!count) return [0, 0, 0];
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

    // Pick the bbox axis with the largest extent that's roughly
    // perpendicular to the rotation axis — that's the door's "width"
    // direction, and one of its two ends is the hinge.
    const extents = [
      { axis: [1,0,0], min: minX, max: maxX, along: Math.abs(v3.dot([1,0,0], axis)) },
      { axis: [0,1,0], min: minY, max: maxY, along: Math.abs(v3.dot([0,1,0], axis)) },
      { axis: [0,0,1], min: minZ, max: maxZ, along: Math.abs(v3.dot([0,0,1], axis)) },
    ].filter(e => e.along < 0.5); // drop the axis that's parallel-ish to rotation axis
    if (!extents.length) return centroid;
    extents.sort((a, b) => (b.max - b.min) - (a.max - a.min));
    const widest = extents[0];
    // Default to the MIN end — arbitrary but consistent; callers who know
    // better should pass an explicit pivot.
    const pivot = [...centroid];
    const dim = widest.axis[0] ? 0 : widest.axis[1] ? 1 : 2;
    pivot[dim] = widest.min;
    return pivot;
  }
}
