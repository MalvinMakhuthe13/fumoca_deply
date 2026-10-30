/**
 * FUMOCA Presentation Base
 *
 * A solid, editable 3D display platform. Keep the scanned object and this
 * platform inside the same presentation assembly so orbit/zoom/pan affect
 * them together. The scan itself is never modified.
 */
import * as THREE from 'three';

const MATERIALS = {
  wood:  { color: 0x8b5a2b, roughness: 0.68, metalness: 0.02, clearcoat: 0.18 },
  black: { color: 0x111318, roughness: 0.38, metalness: 0.28 },
  white: { color: 0xf3f2ed, roughness: 0.34, metalness: 0.03 },
  metal: { color: 0x9fa7b1, roughness: 0.22, metalness: 0.88 },
  glass: { color: 0xffffff, roughness: 0.08, metalness: 0, transmission: 0.82, thickness: 0.025 }
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function roundedRectShape(width, depth, radius) {
  const x = width / 2, z = depth / 2;
  const r = clamp(Number(radius) || 0, 0, Math.min(width, depth) / 2);
  const s = new THREE.Shape();
  s.moveTo(-x + r, -z);
  s.lineTo(x - r, -z); s.quadraticCurveTo(x, -z, x, -z + r);
  s.lineTo(x, z - r); s.quadraticCurveTo(x, z, x - r, z);
  s.lineTo(-x + r, z); s.quadraticCurveTo(-x, z, -x, z - r);
  s.lineTo(-x, -z + r); s.quadraticCurveTo(-x, -z, -x + r, -z);
  return s;
}

function normaliseOutline(points, width, depth) {
  if (!Array.isArray(points) || points.length < 3) return null;
  const clean = points.map(p => ({ x: Number(p.x), z: Number(p.z) }))
    .filter(p => Number.isFinite(p.x) && Number.isFinite(p.z));
  if (clean.length < 3) return null;
  const xs = clean.map(p => p.x), zs = clean.map(p => p.z);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const spanX = maxX - minX, spanZ = maxZ - minZ;
  if (spanX <= 0 || spanZ <= 0) return null;
  return clean.map(p => ({
    x: ((p.x - (minX + maxX) / 2) / spanX) * width,
    z: ((p.z - (minZ + maxZ) / 2) / spanZ) * depth
  }));
}

export class PresentationBase {
  constructor(scene = null, options = {}) {
    this.scene = scene;
    this.options = {
      shape: 'circle', width: 0.6, depth: 0.6, height: 0.08,
      edgeRadius: 0.02, customPoints: null, material: 'wood',
      positionX: 0, positionY: 0, positionZ: 0, platformY: 0, logoUrl: null, logoSize: 0.4,
      logoRotation: 0, logoOffset: 0.002, showLightRing: true,
      lightRingColor: 0xffe6a3, lightRingInset: 0.035,
      ...options
    };
    this.assembly = new THREE.Group();
    this.assembly.name = 'FumocaPresentationAssembly';
    this.assembly.userData.fumocaPresentationAssembly = true;
    this.platform = null;
    this.logoMesh = null;
    this.lightRing = null;
    this.logoTexture = null;
    this._logoRequest = 0;
    this._build();
    if (scene) scene.add(this.assembly);
  }

  _disposeObject(object) {
    if (!object) return;
    this.assembly.remove(object);
    object.geometry?.dispose?.();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.filter(Boolean).forEach(material => {
      if (material.map && material.map !== this.logoTexture) material.map.dispose?.();
      material.dispose?.();
    });
  }

  _clearLogo() {
    this._logoRequest++;
    this._disposeObject(this.logoMesh);
    this.logoMesh = null;
    this.logoTexture?.dispose?.();
    this.logoTexture = null;
  }

  _build() {
    this._clearLogo();
    this._disposeObject(this.platform);
    this._disposeObject(this.lightRing);
    this.platform = this.lightRing = null;
    this._createPlatform();
    this._createLightRing();
    this._createLogo();
    this.assembly.position.set(Number(this.options.positionX)||0,Number(this.options.positionY)||0,Number(this.options.positionZ)||0);
  }

  _createPlatform() {
    const o = this.options;
    const width = Math.max(0.02, Number(o.width) || 0.6);
    const depth = Math.max(0.02, Number(o.depth) || width);
    const height = Math.max(0.005, Number(o.height) || 0.08);
    let geometry;

    if (o.shape === 'circle') {
      geometry = new THREE.CylinderGeometry(width / 2, width / 2, height, 96, 1, false);
    } else {
      let outline;
      if (o.shape === 'custom') {
        const points = normaliseOutline(o.customPoints, width, depth);
        if (points) {
          outline = new THREE.Shape();
          outline.moveTo(points[0].x, points[0].z);
          points.slice(1).forEach(p => outline.lineTo(p.x, p.z));
          outline.closePath();
        }
      }
      if (!outline) outline = roundedRectShape(width, depth, o.edgeRadius);
      geometry = new THREE.ExtrudeGeometry(outline, {
        depth: height, bevelEnabled: false, curveSegments: 12, steps: 1
      });
      // Shape is drawn in X/Z; extrusion becomes the vertical Y thickness.
      geometry.rotateX(-Math.PI / 2);
      geometry.translate(0, -height / 2, 0);
      geometry.computeVertexNormals();
    }

    const def = MATERIALS[o.material] || MATERIALS.wood;
    const material = new THREE.MeshPhysicalMaterial({
      color: def.color, roughness: def.roughness, metalness: def.metalness,
      transmission: def.transmission || 0, thickness: def.thickness || 0,
      clearcoat: def.clearcoat || 0
    });
    if (o.material === 'wood') material.map = this._makeWoodTexture();

    this.platform = new THREE.Mesh(geometry, material);
    this.platform.name = 'PresentationPlatform';
    this.platform.position.y = Number(o.platformY) || 0;
    this.platform.castShadow = true;
    this.platform.receiveShadow = true;
    this.assembly.add(this.platform);
  }

  _createLightRing() {
    const o = this.options;
    if (!o.showLightRing || o.shape !== 'circle') return;
    const radius = Math.max(0.01, o.width / 2 - o.lightRingInset);
    const geometry = new THREE.TorusGeometry(radius, 0.0035, 12, 96);
    const material = new THREE.MeshBasicMaterial({
      color: o.lightRingColor, transparent: true, opacity: 0.88,
      depthWrite: false, side: THREE.DoubleSide
    });
    this.lightRing = new THREE.Mesh(geometry, material);
    this.lightRing.rotation.x = Math.PI / 2;
    this.lightRing.position.y = (Number(o.platformY) || 0) - o.height / 2 - 0.0008;
    this.lightRing.name = 'UndersideLightRing';
    this.assembly.add(this.lightRing);
  }

  _createLogo() {
    const o = this.options;
    if (!o.logoUrl) return;
    const request = ++this._logoRequest;
    const loader = new THREE.TextureLoader();
    loader.load(o.logoUrl, texture => {
      if (request !== this._logoRequest) { texture.dispose(); return; }
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 8;
      const image = texture.image || {};
      const aspect = image.width && image.height ? image.width / image.height : 1;
      const maxSize = Math.max(0.01, Number(o.logoSize) || 0.4);
      const w = aspect >= 1 ? maxSize : maxSize * aspect;
      const h = aspect >= 1 ? maxSize / aspect : maxSize;
      const geometry = new THREE.PlaneGeometry(w, h);
      const material = new THREE.MeshBasicMaterial({
        map: texture, transparent: true, alphaTest: 0.015,
        side: THREE.DoubleSide, depthWrite: true, toneMapped: false
      });
      const mesh = new THREE.Mesh(geometry, material);
      // Plane's +Z normal rotated +90° around X points down (-Y).
      mesh.rotation.x = Math.PI / 2;
      mesh.rotation.y = THREE.MathUtils.degToRad(Number(o.logoRotation) || 0);
      mesh.position.y = (Number(o.platformY) || 0) - o.height / 2 - Math.max(0.0005, Number(o.logoOffset) || 0.002);
      mesh.name = 'UndersideBranding';
      mesh.renderOrder = 2;
      this.logoTexture = texture;
      this.logoMesh = mesh;
      this.assembly.add(mesh);
    }, undefined, error => {
      console.warn('[FUMOCA] Could not load presentation logo:', error);
    });
  }

  _makeWoodTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 512;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 512, 512);
    gradient.addColorStop(0, '#95602f');
    gradient.addColorStop(0.5, '#6f421f');
    gradient.addColorStop(1, '#a8733c');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 70; i++) {
      const y = Math.random() * 512;
      ctx.strokeStyle = `rgba(42,22,9,${0.035 + Math.random() * 0.09})`;
      ctx.lineWidth = 1 + Math.random() * 3;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(150, y - 18, 350, y + 18, 512, y + (Math.random() - 0.5) * 24);
      ctx.stroke();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(2, 2);
    return texture;
  }

  /** Attach a scan/group without changing its internal geometry or transforms. */
  attach(object) {
    if (!object) throw new Error('A scan object is required.');
    this.assembly.add(object);
    return object;
  }

  /**
   * Fit beneath a point-cloud bounds object { minX, maxX, minY, maxY, minZ, maxZ }.
   * This is the editor/public-viewer path: it does not reparent or mutate Gaussian data.
   */
  fitToBounds(bounds, { padding = 0.04, gap = 0, width = null, depth = null } = {}) {
    const values = ['minX', 'maxX', 'minY', 'maxY', 'minZ', 'maxZ'];
    if (!bounds || values.some(key => !Number.isFinite(Number(bounds[key])))) {
      throw new Error('Valid scan bounds are required to fit the presentation base.');
    }
    const scanWidth = Number(bounds.maxX) - Number(bounds.minX);
    const scanDepth = Number(bounds.maxZ) - Number(bounds.minZ);
    if (scanWidth <= 0 || scanDepth <= 0) {
      throw new Error('The scan bounds are too small to fit a platform.');
    }
    const fittedDiameter = Math.max(scanWidth, scanDepth) + padding * 2;
    const nextWidth = Math.max(0.02, width ?? (this.options.shape === 'circle' || this.options.shape === 'square' ? fittedDiameter : scanWidth + padding * 2));
    const nextDepth = this.options.shape === 'circle' || this.options.shape === 'square' ? nextWidth : Math.max(0.02, depth ?? scanDepth + padding * 2);
    const nextPlatformY = Number(bounds.minY) - gap - this.options.height / 2;
    this.options.positionX = (Number(bounds.minX) + Number(bounds.maxX)) / 2;
    this.options.positionZ = (Number(bounds.minZ) + Number(bounds.maxZ)) / 2;
    this.assembly.position.set(this.options.positionX, Number(this.options.positionY) || 0, this.options.positionZ);
    this.update({ width: nextWidth, depth: nextDepth, platformY: nextPlatformY });
    return { width: nextWidth, depth: nextDepth, topY: nextPlatformY + this.options.height / 2 };
  }

  /**
   * Fit the platform beneath an object already parented to this assembly.
   * The object's own transform and geometry are left untouched.
   */
  fitToObject(object, { padding = 0.04, gap = 0, width = null, depth = null } = {}) {
    if (!object || !this.assembly.getObjectById(object.id)) {
      throw new Error('Attach the scan to this presentation assembly before fitting the base.');
    }
    this.assembly.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(object);
    if (bounds.isEmpty()) throw new Error('The scan has no measurable bounds.');
    const inverse = this.assembly.matrixWorld.clone().invert();
    const corners = [];
    for (const x of [bounds.min.x, bounds.max.x]) {
      for (const y of [bounds.min.y, bounds.max.y]) {
        for (const z of [bounds.min.z, bounds.max.z]) {
          corners.push(new THREE.Vector3(x, y, z).applyMatrix4(inverse));
        }
      }
    }
    const local = new THREE.Box3().setFromPoints(corners);
    const w = width ?? (local.max.x - local.min.x + padding * 2);
    const d = depth ?? (local.max.z - local.min.z + padding * 2);
    this.update({
      width: Math.max(0.02, w),
      depth: Math.max(0.02, d),
      platformY: local.min.y - gap - this.options.height / 2
    });
    return { width: this.options.width, depth: this.options.depth, topY: this.platform.position.y + this.options.height / 2 };
  }

  _updateGeometryShape() {
    // Rebuild once after a fit, retaining the calculated platform elevation.
    const y = this.platform.position.y;
    this._build();
    this.platform.position.y = y;
    this._positionUndersideParts();
  }

  _positionUndersideParts() {
    const y = this.platform.position.y - this.options.height / 2;
    if (this.logoMesh) this.logoMesh.position.y = y - Math.max(0.0005, Number(this.options.logoOffset) || 0.002);
    if (this.lightRing) this.lightRing.position.y = y - 0.0008;
  }

  /** Apply many UI changes with one geometry rebuild. */
  update(patch = {}) {
    const old = { ...this.options };
    Object.assign(this.options, patch);
    const geometryChanged = ['shape', 'width', 'depth', 'height', 'edgeRadius', 'customPoints', 'material', 'platformY', 'showLightRing', 'lightRingColor', 'lightRingInset']
      .some(key => patch[key] !== undefined && patch[key] !== old[key]);
    const logoChanged = ['logoUrl', 'logoSize', 'logoRotation', 'logoOffset']
      .some(key => patch[key] !== undefined && patch[key] !== old[key]);
    if (geometryChanged) this._build();
    else if (logoChanged) {
      this._clearLogo();
      this._createLogo();
    }
    if (patch.positionX !== undefined || patch.positionY !== undefined || patch.positionZ !== undefined) this.assembly.position.set(Number(this.options.positionX)||0,Number(this.options.positionY)||0,Number(this.options.positionZ)||0);
    return this;
  }

  setShape(shape, customPoints) { return this.update({ shape, ...(customPoints ? { customPoints } : {}) }); }
  setDimensions(dimensions) { return this.update(dimensions); }
  setMaterial(material) { return this.update({ material }); }
  setPositionY(positionY) { return this.update({ positionY }); }
  setLogo(logoUrl, logoSize, logoRotation, logoOffset) {
    return this.update({ logoUrl, logoSize, logoRotation, logoOffset });
  }

  getConfig() {
    return { ...this.options, customPoints: this.options.customPoints ? this.options.customPoints.map(p => ({ ...p })) : null };
  }

  loadConfig(config = {}) { return this.update(config); }

  dispose() {
    this._clearLogo();
    this._disposeObject(this.platform);
    this._disposeObject(this.lightRing);
    this.platform = this.lightRing = null;
    this.scene?.remove(this.assembly);
    this.assembly.clear();
  }
}
