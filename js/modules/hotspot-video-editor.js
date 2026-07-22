/**
 * hotspot-video-editor.js — Time-synced Hotspot Editor for Video Mode
 * ═══════════════════════════════════════════════════════════════════════════
 * A full editor that lets creators:
 *   1. Place hotspots on the 3D scene by clicking in the viewer
 *   2. Assign each hotspot a video timestamp (when it appears during playback)
 *   3. Set screen position (where it appears on the video frame)
 *   4. Add label, description, link, type
 *   5. Preview the time-synced hotspot on a video scrubber
 *   6. Save everything into the .fumoc HOTS section
 *
 * The editor integrates with the existing hotspot-pro.js system —
 * it adds the video-time fields on top of the existing hotspot schema.
 *
 * Usage:
 *   import HotspotVideoEditor from './hotspot-video-editor.js';
 *   HotspotVideoEditor.open({ hotspots: [...], onSave: (hotspots) => {} });
 * ═══════════════════════════════════════════════════════════════════════════
 */

const HotspotVideoEditor = (() => {

  let _state = {
    open:       false,
    hotspots:   [],
    editing:    null,   // hotspot being edited
    onSave:     null,
    previewVideo: null,
    scrubberEl: null,
    listEl:     null,
    formEl:     null,
  };

  // ── CSS injection ──────────────────────────────────────────────────────────
  function _injectCSS() {
    if (document.getElementById('hve-css')) return;
    const style = document.createElement('style');
    style.id    = 'hve-css';
    style.textContent = `
      #hve-shell {
        position:fixed; inset:0; z-index:900; display:flex;
        background:rgba(0,0,0,.72); backdrop-filter:blur(4px);
        align-items:center; justify-content:center; padding:16px;
      }
      #hve-panel {
        width:min(900px,100%); max-height:90vh; overflow:hidden;
        background:#0c0f16; border:1px solid rgba(255,255,255,.1);
        border-radius:20px; display:flex; flex-direction:column;
        box-shadow:0 32px 80px rgba(0,0,0,.6);
      }
      #hve-header {
        display:flex; align-items:center; justify-content:space-between;
        padding:16px 20px; border-bottom:1px solid rgba(255,255,255,.08);
        flex-shrink:0;
      }
      #hve-header h2 { font-size:16px; font-weight:700; color:#fff; font-family:system-ui,sans-serif; }
      #hve-header p  { font-size:12px; color:rgba(255,255,255,.4); margin-top:2px; font-family:system-ui,sans-serif; }
      #hve-close {
        background:rgba(255,255,255,.07); border:none; border-radius:8px;
        color:rgba(255,255,255,.6); font-size:18px; width:32px; height:32px;
        cursor:pointer; display:flex; align-items:center; justify-content:center;
      }
      #hve-body {
        display:grid; grid-template-columns:1fr 1fr; flex:1;
        overflow:hidden; min-height:0;
      }
      /* LEFT — hotspot list + scrubber */
      #hve-left {
        border-right:1px solid rgba(255,255,255,.08);
        display:flex; flex-direction:column; overflow:hidden;
      }
      #hve-scrubber-wrap {
        padding:16px; border-bottom:1px solid rgba(255,255,255,.08); flex-shrink:0;
      }
      #hve-scrubber-label { font-size:11px; color:rgba(255,255,255,.4); font-family:system-ui,sans-serif; margin-bottom:8px; }
      #hve-scrubber {
        position:relative; height:40px; background:rgba(255,255,255,.05);
        border-radius:8px; overflow:visible; cursor:pointer;
      }
      #hve-scrubber-track {
        position:absolute; top:50%; left:0; right:0; height:3px;
        background:rgba(255,255,255,.1); border-radius:99px; transform:translateY(-50%);
      }
      #hve-scrubber-head {
        position:absolute; top:50%; width:14px; height:14px;
        background:#c8ff00; border-radius:50%; transform:translate(-50%,-50%);
        cursor:grab; z-index:2; transition:left .1s;
      }
      .hve-hs-pip {
        position:absolute; top:50%; width:10px; height:10px;
        background:rgba(200,255,0,.6); border:2px solid #c8ff00;
        border-radius:50%; transform:translate(-50%,-50%);
        cursor:pointer; z-index:1;
      }
      #hve-hs-list {
        flex:1; overflow-y:auto; padding:12px; display:flex;
        flex-direction:column; gap:8px;
      }
      .hve-hs-item {
        display:flex; align-items:center; gap:10px;
        background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.07);
        border-radius:10px; padding:10px 12px; cursor:pointer;
        transition:all .18s; font-family:system-ui,sans-serif;
      }
      .hve-hs-item:hover, .hve-hs-item.active {
        background:rgba(200,255,0,.08); border-color:rgba(200,255,0,.3);
      }
      .hve-hs-dot { width:10px; height:10px; border-radius:50%; background:#c8ff00; flex-shrink:0; }
      .hve-hs-dot[data-type="link"]  { background:rgba(255,184,0,.9); }
      .hve-hs-dot[data-type="audio"] { background:rgba(0,255,200,.9); }
      .hve-hs-label { font-size:13px; font-weight:600; color:#fff; flex:1; }
      .hve-hs-time  { font-size:11px; color:rgba(255,255,255,.4); font-family:monospace; }
      .hve-hs-del   { background:none; border:none; color:rgba(255,80,80,.6); cursor:pointer; font-size:14px; padding:2px 6px; }
      #hve-add-btn {
        margin:0 12px 12px; padding:10px; background:rgba(200,255,0,.1);
        border:1px dashed rgba(200,255,0,.3); border-radius:10px; color:#c8ff00;
        font-size:13px; font-weight:700; cursor:pointer; font-family:system-ui,sans-serif;
        transition:all .18s;
      }
      #hve-add-btn:hover { background:rgba(200,255,0,.18); }
      /* RIGHT — form */
      #hve-right { display:flex; flex-direction:column; overflow:hidden; }
      #hve-form-wrap {
        flex:1; overflow-y:auto; padding:20px;
        display:flex; flex-direction:column; gap:14px;
      }
      #hve-form-empty {
        display:flex; align-items:center; justify-content:center;
        color:rgba(255,255,255,.25); font-size:13px; font-family:system-ui,sans-serif;
        height:100%; text-align:center; padding:32px;
      }
      .hve-field label {
        display:block; font-size:11px; font-weight:700; letter-spacing:.08em;
        text-transform:uppercase; color:rgba(255,255,255,.4);
        margin-bottom:5px; font-family:system-ui,sans-serif;
      }
      .hve-field input, .hve-field select, .hve-field textarea {
        width:100%; background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.1);
        border-radius:8px; padding:9px 12px; color:#fff; font-size:13px;
        outline:none; transition:border-color .2s; font-family:system-ui,sans-serif;
        resize:vertical;
      }
      .hve-field input:focus,.hve-field select:focus,.hve-field textarea:focus {
        border-color:#c8ff00;
      }
      .hve-field input::placeholder,.hve-field textarea::placeholder { color:rgba(255,255,255,.25); }
      .hve-field select option { background:#111; }
      .hve-row { display:flex; gap:10px; }
      .hve-row .hve-field { flex:1; }
      /* Screen position picker */
      #hve-screen-picker {
        position:relative; width:100%; aspect-ratio:9/16;
        background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.1);
        border-radius:10px; cursor:crosshair; overflow:hidden; max-height:200px;
      }
      #hve-screen-picker-label {
        font-size:11px; color:rgba(255,255,255,.3); font-family:system-ui,sans-serif;
        text-align:center; padding-top:8px;
      }
      #hve-screen-dot {
        position:absolute; width:14px; height:14px; background:#c8ff00;
        border-radius:50%; transform:translate(-50%,-50%);
        pointer-events:none; transition:left .1s, top .1s;
      }
      /* Footer */
      #hve-footer {
        display:flex; gap:10px; justify-content:flex-end;
        padding:14px 20px; border-top:1px solid rgba(255,255,255,.08); flex-shrink:0;
      }
      .hve-btn {
        padding:9px 18px; border-radius:10px; font-size:13px; font-weight:700;
        cursor:pointer; border:none; font-family:system-ui,sans-serif; transition:opacity .2s;
      }
      .hve-btn:hover { opacity:.85; }
      .hve-btn-primary { background:#c8ff00; color:#05070b; }
      .hve-btn-outline { background:transparent; border:1px solid rgba(255,255,255,.15); color:rgba(255,255,255,.7); }
      .hve-btn-save-hs  { background:rgba(200,255,0,.15); color:#c8ff00; border:1px solid rgba(200,255,0,.3); }
      @media(max-width:640px){
        #hve-body { grid-template-columns:1fr; }
        #hve-left { max-height:240px; }
      }
    `;
    document.head.appendChild(style);
  }

  // ── Build editor UI ────────────────────────────────────────────────────────
  function _buildUI(videoDuration) {
    _injectCSS();

    const shell = document.createElement('div');
    shell.id    = 'hve-shell';

    shell.innerHTML = `
      <div id="hve-panel">
        <div id="hve-header">
          <div>
            <h2>🎬 Video Hotspot Editor</h2>
            <p>Place interactive hotspots that appear at specific moments during video playback</p>
          </div>
          <button id="hve-close">✕</button>
        </div>
        <div id="hve-body">
          <!-- LEFT -->
          <div id="hve-left">
            <div id="hve-scrubber-wrap">
              <div id="hve-scrubber-label">Timeline — drag pins to set hotspot timing</div>
              <div id="hve-scrubber">
                <div id="hve-scrubber-track"></div>
                <div id="hve-scrubber-head" style="left:0%"></div>
              </div>
              <div style="display:flex;justify-content:space-between;margin-top:4px;">
                <span style="font-size:10px;color:rgba(255,255,255,.3);font-family:monospace">0:00</span>
                <span id="hve-time-display" style="font-size:11px;color:#c8ff00;font-family:monospace">0.0s</span>
                <span style="font-size:10px;color:rgba(255,255,255,.3);font-family:monospace">${videoDuration.toFixed(1)}s</span>
              </div>
            </div>
            <div id="hve-hs-list"></div>
            <button id="hve-add-btn">+ Add hotspot at current time</button>
          </div>
          <!-- RIGHT -->
          <div id="hve-right">
            <div id="hve-form-wrap">
              <div id="hve-form-empty">Select a hotspot to edit,<br>or add one from the timeline</div>
            </div>
            <div id="hve-footer">
              <button class="hve-btn hve-btn-outline" id="hve-cancel-btn">Cancel</button>
              <button class="hve-btn hve-btn-primary" id="hve-save-btn">Save hotspots to .fumoc</button>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(shell);

    // Wire close
    shell.querySelector('#hve-close').addEventListener('click', close);
    shell.querySelector('#hve-cancel-btn').addEventListener('click', close);
    shell.querySelector('#hve-save-btn').addEventListener('click', _save);

    // Wire scrubber
    const scrubber    = shell.querySelector('#hve-scrubber');
    const scrubHead   = shell.querySelector('#hve-scrubber-head');
    const timeDisplay = shell.querySelector('#hve-time-display');
    let   scrubTime   = 0;

    function setScrubTime(t) {
      scrubTime = Math.max(0, Math.min(videoDuration, t));
      const pct = scrubTime / videoDuration * 100;
      scrubHead.style.left = pct + '%';
      timeDisplay.textContent = scrubTime.toFixed(1) + 's';
    }

    let dragging = false;
    scrubber.addEventListener('mousedown', e => {
      dragging = true;
      const rect = scrubber.getBoundingClientRect();
      setScrubTime(((e.clientX - rect.left) / rect.width) * videoDuration);
    });
    window.addEventListener('mousemove', e => {
      if (!dragging) return;
      const rect = scrubber.getBoundingClientRect();
      setScrubTime(((e.clientX - rect.left) / rect.width) * videoDuration);
    });
    window.addEventListener('mouseup', () => dragging = false);

    // Wire add button
    shell.querySelector('#hve-add-btn').addEventListener('click', () => {
      _addHotspot(scrubTime, videoDuration);
    });

    _state.scrubberEl = scrubber;
    _state.listEl     = shell.querySelector('#hve-hs-list');
    _state.formEl     = shell.querySelector('#hve-form-wrap');

    _renderList(videoDuration);
  }

  // ── Render hotspot list + timeline pips ──────────────────────────────────
  function _renderList(videoDuration) {
    const list    = _state.listEl;
    const scrubber= _state.scrubberEl;
    if (!list || !scrubber) return;

    // Remove old pips
    scrubber.querySelectorAll('.hve-hs-pip').forEach(el => el.remove());
    list.innerHTML = '';

    for (const h of _state.hotspots) {
      // Timeline pip
      if (typeof h.videoTime === 'number') {
        const pip = document.createElement('div');
        pip.className     = 'hve-hs-pip';
        pip.style.left    = (h.videoTime / videoDuration * 100) + '%';
        pip.title         = h.label || h.id;
        pip.addEventListener('click', () => _editHotspot(h, videoDuration));
        scrubber.appendChild(pip);
      }

      // List item
      const item = document.createElement('div');
      item.className = 'hve-hs-item' + (_state.editing?.id === h.id ? ' active' : '');
      item.innerHTML = `
        <div class="hve-hs-dot" data-type="${h.type||'info'}"></div>
        <div class="hve-hs-label">${h.label || 'Untitled'}</div>
        <div class="hve-hs-time">${typeof h.videoTime==='number'?h.videoTime.toFixed(1)+'s':'—'}</div>
        <button class="hve-hs-del" title="Delete">✕</button>
      `;
      item.addEventListener('click', e => {
        if (e.target.classList.contains('hve-hs-del')) {
          _deleteHotspot(h.id, videoDuration);
        } else {
          _editHotspot(h, videoDuration);
        }
      });
      list.appendChild(item);
    }

    if (_state.hotspots.length === 0) {
      list.innerHTML = '<div style="padding:20px;text-align:center;color:rgba(255,255,255,.25);font-size:13px;font-family:system-ui,sans-serif">No hotspots yet.<br>Add one from the timeline.</div>';
    }
  }

  // ── Add new hotspot ────────────────────────────────────────────────────────
  function _addHotspot(videoTime, videoDuration) {
    const h = {
      id:          'hs_' + Date.now(),
      label:       'New hotspot',
      type:        'info',
      videoTime:   parseFloat(videoTime.toFixed(1)),
      videoEndTime:parseFloat((videoTime + 2.5).toFixed(1)),
      screenX:     0.5,
      screenY:     0.4,
      description: '',
      link:        '',
      worldPos:    null,
    };
    _state.hotspots.push(h);
    _state.editing = h;
    _renderList(videoDuration);
    _renderForm(h, videoDuration);
  }

  // ── Delete hotspot ─────────────────────────────────────────────────────────
  function _deleteHotspot(id, videoDuration) {
    _state.hotspots = _state.hotspots.filter(h => h.id !== id);
    if (_state.editing?.id === id) {
      _state.editing = null;
      const form = _state.formEl;
      if (form) form.innerHTML = '<div id="hve-form-empty">Select a hotspot to edit,<br>or add one from the timeline</div>';
    }
    _renderList(videoDuration);
  }

  // ── Edit hotspot form ──────────────────────────────────────────────────────
  function _editHotspot(h, videoDuration) {
    _state.editing = h;
    _renderList(videoDuration);
    _renderForm(h, videoDuration);
  }

  function _renderForm(h, videoDuration) {
    const form = _state.formEl;
    if (!form) return;

    form.innerHTML = `
      <div class="hve-field">
        <label>Label</label>
        <input id="hf-label" type="text" value="${_esc(h.label)}" placeholder="Kitchen, Living Room…">
      </div>
      <div class="hve-field">
        <label>Type</label>
        <select id="hf-type">
          <option value="info"    ${h.type==='info'?'selected':''}>Info</option>
          <option value="link"    ${h.type==='link'?'selected':''}>Link / URL</option>
          <option value="audio"   ${h.type==='audio'?'selected':''}>Audio trigger</option>
          <option value="product" ${h.type==='product'?'selected':''}>Product / Shop</option>
          <option value="tour"    ${h.type==='tour'?'selected':''}>Tour stop</option>
        </select>
      </div>
      <div class="hve-row">
        <div class="hve-field">
          <label>Video time (seconds)</label>
          <input id="hf-vtime" type="number" step="0.1" min="0" max="${videoDuration}" value="${h.videoTime??0}">
        </div>
        <div class="hve-field">
          <label>End time (seconds)</label>
          <input id="hf-vend" type="number" step="0.1" min="0" max="${videoDuration}" value="${h.videoEndTime??''}" placeholder="Auto">
        </div>
      </div>
      <div class="hve-field">
        <label>Description</label>
        <textarea id="hf-desc" rows="3" placeholder="Optional description shown on tap">${_esc(h.description||'')}</textarea>
      </div>
      <div class="hve-field">
        <label>Link URL (optional)</label>
        <input id="hf-link" type="url" value="${_esc(h.link||'')}" placeholder="https://…">
      </div>
      <div class="hve-field">
        <label>Screen position — click to place on video frame</label>
        <div id="hve-screen-picker">
          <div id="hve-screen-picker-label">Portrait video frame (9:16)</div>
          <div id="hve-screen-dot" style="left:${(h.screenX??0.5)*100}%;top:${(h.screenY??0.4)*100}%"></div>
        </div>
        <div style="font-size:11px;color:rgba(255,255,255,.3);margin-top:4px;font-family:system-ui,sans-serif">
          X: <span id="hf-sx-val">${((h.screenX??0.5)*100).toFixed(0)}%</span>
          Y: <span id="hf-sy-val">${((h.screenY??0.4)*100).toFixed(0)}%</span>
        </div>
      </div>
      <button class="hve-btn hve-btn-save-hs" id="hf-apply">Apply changes</button>
    `;

    // Screen position picker
    const picker  = form.querySelector('#hve-screen-picker');
    const dot     = form.querySelector('#hve-screen-dot');
    const sxVal   = form.querySelector('#hf-sx-val');
    const syVal   = form.querySelector('#hf-sy-val');

    picker.addEventListener('click', e => {
      const rect = picker.getBoundingClientRect();
      const sx   = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const sy   = Math.max(0, Math.min(1, (e.clientY - rect.top)  / rect.height));
      dot.style.left = sx*100+'%';
      dot.style.top  = sy*100+'%';
      sxVal.textContent = (sx*100).toFixed(0)+'%';
      syVal.textContent = (sy*100).toFixed(0)+'%';
      form.querySelector('#hf-link'); // trigger reflow
      h.screenX = sx; h.screenY = sy;
    });

    // Apply button
    form.querySelector('#hf-apply').addEventListener('click', () => {
      h.label       = form.querySelector('#hf-label').value.trim() || 'Hotspot';
      h.type        = form.querySelector('#hf-type').value;
      h.videoTime   = parseFloat(form.querySelector('#hf-vtime').value) || 0;
      const endVal  = form.querySelector('#hf-vend').value;
      h.videoEndTime= endVal ? parseFloat(endVal) : h.videoTime + 2.5;
      h.description = form.querySelector('#hf-desc').value.trim();
      h.link        = form.querySelector('#hf-link').value.trim();
      _renderList(videoDuration);
    });
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  function _save() {
    _state.onSave?.(_state.hotspots);
    close();
  }

  // ── Open / close ──────────────────────────────────────────────────────────
  function open(opts = {}) {
    if (_state.open) return;
    _state.open     = true;
    _state.hotspots = (opts.hotspots || []).map(h => ({...h})); // deep-ish clone
    _state.onSave   = opts.onSave || null;
    const duration  = opts.videoDuration || 6;
    _buildUI(duration);
  }

  function close() {
    _state.open    = false;
    _state.editing = null;
    document.getElementById('hve-shell')?.remove();
  }

  function _esc(s) {
    return String(s||'')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  return { open, close };
})();

export default HotspotVideoEditor;
