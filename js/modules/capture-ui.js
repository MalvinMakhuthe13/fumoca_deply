/**
 * FUMOCA Capture UI
 * Floats a recording panel over the viewer.
 * Owner/admin only for recording. Anyone can view the resulting preview.
 */

import SplatCapture from './splat-capture.js';

const CaptureUI = (() => {
  let panel = null;
  let progressEl = null;
  let statusEl = null;
  let recordBtn = null;
  let previewWrap = null;
  let videoEl = null;
  let captureBtn = null;
  let shareBtn = null;
  let uploadBtn = null;
  let downloadBtn = null;
  let durationSelect = null;
  let fpsSelect = null;
  let isOwner = false;

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  function buildPanel() {
    if (panel) return;
    panel = document.createElement('div');
    panel.id = 'fumocaCapturePanel';
    panel.setAttribute('aria-label', 'FUMOCA Capture Controls');
    panel.innerHTML = `
      <div class="cap-head">
        <div>
          <div class="cap-title">CAPTURE</div>
          <div class="cap-sub">Record the splat resolving to solid</div>
        </div>
        <button class="ghostBtn" id="capCloseBtn" aria-label="Close">✕</button>
      </div>

      <div class="cap-body">
        <div class="cap-preview" id="capPreviewWrap" style="display:none;">
          <video id="capVideoEl" controls playsinline loop style="width:100%;border-radius:12px;background:#000;display:block;max-height:220px;"></video>
        </div>

        <div class="cap-progress" id="capProgress" style="display:none;">
          <div class="cap-progress-bar" id="capProgressBar" style="width:0%"></div>
        </div>
        <div class="cap-status" id="capStatus">Ready to record</div>

        <div class="cap-options" id="capOptions">
          <div class="cap-option-row">
            <label class="cap-label">Duration</label>
            <select id="capDuration" class="cap-select">
              <option value="4000">4 seconds</option>
              <option value="6000" selected>6 seconds</option>
              <option value="8000">8 seconds</option>
              <option value="12000">12 seconds</option>
            </select>
          </div>
          <div class="cap-option-row">
            <label class="cap-label">Quality</label>
            <select id="capFps" class="cap-select">
              <option value="24">24fps — small file</option>
              <option value="30" selected>30fps — balanced</option>
              <option value="60">60fps — cinematic</option>
            </select>
          </div>
        </div>

        <div class="cap-actions">
          <button class="cap-btn cap-btn-record" id="capRecordBtn" title="Start recording the live viewer">
            <span class="cap-rec-dot"></span>
            Record
          </button>
          <button class="cap-btn cap-btn-snap" id="capCaptureBtn" title="Capture still frame">
            📷
          </button>
        </div>

        <div class="cap-post-actions" id="capPostActions" style="display:none;">
          <button class="cap-btn cap-btn-share" id="capShareBtn">Share preview</button>
          <button class="cap-btn cap-btn-upload" id="capUploadBtn">Save to cloud</button>
          <button class="cap-btn cap-btn-download" id="capDownloadBtn">Download</button>
        </div>

        <div class="cap-note">
          Records the live viewer canvas as the splat transitions from particle cloud to sharp solid. Use as a hook video or teaser preview — no post-processing needed.
        </div>
      </div>
    `;

    // Inject styles
    if (!document.getElementById('fumocaCaptureCss')) {
      const style = document.createElement('style');
      style.id = 'fumocaCaptureCss';
      style.textContent = `
        #fumocaCapturePanel {
          position: fixed;
          bottom: 88px;
          left: 16px;
          z-index: 13;
          width: min(340px, calc(100vw - 32px));
          background: rgba(7,10,16,.9);
          border: 1px solid rgba(200,255,0,.18);
          border-radius: 22px;
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          box-shadow: 0 18px 60px rgba(0,0,0,.5);
          overflow: hidden;
          display: none;
        }
        #fumocaCapturePanel.open { display: block; }
        .cap-head {
          display: flex; justify-content: space-between; align-items: flex-start;
          gap: 12px; padding: 14px 16px 10px;
          border-bottom: 1px solid rgba(255,255,255,.07);
        }
        .cap-title {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 22px; color: #c8ff00; letter-spacing: .06em; line-height:1;
        }
        .cap-sub { font-size: 10px; color: rgba(255,255,255,.45); margin-top: 3px; }
        .cap-body { padding: 12px 16px 16px; display: grid; gap: 10px; }
        .cap-progress {
          height: 3px; background: rgba(255,255,255,.07); border-radius: 999px; overflow: hidden;
        }
        .cap-progress-bar {
          height: 100%; background: #c8ff00;
          transition: width .3s linear;
          border-radius: 999px;
          box-shadow: 0 0 8px rgba(200,255,0,.6);
        }
        .cap-status {
          font-size: 11px; color: rgba(255,255,255,.45);
          font-family: 'Space Mono', monospace; letter-spacing: .06em;
        }
        .cap-options { display: grid; gap: 8px; }
        .cap-option-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
        .cap-label { font-size: 11px; color: rgba(255,255,255,.55); font-weight: 700; text-transform: uppercase; letter-spacing:.06em; flex-shrink:0; }
        .cap-select {
          background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1);
          color: #fff; border-radius: 9px; padding: 7px 10px; font-size: 12px;
          flex: 1; min-width: 0;
        }
        .cap-actions { display: flex; gap: 8px; }
        .cap-btn {
          border-radius: 12px; padding: 11px 14px; border: 1px solid rgba(255,255,255,.12);
          background: rgba(255,255,255,.06); color: #fff;
          font-family: 'DM Sans', sans-serif; font-size: 12px; font-weight: 700;
          cursor: pointer; transition: all .15s; display: flex; align-items: center; gap: 7px;
          flex: 1; justify-content: center;
        }
        .cap-btn-record {
          background: rgba(255,72,72,.12); color: #ff6060;
          border-color: rgba(255,72,72,.3);
        }
        .cap-btn-record:hover { background: rgba(255,72,72,.22); }
        .cap-btn-record.recording {
          background: rgba(255,72,72,.25); color: #ff4040;
          border-color: rgba(255,72,72,.6);
          animation: capPulse 1s ease-in-out infinite;
        }
        @keyframes capPulse { 0%,100% { box-shadow: 0 0 0 0 rgba(255,72,72,.3); } 50% { box-shadow: 0 0 0 6px rgba(255,72,72,.0); } }
        .cap-rec-dot {
          width: 8px; height: 8px; border-radius: 50%; background: currentColor;
          flex-shrink: 0;
        }
        .cap-btn-snap { flex: 0 0 auto; padding: 11px 13px; font-size: 16px; }
        .cap-post-actions { display: grid; gap: 7px; }
        .cap-btn-share { background: rgba(200,255,0,.1); color: #c8ff00; border-color: rgba(200,255,0,.25); }
        .cap-btn-share:hover { background: rgba(200,255,0,.2); }
        .cap-btn-upload { background: rgba(0,255,200,.08); color: #00ffc8; border-color: rgba(0,255,200,.22); }
        .cap-btn-upload:hover { background: rgba(0,255,200,.15); }
        .cap-btn-download { background: rgba(255,255,255,.05); color: #fff; border-color: rgba(255,255,255,.1); }
        .cap-btn-download:hover { background: rgba(255,255,255,.1); }
        .cap-note {
          font-size: 10px; color: rgba(255,255,255,.32); line-height: 1.55;
          font-family: 'Space Mono', monospace;
        }
        #capCaptureToggleBtn {
          position: fixed; bottom: 24px; left: 84px; z-index: 12;
          background: rgba(7,10,16,.85); border: 1px solid rgba(200,255,0,.22);
          color: #c8ff00; border-radius: 14px; padding: 9px 14px;
          font-family: 'DM Sans', sans-serif; font-size: 12px; font-weight: 700;
          cursor: pointer; backdrop-filter: blur(14px);
          display: none;
          transition: all .15s;
        }
        #capCaptureToggleBtn.visible { display: block; }
        #capCaptureToggleBtn:hover { background: rgba(200,255,0,.12); }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(panel);

    // Get references
    progressEl = panel.querySelector('#capProgressBar');
    statusEl = panel.querySelector('#capStatus');
    recordBtn = panel.querySelector('#capRecordBtn');
    previewWrap = panel.querySelector('#capPreviewWrap');
    videoEl = panel.querySelector('#capVideoEl');
    captureBtn = panel.querySelector('#capCaptureBtn');
    shareBtn = panel.querySelector('#capShareBtn');
    uploadBtn = panel.querySelector('#capUploadBtn');
    downloadBtn = panel.querySelector('#capDownloadBtn');
    durationSelect = panel.querySelector('#capDuration');
    fpsSelect = panel.querySelector('#capFps');

    panel.querySelector('#capCloseBtn')?.addEventListener('click', close);

    recordBtn?.addEventListener('click', toggleRecord);
    captureBtn?.addEventListener('click', doSnapshot);
    shareBtn?.addEventListener('click', doShare);
    uploadBtn?.addEventListener('click', doUpload);
    downloadBtn?.addEventListener('click', doDownload);

    // Wire capture events
    window.addEventListener('fumoca:captureStarted', () => {
      setStatus('Recording…');
      recordBtn?.classList.add('recording');
      if (recordBtn) recordBtn.innerHTML = `<span class="cap-rec-dot"></span> Stop`;
      progressEl && (progressEl.style.width = '0%');
      panel.querySelector('#capProgress').style.display = 'block';
      panel.querySelector('#capPostActions').style.display = 'none';
      previewWrap.style.display = 'none';
    });

    window.addEventListener('fumoca:captureProgress', (e) => {
      const { percent, elapsed } = e.detail;
      if (progressEl) progressEl.style.width = `${percent}%`;
      setStatus(`Recording… ${Math.round(elapsed / 1000)}s`);
    });

    window.addEventListener('fumoca:captureReady', (e) => {
      const { videoUrl, thumbnailUrl } = e.detail;
      recordBtn?.classList.remove('recording');
      if (recordBtn) recordBtn.innerHTML = `<span class="cap-rec-dot"></span> Record`;
      if (progressEl) progressEl.style.width = '100%';
      setStatus('Capture complete ✓');
      panel.querySelector('#capProgress').style.display = 'none';

      if (videoUrl && videoEl) {
        videoEl.src = videoUrl;
        previewWrap.style.display = 'block';
        videoEl.play().catch(() => {});
      }
      panel.querySelector('#capPostActions').style.display = 'grid';
    });

    window.addEventListener('fumoca:captureError', (e) => {
      setStatus(`Error: ${e.detail?.error || 'unknown'}`);
      recordBtn?.classList.remove('recording');
      if (recordBtn) recordBtn.innerHTML = `<span class="cap-rec-dot"></span> Record`;
    });

    window.addEventListener('fumoca:captureUploaded', (e) => {
      setStatus('Saved to cloud ✓');
      if (uploadBtn) { uploadBtn.textContent = 'Saved ✓'; setTimeout(() => { uploadBtn.textContent = 'Save to cloud'; }, 2000); }
    });
  }

  function setStatus(msg) {
    if (statusEl) statusEl.textContent = msg;
  }

  async function toggleRecord() {
    if (SplatCapture.isRecording) {
      SplatCapture.stop();
      return;
    }
    const duration = Number(durationSelect?.value || 6000);
    const fps = Number(fpsSelect?.value || 30);
    try {
      await SplatCapture.start({ duration, fps });
    } catch (err) {
      setStatus(`Failed: ${err?.message || 'check browser support'}`);
    }
  }

  function doSnapshot() {
    const dataUrl = SplatCapture.capture();
    if (dataUrl) {
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `fumoca-snapshot-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setStatus('Snapshot saved');
    } else {
      setStatus('Snapshot failed — try again');
    }
  }

  async function doShare() {
    const last = SplatCapture.lastCapture;
    if (!last) return;
    try {
      if (navigator.share && navigator.canShare?.({ files: [new File([last.videoBlob], 'fumoca.webm', { type: last.mimeType })] })) {
        await navigator.share({
          title: window._fumocaCurrentRecord?.title || 'FUMOCA Splat',
          text: 'Check out this 3D Gaussian Splat capture',
          files: [new File([last.videoBlob], 'fumoca.webm', { type: last.mimeType })],
        });
      } else {
        // Fallback: share the viewer link
        const url = window.location.href;
        await navigator.clipboard.writeText(url);
        setStatus('Link copied to clipboard');
      }
    } catch (_) {
      setStatus('Share failed');
    }
  }

  async function doUpload() {
    if (!isOwner) return;
    setStatus('Uploading…');
    if (uploadBtn) { uploadBtn.textContent = 'Uploading…'; uploadBtn.disabled = true; }
    const url = await SplatCapture.uploadToSupabase('preview-videos', window._fumocaCurrentRecord?.id);
    if (uploadBtn) { uploadBtn.disabled = false; uploadBtn.textContent = 'Save to cloud'; }
    if (url) setStatus('Saved ✓');
    else setStatus('Upload failed');
  }

  function doDownload() {
    const done = SplatCapture.downloadLastVideo(`fumoca-${Date.now()}.webm`);
    if (done) setStatus('Downloading…');
    else setStatus('Nothing to download yet');
  }

  function open() {
    buildPanel();
    panel.classList.add('open');
  }

  function close() {
    panel?.classList.remove('open');
  }

  function toggle() {
    if (!panel) { open(); return; }
    panel.classList.toggle('open');
  }

  function setOwnerAccess(canOwn) {
    isOwner = !!canOwn;
    if (uploadBtn) uploadBtn.style.display = isOwner ? '' : 'none';
    if (panel?.querySelector('#capOptions')) {
      panel.querySelector('#capOptions').style.display = isOwner ? 'grid' : 'none';
    }
    if (recordBtn) recordBtn.style.display = isOwner ? '' : 'none';
    if (captureBtn) captureBtn.style.display = isOwner ? '' : 'none';
    if (!isOwner) setStatus('View only — sign in to record');
  }

  // Floating toggle button
  function mountToggleButton() {
    if (document.getElementById('capCaptureToggleBtn')) return;
    const btn = document.createElement('button');
    btn.id = 'capCaptureToggleBtn';
    btn.innerHTML = '⏺ Capture';
    btn.addEventListener('click', toggle);
    document.body.appendChild(btn);

    window.addEventListener('fumoca:permissionsReady', (e) => {
      const can = !!e.detail?.canManage;
      btn.classList.toggle('visible', can);
      setOwnerAccess(can);
    });
    window.addEventListener('fumoca:permissionsUpdated', (e) => {
      const can = !!e.detail?.canManage;
      btn.classList.toggle('visible', can);
      setOwnerAccess(can);
    });
    // Check current permissions
    const perms = window._fumocaPermissions;
    if (perms?.canManage) { btn.classList.add('visible'); setOwnerAccess(true); }
  }

  function init() {
    mountToggleButton();
    // Pre-build the panel DOM silently
    buildPanel();
    // Listen for autoCaptureRequest
    window.addEventListener('fumoca:autoCaptureRequest', (e) => {
      SplatCapture.start(e.detail || {}).catch(() => {});
    });
  }

  return { open, close, toggle, init, setOwnerAccess };
})();

window._fumocaCaptureUI = CaptureUI;
CaptureUI.init();
export default CaptureUI;
