export function getSceneType(record = null) {
  const mode = String(record?.metadata?.scene_mode || record?.category || record?.type || '').toLowerCase();
  if (mode.includes('car') || mode.includes('vehicle')) return 'car';
  if (mode.includes('real')) return 'real_estate';
  if (mode.includes('person') || mode.includes('event') || mode.includes('portrait')) return 'person';
  return 'product';
}

export async function runQuickClean({ record = null, aggressive = false } = {}) {
  const preset = getSceneType(record);
  try {
    if (typeof window._fumocaApplyAutoCleanPreset === 'function') {
      await window._fumocaApplyAutoCleanPreset(preset);
    }
  } catch (_) {}
  try {
    const queueKind = aggressive ? 'event_fast_clean' : 'mesh_cleanup';
    if (typeof window._fumocaQueuePipeline === 'function') {
      await window._fumocaQueuePipeline(queueKind, { preset, source: 'event_mode' });
    }
  } catch (_) {}
  window.dispatchEvent(new CustomEvent('fumoca:aiCleanupApplied', { detail: { preset, aggressive } }));
  return { preset, aggressive };
}

window.FumocaAICleanup = { getSceneType, runQuickClean };
