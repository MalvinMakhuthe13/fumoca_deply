/**
 * Keep native Gaussian animation IDs aligned with the compacted KEYFRAME_GEO
 * records when Studio deletes splats before publishing.
 *
 * gaussianIds are stable identities, not renderer-sort indices. aliveIndices
 * therefore selects the corresponding IDs in their existing order; tracks
 * for deleted IDs are removed, and any newly appended splats receive fresh
 * IDs without changing the identities of existing animated splats.
 */
export function remapGaussianAnimation(animation, aliveIndices, currentCount) {
  if (!animation || !Array.isArray(animation.gaussianIds) || !Array.isArray(animation.tracks)) {
    throw new Error('Invalid Gaussian animation data');
  }
  if (!Number.isInteger(currentCount) || currentCount < 1) {
    throw new Error('Current Gaussian count must be a positive integer');
  }
  if (!Array.isArray(aliveIndices) || !aliveIndices.length) {
    throw new Error('At least one live Gaussian is required to preserve animation');
  }
  let previous = -1;
  for (const index of aliveIndices) {
    if (!Number.isInteger(index) || index < 0 || index >= currentCount || index <= previous) {
      throw new Error('Live Gaussian indices must be unique, ascending and within the current geometry');
    }
    previous = index;
  }
  if (animation.gaussianIds.length > currentCount) {
    throw new Error('Animation IDs do not match the current geometry; refusing an unsafe remap');
  }
  const ids = animation.gaussianIds.slice();
  const used = new Set(ids);
  if (used.size !== ids.length || ids.some(id => !Number.isInteger(id) || id < 0 || id > 0xFFFFFFFF)) {
    throw new Error('Animation contains invalid or duplicate stable Gaussian IDs');
  }
  let nextId = ids.length ? Math.max(...ids) + 1 : 0;
  while (ids.length < currentCount) {
    while (used.has(nextId) && nextId <= 0xFFFFFFFF) nextId++;
    if (nextId > 0xFFFFFFFF) throw new Error('No stable Gaussian IDs remain for newly added splats');
    ids.push(nextId);
    used.add(nextId);
    nextId++;
  }
  const gaussianIds = aliveIndices.map(index => ids[index]);
  const kept = new Set(gaussianIds);
  const tracks = animation.tracks.filter(track => kept.has(track.id));
  return { ...animation, gaussianIds, tracks };
}

export default remapGaussianAnimation;
