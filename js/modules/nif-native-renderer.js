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
 *   - adaptive bucketed back-to-front depth ordering
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

uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;
uniform mat4 modelMatrix;
uniform int shDegree;
uniform float uScale;
uniform float uSplatBlur;
uniform vec3 uCameraPosition;

varying vec2 vCorner;
varying vec3 vColor;
varying float vOpacity;

mat3 quatMatrix(vec4 q) {
  q = q / max(length(q), 1e-6);
  float x = q.x, y = q.y, z = q.z, w = q.w;
  return mat3(
    1.0 - 2.0*(y*y + z*z), 2.0*(x*y - w*z),     2.0*(x*z + w*y),
    2.0*(x*y + w*z),       1.0 - 2.0*(x*x + z*z), 2.0*(y*z - w*x),
    2.0*(x*z - w*y),       2.0*(y*z + w*x),     1.0 - 2.0*(x*x + y*y)
  );
}

vec3 evalSH(vec3 d) {
  vec3 c = 0.28209479177387814 * sh0;
  if (shDegree < 1) return c + 0.5;

  c += -0.4886025119029199 * d.y * sh1;
  c +=  0.4886025119029199 * d.z * sh2;
  c += -0.4886025119029199 * d.x * sh3;
  if (shDegree < 2) return c + 0.5;

  c += 1.0925484305920792 * d.x * d.y * sh4;
  c += 1.0925484305920792 * d.y * d.z * sh5;
  c += 0.31539156525252005 * (3.0*d.z*d.z - 1.0) * sh6;
  c += 1.0925484305920792 * d.x * d.z * sh7;
  c += 0.5462742152960396 * (d.x*d.x - d.y*d.y) * sh8;
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
  vec4 cameraCenter4 = viewMatrix * vec4(worldCenter, 1.0);
  vec3 cameraCenter = cameraCenter4.xyz;

  // Three.js looks down -Z. Work in positive forward depth to keep the
  // perspective Jacobian numerically intuitive.
  float depth = max(-cameraCenter.z, 1e-4);
  if (depth <= 1e-4 || !all(lessThan(abs(cameraCenter.xy), vec2(depth * 20.0)))) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vCorner = corner;
    vColor = vec3(0.0);
    vOpacity = 0.0;
    return;
  }

  // Build the actual 3D Gaussian covariance:
  // Sigma = R * diag(scale^2) * R^T.
  mat3 R = quatMatrix(aQuat);
  vec3 s = max(aScale * uScale, vec3(1e-7));
  mat3 S2 = mat3(
    s.x*s.x, 0.0,     0.0,
    0.0,     s.y*s.y, 0.0,
    0.0,     0.0,     s.z*s.z
  );
  mat3 covWorld = R * S2 * transpose(R);

  // Rotate covariance into camera space.
  mat3 W = mat3(viewMatrix);
  mat3 covCamera = W * covWorld * transpose(W);

  // Perspective Jacobian for x/depth and y/depth.
  float fx = projectionMatrix[0][0];
  float fy = projectionMatrix[1][1];
  float z2 = depth * depth;
  mat3 J = mat3(
    fx / depth, 0.0, fx * cameraCenter.x / z2,
    0.0, fy / depth, fy * cameraCenter.y / z2,
    0.0, 0.0, 0.0
  );

  mat3 T = J * covCamera;
  mat3 cov2 = T * transpose(J);

  // Add a very small screen-space floor so tiny Gaussians remain stable.
  cov2[0][0] += 0.000001;
  cov2[1][1] += 0.000001;

  float aa = cov2[0][0];
  float bb = cov2[0][1];
  float dd = cov2[1][1];
  float mid = 0.5 * (aa + dd);
  float radius = sqrt(max(0.0, 0.25*(aa-dd)*(aa-dd) + bb*bb));
  float lambda1 = max(mid + radius, 1e-10);
  float lambda2 = max(mid - radius, 1e-10);

  vec2 e1 = abs(bb) > 1e-7
    ? normalize(vec2(bb, lambda1 - aa))
    : (aa >= dd ? vec2(1.0, 0.0) : vec2(0.0, 1.0));
  vec2 e2 = vec2(-e1.y, e1.x);

  // sqrt(8) gives a conservative raster footprint while the fragment shader
  // evaluates the Gaussian falloff inside that footprint.
  vec2 axis1 = e1 * sqrt(8.0 * lambda1) * uSplatBlur;
  vec2 axis2 = e2 * sqrt(8.0 * lambda2) * uSplatBlur;

  vec4 clipCenter = projectionMatrix * cameraCenter4;
  vec2 ndcCenter = clipCenter.xy / max(clipCenter.w, 1e-6);
  vec2 ndcOffset = corner.x * axis1 + corner.y * axis2;
  gl_Position = vec4(ndcCenter + ndcOffset, clipCenter.z / clipCenter.w, 1.0);

  vec3 viewDir = normalize(uCameraPosition - worldCenter);
  vCorner = corner;
  vColor = max(evalSH(viewDir), vec3(0.0));
  vOpacity = aOpacity;
}`;

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

    this._sortBins = Math.max(64, Math.min(2048, Number.parseInt(
      window?.FUMOCA_GAUSSIAN_SORT_BINS || '512', 10
    ) || 512));
    this._sortEveryFrame = false;
    this._sortPositionThreshold = 0.001;
    this._sortAngleThreshold = 0.0035;
    this._lastSortPosition = new THREE.Vector3(Infinity, Infinity, Infinity);
    this._lastSortQuaternion = new THREE.Quaternion(0, 0, 0, 0);
    this._sortOrder = new Uint32Array(this.count);
    this._sortCounts = new Uint32Array(this._sortBins);
    this._sortOffsets = new Uint32Array(this._sortBins);
    this._sortCursor = new Uint32Array(this._sortBins);
    this._sortDepths = new Float32Array(this.count);
    this._sortVisited = new Uint8Array(this.count);
    this._sortScratch = new Float32Array(4);

    this._buildGeometry();
    this._fitCamera();

    this.controls = null;
    this._resize = () => this.resize();
    window.addEventListener('resize', this._resize);
    this.resize();

    this._loop = () => {
      if (!this.renderer) return;
      this.controls?.update?.();
      this._updateCameraUniformsAndSort();
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
        uSplatBlur: { value: 1.0 },
        uCameraPosition: { value: new THREE.Vector3() },
      },
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  _cameraNeedsResort() {
    if (this._sortEveryFrame || this._lastSortQuaternion.w === 0) return true;

    const positionMoved = this.camera.position.distanceTo(this._lastSortPosition);
    const radius = Math.max(this._cameraRadius || 1, 0.001);
    if (positionMoved > radius * this._sortPositionThreshold) return true;

    const qDot = Math.abs(this.camera.quaternion.dot(this._lastSortQuaternion));
    return (1 - qDot) > this._sortAngleThreshold;
  }

  _updateCameraUniformsAndSort() {
    if (!this.material || !this.camera) return;
    this.material.uniforms.uCameraPosition.value.copy(this.camera.position);

    if (this._cameraNeedsResort()) {
      this._sortBackToFront();
      this._lastSortPosition.copy(this.camera.position);
      this._lastSortQuaternion.copy(this.camera.quaternion);
    }
  }

  _sortBackToFront() {
    const position = this.geometry.getAttribute('aPosition');
    if (!position || this.count < 2) return;

    const e = this.camera.matrixWorldInverse.elements;
    const N = this.count;
    const bins = this._sortBins;
    const depths = this._sortDepths;
    const counts = this._sortCounts;
    const offsets = this._sortOffsets;
    const cursor = this._sortCursor;
    const order = this._sortOrder;

    counts.fill(0);

    let minDepth = Infinity;
    let maxDepth = -Infinity;

    for (let i = 0; i < N; i++) {
      const o = i * 3;
      const x = position.array[o] * this.worldScale;
      const y = position.array[o + 1] * this.worldScale;
      const z = position.array[o + 2] * this.worldScale;
      const depth = -(e[2] * x + e[6] * y + e[10] * z + e[14]);
      depths[i] = depth;
      if (depth < minDepth) minDepth = depth;
      if (depth > maxDepth) maxDepth = depth;
    }

    const span = Math.max(maxDepth - minDepth, 1e-6);
    for (let i = 0; i < N; i++) {
      let b = Math.floor(((depths[i] - minDepth) / span) * (bins - 1));
      if (b < 0) b = 0;
      else if (b >= bins) b = bins - 1;
      counts[b]++;
    }

    // Build far-to-near bucket offsets. Higher positive camera-space depth
    // is farther from the viewer, so those buckets are emitted first.
    let running = 0;
    for (let b = bins - 1; b >= 0; b--) {
      offsets[b] = running;
      running += counts[b];
    }
    cursor.set(offsets);

    for (let i = 0; i < N; i++) {
      let b = Math.floor(((depths[i] - minDepth) / span) * (bins - 1));
      if (b < 0) b = 0;
      else if (b >= bins) b = bins - 1;
      order[cursor[b]++] = i;
    }

    // Reorder the dynamic instance attributes in-place. This avoids a second
    // full copy of the SH master while making rasterization order far-to-near.
    this._sortVisited.fill(0);
    this._permuteAttribute(this.geometry.getAttribute('aPosition'), order, 3);
    this._sortVisited.fill(0);
    this._permuteAttribute(this.geometry.getAttribute('aScale'), order, 3);
    this._sortVisited.fill(0);
    this._permuteAttribute(this.geometry.getAttribute('aQuat'), order, 4);
    this._sortVisited.fill(0);
    this._permuteAttribute(this.geometry.getAttribute('aOpacity'), order, 1);
    for (let k = 0; k < 16; k++) {
      this._sortVisited.fill(0);
      this._permuteAttribute(this.geometry.getAttribute('sh' + k), order, 3);
    }

    this.geometry.getAttribute('aPosition').needsUpdate = true;
    this.geometry.getAttribute('aScale').needsUpdate = true;
    this.geometry.getAttribute('aQuat').needsUpdate = true;
    this.geometry.getAttribute('aOpacity').needsUpdate = true;
    for (let k = 0; k < 16; k++) {
      this.geometry.getAttribute('sh' + k).needsUpdate = true;
    }
  }

  _permuteAttribute(attribute, order, itemSize) {
    const array = attribute.array;
    const visited = this._sortVisited;
    const scratch = this._sortScratch;

    for (let start = 0; start < this.count; start++) {
      if (visited[start]) continue;

      let next = order[start];
      if (next === start) {
        visited[start] = 1;
        continue;
      }

      const base = start * itemSize;
      for (let c = 0; c < itemSize; c++) scratch[c] = array[base + c];

      let current = start;
      while (true) {
        visited[current] = 1;
        next = order[current];

        if (next === start) {
          const dst = current * itemSize;
          for (let c = 0; c < itemSize; c++) array[dst + c] = scratch[c];
          break;
        }

        const src = next * itemSize;
        const dst = current * itemSize;

        for (let c = 0; c < itemSize; c++) {
          const tmp = array[src + c];
          array[dst + c] = scratch[c];
          scratch[c] = tmp;
        }

        current = next;
      }
    }
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
    this._cameraRadius = radius;
    this.camera.updateProjectionMatrix();

    // Use the same OrbitControls implementation already imported by viewer.js.
    // viewer.js replaces this with its OrbitControls instance after construction.
    this.material.uniforms.uCameraPosition.value.copy(this.camera.position);
    this._sortBackToFront();
    this._lastSortPosition.copy(this.camera.position);
    this._lastSortQuaternion.copy(this.camera.quaternion);
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
    this._sortBackToFront();
    this._lastSortPosition.copy(this.camera.position);
    this._lastSortQuaternion.copy(this.camera.quaternion);
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
