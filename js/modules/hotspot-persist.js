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
    const pill = document.createElement('div');
    pill.className = 'hotspot-pill';
    pill.textContent = title;
    m.appendChild(pill);
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
  // Canonical NIF records store editable scene data in `meta`; `metadata`
  // remains readable for legacy records while they are migrated.
  const meta = (rec.meta && typeof rec.meta === 'object' ? rec.meta : rec.metadata) || {};
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

  // Hotspots Pro is the interactive renderer on viewer.html. Keep this
  // module responsible for loading walkthrough/audio/state metadata there,
  // but do not render a second set of DOM markers over the same hotspots.
  if (hotspots.length && !window._fumocaUseHotspotPro) {
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

export async function saveInteractionsToSupabase(supabase, nifId, metadataPatch) {
  if (!supabase || !nifId) throw new Error('supabase + nifId required');
  if (!metadataPatch || typeof metadataPatch !== 'object' || Array.isArray(metadataPatch)) {
    throw new Error('metadataPatch must be an object');
  }

  // `nif_files.meta` is the canonical NIF metadata contract. Do not silently
  // write to the legacy `splats.metadata` table: that can make a save appear
  // successful while the canonical viewer never sees it.
  const { data: row, error: readError } = await supabase
    .from('nif_files')
    .select('meta')
    .eq('id', nifId)
    .maybeSingle();
  if (readError) throw new Error(`Could not read NIF metadata: ${readError.message}`);
  if (!row) throw new Error(`NIF ${nifId} was not found in nif_files; interaction save was not written.`);

  const previous = row.meta && typeof row.meta === 'object' && !Array.isArray(row.meta) ? row.meta : {};
  const meta = { ...previous, ...metadataPatch };
  const { error: writeError } = await supabase.from('nif_files').update({ meta }).eq('id', nifId);
  if (writeError) throw new Error(`Could not save NIF interactions: ${writeError.message}`);
  return meta;
}

if (typeof window !== 'undefined') {
  window.FUMOCA_HotspotPersist = {
    renderHotspotsToLayer,
    loadInteractionsFromRecord,
    buildInteractionMetadata,
    saveInteractionsToSupabase,
  };
}
