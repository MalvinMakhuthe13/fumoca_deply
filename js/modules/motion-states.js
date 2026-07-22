/**
 * FUMOCA Motion States
 * Manages multi-moment captures: each "moment" is a separate splat
 * that users can navigate between via hotspots and the state timeline.
 *
 * Works for: people (arrival → pose → exit), vehicles (front → side → rear),
 * events (entry → performance → closeup), any motion arc.
 */

const MS = (() => {

  // ─── State ─────────────────────────────────────────────────────────────────
  let _states = [];        // [{id, label, splatUrl, thumbnailUrl, time, hotspotAnchor}]
  let _currentIdx = 0;
  let _record = null;
  let _onStateChange = null;

  // ─── Init ──────────────────────────────────────────────────────────────────
  function init(record = null, onStateChange = null) {
    _record = record;
    _onStateChange = onStateChange;
    _states = _loadStates(record);
    _renderTimeline();
    if (_states.length > 0) _activateState(0, false);
  }

  // ─── Load states from record metadata ─────────────────────────────────────
  function _loadStates(record) {
    try {
      const raw = record?.metadata?.motion_states;
      if (Array.isArray(raw) && raw.length) return raw;
    } catch {}
    // Single splat = one state
    const url = record?.splat_url || window._fumocaSplatUrl || '';
    if (url) return [{ id: 'main', label: 'Main', splatUrl: url, thumbnailUrl: record?.thumbnail_url || '', time: 0 }];
    return [];
  }

  // ─── Add a new moment state ────────────────────────────────────────────────
  function addState({ label, splatUrl, thumbnailUrl = '', time = 0, hotspotAnchor = null }) {
    const id = `state_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
    _states.push({ id, label: label || `Moment ${_states.length + 1}`, splatUrl, thumbnailUrl, time, hotspotAnchor });
    _renderTimeline();
    _persistStates();
    return id;
  }

  // ─── Remove a state ────────────────────────────────────────────────────────
  function removeState(id) {
    const idx = _states.findIndex(s => s.id === id);
    if (idx < 0) return;
    _states.splice(idx, 1);
    if (_currentIdx >= _states.length) _currentIdx = Math.max(0, _states.length - 1);
    _renderTimeline();
    _persistStates();
  }

  // ─── Activate a state (load its splat into the viewer) ────────────────────
  async function _activateState(idx, animate = true) {
    if (idx < 0 || idx >= _states.length) return;
    const prev = _states[_currentIdx];
    _currentIdx = idx;
    const state = _states[idx];

    _renderTimeline();
    window.dispatchEvent(new CustomEvent('fumoca:motionStateChanging', {
      detail: { state, idx, prev, animate }
    }));

    // Load the splat for this state into the viewer
    if (state.splatUrl && state.splatUrl !== window._fumocaSplatUrl) {
      if (animate) _showTransition(state);
      await _loadSplatIntoViewer(state.splatUrl, animate);
    }

    // Move camera to hotspot anchor if defined
    if (animate && state.hotspotAnchor) {
      const camEng = window.FumocaCameraEngine;
      if (camEng?.flyTo) {
        camEng.flyTo(state.hotspotAnchor.wx, state.hotspotAnchor.wy, state.hotspotAnchor.wz);
      }
    }

    if (_onStateChange) _onStateChange(state, idx);
    window.dispatchEvent(new CustomEvent('fumoca:motionStateChanged', {
      detail: { state, idx, total: _states.length }
    }));
  }

  // ─── Load a splat URL into the live viewer ────────────────────────────────
  async function _loadSplatIntoViewer(splatUrl, animate = true) {
    window._fumocaSplatUrl = splatUrl;
    const viewer = window._fumocaViewer;
    if (!viewer) return;

    try {
      if (typeof viewer.loadFile === 'function') {
        await viewer.loadFile(splatUrl);
      } else if (typeof viewer.loadSplat === 'function') {
        await viewer.loadSplat(splatUrl);
      } else {
        // Fallback: reload the viewer with new URL param
        const url = new URL(location.href);
        url.searchParams.set('file', splatUrl);
        window.dispatchEvent(new CustomEvent('fumoca:requestSplatReload', { detail: { url: splatUrl } }));
      }
    } catch (e) {
      console.warn('[MotionStates] loadSplat failed:', e);
      window.dispatchEvent(new CustomEvent('fumoca:requestSplatReload', { detail: { url: splatUrl } }));
    }
  }

  // ─── State transition visual ───────────────────────────────────────────────
  function _showTransition(state) {
    const te = window.FumocaTransitionEngine;
    if (!te) return;
    const shell = document.getElementById('previewShell');
    const statusEl = document.getElementById('previewStatus');
    if (shell) te.morphVideoToSplat({ shell, statusEl, mode: 'event' });
  }

  // ─── Navigate forward/back ────────────────────────────────────────────────
  function next() { if (_currentIdx < _states.length - 1) _activateState(_currentIdx + 1); }
  function prev() { if (_currentIdx > 0) _activateState(_currentIdx - 1); }
  function goTo(idx) { _activateState(idx); }
  function goToId(id) {
    const idx = _states.findIndex(s => s.id === id);
    if (idx >= 0) _activateState(idx);
  }

  // ─── Auto-play tour through all states ────────────────────────────────────
  let _tourTimer = null;
  function startTour(intervalMs = 3500) {
    stopTour();
    _activateState(0);
    _tourTimer = setInterval(() => {
      if (_currentIdx < _states.length - 1) next();
      else stopTour();
    }, intervalMs);
    window.dispatchEvent(new CustomEvent('fumoca:motionTourStarted'));
  }
  function stopTour() {
    if (_tourTimer) { clearInterval(_tourTimer); _tourTimer = null; }
    window.dispatchEvent(new CustomEvent('fumoca:motionTourStopped'));
  }

  // ─── Generate hotspots from states ────────────────────────────────────────
  // Creates a hotspot for each motion state so they're accessible from the viewer
  function generateHotspots() {
    return _states.map((s, i) => ({
      id: `motion_${s.id}`,
      title: s.label,
      type: 'motion_state',
      wx: s.hotspotAnchor?.wx ?? 0,
      wy: s.hotspotAnchor?.wy ?? 0,
      wz: s.hotspotAnchor?.wz ?? 0,
      motionStateId: s.id,
      motionStateIdx: i,
      thumbnailUrl: s.thumbnailUrl,
      description: `Moment ${i + 1} of ${_states.length}`
    }));
  }

  // ─── Persist to Supabase record metadata ──────────────────────────────────
  async function _persistStates() {
    if (!_record?.id) return;
    try {
      const sb = window._fumocaSupabase;
      if (!sb) return;
      await sb.from('splats').update({
        metadata: { ...(_record.metadata || {}), motion_states: _states }
      }).eq('id', _record.id);
    } catch (e) {
      console.warn('[MotionStates] persist failed:', e);
    }
  }

  // ─── Render timeline UI ────────────────────────────────────────────────────
  function _renderTimeline() {
    let el = document.getElementById('motionTimeline');
    if (!el) {
      el = document.createElement('div');
      el.id = 'motionTimeline';
      Object.assign(el.style, {
        position: 'fixed', bottom: '72px', left: '50%', transform: 'translateX(-50%)',
        zIndex: '15', display: 'flex', gap: '8px', alignItems: 'center',
        background: 'rgba(7,10,16,.82)', border: '1px solid rgba(255,255,255,.12)',
        borderRadius: '999px', padding: '6px 14px', backdropFilter: 'blur(12px)',
        pointerEvents: 'auto', userSelect: 'none'
      });
      document.body.appendChild(el);
    }

    if (_states.length <= 1) { el.style.display = 'none'; return; }
    el.style.display = 'flex';
    el.innerHTML = '';

    // Prev button
    const prevBtn = _mkBtn('←', () => prev(), _currentIdx === 0);
    el.appendChild(prevBtn);

    // State dots
    _states.forEach((s, i) => {
      const dot = document.createElement('button');
      dot.title = s.label;
      Object.assign(dot.style, {
        width: '10px', height: '10px', borderRadius: '50%', border: 'none', cursor: 'pointer', padding: '0',
        background: i === _currentIdx ? '#c8ff00' : 'rgba(255,255,255,.3)',
        transition: 'background .2s, transform .2s',
        transform: i === _currentIdx ? 'scale(1.4)' : 'scale(1)'
      });
      dot.addEventListener('click', () => goTo(i));
      el.appendChild(dot);
    });

    // Next button
    const nextBtn = _mkBtn('→', () => next(), _currentIdx >= _states.length - 1);
    el.appendChild(nextBtn);

    // State label
    const label = document.createElement('span');
    label.style.cssText = 'font:500 11px/1 var(--font-sans,sans-serif);color:rgba(255,255,255,.7);margin-left:4px;min-width:64px;text-align:center';
    label.textContent = _states[_currentIdx]?.label || '';
    el.appendChild(label);
  }

  function _mkBtn(text, fn, disabled = false) {
    const b = document.createElement('button');
    b.textContent = text;
    b.disabled = disabled;
    Object.assign(b.style, {
      background: 'none', border: 'none', color: disabled ? 'rgba(255,255,255,.2)' : 'rgba(255,255,255,.8)',
      cursor: disabled ? 'default' : 'pointer', fontSize: '14px', padding: '0 4px', lineHeight: '1'
    });
    b.addEventListener('click', fn);
    return b;
  }

  // ─── Public API ───────────────────────────────────────────────────────────
  return {
    init, addState, removeState, next, prev, goTo, goToId,
    startTour, stopTour, generateHotspots,
    getStates: () => [..._states],
    getCurrent: () => _states[_currentIdx],
    getCurrentIdx: () => _currentIdx,
    getCount: () => _states.length,
  };
})();

window.FumocaMotionStates = MS;
export default MS;
