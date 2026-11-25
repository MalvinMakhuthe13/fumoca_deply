/**
 * Public viewer: restore the presentation platform saved in Studio.
 * The published splat group is re-parented under a rig together with the
 * base, so orbit, zoom and the optional turntable move them as one object.
 */
import * as THREE from 'three';
import { buildPlatform, normalizePlatformConfig, loadLogoTexture, seatFromPoints } from './platform-build.js';

let current = null;

function sampleSeat(mesh, group) {
  const xs = [], ys = [], zs = [];
  const splats = mesh?.packedSplats || mesh?.splats;
  if (splats?.forEachSplat) {
    const v = new THREE.Vector3();
    try {
      splats.forEachSplat((index, center) => {
        if ((index & 7) !== 0 || !center) return;
        v.copy(center).applyMatrix4(mesh.matrix);      // into group space
        xs.push(v.x); ys.push(v.y); zs.push(v.z);
      });
    } catch (_) {}
  }
  if (xs.length < 20 && group) {
    const box = new THREE.Box3().setFromObject(group);
    if (!box.isEmpty()) {
      const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
      return { center: [c.x, c.y, c.z], minY: box.min.y, footprint: Math.max(s.x, s.z, 1e-4) };
    }
  }
  return seatFromPoints(xs, ys, zs);
}

export async function restorePlatform(saved) {
  const cfg = normalizePlatformConfig(saved);
  if (!cfg.enabled) return false;
  const group = window._fumocaPublishedSparkGroup;
  const scene = window._fumocaViewerScene;
  const mesh = window._fumocaPublishedSparkMesh;
  if (!group || !scene) return false;
  if (current?.group === group) return true;
  group.updateMatrixWorld(true);
  const seat = sampleSeat(mesh, group);
  if (!seat) return false;

  // rig (pivot at the seat point) → [base, holder → published group]
  const rig = new THREE.Group(); rig.name = 'fumoca-presentation-root';
  const base = new THREE.Group(); base.name = 'fumoca-platform-base';
  const holder = new THREE.Group(); holder.name = 'fumoca-presentation-splats';
  // Seat point in the group's own space → its parent's space.
  const pivot = new THREE.Vector3(seat.center[0], seat.minY - seat.footprint * (cfg.drop / 100), seat.center[2])
    .applyMatrix4(group.matrix);
  const parent = group.parent || scene;
  parent.add(rig);
  rig.position.copy(pivot);
  rig.add(base); rig.add(holder);
  holder.position.copy(pivot).negate();   // keeps the splat exactly where it was
  holder.add(group);
  if (!scene.getObjectByName('fumoca-platform-light')) {
    const key = new THREE.DirectionalLight(0xffffff, 1.2); key.position.set(1, 2, 1.5); key.name = 'fumoca-platform-light';
    const fill = new THREE.AmbientLight(0xffffff, 0.55); fill.name = 'fumoca-platform-ambient';
    scene.add(key, fill);
  }
  buildPlatform(THREE, base, cfg, seat.footprint, null);
  loadLogoTexture(THREE, cfg.logoSrc).then(tex => { if (tex) buildPlatform(THREE, base, cfg, seat.footprint, tex); });

  let angle = 0, last = 0, raf = 0;
  const pose = () => {
    rig.rotation.order = 'YXZ';
    rig.rotation.set(cfg.tilt * Math.PI / 180, (cfg.spin + angle) * Math.PI / 180, 0);
  };
  pose();
  if (cfg.turntable) {
    const tick = (now) => {
      raf = requestAnimationFrame(tick);
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0; last = now;
      angle = (angle + cfg.turntable * dt) % 360; pose();
    };
    raf = requestAnimationFrame(tick);
  }
  current = { group, rig, stop() { cancelAnimationFrame(raf); } };
  window.dispatchEvent(new CustomEvent('fumoca:platformRestored', { detail: cfg }));
  return true;
}

export function clearPlatform() {
  if (!current) return;
  current.stop();
  const { rig, group } = current;
  const parent = rig.parent;
  if (parent) { parent.add(group); parent.remove(rig); }
  current = null;
}

export default { restorePlatform, clearPlatform };
