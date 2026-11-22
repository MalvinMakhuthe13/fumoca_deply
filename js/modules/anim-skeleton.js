/**
 * FUMOCA Manual Skeleton & Pose Authoring (Phase B)
 * Canonical rotation: quaternion. Euler available for editor controls.
 * Manual-first. No AI required.
 */
const FumocaSkeleton = (() => {
  const skeletons = new Map();

  function _eulerToQuat(e) {
    const rx = (e.x || 0) * Math.PI / 180;
    const ry = (e.y || 0) * Math.PI / 180;
    const rz = (e.z || 0) * Math.PI / 180;
    const cx = Math.cos(rx / 2), sx = Math.sin(rx / 2);
    const cy = Math.cos(ry / 2), sy = Math.sin(ry / 2);
    const cz = Math.cos(rz / 2), sz = Math.sin(rz / 2);
    return {
      x: sx * cy * cz - cx * sy * sz,
      y: cx * sy * cz + sx * cy * sz,
      z: cx * cy * sz - sx * sy * cz,
      w: cx * cy * cz + sx * sy * sz,
    };
  }

  function _quatToEuler(q) {
    const sinr = 2 * (q.w * q.x + q.y * q.z);
    const cosr = 1 - 2 * (q.x * q.x + q.y * q.y);
    const x = Math.atan2(sinr, cosr);
    const sinp = 2 * (q.w * q.y - q.z * q.x);
    const y = Math.abs(sinp) >= 1 ? Math.sign(sinp) * Math.PI / 2 : Math.asin(sinp);
    const siny = 2 * (q.w * q.z + q.x * q.y);
    const cosy = 1 - 2 * (q.y * q.y + q.z * q.z);
    const z = Math.atan2(siny, cosy);
    return { x: x * 180 / Math.PI, y: y * 180 / Math.PI, z: z * 180 / Math.PI };
  }

  function _isQuat(r) { return r && typeof r.w === 'number'; }

  function createSkeleton(id, name = 'Character') {
    const sk = { id, name, bones: [], poses: [], currentPose: {} };
    skeletons.set(id, sk);
    return sk;
  }

  function addBone(skelId, name, parentId = null) {
    const sk = skeletons.get(skelId);
    if (!sk) return null;
    const bone = {
      id: 'bone_' + Math.random().toString(36).slice(2, 8),
      name, parentId,
      localQuat: { x: 0, y: 0, z: 0, w: 1 },
      localEuler: { x: 0, y: 0, z: 0 },
      localPos: { x: 0, y: 0, z: 0 },
    };
    sk.bones.push(bone);
    return bone;
  }

  function setBoneQuaternion(skelId, boneId, quat) {
    const sk = skeletons.get(skelId);
    if (!sk) return false;
    const bone = sk.bones.find(b => b.id === boneId);
    if (!bone) return false;
    bone.localQuat = { x: quat.x || 0, y: quat.y || 0, z: quat.z || 0, w: quat.w ?? 1 };
    bone.localEuler = _quatToEuler(bone.localQuat);
    sk.currentPose[boneId] = { quat: bone.localQuat, euler: bone.localEuler, pos: bone.localPos };
    return true;
  }

  function setBoneEuler(skelId, boneId, euler) {
    const sk = skeletons.get(skelId);
    if (!sk) return false;
    const bone = sk.bones.find(b => b.id === boneId);
    if (!bone) return false;
    bone.localEuler = { x: euler.x || 0, y: euler.y || 0, z: euler.z || 0 };
    bone.localQuat = _eulerToQuat(bone.localEuler);
    sk.currentPose[boneId] = { quat: bone.localQuat, euler: bone.localEuler, pos: bone.localPos };
    return true;
  }

  function setBoneRotation(skelId, boneId, rot) {
    if (_isQuat(rot)) return setBoneQuaternion(skelId, boneId, rot);
    return setBoneEuler(skelId, boneId, rot);
  }

  function setBonePosition(skelId, boneId, pos) {
    const sk = skeletons.get(skelId);
    if (!sk) return false;
    const bone = sk.bones.find(b => b.id === boneId);
    if (!bone) return false;
    bone.localPos = { x: pos.x || 0, y: pos.y || 0, z: pos.z || 0 };
    return true;
  }

  function capturePose(skelId, time) {
    const sk = skeletons.get(skelId);
    if (!sk) return null;
    const pose = {
      time: Number(time) || 0,
      bones: sk.bones.map(b => ({
        id: b.id,
        quat: { ...b.localQuat },
        euler: { ...b.localEuler },
        pos: { ...b.localPos },
      })),
    };
    sk.poses.push(pose);
    sk.poses.sort((a, b) => a.time - b.time);
    return pose;
  }

  function _slerp(q1, q2, t) {
    let x = q1.x + (q2.x - q1.x) * t;
    let y = q1.y + (q2.y - q1.y) * t;
    let z = q1.z + (q2.z - q1.z) * t;
    let w = q1.w + (q2.w - q1.w) * t;
    const len = Math.hypot(x, y, z, w) || 1;
    return { x: x / len, y: y / len, z: z / len, w: w / len };
  }

  function evaluate(skelId, time) {
    const sk = skeletons.get(skelId);
    if (!sk || !sk.poses.length) return sk?.currentPose || {};
    let a = sk.poses[0], b = sk.poses[sk.poses.length - 1];
    for (let i = 0; i < sk.poses.length - 1; i++) {
      if (time >= sk.poses[i].time && time <= sk.poses[i + 1].time) {
        a = sk.poses[i]; b = sk.poses[i + 1]; break;
      }
    }
    const span = Math.max(0.001, b.time - a.time);
    const t = Math.max(0, Math.min(1, (time - a.time) / span));
    const out = {};
    for (const bone of sk.bones) {
      const pa = a.bones.find(x => x.id === bone.id) || { quat: bone.localQuat, pos: bone.localPos };
      const pb = b.bones.find(x => x.id === bone.id) || pa;
      const qa = pa.quat || _eulerToQuat(pa.euler || pa.rot || { x: 0, y: 0, z: 0 });
      const qb = pb.quat || _eulerToQuat(pb.euler || pb.rot || { x: 0, y: 0, z: 0 });
      const q = _slerp(qa, qb, t);
      out[bone.id] = {
        quat: q,
        euler: _quatToEuler(q),
        pos: {
          x: (pa.pos?.x || 0) + ((pb.pos?.x || 0) - (pa.pos?.x || 0)) * t,
          y: (pa.pos?.y || 0) + ((pb.pos?.y || 0) - (pa.pos?.y || 0)) * t,
          z: (pa.pos?.z || 0) + ((pb.pos?.z || 0) - (pa.pos?.z || 0)) * t,
        },
      };
    }
    return out;
  }

  function serialize(skelId) {
    const sk = skeletons.get(skelId);
    return sk ? JSON.parse(JSON.stringify(sk)) : null;
  }

  function deserialize(data) {
    if (!data?.id) return null;
    skeletons.set(data.id, data);
    return data;
  }

  return {
    createSkeleton, addBone,
    setBoneRotation, setBoneEuler, setBoneQuaternion, setBonePosition,
    capturePose, evaluate, serialize, deserialize,
    eulerToQuat: _eulerToQuat, quatToEuler: _quatToEuler,
    list: () => Array.from(skeletons.values()),
    get: (id) => skeletons.get(id) || null,
  };
})();

window.FumocaSkeleton = FumocaSkeleton;
export default FumocaSkeleton;
