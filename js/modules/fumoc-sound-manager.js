/**
 * FUMOCA Sound Manager v87
 * ════════════════════════════════════════════════════════════════════════════
 * Extends the existing SoundEngine (v57) with:
 *
 *   1. PORTAL SOUNDS — ambient track crossfades when camera crosses a door.
 *      Exterior: open air / wind / showroom ambience.
 *      Interior: cabin hush / AC hum / leather creak.
 *      The crossfade duration matches the portal blend zone transition.
 *
 *   2. AD PAUSE POINT SOUNDS — audio triggers at each interactive pause point
 *      in the ad format. Engine idle when the viewer enters car exploration.
 *      Product reveal sound on first interaction. Scene-specific.
 *
 *   3. SCENE-MATCHED AMBIENT PRESETS — when a splat is loaded, the sound
 *      manager reads its metadata.mode and auto-selects an ambient preset:
 *        vehicle      → showroom hum / light engine idle
 *        real_estate  → gentle interior ambience
 *        event        → crowd murmur / venue atmosphere
 *        product      → neutral studio silence
 *        scene        → matches source_type (outdoor, indoor, street)
 *
 *   4. HOTSPOT-TRIGGERED SOUNDS — tap a hotspot → play its attached audio.
 *      Integrated with the existing hotspot-pro.js click handler.
 *      Engine badge tap → engine roar. Interior tap → door close sound.
 *
 *   5. 4D SEQUENCE SOUNDS — each splat frame in a 4D sequence can have its
 *      own ambient track. Crossfades as the viewer moves through time.
 *
 * Uses the existing SoundEngine class for all actual audio — this module
 * is a coordinator that wires events to the engine.
 *
 * New SOND section in .fumoc:
 *   Stores per-scene sound configuration:
 *   { ambient, portals: [{id, interior, exterior}], hotspots: [{id, url}], frames: [...] }
 * ════════════════════════════════════════════════════════════════════════════
 */

import { SoundEngine } from './sound-engine.js';

// ── Ambient presets (free-to-use sound URLs, replace with your CDN paths) ─────

const AMBIENT_PRESETS = {
  vehicle_exterior: {
    url:    '/sounds/ambient/showroom-exterior.mp3',
    volume: 0.18,
    label:  'Showroom exterior',
  },
  vehicle_interior: {
    url:    '/sounds/ambient/vehicle-interior-idle.mp3',
    volume: 0.22,
    label:  'Vehicle interior',
  },
  real_estate_interior: {
    url:    '/sounds/ambient/interior-ambience.mp3',
    volume: 0.15,
    label:  'Interior ambience',
  },
  real_estate_exterior: {
    url:    '/sounds/ambient/outdoor-residential.mp3',
    volume: 0.20,
    label:  'Outdoor residential',
  },
  event_outdoor: {
    url:    '/sounds/ambient/crowd-outdoor.mp3',
    volume: 0.25,
    label:  'Outdoor crowd',
  },
  product: {
    url:    '/sounds/ambient/studio-silence.mp3',
    volume: 0.08,
    label:  'Studio silence',
  },
  movie_frame: {
    url:    '/sounds/ambient/cinematic-drone.mp3',
    volume: 0.20,
    label:  'Cinematic',
  },
  historical: {
    url:    '/sounds/ambient/subtle-texture.mp3',
    volume: 0.12,
    label:  'Subtle texture',
  },
};

// ── Sound events ──────────────────────────────────────────────────────────────

const SOUND_EVENTS = {
  portal_enter:   '/sounds/ui/portal-enter.mp3',    // soft whoosh inward
  portal_exit:    '/sounds/ui/portal-exit.mp3',     // soft whoosh outward
  hotspot_tap:    '/sounds/ui/hotspot-tap.mp3',     // gentle ping
  ad_interact:    '/sounds/ui/ad-activate.mp3',     // subtle shimmer
  limit_reached:  '/sounds/ui/limit-soft.mp3',      // very soft bump
  tour_next:      '/sounds/ui/tour-advance.mp3',    // soft chime
};

// ── Manager ───────────────────────────────────────────────────────────────────

class FumocSoundManager {
  constructor() {
    this._engine      = new SoundEngine();
    this._config      = null;   // SOND section data
    this._currentSide = 'exterior';
    this._current4DFrame = 0;
    this._started     = false;
    this._uiEngine    = new SoundEngine(); // separate engine for UI sounds (no 3D)
  }

  // ── Bootstrap ──────────────────────────────────────────────────────────────

  /** Call once on first user gesture — browser requires this for audio */
  async start() {
    if (this._started) return;
    await this._engine.startOnUserGesture();
    await this._uiEngine.startOnUserGesture();
    this._started = true;
  }

  // ── Load from .fumoc SOND section ─────────────────────────────────────────

  /**
   * Load sound configuration from a decoded .fumoc file.
   * @param {object} decoded — from FumocDecoder.decode()
   */
  async loadFromFumoc(decoded) {
    const sond = decoded.soundConfig || decoded.sond || null;
    const meta = decoded.meta || decoded.sceneMeta || {};
    const mode = decoded.header?.mode || meta.mode || 'product';

    this._config = sond;

    // Start ambient from explicit config OR from mode preset
    if (sond?.ambient?.url) {
      await this._engine.setAmbient(sond.ambient.url, {
        volume: sond.ambient.volume || 0.2,
        loop:   sond.ambient.loop !== false,
      });
    } else {
      await this._autoAmbient(mode, meta);
    }

    // Wire hotspot sounds if configured
    if (sond?.hotspots?.length) {
      for (const hs of sond.hotspots) {
        if (hs.url && hs.position) {
          this._engine.addSpatialSource(hs.id, hs.url, hs.position, {
            volume:      hs.volume      || 0.7,
            maxDistance: hs.maxDistance || 12,
            loop:        hs.loop        || false,
          });
        }
      }
    }
  }

  async _autoAmbient(mode, meta) {
    const presetKey = this._resolvePresetKey(mode, meta);
    const preset    = AMBIENT_PRESETS[presetKey];
    if (!preset) return;

    // Don't fail if the sound file doesn't exist yet — just skip silently
    try {
      await this._engine.setAmbient(preset.url, {
        volume: preset.volume,
        loop:   true,
      });
    } catch {}
  }

  _resolvePresetKey(mode, meta) {
    if (mode === 'vehicle' || mode === 'car')  return 'vehicle_exterior';
    if (mode === 'real_estate' || mode === 'property') return 'real_estate_interior';
    if (mode === 'event')                      return 'event_outdoor';
    if (mode === 'product')                    return 'product';
    if (mode === 'scene') {
      const src = meta.source_type || '';
      if (src === 'movie_frame') return 'movie_frame';
      if (src === 'historical')  return 'historical';
      return 'product';
    }
    return 'product';
  }

  // ── Portal crossover ───────────────────────────────────────────────────────

  /**
   * Called by portal renderer when camera crosses a portal plane.
   * @param {string} side — 'interior' | 'exterior'
   * @param {object} portal — portal definition
   */
  async onPortalCross(side, portal) {
    if (side === this._currentSide) return;
    this._currentSide = side;

    await this.start();

    // Play UI crossover sound
    this._playUISound(side === 'interior' ? SOUND_EVENTS.portal_enter : SOUND_EVENTS.portal_exit);

    // Crossfade ambient to match side
    const config = this._config?.portals?.find(p => p.id === portal.id);
    if (config) {
      const track = side === 'interior' ? config.interior : config.exterior;
      if (track?.url) {
        await this._engine.setAmbient(track.url, {
          volume:  track.volume || 0.2,
          loop:    true,
          fadeIn:  600,
        });
        return;
      }
    }

    // Fall back to preset based on side
    const mode = window._fumocaCurrentRecord?.metadata?.mode || 'vehicle';
    const presetKey = side === 'interior'
      ? (mode === 'vehicle' ? 'vehicle_interior' : 'real_estate_interior')
      : (mode === 'vehicle' ? 'vehicle_exterior' : 'real_estate_exterior');

    const preset = AMBIENT_PRESETS[presetKey];
    if (preset) {
      try {
        await this._engine.setAmbient(preset.url, {
          volume: preset.volume, loop: true, fadeIn: 600,
        });
      } catch {}
    }
  }

  // ── Ad pause point audio ───────────────────────────────────────────────────

  /**
   * Called by FumocAdPlayer when an interactive pause point activates.
   * @param {object} pausePoint
   */
  async onAdInteract(pausePoint) {
    await this.start();
    this._playUISound(SOUND_EVENTS.ad_interact);

    // Play pause-point-specific audio if configured
    if (pausePoint.audioUrl) {
      try {
        await this._engine.setAmbient(pausePoint.audioUrl, {
          volume: pausePoint.audioVolume || 0.3,
          loop:   pausePoint.audioLoop   || false,
          fadeIn: 400,
        });
      } catch {}
    }
  }

  /**
   * Called when the viewer resumes from interactive mode back to video.
   */
  async onAdResume() {
    // Fade audio back to scene ambient
    const record = window._fumocaCurrentRecord;
    if (record) await this.loadFromFumoc({ meta: record.metadata || {}, header: record.metadata || {} });
  }

  // ── Hotspot trigger ────────────────────────────────────────────────────────

  /**
   * Called when a hotspot is tapped.
   * @param {object} hotspot — hotspot data with optional audioUrl
   */
  async onHotspotTap(hotspot) {
    await this.start();

    // UI tap sound first
    this._playUISound(SOUND_EVENTS.hotspot_tap);

    // Hotspot-specific audio
    if (hotspot.audioUrl) {
      if (hotspot.audioSpatial && hotspot.worldPos) {
        this._engine.playSpatialSource(hotspot.id, hotspot.worldPos);
      } else {
        // Play as a non-spatial sound
        try {
          const audio = new Audio(hotspot.audioUrl);
          audio.volume = hotspot.audioVolume || 0.7;
          audio.play().catch(() => {});
        } catch {}
      }
    }
  }

  // ── Tour advance ───────────────────────────────────────────────────────────

  async onTourAdvance(stop) {
    await this.start();
    this._playUISound(SOUND_EVENTS.tour_next);

    if (stop.audioUrl) {
      try {
        await this._engine.setAmbient(stop.audioUrl, {
          volume: stop.audioVolume || 0.25,
          loop:   stop.audioLoop   || false,
          fadeIn: 800,
        });
      } catch {}
    }
  }

  // ── 4D frame change ────────────────────────────────────────────────────────

  async on4DFrameChange(frameIndex) {
    if (frameIndex === this._current4DFrame) return;
    this._current4DFrame = frameIndex;
    await this.start();

    const frames = this._config?.frames;
    if (!frames?.[frameIndex]?.audioUrl) return;
    const frame = frames[frameIndex];
    try {
      await this._engine.setAmbient(frame.audioUrl, {
        volume: frame.volume || 0.2, loop: true, fadeIn: 400,
      });
    } catch {}
  }

  // ── Scene limit reached ────────────────────────────────────────────────────

  async onLimitReached() {
    await this.start();
    this._playUISound(SOUND_EVENTS.limit_reached);
  }

  // ── Camera position update (3D spatial sound) ──────────────────────────────

  updateListenerPosition(cameraPosition, cameraQuaternion) {
    this._engine.updateListenerPosition(cameraPosition, cameraQuaternion);
  }

  // ── UI sound ──────────────────────────────────────────────────────────────

  _playUISound(url) {
    if (!url) return;
    try {
      const audio = new Audio(url);
      audio.volume = 0.35;
      audio.play().catch(() => {});
    } catch {}
  }

  // ── Controls ──────────────────────────────────────────────────────────────

  setMasterVolume(v) { this._engine.setMasterVolume(v); }
  toggleMute()       { return this._engine.toggleMute(); }
  dispose()          { this._engine.dispose(); this._uiEngine.dispose(); }
}

// ── Singleton + global wiring ─────────────────────────────────────────────────

const _manager = new FumocSoundManager();

// Wire to portal renderer events
window.addEventListener('fumoca:portal', async e => {
  await _manager.onPortalCross(e.detail.side, e.detail.portal);
});

// Wire to hotspot tap events
window.addEventListener('fumoca:hotspotTap', async e => {
  await _manager.onHotspotTap(e.detail.hotspot);
});

// Wire to tour advance events
window.addEventListener('fumoca:tourStop', async e => {
  await _manager.onTourAdvance(e.detail.stop);
});

// Wire to ad player events
window.addEventListener('fumoca:adInteract', async e => {
  await _manager.onAdInteract(e.detail.pausePoint);
});
window.addEventListener('fumoca:adResume', async () => {
  await _manager.onAdResume();
});

// Wire to scene limits event
window.addEventListener('fumoca:limitReached', async () => {
  await _manager.onLimitReached();
});

// Wire to 4D frame change
window.addEventListener('fumoca:4dFrame', async e => {
  await _manager.on4DFrameChange(e.detail.index);
});

// Wire to fumoc:load — load sound config when a file opens
window.addEventListener('fumoc:load', async e => {
  await _manager.loadFromFumoc(e.detail.decoded || {});
});

// Start audio on first user gesture anywhere on the page
const _startOnce = async () => {
  await _manager.start();
  document.removeEventListener('click',     _startOnce);
  document.removeEventListener('touchstart',_startOnce);
  document.removeEventListener('keydown',   _startOnce);
};
document.addEventListener('click',      _startOnce, { passive: true, once: true });
document.addEventListener('touchstart', _startOnce, { passive: true, once: true });
document.addEventListener('keydown',    _startOnce, { once: true });

// ── Sound config builder (for editor use) ─────────────────────────────────────

/**
 * Build the SOND section config from editor state.
 * Pass to fumoc-encoder as options.soundConfig
 */
function buildSoundConfig({
  ambient       = null,
  portalSounds  = [],
  hotspotSounds = [],
  frameSounds   = [],
} = {}) {
  return {
    ambient:  ambient,
    portals:  portalSounds,
    hotspots: hotspotSounds,
    frames:   frameSounds,
  };
}

// ── Volume control UI (floating widget) ───────────────────────────────────────

function buildVolumeWidget() {
  let widget = document.getElementById('fumocVolumeWidget');
  if (widget) return widget;

  widget = document.createElement('div');
  widget.id = 'fumocVolumeWidget';
  widget.style.cssText = `
    position:fixed;bottom:88px;right:16px;z-index:202;
    background:rgba(5,7,11,.88);border:1px solid rgba(255,255,255,.12);
    backdrop-filter:blur(12px);border-radius:14px;padding:10px 12px;
    display:flex;align-items:center;gap:10px;
    font-family:'DM Sans',system-ui;
  `;
  widget.innerHTML = `
    <button id="fumocMuteBtn" style="background:none;border:none;color:#fff;
      font-size:18px;cursor:pointer;padding:0;width:22px;">🔊</button>
    <input type="range" id="fumocVolumeSlider" min="0" max="1" step="0.05" value="0.8"
      style="width:80px;accent-color:#c8ff00;">
  `;
  document.body.appendChild(widget);

  widget.querySelector('#fumocMuteBtn').addEventListener('click', () => {
    const muted = _manager.toggleMute();
    widget.querySelector('#fumocMuteBtn').textContent = muted ? '🔇' : '🔊';
  });

  widget.querySelector('#fumocVolumeSlider').addEventListener('input', e => {
    _manager.setMasterVolume(parseFloat(e.target.value));
  });

  return widget;
}

// ── Export ────────────────────────────────────────────────────────────────────

const FumocSoundManager_exports = {
  manager:          _manager,
  buildSoundConfig,
  buildVolumeWidget,
  AMBIENT_PRESETS,
  SOUND_EVENTS,
};

window.FumocSoundManager  = _manager;
window.FumocSoundConfig   = buildSoundConfig;
window.FumocVolumeWidget  = buildVolumeWidget;

export { _manager as manager, buildSoundConfig, buildVolumeWidget, AMBIENT_PRESETS };
export default _manager;
