/**
 * Conservative Gaussian-to-component ownership assignment.
 *
 * This assigns Gaussian IDs only when one component's bounds are clearly the
 * closest unambiguous region. Overlapping component bounds are deliberately
 * left unassigned; this is not semantic segmentation.
 */
export function assignGaussianMemberships(components, {
  positions, gaussianIds, alive = null, selected = null, selectedOnly = false, margin = null,
} = {}) {
  if (!Array.isArray(components)) throw new TypeError('components must be an array');
  if (!positions || positions.length % 3) throw new TypeError('positions must be a flat xyz array');
  if (!gaussianIds || gaussianIds.length !== positions.length / 3) {
    throw new Error('Gaussian identity count must match the position array');
  }
  if (components.some(component => component.gaussianIds?.length)) {
    return { components, assignedCount: components.reduce((sum, component) => sum + (component.gaussianIds?.length || 0), 0), ambiguousCount: 0, unassignedCount: 0, preserved: true };
  }
  if (alive && alive.length !== gaussianIds.length) throw new Error('alive mask length does not match Gaussian identities');
  if (selectedOnly && (!selected || selected.length !== gaussianIds.length)) throw new Error('selected-only membership requires a matching selection mask');

  const bounds = components.map(component => {
    const vertices = component.vertices;
    if (!vertices || vertices.length < 9) throw new Error('component has no usable vertices');
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < vertices.length; i += 3) {
      for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis], vertices[i + axis]);
        max[axis] = Math.max(max[axis], vertices[i + axis]);
      }
    }
    return { min, max };
  });
  if (!bounds.length) return { components, assignedCount: 0, ambiguousCount: 0, unassignedCount: gaussianIds.length };
  const sceneMin = [0, 1, 2].map(axis => Math.min(...bounds.map(box => box.min[axis])));
  const sceneMax = [0, 1, 2].map(axis => Math.max(...bounds.map(box => box.max[axis])));
  const diagonal = Math.hypot(sceneMax[0] - sceneMin[0], sceneMax[1] - sceneMin[1], sceneMax[2] - sceneMin[2]);
  const marginDistance = Number.isFinite(Number(margin)) && Number(margin) > 0
    ? Number(margin) : Math.max(diagonal * 0.005, 1e-4);
  const marginSquared = marginDistance * marginDistance;
  const ambiguityTolerance = Math.max(1e-12, marginSquared * 0.01);
  const membership = components.map(() => []);
  let assignedCount = 0, ambiguousCount = 0, eligibleCount = 0;

  for (let row = 0; row < gaussianIds.length; row++) {
    if (alive && !alive[row]) continue;
    if (selectedOnly && !selected[row]) continue;
    const x = Number(positions[row * 3]), y = Number(positions[row * 3 + 1]), z = Number(positions[row * 3 + 2]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    eligibleCount++;
    let bestIndex = -1, bestDistance = Infinity, secondDistance = Infinity, insideCount = 0;
    for (let componentIndex = 0; componentIndex < bounds.length; componentIndex++) {
      const box = bounds[componentIndex];
      const dx = x < box.min[0] ? box.min[0] - x : x > box.max[0] ? x - box.max[0] : 0;
      const dy = y < box.min[1] ? box.min[1] - y : y > box.max[1] ? y - box.max[1] : 0;
      const dz = z < box.min[2] ? box.min[2] - z : z > box.max[2] ? z - box.max[2] : 0;
      const distance = dx * dx + dy * dy + dz * dz;
      if (distance <= 1e-12) insideCount++;
      if (distance < bestDistance) {
        secondDistance = bestDistance;
        bestDistance = distance;
        bestIndex = componentIndex;
      } else if (distance < secondDistance) {
        secondDistance = distance;
      }
    }
    if (insideCount > 1 || (secondDistance - bestDistance) <= ambiguityTolerance) {
      ambiguousCount++;
      continue;
    }
    if (bestIndex >= 0 && bestDistance <= marginSquared) {
      membership[bestIndex].push(gaussianIds[row]);
      assignedCount++;
    }
  }

  const normalized = components.map((component, index) => ({
    ...component,
    gaussianIds: Uint32Array.from(membership[index]),
    diagnostics: {
      ...(component.diagnostics || {}),
      gaussian_membership_count: membership[index].length,
      gaussian_membership_method: 'conservative-unambiguous-aabb',
    },
    provenance: {
      ...(component.provenance || {}),
      gaussianMembership: 'conservative-unambiguous-aabb',
    },
  }));
  return {
    components: normalized,
    assignedCount,
    ambiguousCount,
    unassignedCount: Math.max(0, eligibleCount - assignedCount),
    preserved: false,
  };
}
