/**
 * FUMOCA 4D Capture UI
 * Orchestrates: video analysis → R2 source upload → NIF reconstruction job dispatch
 * Works for both single-phone and multi-camera capture.
 * Handles slow/fast motion, people and vehicles.
 */

import MA from './motion-analyzer.js';
import MS from './motion-states.js';
import MT from './motion-tracking.js';
import r2 from '../r2Client.js';
import { build4DCaptureJobs, createMotionSequenceId } from './fourd-job-contract.js';

const FourDCapture = (() => {

  let _panel = null;
  let _record = null;
  let _analysisResult = null;
  let _trackingResult = null;
  let _analysisFile = null;
  let _sessionJobs = [];

  // ─── Init ──────────────────────────────────────────────────────────────────
  function init(record = null) {
    _record = record;
    _buildPanel();
    _bindEvents();
  }

  // ─── Build the panel ───────────────────────────────────────────────────────
  function _buildPanel() {
    if (document.getElementById('fourDCapturePanel')) return;

    const panel = document.createElement('div');
    panel.id = 'fourDCapturePanel';
    panel.setAttribute('aria-hidden', 'true');
    panel.innerHTML = `
<div id="fourDPanelInner">
  <div id="fourDHeader">
    <span id="fourDTitle">4D Capture</span>
    <button id="fourDClose" title="Close">✕</button>
  </div>
  <div id="fourDTabs">
    <button class="fourDTab active" data-tab="analyze">Analyze</button>
    <button class="fourDTab" data-tab="moments">Moments</button>
    <button class="fourDTab" data-tab="track">Track</button>
    <button class="fourDTab" data-tab="multicam">Multi-cam</button>
    <button class="fourDTab" data-tab="pipeline">Pipeline</button>
  </div>

  <!-- ANALYZE TAB -->
  <div class="fourDTabContent active" id="tab_analyze">
    <div class="fourDSection">
      <label class="fourDLabel">Upload video of moving subject</label>
      <div id="fourDDropZone">
        <input type="file" id="fourDVideoFile" accept="video/*" style="display:none">
        <div id="fourDDropLabel">Drop video or tap to select</div>
        <div id="fourDDropSub">MP4, MOV, slow-mo, 4K — any source</div>
      </div>
    </div>
    <div class="fourDSection" id="fourDAnalysisProgress" style="display:none">
      <div class="fourDLabel">Analyzing motion…</div>
      <div id="fourDProgressBar"><div id="fourDProgressFill"></div></div>
      <div id="fourDProgressLabel">Starting…</div>
    </div>
    <div class="fourDSection" id="fourDAnalysisResult" style="display:none">
      <div id="fourDMotionClass"></div>
      <div id="fourDStrategyBox"></div>
      <div id="fourDMomentsList"></div>
      <button id="fourDRunIsolation" class="fourDPrimaryBtn" style="display:none">Upload + queue motion reconstruction</button>
    </div>
  </div>

  <!-- MOMENTS TAB -->
  <div class="fourDTabContent" id="tab_moments">
    <div class="fourDSection">
      <div class="fourDLabel">Motion moments</div>
      <div id="fourDMomentsEditor"></div>
      <button id="fourDAddMoment" class="fourDGhostBtn">+ Add moment manually</button>
    </div>
    <div class="fourDSection">
      <button id="fourDStartTour" class="fourDPrimaryBtn">Play motion tour</button>
      <button id="fourDStopTour" class="fourDGhostBtn" style="display:none">Stop tour</button>
    </div>
  </div>



  <!-- TRACK TAB -->
  <div class="fourDTabContent" id="tab_track">
    <div class="fourDSection">
      <div class="fourDLabel">Motion learning trace</div>
      <div class="fourDNote">Extract step anchors from the capture so dance, fitness, sports, and gesture tutorials become easier to follow inside the splat experience.</div>
    </div>
    <div class="fourDSection">
      <button id="fourDRunTracking" class="fourDPrimaryBtn" style="display:none">Analyze step trace</button>
      <button id="fourDApplyTracking" class="fourDGhostBtn" style="display:none">Map trace to motion states</button>
    </div>
    <div class="fourDSection" id="fourDTrackingProgress" style="display:none">
      <div class="fourDLabel">Tracking movement…</div>
      <div id="fourDTrackProgressBar"><div id="fourDTrackProgressFill"></div></div>
      <div id="fourDTrackProgressLabel">Starting…</div>
    </div>
    <div class="fourDSection" id="fourDTrackingResult" style="display:none"></div>
  </div>

  <!-- MULTI-CAM TAB -->
  <div class="fourDTabContent" id="tab_multicam">
    <div class="fourDSection">
      <div class="fourDLabel">Multi-camera session</div>
      <div class="fourDNote">Start all cameras together and keep them recording simultaneously. FUMOCA aligns frames by relative timestamps; hardware sync and camera calibration are not assumed.</div>
    </div>
    <div id="fourDMultiCamList"></div>
    <button id="fourDAddCam" class="fourDGhostBtn">+ Add camera angle</button>
    <button id="fourDMergeAndDispatch" class="fourDPrimaryBtn" style="margin-top:12px;display:none">Merge all angles + reconstruct</button>
  </div>

  <!-- PIPELINE TAB -->
  <div class="fourDTabContent" id="tab_pipeline">
    <div class="fourDSection">
      <div class="fourDLabel">Reconstruction jobs</div>
      <div id="fourDJobList"></div>
    </div>
    <div class="fourDSection">
      <div class="fourDLabel">Settings</div>
      <label class="fourDCheckRow"><input type="checkbox" id="fourDIsolateSubject" checked> Track isolated subject across frames (SAM2 when available)</label>
      <label class="fourDCheckRow"><input type="checkbox" id="fourDAutoComposite" checked> Composite onto venue background</label>
      <label class="fourDCheckRow"><input type="checkbox" id="fourDAutoTour" checked> Auto-create motion tour on completion</label>
    </div>
  </div>
</div>`;
    document.body.appendChild(panel);
    _panel = panel;
    _injectStyles();
    _renderMomentsEditor();
    _renderJobList();
  }

  function _injectStyles() {
    if (document.getElementById('fourDStyles')) return;
    const s = document.createElement('style');
    s.id = 'fourDStyles';
    s.textContent = `
#fourDCapturePanel{position:fixed;right:0;top:0;bottom:0;width:min(340px,100vw);z-index:20;background:rgba(7,10,16,.96);border-left:1px solid rgba(255,255,255,.1);transform:translateX(100%);transition:transform .3s cubic-bezier(.4,0,.2,1);display:flex;flex-direction:column;overflow:hidden}
#fourDCapturePanel.open{transform:translateX(0)}
#fourDPanelInner{flex:1;overflow-y:auto;overflow-x:hidden;padding:0 0 80px}
#fourDHeader{display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.08)}
#fourDTitle{font:700 15px/1 var(--font-display,sans-serif);color:#c8ff00;letter-spacing:.06em}
#fourDClose{background:none;border:none;color:rgba(255,255,255,.5);cursor:pointer;font-size:16px;padding:4px 8px}
#fourDTabs{display:flex;border-bottom:1px solid rgba(255,255,255,.08);padding:0 8px}
.fourDTab{background:none;border:none;border-bottom:2px solid transparent;color:rgba(255,255,255,.45);cursor:pointer;font:500 12px/1 var(--font-sans,sans-serif);padding:10px 8px;flex:1;letter-spacing:.04em}
.fourDTab.active{color:#c8ff00;border-bottom-color:#c8ff00}
.fourDTabContent{display:none;padding:16px}
.fourDTabContent.active{display:block}
.fourDSection{margin-bottom:18px}
.fourDLabel{font:500 11px/1 var(--font-sans,sans-serif);color:rgba(255,255,255,.5);text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px}
.fourDNote{font-size:12px;color:rgba(255,255,255,.45);line-height:1.5}
#fourDDropZone{border:1.5px dashed rgba(200,255,0,.3);border-radius:10px;padding:20px;text-align:center;cursor:pointer;transition:border-color .2s,background .2s}
#fourDDropZone:hover,#fourDDropZone.drag{border-color:#c8ff00;background:rgba(200,255,0,.04)}
#fourDDropLabel{color:rgba(255,255,255,.7);font-size:13px;font-weight:500;margin-bottom:4px}
#fourDDropSub{color:rgba(255,255,255,.35);font-size:11px}
#fourDProgressBar{height:4px;background:rgba(255,255,255,.1);border-radius:2px;overflow:hidden;margin:8px 0}
#fourDProgressFill{height:100%;background:#c8ff00;width:0%;transition:width .3s}
#fourDProgressLabel{font-size:11px;color:rgba(255,255,255,.4)}
.fourDMotionBadge{display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border-radius:999px;font:600 11px/1 var(--font-sans,sans-serif);margin-bottom:10px;text-transform:uppercase;letter-spacing:.06em}
.motionBadge-still{background:rgba(99,153,34,.18);color:#c0dd97;border:1px solid rgba(99,153,34,.3)}
.motionBadge-slow{background:rgba(186,117,23,.18);color:#fac775;border:1px solid rgba(186,117,23,.3)}
.motionBadge-moderate{background:rgba(83,74,183,.18);color:#afa9ec;border:1px solid rgba(83,74,183,.3)}
.motionBadge-fast{background:rgba(226,75,74,.18);color:#f09595;border:1px solid rgba(226,75,74,.3)}
.fourDStrategyCard{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:12px;font-size:12px;color:rgba(255,255,255,.6);line-height:1.6;margin-bottom:10px}
.fourDStrategyCard strong{color:rgba(255,255,255,.85);display:block;margin-bottom:4px;font-size:13px}
.fourDMomentRow{display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.06)}
.fourDMomentDot{width:8px;height:8px;border-radius:50%;background:#c8ff00;flex-shrink:0}
.fourDMomentLabel{flex:1;font-size:13px;color:rgba(255,255,255,.8)}
.fourDMomentTime{font-size:11px;color:rgba(255,255,255,.35);font-family:var(--font-mono,monospace)}
.fourDPrimaryBtn{width:100%;padding:11px;background:rgba(200,255,0,.12);border:1px solid rgba(200,255,0,.35);border-radius:8px;color:#c8ff00;font:600 13px/1 var(--font-sans,sans-serif);cursor:pointer;letter-spacing:.04em;transition:background .2s}
.fourDPrimaryBtn:hover{background:rgba(200,255,0,.2)}
.fourDGhostBtn{width:100%;padding:9px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:8px;color:rgba(255,255,255,.6);font:500 12px/1 var(--font-sans,sans-serif);cursor:pointer;margin-top:8px}
.fourDCheckRow{display:flex;align-items:center;gap:8px;font-size:12px;color:rgba(255,255,255,.6);padding:5px 0;cursor:pointer}
.fourDJobRow{display:flex;align-items:center;gap:8px;padding:8px;background:rgba(255,255,255,.04);border-radius:6px;margin-bottom:6px;font-size:12px;color:rgba(255,255,255,.7)}
.fourDJobStatus{flex-shrink:0;width:8px;height:8px;border-radius:50%}
#fourDTrackProgressBar{height:4px;background:rgba(255,255,255,.1);border-radius:2px;overflow:hidden;margin:8px 0}
#fourDTrackProgressFill{height:100%;background:#00ffc8;width:0%;transition:width .3s}
#fourDTrackProgressLabel{font-size:11px;color:rgba(255,255,255,.4)}
.fourDTrackStep{display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.06)}
.fourDTrackBadge{width:22px;height:22px;border-radius:999px;background:rgba(0,255,200,.14);border:1px solid rgba(0,255,200,.4);display:grid;place-items:center;color:#7affea;font:700 10px/1 var(--font-body,sans-serif);flex-shrink:0}
.fourDTrackMeta{font-size:12px;color:rgba(255,255,255,.68);line-height:1.45}
.fourDTrackMeta strong{display:block;color:rgba(255,255,255,.88);margin-bottom:3px}
.status-pending{background:rgba(255,255,255,.25)}
.status-running{background:#fac775}
.status-done{background:#c0dd97}
.status-failed{background:#f09595}
.fourDCamRow{display:flex;align-items:center;gap:8px;padding:8px;background:rgba(255,255,255,.04);border-radius:6px;margin-bottom:6px;font-size:12px;color:rgba(255,255,255,.7)}`;
    document.head.appendChild(s);
  }

  // ─── Bind events ───────────────────────────────────────────────────────────
  function _bindEvents() {
    // Open button in viewer toolbar
    window.addEventListener('fumoca:open4DCapture', () => open());

    document.addEventListener('click', e => {
      const t = e.target;
      if (t.id === 'fourDClose') close();
      if (t.id === 'fourDDropZone' || t.id === 'fourDDropLabel' || t.id === 'fourDDropSub') {
        document.getElementById('fourDVideoFile')?.click();
      }
      if (t.classList.contains('fourDTab')) _switchTab(t.dataset.tab);
      if (t.id === 'fourDRunIsolation') _runIsolationAndDispatch();
      if (t.id === 'fourDRunTracking') _runTracking();
      if (t.id === 'fourDApplyTracking') _applyTrackingToStates();
      if (t.id === 'fourDAddCam') _addCameraSlot();
      if (t.id === 'fourDMergeAndDispatch') _mergeAndDispatch();
      if (t.id === 'fourDStartTour') { MS.startTour(); t.style.display='none'; document.getElementById('fourDStopTour').style.display=''; }
      if (t.id === 'fourDStopTour') { MS.stopTour(); t.style.display='none'; document.getElementById('fourDStartTour').style.display=''; }
      if (t.id === 'fourDAddMoment') _addManualMoment();
    });

    const fileInput = document.getElementById('fourDVideoFile');
    if (fileInput) fileInput.addEventListener('change', e => { if (e.target.files[0]) _handleVideoFile(e.target.files[0]); });

    const dz = document.getElementById('fourDDropZone');
    if (dz) {
      dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag'); });
      dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
      dz.addEventListener('drop', e => {
        e.preventDefault(); dz.classList.remove('drag');
        const f = e.dataTransfer.files[0];
        if (f && f.type.startsWith('video/')) _handleVideoFile(f);
      });
    }
  }

  // ─── Handle video upload ───────────────────────────────────────────────────
  async function _handleVideoFile(file) {
    _showProgress(true);
    _updateProgress(0, 'Reading video…');
    try {
      _analysisFile = file;
      _analysisResult = await MA.analyzeVideo(file, p => {
        _updateProgress(p * 0.85, p < 0.5 ? 'Scanning frames…' : 'Finding best moments…');
      });
      _updateProgress(1, 'Analysis complete');
      setTimeout(() => _showProgress(false), 600);
      _renderAnalysisResult(_analysisResult, file);
    } catch (e) {
      _showProgress(false);
      _renderError('Analysis failed: ' + e.message);
    }
  }

  // ─── Render analysis result ────────────────────────────────────────────────
  function _renderAnalysisResult(result, file) {
    const el = document.getElementById('fourDAnalysisResult');
    const mc = document.getElementById('fourDMotionClass');
    const sb = document.getElementById('fourDStrategyBox');
    const ml = document.getElementById('fourDMomentsList');
    const runBtn = document.getElementById('fourDRunIsolation');
    const trackBtn = document.getElementById('fourDRunTracking');

    el.style.display = '';
    const cls = result.motionClass;
    mc.innerHTML = `<div class="fourDMotionBadge motionBadge-${cls}">${_motionIcon(cls)} ${cls} motion detected</div>`;

    sb.innerHTML = `<div class="fourDStrategyCard">
      <strong>${result.strategy.label}</strong>
      ${result.strategy.tip}
      ${result.recommendMultiMoment ? `<br><br>Found <strong style="color:#c8ff00">${result.keyMoments?.length || 0} key moments</strong> — each will become a separate splat state.` : `<br><br>Best window: <strong style="color:#c8ff00">${result.bestWindowStart.toFixed(1)}s – ${result.bestWindowEnd.toFixed(1)}s</strong>`}
    </div>`;

    ml.innerHTML = '';
    if (result.keyMoments?.length) {
      result.keyMoments.forEach((m, i) => {
        const row = document.createElement('div');
        row.className = 'fourDMomentRow';
        row.innerHTML = `<div class="fourDMomentDot"></div><div class="fourDMomentLabel">Moment ${i+1}</div><div class="fourDMomentTime">${m.time.toFixed(2)}s</div>`;
        ml.appendChild(row);
      });
    }

    runBtn.style.display = '';
    runBtn._file = file;
    runBtn._result = result;
    if (trackBtn) { trackBtn.style.display = ''; trackBtn._file = file; trackBtn._result = result; }
  }

  // ─── Upload source once, then queue real reconstruction_jobs ───────────────
  async function _runIsolationAndDispatch() {
    const runBtn = document.getElementById('fourDRunIsolation');
    const file = runBtn?._file || _analysisFile;
    const result = runBtn?._result || _analysisResult;
    if (!file || !result) return;

    const sb = window._fumocaSupabase;
    if (!sb) return _renderDispatchError('Supabase is not ready. Reload the viewer and try again.');
    runBtn.disabled = true;
    runBtn.textContent = 'Uploading source video…';
    _showProgress(true);
    _updateProgress(0.02, 'Checking signed-in account…');

    try {
      const { data: authData, error: authError } = await sb.auth.getUser();
      if (authError) throw authError;
      const user = authData?.user;
      if (!user?.id) throw new Error('Sign in before queuing a 4D reconstruction.');

      _clearDispatchError();
      const sequenceId = createMotionSequenceId();
      const safeName = String(file.name || 'capture-video')
        .replace(/\s+/g, '_').replace(/[^a-zA-Z0-9._-]/g, '').slice(-100);
      const ext = /\.(mp4|mov|webm|m4v)$/i.exec(safeName)?.[1]?.toLowerCase() || 'mp4';
      const sourcePath = `raw/${user.id}/4d/${sequenceId}/source.${ext}`;

      _updateProgress(0.08, 'Uploading original video to FUMOCA storage…');
      const { fileKey, error: uploadError } = await r2.from('nif-videos').upload(sourcePath, file, {
        contentType: file.type || 'video/mp4',
        onProgress: pct => _updateProgress(0.08 + (pct / 100) * 0.72, `Uploading source video… ${pct}%`)
      });
      if (uploadError) throw uploadError;
      if (!fileKey) throw new Error('Storage did not return a source video key.');

      const doIsolate = document.getElementById('fourDIsolateSubject')?.checked ?? true;
      const jobPayloads = build4DCaptureJobs({
        analysis: result,
        recordId: _record?.id || null,
        sourceKey: fileKey,
        userId: user.id,
        sequenceId,
        requestedIsolation: doIsolate
      });

      _updateProgress(0.84, 'Creating reconstruction jobs…');
      const { data: createdJobs, error: jobsError } = await sb
        .from('reconstruction_jobs')
        .insert(jobPayloads)
        .select('id,status,progress');
      if (jobsError) throw jobsError;
      if (!Array.isArray(createdJobs) || createdJobs.length !== jobPayloads.length) {
        throw new Error('The reconstruction queue did not confirm every motion moment.');
      }
      createdJobs.forEach((job, i) => {
        const payload = jobPayloads[i];
        _addJob(job.id, payload.meta.title, 'pending');
        _updateJobStatus(job.id, 'pending', 'Queued for GPU worker');
        Object.assign(_sessionJobs[_sessionJobs.length - 1], { sequenceId, stateIndex: i });
      });
      _renderJobList();
      const queued = createdJobs.length;
      _watchSessionJobs();

      _updateProgress(1, `${queued} reconstruction job${queued === 1 ? '' : 's'} queued`);
      const status = document.getElementById('fourDProgressLabel');
      if (status) status.textContent = `Sequence ${sequenceId.slice(0, 8)} · ${queued} job(s) queued. Original video stored once.`;
      runBtn.textContent = 'Queued — check Pipeline tab';
      _switchTab('pipeline');
      window.dispatchEvent(new CustomEvent('fumoca:fourDSequenceQueued', {
        detail: { sequenceId, sourceKey: fileKey, jobCount: queued, jobIds: _sessionJobs.filter(j => j.sequenceId === sequenceId).map(j => j.id) }
      }));
    } catch (e) {
      _renderDispatchError('4D capture could not be queued: ' + (e?.message || String(e)));
      runBtn.disabled = false;
      runBtn.textContent = 'Retry upload + queue';
    } finally {
      _showProgress(false);
      runBtn.disabled = false;
    }
  }

  async function _runTracking() {
    const btn = document.getElementById('fourDRunTracking');
    const file = btn?._file || _analysisFile;
    const result = btn?._result || _analysisResult;
    if (!file || !result) return;
    _showTrackingProgress(true);
    _updateTrackingProgress(0, 'Preparing frames…');
    try {
      _trackingResult = await MT.analyzeVideo(file, result, p => {
        _updateTrackingProgress(p, p < 0.45 ? 'Scanning movement…' : 'Extracting steps…');
      });
      _showTrackingProgress(false);
      _renderTrackingResult(_trackingResult);
      document.getElementById('fourDApplyTracking').style.display = '';
      MT.renderTracking(_trackingResult);
      _switchTab('track');
    } catch (e) {
      _showTrackingProgress(false);
      _renderTrackingError('Tracking failed: ' + e.message);
    }
  }

  async function _applyTrackingToStates() {
    if (!_trackingResult) return;
    const mapped = MT.applyToMotionStates(_trackingResult);
    const saved = await MT.persistToRecord(_trackingResult, _record);
    _renderTrackingResult(_trackingResult, mapped, saved);
    _renderMomentsEditor();
    window.dispatchEvent(new CustomEvent('fumoca:motionTrackingApplied', { detail: { tracking: _trackingResult, mapped, saved } }));
  }

  function _renderTrackingResult(tracking, mapped = [], saved = false) {
    const el = document.getElementById('fourDTrackingResult');
    if (!el) return;
    el.style.display = '';
    const steps = tracking?.steps || [];
    const cards = steps.map((step, i) => `
      <div class="fourDTrackStep">
        <div class="fourDTrackBadge">${i+1}</div>
        <div class="fourDTrackMeta">
          <strong>${step.label} · ${step.time.toFixed(2)}s</strong>
          ${step.hint}<br>
          Anchor ${(step.x * 100).toFixed(0)}% × ${(step.y * 100).toFixed(0)}%
        </div>
      </div>`).join('');
    const mapNote = mapped.length ? `<div class="fourDStrategyCard"><strong>Mapped to motion states</strong>${mapped.map(m => `${m.step} → ${m.stateId}`).join('<br>')}${saved ? '<br><br>Saved to record metadata.' : ''}</div>` : '';
    el.innerHTML = `
      <div class="fourDStrategyCard">
        <strong>Learning overlay ready</strong>
        ${tracking?.hints?.mode || 'Use each extracted step as a guided checkpoint inside the splat.'}<br><br>
        ${tracking?.hints?.tracking || ''}
      </div>
      ${cards}
      ${mapNote}`;
  }

  function _showTrackingProgress(show) {
    const el = document.getElementById('fourDTrackingProgress');
    if (el) el.style.display = show ? '' : 'none';
  }
  function _updateTrackingProgress(pct, label) {
    const fill = document.getElementById('fourDTrackProgressFill');
    const lbl = document.getElementById('fourDTrackProgressLabel');
    if (fill) fill.style.width = `${Math.round(pct * 100)}%`;
    if (lbl) lbl.textContent = label;
  }
  function _renderTrackingError(msg) {
    const el = document.getElementById('fourDTrackingResult');
    if (el) { el.style.display=''; el.innerHTML=`<div style="color:#f09595;font-size:12px;padding:8px">${msg}</div>`; }
  }

  function _escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  }

  // ─── Multi-camera ──────────────────────────────────────────────────────────
  let _camSlots = [];
  function _addCameraSlot() {
    const id = `cam_${Date.now()}`;
    _camSlots.push({ id, file: null, label: `Camera ${_camSlots.length + 1}` });
    _renderMultiCam();
  }
  function _renderMultiCam() {
    const list = document.getElementById('fourDMultiCamList');
    if (!list) return;
    list.innerHTML = _camSlots.map((c, i) => `
      <div class="fourDCamRow" data-cam="${c.id}">
        <span style="color:rgba(255,255,255,.4);font-size:11px">CAM ${i+1}</span>
        <span style="flex:1;color:${c.file ? '#c8ff00' : 'rgba(255,255,255,.5)'}">${c.file ? _escapeHtml(c.file.name) : 'No file'}</span>
        <button onclick="document.getElementById('camFile_${c.id}').click()" style="background:none;border:1px solid rgba(255,255,255,.15);border-radius:4px;color:rgba(255,255,255,.5);font-size:10px;padding:3px 7px;cursor:pointer">${c.file?'Change':'Select'}</button>
        <input type="file" id="camFile_${c.id}" accept="video/*" style="display:none" onchange="window.__fumocaCamFileChange('${c.id}', this.files[0])">
      </div>`).join('');
    window.__fumocaCamFileChange = (id, file) => {
      const slot = _camSlots.find(c => c.id === id);
      if (slot) { slot.file = file; _renderMultiCam(); }
      const ready = _camSlots.filter(c => c.file).length >= 2;
      document.getElementById('fourDMergeAndDispatch').style.display = ready ? '' : 'none';
    };
  }
  async function _mergeAndDispatch() {
    const cameras = _camSlots.filter(c => c.file);
    const button = document.getElementById('fourDMergeAndDispatch');
    if (cameras.length < 2 || !button) return;
    const sb = window._fumocaSupabase;
    if (!sb) return _renderDispatchError('Supabase is not ready. Reload the viewer and try again.', 'fourDMultiCamList');
    button.disabled = true;
    button.textContent = 'Extracting synchronized frames…';
    _showProgress(true);

    const loaded = [];
    try {
      const { data: authData, error: authError } = await sb.auth.getUser();
      if (authError) throw authError;
      const user = authData?.user;
      if (!user?.id) throw new Error('Sign in before queuing a multi-camera reconstruction.');

      _clearDispatchError('fourDMultiCamList');
      const sequenceId = createMotionSequenceId();
      const streams = [];
      let commonDuration = Infinity;
      for (let cameraId = 0; cameraId < cameras.length; cameraId++) {
        const video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.preload = 'metadata';
        const objectUrl = URL.createObjectURL(cameras[cameraId].file);
        loaded.push({ video, objectUrl });
        await new Promise((resolve, reject) => {
          video.addEventListener('loadedmetadata', resolve, { once: true });
          video.addEventListener('error', () => reject(new Error(`Could not read Camera ${cameraId + 1} video metadata`)), { once: true });
          video.src = objectUrl;
          video.load();
        });
        if (!Number.isFinite(video.duration) || video.duration < 1) {
          throw new Error(`Camera ${cameraId + 1} video is too short or has no readable duration.`);
        }
        if (!video.videoWidth || !video.videoHeight) {
          throw new Error(`Camera ${cameraId + 1} video has no readable frame dimensions.`);
        }
        commonDuration = Math.min(commonDuration, video.duration);
        streams.push({ cameraId, video, file: cameras[cameraId].file, frames: [] });
      }

      // These videos are assumed to share a common start. This is explicit in
      // metadata; no false claim of hardware/genlock synchronization is made.
      const sampleCount = Math.min(30, Math.max(3, Math.floor(commonDuration * 2)));
      const times = Array.from({ length: sampleCount }, (_, i) =>
        sampleCount === 1 ? 0 : 0.05 + (Math.max(0.1, commonDuration - 0.1) * i / (sampleCount - 1))
      );
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not create a frame extraction canvas.');

      let extracted = 0;
      for (const stream of streams) {
        for (const time of times) {
          await new Promise((resolve, reject) => {
            const onSeeked = () => { cleanup(); resolve(); };
            const onError = () => { cleanup(); reject(new Error(`Camera ${stream.cameraId + 1} failed at ${time.toFixed(2)}s`)); };
            const cleanup = () => {
              stream.video.removeEventListener('seeked', onSeeked);
              stream.video.removeEventListener('error', onError);
            };
            stream.video.addEventListener('seeked', onSeeked, { once: true });
            stream.video.addEventListener('error', onError, { once: true });
            stream.video.currentTime = time;
          });
          const scale = Math.min(1, 1280 / stream.video.videoWidth);
          canvas.width = Math.max(1, Math.round(stream.video.videoWidth * scale));
          canvas.height = Math.max(1, Math.round(stream.video.videoHeight * scale));
          ctx.drawImage(stream.video, 0, 0, canvas.width, canvas.height);
          const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
          if (!blob) throw new Error('Could not encode an extracted camera frame.');
          const name = `t${String(Math.round(time * 1000)).padStart(8, '0')}_cam${String(stream.cameraId).padStart(2, '0')}.jpg`;
          stream.frames.push({ time, file: new File([blob], name, { type: 'image/jpeg' }) });
          extracted++;
          _updateProgress(extracted / (cameras.length * sampleCount) * 0.75, `Extracting camera frames… ${extracted}/${cameras.length * sampleCount}`);
        }
      }

      const merged = MA.mergeMultiCameraFrames(streams.map(s => ({
        cameraId: s.cameraId,
        frames: s.frames.map(f => ({ time: f.time, file: f.file }))
      })));
      const zipFiles = merged.map(item => item.file);
      const { buildStoreZipFromFiles } = await import('./zip-writer.js');
      const zipBytes = await buildStoreZipFromFiles(zipFiles);
      const zipBlob = new Blob([zipBytes], { type: 'application/zip' });
      const zipPath = `raw/${user.id}/4d/${sequenceId}/multicam.zip`;
      button.textContent = 'Uploading synchronized frame set…';
      const { fileKey, error: uploadError } = await r2.from('nif-videos').upload(zipPath, zipBlob, {
        contentType: 'application/zip',
        onProgress: pct => _updateProgress(0.75 + pct / 100 * 0.2, `Uploading frame set… ${pct}%`)
      });
      if (uploadError) throw uploadError;
      if (!fileKey) throw new Error('Storage did not return the multi-camera frame-set key.');

      const { data: job, error: jobError } = await sb.from('reconstruction_jobs').insert({
        user_id: user.id,
        status: 'queued',
        progress: 0,
        vertical: 'generic',
        capture_mode: 'burst',
        raw_r2_key: fileKey,
        meta: {
          title: `Multi-camera motion capture ${sequenceId.slice(0, 8)}`,
          source: 'fourd_multicam',
          multicam_session_id: sequenceId,
          multi_camera: true,
          camera_count: cameras.length,
          frames_per_camera: sampleCount,
          frame_count: zipFiles.length,
          camera_sync: 'relative-start-assumed',
          camera_sync_warning: 'Videos are aligned by relative timestamps; hardware synchronization and camera calibration are not available in this capture.',
          source_capture: { type: 'multi_camera_frame_zip', r2_key: fileKey, camera_count: cameras.length, frame_count: zipFiles.length }
        }
      }).select('id,status,progress').single();
      if (jobError) throw jobError;
      _addJob(job.id, 'Multi-camera reconstruction', 'pending');
      _updateJobStatus(job.id, 'pending', 'Queued for GPU worker');
      Object.assign(_sessionJobs[_sessionJobs.length - 1], { sequenceId });
      _renderJobList();
      _watchSessionJobs();
      _updateProgress(1, 'Multi-camera reconstruction queued.');
      button.textContent = 'Queued — check Pipeline tab';
      _switchTab('pipeline');
      window.dispatchEvent(new CustomEvent('fumoca:multiCamDispatch', {
        detail: { sequenceId, jobId: job.id, cameras: cameras.length, frames: zipFiles.length, sourceKey: fileKey }
      }));
    } catch (e) {
      button.textContent = 'Retry multi-camera queue';
      _renderDispatchError('Multi-camera capture could not be queued: ' + (e?.message || String(e)), 'fourDMultiCamList');
    } finally {
      loaded.forEach(({ video, objectUrl }) => {
        video.pause();
        video.removeAttribute('src');
        video.load();
        URL.revokeObjectURL(objectUrl);
      });
      _showProgress(false);
      button.disabled = false;
    }
  }

  // ─── Manual moment ─────────────────────────────────────────────────────────
  function _addManualMoment() {
    const label = prompt('Moment label (e.g. Arrival, Peak, Exit):');
    if (!label) return;
    const url = prompt('Splat URL for this moment (leave blank to use current):');
    MS.addState({ label, splatUrl: url || window._fumocaSplatUrl || '', time: Date.now() });
    _renderMomentsEditor();
  }
  function _renderMomentsEditor() {
    const el = document.getElementById('fourDMomentsEditor');
    if (!el) return;
    const states = MS.getStates();
    if (!states.length) { el.innerHTML = '<div class="fourDNote">No moments yet. Analyze a video or add manually.</div>'; return; }
    el.innerHTML = states.map((s, i) => `
      <div class="fourDMomentRow">
        <div class="fourDMomentDot" style="background:${i===MS.getCurrentIdx()?'#c8ff00':'rgba(255,255,255,.3)'}"></div>
        <div class="fourDMomentLabel" style="cursor:pointer" onclick="window.FumocaMotionStates.goTo(${i})">${s.label}</div>
        <button onclick="window.FumocaMotionStates.removeState('${s.id}')" style="background:none;border:none;color:rgba(255,255,255,.25);cursor:pointer;font-size:12px">✕</button>
      </div>`).join('');
  }

  // ─── Job list ──────────────────────────────────────────────────────────────
  function _addJob(id, label, status) {
    _sessionJobs.push({ id, label, status, statusText: status });
    _renderJobList();
  }
  function _updateJobStatus(id, status, text) {
    const job = _sessionJobs.find(j => j.id === id);
    if (job) { job.status = status; job.statusText = text; }
    _renderJobList();
  }
  function _renderJobList() {
    const el = document.getElementById('fourDJobList');
    if (!el) return;
    if (!_sessionJobs.length) { el.innerHTML = '<div class="fourDNote">No jobs yet. Analyze a video to start.</div>'; return; }
    el.innerHTML = _sessionJobs.map(j => `
      <div class="fourDJobRow">
        <div class="fourDJobStatus status-${j.status}"></div>
        <span style="flex:1">${_escapeHtml(j.label)}</span>
        <span style="color:rgba(255,255,255,.35);font-size:11px">${_escapeHtml(j.statusText || j.status)}</span>
      </div>`).join('');
  }

  let _jobPollTimer = null;
  let _jobPollInFlight = false;
  function _watchSessionJobs() {
    if (_jobPollTimer) clearInterval(_jobPollTimer);
    const poll = async () => {
      if (_jobPollInFlight) return;
      const sb = window._fumocaSupabase;
      const ids = _sessionJobs.map(j => j.id).filter(Boolean);
      if (!sb || !ids.length) return;
      _jobPollInFlight = true;
      try {
        const { data, error } = await sb.from('reconstruction_jobs')
          .select('id,status,progress,error_message')
          .in('id', ids);
        if (error) throw error;
        for (const row of data || []) {
          const job = _sessionJobs.find(item => item.id === row.id);
          if (!job) continue;
          const status = String(row.status || 'queued').toLowerCase();
          job.status = ['complete', 'completed', 'done'].includes(status) ? 'done'
            : status === 'failed' || status === 'needs_retry' ? 'failed'
            : status === 'processing' || status === 'running' ? 'running' : 'pending';
          const pct = Number.isFinite(Number(row.progress)) ? Math.round(Number(row.progress)) : null;
          job.statusText = status === 'needs_retry'
            ? (row.error_message || 'Needs recapture')
            : status === 'failed'
              ? (row.error_message || 'Failed')
              : ['complete', 'completed', 'done'].includes(status)
                ? 'Complete'
                : `${status}${pct == null ? '' : ` · ${pct}%`}`;
        }
        _renderJobList();
        const terminal = _sessionJobs.length && _sessionJobs.every(j => ['done', 'failed'].includes(j.status));
        if (terminal && _jobPollTimer) {
          clearInterval(_jobPollTimer);
          _jobPollTimer = null;
        }
      } catch (error) {
        console.warn('[FUMOCA 4D] Job status refresh failed:', error);
      } finally {
        _jobPollInFlight = false;
      }
    };
    poll();
    _jobPollTimer = setInterval(poll, 5000);
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────
  function _motionIcon(cls) {
    return { still: '◉', slow: '◎', moderate: '◈', fast: '◆' }[cls] || '◉';
  }
  function _showProgress(show) {
    const el = document.getElementById('fourDAnalysisProgress');
    if (el) el.style.display = show ? '' : 'none';
  }
  function _updateProgress(pct, label) {
    const fill = document.getElementById('fourDProgressFill');
    const lbl = document.getElementById('fourDProgressLabel');
    if (fill) fill.style.width = `${Math.round(pct * 100)}%`;
    if (lbl) lbl.textContent = label;
  }
  function _renderError(msg) {
    const el = document.getElementById('fourDAnalysisResult');
    if (el) { el.style.display=''; el.innerHTML=`<div style="color:#f09595;font-size:12px;padding:8px">${msg}</div>`; }
  }

  function _renderDispatchError(msg, targetId = 'fourDAnalysisResult') {
    const el = document.getElementById(targetId);
    if (!el) return;
    let error = el.querySelector('.fourDDispatchError');
    if (!error) {
      error = document.createElement('div');
      error.className = 'fourDDispatchError';
      error.style.cssText = 'color:#f09595;font-size:11px;line-height:1.5;padding:8px 10px;margin:8px 0;border:1px solid rgba(240,149,149,.25);border-radius:7px;background:rgba(240,149,149,.06)';
      el.prepend(error);
    }
    error.textContent = msg;
  }
  function _clearDispatchError(targetId = 'fourDAnalysisResult') {
    document.getElementById(targetId)?.querySelector('.fourDDispatchError')?.remove();
  }
  function _switchTab(name) {
    document.querySelectorAll('.fourDTab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('.fourDTabContent').forEach(c => c.classList.toggle('active', c.id === `tab_${name}`));
    if (name === 'moments') _renderMomentsEditor();
    if (name === 'pipeline') _renderJobList();
  }

  function open() { _panel?.classList.add('open'); _panel?.setAttribute('aria-hidden','false'); }
  function close() { _panel?.classList.remove('open'); _panel?.setAttribute('aria-hidden','true'); }
  function toggle() { _panel?.classList.contains('open') ? close() : open(); }

  return { init, open, close, toggle };
})();

window.FumocaFourDCapture = FourDCapture;
export default FourDCapture;
