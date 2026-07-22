/**
 * FUMOCA Hotspot Actions v1
 * ══════════════════════════════════════════════════════════════════════════
 * Multi-action hotspots: one hotspot pin with multiple buttons, each
 * running its own action. Turns the viewer into a product configurator.
 *
 * Example: a hotspot on a car with three buttons:
 *   [▶ Engine sound]    → plays audio loop, stop-on-leave
 *   [📷 View interior]  → opens nested splat of interior
 *   [📄 Spec sheet]     → opens info card with PDF link
 *
 * Schema — extends the existing hotspot record with an optional `actions`
 * array. Hotspots without `actions` keep behaving as single-action legacy
 * hotspots, so existing data keeps working without migration.
 *
 *   {
 *     id: 'hs_...',
 *     title: 'Driver side',
 *     x: 48, y: 62,                         // percentages on the stage
 *     actions: [                            // NEW — optional
 *       { id: 'a1', label: 'Engine sound', icon: '🔊',
 *         action: { type: 'audio', url: 'https://...engine.mp3', loop: true } },
 *       { id: 'a2', label: 'Interior', icon: '🛋️',
 *         action: { type: 'nested_splat', splatId: 'spl_interior_123' } },
 *       { id: 'a3', label: 'Quote', icon: '📩',
 *         action: { type: 'link', url: 'https://dealer.co.za/quote?car=XYZ' } }
 *     ]
 *   }
 *
 * Supported action types (all documented in the runAction switch below):
 *   - audio         play an audio file (loop:true for engine sounds, etc)
 *   - audio_stop    stop whatever is currently playing
 *   - video         open a video overlay (modal)
 *   - link          open an external URL
 *   - nested_splat  open a nested splat viewer (existing behaviour)
 *   - info          show an info card with markdown body
 *   - state         dispatch a state-change event (for configurator demos)
 *   - fly           fly the camera to a given view on the parent viewer
 *   - multi         run a sequence of actions
 * ══════════════════════════════════════════════════════════════════════════
 */

// Track the currently-playing audio so new triggers can cancel the old one.
// Scoped to module, not per-hotspot — a configurator should typically only
// have one audio source playing at a time (engine vs horn, etc).
let _currentAudio = null;

/**
 * Stop any audio started by runAction. Safe to call multiple times.
 */
export function stopAllAudio() {
  if (!_currentAudio) return;
  try {
    _currentAudio.pause();
    _currentAudio.currentTime = 0;
  } catch (_) {
    // Media elements can throw on pause() if the element is in an odd state
    // (e.g., removed from DOM mid-playback). Nothing useful to do here.
  }
  _currentAudio = null;
}

/**
 * Play an audio URL. `loop` makes it continue (engine sound); otherwise
 * it plays once and stops.
 *
 * Mobile browsers require a user gesture to start audio — this function
 * only ever runs from button clicks, so that constraint is satisfied
 * naturally. If play() is rejected anyway (e.g., iOS low-power mode),
 * we swallow it silently rather than crashing the hotspot.
 */
function playAudio(url, { loop = false, volume = 1.0 } = {}) {
  if (!url) return Promise.resolve();
  stopAllAudio();
  const audio = new Audio(url);
  audio.preload = 'auto';
  audio.loop = !!loop;
  audio.volume = Math.max(0, Math.min(1, volume));
  _currentAudio = audio;
  const p = audio.play();
  if (p?.catch) p.catch(() => { /* autoplay rejected — not fatal */ });
  return p || Promise.resolve();
}

/**
 * Open a video in a modal overlay. Creates the overlay lazily on first use.
 * The overlay is reused across calls.
 */
function getVideoOverlay() {
  let overlay = document.getElementById('fumocaVideoOverlay');
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.id = 'fumocaVideoOverlay';
  // Inline styles so this works even if the host page has no stylesheet
  // configured for us. Styling is deliberately minimal/dark/professional.
  Object.assign(overlay.style, {
    position: 'fixed', inset: '0',
    background: 'rgba(0,0,0,.88)',
    display: 'none',
    alignItems: 'center', justifyContent: 'center',
    zIndex: '99999',
    backdropFilter: 'blur(8px)',
  });
  overlay.innerHTML = `
    <video id="fumocaVideoOverlayPlayer" controls playsinline
      style="max-width:92vw; max-height:88vh; border-radius:14px; box-shadow:0 40px 80px rgba(0,0,0,.6); background:#000;"></video>
    <button id="fumocaVideoOverlayClose" aria-label="Close"
      style="position:absolute; top:20px; right:20px; width:44px; height:44px; border-radius:50%; border:0; background:rgba(255,255,255,.1); color:#fff; font-size:24px; cursor:pointer;">×</button>
  `;
  document.body.appendChild(overlay);
  const close = overlay.querySelector('#fumocaVideoOverlayClose');
  const player = overlay.querySelector('#fumocaVideoOverlayPlayer');
  const hide = () => {
    overlay.style.display = 'none';
    try { player.pause(); player.src = ''; } catch (_) {}
  };
  close.addEventListener('click', hide);
  overlay.addEventListener('click', e => { if (e.target === overlay) hide(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && overlay.style.display !== 'none') hide();
  });
  return overlay;
}

function showVideo(url) {
  if (!url) return;
  const overlay = getVideoOverlay();
  const player = overlay.querySelector('#fumocaVideoOverlayPlayer');
  player.src = url;
  overlay.style.display = 'flex';
  player.play?.().catch(() => {});
}

/**
 * Open an info card — a small dismissible modal with a title, optional
 * icon, and a markdown-ish body (we do NOT parse markdown; we render text
 * with basic newline handling, to keep the attack surface small).
 */
function getInfoCard() {
  let card = document.getElementById('fumocaInfoCard');
  if (card) return card;
  card = document.createElement('div');
  card.id = 'fumocaInfoCard';
  Object.assign(card.style, {
    position: 'fixed', inset: '0',
    background: 'rgba(0,0,0,.72)', backdropFilter: 'blur(6px)',
    display: 'none', alignItems: 'center', justifyContent: 'center',
    zIndex: '99998',
  });
  card.innerHTML = `
    <div id="fumocaInfoCardBody"
      style="background:#0e1118; color:#eaeaea; padding:28px 32px; max-width:540px; width:90vw; border-radius:18px; box-shadow:0 40px 80px rgba(0,0,0,.6); font-family:system-ui,-apple-system,sans-serif;">
      <div id="fumocaInfoCardTitle" style="font-weight:700; font-size:19px; margin-bottom:12px;"></div>
      <div id="fumocaInfoCardText" style="font-size:15px; line-height:1.55; white-space:pre-wrap; color:rgba(255,255,255,.82);"></div>
      <div id="fumocaInfoCardActions" style="margin-top:18px; display:flex; gap:10px; justify-content:flex-end;"></div>
    </div>
  `;
  document.body.appendChild(card);
  card.addEventListener('click', e => { if (e.target === card) card.style.display = 'none'; });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && card.style.display !== 'none') card.style.display = 'none';
  });
  return card;
}

function showInfo({ title, body, cta }) {
  const card = getInfoCard();
  card.querySelector('#fumocaInfoCardTitle').textContent = title || '';
  card.querySelector('#fumocaInfoCardText').textContent = body || '';
  const actions = card.querySelector('#fumocaInfoCardActions');
  actions.innerHTML = '';

  if (cta?.url && cta?.label) {
    const a = document.createElement('a');
    a.href = cta.url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = cta.label;
    Object.assign(a.style, {
      background: '#c8ff00', color: '#0b0e14', padding: '10px 18px',
      borderRadius: '10px', fontWeight: '700', textDecoration: 'none',
      fontSize: '14px',
    });
    actions.appendChild(a);
  }
  const close = document.createElement('button');
  close.textContent = 'Close';
  Object.assign(close.style, {
    background: 'rgba(255,255,255,.08)', color: '#fff', border: '0',
    padding: '10px 18px', borderRadius: '10px', cursor: 'pointer',
    fontSize: '14px',
  });
  close.addEventListener('click', () => card.style.display = 'none');
  actions.appendChild(close);
  card.style.display = 'flex';
}

/**
 * The central dispatch. Given an action object from a hotspot's
 * actions[].action, run it. The `context` object gives the runner access
 * to the host viewer — specifically `context.viewer` (for fly-to),
 * `context.hotspot` (the parent hotspot record), and `context.host`
 * (a DOM element where overlays should live).
 *
 * Unknown types log a warning and no-op — important because future
 * hotspots authored against newer schema might load in older viewers,
 * and we do not want a 404 in the action list to kill the whole viewer.
 */
export async function runAction(action, context = {}) {
  if (!action || typeof action !== 'object') return;

  switch (action.type) {
    case 'audio':
      return playAudio(action.url, {
        loop: !!action.loop,
        volume: action.volume,
      });

    case 'audio_stop':
      return stopAllAudio();

    case 'video':
      return showVideo(action.url);

    case 'link':
      if (action.url) {
        // rel=noopener prevents the opened page from reaching back into ours
        // via window.opener. Always include it for external links.
        window.open(action.url, action.target || '_blank', 'noopener,noreferrer');
      }
      return;

    case 'nested_splat':
      // Delegate to the existing hotspot-pro module if present. If not, do
      // it ourselves with an iframe — same behavior, no new overlay needed.
      if (window.FumocaHotspotPro?.openNestedSplat && action.splatId) {
        return window.FumocaHotspotPro.openNestedSplat({
          overlaySplatId: action.splatId,
          title: action.title,
        });
      }
      if (action.splatId) {
        const url = `viewer.html?splatId=${encodeURIComponent(action.splatId)}`;
        window.open(url, '_blank', 'noopener');
      }
      return;

    case 'info':
      return showInfo({
        title: action.title || context.hotspot?.title,
        body: action.body || '',
        cta: action.cta,
      });

    case 'state': {
      // Dispatch a CustomEvent that the host page / embed can listen for.
      // Configurators use this to change colours, toggle doors, etc.
      const detail = {
        key: action.key,
        value: action.value,
        hotspotId: context.hotspot?.id,
      };
      window.dispatchEvent(new CustomEvent('fumoca:hotspot:state', { detail }));
      return;
    }

    case 'fly':
      // Delegate to whichever fly-to system the host viewer provides.
      // hotspot-pro already has `flyToHotspot`. For a raw target we try
      // `viewer.flyTo(action.target)` if the viewer exposes it.
      if (action.hotspotId && window.FumocaHotspotPro?.jumpToHotspotById) {
        return window.FumocaHotspotPro.jumpToHotspotById(action.hotspotId);
      }
      if (context.viewer?.flyTo && action.target) {
        return context.viewer.flyTo(action.target);
      }
      return;

    case 'multi': {
      // Sequential execution — each action waits for the previous one's
      // Promise (if any) before running. Parallelism isn't useful here;
      // a configurator user expects audio to start THEN a card to appear,
      // not both at once.
      if (!Array.isArray(action.actions)) return;
      for (const sub of action.actions) {
        await runAction(sub, context);
        if (action.delay) await new Promise(r => setTimeout(r, action.delay));
      }
      return;
    }

    default:
      console.warn('[FumocaHotspotActions] Unknown action type:', action.type, action);
      return;
  }
}

/**
 * Render the action buttons for a hotspot into an existing container.
 * The container is typically the hotspot's info panel body.
 *
 * Returns the created root element for the caller to further decorate.
 */
export function renderActionButtons(hotspot, container, context = {}) {
  if (!hotspot || !Array.isArray(hotspot.actions) || !container) return null;
  const wrap = document.createElement('div');
  wrap.className = 'fumoca-hotspot-actions';
  Object.assign(wrap.style, {
    display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '14px',
  });

  for (const a of hotspot.actions) {
    if (!a || !a.action) continue;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'fumoca-action-btn';
    btn.dataset.actionId = a.id || '';
    btn.dataset.actionType = a.action.type || '';
    Object.assign(btn.style, {
      background: 'rgba(200,255,0,.12)',
      border: '1px solid rgba(200,255,0,.35)',
      color: '#c8ff00',
      padding: '10px 14px',
      borderRadius: '10px',
      cursor: 'pointer',
      fontSize: '13px',
      fontWeight: '700',
      fontFamily: 'inherit',
      display: 'flex', alignItems: 'center', gap: '6px',
      transition: 'background .18s ease, transform .08s ease',
    });
    btn.addEventListener('mouseenter', () => {
      btn.style.background = 'rgba(200,255,0,.22)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = 'rgba(200,255,0,.12)';
    });
    btn.addEventListener('pointerdown', () => {
      btn.style.transform = 'scale(.96)';
    });
    btn.addEventListener('pointerup', () => {
      btn.style.transform = '';
    });
    btn.innerHTML = `${a.icon ? `<span aria-hidden="true">${escapeHtml(a.icon)}</span>` : ''}<span>${escapeHtml(a.label || a.action.type)}</span>`;
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      // Visual feedback that the action fired — brief highlight
      const prev = btn.style.background;
      btn.style.background = 'rgba(200,255,0,.35)';
      setTimeout(() => { btn.style.background = prev; }, 180);
      try {
        await runAction(a.action, { ...context, hotspot });
      } catch (err) {
        console.warn('[FumocaHotspotActions] Action failed:', err);
      }
      // Fire a tracking event so the host page / analytics can count usage.
      window.dispatchEvent(new CustomEvent('fumoca:hotspot:action', {
        detail: { hotspotId: hotspot.id, actionId: a.id, type: a.action.type },
      }));
    });
    wrap.appendChild(btn);
  }

  container.appendChild(wrap);
  return wrap;
}

/**
 * Minimal HTML escape. We never render user-authored content as HTML — all
 * labels/icons go through this and end up as text nodes effectively.
 */
function escapeHtml(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Validate a hotspot's actions array. Returns { valid, errors[] }. Useful
 * in the authoring UI to give authors immediate feedback before saving.
 */
export function validateActions(actions) {
  const errors = [];
  if (!Array.isArray(actions)) {
    return { valid: false, errors: ['actions must be an array'] };
  }
  const KNOWN = new Set(['audio', 'audio_stop', 'video', 'link',
    'nested_splat', 'info', 'state', 'fly', 'multi']);
  actions.forEach((a, idx) => {
    if (!a || typeof a !== 'object') {
      errors.push(`[${idx}] action entry is not an object`);
      return;
    }
    if (!a.label && !a.icon) {
      errors.push(`[${idx}] needs either a label or an icon so users can see the button`);
    }
    if (!a.action || typeof a.action !== 'object') {
      errors.push(`[${idx}] missing inner 'action' object`);
      return;
    }
    if (!KNOWN.has(a.action.type)) {
      errors.push(`[${idx}] unknown action.type "${a.action.type}"`);
    }
    // Type-specific checks
    if (a.action.type === 'audio' && !a.action.url) {
      errors.push(`[${idx}] audio action missing url`);
    }
    if (a.action.type === 'video' && !a.action.url) {
      errors.push(`[${idx}] video action missing url`);
    }
    if (a.action.type === 'link' && !a.action.url) {
      errors.push(`[${idx}] link action missing url`);
    }
    if (a.action.type === 'nested_splat' && !a.action.splatId) {
      errors.push(`[${idx}] nested_splat action missing splatId`);
    }
    if (a.action.type === 'multi' && !Array.isArray(a.action.actions)) {
      errors.push(`[${idx}] multi action missing actions array`);
    }
  });
  return { valid: errors.length === 0, errors };
}

// Expose on window for non-module consumers
if (typeof window !== 'undefined') {
  window.FumocaHotspotActions = {
    runAction, renderActionButtons, stopAllAudio, validateActions,
  };
}

export default {
  runAction,
  renderActionButtons,
  stopAllAudio,
  validateActions,
};
