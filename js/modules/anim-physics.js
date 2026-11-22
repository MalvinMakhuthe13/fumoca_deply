/**
 * FUMOCA Physics — Phase 2
 * Query-only collision layer.
 * Backends:
 *   - reference: pure-JS AABB (tests, fallback)
 *   - rapier: @dimforge/rapier3d-compat@0.21.0 (production query)
 * Schema version 1 remains unchanged.
 * No response, no gravity, no second RAF.
 * Runtime handles are never persisted.
 */
const FumocaPhysics = (() => {
  const SCHEMA_VERSION = 1;
  const colliders = new Map();
  const runtime = new Map();
  let nextId = 1;
  let backend = 'reference';
  let rapier = null;
  let world = null;
  let rapierReady = false;
  let rapierError = null;

  function _id(prefix) { return prefix + '_' + (nextId++).toString(36); }
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
  function _worldFromOwner(ownerPose, localPos, localRot) {
    const op = ownerPose?.position || { x: 0, y: 0, z: 0 };
    const oq = ownerPose?.quaternion || _quatIdentity();
    const rotated = _rotateVec(oq, localPos);
    return {
      position: { x: op.x + rotated.x, y: op.y + rotated.y, z: op.z + rotated.z },
      quaternion: _mulQuat(oq, localRot),
    };
  }

  function createCollider(opts = {}) {
    const id = opts.id || _id('col');
    const type = opts.type || 'box';
    const col = {
      version: SCHEMA_VERSION,
      id,
      type,
      owner: {
        kind: opts.owner?.kind || 'object',
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
      bodyType: opts.bodyType || 'kinematic',
      material: {
        friction: Number.isFinite(opts.material?.friction) ? opts.material.friction : 0.5,
        restitution: Number.isFinite(opts.material?.restitution) ? opts.material.restitution : 0.0,
      },
      geometry: {
        source: opts.geometry?.source || 'primitive',
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
    if (backend === 'rapier' && rapierReady) _ensureRapierHandle(col);
    return col;
  }

  function setEnabled(id, enabled) {
    const c = colliders.get(id);
    if (!c) return false;
    c.enabled = !!enabled;
    const rt = runtime.get(id);
    if (rt?.collider && typeof rt.collider.setEnabled === 'function') rt.collider.setEnabled(c.enabled);
    if (!c.enabled) runtime.delete(id);
    return true;
  }

  function removeCollider(id) {
    const rt = runtime.get(id);
    if (rt?.body && world) {
      try { world.removeRigidBody(rt.body); } catch (_) {}
    }
    colliders.delete(id);
    runtime.delete(id);
  }

  async function initRapier() {
    if (rapierReady) return { ok: true, already: true };
    try {
      const mod = await import('@dimforge/rapier3d-compat');
      rapier = mod.default || mod;
      await rapier.init();
      world = new rapier.World({ x: 0, y: 0, z: 0 });
      rapierReady = true;
      rapierError = null;
      backend = 'rapier';
      for (const col of colliders.values()) _ensureRapierHandle(col);
      return { ok: true };
    } catch (e) {
      rapierError = e?.message || String(e);
      rapierReady = false;
      backend = 'reference';
      return { ok: false, error: rapierError, fallback: 'reference' };
    }
  }

  function setBackend(name) {
    if (name === 'rapier' && !rapierReady) return { ok: false, reason: 'rapier_not_ready' };
    backend = name === 'rapier' ? 'rapier' : 'reference';
    return { ok: true, backend };
  }

  function _ensureRapierHandle(col) {
    if (!rapierReady || !world) return;
    if (runtime.has(col.id)) return;
    if (col.type === 'convexHull' || col.type === 'trimesh' || col.type === 'compound') {
      runtime.set(col.id, { unsupported: true, reason: col.type + '_not_implemented' });
      return;
    }
    const desc = _makeDesc(col);
    if (!desc) return;
    const bodyDesc = col.bodyType === 'static'
      ? rapier.RigidBodyDesc.fixed()
      : rapier.RigidBodyDesc.kinematicPositionBased();
    const body = world.createRigidBody(bodyDesc);
    const collider = world.createCollider(desc, body);
    runtime.set(col.id, { body, collider, col });
  }

  function _makeDesc(col) {
    const g = col.geometry;
    let desc = null;
    if (col.type === 'box' && g.halfExtents) {
      desc = rapier.ColliderDesc.cuboid(g.halfExtents.x, g.halfExtents.y, g.halfExtents.z);
    } else if (col.type === 'sphere' && g.radius) {
      desc = rapier.ColliderDesc.ball(g.radius);
    } else if (col.type === 'capsule' && g.radius) {
      desc = rapier.ColliderDesc.capsule((g.height || 1) / 2, g.radius);
    }
    if (!desc) return null;
    desc.setCollisionGroups((col.groups & 0xffff) | ((col.mask & 0xffff) << 16));
    if (col.sensor) desc.setSensor(true);
    desc.setFriction(col.material.friction);
    desc.setRestitution(col.material.restitution);
    return desc;
  }

  function _ownerPose(col, evaluated) {
    let ownerPose = { position: { x: 0, y: 0, z: 0 }, quaternion: _quatIdentity() };
    if (col.owner.kind === 'component' && evaluated?.objects) {
      const xf = evaluated.objects[col.owner.objectId]?.[col.owner.componentId];
      if (xf) ownerPose = { position: xf.pos || ownerPose.position, quaternion: _eulerDegToQuat(xf.rot || {}) };
    } else if (col.owner.kind === 'bone' && evaluated?.skeletons) {
      const xf = evaluated.skeletons[col.owner.skeletonId]?.[col.owner.boneId];
      if (xf) ownerPose = { position: xf.pos || ownerPose.position, quaternion: xf.quat || _quatIdentity() };
    } else if (col.owner.kind === 'object' && evaluated?.objects) {
      const comps = evaluated.objects[col.owner.objectId];
      const first = comps && Object.values(comps)[0];
      if (first) ownerPose = { position: first.pos || ownerPose.position, quaternion: _eulerDegToQuat(first.rot || {}) };
    }
    return ownerPose;
  }

  function _aabbFromCollider(col, worldPose) {
    const g = col.geometry;
    let hx = 0.5, hy = 0.5, hz = 0.5;
    if (col.type === 'box' && g.halfExtents) { hx = g.halfExtents.x; hy = g.halfExtents.y; hz = g.halfExtents.z; }
    else if (col.type === 'sphere' && g.radius) { hx = hy = hz = g.radius; }
    else if (col.type === 'capsule' && g.radius) { hx = hz = g.radius; hy = (g.height || 1) / 2 + g.radius; }
    const corners = [
      { x: -hx, y: -hy, z: -hz }, { x: hx, y: -hy, z: -hz },
      { x: -hx, y: hy, z: -hz }, { x: hx, y: hy, z: -hz },
      { x: -hx, y: -hy, z: hz }, { x: hx, y: -hy, z: hz },
      { x: -hx, y: hy, z: hz }, { x: hx, y: hy, z: hz },
    ];
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const c of corners) {
      const r = _rotateVec(worldPose.quaternion, c);
      minX = Math.min(minX, r.x); maxX = Math.max(maxX, r.x);
      minY = Math.min(minY, r.y); maxY = Math.max(maxY, r.y);
      minZ = Math.min(minZ, r.z); maxZ = Math.max(maxZ, r.z);
    }
    return {
      min: { x: worldPose.position.x + minX, y: worldPose.position.y + minY, z: worldPose.position.z + minZ },
      max: { x: worldPose.position.x + maxX, y: worldPose.position.y + maxY, z: worldPose.position.z + maxZ },
    };
  }

  function syncFromEvaluation(evaluated) {
    for (const col of colliders.values()) {
      if (!col.enabled) { runtime.delete(col.id); continue; }
      const ownerPose = _ownerPose(col, evaluated);
      const worldPose = _worldFromOwner(ownerPose, col.localPosition, col.localRotation);
      if (backend === 'rapier' && rapierReady) {
        let rt = runtime.get(col.id);
        if (!rt || rt.unsupported) _ensureRapierHandle(col);
        rt = runtime.get(col.id);
        if (rt?.body && !rt.unsupported) {
          rt.body.setNextKinematicTranslation(worldPose.position);
          rt.body.setNextKinematicRotation(worldPose.quaternion);
          rt.world = worldPose;
        }
      } else {
        runtime.set(col.id, { world: worldPose, aabb: _aabbFromCollider(col, worldPose), col });
      }
    }
    if (backend === 'rapier' && world) world.step();
  }

  function _masksAllow(a, b) {
    return (a.groups & b.mask) !== 0 && (b.groups & a.mask) !== 0;
  }

  function queryOverlaps() {
    if (backend === 'rapier' && rapierReady) return _queryRapier();
    return _queryReference();
  }

  function _queryReference() {
    const active = Array.from(runtime.values()).filter(r => r.col?.enabled && r.aabb);
    const results = [];
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const A = active[i], B = active[j];
        if (!_masksAllow(A.col, B.col)) continue;
        const a = A.aabb, b = B.aabb;
        const overlap = a.min.x <= b.max.x && a.max.x >= b.min.x &&
                        a.min.y <= b.max.y && a.max.y >= b.min.y &&
                        a.min.z <= b.max.z && a.max.z >= b.min.z;
        if (!overlap) continue;
        results.push({
          colliderA: A.col.id, colliderB: B.col.id,
          ownerA: { ...A.col.owner }, ownerB: { ...B.col.owner },
          sensor: A.col.sensor || B.col.sensor,
          backend: 'reference',
        });
      }
    }
    return results;
  }

  function _queryRapier() {
    const active = Array.from(runtime.entries()).filter(([, rt]) => rt.col?.enabled && rt.collider && !rt.unsupported);
    const results = [];
    const seen = new Set();
    for (let i = 0; i < active.length; i++) {
      const [idA, rtA] = active[i];
      const shape = _shapeFor(rtA.col);
      if (!shape || !rtA.world) continue;
      const hits = [];
      world.intersectionsWithShape(rtA.world.position, rtA.world.quaternion, shape, (other) => {
        hits.push(other);
        return true;
      });
      for (const hit of hits) {
        const match = active.find(([, rt]) => rt.collider === hit);
        if (!match || match[0] === idA) continue;
        const idB = match[0];
        const key = idA < idB ? idA + '|' + idB : idB + '|' + idA;
        if (seen.has(key)) continue;
        const colA = rtA.col, colB = match[1].col;
        if (!_masksAllow(colA, colB)) continue;
        seen.add(key);
        results.push({
          colliderA: colA.id, colliderB: colB.id,
          ownerA: { ...colA.owner }, ownerB: { ...colB.owner },
          sensor: colA.sensor || colB.sensor,
          backend: 'rapier',
        });
      }
    }
    return results;
  }

  function _shapeFor(col) {
    const g = col.geometry;
    if (col.type === 'box' && g.halfExtents) return new rapier.Cuboid(g.halfExtents.x, g.halfExtents.y, g.halfExtents.z);
    if (col.type === 'sphere' && g.radius) return new rapier.Ball(g.radius);
    if (col.type === 'capsule' && g.radius) return new rapier.Capsule((g.height || 1) / 2, g.radius);
    return null;
  }

  function serialize() {
    return {
      version: SCHEMA_VERSION,
      colliders: Array.from(colliders.values()).map(c => JSON.parse(JSON.stringify(c))),
    };
  }

  function deserialize(data) {
    dispose();
    if (!data || data.version !== SCHEMA_VERSION) return false;
    for (const c of data.colliders || []) colliders.set(c.id, c);
    if (backend === 'rapier' && rapierReady) {
      for (const col of colliders.values()) _ensureRapierHandle(col);
    }
    return true;
  }

  function dispose() {
    if (world) {
      for (const rt of runtime.values()) {
        if (rt.body) { try { world.removeRigidBody(rt.body); } catch (_) {} }
      }
    }
    colliders.clear();
    runtime.clear();
  }

  return {
    SCHEMA_VERSION,
    createCollider, setEnabled, removeCollider,
    initRapier, setBackend,
    syncFromEvaluation, queryOverlaps,
    serialize, deserialize, dispose,
    getBackend: () => backend,
    isRapierReady: () => rapierReady,
    getRapierError: () => rapierError,
    list: () => Array.from(colliders.values()),
    get: (id) => colliders.get(id) || null,
  };
})();

window.FumocaPhysics = FumocaPhysics;
export default FumocaPhysics;
