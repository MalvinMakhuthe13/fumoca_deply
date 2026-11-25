/**
 * FUMOCA 4D Studio Timeline v62
 * Timeline UI with Fly To, rename, update pose, timing edit, delete.
 */
const FumocaStudio = (() => {
  let _canvas = null, _ctx = null, _record = null, _raf = null, _flyToAnim = null;

  async function init() {
    _canvas = document.getElementById('motionCanvas');
    if (!_canvas) return;
    _ctx = _canvas.getContext('2d');
    _record = window._fumocaCurrentRecord;
    _render();
    _raf = setInterval(_render, 600);
    renderKeyframeList();
  }

  function destroy() {
    if (_raf) clearInterval(_raf);
    if (_flyToAnim) cancelAnimationFrame(_flyToAnim);
  }

  function _render() {
    if (!_ctx || !_canvas) return;
    const W = _canvas.width, H = _canvas.height;
    _ctx.clearRect(0, 0, W, H);
    _ctx.fillStyle = '#0a0a0a';
    _ctx.fillRect(0, 0, W, H);
    _ctx.strokeStyle = 'rgba(200,255,0,0.08)';
    _ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 40) { _ctx.beginPath(); _ctx.moveTo(x, 0); _ctx.lineTo(x, H); _ctx.stroke(); }
    _ctx.strokeStyle = 'rgba(200,255,0,0.22)';
    _ctx.lineWidth = 2;
    _ctx.beginPath();
    for (let x = 0; x < W; x += 2) {
      const y = H * 0.5 + Math.sin(x * 0.04) * (H * 0.25);
      x === 0 ? _ctx.moveTo(x, y) : _ctx.lineTo(x, y);
    }
    _ctx.stroke();

    const states = window.Fumoca4D?.getStates?.() || [];
    const maxT = states.length ? (states[states.length - 1].time_offset || 10) : 10;
    states.forEach((st, i) => {
      const xPos = Math.max(12, Math.min(W - 12, (st.time_offset / maxT) * (W - 24) + 12));
      const yPos = H * 0.5;
      _ctx.fillStyle = '#ff2d78';
      _ctx.strokeStyle = '#fff';
      _ctx.lineWidth = 1.5;
      _ctx.beginPath();
      _ctx.moveTo(xPos, yPos - 10); _ctx.lineTo(xPos + 8, yPos); _ctx.lineTo(xPos, yPos + 10); _ctx.lineTo(xPos - 8, yPos);
      _ctx.closePath(); _ctx.fill(); _ctx.stroke();
      _ctx.fillStyle = '#fff';
      _ctx.font = '10px monospace';
      _ctx.fillText(st.step_label?.slice(0, 12) || `K${i + 1}`, xPos - 20, yPos - 16);
    });
    if (!states.length) {
      _ctx.fillStyle = 'rgba(255,255,255,0.25)';
      _ctx.font = '12px monospace';
      _ctx.textAlign = 'center';
      _ctx.fillText('No keyframes — add from the button below', W / 2, H / 2 + 4);
      _ctx.textAlign = 'left';
    }
  }

  async function addKeyframeFromCurrentView() {
    const label = prompt('Camera view label', `Camera view ${(window.Fumoca4D?.getStates?.()?.length || 0) + 1}`);
    if (label === null) return;
    const kf = await window.Fumoca4D?.captureKeyframe(label);
    if (kf) { _render(); renderKeyframeList(); }
  }

  async function autoGenerateMotionSteps() {
    const rec = window._fumocaCurrentRecord;
    if (!rec && !window.S?.alive) { alert('No splat loaded.'); return; }
    const btn = document.getElementById('autoGenBtn');
    if (btn) { btn.textContent = '⏳ Generating...'; btn.disabled = true; }
    try {
      const result = await window.Fumoca4D?.autoGenerateFromVideo(rec);
      if (result) {
        alert(`✅ Generated ${result.steps?.length || 0} keyframes from video motion!`);
        _render(); renderKeyframeList();
      } else {
        alert('Could not auto-generate — check that FumocaMotionTracking is loaded.');
      }
    } finally {
      if (btn) { btn.textContent = '✦ AI Auto-Generate Steps'; btn.disabled = false; }
    }
  }

  function _flyTo(idx) {
    const states = window.Fumoca4D?.getStates?.() || [];
    const st = states[idx];
    if (!st) return;
    const cam = window._fumocaViewerCamera || window._fumocaViewer?.camera;
    const ctrls = window._fumocaViewerControls || window._fumocaViewer?.controls;
    const pose = window.Fumoca4D?.getPoseFromState?.(st);
    if (st.viewport_anchor) {
      document.documentElement.style.setProperty('--focus-x', `${st.viewport_anchor.x || 50}%`);
      document.documentElement.style.setProperty('--focus-y', `${st.viewport_anchor.y || 42}%`);
    }
    if (!cam || !pose || !pose.position || typeof THREE === 'undefined') return;
    if (_flyToAnim) cancelAnimationFrame(_flyToAnim);
    const startPos = cam.position.clone();
    const startTarget = ctrls?.target?.clone?.() || startPos.clone();
    const startQuat = cam.quaternion.clone();
    const endPos = new THREE.Vector3(pose.position.x, pose.position.y, pose.position.z);
    const endTarget = new THREE.Vector3(pose.target.x, pose.target.y, pose.target.z);
    const endQuat = pose.quaternion ? new THREE.Quaternion(pose.quaternion.x, pose.quaternion.y, pose.quaternion.z, pose.quaternion.w) : null;
    const duration = 800, startTs = performance.now();
    function step(now) {
      const raw = Math.min(1, (now - startTs) / duration);
      const t = 0.5 - 0.5 * Math.cos(raw * Math.PI);
      cam.position.lerpVectors(startPos, endPos, t);
      if (ctrls?.target) { ctrls.target.lerpVectors(startTarget, endTarget, t); ctrls.update(); }
      if (endQuat) cam.quaternion.slerpQuaternions(startQuat, endQuat, t);
      if (Number.isFinite(pose.fov)) cam.fov = pose.fov;
      if (Number.isFinite(pose.zoom)) cam.zoom = pose.zoom;
      cam.updateProjectionMatrix?.();
      if (raw < 1) _flyToAnim = requestAnimationFrame(step);
      else _flyToAnim = null;
    }
    _flyToAnim = requestAnimationFrame(step);
  }

  function renderKeyframeList() {
    const container = document.getElementById('motionStepsList');
    if (!container) return;
    const states = window.Fumoca4D?.getStates?.() || [];
    if (!states.length) {
      container.innerHTML = '<p style="color:#666;font-size:12px;">No keyframes yet.</p>';
      return;
    }
    container.innerHTML = states.map((st, i) => `
      <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.06);">
        <span style="color:#c8ff00;font-size:12px;font-weight:700;min-width:90px;">${st.step_label || 'Keyframe ' + (i+1)}</span>
        <span style="color:#555;font-size:11px;">t=${(st.time_offset || 0).toFixed(1)}s</span>
        <button onclick="window._fumoca4DFlyTo(${i})" style="font-size:11px;padding:3px 7px;">Fly To</button>
        <button onclick="window._fumoca4DRename(${i})" style="font-size:11px;padding:3px 7px;">Rename</button>
        <button onclick="window._fumoca4DUpdatePose(${i})" style="font-size:11px;padding:3px 7px;">Update Pose</button>
        <button onclick="window._fumoca4DSetTime(${i})" style="font-size:11px;padding:3px 7px;">Time</button>
        <button onclick="window._fumoca4DDelete(${i})" style="font-size:11px;padding:3px 7px;color:#ff2d78;">Delete</button>
      </div>
    `).join('');

    window._fumoca4DFlyTo = _flyTo;
    window._fumoca4DRename = async (idx) => {
      const cur = states[idx]?.step_label || '';
      const nl = prompt('New label', cur);
      if (nl == null || nl === cur) return;
      await window.Fumoca4D?.renameKeyframe(idx, nl);
      _render(); renderKeyframeList();
    };
    window._fumoca4DUpdatePose = async (idx) => {
      if (!confirm('Replace this keyframe pose with the current camera?')) return;
      await window.Fumoca4D?.updateKeyframePose(idx);
      renderKeyframeList();
    };
    window._fumoca4DSetTime = async (idx) => {
      const cur = states[idx]?.time_offset || 0;
      const nt = parseFloat(prompt('Time offset (seconds)', cur));
      if (!Number.isFinite(nt)) return;
      await window.Fumoca4D?.setKeyframeTime(idx, nt);
      _render(); renderKeyframeList();
    };
    window._fumoca4DDelete = async (idx) => {
      if (!confirm('Delete this keyframe?')) return;
      await window.Fumoca4D?.deleteKeyframe(idx);
      _render(); renderKeyframeList();
    };
  }

  return { init, destroy, addKeyframeFromCurrentView, autoGenerateMotionSteps, renderKeyframeList };
})();

window.FumocaStudio = FumocaStudio;
export default FumocaStudio;
