/**
 * vidp-recorder-ui.js — VIDP Recording UI Panel
 * ═══════════════════════════════════════════════════════════════════════════
 * Adds a "Record Video Preview" button to the viewer that:
 *   1. Records an orbital fly-around via VidpEncoder
 *   2. Shows live progress with cancel option
 *   3. Previews the recorded video before saving
 *   4. Embeds the VIDP section into the current .fumoc file
 *   5. Opens HotspotVideoEditor to add time-synced hotspots
 *   6. Provides download of the updated .fumoc with VIDP + HOTS
 *   7. Also exports a standalone MP4 for WhatsApp/social sharing
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { VidpEncoder }      from './vidp-encoder.js';
import HotspotVideoEditor   from './hotspot-video-editor.js';

const VidpRecorderUI = (() => {

  let _panel        = null;
  let _recording    = false;
  let _lastVidpBytes= null;
  let _lastBlobUrl  = null;
  let _previewEl    = null;

  // ── CSS ───────────────────────────────────────────────────────────────────
  function _injectCSS() {
    if (document.getElementById('vidp-rec-css')) return;
    const style = document.createElement('style');
    style.id = 'vidp-rec-css';
    style.textContent = `
      #vidp-rec-btn {
        position:fixed; bottom:80px; right:16px; z-index:120;
        background:rgba(5,7,11,.88); border:1px solid rgba(200,255,0,.35);
        border-radius:12px; color:#c8ff00; font-size:12px; font-weight:700;
        padding:10px 14px; cursor:pointer; font-family:system-ui,sans-serif;
        display:flex; align-items:center; gap:7px; backdrop-filter:blur(8px);
        transition:all .2s; letter-spacing:.04em;
      }
      #vidp-rec-btn:hover { background:rgba(200,255,0,.12); border-color:#c8ff00; }
      #vidp-rec-btn .rec-dot {
        width:8px; height:8px; background:#ff4040; border-radius:50%;
      }
      #vidp-rec-btn.recording { border-color:#ff4040; color:#ff9090; }
      #vidp-rec-btn.recording .rec-dot { animation: recPulse .8s ease-in-out infinite; }
      @keyframes recPulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.4;transform:scale(.7)} }

      #vidp-panel {
        position:fixed; bottom:140px; right:16px; z-index:125;
        width:320px; background:#0c0f16;
        border:1px solid rgba(255,255,255,.1); border-radius:16px;
        box-shadow:0 24px 60px rgba(0,0,0,.5); padding:20px;
        font-family:system-ui,sans-serif; display:none;
      }
      #vidp-panel.open { display:block; }
      #vidp-panel h3 { font-size:14px; font-weight:700; color:#fff; margin-bottom:4px; }
      #vidp-panel p  { font-size:12px; color:rgba(255,255,255,.4); margin-bottom:16px; line-height:1.5; }
      .vidp-field { margin-bottom:12px; }
      .vidp-field label { display:block; font-size:11px; font-weight:700; letter-spacing:.08em;
        text-transform:uppercase; color:rgba(255,255,255,.4); margin-bottom:5px; }
      .vidp-field select, .vidp-field input[type=range] {
        width:100%; background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.1);
        border-radius:8px; padding:8px 12px; color:#fff; font-size:13px; outline:none;
        appearance:none; cursor:pointer;
      }
      .vidp-field input[type=range] { padding:4px 0; accent-color:#c8ff00; }
      .vidp-field select option { background:#111; }
      .vidp-prog-wrap { margin-bottom:14px; display:none; }
      .vidp-prog-label { font-size:12px; color:rgba(255,255,255,.5); margin-bottom:6px; }
      .vidp-prog-bar { height:4px; background:rgba(255,255,255,.08); border-radius:99px; overflow:hidden; }
      .vidp-prog-fill { height:100%; width:0%; background:#c8ff00; border-radius:99px; transition:width .3s; }
      .vidp-preview-wrap { margin-bottom:14px; display:none; }
      .vidp-preview-wrap video { width:100%; border-radius:10px; max-height:200px; object-fit:contain; background:#000; }
      .vidp-actions { display:flex; flex-direction:column; gap:8px; }
      .vidp-btn {
        padding:9px 14px; border-radius:10px; font-size:13px; font-weight:700;
        cursor:pointer; border:none; transition:opacity .2s; text-align:center;
        font-family:system-ui,sans-serif;
      }
      .vidp-btn:hover { opacity:.85; }
      .vidp-btn-primary { background:#c8ff00; color:#05070b; }
      .vidp-btn-outline { background:transparent; border:1px solid rgba(255,255,255,.15); color:rgba(255,255,255,.7); }
      .vidp-btn-danger  { background:rgba(255,60,60,.15); border:1px solid rgba(255,60,60,.3); color:#ff9090; }
      .vidp-size-info { font-size:11px; color:rgba(200,255,0,.6); margin-top:6px; text-align:center; }
    `;
    document.head.appendChild(style);
  }

  // ── Build the toggle button ────────────────────────────────────────────────
  function _buildButton() {
    if (document.getElementById('vidp-rec-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'vidp-rec-btn';
    btn.innerHTML = '<div class="rec-dot"></div> Record Video Preview';
    btn.addEventListener('click', _togglePanel);
    document.body.appendChild(btn);
  }

  // ── Build the settings panel ──────────────────────────────────────────────
  function _buildPanel() {
    if (document.getElementById('vidp-panel')) return;
    const panel = document.createElement('div');
    panel.id = 'vidp-panel';
    panel.innerHTML = `
      <h3>🎬 Record Video Preview</h3>
      <p>Records a smooth orbital fly-around and embeds it into your .fumoc file so it plays as a video on WhatsApp and iMessage.</p>

      <div class="vidp-field">
        <label>Duration</label>
        <select id="vidp-duration">
          <option value="4">4 seconds</option>
          <option value="6" selected>6 seconds</option>
          <option value="8">8 seconds</option>
          <option value="12">12 seconds</option>
        </select>
      </div>
      <div class="vidp-field">
        <label>Quality</label>
        <select id="vidp-quality">
          <option value="low">Low — faster, smaller file</option>
          <option value="medium" selected>Medium — recommended</option>
          <option value="high">High — best quality</option>
        </select>
      </div>
      <div class="vidp-field">
        <label>Sweep angle — <span id="vidp-sweep-label">324°</span></label>
        <input type="range" id="vidp-sweep" min="90" max="360" step="18" value="324">
      </div>

      <div class="vidp-prog-wrap" id="vidp-prog-wrap">
        <div class="vidp-prog-label" id="vidp-prog-label">Preparing…</div>
        <div class="vidp-prog-bar"><div class="vidp-prog-fill" id="vidp-prog-fill"></div></div>
      </div>

      <div class="vidp-preview-wrap" id="vidp-preview-wrap">
        <video id="vidp-preview-video" muted loop playsinline autoplay></video>
        <div class="vidp-size-info" id="vidp-size-info"></div>
      </div>

      <div class="vidp-actions" id="vidp-actions">
        <button class="vidp-btn vidp-btn-primary" id="vidp-start-btn">⏺ Start recording</button>
        <button class="vidp-btn vidp-btn-outline" id="vidp-hotspot-btn" style="display:none">🎯 Add video hotspots</button>
        <button class="vidp-btn vidp-btn-outline" id="vidp-embed-btn" style="display:none">💾 Save to .fumoc</button>
        <button class="vidp-btn vidp-btn-outline" id="vidp-mp4-btn" style="display:none">⬇ Export for WhatsApp (WebM)</button>
        <button class="vidp-btn vidp-btn-danger"  id="vidp-cancel-btn" style="display:none">✕ Cancel recording</button>
      </div>
    `;
    document.body.appendChild(panel);
    _panel = panel;

    // Sweep angle label
    panel.querySelector('#vidp-sweep').addEventListener('input', e => {
      panel.querySelector('#vidp-sweep-label').textContent = e.target.value + '°';
    });

    // Start
    panel.querySelector('#vidp-start-btn').addEventListener('click', _startRecording);

    // Cancel
    panel.querySelector('#vidp-cancel-btn').addEventListener('click', _cancelRecording);

    // Hotspot editor
    panel.querySelector('#vidp-hotspot-btn').addEventListener('click', _openHotspotEditor);

    // Embed
    panel.querySelector('#vidp-embed-btn').addEventListener('click', _embedAndDownload);

    // Export WebM
    panel.querySelector('#vidp-mp4-btn').addEventListener('click', _exportWebM);
  }

  // ── Toggle panel ──────────────────────────────────────────────────────────
  function _togglePanel() {
    const panel = document.getElementById('vidp-panel');
    if (!panel) { _buildPanel(); _togglePanel(); return; }
    panel.classList.toggle('open');
  }

  // ── Start recording ────────────────────────────────────────────────────────
  async function _startRecording() {
    const cap = VidpEncoder.isSupported();
    if (!cap.ok) { alert('Recording not supported: ' + cap.reason); return; }

    const panel    = _panel;
    const duration = parseInt(panel.querySelector('#vidp-duration').value);
    const quality  = panel.querySelector('#vidp-quality').value;
    const sweepDeg = parseInt(panel.querySelector('#vidp-sweep').value);
    const sweepRad = sweepDeg * Math.PI / 180;

    _recording = true;
    document.getElementById('vidp-rec-btn').classList.add('recording');
    document.getElementById('vidp-rec-btn').innerHTML = '<div class="rec-dot"></div> Recording…';

    panel.querySelector('#vidp-start-btn').style.display  = 'none';
    panel.querySelector('#vidp-cancel-btn').style.display = 'block';
    panel.querySelector('#vidp-prog-wrap').style.display  = 'block';
    panel.querySelector('#vidp-preview-wrap').style.display = 'none';
    ['#vidp-hotspot-btn','#vidp-embed-btn','#vidp-mp4-btn'].forEach(s => panel.querySelector(s).style.display='none');

    try {
      const result = await VidpEncoder.record({
        duration,
        quality,
        sweepAngle: sweepRad,
        onProgress: (pct, label) => {
          panel.querySelector('#vidp-prog-fill').style.width = pct + '%';
          panel.querySelector('#vidp-prog-label').textContent = label;
        },
      });

      _lastVidpBytes = result.vidpBytes;
      _lastBlobUrl   = result.blobUrl;

      // Show preview
      const previewWrap = panel.querySelector('#vidp-preview-wrap');
      const previewVid  = panel.querySelector('#vidp-preview-video');
      previewVid.src    = result.blobUrl;
      previewWrap.style.display = 'block';

      const mb = (result.stats.bytes / 1048576).toFixed(2);
      panel.querySelector('#vidp-size-info').textContent = `Video: ${mb} MB · ${result.stats.mime.split(';')[0]}`;

      // Show action buttons
      panel.querySelector('#vidp-hotspot-btn').style.display = 'block';
      panel.querySelector('#vidp-embed-btn').style.display   = 'block';
      panel.querySelector('#vidp-mp4-btn').style.display     = 'block';
      panel.querySelector('#vidp-cancel-btn').style.display  = 'none';
      panel.querySelector('#vidp-start-btn').style.display   = 'block';
      panel.querySelector('#vidp-start-btn').textContent     = '⏺ Re-record';
      panel.querySelector('#vidp-prog-wrap').style.display   = 'none';

    } catch (err) {
      console.error('[VidpRecorder]', err);
      alert('Recording failed: ' + err.message);
      _resetUI();
    }

    _recording = false;
    document.getElementById('vidp-rec-btn').classList.remove('recording');
    document.getElementById('vidp-rec-btn').innerHTML = '<div class="rec-dot"></div> Record Video Preview';
  }

  function _cancelRecording() {
    // MediaRecorder cancel is handled by letting the RAF loop end naturally
    // or by the user closing — for now just reset UI
    _recording = false;
    _resetUI();
  }

  function _resetUI() {
    const panel = _panel;
    if (!panel) return;
    panel.querySelector('#vidp-start-btn').style.display   = 'block';
    panel.querySelector('#vidp-start-btn').textContent     = '⏺ Start recording';
    panel.querySelector('#vidp-cancel-btn').style.display  = 'none';
    panel.querySelector('#vidp-prog-wrap').style.display   = 'none';
    document.getElementById('vidp-rec-btn').classList.remove('recording');
    document.getElementById('vidp-rec-btn').innerHTML = '<div class="rec-dot"></div> Record Video Preview';
  }

  // ── Open hotspot editor ────────────────────────────────────────────────────
  function _openHotspotEditor() {
    const duration = parseInt(_panel.querySelector('#vidp-duration').value) || 6;
    const existing = window._fumocaHotspots || [];
    HotspotVideoEditor.open({
      hotspots:     existing,
      videoDuration:duration,
      onSave: (hotspots) => {
        window._fumocaHotspots = hotspots;
        window.dispatchEvent(new CustomEvent('fumoca:hotspotsUpdated', { detail: { hotspots } }));
        console.log(`[VidpRecorder] Saved ${hotspots.length} hotspots`);
      },
    });
  }

  // ── Embed VIDP into .fumoc and download ───────────────────────────────────
  async function _embedAndDownload() {
    if (!_lastVidpBytes) { alert('No recording yet. Record first.'); return; }

    const btn = _panel.querySelector('#vidp-embed-btn');
    btn.textContent = 'Embedding…'; btn.disabled = true;

    try {
      // Get the current .fumoc buffer from the viewer
      const fumocBuffer = window._fumocaRawBuffer || await _fetchCurrentFumoc();
      if (!fumocBuffer) {
        alert('Could not find current .fumoc file. Make sure a scene is loaded.');
        btn.textContent = '💾 Save to .fumoc'; btn.disabled = false;
        return;
      }

      // Embed VIDP section
      const updatedBuffer = await VidpEncoder.embedInFumoc(fumocBuffer, _lastVidpBytes);

      // Also embed updated hotspots if any
      let finalBuffer = updatedBuffer;
      if (window._fumocaHotspots?.length > 0) {
        finalBuffer = await _embedHotspots(updatedBuffer, window._fumocaHotspots);
      }

      // Download
      const blob     = new Blob([finalBuffer], { type:'application/fumoc' });
      const url      = URL.createObjectURL(blob);
      const sizeMB   = (finalBuffer.byteLength / 1048576).toFixed(2);
      const title    = document.title.replace(' — FUMOCA','').replace(/[^a-z0-9]/gi,'_') || 'scene';
      const a        = document.createElement('a');
      a.href         = url;
      a.download     = `${title}_with_video.fumoc`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);

      btn.textContent = `✓ Downloaded (${sizeMB} MB)`;
      setTimeout(() => { btn.textContent = '💾 Save to .fumoc'; btn.disabled = false; }, 3000);

    } catch (err) {
      console.error('[VidpRecorder] embed failed:', err);
      alert('Embed failed: ' + err.message);
      btn.textContent = '💾 Save to .fumoc'; btn.disabled = false;
    }
  }

  // ── Export standalone WebM for WhatsApp ───────────────────────────────────
  function _exportWebM() {
    if (!_lastBlobUrl) { alert('No recording yet.'); return; }
    const a      = document.createElement('a');
    a.href       = _lastBlobUrl;
    a.download   = 'fumoc-preview.webm';
    a.click();
  }

  // ── Embed hotspots into .fumoc buffer ─────────────────────────────────────
  async function _embedHotspots(buffer, hotspots) {
    const bytes = new Uint8Array(buffer);
    const dv    = new DataView(buffer);
    const headerLen = dv.getUint32(10, true);
    // Collect all sections except HOTS
    const keep  = [];
    let off = 14 + headerLen;
    while (off + 13 <= bytes.length) {
      const id      = new TextDecoder().decode(bytes.slice(off, off+4));
      const compLen = dv.getUint32(off+5, true);
      if (id !== 'HOTS') keep.push(bytes.slice(off, off+13+compLen));
      off += 13 + compLen;
    }
    // Build new HOTS section (deflate compressed)
    const hotsJson  = new TextEncoder().encode(JSON.stringify(hotspots));
    const cs = new CompressionStream('deflate');
    const w  = cs.writable.getWriter(); w.write(hotsJson); w.close();
    const chunks = []; const r = cs.readable.getReader();
    for(;;){const{done,value}=await r.read();if(done)break;chunks.push(value);}
    const comp     = _concat(chunks);
    const hotsSec  = _concat([
      new TextEncoder().encode('HOTS'),
      new Uint8Array([0x01]), // deflate flag
      _u32le(comp.length), _u32le(hotsJson.length),
      comp,
    ]);
    const header = bytes.slice(0, 14 + headerLen);
    return _concat([header, ..._keep(keep), hotsSec]).buffer;
  }

  function _keep(sections) { return sections; }

  async function _fetchCurrentFumoc() {
    // Try session storage blob URL
    const url = sessionStorage.getItem('fumoc_pending_splat_url');
    if (!url) return null;
    const r = await fetch(url);
    return r.ok ? r.arrayBuffer() : null;
  }

  function _concat(arrays) {
    const total = arrays.reduce((s,a)=>s+a.length,0);
    const out = new Uint8Array(total); let off=0;
    for(const a of arrays){out.set(a,off);off+=a.length;} return out;
  }

  function _u32le(n) {
    const b=new Uint8Array(4); new DataView(b.buffer).setUint32(0,n>>>0,true); return b;
  }

  // ── Mount ─────────────────────────────────────────────────────────────────
  function mount() {
    _injectCSS();
    _buildButton();
    _buildPanel();

    // Show/hide based on viewer ready
    window.addEventListener('fumoca:viewerReady', () => {
      document.getElementById('vidp-rec-btn').style.display = 'flex';
    });
  }

  return { mount };

})();

// Auto-mount when viewer is ready
window.addEventListener('fumoca:viewerReady', () => VidpRecorderUI.mount(), { once: true });

export default VidpRecorderUI;
