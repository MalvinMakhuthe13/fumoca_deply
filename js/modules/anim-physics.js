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
  const bindings = new Map(); // colliderId -> { node, parent, localPosition, localRotation }
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
      // Mass model: density if set, otherwise mass, otherwise 1. Density is preferred for volume-based bodies.
      mass: Number.isFinite(opts.mass) && opts.mass > 0 ? opts.mass : null,
      density: Number.isFinite(opts.density) && opts.density > 0 ? opts.density : null,
      gravityScale: Number.isFinite(opts.gravityScale) ? opts.gravityScale : 1,
      linearDamping: Number.isFinite(opts.linearDamping) ? opts.linearDamping : 0.1,
      angularDamping: Number.isFinite(opts.angularDamping) ? opts.angularDamping : 0.1,
      lockRotations: !!opts.lockRotations,
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

  function setEnabled(id, enabled) {
    const c = colliders.get(id);
    if (!c) return false;
    c.enabled = !!enabled;
    const rt = runtime.get(id);
    if (!c.enabled) {
      if (rt?.body && world) { try { world.removeRigidBody(rt.body); } catch (_) {} }
      runtime.delete(id);
    } else if (!rt && backend === 'rapier' && rapierReady) {
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

  async function initRapier(preloaded) {
    if (rapierReady && world) return { ok: true, already: true };
    try {
      const mod = preloaded || await import('https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.21.0/dist/rapier.mjs');
      rapier = mod.default || mod;
      await rapier.init();
      world = new rapier.World({ x: 0, y: -9.81, z: 0 });
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
    let bodyDesc;
    if (col.bodyType === 'static') bodyDesc = rapier.RigidBodyDesc.fixed();
    else if (col.bodyType === 'dynamic') bodyDesc = rapier.RigidBodyDesc.dynamic();
    else bodyDesc = rapier.RigidBodyDesc.kinematicPositionBased();
    if (col.bodyType === 'dynamic') {
      if (col.density) bodyDesc.setDensity(col.density);
      else bodyDesc.setAdditionalMass(col.mass || 1);
      bodyDesc.setGravityScale(col.gravityScale);
      bodyDesc.setLinearDamping(col.linearDamping);
      bodyDesc.setAngularDamping(col.angularDamping);
      if (col.lockRotations) bodyDesc.lockRotations();
    }
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
      if (!col.enabled) {
        const rt = runtime.get(col.id);
        if (rt?.body && world) { try { world.removeRigidBody(rt.body); } catch (_) {} }
        runtime.delete(col.id);
        continue;
      }
      const ownerPose = _ownerPose(col, evaluated);
      let worldPose = _worldFromOwner(ownerPose, col.localPosition, col.localRotation);
      const authoredPose = worldPose;
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
          } else if (col.bodyType === 'dynamic') {
            if (!rt._dynamicInit) {
              rt.body.setTranslation(worldPose.position, true);
              rt.body.setRotation(worldPose.quaternion, true);
              rt.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
              rt.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
              rt._dynamicInit = true;
              rt._initialPose = worldPose;
            } else {
              const t = rt.body.translation();
              const r = rt.body.rotation();
              worldPose = { position: { x: t.x, y: t.y, z: t.z }, quaternion: { x: r.x, y: r.y, z: r.z, w: r.w } };
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
    // No world.step() here. Simulation advances only via step(dt).
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
    const e = _effective(col);
    if (e?.kind === 'box') return new rapier.Cuboid(e.hx, e.hy, e.hz);
    if (e?.kind === 'sphere') return new rapier.Ball(e.r);
    if (e?.kind === 'capsule') return new rapier.Capsule(e.h / 2, e.r);
    return null;
  }

  const sim = { fixedDt: 1/60, accumulator: 0, maxSubsteps: 4, simTime: 0, maxFrameDt: 0.1 };

  function setGravity(g) {
    if (!g || !Number.isFinite(g.x) || !Number.isFinite(g.y) || !Number.isFinite(g.z)) return { ok: false, reason: 'invalid_gravity' };
    if (world && typeof world.gravity === 'object') {
      world.gravity = g;
    }
    return { ok: true, gravity: g };
  }
  function getGravity() {
    if (world && world.gravity) return { x: world.gravity.x, y: world.gravity.y, z: world.gravity.z };
    return { x: 0, y: -9.81, z: 0 };
  }
  function getBodyCount() {
    if (!world) return 0;
    try { return world.bodies.len(); } catch (_) { return runtime.size; }
  }
  function getColliderCount() {
    if (!world) return 0;
    try { return world.colliders.len(); } catch (_) { return runtime.size; }
  }
  function worldToParentLocal(worldPose, parentWorldMatrix) {
    if (!parentWorldMatrix || typeof THREE === 'undefined') {
      return { ok: false, reason: 'three_or_parent_unavailable', world: worldPose };
    }
    try {
      const inv = parentWorldMatrix.clone().invert();
      const v = new THREE.Vector3(worldPose.position.x, worldPose.position.y, worldPose.position.z).applyMatrix4(inv);
      const q = new THREE.Quaternion().setFromRotationMatrix(inv);
      const wq = new THREE.Quaternion(worldPose.quaternion.x, worldPose.quaternion.y, worldPose.quaternion.z, worldPose.quaternion.w);
      q.multiply(wq);
      return { ok: true, position: { x: v.x, y: v.y, z: v.z }, quaternion: { x: q.x, y: q.y, z: q.z, w: q.w } };
    } catch (e) {
      return { ok: false, reason: 'conversion_failed', error: e.message };
    }
  }
  function setFixedTimestep(dt) { if (dt > 0) sim.fixedDt = dt; }
  function setMaxSubsteps(n) { if (n > 0) sim.maxSubsteps = n; }

  function step(frameDt) {
    if (backend !== 'rapier' || !world) return { stepped: 0, reason: 'not_rapier' };
    const dt = Math.min(Math.max(0, Number(frameDt) || 0), sim.maxFrameDt);
    sim.accumulator += dt;
    let stepped = 0;
    while (sim.accumulator >= sim.fixedDt && stepped < sim.maxSubsteps) {
      world.step();
      sim.accumulator -= sim.fixedDt;
      sim.simTime += sim.fixedDt;
      stepped++;
    }
    if (stepped === sim.maxSubsteps) sim.accumulator = 0;
    return { stepped, simTime: sim.simTime, accumulator: sim.accumulator };
  }

  function reset() {
    sim.accumulator = 0;
    sim.simTime = 0;
    for (const rt of runtime.values()) {
      if (!rt.body || rt.unsupported) continue;
      if (rt.col.bodyType === 'dynamic' && rt._initialPose) {
        rt.body.setTranslation(rt._initialPose.position, true);
        rt.body.setRotation(rt._initialPose.quaternion, true);
        rt.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        rt.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        rt.world = rt._initialPose;
      }
    }
    return { ok: true, simTime: 0 };
  }

  function getDynamicPose(id) {
    const rt = runtime.get(id);
    if (!rt?.body) return null;
    const t = rt.body.translation();
    const r = rt.body.rotation();
    const v = rt.body.linvel();
    return { position: { x: t.x, y: t.y, z: t.z }, quaternion: { x: r.x, y: r.y, z: r.z, w: r.w }, linvel: { x: v.x, y: v.y, z: v.z } };
  }

  function bindSceneNode(colliderId, opts = {}) {
    if (!colliders.has(colliderId)) return { ok: false, reason: 'unknown_collider' };
    if (!opts.node) return { ok: false, reason: 'missing_node' };
    if (bindings.has(colliderId)) return { ok: false, reason: 'already_bound' };
    bindings.set(colliderId, {
      node: opts.node,
      parent: opts.parent || opts.node.parent || null,
      localPosition: _vec(opts.localPosition),
      localRotation: _quat(opts.localRotation || _quatIdentity()),
      objectId: opts.objectId || null,
      componentId: opts.componentId || null,
    });
    return { ok: true, colliderId };
  }

  function unbindSceneNode(colliderId) {
    return bindings.delete(colliderId);
  }

  function getBinding(colliderId) {
    return bindings.get(colliderId) || null;
  }

  function _invertOffset(worldPose, localPos, localRot) {
    // nodeWorld = bodyWorld * inverse(colliderLocal)
    const invRot = { x: -localRot.x, y: -localRot.y, z: -localRot.z, w: localRot.w };
    const nodeQuat = _mulQuat(worldPose.quaternion, invRot);
    const rotated = _rotateVec(nodeQuat, localPos);
    return {
      position: { x: worldPose.position.x - rotated.x, y: worldPose.position.y - rotated.y, z: worldPose.position.z - rotated.z },
      quaternion: nodeQuat,
    };
  }

  function _toParentLocal(nodeWorld, parent) {
    if (!parent || typeof parent.matrixWorld === 'undefined') {
      return { ok: true, position: nodeWorld.position, quaternion: nodeWorld.quaternion };
    }
    if (typeof THREE === 'undefined') return { ok: false, reason: 'three_unavailable' };
    try {
      parent.updateWorldMatrix(true, false);
      const inv = parent.matrixWorld.clone().invert();
      if (!Number.isFinite(inv.elements[0])) return { ok: false, reason: 'singular_parent' };
      const v = new THREE.Vector3(nodeWorld.position.x, nodeWorld.position.y, nodeWorld.position.z).applyMatrix4(inv);
      const pq = new THREE.Quaternion().setFromRotationMatrix(inv);
      const nq = new THREE.Quaternion(nodeWorld.quaternion.x, nodeWorld.quaternion.y, nodeWorld.quaternion.z, nodeWorld.quaternion.w);
      pq.multiply(nq);
      return { ok: true, position: { x: v.x, y: v.y, z: v.z }, quaternion: { x: pq.x, y: pq.y, z: pq.z, w: pq.w } };
    } catch (e) {
      return { ok: false, reason: 'conversion_failed', error: e.message };
    }
  }

  function applyDynamicPoses() {
    let applied = 0, skipped = 0, failed = 0;
    const errors = [];
    for (const [id, binding] of bindings) {
      const col = colliders.get(id);
      if (!col || col.bodyType !== 'dynamic' || !col.enabled) { skipped++; continue; }
      const pose = getDynamicPose(id);
      if (!pose) { skipped++; continue; }
      const nodeWorld = _invertOffset(pose, binding.localPosition, binding.localRotation);
      const local = _toParentLocal(nodeWorld, binding.parent);
      if (!local.ok) { failed++; errors.push({ id, reason: local.reason }); continue; }
      if (binding.node.position) binding.node.position.set(local.position.x, local.position.y, local.position.z);
      if (binding.node.quaternion) binding.node.quaternion.set(local.quaternion.x, local.quaternion.y, local.quaternion.z, local.quaternion.w);
      if (typeof binding.node.updateMatrixWorld === 'function') binding.node.updateMatrixWorld(true);
      applied++;
    }
    return { applied, skipped, failed, errors };
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
    bindings.clear();
  }

  return {
    SCHEMA_VERSION,
    registerHierarchy, createCollider, setEnabled, removeCollider,
    initRapier, setBackend,
    syncFromEvaluation, queryOverlaps, step, reset, getDynamicPose, setFixedTimestep, setMaxSubsteps, setGravity, getGravity, getBodyCount, getColliderCount, worldToParentLocal, bindSceneNode, unbindSceneNode, getBinding, applyDynamicPoses,
    serialize, deserialize, dispose,
    getBackend: () => backend,
    isRapierReady: () => rapierReady,
    getRapierError: () => rapierError,
    list: () => Array.from(colliders.values()),
    get: (id) => colliders.get(id) || null,
    getWorldPose: (id) => runtime.get(id)?.world || null,
    getStaticMoved: (id) => !!runtime.get(id)?.staticMoved,
    getLastScaleResult: (id) => runtime.get(id)?.scaleResult || null,
  };
})();

window.FumocaPhysics = FumocaPhysics;
export default FumocaPhysics;
