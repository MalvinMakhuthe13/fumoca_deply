/**
 * FUMOCA Physics — Phase 0/1
 * Query-only collision layer.
 * Rapier is the intended production backend.
 * This module provides the versioned schema, transform sync, and a pure-JS
 * reference query backend used for automated tests.
 * No collision response. No gravity. No second RAF loop.
 *
 * Conventions (match anim-master / anim-object):
 * - Units: metres
 * - Rotation stored as quaternion {x,y,z,w} for colliders
 * - Object component tracks use Euler degrees; converted on sync
 * - Local position relative to owner
 * - Composition: ownerWorld * localCollider
 * - Runtime handles are never persisted
 */
const FumocaPhysics = (() => {
  const SCHEMA_VERSION = 1;
  const colliders = new Map();
  const runtime = new Map(); // id -> { aabb, center, ... } rebuilt on sync
  let nextId = 1;

  function _id(prefix) {
    return prefix + '_' + (nextId++).toString(36);
  }

  function _quatIdentity() { return { x: 0, y: 0, z: 0, w: 1 }; }
  function _vec(v) { return { x: Number(v?.x) || 0, y: Number(v?.y) || 0, z: Number(v?.z) || 0 }; }
  function _quat(q) {
    const out = { x: Number(q?.x) || 0, y: Number(q?.y) || 0, z: Number(q?.z) || 0, w: Number(q?.w) ?? 1 };
    const len = Math.hypot(out.x, out.y, out.z, out.w) || 1;
    return { x: out.x / len, y: out.y / len, z: out.z / len, w: out.w / len };
  }
  function _eulerDegToQuat(e) {
    const rx = (e?.x || 0) * Math.PI / 180, ry = (e?.y || 0) * Math.PI / 180, rz = (e?.z || 0) * Math.PI / 180;
    const cx = Math.cos(rx / 2), sx = Math.sin(rx / 2);
    const cy = Math.cos(ry / 2), sy = Math.sin(ry / 2);
    const cz = Math.cos(rz / 2), sz = Math.sin(rz / 2);
    return _quat({
      x: sx * cy * cz - cx * sy * sz,
      y: cx * sy * cz + sx * cy * sz,
      z: cx * cy * sz - sx * sy * cz,
      w: cx * cy * cz + sx * sy * sz,
    });
  }
  function _rotateVec(q, v) {
    const x = v.x, y = v.y, z = v.z;
    const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
    const ix = qw * x + qy * z - qz * y;
    const iy = qw * y + qz * x - qx * z;
    const iz = qw * z + qx * y - qy * x;
    const iw = -qx * x - qy * y - qz * z;
    return {
      x: ix * qw + iw * -qx + iy * -qz - iz * -qy,
      y: iy * qw + iw * -qy + iz * -qx - ix * -qz,
      z: iz * qw + iw * -qz + ix * -qy - iy * -qx,
    };
  }
  function _mulQuat(a, b) {
    return _quat({
      x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
      y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
      z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
      w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    });
  }

  function createCollider(opts = {}) {
    const id = opts.id || _id('col');
    const type = opts.type || 'box';
    const col = {
      version: SCHEMA_VERSION,
      id,
      type,
      owner: {
        kind: opts.owner?.kind || 'object', // object | component | bone | environment
        objectId: opts.owner?.objectId || null,
        componentId: opts.owner?.componentId || null,
        skeletonId: opts.owner?.skeletonId || null,
        boneId: opts.owner?.boneId || null,
      },
      localPosition: _vec(opts.localPosition),
      localRotation: _quat(opts.localRotation || _quatIdentity()),
      groups: Number.isFinite(opts.groups) ? opts.groups : 0xffffffff,
      mask: Number.isFinite(opts.mask) ? opts.mask : 0xffffffff,
      sensor: !!opts.sensor,
      enabled: opts.enabled !== false,
      bodyType: opts.bodyType || 'kinematic', // static | kinematic | dynamic
      material: {
        friction: Number.isFinite(opts.material?.friction) ? opts.material.friction : 0.5,
        restitution: Number.isFinite(opts.material?.restitution) ? opts.material.restitution : 0.0,
      },
      geometry: {
        source: opts.geometry?.source || 'primitive', // primitive | openmvs | glb
        ref: opts.geometry?.ref || null,
        halfExtents: type === 'box' ? _vec(opts.halfExtents || { x: 0.5, y: 0.5, z: 0.5 }) : null,
        radius: type === 'sphere' || type === 'capsule' ? (Number(opts.radius) || 0.5) : null,
        height: type === 'capsule' ? (Number(opts.height) || 1) : null,
        points: type === 'convexHull' ? (opts.points || []) : null,
        triangles: type === 'trimesh' ? (opts.triangles || []) : null,
        children: type === 'compound' ? (opts.children || []) : null,
      },
    };
    colliders.set(id, col);
    return col;
  }

  function setEnabled(id, enabled) {
    const c = colliders.get(id);
    if (!c) return false;
    c.enabled = !!enabled;
    return true;
  }

  function removeCollider(id) {
    colliders.delete(id);
    runtime.delete(id);
  }

  function _worldFromOwner(ownerPose, localPos, localRot) {
    const op = ownerPose?.position || { x: 0, y: 0, z: 0 };
    const oq = ownerPose?.quaternion || _quatIdentity();
    const rotated = _rotateVec(oq, localPos);
    return {
      position: { x: op.x + rotated.x, y: op.y + rotated.y, z: op.z + rotated.z },
      quaternion: _mulQuat(oq, localRot),
    };
  }

  function _aabbFromCollider(col, world) {
    const g = col.geometry;
    let hx = 0.5, hy = 0.5, hz = 0.5;
    if (col.type === 'box' && g.halfExtents) {
      hx = g.halfExtents.x; hy = g.halfExtents.y; hz = g.halfExtents.z;
    } else if (col.type === 'sphere' && g.radius) {
      hx = hy = hz = g.radius;
    } else if (col.type === 'capsule' && g.radius) {
      hx = hz = g.radius;
      hy = (g.height || 1) / 2 + g.radius;
    } else if (col.type === 'convexHull' && g.points?.length) {
      let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      for (const p of g.points) {
        const r = _rotateVec(world.quaternion, p);
        minX = Math.min(minX, r.x); maxX = Math.max(maxX, r.x);
        minY = Math.min(minY, r.y); maxY = Math.max(maxY, r.y);
        minZ = Math.min(minZ, r.z); maxZ = Math.max(maxZ, r.z);
      }
      return {
        min: { x: world.position.x + minX, y: world.position.y + minY, z: world.position.z + minZ },
        max: { x: world.position.x + maxX, y: world.position.y + maxY, z: world.position.z + maxZ },
      };
    }
    // Approximate oriented box by axis-aligned extents of the 8 corners
    const corners = [
      { x: -hx, y: -hy, z: -hz }, { x: hx, y: -hy, z: -hz },
      { x: -hx, y: hy, z: -hz }, { x: hx, y: hy, z: -hz },
      { x: -hx, y: -hy, z: hz }, { x: hx, y: -hy, z: hz },
      { x: -hx, y: hy, z: hz }, { x: hx, y: hy, z: hz },
    ];
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const c of corners) {
      const r = _rotateVec(world.quaternion, c);
      minX = Math.min(minX, r.x); maxX = Math.max(maxX, r.x);
      minY = Math.min(minY, r.y); maxY = Math.max(maxY, r.y);
      minZ = Math.min(minZ, r.z); maxZ = Math.max(maxZ, r.z);
    }
    return {
      min: { x: world.position.x + minX, y: world.position.y + minY, z: world.position.z + minZ },
      max: { x: world.position.x + maxX, y: world.position.y + maxY, z: world.position.z + maxZ },
    };
  }

  function syncFromEvaluation(evaluated) {
    // evaluated: { objects: { objId: { compId: { pos, rot, type, axis } } }, skeletons: { skelId: { boneId: { pos, quat } } } }
    for (const col of colliders.values()) {
      if (!col.enabled) { runtime.delete(col.id); continue; }
      let ownerPose = { position: { x: 0, y: 0, z: 0 }, quaternion: _quatIdentity() };
      if (col.owner.kind === 'component' && evaluated?.objects) {
        const xf = evaluated.objects[col.owner.objectId]?.[col.owner.componentId];
        if (xf) {
          ownerPose = {
            position: xf.pos || { x: 0, y: 0, z: 0 },
            quaternion: _eulerDegToQuat(xf.rot || { x: 0, y: 0, z: 0 }),
          };
        }
      } else if (col.owner.kind === 'bone' && evaluated?.skeletons) {
        const xf = evaluated.skeletons[col.owner.skeletonId]?.[col.owner.boneId];
        if (xf) {
          ownerPose = { position: xf.pos || { x: 0, y: 0, z: 0 }, quaternion: xf.quat || _quatIdentity() };
        }
      } else if (col.owner.kind === 'object' && evaluated?.objects) {
        const comps = evaluated.objects[col.owner.objectId];
        const first = comps && Object.values(comps)[0];
        if (first) {
          ownerPose = {
            position: first.pos || { x: 0, y: 0, z: 0 },
            quaternion: _eulerDegToQuat(first.rot || { x: 0, y: 0, z: 0 }),
          };
        }
      }
      const world = _worldFromOwner(ownerPose, col.localPosition, col.localRotation);
      runtime.set(col.id, { world, aabb: _aabbFromCollider(col, world), col });
    }
  }

  function _aabbOverlap(a, b) {
    return a.min.x <= b.max.x && a.max.x >= b.min.x &&
           a.min.y <= b.max.y && a.max.y >= b.min.y &&
           a.min.z <= b.max.z && a.max.z >= b.min.z;
  }

  function _masksAllow(a, b) {
    return (a.groups & b.mask) !== 0 && (b.groups & a.mask) !== 0;
  }

  function queryOverlaps() {
    const active = Array.from(runtime.values()).filter(r => r.col.enabled);
    const results = [];
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const A = active[i], B = active[j];
        if (!_masksAllow(A.col, B.col)) continue;
        if (!_aabbOverlap(A.aabb, B.aabb)) continue;
        results.push({
          colliderA: A.col.id,
          colliderB: B.col.id,
          ownerA: { ...A.col.owner },
          ownerB: { ...B.col.owner },
          sensor: A.col.sensor || B.col.sensor,
          // No response: report only
        });
      }
    }
    return results;
  }

  function serialize() {
    return {
      version: SCHEMA_VERSION,
      colliders: Array.from(colliders.values()).map(c => JSON.parse(JSON.stringify(c))),
    };
  }

  function deserialize(data) {
    colliders.clear();
    runtime.clear();
    if (!data || data.version !== SCHEMA_VERSION) return false;
    for (const c of data.colliders || []) {
      colliders.set(c.id, c);
    }
    return true;
  }

  function dispose() {
    colliders.clear();
    runtime.clear();
  }

  return {
    SCHEMA_VERSION,
    createCollider, setEnabled, removeCollider,
    syncFromEvaluation, queryOverlaps,
    serialize, deserialize, dispose,
    list: () => Array.from(colliders.values()),
    get: (id) => colliders.get(id) || null,
  };
})();

window.FumocaPhysics = FumocaPhysics;
export default FumocaPhysics;
