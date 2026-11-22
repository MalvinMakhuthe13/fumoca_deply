/**
 * FUMOCA live interaction.
 * One path for every product: press a part, it opens or closes, and it can play a sound.
 * Works for car doors, bonnet, boot, house doors, bottle caps, cooler lids.
 * Characters and animals are skeletons the visitor can pose. No second clock.
 */
const FumocaLive = (() => {
  const sounds = {
    door: [220, 0.08],
    boot: [140, 0.12],
    engine: [80, 0.4],
    click: [880, 0.04],
    cap: [640, 0.06],
  };
  let ctx = null;
  let active = null;
  const openState = new Map();

  function _audio() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    return ctx;
  }

  function playSound(name) {
    const spec = sounds[name] || sounds.click;
    try {
      const ac = _audio();
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.frequency.value = spec[0];
      o.type = name === 'engine' ? 'sawtooth' : 'sine';
      g.gain.setValueAtTime(0.12, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + spec[1]);
      o.connect(g); g.connect(ac.destination);
      o.start(); o.stop(ac.currentTime + spec[1]);
    } catch (_) {}
  }

  function _soundFor(name) {
    const n = (name || '').toLowerCase();
    if (n.includes('boot') || n.includes('bonnet') || n.includes('hood')) return 'boot';
    if (n.includes('engine') || n.includes('start')) return 'engine';
    if (n.includes('cap') || n.includes('lid') || n.includes('bottle')) return 'cap';
    if (n.includes('door')) return 'door';
    return 'click';
  }

  function bind(objectId) {
    active = objectId;
    const obj = window.FumocaObjectAnim?.get(objectId);
    if (!obj) return { ok: false, reason: 'no_object' };
    for (const c of obj.components) {
      if (!c.joint || c.joint.kind === 'fixed') continue;
      const node = _node(objectId, c.id);
      if (!node) continue;
      node.cursor = 'pointer';
      node.userData.fumocaToggle = { objectId, componentId: c.id, name: c.name };
    }
    if (typeof document !== "undefined") _ensureOverlay(obj);
    return { ok: true, objectId };
  }

  function _node(objectId, componentId) {
    const scene = window.scene;
    if (!scene) return null;
    let found = null;
    scene.traverse(n => {
      if (n.userData?.fumocaObjectId === objectId && n.userData?.fumocaComponentId === componentId) found = n;
    });
    return found;
  }

  function toggle(objectId, componentId) {
    const Objects = window.FumocaObjectAnim;
    const obj = Objects?.get(objectId);
    const c = obj?.components?.find(x => x.id === componentId);
    if (!c?.joint || c.joint.kind === 'fixed') return { ok: false, reason: 'not_movable' };
    const key = objectId + ':' + componentId;
    const isOpen = openState.get(key) === true;
    const limits = c.joint.limits || { min: 0, max: 1 };
    const value = isOpen ? (limits.min ?? 0) : (limits.max ?? 1);
    Objects.setJointValue(objectId, componentId, value);
    Objects.captureKeyframe(objectId, isOpen ? 0 : 2);
    window.FumocaMaster?.addObject?.(Objects.get(objectId));
    window.FumocaMaster?.evaluate?.(isOpen ? 0 : 2);
    openState.set(key, !isOpen);
    playSound(_soundFor(c.name));
    return { ok: true, open: !isOpen, name: c.name };
  }

  function startEngine(objectId) {
    playSound('engine');
    const overlay = document.getElementById('fumocaLiveStatus');
    if (overlay) overlay.textContent = 'Engine running';
    return { ok: true };
  }

  function _ensureOverlay(obj) {
    let bar = document.getElementById('fumocaLiveBar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'fumocaLiveBar';
      bar.style.cssText = 'position:fixed;left:50%;bottom:88px;transform:translateX(-50%);display:flex;gap:8px;flex-wrap:wrap;justify-content:center;z-index:55;max-width:90vw;';
      document.body.appendChild(bar);
    }
    const aff = window.FumocaAfford?.affordances(obj) || [];
    const movable = aff.filter(a => a.joint !== 'fixed');
    const engine = aff.find(a => a.affordance === 'engine') || (obj.name === 'Car' ? { name: 'Engine' } : null);
    bar.innerHTML = movable.map(a =>
      `<button data-id="${a.componentId}" style="background:#111;color:#c8ff00;border:1px solid #c8ff00;border-radius:999px;padding:8px 14px;cursor:pointer;">${a.name}</button>`
    ).join('') + (engine ? `<button id="faEngine" style="background:#c8ff00;color:#111;border:0;border-radius:999px;padding:8px 14px;font-weight:700;cursor:pointer;">Start</button>` : '');
    bar.querySelectorAll('button[data-id]').forEach(b => {
      b.onclick = () => {
        const r = toggle(obj.id, b.dataset.id);
        const s = document.getElementById('fumocaLiveStatus');
        if (s) s.textContent = r.ok ? `${r.name} ${r.open ? 'open' : 'closed'}` : 'Cannot move';
      };
    });
    bar.querySelector('#faEngine')?.addEventListener('click', () => startEngine(obj.id));
    let status = document.getElementById('fumocaLiveStatus');
    if (!status) {
      status = document.createElement('div');
      status.id = 'fumocaLiveStatus';
      status.style.cssText = 'position:fixed;left:50%;bottom:58px;transform:translateX(-50%);color:#c8ff00;font:13px system-ui;z-index:55;';
      document.body.appendChild(status);
    }
    status.textContent = 'Press a part';
  }

  function addCharacter(scene, kind = 'human') {
    if (!scene || !window.THREE || !window.FumocaSkeleton) return { ok: false, reason: 'missing' };
    const THREE = window.THREE;
    const id = kind + '_' + Date.now().toString(36);
    const sk = window.FumocaSkeleton.createSkeleton(id, kind === 'animal' ? 'Animal' : 'Person');
    const bones = kind === 'animal'
      ? [['root', null], ['spine', 'root'], ['head', 'spine'], ['tail', 'spine']]
      : [['root', null], ['spine', 'root'], ['head', 'spine'], ['armL', 'spine'], ['armR', 'spine'], ['handL', 'armL'], ['handR', 'armR']];
    const group = new THREE.Group();
    group.name = kind;
    const nodes = new Map();
    const boneIds = new Map();
    for (const [name, parentName] of bones) {
      const bone = window.FumocaSkeleton.addBone(id, name, parentName ? boneIds.get(parentName) : null);
      boneIds.set(name, bone?.id);
      const mesh = new THREE.Mesh(
        new THREE.CapsuleGeometry(name === 'head' ? 0.12 : 0.06, name === 'spine' ? 0.4 : 0.2, 4, 8),
        new THREE.MeshStandardMaterial({ color: kind === 'animal' ? 0xc48a3a : 0x88aaff })
      );
      mesh.name = name;
      mesh.position.y = name === 'head' ? 0.35 : 0.15;
      const host = parentName ? nodes.get(parentName) : group;
      host.add(mesh);
      nodes.set(name, mesh);
    }
    group.position.set(kind === 'animal' ? 1.4 : -1.4, 0, 1.2);
    scene.add(group);
    window.FumocaMaster?.addSkeleton?.(window.FumocaSkeleton.serialize(id));
    window.FumocaMaster?.setSkeletonBinding?.(id, nodes);
    return { ok: true, id, kind };
  }

  function gesture(skelId, name = 'wave') {
    const sk = window.FumocaSkeleton?.get?.(skelId);
    if (!sk) return { ok: false, reason: 'no_skeleton' };
    const arm = sk.bones?.find(b => /arm/i.test(b.name));
    if (arm && name === 'wave') arm.localEuler = { x: 0, y: 0, z: 40 };
    return { ok: true, gesture: name };
  }

  return { bind, toggle, startEngine, playSound, addCharacter, gesture };
})();

window.FumocaLive = FumocaLive;
export default FumocaLive;
