/**
 * FUMOCA Manual Skeleton & Pose Authoring (Phase B)
 * Manual-first. No AI required.
 * Skeleton lives beside the Gaussian environment.
 */
const FumocaSkeleton = (() => {
  const skeletons = new Map();

  function createSkeleton(id, name = 'Character') {
    const sk = {
      id,
      name,
      bones: [],
      poses: [],
      currentPose: {},
    };
    skeletons.set(id, sk);
    return sk;
  }

  function addBone(skelId, name, parentId = null) {
    const sk = skeletons.get(skelId);
    if (!sk) return null;
    const bone = {
      id: 'bone_' + Math.random().toString(36).slice(2, 8),
      name,
      parentId,
      localRot: { x: 0, y: 0, z: 0 },
      localPos: { x: 0, y: 0, z: 0 },
    };
    sk.bones.push(bone);
    return bone;
  }

  function setBoneRotation(skelId, boneId, rot) {
    const sk = skeletons.get(skelId);
    if (!sk) return false;
    const bone = sk.bones.find(b => b.id === boneId);
    if (!bone) return false;
    bone.localRot = { ...bone.localRot, ...rot };
    sk.currentPose[boneId] = { rot: bone.localRot, pos: bone.localPos };
    return true;
  }

  function capturePose(skelId, time) {
    const sk = skeletons.get(skelId);
    if (!sk) return null;
    const pose = {
      time: Number(time) || 0,
      bones: sk.bones.map(b => ({
        id: b.id,
        rot: { ...b.localRot },
        pos: { ...b.localPos },
      })),
    };
    sk.poses.push(pose);
    sk.poses.sort((a, b) => a.time - b.time);
    return pose;
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
      const pa = a.bones.find(x => x.id === bone.id) || { rot: bone.localRot, pos: bone.localPos };
      const pb = b.bones.find(x => x.id === bone.id) || pa;
      out[bone.id] = {
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
    createSkeleton, addBone, setBoneRotation, capturePose, evaluate,
    serialize, deserialize,
    list: () => Array.from(skeletons.values()),
    get: (id) => skeletons.get(id) || null,
  };
})();

window.FumocaSkeleton = FumocaSkeleton;
export default FumocaSkeleton;
