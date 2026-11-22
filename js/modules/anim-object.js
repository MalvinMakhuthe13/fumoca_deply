/**
 * FUMOCA Manual Object / Component Animation (Phase C)
 * Hierarchy, transforms, hinges, states. Manual only.
 */
const FumocaObjectAnim = (() => {
  const objects = new Map();

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
      joint: {
        kind: type === 'hinge' ? 'hinge' : 'fixed',
        pivot: { x: 0, y: 0, z: 0 },
        axis: { x: 1, y: 0, z: 0 },
        limits: { min: -180, max: 180 },
        rest: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } },
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

  function captureKeyframe(objId, time) {
    const obj = objects.get(objId);
    if (!obj) return null;
    const kf = {
      time: Number(time) || 0,
      components: obj.components.map(c => ({
        id: c.id,
        rot: { ...c.rot },
        pos: { ...c.pos },
        state: c.state,
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
      out[c.id] = {
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
    }
    return out;
  }

  function defineJoint(objId, compId, joint = {}) {
    const obj = objects.get(objId);
    if (!obj) return { ok: false, reason: 'unknown_object' };
    const c = obj.components.find(x => x.id === compId);
    if (!c) return { ok: false, reason: 'unknown_component' };
    const kinds = ['fixed', 'hinge', 'prismatic', 'free', 'lift', 'threaded', 'snap'];
    if (joint.kind && !kinds.includes(joint.kind)) return { ok: false, reason: 'invalid_joint' };
    c.joint = {
      kind: joint.kind || c.joint?.kind || 'fixed',
      pivot: joint.pivot || c.joint?.pivot || { x: 0, y: 0, z: 0 },
      axis: joint.axis || c.joint?.axis || { x: 1, y: 0, z: 0 },
      limits: joint.limits || c.joint?.limits || { min: -180, max: 180 },
      rest: joint.rest || c.joint?.rest || { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } },
      seat: joint.seat || c.joint?.seat || null,
    };
    c.type = c.joint.kind;
    return { ok: true, joint: c.joint };
  }

  function seatComponent(objId, compId) {
    const obj = objects.get(objId);
    if (!obj) return false;
    const c = obj.components.find(x => x.id === compId);
    if (!c?.joint?.seat) return false;
    c.pos = { ...c.joint.seat.pos };
    c.rot = { ...c.joint.seat.rot };
    c.state = 'seated';
    return true;
  }

  function serialize(objId) {
    const o = objects.get(objId);
    return o ? JSON.parse(JSON.stringify(o)) : null;
  }

  function deserialize(data) {
    if (!data?.id) return null;
    objects.set(data.id, data);
    return data;
  }

  return {
    createObject, addComponent, setComponentTransform, defineJoint, seatComponent, captureKeyframe, evaluate,
    serialize, deserialize,
    list: () => Array.from(objects.values()),
    get: (id) => objects.get(id) || null,
  };
})();

window.FumocaObjectAnim = FumocaObjectAnim;
export default FumocaObjectAnim;
