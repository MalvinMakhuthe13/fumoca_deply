/**
 * FUMOCA Studio Initialization Bridge
 * Binds FumocaMaster to the existing Studio camera and OrbitControls.
 * One authoritative playback clock. Registers articulated objects.
 */
const FumocaStudioInit = (() => {
  let _master = null;
  let _initialized = false;
  let _cameraBound = false;
  let _retryTimer = null;

  function _getCamera() {
    return window._fumocaViewerCamera || window._fumocaViewer?.camera || null;
  }
  function _getControls() {
    return window._fumocaViewerControls || window._fumocaViewer?.controls || null;
  }

  function init() {
    if (_initialized) return { ok: true, already: true };
    _master = window.FumocaMaster;
    if (!_master) return { ok: false, reason: 'master_missing' };

    const cam = _getCamera();
    const ctrls = _getControls();
    if (!cam || !ctrls) {
      if (!_retryTimer) {
        _retryTimer = setTimeout(() => { _retryTimer = null; init(); }, 250);
      }
    

  return { ok: false, reason: 'camera_not_ready', retrying: true };
    }

    _master.setCameraBinding(cam, ctrls);
    _cameraBound = true;
    if (window.FumocaPhysics?.initRapier) {
      window.FumocaPhysics.initRapier().then(r => {
        if (!r.ok) console.warn('[StudioInit] Rapier unavailable, using reference backend:', r.error);
      });
    }

    const states = window.Fumoca4D?.getStates?.() || [];
    if (states.length) {
      _master.setCameraTrack(states);
      const last = states[states.length - 1];
      _master.setDuration(Math.max(0.1, last.time_offset || 10));
    }

    _initialized = true;
    window._fumocaMasterOwnsPlayback = true;
    console.log('[StudioInit] Bound to camera and controls');
  

  return { ok: true, cameraBound: true };
  }

  function destroy() {
    if (_retryTimer) { clearTimeout(_retryTimer); _retryTimer = null; }
    if (window.FumocaPhysics?.dispose) window.FumocaPhysics.dispose();
    if (_master) _master.pause();
    const ctrls = _getControls();
    if (ctrls) ctrls.enabled = true;
    _initialized = false;
    _cameraBound = false;
    _master = null;
    window._fumocaMasterOwnsPlayback = false;
  }

  function play() {
    if (!_initialized) init();
    if (!_master || !_cameraBound) return false;
    const ctrls = _getControls();
    if (ctrls) ctrls.enabled = false;
    window._fumocaMasterOwnsPlayback = true;
    _master.play();
    return true;
  }

  function pause() {
    if (!_master) return;
    _master.pause();
    const ctrls = _getControls();
    if (ctrls) ctrls.enabled = true;
  }

  function stop() {
    if (!_master) return;
    _master.stop();
    const ctrls = _getControls();
    if (ctrls) ctrls.enabled = true;
  }

  function scrub(time) {
    if (!_master) return null;
    return _master.evaluate(time);
  }

  function registerArticulatedObject(obj, componentMap) {
    const master = window.FumocaMaster;
    if (!master) return { ok: false, reason: 'master_missing' };
    if (!obj?.id || !obj.components) return { ok: false, reason: 'invalid_object' };
    const ids = new Set(obj.components.map(c => c.id));
    for (const c of obj.components) {
      if (c.parentId && !ids.has(c.parentId)) return { ok: false, reason: 'unknown_parent', componentId: c.id };
    }
    // Component parentId must be the same node the mesh is parented to.
    // An id that exists while node.parent points somewhere else used to return ok:true.
    for (const c of obj.components) {
      if (!c.parentId) continue;
      const node = componentMap?.get?.(c.id);
      const parentNode = componentMap?.get?.(c.parentId);
      if (!node || !parentNode) continue;
      if (node.parent !== parentNode) {
        return { ok: false, reason: 'parent_mismatch', componentId: c.id, parentId: c.parentId };
      }
    }
    master.addObject(obj);
    master.setObjectBinding(obj.id, componentMap);
    const missing = obj.components.filter(c => !componentMap?.get?.(c.id)).map(c => c.id);
  

  return { ok: missing.length === 0, bound: obj.components.length - missing.length, missing };
  }

  /**
   * Build a real Three.js cooler (base + hinged lid) and register it.
   * This is the first live articulated object in Studio.
   */
  function createDemoCooler(scene) {
    if (!scene || !window.THREE || !window.FumocaObjectAnim) return { ok: false, reason: 'missing_deps' };
    const THREE = window.THREE;
    const Objects = window.FumocaObjectAnim;
    const obj = Objects.createObject('cooler_demo', 'Cooler');
    const base = Objects.addComponent('cooler_demo', 'Base', 'fixed');
    base.local = { position: { x: 0, y: 0.3, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
    const lid = Objects.addComponent('cooler_demo', 'Lid', 'hinge', base.id);
    Objects.defineJoint('cooler_demo', lid.id, {
      kind: 'hinge', axis: { x: 1, y: 0, z: 0 }, pivot: { x: 0, y: 0.15, z: -0.3 },
      limits: { min: 0, max: Math.PI / 2 },
    });
    lid.local = { position: { x: 0, y: 0.6, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
    Objects.setJointValue('cooler_demo', lid.id, 0);
    Objects.captureKeyframe('cooler_demo', 0);
    Objects.setJointValue('cooler_demo', lid.id, Math.PI / 2);
    Objects.captureKeyframe('cooler_demo', 2);

    const baseMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 0.5, 0.6),
      new THREE.MeshStandardMaterial({ color: 0x2a4a6a, roughness: 0.6 })
    );
    const lidMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 0.08, 0.6),
      new THREE.MeshStandardMaterial({ color: 0x3a6a9a, roughness: 0.4 })
    );
    baseMesh.add(lidMesh);
    scene.add(baseMesh);

    const map = new Map([[base.id, baseMesh], [lid.id, lidMesh]]);
    const reg = registerArticulatedObject(Objects.get('cooler_demo'), map);
    if (window.FumocaMaster) window.FumocaMaster.setDuration(2);
    console.log('[StudioInit] Demo cooler registered', reg);
  

  return { ok: reg.ok, objectId: 'cooler_demo', registration: reg };
  }


  async function createDropDemo(scene) {
    if (!scene || !window.THREE || !window.FumocaPhysics) return { ok: false, reason: 'missing' };
    const boot = await window.FumocaPhysicsBoot?.start?.();
    const THREE = window.THREE;
    const floor = new THREE.Mesh(new THREE.BoxGeometry(2, 0.1, 2), new THREE.MeshStandardMaterial({ color: 0x333333 }));
    floor.position.y = -0.05;
    const bottle = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.22, 6, 12), new THREE.MeshStandardMaterial({ color: 0xc8ff00 }));
    bottle.position.y = 1.2;
    scene.add(floor); scene.add(bottle);
    window.FumocaPhysics.createCollider({ id: 'floor', type: 'box', bodyType: 'static', halfExtents: { x: 1, y: 0.05, z: 1 }, localPosition: { x: 0, y: -0.05, z: 0 } });
    window.FumocaPhysics.createCollider({ id: 'bottle', type: 'capsule', bodyType: 'dynamic', radius: 0.08, height: 0.22, localPosition: { x: 0, y: 1.2, z: 0 } });
    window.FumocaPhysics.bindSceneNode('bottle', bottle);
    return { ok: true, physics: boot };
  }

  return {
    init, destroy, play, pause, stop, scrub,
    registerArticulatedObject, createDemoCooler, createDropDemo,
    getTime: () => _master?.getTime?.() ?? 0,
    isPlaying: () => _master?.isPlaying?.() ?? false,
    isCameraBound: () => _cameraBound,
    isInitialized: () => _initialized,
  };
})();

window.FumocaStudioInit = FumocaStudioInit;
export default FumocaStudioInit;
