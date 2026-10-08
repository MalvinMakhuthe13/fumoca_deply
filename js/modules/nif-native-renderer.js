/**
 * FUMOCA Native Gaussian Renderer
 * --------------------------------
 * WebGL2 instanced Gaussian renderer for the canonical NIF geometry + the
 * authoritative APPEARANCE_SH chunk. This is deliberately independent of the
 * legacy .splat renderer: no RGB conversion is required.
 *
 * First native milestone:
 *   - anisotropic X/Y Gaussian footprint from canonical scale + quaternion
 *   - opacity
 *   - view-dependent spherical harmonics through degree 3
 *   - calibration scale
 *   - transparent Gaussian compositing
 *
 * The renderer keeps the canonical Product Master data intact. It does not
 * claim that the Gaussian layer is the solid/encapsulation layer.
 */
import * as THREE from 'three';

const C0 = 0.28209479177387814;
const C1 = 0.4886025119029199;
function quatFromData(data, o) {
  return [data[o + 6], data[o + 7], data[o + 8], data[o + 9]];
}

const VERT = `
precision highp float;

attribute vec2 corner;
attribute vec3 aPosition;
attribute vec3 aScale;
attribute vec4 aQuat;
attribute float aOpacity;

attribute vec3 sh0;
attribute vec3 sh1;
attribute vec3 sh2;
attribute vec3 sh3;
attribute vec3 sh4;
attribute vec3 sh5;
attribute vec3 sh6;
attribute vec3 sh7;
attribute vec3 sh8;
attribute vec3 sh9;
attribute vec3 sh10;
attribute vec3 sh11;
attribute vec3 sh12;
attribute vec3 sh13;
attribute vec3 sh14;
attribute vec3 sh15;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform int shDegree;
uniform float uScale;
uniform float uFootprint;
uniform vec3 uCameraPosition;

varying vec2 vCorner;
varying vec3 vColor;
varying float vOpacity;

vec3 rotateQuat(vec4 q, vec3 v) {
  return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
}

vec3 evalSH(vec3 d) {
  vec3 c = 0.28209479177387814 * sh0;
  if (shDegree < 1) return c + 0.5;

  c += -C1 * d.y * sh1;
  c +=  C1 * d.z * sh2;
  c += -C1 * d.x * sh3;
  if (shDegree < 2) return c + 0.5;

  c += 1.0925484305920792 * d.x * d.y * sh4;
  c += 1.0925484305920792 * d.y * d.z * sh5;
  c += 0.31539156525252005 * (3.0 * d.z * d.z - 1.0) * sh6;
  c += 1.0925484305920792 * d.x * d.z * sh7;
  c += 0.5462742152960396 * (d.x * d.x - d.y * d.y) * sh8;
  if (shDegree < 3) return c + 0.5;

  c += 0.5900435899266435 * d.y * (3.0*d.x*d.x - d.y*d.y) * sh9;
  c += 2.890611442640554 * d.x*d.y*d.z * sh10;
  c += 0.4570457994644658 * d.y * (4.0*d.z*d.z - d.x*d.x - d.y*d.y) * sh11;
  c += 0.3731763325901154 * d.z * (2.0*d.z*d.z - 3.0*d.x*d.x - 3.0*d.y*d.y) * sh12;
  c += 0.4570457994644658 * d.x * (4.0*d.z*d.z - d.x*d.x - d.y*d.y) * sh13;
  c += 1.445305721320277 * d.z * (d.x*d.x - d.y*d.y) * sh14;
  c += 0.5900435899266435 * d.x * (d.x*d.x - 3.0*d.y*d.y) * sh15;
  return c + 0.5;
}

void main() {
  vec3 worldCenter = (modelMatrix * vec4(aPosition * uScale, 1.0)).xyz;
  vec3 viewDir = normalize(uCameraPosition - worldCenter);

  vec3 axisX = rotateQuat(aQuat, vec3(1.0, 0.0, 0.0));
  vec3 axisY = rotateQuat(aQuat, vec3(0.0, 1.0, 0.0));

  float sx = max(aScale.x * uScale, 1e-6);
  float sy = max(aScale.y * uScale, 1e-6);
  vec3 offset = (corner.x * axisX * sx + corner.y * axisY * sy) * uFootprint;

  vec4 mvCenter = viewMatrix * vec4(worldCenter, 1.0);
  vec4 mvPos = viewMatrix * vec4(worldCenter + offset, 1.0);

  gl_Position = projectionMatrix * mvPos;
  vCorner = corner;
  vColor = max(evalSH(normalize(viewDir)), vec3(0.0));
  vOpacity = aOpacity;
}
`;

const FRAG = `
precision highp float;
varying vec2 vCorner;
varying vec3 vColor;
varying float vOpacity;

void main() {
  float r2 = dot(vCorner, vCorner);
  if (r2 > 1.0) discard;
  float gaussian = exp(-2.75 * r2);
  float alpha = clamp(vOpacity * gaussian, 0.0, 0.995);
  if (alpha < 0.002) discard;
  gl_FragColor = vec4(vColor, alpha);
}
`;

function makeAttr(geometry, name, array, itemSize) {
  const attr = new THREE.InstancedBufferAttribute(array, itemSize);
  attr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute(name, attr);
  return attr;
}

export class FumocaNativeGaussianRenderer {
  constructor(container, gaussians, appearance, calibration = null) {
    if (!container) throw new Error('Native renderer: missing container');
    if (!gaussians?.data || !appearance?.coefficients) {
      throw new Error('Native renderer requires NIF geometry and APPEARANCE_SH');
    }
    if (appearance.gaussianCount !== gaussians.count) {
      throw new Error(`SH/GEO count mismatch: ${appearance.gaussianCount} vs ${gaussians.count}`);
    }

    this.container = container;
    this.gaussians = gaussians;
    this.appearance = appearance;
    this.calibration = calibration;
    this.count = gaussians.count;
    this.degree = Math.min(3, Math.max(0, appearance.degree | 0));
    this.coeffCount = (this.degree + 1) ** 2;

    const rawScale = Number(calibration?.scale_factor);
    this.worldScale = Number.isFinite(rawScale) && rawScale > 0 ? rawScale : 1;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.001, 100000);
    this.camera.up.set(0, -1, -0.6).normalize();

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    Object.assign(this.renderer.domElement.style, {
      position: 'absolute', inset: '0', width: '100%', height: '100%', zIndex: '2'
    });
    container.appendChild(this.renderer.domElement);

    this._buildGeometry();
    this._fitCamera();

    this.controls = null;
    this._resize = () => this.resize();
    window.addEventListener('resize', this._resize);
    this.resize();

    this._loop = () => {
      if (!this.renderer) return;
      this.controls?.update?.();
      this.renderer.render(this.scene, this.camera);
      this.frame = requestAnimationFrame(this._loop);
    };
    this.frame = requestAnimationFrame(this._loop);
  }

  _buildGeometry() {
    const { data } = this.gaussians;
    const N = this.count;
    const K = this.coeffCount;

    const geometry = new THREE.InstancedBufferGeometry();
    const corners = new Float32Array([
      -1,-1, 1,-1, 1,1, -1,-1, 1,1, -1,1
    ]);
    geometry.setAttribute('corner', new THREE.Float32BufferAttribute(corners, 2));
    geometry.instanceCount = N;

    const positions = new Float32Array(N * 3);
    const scales = new Float32Array(N * 3);
    const quats = new Float32Array(N * 4);
    const opacity = new Float32Array(N);

    for (let i = 0; i < N; i++) {
      const o = i * 14;
      positions.set([data[o], data[o+1], data[o+2]], i * 3);
      scales.set([Math.exp(data[o+3]), Math.exp(data[o+4]), Math.exp(data[o+5])], i * 3);
      quats.set(quatFromData(data, o), i * 4);
      opacity[i] = 1 / (1 + Math.exp(-data[o+10]));
    }

    makeAttr(geometry, 'aPosition', positions, 3);
    makeAttr(geometry, 'aScale', scales, 3);
    makeAttr(geometry, 'aQuat', quats, 4);
    makeAttr(geometry, 'aOpacity', opacity, 1);

    const sh = this.appearance.coefficients;
    for (let k = 0; k < 16; k++) {
      const arr = new Float32Array(N * 3);
      if (k < K) {
        for (let i = 0; i < N; i++) {
          const src = (i * K + k) * 3;
          arr[i*3] = sh[src] || 0;
          arr[i*3+1] = sh[src+1] || 0;
          arr[i*3+2] = sh[src+2] || 0;
        }
      }
      makeAttr(geometry, 'sh' + k, arr, 3);
    }

    this.geometry = geometry;
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      uniforms: {
        shDegree: { value: this.degree },
        uScale: { value: this.worldScale },
        uFootprint: { value: 3.0 },
        uCameraPosition: { value: new THREE.Vector3() },
      },
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  _fitCamera() {
    const pos = this.geometry.getAttribute('aPosition');
    const box = new THREE.Box3();
    const p = new THREE.Vector3();
    for (let i = 0; i < this.count; i++) {
      p.fromBufferAttribute(pos, i).multiplyScalar(this.worldScale);
      box.expandByPoint(p);
    }
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.length() * 0.5, 0.1);
    this.camera.position.set(center.x, center.y - radius * 0.25, center.z + radius * 2.4);
    this.camera.lookAt(center);
    this.target = center.clone();
    this.camera.near = Math.max(radius * 0.001, 0.0001);
    this.camera.far = radius * 20;
    this.camera.updateProjectionMatrix();

    // Use the same OrbitControls implementation already imported by viewer.js.
    // viewer.js replaces this with its OrbitControls instance after construction.
    this.material.uniforms.uCameraPosition.value.copy(this.camera.position);
  }

  attachControls(OrbitControlsClass) {
    if (this.controls) this.controls.dispose?.();
    this.controls = new OrbitControlsClass(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.rotateSpeed = 0.55;
    this.controls.zoomSpeed = 1.1;
    this.controls.target.copy(this.target);
    this.controls.minDistance = this.camera.near * 20;
    this.controls.maxDistance = this.camera.far * 0.8;
    this.controls.update();
  }

  resize() {
    if (!this.renderer) return;
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  destroy() {
    if (this.frame) cancelAnimationFrame(this.frame);
    window.removeEventListener('resize', this._resize);
    this.controls?.dispose?.();
    this.geometry?.dispose?.();
    this.material?.dispose?.();
    this.renderer?.dispose?.();
    this.renderer?.domElement?.remove();
    this.renderer = null;
    this.scene = null;
  }
}

export default FumocaNativeGaussianRenderer;
