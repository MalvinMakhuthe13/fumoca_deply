/**
 * FUMOCA Interaction & Anchors (Phase E)
 * Grasp/release, attach/detach, object-relative anchors.
 */
const FumocaInteraction = (() => {
  const events = [];
  const attachments = new Map();

  function addEvent(type, target, time, params = {}) {
    const ev = {
      id: 'ev_' + Math.random().toString(36).slice(2, 8),
      type,
      target,
      time: Number(time) || 0,
      params,
    };
    events.push(ev);
    events.sort((a, b) => a.time - b.time);
    return ev;
  }

  function attach(objectId, parentId, boneId = null, offset = { x: 0, y: 0, z: 0 }) {
    attachments.set(objectId, { attachedTo: parentId, boneId, offset });
  }

  function detach(objectId) {
    attachments.delete(objectId);
  }

  function getAttachment(objectId) {
    return attachments.get(objectId) || null;
  }

  function evaluateAt(time) {
    const active = events.filter(e => e.time <= time);
    const state = {};
    for (const e of active) {
      if (e.type === 'attach' || e.type === 'grasp') {
        state[e.target] = { attached: true, to: e.params.to, bone: e.params.bone };
      } else if (e.type === 'detach' || e.type === 'release') {
        state[e.target] = { attached: false };
      }
    }
    return state;
  }

  function makeAnchor(id, mode, ref) {
    return {
      id,
      mode,
      objectId: ref.objectId || null,
      componentId: ref.componentId || null,
      boneId: ref.boneId || null,
      offset: ref.offset || { x: 0, y: 0, z: 0 },
    };
  }

  function resolveAnchor(anchor, time) {
    if (!anchor) return null;
    if (anchor.mode === 'world') return anchor.offset;
    return anchor.offset;
  }

  function serialize() {
    return { events: events.slice(), attachments: Array.from(attachments.entries()) };
  }

  function deserialize(data) {
    events.length = 0;
    if (data?.events) events.push(...data.events);
    attachments.clear();
    if (data?.attachments) data.attachments.forEach(([k, v]) => attachments.set(k, v));
  }

  return {
    addEvent, attach, detach, getAttachment, evaluateAt,
    makeAnchor, resolveAnchor, serialize, deserialize,
    getEvents: () => events.slice(),
  };
})();

window.FumocaInteraction = FumocaInteraction;
export default FumocaInteraction;
