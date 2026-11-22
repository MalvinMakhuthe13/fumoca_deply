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
  const hierarchy = new Map(); // objId -> Map(compId -> parentId)
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

  function registerHierarchy(objId, components) {
    const map = new Map();
    for (const c of components || []) map.set(c.id, c.parentId || null);
    hierarchy.set(objId, map);
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
      scale: {
        x: Number.isFinite(opts.scale?.x) && opts.scale.x > 0 ? opts.scale.x : 1,
        y: Number.isFinite(opts.scale?.y) && opts.scale.y > 0 ? opts.scale.y : 1,
        z: Number.isFinite(opts.scale?.z) && opts.scale.z > 0 ? opts.scale.z : 1,
      },
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

  function _removeRuntimeHandle(id) {
    const rt = runtime.get(id);
    if (rt?.body && world) {
      try { world.removeRigidBody(rt.body); } catch (_) {}
    }
    runtime.delete(id);
  }

  function setEnabled(id, enabled) {
    const c = colliders.get(id);
    if (!c) return false;
    c.enabled = !!enabled;
    if (!c.enabled) {
      // Remove the complete Rapier body/collider pair. Merely disabling the
      // collider and deleting our handle leaks an unreachable body on re-enable.
      _removeRuntimeHandle(id);
    } else if (backend === 'rapier' && rapierReady) {
      _ensureRapierHandle(c);
    }
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
    if (rapierReady && world) return { ok: true, already: true };
    try {
      const mod = await import('https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.21.0/dist/rapier.mjs');
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
    const e = _effective(col);
    let desc = null;
    if (e?.kind === 'box') desc = rapier.ColliderDesc.cuboid(e.hx, e.hy, e.hz);
    else if (e?.kind === 'sphere') desc = rapier.ColliderDesc.ball(e.r);
    else if (e?.kind === 'capsule') desc = rapier.ColliderDesc.capsule(e.h / 2, e.r);
    if (!desc) return null;
    desc.setCollisionGroups((col.groups & 0xffff) | ((col.mask & 0xffff) << 16));
    if (col.sensor) desc.setSensor(true);
    desc.setFriction(col.material.friction);
    desc.setRestitution(col.material.restitution);
    return desc;
  }

  function _compose(parent, local) {
    const rotated = _rotateVec(parent.quaternion, local.position);
    return {
      position: { x: parent.position.x + rotated.x, y: parent.position.y + rotated.y, z: parent.position.z + rotated.z },
      quaternion: _mulQuat(parent.quaternion, local.quaternion),
    };
  }

  function _componentLocal(objId, compId, evaluated) {
    const xf = evaluated?.objects?.[objId]?.[compId];
    if (!xf) return { position: { x: 0, y: 0, z: 0 }, quaternion: _quatIdentity() };
    return { position: xf.pos || { x: 0, y: 0, z: 0 }, quaternion: _eulerDegToQuat(xf.rot || {}) };
  }

  function _ownerPose(col, evaluated) {
    if (col.owner.kind === 'bone' && evaluated?.skeletons) {
      const xf = evaluated.skeletons[col.owner.skeletonId]?.[col.owner.boneId];
      if (xf) return { position: xf.pos || { x: 0, y: 0, z: 0 }, quaternion: xf.quat || _quatIdentity() };
      return { position: { x: 0, y: 0, z: 0 }, quaternion: _quatIdentity() };
    }
    if (col.owner.kind === 'component' && evaluated?.objects) {
      const objId = col.owner.objectId;
      const compId = col.owner.componentId;
      const parents = hierarchy.get(objId);
      // Walk parent chain (local transforms) then compose root-to-leaf
      const chain = [];
      let current = compId;
      const seen = new Set();
      while (current && !seen.has(current)) {
        seen.add(current);
        chain.push(current);
        current = parents?.get(current) || null;
      }
      chain.reverse();
      let pose = { position: { x: 0, y: 0, z: 0 }, quaternion: _quatIdentity() };
      for (const id of chain) pose = _compose(pose, _componentLocal(objId, id, evaluated));
      return pose;
    }
    if (col.owner.kind === 'object' && evaluated?.objects) {
      const comps = evaluated.objects[col.owner.objectId];
      const first = comps && Object.values(comps)[0];
      if (first) return { position: first.pos || { x: 0, y: 0, z: 0 }, quaternion: _eulerDegToQuat(first.rot || {}) };
    }
    return { position: { x: 0, y: 0, z: 0 }, quaternion: _quatIdentity() };
  }

  function _effective(col) {
    const s = col.scale || { x: 1, y: 1, z: 1 };
    const g = col.geometry;
    if (col.type === 'box' && g.halfExtents) {
      return { kind: 'box', hx: g.halfExtents.x * s.x, hy: g.halfExtents.y * s.y, hz: g.halfExtents.z * s.z };
    }
    if (col.type === 'sphere' && g.radius) {
      return { kind: 'sphere', r: g.radius * s.x };
    }
    if (col.type === 'capsule' && g.radius) {
      return { kind: 'capsule', r: g.radius * s.x, h: (g.height || 1) * s.y };
    }
    return null;
  }

  function _applyScale(col, worldPose) {
    const s = col.scale || { x: 1, y: 1, z: 1 };
    if (!_effective(col)) return { ok: false, reason: col.type + '_not_implemented' };
    if (!(s.x > 0) || !(s.y > 0) || !(s.z > 0) || !Number.isFinite(s.x) || !Number.isFinite(s.y) || !Number.isFinite(s.z)) {
      return { ok: false, reason: 'non_positive_scale' };
    }
    const uniform = Math.abs(s.x - s.y) < 1e-6 && Math.abs(s.y - s.z) < 1e-6;
    const rotated = Math.abs(worldPose.quaternion.x) > 1e-6 || Math.abs(worldPose.quaternion.y) > 1e-6 || Math.abs(worldPose.quaternion.z) > 1e-6;
    // Sphere cannot represent an ellipsoid. Capsule cannot represent non-uniform radial scale.
    if (col.type === 'sphere' && !uniform) return { ok: false, reason: 'non_uniform_sphere_unsupported' };
    if (col.type === 'capsule' && (Math.abs(s.x - s.z) > 1e-6 || (!uniform && rotated))) {
      return { ok: false, reason: 'non_uniform_capsule_unsupported' };
    }
    if (col.type === 'box' && !uniform && rotated) return { ok: false, reason: 'non_uniform_scale_on_rotated_primitive' };
    return { ok: true, uniform, effective: _effective(col) };
  }

  function _aabbFromCollider(col, worldPose) {
    const g = col.geometry;
    let hx = 0.5, hy = 0.5, hz = 0.5;
    const e = _effective(col);
    if (e?.kind === 'box') { hx = e.hx; hy = e.hy; hz = e.hz; }
    else if (e?.kind === 'sphere') { hx = hy = hz = e.r; }
    else if (e?.kind === 'capsule') { hx = hz = e.r; hy = e.h / 2 + e.r; }
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
      if (!col.enabled) { _removeRuntimeHandle(col.id); continue; }
      const ownerPose = _ownerPose(col, evaluated);
      const worldPose = _worldFromOwner(ownerPose, col.localPosition, col.localRotation);
      if (backend === 'rapier' && rapierReady) {
        let rt = runtime.get(col.id);
        if (!rt || rt.unsupported) _ensureRapierHandle(col);
        rt = runtime.get(col.id);
        if (rt?.body && !rt.unsupported) {
          const scaled = _applyScale(col, worldPose);
          rt.scaleResult = scaled;
          if (!scaled.ok) { rt.unsupported = true; rt.reason = scaled.reason; continue; }
          if (col.bodyType === 'static') {
            if (!rt._staticPlaced) {
              rt.body.setTranslation(worldPose.position, true);
              rt.body.setRotation(worldPose.quaternion, true);
              rt._staticPlaced = true;
              rt._staticPose = worldPose;
            } else if (rt._staticPose) {
              const dx = Math.abs(worldPose.position.x - rt._staticPose.position.x);
              const dy = Math.abs(worldPose.position.y - rt._staticPose.position.y);
              const dz = Math.abs(worldPose.position.z - rt._staticPose.position.z);
              const qa = rt._staticPose.quaternion, qb = worldPose.quaternion;
              const dot = qa.x*qb.x + qa.y*qb.y + qa.z*qb.z + qa.w*qb.w;
              const rotChanged = Math.abs(Math.abs(dot) - 1) > 1e-4;
              if (dx > 1e-4 || dy > 1e-4 || dz > 1e-4 || rotChanged) {
                rt.staticMoved = true;
                console.warn('[Physics] Static collider', col.id, 'owner transform changed. Static means fixed for scene lifetime.');
              }
            }
          } else {
            rt.body.setNextKinematicTranslation(worldPose.position);
            rt.body.setNextKinematicRotation(worldPose.quaternion);
          }
          rt.world = worldPose;
        }
      } else {
        const scaled = _applyScale(col, worldPose);
        const prev = runtime.get(col.id);
        let staticMoved = prev?.staticMoved || false;
        if (col.bodyType === 'static' && prev?.world) {
          const dx = Math.abs(worldPose.position.x - prev.world.position.x);
          const dy = Math.abs(worldPose.position.y - prev.world.position.y);
          const dz = Math.abs(worldPose.position.z - prev.world.position.z);
          const qa = prev.world.quaternion, qb = worldPose.quaternion;
          const dot = qa.x*qb.x + qa.y*qb.y + qa.z*qb.z + qa.w*qb.w;
          if (dx > 1e-4 || dy > 1e-4 || dz > 1e-4 || Math.abs(Math.abs(dot) - 1) > 1e-4) staticMoved = true;
        }
        runtime.set(col.id, { world: worldPose, aabb: scaled.ok ? _aabbFromCollider(col, worldPose) : null, col, scaleResult: scaled, unsupported: !scaled.ok, reason: scaled.ok ? null : scaled.reason, staticMoved });
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
    const active = Array.from(runtime.values()).filter(r => r.col?.enabled && r.aabb && !r.unsupported);
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
    const e = _effective(col);
    if (e?.kind === 'box') return new rapier.Cuboid(e.hx, e.hy, e.hz);
    if (e?.kind === 'sphere') return new rapier.Ball(e.r);
    if (e?.kind === 'capsule') return new rapier.Capsule(e.h / 2, e.r);
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
    // Retain the initialized Rapier world for reuse. Remove all bodies and clear definitions.
    if (world) {
      for (const rt of runtime.values()) {
        if (rt.body) { try { world.removeRigidBody(rt.body); } catch (_) {} }
      }
    }
    colliders.clear();
    runtime.clear();
    hierarchy.clear();
  }

  return {
    SCHEMA_VERSION,
    registerHierarchy, createCollider, setEnabled, removeCollider,
    initRapier, setBackend,
    syncFromEvaluation, queryOverlaps,
    serialize, deserialize, dispose,
    getBackend: () => backend,
    isRapierReady: () => rapierReady,
    getRapierError: () => rapierError,
    list: () => Array.from(colliders.values()),
    get: (id) => colliders.get(id) || null,
    getWorldPose: (id) => runtime.get(id)?.world || null,
    getStaticMoved: (id) => !!runtime.get(id)?.staticMoved,
    getLastScaleResult: (id) => runtime.get(id)?.scaleResult || null,
    getRuntimeCounts: () => ({
      bodies: world?.bodies?.len?.() ?? null,
      colliders: world?.colliders?.len?.() ?? null,
    }),
  };
})();

window.FumocaPhysics = FumocaPhysics;
export default FumocaPhysics;
