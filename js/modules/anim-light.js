/**
 * FUMOCA Lighting Data Model
 * Manual lights for conventional Three.js meshes.
 * Gaussian splats do not respond to these lights.
 * Capability detection reports actual renderer support.
 */
const FumocaLight = (() => {
  const lights = new Map();

  function _defaultShadow() {
    return {
      enabled: false,
      mapSize: 1024,
      bias: -0.0005,
      normalBias: 0.02,
      radius: 1,
      opacity: 1,
    };
  }

  function createLight(id, type = 'directional', name = 'Light') {
    const light = {
      id,
      type,
      name,
      enabled: true,
      position: { x: 0, y: 5, z: 5 },
      rotation: { x: 0, y: 0, z: 0 },
      target: { x: 0, y: 0, z: 0 },
      color: { r: 1, g: 1, b: 1 },
      intensity: 1,
      temperature: 6500,
      distance: 0,
      decay: 2,
      angle: Math.PI / 6,
      penumbra: 0.1,
      groundColor: { r: 0.3, g: 0.3, b: 0.3 },
      shadow: _defaultShadow(),
      tracks: [],
    };
    lights.set(id, light);
    return light;
  }

  function setLightParams(id, params) {
    const light = lights.get(id);
    if (!light || !params) return false;
    if (params.position) light.position = { ...light.position, ...params.position };
    if (params.rotation) light.rotation = { ...light.rotation, ...params.rotation };
    if (params.target) light.target = { ...light.target, ...params.target };
    if (params.color) light.color = { ...light.color, ...params.color };
    if (Number.isFinite(params.intensity)) light.intensity = params.intensity;
    if (Number.isFinite(params.temperature)) light.temperature = params.temperature;
    if (Number.isFinite(params.distance)) light.distance = params.distance;
    if (Number.isFinite(params.decay)) light.decay = params.decay;
    if (Number.isFinite(params.angle)) light.angle = params.angle;
    if (Number.isFinite(params.penumbra)) light.penumbra = params.penumbra;
    if (params.groundColor) light.groundColor = { ...light.groundColor, ...params.groundColor };
    if (typeof params.enabled === 'boolean') light.enabled = params.enabled;
    return true;
  }

  function setShadowParams(id, params) {
    const light = lights.get(id);
    if (!light || !params) return false;
    light.shadow = { ...light.shadow, ...params };
    return true;
  }

  function captureKeyframe(id, time) {
    const light = lights.get(id);
    if (!light) return null;
    const kf = {
      time: Number(time) || 0,
      position: { ...light.position },
      rotation: { ...light.rotation },
      target: { ...light.target },
      color: { ...light.color },
      intensity: light.intensity,
      distance: light.distance,
      angle: light.angle,
      penumbra: light.penumbra,
      enabled: light.enabled,
      shadow: { ...light.shadow },
    };
    light.tracks.push(kf);
    light.tracks.sort((a, b) => a.time - b.time);
    return kf;
  }

  function _lerp(a, b, t) { return a + (b - a) * t; }
  function _lerpColor(a, b, t) {
    return { r: _lerp(a.r, b.r, t), g: _lerp(a.g, b.g, t), b: _lerp(a.b, b.b, t) };
  }
  function _lerpVec(a, b, t) {
    return { x: _lerp(a.x, b.x, t), y: _lerp(a.y, b.y, t), z: _lerp(a.z, b.z, t) };
  }

  function evaluate(id, time) {
    const light = lights.get(id);
    if (!light || !light.tracks.length) return light ? { ...light, evaluated: false } : null;
    const tracks = light.tracks;
    let a = tracks[0], b = tracks[tracks.length - 1];
    for (let i = 0; i < tracks.length - 1; i++) {
      if (time >= tracks[i].time && time <= tracks[i + 1].time) {
        a = tracks[i]; b = tracks[i + 1]; break;
      }
    }
    const span = Math.max(0.001, b.time - a.time);
    const t = Math.max(0, Math.min(1, (time - a.time) / span));
    return {
      ...light,
      evaluated: true,
      position: _lerpVec(a.position, b.position, t),
      rotation: _lerpVec(a.rotation, b.rotation, t),
      target: _lerpVec(a.target, b.target, t),
      color: _lerpColor(a.color, b.color, t),
      intensity: _lerp(a.intensity, b.intensity, t),
      distance: _lerp(a.distance || 0, b.distance || 0, t),
      angle: _lerp(a.angle || 0, b.angle || 0, t),
      penumbra: _lerp(a.penumbra || 0, b.penumbra || 0, t),
      enabled: t < 0.5 ? a.enabled : b.enabled,
      shadow: t < 0.5 ? a.shadow : b.shadow,
    };
  }

  function serialize(id) {
    const light = lights.get(id);
    return light ? JSON.parse(JSON.stringify(light)) : null;
  }

  function deserialize(data) {
    if (!data?.id) return null;
    lights.set(data.id, data);
    return data;
  }

  function getCapabilities() {
    const hasThree = typeof THREE !== 'undefined';
    const hasRenderer = typeof window !== 'undefined' && window._fumocaViewer?.renderer;
    const shadowMap = hasRenderer && window._fumocaViewer.renderer.shadowMap;
    return {
      meshLighting: hasThree,
      meshShadows: !!(shadowMap && shadowMap.enabled),
      splatRelighting: false,
      contactShadows: hasThree,
      areaLights: false,
      directional: hasThree,
      point: hasThree,
      spot: hasThree,
      ambient: hasThree,
      hemisphere: hasThree,
    };
  }

  function dispose() {
    lights.clear();
  }

  return {
    createLight, setLightParams, setShadowParams,
    captureKeyframe, evaluate, serialize, deserialize,
    getCapabilities, dispose,
    list: () => Array.from(lights.values()),
    get: (id) => lights.get(id) || null,
  };
})();

window.FumocaLight = FumocaLight;
export default FumocaLight;
