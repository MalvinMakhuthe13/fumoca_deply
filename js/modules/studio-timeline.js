/**
 * FUMOCA 4D Studio Timeline v60
 * ═══════════════════════════════════════════════════════════════════
 * Renders a visual keyframe timeline in the edit studio.
 * Shows all splat_motion_states as draggable diamond markers.
 * Connects to Fumoca4D for capture + auto-generate.
 * ═══════════════════════════════════════════════════════════════════
 */

const FumocaStudio = (() => {

  let _canvas  = null;
  let _ctx     = null;
  let _record  = null;
  let _raf     = null;

  // ── Init ─────────────────────────────────────────────────────────
  async function init() {
    _canvas = document.getElementById('motionCanvas');
    if (!_canvas) return;
    _ctx    = _canvas.getContext('2d');
    _record = window._fumocaCurrentRecord;

    _render();
    _raf = setInterval(_render, 600); // refresh every 600 ms
  }

  function destroy() {
    if (_raf) clearInterval(_raf);
  }

  // ── Render timeline ──────────────────────────────────────────────
  function _render() {
    if (!_ctx || !_canvas) return;
    const W = _canvas.width;
    const H = _canvas.height;

    _ctx.clearRect(0, 0, W, H);

    // Background
    _ctx.fillStyle = '#0a0a0a';
    _ctx.fillRect(0, 0, W, H);

    // Grid lines
    _ctx.strokeStyle = 'rgba(200,255,0,0.08)';
    _ctx.lineWidth   = 1;
    for (let x = 0; x < W; x += 40) {
      _ctx.beginPath(); _ctx.moveTo(x, 0); _ctx.lineTo(x, H); _ctx.stroke();
    }

    // Waveform decoration
    _ctx.strokeStyle = 'rgba(200,255,0,0.22)';
    _ctx.lineWidth   = 2;
    _ctx.beginPath();
    for (let x = 0; x < W; x += 2) {
      const y = H * 0.5 + Math.sin(x * 0.04) * (H * 0.25);
      x === 0 ? _ctx.moveTo(x, y) : _ctx.lineTo(x, y);
    }
    _ctx.stroke();

    // Keyframe diamonds
    const states = window.Fumoca4D?.getStates?.() || [];
    const maxT   = states.length ? (states[states.length - 1].time_offset || 10) : 10;

    states.forEach((st, i) => {
      const xPos = Math.max(12, Math.min(W - 12, (st.time_offset / maxT) * (W - 24) + 12));
      const yPos = H * 0.5;

      // Diamond
      _ctx.fillStyle   = '#ff2d78';
      _ctx.strokeStyle = '#fff';
      _ctx.lineWidth   = 1.5;
      _ctx.beginPath();
      _ctx.moveTo(xPos, yPos - 10);
      _ctx.lineTo(xPos + 8, yPos);
      _ctx.lineTo(xPos, yPos + 10);
      _ctx.lineTo(xPos - 8, yPos);
      _ctx.closePath();
      _ctx.fill();
      _ctx.stroke();

      // Label
      _ctx.fillStyle = '#fff';
      _ctx.font      = '10px monospace';
      _ctx.fillText(st.step_label?.slice(0, 12) || `K${i + 1}`, xPos - 20, yPos - 16);
    });

    // "No keyframes" hint
    if (!states.length) {
      _ctx.fillStyle  = 'rgba(255,255,255,0.25)';
      _ctx.font       = '12px monospace';
      _ctx.textAlign  = 'center';
      _ctx.fillText('No keyframes — add from the button below', W / 2, H / 2 + 4);
      _ctx.textAlign  = 'left';
    }
  }

  // ── Add keyframe from current camera view ────────────────────────
  async function addKeyframeFromCurrentView() {
    const label = prompt('Keyframe label (e.g. "Living Room", "Hero Shot")', `Keyframe ${(window.Fumoca4D?.getStates?.()?.length || 0) + 1}`);
    if (label === null) return;

    const kf = await window.Fumoca4D?.captureKeyframe(label);
    if (kf) {
      _render();
      // Update the list if one exists in DOM
      renderKeyframeList();
    }
  }

  // ── Auto-generate from video ──────────────────────────────────────
  async function autoGenerateMotionSteps() {
    const rec = window._fumocaCurrentRecord;
    if (!rec && !window.S?.alive) { alert('No splat loaded.'); return; }

    const btn = document.getElementById('autoGenBtn');
    if (btn) { btn.textContent = '⏳ Generating...'; btn.disabled = true; }

    try {
      const result = await window.Fumoca4D?.autoGenerateFromVideo(rec);
      if (result) {
        alert(`✅ Generated ${result.steps?.length || 0} keyframes from video motion!`);
        _render();
        renderKeyframeList();
      } else {
        alert('Could not auto-generate — check that FumocaMotionTracking is loaded.');
      }
    } finally {
      if (btn) { btn.textContent = '✦ AI Auto-Generate Steps'; btn.disabled = false; }
    }
  }

  // ── Render keyframe list in DOM ───────────────────────────────────
  function renderKeyframeList() {
    const container = document.getElementById('motionStepsList');
    if (!container) return;
    const states = window.Fumoca4D?.getStates?.() || [];
    if (!states.length) { container.innerHTML = '<p style="color:#666;font-size:12px;">No keyframes yet.</p>'; return; }
    container.innerHTML = states.map((st, i) => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.06);">
        <div>
          <span style="color:#c8ff00;font-size:12px;font-weight:700;">${st.step_label || 'Keyframe ' + (i+1)}</span>
          <span style="color:#555;font-size:11px;margin-left:8px;">t=${(st.time_offset || 0).toFixed(1)}s</span>
        </div>
        <button onclick="window._fumoca4DFlyTo(${i})" style="font-size:11px;padding:4px 8px;">Fly To</button>
      </div>
    `).join('');

    window._fumoca4DFlyTo = (idx) => {
      const st = states[idx];
      if (st?.viewport_anchor) {
        document.documentElement.style.setProperty('--focus-x', `${st.viewport_anchor.x || 50}%`);
        document.documentElement.style.setProperty('--focus-y', `${st.viewport_anchor.y || 42}%`);
      }
    };
  }

  // ── Public API ───────────────────────────────────────────────────
  return {
    init,
    destroy,
    addKeyframeFromCurrentView,
    autoGenerateMotionSteps,
    renderKeyframeList,
  };

})();

window.FumocaStudio = FumocaStudio;
export default FumocaStudio;

// NOTE: Do NOT auto-init here. edit.html's _boot() calls FumocaStudio.init()
// once after panels are injected. Self-init here would double-register listeners.
// (Kept as export only — caller decides when to init.)
