/**
 * Apply editor state to Spark's live PackedSplats buffer.
 * This updates the existing Gaussian mesh in place; it never replaces the
 * visible mesh during an interactive transform.
 */
export function applyEditorStateToPackedSplats(mesh, state, indices = null, THREE = globalThis.THREE) {
  const packed = mesh?.packedSplats;
  if (!mesh || !packed || typeof packed.setSplat !== 'function' || !state?.alive || !state?.positions) {
    return { ok: false, reason: 'Spark mesh or editor state is unavailable' };
  }
  if (!THREE?.Vector3 || !THREE?.Quaternion || !THREE?.Color) {
    return { ok: false, reason: 'Three.js primitives are unavailable' };
  }

  const count = state.alive.length;
  const existing = Number(mesh.numSplats ?? packed.numSplats ?? 0);
  if (!Number.isInteger(existing) || existing < 0 || count < existing) {
    return { ok: false, reason: 'Editor point count no longer matches the Spark source' };
  }

  const center = new THREE.Vector3();
  const scales = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const color = new THREE.Color();
  const getSplat = (i) => {
    center.set(state.positions[i * 3], state.positions[i * 3 + 1], state.positions[i * 3 + 2]);
    const sx = Number(state.scaleXYZ?.[i * 3] ?? state.scale?.[i] ?? 0.01);
    const sy = Number(state.scaleXYZ?.[i * 3 + 1] ?? state.scale?.[i] ?? 0.01);
    const sz = Number(state.scaleXYZ?.[i * 3 + 2] ?? state.scale?.[i] ?? 0.01);
    scales.set(Math.max(1e-6, sx), Math.max(1e-6, sy), Math.max(1e-6, sz));

    // PLY Gaussian rotations are stored by FUMOCA as w,x,y,z. The .splat
    // decoder stores x,y,z,w, matching THREE.Quaternion's constructor.
    if (state.rotation) {
      const o = i * 4;
      if (state.rotationOrder === 'xyzw' || (!state.rotationOrder && state.fileType !== 'ply')) {
        rotation.set(state.rotation[o], state.rotation[o + 1], state.rotation[o + 2], state.rotation[o + 3]);
      } else {
        rotation.set(state.rotation[o + 1], state.rotation[o + 2], state.rotation[o + 3], state.rotation[o]);
      }
      if (rotation.lengthSq() > 1e-12) rotation.normalize();
      else rotation.identity();
    } else rotation.identity();

    const c = i * 3;
    const channel = axis => {
      const painted = Number(state.paintColors?.[c + axis]);
      const base = Number(state.colors?.[c + axis] ?? [0.72, 0.68, 0.64][axis]);
      return Math.max(0, Math.min(1, Number.isFinite(painted) && painted >= 0 ? painted : base));
    };
    color.setRGB(channel(0), channel(1), channel(2));
    const opacity = state.alive[i] ? Math.max(0, Math.min(1, Number(state.opacity?.[i] ?? 1))) : 0;
    return { center, scales, rotation, opacity, color };
  };

  // New layers are appended to editor arrays. Add them to Spark once, then
  // subsequent updates use the same index mapping.
  for (let i = existing; i < count; i++) {
    const splat = getSplat(i);
    if (typeof mesh.pushSplat === 'function') {
      mesh.pushSplat(splat.center, splat.scales, splat.rotation, splat.opacity, splat.color);
    } else {
      packed.setSplat(i, splat.center, splat.scales, splat.rotation, splat.opacity, splat.color);
    }
  }

  const targets = indices == null
    ? Array.from({ length: existing }, (_, i) => i)
    : indices;
  let updated = 0;
  for (const rawIndex of targets) {
    const i = Number(rawIndex);
    if (!Number.isInteger(i) || i < 0 || i >= count) continue;
    if (i >= existing) continue; // appended above
    const splat = getSplat(i);
    packed.setSplat(i, splat.center, splat.scales, splat.rotation, splat.opacity, splat.color);
    updated++;
  }
  packed.needsUpdate = true;
  return { ok: true, updated, appended: count - existing };
}
