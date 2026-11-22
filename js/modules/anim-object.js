/**
 * FUMOCA Manual Object / Component Animation (Phase C)
 * Hierarchy, transforms, hinges, states. Manual only.
 */
const FumocaObjectAnim = (() => {
  const objects = new Map();

  const KINDS = ['fixed', 'hinge', 'prismatic', 'free', 'lift', 'threaded', 'snap'];
  const ANGULAR = new Set(['hinge', 'threaded']);

  function _finite(v) { return v && [v.x, v.y, v.z].every(Number.isFinite); }
  function _eulerDegToQuat(e) {
    const x = ((e?.x || 0) * Math.PI / 180) / 2;
    const y = ((e?.y || 0) * Math.PI / 180) / 2;
    const z = ((e?.z || 0) * Math.PI / 180) / 2;
    const cx = Math.cos(x), sx = Math.sin(x);
    const cy = Math.cos(y), sy = Math.sin(y);
    const cz = Math.cos(z), sz = Math.sin(z);
    return {
      x: sx * cy * cz - cx * sy * sz,
      y: cx * sy * cz + sx * cy * sz,
      z: cx * cy * sz - sx * sy * cz,
      w: cx * cy * cz + sx * sy * sz,
    };
  }
  function _normalizeQuat(q) {
    if (!q || ![q.x, q.y, q.z, q.w].every(Number.isFinite)) return { ok: false, reason: 'invalid_quaternion' };
    const len = Math.hypot(q.x, q.y, q.z, q.w);
    if (len < 1e-6) return { ok: false, reason: 'zero_quaternion' };
    return { ok: true, value: { x: q.x / len, y: q.y / len, z: q.z / len, w: q.w / len } };
  }
  function _unit(v) {
    const len = Math.hypot(v.x, v.y, v.z);
    if (len < 1e-6) return null;
    return { x: v.x / len, y: v.y / len, z: v.z / len };
  }
  function _canonicalTransform(src) {
    if (!src) return { ok: true, value: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } } };
    const position = src.position || src.pos;
    if (position && !_finite(position)) return { ok: false, reason: 'non_finite_transform' };
    let rotation = src.rotation;
    if (!rotation && src.rot) {
      if (!_finite(src.rot)) return { ok: false, reason: 'non_finite_transform' };
      rotation = _eulerDegToQuat(src.rot);
    }
    if (!rotation) rotation = { x: 0, y: 0, z: 0, w: 1 };
    const nq = _normalizeQuat(rotation);
    if (!nq.ok) return nq;
    return { ok: true, value: { position: { x: position?.x || 0, y: position?.y || 0, z: position?.z || 0 }, rotation: nq.value } };
  }
  function _defaultLimits(kind) {
    if (kind === 'hinge' || kind === 'threaded') return { min: -Math.PI, max: Math.PI };
    if (kind === 'prismatic' || kind === 'lift') return { min: 0, max: 1 };
    return null;
  }

  function migrateComponent(c, warnings) {
    if (c.version === 1 && c.local?.rotation) return c;
    const localResult = _canonicalTransform({ position: c.position || c.pos, rotation: c.rotation, rot: c.rot });
    if (!localResult.ok) { warnings.push({ id: c.id, reason: localResult.reason }); return c; }
    const local = localResult.value;
    const joint = c.joint || {};
    const kind = joint.kind || (c.type === 'hinge' ? 'hinge' : 'fixed');
    let limits = joint.limits != null ? joint.limits : _defaultLimits(kind);
    if (limits && c.version !== 1) {
      if (ANGULAR.has(kind)) {
        limits = { min: limits.min * Math.PI / 180, max: limits.max * Math.PI / 180 };
        warnings.push({ id: c.id, reason: 'limits_converted_from_degrees' });
      } else if (!KINDS.includes(kind)) {
        warnings.push({ id: c.id, reason: 'limits_unit_ambiguous' });
      }
    }
    const axis = _unit(joint.axis || { x: 1, y: 0, z: 0 }) || { x: 1, y: 0, z: 0 };
    const restResult = _canonicalTransform(joint.rest);
    if (joint.rest && !restResult.ok) { warnings.push({ id: c.id, reason: restResult.reason, field: 'rest' }); return c; }
    const seatResult = joint.seat ? _canonicalTransform(joint.seat) : { ok: true, value: null };
    if (!seatResult.ok) { warnings.push({ id: c.id, reason: seatResult.reason, field: 'seat' }); return c; }
    return {
      ...c,
      version: 1,
      local,
      joint: {
        kind,
        pivot: joint.pivot || { x: 0, y: 0, z: 0 },
        axis,
        limits,
        rest: restResult.value,
        seat: seatResult.value,
      },
    };
  }

  function validateComponent(c, all) {
    if (!KINDS.includes(c.joint?.kind)) return { ok: false, reason: 'invalid_joint' };
    if (!_finite(c.local?.position)) return { ok: false, reason: 'non_finite_transform' };
    const rq = c.local?.rotation;
    if (!rq || ![rq.x, rq.y, rq.z, rq.w].every(Number.isFinite)) return { ok: false, reason: 'invalid_quaternion' };
    const qlen = Math.hypot(rq.x, rq.y, rq.z, rq.w);
    if (qlen < 1e-6) return { ok: false, reason: 'zero_quaternion' };
    if (Math.abs(qlen - 1) > 1e-3) return { ok: false, reason: 'quaternion_not_normalized' };
    if (!_finite(c.joint?.pivot)) return { ok: false, reason: 'invalid_pivot' };
    if (c.joint.rest) {
      if (!_finite(c.joint.rest.position)) return { ok: false, reason: 'invalid_rest' };
      const rq = c.joint.rest.rotation;
      if (!rq || ![rq.x, rq.y, rq.z, rq.w].every(Number.isFinite)) return { ok: false, reason: 'invalid_rest' };
      const rl = Math.hypot(rq.x, rq.y, rq.z, rq.w);
      if (rl < 1e-6 || Math.abs(rl - 1) > 1e-3) return { ok: false, reason: 'invalid_rest' };
    }
    if (c.joint.seat) {
      if (!_finite(c.joint.seat.position)) return { ok: false, reason: 'invalid_seat' };
      const sq = c.joint.seat.rotation;
      if (!sq || ![sq.x, sq.y, sq.z, sq.w].every(Number.isFinite)) return { ok: false, reason: 'invalid_seat' };
      const sl = Math.hypot(sq.x, sq.y, sq.z, sq.w);
      if (sl < 1e-6 || Math.abs(sl - 1) > 1e-3) return { ok: false, reason: 'invalid_seat' };
    }
    if (c.joint.limits && (![c.joint.limits.min, c.joint.limits.max].every(Number.isFinite))) return { ok: false, reason: 'non_finite_limits' };
    const q = c.joint?.axis;
    if (!q || Math.hypot(q.x, q.y, q.z) < 1e-6) return { ok: false, reason: 'zero_axis' };
    if (Math.abs(Math.hypot(q.x, q.y, q.z) - 1) > 1e-3) return { ok: false, reason: 'axis_not_normalized' };
    const lim = c.joint.limits;
    if (lim && lim.min > lim.max) return { ok: false, reason: 'limits_unordered' };
    if (c.parentId && !all.find(x => x.id === c.parentId)) return { ok: false, reason: 'unknown_parent' };
    const seen = new Set();
    function walk(id, stack) {
      if (stack.has(id)) return true;
      stack.add(id);
      const node = all.find(x => x.id === id);
      return node?.parentId ? walk(node.parentId, stack) : false;
    }
    if (walk(c.id, new Set())) return { ok: false, reason: 'parent_cycle' };
    if (all.filter(x => x.id === c.id).length > 1) return { ok: false, reason: 'duplicate_component' };
    return { ok: true };
  }


  function createObject(id, name = 'Object') {
    const obj = {
      id,
      name,
      components: [],
      tracks: [],
    };
    objects.set(id, obj);
    return obj;
  }

  function addComponent(objId, name, type = 'transform', parentId = null) {
    const obj = objects.get(objId);
    if (!obj) return null;
    const c = {
      id: 'comp_' + Math.random().toString(36).slice(2, 8),
      name,
      parentId,
      type,
      state: type === 'hinge' ? 'closed' : 'idle',
      rot: { x: 0, y: 0, z: 0 },
      pos: { x: 0, y: 0, z: 0 },
      version: 1,
      local: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
      joint: {
        kind: type === 'hinge' ? 'hinge' : 'fixed',
        pivot: { x: 0, y: 0, z: 0 },
        axis: { x: 1, y: 0, z: 0 },
        limits: type === 'hinge' ? { min: -Math.PI, max: Math.PI } : null,
        rest: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
        seat: null,
      },
    };
    obj.components.push(c);
    return c;
  }

  function setComponentTransform(objId, compId, rot, pos, state) {
    const obj = objects.get(objId);
    if (!obj) return false;
    const c = obj.components.find(x => x.id === compId);
    if (!c) return false;
    if (rot) c.rot = { ...c.rot, ...rot };
    if (pos) c.pos = { ...c.pos, ...pos };
    if (state) c.state = state;
    return true;
  }

  function setJointValue(objId, compId, value) {
    const obj = objects.get(objId);
    if (!obj) return { ok: false, reason: 'unknown_object' };
    const c = obj.components.find(x => x.id === compId);
    if (!c) return { ok: false, reason: 'unknown_component' };
    if (typeof value !== 'number' || !Number.isFinite(value)) return { ok: false, reason: 'non_finite_value' };
    c.jointValue = value;
    return { ok: true, jointValue: value };
  }

  function captureKeyframe(objId, time) {
    const obj = objects.get(objId);
    if (!obj) return null;
    const hasJoint = obj.components.some(c => typeof c.jointValue === 'number');
    const kf = {
      time: Number(time) || 0,
      animVersion: hasJoint ? 1 : undefined,
      components: obj.components.map(c => ({
        id: c.id,
        rot: { ...c.rot },
        pos: { ...c.pos },
        state: c.state,
        jointValue: typeof c.jointValue === 'number' ? c.jointValue : undefined,
      })),
    };
    obj.tracks.push(kf);
    obj.tracks.sort((a, b) => a.time - b.time);
    return kf;
  }

  function evaluate(objId, time) {
    const obj = objects.get(objId);
    if (!obj || !obj.tracks.length) return {};
    let a = obj.tracks[0], b = obj.tracks[obj.tracks.length - 1];
    for (let i = 0; i < obj.tracks.length - 1; i++) {
      if (time >= obj.tracks[i].time && time <= obj.tracks[i + 1].time) {
        a = obj.tracks[i]; b = obj.tracks[i + 1]; break;
      }
    }
    const span = Math.max(0.001, b.time - a.time);
    const t = Math.max(0, Math.min(1, (time - a.time) / span));
    const out = {};
    for (const c of obj.components) {
      const pa = a.components.find(x => x.id === c.id) || c;
      const pb = b.components.find(x => x.id === c.id) || pa;
      const entry = {
        rot: {
          x: pa.rot.x + (pb.rot.x - pa.rot.x) * t,
          y: pa.rot.y + (pb.rot.y - pa.rot.y) * t,
          z: pa.rot.z + (pb.rot.z - pa.rot.z) * t,
        },
        pos: {
          x: pa.pos.x + (pb.pos.x - pa.pos.x) * t,
          y: pa.pos.y + (pb.pos.y - pa.pos.y) * t,
          z: pa.pos.z + (pb.pos.z - pa.pos.z) * t,
        },
        state: t < 0.5 ? pa.state : pb.state,
      };
      if ((a.animVersion === 1 || b.animVersion === 1) && c.joint && c.joint.kind !== 'fixed') {
        entry.animVersion = 1;
        if (typeof pa.jointValue !== 'number' || typeof pb.jointValue !== 'number') {
          entry.jointError = 'missing_joint_value';
        } else {
          entry.jointValue = pa.jointValue + (pb.jointValue - pa.jointValue) * t;
        }
      }
      out[c.id] = entry;
    }
    return out;
  }

  function defineJoint(objId, compId, joint = {}) {
    const obj = objects.get(objId);
    if (!obj) return { ok: false, reason: 'unknown_object' };
    const c = obj.components.find(x => x.id === compId);
    if (!c) return { ok: false, reason: 'unknown_component' };
    const kind = joint.kind != null ? joint.kind : (c.joint?.kind || 'fixed');
    if (!KINDS.includes(kind)) return { ok: false, reason: 'invalid_joint' };
    const axisIn = joint.axis != null ? joint.axis : (c.joint?.axis || { x: 1, y: 0, z: 0 });
    if (!_finite(axisIn)) return { ok: false, reason: 'non_finite_transform' };
    const axis = _unit(axisIn);
    if (!axis) return { ok: false, reason: 'zero_axis' };
    const limits = joint.limits !== undefined ? joint.limits : (c.joint?.limits != null ? c.joint.limits : _defaultLimits(kind));
    if (limits && (!_finite({ x: limits.min, y: limits.max, z: 0 }) || limits.min > limits.max)) {
      return { ok: false, reason: 'limits_unordered' };
    }
    const pivot = joint.pivot != null ? joint.pivot : (c.joint?.pivot || { x: 0, y: 0, z: 0 });
    if (!_finite(pivot)) return { ok: false, reason: 'invalid_pivot' };
    const restResult = joint.rest != null ? _canonicalTransform(joint.rest) : { ok: true, value: c.joint?.rest || _canonicalTransform(null).value };
    if (!restResult.ok) return { ok: false, reason: restResult.reason };
    let seat = c.joint?.seat || null;
    if (joint.seat !== undefined) {
      if (joint.seat === null) seat = null;
      else {
        const seatResult = _canonicalTransform(joint.seat);
        if (!seatResult.ok) return { ok: false, reason: seatResult.reason };
        seat = seatResult.value;
      }
    }
    c.joint = { kind, pivot, axis, limits, rest: restResult.value, seat };
    return { ok: true, joint: c.joint };
  }

  function seatComponent(objId, compId) {
    const obj = objects.get(objId);
    if (!obj) return false;
    const c = obj.components.find(x => x.id === compId);
    if (!c?.joint?.seat) return false;
    const seat = c.joint.seat.position ? c.joint.seat : _canonicalTransform(c.joint.seat);
    c.local = c.local || {};
    c.local.position = { ...seat.position };
    c.local.rotation = { ...seat.rotation };
    c.pos = { ...seat.position };
    c.state = 'seated';
    return true;
  }

  function serialize(objId) {
    const o = objects.get(objId);
    return o ? JSON.parse(JSON.stringify(o)) : null;
  }

  function deserialize(data) {
    if (!data?.id) return null;
    const warnings = [];
    const components = (data.components || []).map(c => migrateComponent(c, warnings));
    const obj = { ...data, version: 1, components, _migrationWarnings: warnings };
    objects.set(data.id, obj);
    return obj;
  }

  function validateObject(objId) {
    const obj = objects.get(objId);
    if (!obj) return { ok: false, reason: 'unknown_object' };
    const errors = [];
    const ids = obj.components.map(c => c.id);
    if (new Set(ids).size !== ids.length) errors.push({ reason: 'duplicate_component' });
    for (const c of obj.components) {
      const v = validateComponent(c, obj.components);
      if (!v.ok) errors.push({ id: c.id, reason: v.reason });
    }
    return { ok: errors.length === 0, errors };
  }

  return {
    createObject, addComponent, setComponentTransform, defineJoint, setJointValue, seatComponent, captureKeyframe, evaluate, validateObject, migrateComponent,
    serialize, deserialize,
    list: () => Array.from(objects.values()),
    get: (id) => objects.get(id) || null,
  };
})();

window.FumocaObjectAnim = FumocaObjectAnim;
export default FumocaObjectAnim;
