/**
 * FUMOCA Presentation Base
 * Solid parametric 3D platform that sits under a splat/scene.
 * Logo lives on the underside so rotation naturally reveals it.
 * Everything is parented under one Group so zoom/orbit/pan stay locked.
 *
 * Usage:
 *   import { PresentationBase } from './presentation-base.js';
 *   const base = new PresentationBase(scene, {
 *     shape: 'circle',
 *     width: 0.6,          // metres
 *     height: 0.08,
 *     edgeRadius: 0.02,
 *     material: 'wood',
 *     logoUrl: null,
 *     logoSize: 0.4,
 *     logoRotation: 0,
 *     logoOffsetZ: -0.005
 *   });
 *   // Parent your splat / object group under base.assembly
 *   base.assembly.add(yourSplatGroup);
 *   base.setPositionY(-0.12); // relative to the object
 */

import * as THREE from 'three';

const MATERIALS = {
  wood:  { color: 0x8b5a2b, roughness: 0.65, metalness: 0.05, map: 'wood' },
  black: { color: 0x111111, roughness: 0.4,  metalness: 0.3  },
  white: { color: 0xf5f5f5, roughness: 0.35, metalness: 0.05 },
  metal: { color: 0xaaaaaa, roughness: 0.2,  metalness: 0.9  },
  glass: { color: 0xffffff, roughness: 0.05, metalness: 0.0, transmission: 0.9, thickness: 0.02 }
};

export class PresentationBase {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.options = {
      shape: 'circle',
      width: 0.6,
      depth: 0.6,
      height: 0.08,
      edgeRadius: 0.02,
      material: 'wood',
      positionY: -0.12,
      logoUrl: null,
      logoSize: 0.4,
      logoRotation: 0,
      logoOffsetZ: -0.005,
      showLightRing: true,
      ...options
    };

    this.assembly = new THREE.Group();
    this.assembly.name = 'PresentationAssembly';
    this.platform = null;
    this.logoMesh = null;
    this.lightRing = null;
    this.logoTexture = null;

    this._build();
    if (scene) scene.add(this.assembly);
  }

  _build() {
    this._disposeMeshes();
    this._createPlatform();
    this._createLightRing();
    this._createLogo();
    this.assembly.position.y = this.options.positionY;
  }

  _disposeMeshes() {
    [this.platform, this.logoMesh, this.lightRing].forEach(m => {
      if (m) {
        m.geometry?.dispose();
        if (Array.isArray(m.material)) m.material.forEach(mat => mat.dispose());
        else m.material?.dispose();
        this.assembly.remove(m);
      }
    });
    this.platform = this.logoMesh = this.lightRing = null;
  }

  _createPlatform() {
    const { shape, width, depth, height, edgeRadius, material } = this.options;
    const w = width;
    const d = depth || width;
    const h = height;
    const r = Math.min(edgeRadius, Math.min(w, d) / 2 - 0.001);

    let geometry;
    if (shape === 'circle') {
      geometry = new THREE.CylinderGeometry(w / 2, w / 2, h, 64);
    } else if (shape === 'square' || shape === 'rectangle') {
      const shape2d = new THREE.Shape();
      const hw = w / 2, hd = d / 2;
      shape2d.moveTo(-hw + r, -hd);
      shape2d.lineTo( hw - r, -hd);
      shape2d.quadraticCurveTo( hw, -hd, hw, -hd + r);
      shape2d.lineTo( hw,  hd - r);
      shape2d.quadraticCurveTo( hw,  hd, hw - r, hd);
      shape2d.lineTo(-hw + r,  hd);
      shape2d.quadraticCurveTo(-hw,  hd, -hw, hd - r);
      shape2d.lineTo(-hw, -hd + r);
      shape2d.quadraticCurveTo(-hw, -hd, -hw + r, -hd);
      const extrude = new THREE.ExtrudeGeometry(shape2d, {
        depth: h,
        bevelEnabled: false,
        steps: 1
      });
      extrude.rotateX(-Math.PI / 2);
      extrude.translate(0, -h / 2, 0);
      geometry = extrude;
    } else {
      // custom fallback = rounded rect
      geometry = new THREE.BoxGeometry(w, h, d);
    }

    const matDef = MATERIALS[material] || MATERIALS.wood;
    const mat = new THREE.MeshPhysicalMaterial({
      color: matDef.color,
      roughness: matDef.roughness,
      metalness: matDef.metalness,
      transmission: matDef.transmission || 0,
      thickness: matDef.thickness || 0,
      clearcoat: material === 'wood' ? 0.15 : 0,
      clearcoatRoughness: 0.4
    });

    // Simple wood grain if no external texture
    if (material === 'wood' && !matDef.map) {
      mat.map = this._makeWoodTexture();
    }

    this.platform = new THREE.Mesh(geometry, mat);
    this.platform.castShadow = true;
    this.platform.receiveShadow = true;
    this.platform.name = 'Platform';
    this.assembly.add(this.platform);
  }

  _createLightRing() {
    if (!this.options.showLightRing) return;
    const { width, height } = this.options;
    const radius = (width / 2) * 0.92;
    const geom = new THREE.TorusGeometry(radius, 0.006, 16, 80);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xfff4d0,
      transparent: true,
      opacity: 0.9
    });
    this.lightRing = new THREE.Mesh(geom, mat);
    this.lightRing.rotation.x = Math.PI / 2;
    this.lightRing.position.y = -height / 2 + 0.002;
    this.lightRing.name = 'LightRing';
    this.assembly.add(this.lightRing);
  }

  _createLogo() {
    const { logoUrl, logoSize, logoRotation, logoOffsetZ, width, height } = this.options;
    if (!logoUrl) return;

    const loader = new THREE.TextureLoader();
    loader.load(logoUrl, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      this.logoTexture = tex;

      const size = logoSize;
      const geom = new THREE.PlaneGeometry(size, size);
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false
      });

      this.logoMesh = new THREE.Mesh(geom, mat);
      // Face downward (underside)
      this.logoMesh.rotation.x = Math.PI; // flip so image is correct when viewed from below
      this.logoMesh.rotation.z = THREE.MathUtils.degToRad(logoRotation);
      this.logoMesh.position.y = -height / 2 + logoOffsetZ;
      this.logoMesh.name = 'UndersideLogo';
      this.assembly.add(this.logoMesh);
    });
  }

  _makeWoodTexture() {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 512;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#7a4a1f';
    ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 40; i++) {
      ctx.strokeStyle = `rgba(${100 + Math.random()*40},${60 + Math.random()*30},${20 + Math.random()*20},${0.3 + Math.random()*0.4})`;
      ctx.lineWidth = 1 + Math.random() * 3;
      ctx.beginPath();
      ctx.moveTo(0, Math.random() * 512);
      ctx.bezierCurveTo(128, Math.random()*512, 384, Math.random()*512, 512, Math.random()*512);
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2, 2);
    return tex;
  }

  // ── Public setters ────────────────────────────────────────────────────────
  setShape(shape) { this.options.shape = shape; this._build(); }
  setDimensions({ width, depth, height, edgeRadius }) {
    Object.assign(this.options, { width, depth, height, edgeRadius });
    this._build();
  }
  setMaterial(name) { this.options.material = name; this._build(); }
  setPositionY(y) { this.options.positionY = y; this.assembly.position.y = y; }
  setLogo(url, size, rotation, offsetZ) {
    this.options.logoUrl = url;
    this.options.logoSize = size ?? this.options.logoSize;
    this.options.logoRotation = rotation ?? this.options.logoRotation;
    this.options.logoOffsetZ = offsetZ ?? this.options.logoOffsetZ;
    this._build();
  }

  getConfig() {
    return { ...this.options };
  }

  loadConfig(cfg) {
    Object.assign(this.options, cfg);
    this._build();
  }

  dispose() {
    this._disposeMeshes();
    if (this.scene) this.scene.remove(this.assembly);
  }
}
