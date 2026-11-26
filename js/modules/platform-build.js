/**
 * FUMOCA presentation platform — shared geometry.
 *
 * Used by the Studio Platform tab (authoring) and the public viewer
 * (restoring a saved platform), so both draw exactly the same base.
 * The platform's top surface sits at y = 0 of the returned group; the caller
 * places the group at the splat's seat point.
 */

export const DEFAULT_PLATFORM = Object.freeze({
  enabled: false,
  shape: 'circle',     // circle | square | rect
  fit: 130,            // % of the splat footprint
  thickness: 12,       // % of width
  edge: 16,            // bevel/inset %
  drop: 0,             // % of footprint below the splat's lowest point
  material: 'wood',    // wood | black | white | metal
  logoSrc: null,       // https URL (published) or data:image/png (unsaved)
  logoScale: 62, logoRot: 0, logoShift: 0,
  spin: 0, tilt: 0,    // static pose, degrees
  turntable: 0,        // continuous spin, degrees per second (0 = off)
  glow: true,
});

const clamp = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

/** Validate untrusted saved config (it comes from NIF metadata). */
export function normalizePlatformConfig(input = {}) {
  const c = input && typeof input === 'object' ? input : {};
  const d = DEFAULT_PLATFORM;
  const logo = typeof c.logoSrc === 'string' ? c.logoSrc : null;
  const safeLogo = logo && (/^https:\/\//i.test(logo) || /^data:image\/(png|jpeg|webp);base64,/i.test(logo)) ? logo : null;
  return {
    enabled: c.enabled === true,
    shape: ['circle', 'square', 'rect'].includes(c.shape) ? c.shape : d.shape,
    fit: clamp(c.fit, 60, 260, d.fit),
    thickness: clamp(c.thickness, 2, 50, d.thickness),
    edge: clamp(c.edge, 0, 45, d.edge),
    drop: clamp(c.drop, -40, 40, d.drop),
    material: ['wood', 'black', 'white', 'metal'].includes(c.material) ? c.material : d.material,
    logoSrc: safeLogo,
    logoScale: clamp(c.logoScale, 10, 100, d.logoScale),
    logoRot: clamp(c.logoRot, -360, 360, d.logoRot),
    logoShift: clamp(c.logoShift, -45, 45, d.logoShift),
    spin: clamp(c.spin, -360, 360, d.spin),
    tilt: clamp(c.tilt, 0, 180, d.tilt),
    turntable: clamp(c.turntable, -120, 120, d.turntable),
    glow: c.glow !== false,
  };
}

export function platformMetrics(cfg, footprint) {
  const width = Math.max(footprint * (cfg.fit / 100), 1e-4);
  const depth = cfg.shape === 'rect' ? width * 0.66 : width;
  const height = Math.max(width * (cfg.thickness / 100), footprint * 0.012);
  return { width, depth, height };
}

let _wood = null;
function woodTexture(THREE) {
  if (_wood) return _wood;
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const ctx = c.getContext('2d');
  let n = 42;
  const rand = () => { n = (n * 16807) % 2147483647; return (n & 0xffff) / 0xffff; };
  const g = ctx.createLinearGradient(0, 0, 512, 80);
  g.addColorStop(0, '#4a2e18'); g.addColorStop(0.45, '#8d5a30'); g.addColorStop(0.55, '#c4a574'); g.addColorStop(1, '#3a2412');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 46; i++) {
    ctx.strokeStyle = 'rgba(30,16,8,' + (0.08 + rand() * 0.18) + ')';
    ctx.lineWidth = 0.6 + rand() * 1.6;
    const y = rand() * 512;
    ctx.beginPath(); ctx.moveTo(0, y);
    ctx.bezierCurveTo(140, y + (rand() - 0.5) * 24, 320, y + (rand() - 0.5) * 24, 512, y);
    ctx.stroke();
  }
  _wood = new THREE.CanvasTexture(c);
  _wood.wrapS = _wood.wrapT = THREE.RepeatWrapping;
  if ('SRGBColorSpace' in THREE) _wood.colorSpace = THREE.SRGBColorSpace;
  return _wood;
}

function topMaterial(THREE, material) {
  if (material === 'wood') return new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.04, map: woodTexture(THREE) });
  if (material === 'black') return new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.4, metalness: 0.25 });
  if (material === 'white') return new THREE.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.42, metalness: 0.02 });
  return new THREE.MeshStandardMaterial({ color: 0xb7b7b7, roughness: 0.16, metalness: 0.88 });
}

/** Load a logo URL/data URL into a texture (null on failure). */
export function loadLogoTexture(THREE, src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const t = new THREE.Texture(img);
      if ('SRGBColorSpace' in THREE) t.colorSpace = THREE.SRGBColorSpace;
      t.needsUpdate = true;
      resolve(t);
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * Build the platform meshes into `group` (cleared first).
 * @returns {{ width:number, depth:number, height:number }}
 */
export function buildPlatform(THREE, group, cfgIn, footprint, logoTexture = null) {
  const cfg = normalizePlatformConfig({ ...cfgIn, enabled: true });
  for (const child of [...group.children]) {
    group.remove(child);
    child.geometry?.dispose?.();
    (Array.isArray(child.material) ? child.material : [child.material]).forEach(m => { if (m && m.map !== _wood) m.dispose?.(); });
  }
  const { width, depth, height } = platformMetrics(cfg, footprint);
  const side = new THREE.MeshStandardMaterial({ color: 0x101010, roughness: 0.42, metalness: 0.45 });
  const top = topMaterial(THREE, cfg.material);
  const capH = Math.max(height * 0.1, footprint * 0.004);
  const bodyH = Math.max(height - capH, height * 0.55);
  const square = cfg.shape === 'square';
  const body = cfg.shape === 'circle'
    ? new THREE.Mesh(new THREE.CylinderGeometry(width / 2, width / 2, bodyH, 80), side)
    : new THREE.Mesh(new THREE.BoxGeometry(width, bodyH, square ? width : depth), side);
  body.name = 'fumoca-platform-mesh';
  body.position.y = -capH - bodyH / 2;
  group.add(body);
  const inset = width * (cfg.edge / 100) * 0.12;
  const topW = Math.max(width - inset * 2, width * 0.72);
  const topD = Math.max(depth - inset * 2, depth * 0.72);
  const cap = cfg.shape === 'circle'
    ? new THREE.Mesh(new THREE.CylinderGeometry(topW / 2, width / 2, capH, 80), top)
    : new THREE.Mesh(new THREE.BoxGeometry(topW, capH, square ? topW : topD), top);
  cap.name = 'fumoca-platform-top';
  cap.position.y = -capH / 2;
  group.add(cap);
  if (cfg.glow) {
    const radius = (cfg.shape === 'circle' ? width : Math.max(width, depth)) * 0.5;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(radius * 1.02, Math.max(height * 0.045, radius * 0.012), 16, 96),
      new THREE.MeshBasicMaterial({ color: 0xfff4cc, toneMapped: false }));
    ring.name = 'fumoca-platform-ring';
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -height + Math.max(height * 0.22, radius * 0.02);
    group.add(ring);
  }
  if (logoTexture) {
    const span = Math.min(width, cfg.shape === 'rect' ? depth : width) * (cfg.logoScale / 100);
    const logo = new THREE.Mesh(new THREE.PlaneGeometry(span, span),
      new THREE.MeshBasicMaterial({ map: logoTexture, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    logo.name = 'fumoca-platform-logo';
    logo.rotation.x = Math.PI / 2;
    logo.rotation.z = cfg.logoRot * Math.PI / 180;
    logo.position.set(0, -height - Math.max(footprint * 0.002, 0.001), (cfg.logoShift / 100) * width * 0.5);
    logo.renderOrder = 3;
    group.add(logo);
  }
  return { width, depth, height };
}

/** Make a lightweight PNG data URL from an uploaded image (also neutralises SVG). */
export async function logoFileToDataUrl(file, maxSide = 512) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bitmap.width * scale));
  c.height = Math.max(1, Math.round(bitmap.height * scale));
  c.getContext('2d').drawImage(bitmap, 0, 0, c.width, c.height);
  bitmap.close?.();
  return c.toDataURL('image/png');
}

/** Robust seat box from sampled splat centres: ignores stray floaters. */
export function seatFromPoints(xs, ys, zs) {
  if (xs.length < 20) return null;
  const at = (arr, p) => { const s = arr.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]; };
  // the base: the lowest real splats (1 %), not 8 % up into the object
  const min = [at(xs, 0.12), at(ys, 0.01), at(zs, 0.12)];
  const max = [at(xs, 0.88), at(ys, 0.98), at(zs, 0.88)];
  return {
    center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
    minY: min[1],
    footprint: Math.max(max[0] - min[0], max[2] - min[2], 1e-4),
  };
}
