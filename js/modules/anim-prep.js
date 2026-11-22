/**
 * Founder preparation. Names parts, sets joints, saves the mapping.
 * The visitor never sees this. The same engine then drives any prepared asset.
 */
const FumocaPrep = (() => {
  function prepare(objectId, mappings) {
    const Objects = window.FumocaObjectAnim;
    const obj = Objects?.get(objectId);
    if (!obj) return { ok: false, reason: 'no_object' };
    const applied = [];
    for (const m of mappings) {
      const comp = obj.components.find(c => c.id === m.componentId || c.name === m.name);
      if (!comp) continue;
      if (m.name) comp.name = m.name;
      if (m.kind && m.kind !== 'fixed') {
        Objects.defineJoint(objectId, comp.id, {
          kind: m.kind,
          axis: m.axis || { x: 0, y: 1, z: 0 },
          pivot: m.pivot || { x: 0, y: 0, z: 0 },
          limits: m.limits || { min: 0, max: 1.2 },
        });
        Objects.setJointValue(objectId, comp.id, 0);
      }
      applied.push(comp.id);
    }
    obj.prep = { version: 1, mappings, at: Date.now() };
    window.FumocaMaster?.addObject?.(obj);
    return { ok: true, applied };
  }

  function exportPrep(objectId) {
    const obj = window.FumocaObjectAnim?.get(objectId);
    if (!obj) return null;
    return { objectId, prep: obj.prep || null, components: obj.components.map(c => ({ id: c.id, name: c.name, joint: c.joint })) };
  }

  return { prepare, exportPrep };
})();

window.FumocaPrep = FumocaPrep;
export default FumocaPrep;
