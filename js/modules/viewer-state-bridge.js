/**
 * FUMOCA Viewer State Bridge
 * Makes fumoca:state real in the viewer: doors, lights, engine, infotainment.
 *
 * Visual strategy (works without custom 3D door meshes yet):
 *  - Status chips + ambient overlays so demos feel live
 *  - Lights: canvas warmth / headlight glow
 *  - Engine: sound + RPM-style pulse on HUD
 *  - Infotainment: interactive phone/screen panel (power + scroll)
 *  - Door: label + optional camera ease toward door side
 *
 * Later: map keys to Gaussian groups / animation clips when assets support it.
 */
import { playOneShot, playSceneBed, stopSceneBed } from './scene-audio.js';
import {
  getInteractionState,
  setInteractionState,
  onStateChange,
  triggerAction,
} from './scene-interactions.js';

const OVERLAY_ID = 'fumocaStateFX';
const HUD_ID = 'fumocaStateHUD';
const IVI_ID = 'fumocaInfotainment';

function ensureStyles() {
  if (document.getElementById('fumocaStateBridgeCSS')) return;
  const s = document.createElement('style');
  s.id = 'fumocaStateBridgeCSS';
  s.textContent = `
    #${OVERLAY_ID} {
      position: fixed; inset: 0; z-index: 4; pointer-events: none;
      transition: background .5s ease, box-shadow .5s ease, opacity .4s ease;
    }
    #${OVERLAY_ID}.lights-on {
      box-shadow: inset 0 0 120px rgba(255, 220, 150, 0.22),
                  inset 0 -40px 80px rgba(255, 200, 100, 0.12);
    }
    #${OVERLAY_ID}.engine-on {
      animation: fumocaEnginePulse 1.2s ease-in-out infinite;
    }
    @keyframes fumocaEnginePulse {
      0%,100% { background: transparent; }
      50% { background: rgba(200,255,0,0.03); }
    }
    #${OVERLAY_ID}.door-open::after {
      content: '';
      position: absolute; left: 0; top: 20%; bottom: 20%; width: 8%;
      background: linear-gradient(90deg, rgba(0,0,0,0.45), transparent);
      transition: opacity .4s;
    }
    #${HUD_ID} {
      position: fixed; left: 12px; bottom: 88px; z-index: 14;
      display: flex; flex-direction: column; gap: 6px;
      pointer-events: none; max-width: 200px;
    }
    #${HUD_ID} .chip {
      pointer-events: none;
      font: 600 11px/1.2 DM Sans, system-ui, sans-serif;
      padding: 6px 10px; border-radius: 999px;
      background: rgba(5,7,11,.82); border: 1px solid rgba(255,255,255,.12);
      color: rgba(255,255,255,.75); backdrop-filter: blur(10px);
      opacity: 0; transform: translateY(6px);
      transition: opacity .25s, transform .25s;
    }
    #${HUD_ID} .chip.on {
      opacity: 1; transform: none;
      border-color: rgba(200,255,0,.35); color: #c8ff00;
    }
    #${IVI_ID} {
      position: fixed; right: 16px; top: 50%; transform: translateY(-50%);
      z-index: 16; width: min(280px, 42vw);
      border-radius: 16px; overflow: hidden;
      background: #0a0c12; border: 2px solid #1a1d28;
      box-shadow: 0 20px 60px rgba(0,0,0,.55);
      display: none; flex-direction: column;
      font-family: DM Sans, system-ui, sans-serif;
    }
    #${IVI_ID}.visible { display: flex; }
    #${IVI_ID} .ivi-bezel {
      background: #11141c; padding: 8px 10px 6px;
      display: flex; align-items: center; justify-content: space-between;
      border-bottom: 1px solid rgba(255,255,255,.06);
    }
    #${IVI_ID} .ivi-bezel span { font-size: 10px; color: rgba(255,255,255,.4); letter-spacing: .08em; }
    #${IVI_ID} .ivi-screen {
      height: 320px; background: #05070b; color: #fff;
      overflow: hidden; position: relative;
    }
    #${IVI_ID} .ivi-screen.off {
      display: grid; place-items: center;
      background: #03040a;
    }
    #${IVI_ID} .ivi-screen.off::after {
      content: 'Tap power'; color: rgba(255,255,255,.25); font-size: 12px;
    }
    #${IVI_ID} .ivi-scroll {
      height: 100%; overflow-y: auto; -webkit-overflow-scrolling: touch;
      padding: 12px; scroll-behavior: smooth;
    }
    #${IVI_ID} .ivi-scroll h3 { font-size: 15px; margin: 0 0 8px; color: #c8ff00; }
    #${IVI_ID} .ivi-scroll p { font-size: 12px; color: rgba(255,255,255,.55); line-height: 1.45; margin: 0 0 12px; }
    #${IVI_ID} .ivi-card {
      background: rgba(255,255,255,.05); border-radius: 10px;
      padding: 10px; margin-bottom: 8px; border: 1px solid rgba(255,255,255,.08);
    }
    #${IVI_ID} .ivi-card strong { display: block; font-size: 12px; margin-bottom: 4px; }
    #${IVI_ID} .ivi-power {
      width: 28px; height: 28px; border-radius: 50%;
      border: 1px solid rgba(255,255,255,.2); background: rgba(255,255,255,.06);
      color: #fff; cursor: pointer; font-size: 12px;
    }
    #${IVI_ID} .ivi-power.on { background: rgba(200,255,0,.2); border-color: #c8ff00; color: #c8ff00; }
    #${IVI_ID} .ivi-close {
      position: absolute; top: 6px; right: 8px; z-index: 2;
      background: transparent; border: none; color: rgba(255,255,255,.4);
      cursor: pointer; font-size: 16px;
    }
    #fumocaDoorSwing {
      position: fixed; z-index: 5; pointer-events: none;
      width: 22vw; max-width: 180px; height: 55vh; max-height: 420px;
      left: 8%; top: 22%;
      transform-origin: left center;
      transform: perspective(800px) rotateY(0deg);
      transition: transform .55s cubic-bezier(.4,.0,.2,1), opacity .3s;
      opacity: 0;
      background: linear-gradient(90deg, rgba(30,35,45,.75), rgba(20,25,35,.35));
      border: 1px solid rgba(255,255,255,.12);
      border-radius: 4px 10px 10px 4px;
      box-shadow: 4px 0 24px rgba(0,0,0,.4);
    }
    #fumocaDoorSwing.open {
      opacity: 1;
      transform: perspective(800px) rotateY(-62deg);
    }
    #fumocaDoorSwing .handle {
      position: absolute; right: 12px; top: 50%; width: 8px; height: 28px;
      margin-top: -14px; border-radius: 4px; background: rgba(200,255,0,.5);
    }
  `;
  document.head.appendChild(s);
}

function ensureOverlay() {
  let el = document.getElementById(OVERLAY_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = OVERLAY_ID;
    document.body.appendChild(el);
  }
  return el;
}

function ensureDoorSwing() {
  let el = document.getElementById('fumocaDoorSwing');
  if (!el) {
    el = document.createElement('div');
    el.id = 'fumocaDoorSwing';
    el.innerHTML = '<div class="handle"></div>';
    document.body.appendChild(el);
  }
  return el;
}

function ensureHUD() {
  let el = document.getElementById(HUD_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = HUD_ID;
    el.innerHTML = `
      <div class="chip" data-k="door_fl">Door FL · closed</div>
      <div class="chip" data-k="door_fr">Door FR · closed</div>
      <div class="chip" data-k="lights">Lights · off</div>
      <div class="chip" data-k="engine">Engine · off</div>
      <div class="chip" data-k="ivi">Infotainment · off</div>
    `;
    document.body.appendChild(el);
  }
  return el;
}

function setChip(key, label, on) {
  const chip = document.querySelector(`#${HUD_ID} .chip[data-k="${key}"]`);
  if (!chip) return;
  chip.textContent = label;
  chip.classList.toggle('on', !!on);
}

function applyVisuals(detail) {
  const { key, value, state } = detail;
  const fx = ensureOverlay();
  const st = state || {};

  // Lights
  const lightsOn = (st.lights || getInteractionState('lights')) === 'on';
  fx.classList.toggle('lights-on', lightsOn);
  setChip('lights', lightsOn ? 'Lights · ON' : 'Lights · off', lightsOn);

  // Engine
  const engineOn = (st.engine || getInteractionState('engine')) === 'on';
  fx.classList.toggle('engine-on', engineOn);
  setChip('engine', engineOn ? 'Engine · RUNNING' : 'Engine · off', engineOn);

  // Doors
  const fl = st.door_fl || getInteractionState('door_fl') || 'closed';
  const fr = st.door_fr || getInteractionState('door_fr') || 'closed';
  fx.classList.toggle('door-open', fl === 'open' || fr === 'open');
  const doorEl = ensureDoorSwing();
  const anyDoor = fl === 'open' || fr === 'open';
  doorEl.classList.toggle('open', anyDoor);
  if (fr === 'open' && fl !== 'open') {
    doorEl.style.left = 'auto';
    doorEl.style.right = '8%';
    doorEl.style.transformOrigin = 'right center';
  } else {
    doorEl.style.left = '8%';
    doorEl.style.right = 'auto';
    doorEl.style.transformOrigin = 'left center';
  }
  setChip('door_fl', `Door FL · ${fl}`, fl === 'open');
  setChip('door_fr', `Door FR · ${fr}`, fr === 'open');

  // Infotainment
  const ivi = st.ivi || getInteractionState('ivi') || 'off';
  setChip('ivi', ivi === 'on' ? 'Infotainment · ON' : 'Infotainment · off', ivi === 'on');
  if (key === 'ivi' || ivi === 'on') {
    showInfotainment(ivi === 'on');
  }
}

function showInfotainment(powered) {
  ensureStyles();
  let panel = document.getElementById(IVI_ID);
  if (!panel) {
    panel = document.createElement('div');
    panel.id = IVI_ID;
    panel.innerHTML = `
      <button type="button" class="ivi-close" aria-label="Close">✕</button>
      <div class="ivi-bezel">
        <span>INFOTAINMENT</span>
        <button type="button" class="ivi-power" id="iviPowerBtn" title="Power">⏻</button>
      </div>
      <div class="ivi-screen off" id="iviScreen"></div>
    `;
    document.body.appendChild(panel);
    panel.querySelector('.ivi-close').onclick = () => {
      setInteractionState('ivi', 'off');
      panel.classList.remove('visible');
    };
    panel.querySelector('#iviPowerBtn').onclick = () => {
      const on = getInteractionState('ivi') !== 'on';
      setInteractionState('ivi', on ? 'on' : 'off');
    };
  }
  panel.classList.add('visible');
  const screen = panel.querySelector('#iviScreen');
  const powerBtn = panel.querySelector('#iviPowerBtn');
  powerBtn.classList.toggle('on', powered);

  if (!powered) {
    screen.className = 'ivi-screen off';
    screen.innerHTML = '';
    return;
  }

  screen.className = 'ivi-screen';
  screen.innerHTML = `
    <div class="ivi-scroll" id="iviScroll">
      <h3>FUMOCA Drive</h3>
      <p>Demo head unit — scroll to explore apps. Power cycles with the hotspot or ⏻.</p>
      <div class="ivi-card"><strong>Navigation</strong> Route to dealership · 12 min</div>
      <div class="ivi-card"><strong>Media</strong> Now playing: Showroom mix</div>
      <div class="ivi-card"><strong>Climate</strong> 22° · Auto · Driver zone</div>
      <div class="ivi-card"><strong>Vehicle</strong> Doors · Lights · Engine status</div>
      <div class="ivi-card"><strong>Phone</strong> Pair device · CarPlay / Android Auto</div>
      <div class="ivi-card"><strong>Settings</strong> Display · Sound · Profiles</div>
      <div class="ivi-card"><strong>Apps</strong> Weather · Parking · Manual</div>
      <p style="text-align:center;opacity:.4;font-size:11px">Scroll for more · Interactive product demo</p>
    </div>
  `;
  // slight auto-scroll tease once
  const sc = screen.querySelector('#iviScroll');
  if (sc && !sc.dataset.teased) {
    sc.dataset.teased = '1';
    setTimeout(() => {
      sc.scrollTo({ top: 40, behavior: 'smooth' });
      setTimeout(() => sc.scrollTo({ top: 0, behavior: 'smooth' }), 700);
    }, 400);
  }
}

/**
 * React to state changes with optional SFX from metadata.
 */
function applyRegionOpacity(key, value) {
  // metadata.stateRegions[key] = { indices: number[] } or { bbox: [minX,minY,minZ,maxX,maxY,maxZ] }
  const regions = window._fumocaStateRegions || {};
  const region = regions[key];
  const S = window.S || window._fumocaState;
  if (!S?.alive || !region) return;

  const open = value === 'open' || value === 'on';
  if (Array.isArray(region.indices)) {
    for (const i of region.indices) {
      if (i >= 0 && i < S.alive.length) {
        // Hide panel Gaussians when door "open" as a stand-in for swing animation
        if (key.startsWith('door_')) S.alive[i] = open ? false : true;
        if (key === 'lights' && S.opacities) {
          S.opacities[i] = open ? Math.min(1, (S.opacities[i] || 0.5) * 1.4) : (S.opacities[i] || 0.5);
        }
      }
    }
    S.needsUpdate = true;
    window._fumocaRenderer?.needsUpdate && (window._fumocaRenderer.needsUpdate = true);
    if (typeof window._fumocaRedraw === 'function') window._fumocaRedraw();
  }
}

async function onState(detail) {
  applyVisuals(detail);
  const { key, value } = detail;
  applyRegionOpacity(key, value);
  try {
    if ((key.startsWith('door') || key === 'boot') && window._fumocaStateRegions?.[key]) {
      import('./hinge-door.js').then((mod) => {
        mod.ensureHingeDoor(key, window._fumocaStateRegions[key]);
        mod.setDoorOpen(key, value === 'open');
      }).catch(() => {});
    }
  } catch (_) {}

  const sounds = window._fumocaStateSounds || {};
  try {
    const { playStateSound } = await import('./procedural-sfx.js');
    playStateSound(key, value, sounds);
  } catch (e) {
    console.warn('[sfx]', e);
  }
}

/**
 * Seed vehicle demo hotspots on the hotspot layer if empty.
 */
export function seedVehicleDemoHotspots() {
  const layer = document.getElementById('hotspotLayer');
  if (!layer) return;

  const existing = layer.querySelectorAll('.hotspot-marker[data-demo="vehicle"]');
  if (existing.length) return;

  const demos = [
    { key: 'door_fl', label: 'Driver door', x: 28, y: 58, action: { type: 'state', key: 'door_fl', toggle: true, toggleValues: ['closed', 'open'] } },
    { key: 'lights', label: 'Lights', x: 72, y: 48, action: { type: 'state', key: 'lights', toggle: true, toggleValues: ['off', 'on'] } },
    { key: 'engine', label: 'Engine start', x: 50, y: 42, action: { type: 'state', key: 'engine', toggle: true, toggleValues: ['off', 'on'] } },
    { key: 'ivi', label: 'Infotainment', x: 48, y: 62, action: { type: 'state', key: 'ivi', toggle: true, toggleValues: ['off', 'on'] } },
  ];

  demos.forEach((d) => {
    const m = document.createElement('div');
    m.className = 'hotspot-marker pulse';
    m.dataset.demo = 'vehicle';
    m.dataset.type = 'state';
    m.style.left = d.x + '%';
    m.style.top = d.y + '%';
    m.innerHTML = `<div class="hotspot-pill">${d.label}</div>`;
    m.title = d.label;
    m.addEventListener('click', (e) => {
      e.stopPropagation();
      triggerAction(d.action);
    });
    layer.appendChild(m);
  });
}

const DEFAULT_STATE_SOUNDS = {
  click: 'sounds/click.wav',
  door: 'sounds/door.wav',
  engineStart: 'sounds/engine-start.wav',
  engineLoop: 'sounds/engine-idle.wav',
};

export function initViewerStateBridge(opts = {}) {
  ensureStyles();
  ensureOverlay();
  ensureHUD();
  ensureDoorSwing();
  window._fumocaStateSounds = {
    ...DEFAULT_STATE_SOUNDS,
    ...(window._fumocaStateSounds || {}),
  };

  onStateChange(onState);
  document.addEventListener('fumoca:state', (e) => onState(e.detail || {}));

  // Optional: auto seed vehicle pins when mode=car or ?demo=vehicle
  const params = new URLSearchParams(location.search);
  if (
    opts.seedVehicle !== false &&
    (params.get('demo') === 'vehicle' ||
      params.get('mode') === 'car' ||
      params.get('seedHotspots') === '1')
  ) {
    // Wait for layer
    const trySeed = () => {
      if (document.getElementById('hotspotLayer')) seedVehicleDemoHotspots();
      else setTimeout(trySeed, 300);
    };
    trySeed();
  }

  // Init chips from current state
  applyVisuals({ key: '*', value: null, state: getInteractionState() });

  try {
    import('./hinge-door.js').then((mod) => {
      mod.syncDoorsFromState(getInteractionState());
    }).catch(() => {});
  } catch (_) {}
  console.info('[FUMOCA] Viewer state bridge active (doors · lights · engine · IVI · hinge)');
  return {
    seedVehicleDemoHotspots,
    setInteractionState,
    getInteractionState,
    showInfotainment,
  };
}

if (typeof window !== 'undefined') {
  window.FUMOCA_ViewerStateBridge = {
    initViewerStateBridge,
    seedVehicleDemoHotspots,
    showInfotainment,
  };
}
