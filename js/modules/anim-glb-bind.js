/**
 * FUMOCA GLB to articulated-object binder.
 * Loads a GLB, maps its node tree to components, registers with the master.
 * Does not replace the Gaussian scene. Does not create a second clock.
 */
const FumocaGLBBind = (() => {
  function _componentId(node) {
    const chain = [];
    let cur = node;
    const seen = new Set();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const index = cur.parent ? cur.parent.children.indexOf(cur) : 0;
      const name = String(cur.name || 'node').replace(/[^A-Za-z0-9_-]/g, '_') || 'node';
      chain.push(index + '_' + name);
      cur = cur.parent;
    }
    return 'p_' + chain.reverse().join('/');
  }

  function _overlayPrepared(components, prepared) {
    if (!prepared?.components) return;
    const byId = new Map(prepared.components.map(c => [c.id, c]));
    for (const c of components) {
      const prev = byId.get(c.id);
      if (!prev) continue;
      if (prev.name) c.name = prev.name;
      if (prev.joint) c.joint = JSON.parse(JSON.stringify(prev.joint));
      if (typeof prev.jointValue === 'number') c.jointValue = prev.jointValue;
    }
  }

  function _walk(node, parentId, components, map, objectId) {
    const id = _componentId(node);
    const comp = {
      id,
      name: node.name || id,
      parentId,
      type: 'fixed',
      version: 1,
      pos: { x: node.position.x, y: node.position.y, z: node.position.z },
      rot: { x: 0, y: 0, z: 0 },
      local: {
        position: { x: node.position.x, y: node.position.y, z: node.position.z },
        rotation: { x: node.quaternion.x, y: node.quaternion.y, z: node.quaternion.z, w: node.quaternion.w },
      },
      joint: { kind: 'fixed', axis: { x: 1, y: 0, z: 0 }, pivot: { x: 0, y: 0, z: 0 }, limits: null },
    };
    components.push(comp);
    map.set(id, node);
    node.userData.fumocaComponentId = id;
    node.userData.fumocaObjectId = objectId;
    for (const child of node.children) {
      if (child.isMesh || child.isObject3D) _walk(child, id, components, map, objectId);
    }
    return id;
  }

  function bindFromScene(rootNode, opts = {}) {
    if (!window.FumocaObjectAnim || !window.FumocaStudioInit || !window.FumocaMaster) {
      return { ok: false, reason: 'modules_missing' };
    }
    const objectId = opts.objectId || 'glb_' + Date.now().toString(36);
    const components = [];
    const map = new Map();
    _walk(rootNode, null, components, map, objectId);
    _overlayPrepared(components, opts.prepared);
    const tracks = Array.isArray(opts.prepared?.tracks) ? JSON.parse(JSON.stringify(opts.prepared.tracks)) : [];
    const obj = { id: objectId, name: opts.name || opts.prepared?.name || 'GLB', version: 1, components, tracks };
    window.FumocaObjectAnim.deserialize(obj);
    const reg = window.FumocaStudioInit.registerArticulatedObject(obj, map);
    return { ok: reg.ok, objectId, components: components.length, bound: reg.bound, missing: reg.missing, map };
  }

  async function load(fileOrUrl, opts = {}) {
    const THREE = window.THREE;
    if (!THREE) return { ok: false, reason: 'three_missing' };
    if (!window.FumocaObjectAnim || !window.FumocaStudioInit || !window.FumocaMaster) {
      return { ok: false, reason: 'modules_missing' };
    }
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const loader = new GLTFLoader();
    const url = fileOrUrl instanceof File || fileOrUrl instanceof Blob
      ? URL.createObjectURL(fileOrUrl)
      : fileOrUrl;
    const gltf = await loader.loadAsync(url);
    if (url.startsWith('blob:')) URL.revokeObjectURL(url);

    const objectId = opts.objectId || 'glb_' + Date.now().toString(36);
    const components = [];
    const map = new Map();
    _walk(gltf.scene, null, components, map, objectId);
    _overlayPrepared(components, opts.prepared);
    const tracks = Array.isArray(opts.prepared?.tracks) ? JSON.parse(JSON.stringify(opts.prepared.tracks)) : [];

    const obj = {
      id: objectId,
      name: opts.name || opts.prepared?.name || (fileOrUrl.name || 'GLB'),
      version: 1,
      components,
      tracks,
    };
    window.FumocaObjectAnim?.deserialize?.(obj);
    const reg = window.FumocaStudioInit.registerArticulatedObject(obj, map);
    const scene = window.scene || window._fumocaViewer?.scene;
    if (scene && gltf.scene) scene.add(gltf.scene);

    return { ok: reg.ok, objectId, components: components.length, bound: reg.bound, missing: reg.missing, scene: gltf.scene };
  }

  function setHinge(objectId, componentId, axis = { x: 0, y: 1, z: 0 }, limits = { min: 0, max: Math.PI / 2 }, pivot = undefined) {
    const Objects = window.FumocaObjectAnim;
    if (!Objects) return { ok: false, reason: 'objects_missing' };
    return Objects.defineJoint(objectId, componentId, { kind: 'hinge', axis, limits, pivot });
  }

  function keyframe(objectId, componentId, time, value) {
    const Objects = window.FumocaObjectAnim;
    if (!Objects) return { ok: false, reason: 'objects_missing' };
    const set = Objects.setJointValue(objectId, componentId, value);
    if (!set.ok) return set;
    const kf = Objects.captureKeyframe(objectId, time);
    const obj = Objects.get(objectId);
    if (obj) window.FumocaMaster.addObject(obj);
    return { ok: true, keyframe: kf };
  }

  function scrub(time) {
    return window.FumocaMaster?.evaluate?.(time) || null;
  }

  async function save(recordId) {
    if (!window.FumocaMaster?.persist) return { ok: false, reason: 'persist_missing' };
    return window.FumocaMaster.persist(recordId);
  }

  return { load, bindFromScene, setHinge, keyframe, scrub, save };
})();

window.FumocaGLBBind = FumocaGLBBind;
export default FumocaGLBBind;
