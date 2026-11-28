/**
 * Isolated local Gaussian PLY preview for FUMOCA Device Preview.
 * Own renderer, scene, camera and controls: never reparents or resizes Studio's canvas.
 */
const LOAD_TIMEOUT_MS = 45000;

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

function copyBytes(input) {
  if (!input) throw new Error('No local Gaussian PLY bytes are available.');
  if (input instanceof Uint8Array) return new Uint8Array(input);
  if (input instanceof ArrayBuffer) return new Uint8Array(input.slice(0));
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength));
  throw new Error('The local Gaussian source is not a supported byte buffer.');
}

function fitCamera(THREE, mesh, camera, controls) {
  let bounds = null;
  try { bounds = mesh.getBoundingBox?.(); } catch (_) {}
  if (!bounds || bounds.isEmpty?.()) {
    try {
      const sphere = mesh.getBoundingSphere?.();
      if (sphere && sphere.radius > 1e-6) {
        bounds = new THREE.Box3().setFromCenterAndSize(
          sphere.center,
          new THREE.Vector3(sphere.radius * 2, sphere.radius * 2, sphere.radius * 2),
        );
      }
    } catch (_) {}
  }
  if (!bounds || bounds.isEmpty?.()) throw new Error('Spark loaded the PLY but could not determine its bounds for camera framing.');
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const radius = Math.max(size.x, size.y, size.z, 0.05) * 0.5;
  const fov = THREE.MathUtils.degToRad(camera.fov || 50);
  const distance = Math.max(radius / Math.tan(fov * 0.5) * 1.65, radius * 2.3, 0.15);
  const direction = new THREE.Vector3(0.38, 0.28, 1).normalize();
  camera.up.set(0, 1, 0);
  camera.position.copy(center).addScaledVector(direction, distance);
  camera.near = Math.max(distance / 2000, 0.0005);
  camera.far = Math.max(distance * 200, 500);
  camera.updateProjectionMatrix();
  camera.lookAt(center);
  controls.target.copy(center);
  controls.minDistance = Math.max(distance * 0.0001, 0.00001);
  controls.maxDistance = distance * 100;
  controls.update();
}

export async function mountLocalGaussianPreview(host, sourceBytes, fileName = 'local-scene.ply', settings = null) {
  if (!host) throw new Error('The device preview host is unavailable.');
  const bytes = copyBytes(sourceBytes);
  const [THREE, { OrbitControls }, { SparkRenderer, SplatMesh }] = await Promise.all([
    import('three'),
    import('three/addons/controls/OrbitControls.js'),
    import('@sparkjsdev/spark'),
  ]);
  const sparkPreset = await import('./spark-preset.js').catch(() => null);
  const sparkOptions = sparkPreset?.sparkOptions || ((options = {}) => ({
    maxStdDev: Math.sqrt(8), preBlurAmount: 0.3, blurAmount: 0, focalAdjustment: 1, sortRadial: false, ...options,
  }));

  host.replaceChildren();
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x05070b, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline:none;';
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070b);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.0005, 10000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.zoomSpeed = 1.2;
  controls.enablePan = true;

  const spark = new SparkRenderer(sparkOptions({ renderer, autoUpdate: true }));
  spark.name = 'fumoca-device-preview-spark';
  scene.add(spark);
  const mesh = new SplatMesh({
    fileBytes: bytes,
    fileName,
    enableLod: false,
    onLoad: () => console.info('[DevicePreview] Local Gaussian PLY decoded:', fileName),
  });
  mesh.name = 'fumoca-device-preview-local-splat';
  scene.add(mesh);

  let disposed = false;
  let raf = 0;
  let resizeObserver = null;
  let viewController = null;
  try {
    if (mesh.initialized) await withTimeout(mesh.initialized, LOAD_TIMEOUT_MS, 'Spark timed out while decoding the local PLY.');
    if (disposed) throw new Error('Device preview was closed while the local PLY was loading.');
    fitCamera(THREE, mesh, camera, controls);
    const { ViewController } = await import('./view-settings.js');
    if (settings) {
      viewController = new ViewController(THREE, camera, controls, settings, { domElement: renderer.domElement });
      viewController.apply();
    }

    const resize = () => {
      if (disposed) return;
      const width = Math.max(2, host.clientWidth || 2);
      const height = Math.max(2, host.clientHeight || 2);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(host);
    } else {
      window.addEventListener('resize', resize);
    }

    const render = () => {
      if (disposed) return;
      raf = requestAnimationFrame(render);
      controls.update();
      renderer.render(scene, camera);
    };
    render();

    return {
      renderer, scene, camera, controls, mesh, spark,
      dispose() {
        if (disposed) return;
        disposed = true;
        cancelAnimationFrame(raf);
        resizeObserver?.disconnect();
        window.removeEventListener('resize', resize);
        viewController?.dispose?.();
        controls.dispose();
        scene.remove(mesh);
        scene.remove(spark);
        try { mesh.dispose?.(); } catch (_) {}
        try { spark.dispose?.(); } catch (_) {}
        renderer.dispose();
        renderer.domElement.remove();
        host.replaceChildren();
      },
    };
  } catch (error) {
    disposed = true;
    try { controls.dispose(); } catch (_) {}
    try { scene.remove(mesh); mesh.dispose?.(); } catch (_) {}
    try { scene.remove(spark); spark.dispose?.(); } catch (_) {}
    try { renderer.dispose(); renderer.domElement.remove(); } catch (_) {}
    throw error;
  }
}

export function getLocalGaussianPreviewBytes(state = window.S || {}) {
  const isPly = state.fileType === 'ply' && state.isGaussianPly === true;
  const isSplat = state.fileType === 'splat' || /\.splat$/i.test(state.fileName || '');
  if (!isPly && !isSplat) return null;
  const bridge = window.FumocaSparkGaussian;
  if (bridge?.isEnabled?.() && typeof bridge.exportEditedBytes === 'function') {
    try {
      return { bytes: copyBytes(bridge.exportEditedBytes(state)), fileName: state.fileName || 'edited-local.ply', edited: true };
    } catch (error) {
      console.warn('[DevicePreview] Could not snapshot edited Spark state; using original local bytes.', error);
    }
  }
  const bytes = state.gaussianSourceBytes || window._fumocaLastGaussianBytes;
  if (!bytes) return null;
  return { bytes: copyBytes(bytes), fileName: state.fileName || 'local-scene.ply', edited: false };
}
