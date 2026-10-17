/**
 * Reindex point-addressed NIF LAYER_GEO membership against the exact alive-only
 * geometry order used by the encoder. Legacy layers without global indices
 * cannot be safely compacted and are reported to the caller for a quality flag.
 */
export function compactNifLayers(sourceLayers, aliveIndices, sourcePointCount) {
  if (!Array.isArray(aliveIndices) || !Number.isInteger(sourcePointCount) || sourcePointCount < 0) {
    throw new Error('[nif-layer-geo] invalid source point mapping');
  }
  const compactIndex = new Map();
  for (let compact = 0; compact < aliveIndices.length; compact++) {
    const source = aliveIndices[compact];
    if (!Number.isInteger(source) || source < 0 || source >= sourcePointCount || compactIndex.has(source)) {
      throw new Error('[nif-layer-geo] alive indices must be unique valid source indices');
    }
    compactIndex.set(source, compact);
  }
  const layers = [];
  let droppedUnindexed = 0;
  for (const layer of Array.isArray(sourceLayers) ? sourceLayers : []) {
    if (!layer || !Array.isArray(layer.indices) && !ArrayBuffer.isView(layer.indices)) {
      droppedUnindexed++;
      continue;
    }
    const label = String(layer.label || layer.name || '').trim();
    if (!label) throw new Error('[nif-layer-geo] layer label is required');
    const indices = [];
    const seen = new Set();
    for (const source of layer.indices) {
      if (!Number.isInteger(source) || source < 0 || source >= sourcePointCount) {
        throw new Error(`[nif-layer-geo] layer "${label}" contains an invalid source index`);
      }
      if (seen.has(source)) continue;
      seen.add(source);
      if (compactIndex.has(source)) indices.push(compactIndex.get(source));
    }
    if (indices.length) {
      layers.push({
        label,
        depthMin: Number.isFinite(layer.depthMin) ? layer.depthMin : 0,
        depthMax: Number.isFinite(layer.depthMax) ? layer.depthMax : 0,
        indices,
      });
    }
  }
  return { layers, droppedUnindexed };
}
