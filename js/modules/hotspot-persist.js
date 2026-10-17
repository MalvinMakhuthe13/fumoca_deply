/**
 * Load / save hotspots, walkthrough, sceneAudio, stateSounds on splat metadata.
 *
 * Rendering ownership:
 *   When Hotspot Pro is active (window._fumocaUseHotspotPro === true), Pro owns
 *   the visual markers via its own render loop. This module still loads data
 *   into window._fumocaHotspots and hands it to Pro — it does NOT paint
 *   competing markers that silently swallow clicks.
 *
 *   Only when Pro is not present do we fall back to the lightweight
 *   data-driven markers below.
 */
import { vehicleDemoHotspots } from './scene-interactions.js';

/**
 * Activate a hotspot with the best available path:
 *   1. Hotspot Pro (fly-to + info card) when present
 *   2. Rich action via scene-interactions
 *   3. Simple visual feedback so the user always sees something happen
 */
async function activatePersistedHotspot(hs, markerEl) {
  // Prefer the full Hotspot Pro experience when available
  if (typeof window._fumocaActivateHotspot === 'function') {
    window._fumocaActivateHotspot(hs);
    return;
  }

  const action =
    hs.actions?.[0]?.action ||
    hs.action ||
    (hs.type ? { type: hs.type, ...hs } : null);

  if (action) {
    try {
      const { triggerAction } = await import('./scene-interactions.js');
      await triggerAction(action, { hotspot: hs });
    } catch (err) {
      console.warn('[hotspot-persist] action failed', err);
    }
  }

  // Always give visible feedback so a click never feels dead
  if (markerEl) {
    markerEl.classList.add('active', 'pulse');
    setTimeout(() => markerEl.classList.remove('active'), 1200);
  }

  // Dispatch so analytics / other modules can react
  window.dispatchEvent(
    new CustomEvent('fumoca:hotspotOpened', {
      detail: { id: hs.id || null, type: hs.type || action?.type || 'info', source: 'persist' },
    })
  );

  // Open a simple link if one exists and nothing richer handled it
  const link = hs.ctaLink || hs.link || action?.link || action?.ctaLink;
  if (link && !action) {
    window.open(link, '_blank', 'noopener');
  }
}

export function renderHotspotsToLayer(hotspots, layer = document.getElementById('hotspotLayer')) {
  if (!layer || !Array.isArray(hotspots)) return;

  // When Hotspot Pro owns the layer, do not paint competing markers.
  // Just keep the shared data in sync so Pro's load/render can pick it up.
  if (window._fumocaUseHotspotPro) {
    window._fumocaHotspots = hotspots.slice();
    // Ask Pro to re-load if it already initialized
    if (typeof window._fumocaReloadHotspots === 'function') {
      window._fumocaReloadHotspots(hotspots);
    }
    return;
  }

  // Legacy path: clear previous data-driven markers only
  layer.querySelectorAll('.hotspot-marker[data-persisted="1"]').forEach((n) => n.remove());

  hotspots.forEach((hs) => {
    const m = document.createElement('button');
    m.type = 'button';
    m.className = 'hotspot-marker pulse';
    m.dataset.persisted = '1';
    m.dataset.id = hs.id || '';
    m.dataset.type = hs.actions?.[0]?.action?.type || hs.type || 'info';
    m.style.left = (hs.x ?? 50) + '%';
    m.style.top = (hs.y ?? 50) + '%';
    m.style.pointerEvents = 'auto';
    const title = hs.title || hs.label || 'Hotspot';
    const pill = document.createElement('span');
    pill.className = 'hotspot-pill';
    pill.textContent = title;
    m.appendChild(pill);
    m.title = title;
    m.setAttribute('aria-label', title);
    m.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await activatePersistedHotspot(hs, m);
    });
    layer.appendChild(m);
  });
}

export async function loadInteractionsFromRecord(rec) {
  if (!rec) return null;
  // Canonical NIF records store editable scene data in `meta`; `metadata`
  // remains readable for legacy records while they are migrated.
  const meta =
    (rec.meta && typeof rec.meta === 'object' ? rec.meta : null) ||
    (rec.metadata && typeof rec.metadata === 'object' ? rec.metadata : null) ||
    {};
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
