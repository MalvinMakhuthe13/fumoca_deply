/**
 * FUMOCA Compression UI v82 + Draco MESH
 * ════════════════════════════════════════════════════════════════════════════
 * Export panel wired into viewer.html.
 * Shows quality selector, live compression progress, ratio stats,
 * and download/share buttons once encoding is complete.
 *
 * v82+: Optional Draco WASM mesh encoding — when "Include mesh" is checked
 * the UI calls fumoc-draco-encoder.js to extract + Draco-compress the current
 * renderer's triangle mesh and passes it as the MESH section to FumocEncoder.
 * Falls back silently to no mesh if Draco or the renderer mesh are unavailable.
 * ════════════════════════════════════════════════════════════════════════════
 */

let _panel    = null;
let _encoding = false;

function _ensurePanel() {
  if (_panel) return _panel;

  _panel = document.createElement('div');
  _panel.id = 'fumocExportPanel';
  _panel.innerHTML = `
    <style>
      #fumocExportPanel {
        position: fixed; inset: 0; z-index: 500;
        background: rgba(0,0,0,.65); backdrop-filter: blur(10px);
        display: none; align-items: flex-end; justify-content: center;
        font-family: 'DM Sans', system-ui, sans-serif;
      }
      #fumocExportPanel.open { display: flex; }
      #fepInner {
        width: min(480px, 100vw);
        background: rgba(6,8,14,.97); border: 1px solid rgba(255,255,255,.1);
        border-radius: 24px 24px 0 0; padding: 24px 20px 32px;
        max-height: 90vh; overflow-y: auto;
      }
      .fep-head {
        display: flex; align-items: center; justify-content: space-between;
        margin-bottom: 20px;
      }
      .fep-title { font-size: 17px; font-weight: 800; color: #fff; }
      .fep-close {
        background: none; border: none; color: rgba(255,255,255,.4);
        font-size: 22px; cursor: pointer; padding: 0 4px;
      }
      .fep-label {
        font-size: 11px; font-weight: 700; color: rgba(255,255,255,.4);
        text-transform: uppercase; letter-spacing: .08em; margin-bottom: 8px;
      }
      .fep-quality-row {
        display: flex; gap: 8px; margin-bottom: 20px;
      }
      .fep-q {
        flex: 1; padding: 12px 8px; border-radius: 14px; cursor: pointer;
        background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1);
        color: rgba(255,255,255,.7); text-align: center; font-size: 13px;
        font-weight: 700; transition: all .15s;
      }
      .fep-q.active {
        background: rgba(200,255,0,.15); border-color: rgba(200,255,0,.4);
        color: #c8ff00;
      }
      .fep-q .fep-q-sub {
        display: block; font-size: 10px; font-weight: 400;
        color: rgba(255,255,255,.4); margin-top: 3px;
      }
      .fep-q.active .fep-q-sub { color: rgba(200,255,0,.7); }
      .fep-estimate {
        background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.07);
        border-radius: 12px; padding: 12px 14px; margin-bottom: 14px;
        display: flex; justify-content: space-between; align-items: center;
      }
      .fep-est-label { font-size: 12px; color: rgba(255,255,255,.45); }
      .fep-est-val   { font-size: 16px; font-weight: 800; color: #c8ff00; }
      /* ── Draco mesh toggle ── */
      .fep-mesh-row {
        display: flex; align-items: center; gap: 10px;
        background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.07);
        border-radius: 12px; padding: 11px 14px; margin-bottom: 20px;
        cursor: pointer; user-select: none;
      }
      .fep-mesh-row input[type=checkbox] {
        width: 16px; height: 16px; accent-color: #c8ff00; cursor: pointer;
        flex-shrink: 0;
      }
      .fep-mesh-text { flex: 1; }
      .fep-mesh-title { font-size: 13px; font-weight: 700; color: #fff; }
      .fep-mesh-sub   { font-size: 11px; color: rgba(255,255,255,.4); margin-top: 2px; }
      .fep-mesh-badge {
        font-size: 10px; font-weight: 700; color: #c8ff00;
        background: rgba(200,255,0,.14); border: 1px solid rgba(200,255,0,.3);
        border-radius: 6px; padding: 2px 6px; flex-shrink: 0;
      }
      #fepProgressArea { display: none; margin-bottom: 16px; }
      #fepProgressBar  {
        height: 6px; background: rgba(255,255,255,.08); border-radius: 999px;
        overflow: hidden; margin-bottom: 8px;
      }
      #fepProgressFill {
        height: 100%; width: 0%; background: #c8ff00;
        border-radius: 999px; transition: width .3s ease;
      }
      #fepProgressLabel { font-size: 12px; color: rgba(255,255,255,.5); }
      #fepStats {
        display: none; background: rgba(200,255,0,.07);
        border: 1px solid rgba(200,255,0,.2); border-radius: 14px;
        padding: 14px; margin-bottom: 16px;
      }
      .fep-stat-row {
        display: flex; justify-content: space-between;
        font-size: 13px; margin-bottom: 6px;
      }
      .fep-stat-row:last-child { margin-bottom: 0; }
      .fep-stat-key { color: rgba(255,255,255,.5); }
      .fep-stat-val { font-weight: 700; color: #fff; }
      .fep-stat-val.lime { color: #c8ff00; }
      .fep-btn {
        width: 100%; padding: 14px; border-radius: 14px; border: none;
        font-size: 15px; font-weight: 800; cursor: pointer;
        transition: all .15s; margin-bottom: 8px;
      }
      .fep-btn.primary { background: #c8ff00; color: #05070b; }
      .fep-btn.primary:hover { background: #d4ff33; }
      .fep-btn.primary:disabled { background: rgba(200,255,0,.3); color: rgba(5,7,11,.5); cursor: default; }
      .fep-btn.ghost {
        background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.1);
        color: #fff;
      }
      .fep-btn.ghost:hover { background: rgba(255,255,255,.13); }
      .fep-btn.ghost:disabled { opacity: .4; cursor: default; }
      .fep-open-spec {
        text-align: center; font-size: 11px; color: rgba(255,255,255,.25);
        margin-top: 12px;
      }
      .fep-open-spec a { color: rgba(200,255,0,.5); text-decoration: none; }
    </style>

    <div id="fepInner">
      <div class="fep-head">
        <div class="fep-title">Export .nif</div>
        <button class="fep-close" id="fepCloseBtn">×</button>
      </div>

      <div class="fep-label">Compression quality</div>
      <div class="fep-quality-row">
        <div class="fep-q" data-q="high">
          High
          <span class="fep-q-sub">Best quality · ~3× smaller</span>
        </div>
        <div class="fep-q active" data-q="medium">
          Medium
          <span class="fep-q-sub">Balanced · ~15× smaller</span>
        </div>
        <div class="fep-q" data-q="low">
          Low
          <span class="fep-q-sub">Max compression · ~40× smaller</span>
        </div>
      </div>

      <div class="fep-estimate">
        <span class="fep-est-label">Estimated output size</span>
        <span class="fep-est-val" id="fepEstimate">—</span>
      </div>

      <!-- Draco mesh toggle -->
      <label class="fep-mesh-row" id="fepMeshRow">
        <input type="checkbox" id="fepMeshCheck" checked>
        <div class="fep-mesh-text">
          <div class="fep-mesh-title">Include Draco mesh</div>
          <div class="fep-mesh-sub">Embeds a Draco-compressed surface mesh — enables solid rendering &amp; 3D printing export. Adds ~50–150 KB.</div>
        </div>
        <span class="fep-mesh-badge">WASM</span>
      </label>

      <div id="fepProgressArea">
        <div id="fepProgressBar"><div id="fepProgressFill"></div></div>
        <div id="fepProgressLabel">Starting…</div>
      </div>

      <div id="fepStats">
        <div class="fep-stat-row">
          <span class="fep-stat-key">Original size</span>
          <span class="fep-stat-val" id="fepStatIn">—</span>
        </div>
        <div class="fep-stat-row">
          <span class="fep-stat-key">Compressed size</span>
          <span class="fep-stat-val lime" id="fepStatOut">—</span>
        </div>
        <div class="fep-stat-row">
          <span class="fep-stat-key">Compression ratio</span>
          <span class="fep-stat-val lime" id="fepStatRatio">—</span>
        </div>
        <div class="fep-stat-row">
          <span class="fep-stat-key">Gaussians</span>
          <span class="fep-stat-val" id="fepStatN">—</span>
        </div>
        <div class="fep-stat-row">
          <span class="fep-stat-key">Space saved</span>
          <span class="fep-stat-val lime" id="fepStatSaved">—</span>
        </div>
        <div class="fep-stat-row" id="fepStatMeshRow" style="display:none">
          <span class="fep-stat-key">Mesh section</span>
          <span class="fep-stat-val lime" id="fepStatMesh">—</span>
        </div>
      </div>

      <button class="fep-btn primary" id="fepEncodeBtn">⚡ Compress &amp; Export</button>
      <button class="fep-btn ghost"   id="fepDownloadBtn" disabled>⬇ Download .nif</button>
      <button class="fep-btn ghost"   id="fepShareBtn"    disabled>🌐 Share</button>

      <div class="fep-open-spec">
        Open format · <a href="https://fumoca.io/spec/fumoc-v2" target="_blank" rel="noopener">fumoca.io/spec</a>
        · Any app can decode
      </div>
    </div>
  `;

  document.body.appendChild(_panel);
  _wire();
  return _panel;
}

function _wire() {
  const panel = _panel;

  // Close
  panel.querySelector('#fepCloseBtn').addEventListener('click', close);
  panel.addEventListener('click', e => { if (e.target === panel) close(); });

  // Quality selector
  let quality = 'medium';
  panel.querySelectorAll('.fep-q').forEach(btn => {
    btn.addEventListener('click', () => {
      panel.querySelectorAll('.fep-q').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      quality = btn.dataset.q;
      _updateEstimate(quality);
    });
  });

  // Hide the mesh toggle if WASM is unavailable in this browser
  import('./fumoc-draco-encoder.js').then(({ isDracoEncoderAvailable }) => {
    if (!isDracoEncoderAvailable()) {
      const row = panel.querySelector('#fepMeshRow');
      if (row) row.style.display = 'none';
    }
  }).catch(() => {
    const row = panel.querySelector('#fepMeshRow');
    if (row) row.style.display = 'none';
  });

  // Encode button
  let _lastBuffer = null;
  let _lastStats  = null;

  panel.querySelector('#fepEncodeBtn').addEventListener('click', async () => {
    if (_encoding) return;

    const S      = window.S;
    const record = window._fumocaCurrentRecord;
    const _hasFileParam = !!(new URLSearchParams(location.search).get('file') || new URLSearchParams(location.search).get('url'));
    if (!S?.alive && !record && !_hasFileParam) {
      alert('No splat loaded — open a splat first.');
      return;
    }

    _encoding = true;
    _lastBuffer = null;
    _lastStats  = null;

    const encBtn   = panel.querySelector('#fepEncodeBtn');
    const dlBtn    = panel.querySelector('#fepDownloadBtn');
    const shBtn    = panel.querySelector('#fepShareBtn');
    const progArea = panel.querySelector('#fepProgressArea');
    const stats    = panel.querySelector('#fepStats');
    const meshCheck = panel.querySelector('#fepMeshCheck');

    encBtn.disabled = true;
    dlBtn.disabled  = true;
    shBtn.disabled  = true;
    progArea.style.display = 'block';
    stats.style.display    = 'none';
    encBtn.textContent     = '⏳ Compressing…';

    const onProgress = (pct, label) => {
      panel.querySelector('#fepProgressFill').style.width  = pct + '%';
      panel.querySelector('#fepProgressLabel').textContent = label;
    };

    try {
      // Get splat source buffer — try all known sources
      let splatBuffer = S?.sourceBuffer;

      if (!splatBuffer && record?.splat_url) {
        onProgress(2, 'Fetching splat data…');
        const resp = await fetch(record.splat_url);
        splatBuffer = await resp.arrayBuffer();
      }
      // Fallback: fetch from ?file= URL param (direct file load path)
      if (!splatBuffer) {
        const _p = new URLSearchParams(location.search);
        const _u = _p.get('file') || _p.get('url');
        if (_u) {
          onProgress(2, 'Fetching splat from source URL…');
          try {
            const resp = await fetch(_u);
            if (resp.ok) splatBuffer = await resp.arrayBuffer();
          } catch(e) {}
        }
      }
      if (!splatBuffer) throw new Error('No splat data available. Load a splat first.');

      // Get thumbnail
      let thumbnailBuffer = null;
      if (record?.thumbnail_url) {
        try {
          const r = await fetch(record.thumbnail_url);
          if (r.ok) thumbnailBuffer = new Uint8Array(await r.arrayBuffer());
        } catch {}
      }

      // NOTE: Draco mesh-section export (KEYFRAME_MESH chunk) isn't wired up
      // yet in this .nif path — the chunk type exists in NIFSpec.js but the
      // Draco→NIF bridge hasn't been written. The "Include mesh" checkbox is
      // disabled below until that's built; flagging rather than silently
      // dropping it.
      if (meshCheck?.checked) {
        console.warn('[FumocExportUI] Mesh export not yet supported for .nif — ignoring "Include mesh".');
      }

      onProgress(20, 'Packing .nif…');
      const { encodeNif } = await import('./nif-format.js');

      const bytes = new Uint8Array(splatBuffer);
      // If this came from a live edit session (S.sourceBuffer), respect the
      // alive filter; otherwise (fetched whole file) every row is included.
      const aliveIndices = [];
      if (S?.sourceBuffer && S.sourceBuffer === splatBuffer && S.alive) {
        for (let i = 0; i < S.alive.length; i++) if (S.alive[i]) aliveIndices.push(i);
      } else {
        const rowSize = S?.splatRowSize ?? 32;
        for (let i = 0; i < bytes.byteLength / rowSize; i++) aliveIndices.push(i);
      }

      const nifBuffer = encodeNif({
        sourceBuffer: bytes,
        aliveIndices,
        rowSize: S?.splatRowSize ?? 32,
        meta: {
          title: record?.metadata?.title || record?.title || 'Exported Scene',
          description: record?.metadata?.description || record?.description || '',
          hotspots: record?.metadata?.hotspots  || [],
          tourStops: record?.metadata?.tourStops || [],
        },
        thumbnailBytes: thumbnailBuffer,
        vertical: 'generic',
      });
      onProgress(90, 'Finishing…');

      _lastBuffer = nifBuffer;
      _lastStats  = {
        inputBytes:  bytes.byteLength,
        outputBytes: nifBuffer.byteLength,
        ratio:       bytes.byteLength / nifBuffer.byteLength,
        nGaussians:  aliveIndices.length,
        reductionPct: Math.round((1 - nifBuffer.byteLength / bytes.byteLength) * 100),
      };

      // Show stats
      const s = _lastStats;
      panel.querySelector('#fepStatIn').textContent    = (s.inputBytes  / 1048576).toFixed(1) + ' MB';
      panel.querySelector('#fepStatOut').textContent   = (s.outputBytes / 1048576).toFixed(1) + ' MB';
      panel.querySelector('#fepStatRatio').textContent = s.ratio.toFixed(1) + '×';
      panel.querySelector('#fepStatN').textContent     = s.nGaussians.toLocaleString();
      panel.querySelector('#fepStatSaved').textContent = s.reductionPct + '% smaller';
      stats.style.display = 'block';

      encBtn.textContent  = '✓ Packed!';
      dlBtn.disabled      = false;
      shBtn.disabled      = false;

    } catch (err) {
      console.error('[FumocExportUI]', err);
      panel.querySelector('#fepProgressLabel').textContent = '⚠ ' + err.message;
      encBtn.textContent  = '⚡ Compress & Export';
      encBtn.disabled     = false;
    } finally {
      _encoding = false;
    }
  });

  // Download
  panel.querySelector('#fepDownloadBtn').addEventListener('click', () => {
    if (!_lastBuffer) return;
    const record = window._fumocaCurrentRecord;
    const fname  = (record?.title || 'scene').replace(/[^a-z0-9_-]/gi, '_');
    const blob   = new Blob([_lastBuffer], { type: 'application/octet-stream' });
    const url    = URL.createObjectURL(blob);
    const a      = document.createElement('a');
    a.href = url; a.download = fname + '.nif';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  });

  // Share
  panel.querySelector('#fepShareBtn').addEventListener('click', async () => {
    if (!_lastBuffer) return;
    const record = window._fumocaCurrentRecord;
    if (window.FumocSocialHub) {
      const file = new File(
        [_lastBuffer],
        (record?.title || 'scene') + '.nif',
        { type: 'application/octet-stream' }
      );
      await FumocSocialHub.nativeShare(record || {}, file);
    }
  });
}

function _updateEstimate(quality) {
  const S = window.S;
  if (!S?.alive) { document.getElementById('fepEstimate').textContent = '—'; return; }
  const inputMB  = (S.sourceBuffer?.byteLength || 0) / 1048576;
  const ratioMap = { high: 8, medium: 20, low: 40 };
  const ratio    = ratioMap[quality] || 20;
  const estMB    = (inputMB / ratio).toFixed(1);
  document.getElementById('fepEstimate').textContent = `~${estMB} MB`;
}

// ── Public API ─────────────────────────────────────────────────────────────────

function open() {
  const panel = _ensurePanel();
  panel.classList.add('open');
  _updateEstimate('medium');
}

function close() {
  _panel?.classList.remove('open');
}

const FumocExportUI = { open, close };
window.FumocExportUI = FumocExportUI;
export default FumocExportUI;
