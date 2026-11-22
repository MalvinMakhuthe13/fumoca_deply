/**
 * Visitor playback for a prepared articulated object.
 * Loads only when a local mock record carries meta.demo_glb.
 * Joint motion stays on FumocaMaster.evaluate. This file's frame loop only draws.
 */
const FumocaViewerRuntime = (() => {
  let renderer = null;
  let scene = null;
  let camera = null;
  let controls = null;
  let playing = false;

  function _draw() {
    if (!playing || !renderer || !scene || !camera) return;
    controls?.update?.();
    renderer.render(scene, camera);
    requestAnimationFrame(_draw);
  }

  async function mount(record) {
    const glbUrl = record?.meta?.demo_glb;
    const timeline = record?.meta?.anim_timeline;
    if (!glbUrl || !timeline || !window.THREE || !window.FumocaGLBBind) return { ok: false, reason: 'missing' };
    const THREE = window.THREE;
    const host = document.getElementById('stageHost') || document.getElementById('stage');
    if (!host) return { ok: false, reason: 'no_stage' };

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x10140f);
    camera = new THREE.PerspectiveCamera(40, host.clientWidth / Math.max(1, host.clientHeight), 0.01, 100);
    camera.position.set(1.6, 1.1, 2.2);
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(host.clientWidth || window.innerWidth, host.clientHeight || window.innerHeight);
    renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;';
    host.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xfff4e0, 0x243020, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(2, 4, 3);
    scene.add(key);

    const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.4, 0);
    controls.enableDamping = true;

    window.scene = scene;
    window._fumocaViewerCamera = camera;
    window._fumocaViewerControls = controls;

    const prepared = (timeline.objects || []).find(o => o.id === record.meta.prepared_object_id) || timeline.objects?.[0];
    const loaded = await window.FumocaGLBBind.load(glbUrl, {
      objectId: prepared?.id,
      name: prepared?.name || record.title || 'Prepared',
      prepared,
    });
    if (!loaded.ok) return loaded;

    const box = new THREE.Box3().setFromObject(loaded.scene);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z, 0.2);
    camera.position.copy(center).add(new THREE.Vector3(radius * 1.4, radius * 0.7, radius * 1.6));
    controls.target.copy(center);
    camera.near = radius / 100;
    camera.far = radius * 50;
    camera.updateProjectionMatrix();
    controls.update();

    window.FumocaMaster?.setDuration?.(timeline.duration || 2);
    window.FumocaLive?.bind?.(loaded.objectId);
    document.getElementById('fumocLoadingOverlay')?.remove();
    document.getElementById('loadingOverlay')?.classList.add('hidden');
    document.getElementById('errorBox')?.classList.remove('visible');
    const pose = window.FumocaMaster?.evaluate?.(0);
    window._fumocaArticulation = { objectId: loaded.objectId, pose };

    playing = true;
    _draw();
    window.addEventListener('resize', () => {
      const w = host.clientWidth || window.innerWidth;
      const h = host.clientHeight || window.innerHeight;
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    return { ok: true, objectId: loaded.objectId };
  }

  window.addEventListener('fumoca:recordLoaded', (event) => {
    const record = event.detail;
    if (!record?._localMock || !record?.meta?.demo_glb) return;
    mount(record).then(r => {
      if (!r?.ok) console.warn('[ViewerRuntime] articulation did not mount', r);
    });
  });

  return { mount };
})();

window.FumocaViewerRuntime = FumocaViewerRuntime;
export default FumocaViewerRuntime;
