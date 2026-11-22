/**
 * FUMOCA scene presets: car, house, cooler.
 * Real Three.js hierarchies with hinged doors, bonnet and boot.
 * Uses the existing object model and master. No second clock.
 */
const FumocaScenes = (() => {
  function _box(THREE, w, h, d, color, x, y, z) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color, roughness: 0.55 })
    );
    m.position.set(x, y, z);
    return m;
  }

  function _register(objectId, name, parts, scene) {
    const Objects = window.FumocaObjectAnim;
    const obj = Objects.createObject(objectId, name);
    const map = new Map();
    const root = new THREE.Group();
    root.name = name;
    const nodes = {};
    for (const p of parts) {
      const c = Objects.addComponent(objectId, p.name, p.kind || 'fixed', p.parent ? nodes[p.parent]?.userData.fumocaComponentId : null);
      c.local = { position: { x: p.x, y: p.y, z: p.z }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
      if (p.kind && p.kind !== 'fixed') {
        Objects.defineJoint(objectId, c.id, {
          kind: p.kind,
          axis: p.axis,
          pivot: p.pivot || { x: 0, y: 0, z: 0 },
          limits: p.limits,
        });
        Objects.setJointValue(objectId, c.id, 0);
      }
      const mesh = _box(window.THREE, p.w, p.h, p.d, p.color, p.x, p.y, p.z);
      mesh.name = p.name;
      mesh.userData.fumocaComponentId = c.id;
      const parentNode = p.parent ? nodes[p.parent] : root;
      parentNode.add(mesh);
      nodes[p.name] = mesh;
      map.set(c.id, mesh);
    }
    Objects.captureKeyframe(objectId, 0);
    for (const p of parts) {
      if (p.open != null) Objects.setJointValue(objectId, nodes[p.name].userData.fumocaComponentId, p.open);
    }
    Objects.captureKeyframe(objectId, 2);
    scene.add(root);
    const reg = window.FumocaStudioInit.registerArticulatedObject(Objects.get(objectId), map);
    window.FumocaMaster?.setDuration?.(2);
    window.FumocaMaster?.addObject?.(Objects.get(objectId));
    return { ok: reg.ok, objectId, registration: reg, root };
  }

  function createCar(scene) {
    if (!scene || !window.THREE || !window.FumocaObjectAnim) return { ok: false, reason: 'missing' };
    return _register('car_demo', 'Car', [
      { name: 'Body', w: 1.8, h: 0.45, d: 4.2, color: 0x1a1a1a, x: 0, y: 0.55, z: 0 },
      { name: 'Cabin', w: 1.6, h: 0.5, d: 2.0, color: 0x222222, x: 0, y: 0.95, z: -0.15, parent: 'Body' },
      { name: 'DoorFL', kind: 'hinge', axis: { x: 0, y: 1, z: 0 }, pivot: { x: -0.9, y: 0, z: 0.45 }, limits: { min: 0, max: 1.2 }, open: 1.1, w: 0.06, h: 0.7, d: 0.9, color: 0xc8ff00, x: -0.93, y: 0.15, z: 0.55, parent: 'Body' },
      { name: 'DoorFR', kind: 'hinge', axis: { x: 0, y: 1, z: 0 }, pivot: { x: 0.9, y: 0, z: 0.45 }, limits: { min: -1.2, max: 0 }, open: -1.1, w: 0.06, h: 0.7, d: 0.9, color: 0x9cff9c, x: 0.93, y: 0.15, z: 0.55, parent: 'Body' },
      { name: 'DoorRL', kind: 'hinge', axis: { x: 0, y: 1, z: 0 }, pivot: { x: -0.9, y: 0, z: -0.45 }, limits: { min: 0, max: 1.2 }, open: 1.0, w: 0.06, h: 0.7, d: 0.85, color: 0xa0e0ff, x: -0.93, y: 0.15, z: -0.55, parent: 'Body' },
      { name: 'DoorRR', kind: 'hinge', axis: { x: 0, y: 1, z: 0 }, pivot: { x: 0.9, y: 0, z: -0.45 }, limits: { min: -1.2, max: 0 }, open: -1.0, w: 0.06, h: 0.7, d: 0.85, color: 0xffd0a0, x: 0.93, y: 0.15, z: -0.55, parent: 'Body' },
      { name: 'Bonnet', kind: 'hinge', axis: { x: 1, y: 0, z: 0 }, pivot: { x: 0, y: 0.2, z: 1.5 }, limits: { min: 0, max: 1.1 }, open: 0.9, w: 1.7, h: 0.06, d: 1.1, color: 0xff4d00, x: 0, y: 0.28, z: 1.35, parent: 'Body' },
      { name: 'Boot', kind: 'hinge', axis: { x: 1, y: 0, z: 0 }, pivot: { x: 0, y: 0.2, z: -1.6 }, limits: { min: -1.1, max: 0 }, open: -0.9, w: 1.7, h: 0.06, d: 0.9, color: 0x7b2fff, x: 0, y: 0.28, z: -1.45, parent: 'Body' },
    ], scene);
  }

  function createHouse(scene) {
    if (!scene || !window.THREE || !window.FumocaObjectAnim) return { ok: false, reason: 'missing' };
    return _register('house_demo', 'House', [
      { name: 'Shell', w: 4, h: 2.4, d: 3.2, color: 0x3a3a3a, x: 0, y: 1.2, z: 0 },
      { name: 'FrontDoor', kind: 'hinge', axis: { x: 0, y: 1, z: 0 }, pivot: { x: -0.4, y: 0, z: 1.62 }, limits: { min: 0, max: 1.4 }, open: 1.2, w: 0.8, h: 1.9, d: 0.06, color: 0xc8ff00, x: 0, y: 0.95, z: 1.62, parent: 'Shell' },
      { name: 'BackDoor', kind: 'hinge', axis: { x: 0, y: 1, z: 0 }, pivot: { x: 0.4, y: 0, z: -1.62 }, limits: { min: -1.4, max: 0 }, open: -1.2, w: 0.8, h: 1.9, d: 0.06, color: 0xff4d00, x: 0, y: 0.95, z: -1.62, parent: 'Shell' },
      { name: 'SideDoor', kind: 'hinge', axis: { x: 0, y: 1, z: 0 }, pivot: { x: 2.02, y: 0, z: 0.4 }, limits: { min: 0, max: 1.4 }, open: 1.1, w: 0.06, h: 1.9, d: 0.8, color: 0x9cf, x: 2.02, y: 0.95, z: 0, parent: 'Shell' },
    ], scene);
  }

  return { createCar, createHouse };
})();

window.FumocaScenes = FumocaScenes;
export default FumocaScenes;
