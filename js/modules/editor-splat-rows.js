/**
 * Encode the live Studio state into the renderer's canonical 32-byte SPLAT
 * rows. Used only as an intermediate for NIF encoding; source files are not
 * rewritten. The caller supplies the exact alive-point order used by sidecars.
 */
export function encodeEditorSplatRows(S, aliveIndices) {
  if (!S?.positions || !S?.alive || !Array.isArray(aliveIndices) || !aliveIndices.length) {
    throw new Error('[editor-splat-rows] no live points to encode');
  }
  const rows = new Uint8Array(aliveIndices.length * 32);
  const view = new DataView(rows.buffer);
  const clamp01 = value => Math.max(0, Math.min(1, value));
  for (let row = 0; row < aliveIndices.length; row++) {
    const i = aliveIndices[row], o = row * 32;
    if (!Number.isInteger(i) || i < 0 || i >= S.alive.length || !S.alive[i]) {
      throw new Error(`[editor-splat-rows] invalid or dead source index ${i}`);
    }
    const xyz = [S.positions[i * 3], S.positions[i * 3 + 1], S.positions[i * 3 + 2]];
    if (xyz.some(value => !Number.isFinite(value))) {
      throw new Error(`[editor-splat-rows] point ${i} has non-finite position data`);
    }
    for (let c = 0; c < 3; c++) view.setFloat32(o + c * 4, xyz[c], true);
    for (let c = 0; c < 3; c++) {
      const scale = S.scaleXYZ?.[i * 3 + c] ?? S.scale?.[i] ?? 0.01;
      if (!Number.isFinite(scale) || scale <= 0) {
        throw new Error(`[editor-splat-rows] point ${i} has invalid scale data`);
      }
      view.setFloat32(o + 12 + c * 4, Math.max(1e-6, scale), true);
    }
    for (let c = 0; c < 3; c++) {
      const painted = S.paintColors?.[i * 3 + c];
      const value = painted != null && painted >= 0 ? painted : (S.colors?.[i * 3 + c] ?? 0.7);
      if (!Number.isFinite(value)) throw new Error(`[editor-splat-rows] point ${i} has invalid colour data`);
      rows[o + 24 + c] = Math.round(clamp01(value) * 255);
    }
    const opacity = S.opacity?.[i] ?? 1;
    if (!Number.isFinite(opacity)) throw new Error(`[editor-splat-rows] point ${i} has invalid opacity data`);
    rows[o + 27] = Math.round(clamp01(opacity) * 255);
    const q = S.rotation
      ? Array.from(S.rotation.subarray(i * 4, i * 4 + 4))
      : [1, 0, 0, 0];
    const qLength = Math.hypot(...q);
    if (q.length !== 4 || !Number.isFinite(qLength) || qLength < 1e-8) {
      throw new Error(`[editor-splat-rows] point ${i} has invalid rotation data`);
    }
    for (let c = 0; c < 4; c++) {
      const normalized = q[c] / qLength;
      rows[o + 28 + c] = Math.max(0, Math.min(255, Math.round(normalized * 128 + 128)));
    }
  }
  return rows;
}
