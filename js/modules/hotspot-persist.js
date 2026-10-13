/**
 * Load / save hotspots, walkthrough, sceneAudio, stateSounds on splat metadata.
 */
import { vehicleDemoHotspots } from './scene-interactions.js';

export function renderHotspotsToLayer(hotspots, layer = document.getElementById('hotspotLayer')) {
  if (!layer || !Array.isArray(hotspots)) return;
  // clear previous data-driven markers (keep others)
  layer.querySelectorAll('.hotspot-marker[data-persisted="1"]').forEach((n) => n.remove());

  hotspots.forEach((hs) => {
    const m = document.createElement('div');
    m.className = 'hotspot-marker pulse';
    m.dataset.persisted = '1';
    m.dataset.id = hs.id || '';
    m.dataset.type = hs.actions?.[0]?.action?.type || hs.type || 'info';
    m.style.left = (hs.x ?? 50) + '%';
    m.style.top = (hs.y ?? 50) + '%';
    const title = hs.title || hs.label || 'Hotspot';
    m.innerHTML = `<div class="hotspot-pill">${title}</div>`;
    m.title = title;
    m.addEventListener('click', async (e) => {
      e.stopPropagation();
      const action =
        hs.actions?.[0]?.action ||
        hs.action ||
        (hs.type ? { type: hs.type, ...hs } : null);
      if (!action) return;
      const { triggerAction } = await import('./scene-interactions.js');
      await triggerAction(action, { hotspot: hs });
    });
    layer.appendChild(m);
  });
}

export async function loadInteractionsFromRecord(rec) {
  if (!rec) return null;
  const meta = rec.metadata || {};
  const hotspots = meta.hotspots || meta.interactions?.hotspots || [];
  const walkthrough = meta.walkthrough || null;
  const sceneAudio = meta.sceneAudio || meta.audio || null;
  const stateSounds = meta.stateSounds || {};
  const stateRegions = meta.stateRegions || {}; // { door_fl: { indices: [] } or bbox }

  window._fumocaStateSounds = { ...(window._fumocaStateSounds || {}), ...stateSounds };
  window._fumocaWalkthrough = walkthrough || window._fumocaWalkthrough;
  window._fumocaSceneAudio = sceneAudio || window._fumocaSceneAudio;
  window._fumocaStateRegions = stateRegions;
  window._fumocaHotspots = hotspots;

  if (hotspots.length) {
    renderHotspotsToLayer(hotspots);
  }

  if (walkthrough && window.FUMOCA_Walkthrough) {
    window.FUMOCA_Walkthrough.loadWalkthroughGraph({ walkthrough });
  }

  if (sceneAudio?.bed?.url && window.FUMOCA_SceneAudio) {
    window.FUMOCA_SceneAudio.mountSceneAudioUI?.(document.getElementById('stage') || document.body, sceneAudio);
  }

  return { hotspots, walkthrough, sceneAudio, stateSounds, stateRegions };
}

/**
 * Build metadata patch for publish from studio window globals + defaults.
 */
export function buildInteractionMetadata(extra = {}) {
  let hotspots = window._fumocaHotspots || [];
  if (!hotspots.length && extra.seedVehicle) {
    hotspots = vehicleDemoHotspots({
      doorSoundUrl: extra.doorSoundUrl,
      engineSoundUrl: extra.engineSoundUrl,
    });
  }
  return {
    hotspots,
    walkthrough: window._fumocaWalkthrough || extra.walkthrough || null,
    sceneAudio: window._fumocaSceneAudio || extra.sceneAudio || null,
    stateSounds: window._fumocaStateSounds || extra.stateSounds || {
      click: 'sounds/click.wav',
      door: 'sounds/door.wav',
      engineStart: 'sounds/engine-start.wav',
      engineLoop: 'sounds/engine-idle.wav',
    },
    stateRegions: window._fumocaStateRegions || extra.stateRegions || {},
  };
}

export async function saveInteractionsToSupabase(supabase, splatId, metadataPatch) {
  if (!supabase || !splatId) throw new Error('supabase + splatId required');
  const { data: row } = await supabase
    .from('splats')
    .select('metadata')
    .eq('id', splatId)
    .maybeSingle();
  const prev = row?.metadata || {};
  const metadata = { ...prev, ...metadataPatch };
  const { error } = await supabase.from('splats').update({ metadata }).eq('id', splatId);
  if (error) throw error;
  return metadata;
}

if (typeof window !== 'undefined') {
  window.FUMOCA_HotspotPersist = {
    renderHotspotsToLayer,
    loadInteractionsFromRecord,
    buildInteractionMetadata,
    saveInteractionsToSupabase,
  };
}
