/**
 * FUMOCA 4D Capture UI
 * Orchestrates: video upload → motion analysis → subject isolation → pipeline dispatch
 * Works for both single-phone and multi-camera capture.
 * Handles slow/fast motion, people and vehicles.
 */

import MA from './motion-analyzer.js';
import SI from './subject-isolator.js';
import MS from './motion-states.js';
import MT from './motion-tracking.js';

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
      <button id="fourDRunIsolation" class="fourDPrimaryBtn" style="display:none">Isolate subject + dispatch to pipeline</button>
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
      <div class="fourDNote">Each phone captures the subject simultaneously from a different angle. Upload all videos here — frames are merged before reconstruction for full-360 coverage.</div>
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
      <label class="fourDCheckRow"><input type="checkbox" id="fourDIsolateSubject" checked> Subject isolation (recommended)</label>
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

  // ─── Isolation + dispatch ──────────────────────────────────────────────────
  async function _runIsolationAndDispatch() {
    const runBtn = document.getElementById('fourDRunIsolation');
    const trackBtn = document.getElementById('fourDRunTracking');
    const file = runBtn._file;
    const result = runBtn._result;
    if (!file || !result) return;

    const doIsolate = document.getElementById('fourDIsolateSubject')?.checked ?? true;
    const subjectType = SI.detectSubjectType(_record);
    const pipelineData = MA.exportForPipeline(result);

    runBtn.disabled = true;
    runBtn.textContent = 'Processing…';

    for (const job of pipelineData.jobs) {
      _addJob(job.jobId, job.label, 'pending');
      try {
        let frames = job.frameTimes;
        if (doIsolate) {
          _updateJobStatus(job.jobId, 'running', 'Isolating subject…');
          const isolated = await SI.isolateFrameBatch(file, frames, subjectType, p => {
            _updateJobStatus(job.jobId, 'running', `Isolating ${Math.round(p*100)}%`);
          });
          frames = isolated.map(f => f.time); // times preserved; blobs sent to pipeline
        }
        _updateJobStatus(job.jobId, 'running', 'Queuing reconstruction…');
        await _dispatchToPipeline(job, file, frames);
        _updateJobStatus(job.jobId, 'done', 'Queued');
        _sessionJobs.push({ ...job, status: 'queued' });
      } catch (e) {
        _updateJobStatus(job.jobId, 'failed', e.message);
      }
    }

    runBtn.disabled = false;
    runBtn.textContent = 'Done — check Pipeline tab';
    _switchTab('pipeline');
  }

  async function _dispatchToPipeline(job, videoFile, frameTimes) {
    const payload = {
      job_id: job.jobId,
      label: job.label,
      motion_class: job.motionClass,
      colmap_mode: job.colmapMode,
      frame_times: frameTimes,
      subject_isolation: job.subjectIsolation,
      record_id: _record?.id || null,
      source: 'fourd_capture'
    };
    if (window._fumocaQueuePipeline) {
      await window._fumocaQueuePipeline('fourd_reconstruction', payload);
    } else {
      console.log('[4D Capture] Pipeline dispatch:', payload);
    }
    window.dispatchEvent(new CustomEvent('fumoca:fourDJobQueued', { detail: payload }));
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
        <span style="flex:1;color:${c.file ? '#c8ff00' : 'rgba(255,255,255,.5)'}">${c.file ? c.file.name : 'No file'}</span>
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
    const streams = _camSlots.filter(c => c.file).map((c, i) => ({ cameraId: i, file: c.file, frames: [] }));
    if (streams.length < 2) return;
    document.getElementById('fourDMergeAndDispatch').textContent = 'Merging…';
    window.dispatchEvent(new CustomEvent('fumoca:multiCamDispatch', { detail: { cameras: streams.length } }));
    document.getElementById('fourDMergeAndDispatch').textContent = 'Dispatched — check Pipeline tab';
    _switchTab('pipeline');
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
        <span style="flex:1">${j.label}</span>
        <span style="color:rgba(255,255,255,.35);font-size:11px">${j.statusText || j.status}</span>
      </div>`).join('');
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
