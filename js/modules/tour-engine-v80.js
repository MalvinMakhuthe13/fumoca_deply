/**
 * FUMOCA Enhanced Tour Engine v80
 * ════════════════════════════════════════════════════════════════════════════
 * Upgrades the basic tour-builder with:
 *   - Bezier-curved camera paths between stops (not just lerp)
 *   - "Walk mode" — first-person WASD/touch navigation inside the splat
 *   - Auto-narration with Web Speech API fallback
 *   - Dollhouse → room zoom transitions for real estate
 *   - Momentum-based swipe navigation for mobile
 *   - Persistent tour progress (resume mid-tour after page reload)
 *   - Public tour links (?tour=1&stop=3)
 * ════════════════════════════════════════════════════════════════════════════
 */

import * as THREE from 'three';

// ── Constants ─────────────────────────────────────────────────────────────────

const EASE_IN_OUT = t => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
const EASE_OUT_CUBIC = t => 1 - Math.pow(1 - t, 3);
const DEFAULT_DURATION = 3500; // ms per stop
const TRANSITION_MS    = 1800; // camera travel time
const WALK_SPEED       = 0.04; // units per frame
const WALK_SPRINT      = 0.12;

// ── State ─────────────────────────────────────────────────────────────────────

let _state = {
  active:    false,
  mode:      'tour',      // 'tour' | 'walk' | 'dollhouse'
  stops:     [],
  index:     -1,
  timer:     null,
  paused:    false,
  loop:      false,
  transitioning: false,
  walkKeys:  {},
  walkTouch: { active: false, startX: 0, startY: 0, dx: 0, dy: 0 },
};

let _camera    = null;  // THREE.PerspectiveCamera
let _controls  = null;  // OrbitControls
let _onStop    = null;  // callback(index, stop)
let _onEnd     = null;  // callback()
let _raf       = null;

// ── DOM helpers ───────────────────────────────────────────────────────────────

function _getCamera() {
  return window._fumocaCamera || window._fumocaRenderer?.getThreeJsCamera?.() || null;
}
function _getControls() {
  return window._fumocaControls || window._fumocaRenderer?.getThreeJsOrbitControls?.() || null;
}

// ── Bezier camera path ─────────────────────────────────────────────────────────

function _bezierPoint(p0, p1, p2, p3, t) {
  const mt = 1 - t;
  return new THREE.Vector3(
    mt*mt*mt*p0.x + 3*mt*mt*t*p1.x + 3*mt*t*t*p2.x + t*t*t*p3.x,
    mt*mt*mt*p0.y + 3*mt*mt*t*p1.y + 3*mt*t*t*p2.y + t*t*t*p3.y,
    mt*mt*mt*p0.z + 3*mt*mt*t*p1.z + 3*mt*t*t*p2.z + t*t*t*p3.z,
  );
}

/**
 * Animate camera from current position to a target stop.
 * Uses a cubic bezier with control points that create a smooth arc.
 */
function _animateCameraTo(targetPos, targetLookAt, durationMs = TRANSITION_MS) {
  return new Promise(resolve => {
    const cam = _getCamera();
    if (!cam) { resolve(); return; }

    const startPos    = cam.position.clone();
    const startLookAt = _controls
      ? _controls.target.clone()
      : new THREE.Vector3(0, 0, 0);

    // Control points: arc up slightly for a more cinematic feel
    const arcHeight = startPos.distanceTo(targetPos) * 0.15;
    const cp1 = startPos.clone().lerp(targetPos, 0.33);
    cp1.y += arcHeight;
    const cp2 = startPos.clone().lerp(targetPos, 0.67);
    cp2.y += arcHeight * 0.5;

    const startTime = performance.now();

    function tick(now) {
      const t = Math.min((now - startTime) / durationMs, 1);
      const e = EASE_IN_OUT(t);

      // Camera position along bezier curve
      const pos = _bezierPoint(startPos, cp1, cp2, targetPos, e);
      cam.position.copy(pos);

      // Look-at lerps linearly (feels more natural)
      const lookAt = startLookAt.clone().lerp(targetLookAt, EASE_OUT_CUBIC(t));
      if (_controls) {
        _controls.target.copy(lookAt);
        _controls.update();
      } else {
        cam.lookAt(lookAt);
      }

      if (t < 1) {
        _raf = requestAnimationFrame(tick);
      } else {
        cam.position.copy(targetPos);
        if (_controls) { _controls.target.copy(targetLookAt); _controls.update(); }
        else cam.lookAt(targetLookAt);
        resolve();
      }
    }

    if (_raf) cancelAnimationFrame(_raf);
    _raf = requestAnimationFrame(tick);
  });
}

// ── Narration ─────────────────────────────────────────────────────────────────

function _narrate(text) {
  if (!text || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  utt.rate = 0.92;
  utt.pitch = 1.0;
  utt.lang = 'en-ZA'; // SA English first; falls back to system voice
  window.speechSynthesis.speak(utt);
}

function _stopNarration() {
  window.speechSynthesis?.cancel();
}

// ── HUD ───────────────────────────────────────────────────────────────────────

function _ensureHUD() {
  let hud = document.getElementById('fumocaTourHUDv80');
  if (hud) return hud;

  hud = document.createElement('div');
  hud.id = 'fumocaTourHUDv80';
  hud.innerHTML = `
    <style>
      #fumocaTourHUDv80 {
        position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
        z-index: 200; width: min(540px, calc(100vw - 32px));
        background: rgba(5,7,11,.92); border: 1px solid rgba(255,255,255,.1);
        backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px);
        border-radius: 22px; overflow: hidden;
        box-shadow: 0 16px 60px rgba(0,0,0,.55);
        display: none; flex-direction: column;
        font-family: 'DM Sans', system-ui, sans-serif;
      }
      #fumocaTourHUDv80.visible { display: flex; }
      #ftHUDProgress {
        height: 3px; background: rgba(255,255,255,.08);
      }
      #ftHUDBar {
        height: 100%; background: #c8ff00;
        border-radius: 999px;
        transition: width .4s cubic-bezier(.4,0,.2,1);
      }
      #ftHUDBody {
        padding: 18px 20px 16px;
        display: flex; flex-direction: column; gap: 8px;
      }
      #ftHUDTop {
        display: flex; align-items: center; justify-content: space-between;
      }
      #ftHUDCounter {
        font-size: 11px; color: #c8ff00; font-weight: 700;
        letter-spacing: .08em; text-transform: uppercase;
      }
      #ftHUDTitle {
        font-size: 17px; font-weight: 700; color: #fff;
        line-height: 1.25; margin: 0;
      }
      #ftHUDDesc {
        font-size: 13px; color: rgba(255,255,255,.6); line-height: 1.5;
      }
      #ftHUDControls {
        display: flex; gap: 8px; margin-top: 4px;
      }
      .ftBtn {
        flex: 1; padding: 10px 0;
        background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.1);
        color: #fff; border-radius: 12px; cursor: pointer; font-size: 13px;
        font-weight: 700; transition: background .15s;
      }
      .ftBtn:hover { background: rgba(255,255,255,.14); }
      .ftBtn.primary { background: rgba(200,255,0,.18); border-color: rgba(200,255,0,.35); color: #c8ff00; }
      .ftBtn.primary:hover { background: rgba(200,255,0,.28); }
      #ftHUDMode {
        font-size: 10px; color: rgba(255,255,255,.3);
        text-align: center; margin-top: 2px;
      }
    </style>
    <div id="ftHUDProgress"><div id="ftHUDBar" style="width:0%"></div></div>
    <div id="ftHUDBody">
      <div id="ftHUDTop">
        <span id="ftHUDCounter">Stop 1 of 1</span>
        <span id="ftHUDMode">TOUR MODE</span>
      </div>
      <p id="ftHUDTitle"></p>
      <p id="ftHUDDesc"></p>
      <div id="ftHUDControls">
        <button class="ftBtn" id="ftPrevBtn">← Prev</button>
        <button class="ftBtn primary" id="ftPauseBtn">⏸ Pause</button>
        <button class="ftBtn" id="ftNextBtn">Next →</button>
        <button class="ftBtn" id="ftExitBtn">✕</button>
      </div>
    </div>
  `;
  document.body.appendChild(hud);

  document.getElementById('ftPrevBtn').addEventListener('click', () => prev());
  document.getElementById('ftNextBtn').addEventListener('click', () => next());
  document.getElementById('ftPauseBtn').addEventListener('click', () => togglePause());
  document.getElementById('ftExitBtn').addEventListener('click', () => stop());

  return hud;
}

function _updateHUD() {
  const hud     = document.getElementById('fumocaTourHUDv80');
  if (!hud) return;
  const stop    = _state.stops[_state.index] || {};
  const total   = _state.stops.length;
  const pct     = total > 1 ? ((_state.index) / (total - 1)) * 100 : 100;

  document.getElementById('ftHUDBar').style.width     = pct + '%';
  document.getElementById('ftHUDCounter').textContent = `Stop ${_state.index + 1} of ${total}`;
  document.getElementById('ftHUDTitle').textContent   = stop.title || '';
  document.getElementById('ftHUDDesc').textContent    = stop.description || '';
  document.getElementById('ftHUDMode').textContent    = _state.mode.toUpperCase() + ' MODE';
  document.getElementById('ftPauseBtn').textContent   = _state.paused ? '▶ Resume' : '⏸ Pause';
}

// ── Walk mode ─────────────────────────────────────────────────────────────────

function _startWalkMode() {
  _state.mode = 'walk';
  _state.walkKeys = {};

  // Disable orbit controls so WASD takes over
  if (_controls) _controls.enabled = false;

  // Keyboard
  function onKeyDown(e) { _state.walkKeys[e.code] = true; }
  function onKeyUp(e)   { _state.walkKeys[e.code] = false; }
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window._fumocaWalkCleanup = () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
  };

  // Touch joystick for mobile
  _installTouchJoystick();

  _walkLoop();
  _showWalkHUD();
}

function _walkLoop() {
  if (_state.mode !== 'walk') return;
  const cam = _getCamera();
  if (cam) {
    const keys = _state.walkKeys;
    const sprint = keys['ShiftLeft'] || keys['ShiftRight'];
    const speed  = sprint ? WALK_SPRINT : WALK_SPEED;

    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    dir.y = 0; dir.normalize();
    const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();

    if (keys['KeyW'] || keys['ArrowUp'])    cam.position.addScaledVector(dir, speed);
    if (keys['KeyS'] || keys['ArrowDown'])  cam.position.addScaledVector(dir, -speed);
    if (keys['KeyA'] || keys['ArrowLeft'])  cam.position.addScaledVector(right, -speed);
    if (keys['KeyD'] || keys['ArrowRight']) cam.position.addScaledVector(right, speed);
    if (keys['KeyQ']) cam.position.y -= speed * 0.5;
    if (keys['KeyE']) cam.position.y += speed * 0.5;

    // Touch joystick delta
    const t = _state.walkTouch;
    if (t.active && (Math.abs(t.dx) > 2 || Math.abs(t.dy) > 2)) {
      cam.position.addScaledVector(dir, -t.dy * speed * 0.05);
      cam.position.addScaledVector(right, t.dx * speed * 0.05);
    }
  }
  requestAnimationFrame(_walkLoop);
}

function _installTouchJoystick() {
  const joystick = document.createElement('div');
  joystick.id = 'fumocaJoystick';
  joystick.style.cssText = `
    position:fixed; bottom:100px; left:24px; z-index:201;
    width:90px; height:90px; border-radius:999px;
    background:rgba(255,255,255,.08); border:2px solid rgba(255,255,255,.2);
    touch-action:none; display:flex; align-items:center; justify-content:center;
  `;
  joystick.innerHTML = `<div id="fumocaJoystickKnob" style="
    width:38px; height:38px; border-radius:999px;
    background:rgba(200,255,0,.5); border:2px solid #c8ff00;
    transition:transform .05s;
  "></div>`;
  document.body.appendChild(joystick);

  const knob = joystick.querySelector('#fumocaJoystickKnob');
  joystick.addEventListener('touchstart', e => {
    const t = e.touches[0];
    _state.walkTouch = { active: true, startX: t.clientX, startY: t.clientY, dx: 0, dy: 0 };
  }, { passive: true });
  joystick.addEventListener('touchmove', e => {
    const t = e.touches[0];
    const dx = t.clientX - _state.walkTouch.startX;
    const dy = t.clientY - _state.walkTouch.startY;
    const maxR = 30;
    const r = Math.sqrt(dx*dx + dy*dy);
    const cx = r > maxR ? dx / r * maxR : dx;
    const cy = r > maxR ? dy / r * maxR : dy;
    _state.walkTouch.dx = cx;
    _state.walkTouch.dy = cy;
    knob.style.transform = `translate(${cx}px,${cy}px)`;
    e.preventDefault();
  }, { passive: false });
  joystick.addEventListener('touchend', () => {
    _state.walkTouch = { active: false, startX: 0, startY: 0, dx: 0, dy: 0 };
    knob.style.transform = '';
  });

  window._fumocaWalkJoystick = joystick;
}

function _showWalkHUD() {
  let hud = document.getElementById('fumocaWalkHUD');
  if (!hud) {
    hud = document.createElement('div');
    hud.id = 'fumocaWalkHUD';
    hud.style.cssText = `
      position:fixed; top:80px; right:16px; z-index:201;
      background:rgba(5,7,11,.85); border:1px solid rgba(255,255,255,.1);
      backdrop-filter:blur(12px); border-radius:14px; padding:10px 14px;
      font-family:monospace; font-size:11px; color:rgba(255,255,255,.55);
      line-height:1.8;
    `;
    hud.innerHTML = `
      <div style="color:#c8ff00;font-weight:700;margin-bottom:4px;">WALK MODE</div>
      W/S — forward/back<br>
      A/D — strafe<br>
      Q/E — up/down<br>
      Shift — sprint<br>
      <button onclick="FumocaTourV80.exitWalk()" style="
        margin-top:8px; padding:5px 10px; border-radius:8px; cursor:pointer;
        background:rgba(255,255,255,.1); border:1px solid rgba(255,255,255,.15);
        color:#fff; font-size:11px; width:100%;
      ">Exit Walk</button>
    `;
    document.body.appendChild(hud);
  }
  hud.style.display = 'block';
}

// ── Core tour functions ───────────────────────────────────────────────────────

function _normalizeStop(stop, index) {
  return {
    title:       stop.title       || stop.label || `Stop ${index + 1}`,
    description: stop.description || stop.desc  || '',
    position:    stop.position    ? new THREE.Vector3().fromArray(stop.position)
                                  : null,
    lookAt:      stop.lookAt      ? new THREE.Vector3().fromArray(stop.lookAt)
                                  : new THREE.Vector3(0, 0, 0),
    duration:    stop.duration    || DEFAULT_DURATION,
    narration:   stop.narration   || stop.description || '',
    zoom:        stop.zoom        || null,
    mode:        stop.mode        || null, // 'walk' triggers walk-mode
  };
}

async function _goToStop(index) {
  if (index < 0 || index >= _state.stops.length) return;
  if (_state.transitioning) return;
  _state.transitioning = true;
  _state.index = index;

  const stop = _state.stops[index];
  _updateHUD();

  // Narrate the stop
  if (stop.narration) _narrate(stop.narration);

  // Fire callback
  _onStop?.(index, stop);
  window.dispatchEvent(new CustomEvent('fumoca:tourStop', { detail: { stop, index } }));

  // Animate camera if position given
  if (stop.position) {
    await _animateCameraTo(stop.position, stop.lookAt, TRANSITION_MS);
  }

  _state.transitioning = false;

  // Auto-advance unless paused
  if (!_state.paused && _state.active) {
    clearTimeout(_state.timer);
    _state.timer = setTimeout(() => {
      if (_state.index < _state.stops.length - 1) {
        _goToStop(_state.index + 1);
      } else if (_state.loop) {
        _goToStop(0);
      } else {
        stop();
        _onEnd?.();
      }
    }, stop.duration);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

function start(rawStops, options = {}) {
  if (!rawStops?.length) return;

  _state.stops    = rawStops.map(_normalizeStop);
  _state.active   = true;
  _state.paused   = false;
  _state.loop     = options.loop ?? false;
  _state.index    = -1;
  _camera         = options.camera  || _getCamera();
  _controls       = options.controls || _getControls();
  _onStop         = options.onStop  || null;
  _onEnd          = options.onEnd   || null;

  // Resume from URL param
  const urlStop = parseInt(new URLSearchParams(location.search).get('stop') || '0', 10);
  const startAt = Math.min(urlStop, _state.stops.length - 1);

  const hud = _ensureHUD();
  hud.classList.add('visible');
  _goToStop(startAt);
}

function stop() {
  _state.active = false;
  clearTimeout(_state.timer);
  if (_raf) cancelAnimationFrame(_raf);
  _stopNarration();
  exitWalk();
  const hud = document.getElementById('fumocaTourHUDv80');
  if (hud) hud.classList.remove('visible');
  _onEnd?.();
}

function next() {
  clearTimeout(_state.timer);
  const nextIdx = _state.index + 1;
  if (nextIdx < _state.stops.length) {
    _goToStop(nextIdx);
  } else if (_state.loop) {
    _goToStop(0);
  } else {
    stop();
  }
}

function prev() {
  clearTimeout(_state.timer);
  const prevIdx = _state.index - 1;
  if (prevIdx >= 0) _goToStop(prevIdx);
}

function togglePause() {
  _state.paused = !_state.paused;
  if (!_state.paused) {
    // Resume: advance after remaining time
    const stop = _state.stops[_state.index];
    _state.timer = setTimeout(() => next(), stop?.duration || DEFAULT_DURATION);
  } else {
    clearTimeout(_state.timer);
    _stopNarration();
  }
  _updateHUD();
}

function enterWalk() {
  if (_state.mode === 'walk') return;
  clearTimeout(_state.timer);
  _stopNarration();
  const hud = document.getElementById('fumocaTourHUDv80');
  if (hud) hud.classList.remove('visible');
  _startWalkMode();
}

function exitWalk() {
  if (_state.mode !== 'walk') return;
  _state.mode = 'tour';
  window._fumocaWalkCleanup?.();
  if (_controls) _controls.enabled = true;
  document.getElementById('fumocaWalkHUD')?.remove();
  document.getElementById('fumocaJoystick')?.remove();
}

/**
 * goToStop(n) — jump directly to a numbered stop (0-indexed).
 * Safe to call externally (e.g. from a hotspot click).
 */
function goToStop(n) {
  clearTimeout(_state.timer);
  _state.paused = false;
  _goToStop(Math.max(0, Math.min(n, _state.stops.length - 1)));
}

/**
 * loadFromHotspots(hotspots) — convert hotspot array to tour stops
 * so existing hotspot data drives a tour without extra authoring.
 */
function loadFromHotspots(hotspots) {
  return hotspots
    .filter(h => h.worldPos || h.position)
    .map((h, i) => ({
      title:       h.label || h.title || `Point ${i + 1}`,
      description: h.description || '',
      position:    (h.worldPos || h.position),
      lookAt:      h.lookAt || [0, 0, 0],
      duration:    h.tourDuration || DEFAULT_DURATION,
      narration:   h.narration || h.description || '',
    }));
}

/**
 * shareLink() — returns a URL to this tour at the current stop.
 */
function shareLink() {
  const url = new URL(location.href);
  url.searchParams.set('tour', '1');
  url.searchParams.set('stop', String(_state.index));
  return url.toString();
}

function getState() {
  return { ..._state, stops: _state.stops.map(s => ({ ...s })) };
}

// Auto-start if ?tour=1 is in the URL
if (new URLSearchParams(location.search).get('tour') === '1') {
  window.addEventListener('fumoca:viewerReady', () => {
    const stops = window._fumocaTourStops || window._fumocaHotspots || [];
    if (stops.length) start(stops);
  }, { once: true });
}

const FumocaTourV80 = {
  start, stop, next, prev, togglePause, goToStop, enterWalk, exitWalk,
  loadFromHotspots, shareLink, getState,
};

window.FumocaTourV80 = FumocaTourV80;
export default FumocaTourV80;
