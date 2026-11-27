/**
 * FUMOCA pure mechanical evaluator.
 * Schema v1. Metres, radians, normalized quaternions.
 * world = parentWorld × pivot × jointTransform × inverse(pivot) × local
 * Threaded and snap are schema-only.
 */
const FumocaJointEval = (() => {
  function _quat(axis, angle) {
    const h = angle / 2;
    const s = Math.sin(h);
    return { x: axis.x * s, y: axis.y * s, z: axis.z * s, w: Math.cos(h) };
  }
  function _mulQuat(a, b) {
    return {
      x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
      y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
      z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
      w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    };
  }
  function _rotVec(q, v) {
    const qv = { x: v.x, y: v.y, z: v.z, w: 0 };
    const qi = { x: -q.x, y: -q.y, z: -q.z, w: q.w };
    const r = _mulQuat(_mulQuat(q, qv), qi);
    return { x: r.x, y: r.y, z: r.z };
  }
  function _norm(q) {
    const len = Math.hypot(q.x, q.y, q.z, q.w) || 1;
    return { x: q.x / len, y: q.y / len, z: q.z / len, w: q.w / len };
  }
  function _clamp(v, lim) {
    if (!lim) return v;
    return Math.max(lim.min, Math.min(lim.max, v));
  }

  function _finite3(v) { return v && [v.x, v.y, v.z].every(Number.isFinite); }
  function _finite4(q) { return q && [q.x, q.y, q.z, q.w].every(Number.isFinite); }

  function evaluate(component, value, parentWorld) {
    if (!component?.joint) return { ok: false, reason: 'missing_joint' };
    if (component.joint.kind === 'threaded' || component.joint.kind === 'snap') return { ok: false, reason: 'unsupported_joint' };
    if (typeof value !== 'number' || !Number.isFinite(value)) return { ok: false, reason: 'non_finite_value' };
    const local = component.local;
    if (!local || !_finite3(local.position)) return { ok: false, reason: 'invalid_local_position' };
    const lq = local.rotation;
    if (!_finite4(lq)) return { ok: false, reason: 'invalid_quaternion' };
    const qlen = Math.hypot(lq.x, lq.y, lq.z, lq.w);
    if (qlen < 1e-6) return { ok: false, reason: 'zero_quaternion' };
    if (Math.abs(qlen - 1) > 1e-3) return { ok: false, reason: 'quaternion_not_normalized' };
    const axis = component.joint.axis;
    if (!_finite3(axis)) return { ok: false, reason: 'invalid_axis' };
    const alen = Math.hypot(axis.x, axis.y, axis.z);
    if (alen < 1e-6) return { ok: false, reason: 'zero_axis' };
    if (Math.abs(alen - 1) > 1e-3) return { ok: false, reason: 'axis_not_normalized' };
    if (!_finite3(component.joint.pivot || { x: 0, y: 0, z: 0 })) return { ok: false, reason: 'invalid_pivot' };
    const lim = component.joint.limits;
    if (lim && (!Number.isFinite(lim.min) || !Number.isFinite(lim.max) || lim.min > lim.max)) return { ok: false, reason: 'invalid_limits' };
    if (parentWorld) {
      if (!_finite3(parentWorld.position)) return { ok: false, reason: 'invalid_parent_position' };
      const pq = parentWorld.rotation;
      if (!_finite4(pq)) return { ok: false, reason: 'invalid_parent_quaternion' };
      const plen = Math.hypot(pq.x, pq.y, pq.z, pq.w);
      if (plen < 1e-6 || Math.abs(plen - 1) > 1e-3) return { ok: false, reason: 'invalid_parent_quaternion' };
    }
    const kind = component.joint.kind;
    if (kind === 'threaded' || kind === 'snap') return { ok: false, reason: 'unsupported_joint' };
    if (!['fixed', 'hinge', 'prismatic', 'lift'].includes(kind)) return { ok: false, reason: 'invalid_joint' };
    const pivot = component.joint.pivot || { x: 0, y: 0, z: 0 };

    const v = value;
    const clamped = kind === 'fixed' ? 0 : _clamp(v, component.joint.limits);

    let jointPos = { x: 0, y: 0, z: 0 };
    let jointRot = { x: 0, y: 0, z: 0, w: 1 };
    if (kind === 'hinge') jointRot = _quat(axis, clamped);
    if (kind === 'prismatic' || kind === 'lift') {
      jointPos = { x: axis.x * clamped, y: axis.y * clamped, z: axis.z * clamped };
    }

    // localResult = pivot + jointPos + rotate(jointRot, local.pos - pivot) ... simplified:
    // position = pivot + jointPos + R(jointRot) * (local.pos - pivot)
    const rel = { x: local.position.x - pivot.x, y: local.position.y - pivot.y, z: local.position.z - pivot.z };
    const rotated = _rotVec(jointRot, rel);
    const localPos = {
      x: pivot.x + jointPos.x + rotated.x,
      y: pivot.y + jointPos.y + rotated.y,
      z: pivot.z + jointPos.z + rotated.z,
    };
    const localRot = _norm(_mulQuat(jointRot, local.rotation));

    let worldPos = localPos;
    let worldRot = localRot;
    if (parentWorld) {
      const pr = parentWorld.rotation;
      const pp = parentWorld.position;
      const wr = _rotVec(pr, localPos);
      worldPos = { x: pp.x + wr.x, y: pp.y + wr.y, z: pp.z + wr.z };
      worldRot = _norm(_mulQuat(pr, localRot));
    }
    return { ok: true, kind, value: clamped, local: { position: localPos, rotation: localRot }, world: { position: worldPos, rotation: worldRot } };
  }

  return { evaluate };
})();

window.FumocaJointEval = FumocaJointEval;
export default FumocaJointEval;
