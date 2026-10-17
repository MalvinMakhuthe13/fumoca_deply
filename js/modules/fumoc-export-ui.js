/**
 * FUMOCA NIF Export UI
 * Export the current supported NIF/SPLAT asset with accurate size reporting.
 * Existing NIF files are preserved byte-for-byte in viewer-only context;
 * live editor state is re-encoded with its supported point-indexed sidecars.
 * This panel does not claim to reconstruct a new solid mesh.
 */

import r2 from './r2Client.js';
import { encodeNif, decodeNif } from './nif-format.js';
import { compactGaussianSHSidecar, gaussianSHMetadata } from './nif-sh-sidecar.js';
import { encodeEditorSplatRows } from './editor-splat-rows.js';
import { compactNifLayers } from './nif-layer-geo.js';
import { CHUNK } from '../../engine-next/format/NIFSpec.js';

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
      .fep-estimate {
        background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.07);
        border-radius: 12px; padding: 12px 14px; margin-bottom: 14px;
        display: flex; justify-content: space-between; align-items: center;
      }
      .fep-est-label { font-size: 12px; color: rgba(255,255,255,.45); }
      .fep-est-val   { font-size: 16px; font-weight: 800; color: #c8ff00; }
      /* Existing mesh/sidecar preservation note */
      .fep-mesh-row {
        display: flex; align-items: center; gap: 10px;
        background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.07);
        border-radius: 12px; padding: 11px 14px; margin-bottom: 20px;
        cursor: default; user-select: text;
      }
      .fep-mesh-text { flex: 1; }
      .fep-mesh-title { font-size: 13px; font-weight: 700; color: #fff; }
      .fep-mesh-sub   { font-size: 11px; color: rgba(255,255,255,.4); margin-top: 2px; }
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

      <div class="fep-label">Export mode</div>
      <div class="fep-estimate">
        <span class="fep-est-label">Format</span>
        <span class="fep-est-val">NIF 1.2 · preserve supported data</span>
      </div>

      <div class="fep-estimate">
        <span class="fep-est-label">Estimated output size</span>
        <span class="fep-est-val" id="fepEstimate">—</span>
      </div>

      <div class="fep-mesh-row" id="fepMeshRow" role="note">
        <div class="fep-mesh-text">
          <div class="fep-mesh-title">Mesh and sidecars</div>
          <div class="fep-mesh-sub">Existing NIF meshes and supported SH, LiDAR, layer and metadata chunks are preserved. This viewer export does not reconstruct a new mesh.</div>
        </div>
      </div>

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
          <span class="fep-stat-key">Output size</span>
          <span class="fep-stat-val lime" id="fepStatOut">—</span>
        </div>
        <div class="fep-stat-row">
          <span class="fep-stat-key">Input/output ratio</span>
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

      <button class="fep-btn primary" id="fepEncodeBtn">Prepare NIF Export</button>
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
  panel.querySelector('#fepCloseBtn').addEventListener('click', close);
  panel.addEventListener('click', e => { if (e.target === panel) close(); });

  let _lastBuffer = null;
  let _lastStats = null;

  panel.querySelector('#fepEncodeBtn').addEventListener('click', async () => {
    if (_encoding) return;
    const S = window.S;
    const record = window._fumocaCurrentRecord;
    const params = new URLSearchParams(location.search);
    const hasEditorState = !!(S?.alive?.length && S?.positions?.length === S.alive.length * 3);
    const sourceName = record?.r2_key || record?.splat_url || params.get('file') || params.get('url') || window._fumocanifUrl || '';
    if (!hasEditorState && !sourceName && !window._fumocanifUrl) {
      alert('No supported NIF or SPLAT source is available to export.');
      return;
    }

    _encoding = true;
    _lastBuffer = null;
    _lastStats = null;
    const encBtn = panel.querySelector('#fepEncodeBtn');
    const dlBtn = panel.querySelector('#fepDownloadBtn');
    const shBtn = panel.querySelector('#fepShareBtn');
    const progArea = panel.querySelector('#fepProgressArea');
    const stats = panel.querySelector('#fepStats');
    encBtn.disabled = true;
    dlBtn.disabled = true;
    shBtn.disabled = true;
    progArea.style.display = 'block';
    stats.style.display = 'none';
    encBtn.textContent = 'Preparing NIF…';

    const onProgress = (pct, label) => {
      panel.querySelector('#fepProgressFill').style.width = pct + '%';
      panel.querySelector('#fepProgressLabel').textContent = label;
    };

    try {
      let sourceBytes = null;
      let inputBytes = 0;
      if (hasEditorState) {
        inputBytes = S.sourceBuffer?.byteLength || S.alive.length * 32;
      } else {
        let sourceUrl = '';
        if (record?.r2_key) {
          onProgress(5, 'Authorizing source read…');
          sourceUrl = record.is_public === true
            ? r2.publicUrl('nif-files', record.r2_key)
            : await r2.from('nif-files').authenticatedUrl(record.r2_key);
        } else {
          sourceUrl = record?.splat_url || params.get('file') || params.get('url') || window._fumocanifUrl || '';
        }
        if (!sourceUrl) throw new Error('No source URL or editor state is available.');
        onProgress(12, 'Fetching source data…');
        const response = await fetch(sourceUrl);
        if (!response.ok) throw new Error('Source fetch failed with HTTP ' + response.status);
        sourceBytes = new Uint8Array(await response.arrayBuffer());
        inputBytes = sourceBytes.byteLength;
      }

      let thumbnailBytes = S?.nifThumbnailBytes || null;
      if (!thumbnailBytes && record?.meta?.thumbnail_r2_key) {
        try {
          const thumbnailUrl = record.is_public === true
            ? r2.publicUrl('thumbnails', record.meta.thumbnail_r2_key)
            : await r2.from('thumbnails').authenticatedUrl(record.meta.thumbnail_r2_key);
          const thumbnailResponse = await fetch(thumbnailUrl);
          if (thumbnailResponse.ok) thumbnailBytes = new Uint8Array(await thumbnailResponse.arrayBuffer());
        } catch (error) {
          console.warn('[FumocExportUI] Optional thumbnail could not be fetched:', error?.message || error);
        }
      } else if (!thumbnailBytes && record?.thumbnail_url) {
        try {
          const thumbnailResponse = await fetch(record.thumbnail_url);
          if (thumbnailResponse.ok) thumbnailBytes = new Uint8Array(await thumbnailResponse.arrayBuffer());
        } catch { /* thumbnail is optional */ }
      }

      let nifBuffer;
      let gaussianCount = 0;
      if (hasEditorState) {
        onProgress(35, 'Encoding current Studio state…');
        const aliveIndices = [];
        for (let i = 0; i < S.alive.length; i++) if (S.alive[i]) aliveIndices.push(i);
        if (!aliveIndices.length) throw new Error('Cannot export an empty scene: no live points remain.');
        const rows = encodeEditorSplatRows(S, aliveIndices);
        const sourceMeta = {
          ...(S.nifMeta && typeof S.nifMeta === 'object' ? S.nifMeta : {}),
          ...(record?.meta && typeof record.meta === 'object' ? record.meta : {}),
        };
        const gaussianSH = compactGaussianSHSidecar({
          indices: aliveIndices,
          attributes: S.shAttributes || [],
          coefficients: S.shCoefficients,
          pointCount: S.alive.length,
          paintColors: S.paintColors,
          colors: S.colors,
        });
        if (sourceMeta.gaussian_sh && !gaussianSH) {
          throw new Error('Export blocked: metadata declares Gaussian SH data but the coefficient sidecar is unavailable.');
        }
        const gaussianShMeta = gaussianSH ? gaussianSHMetadata(gaussianSH, S.shAttributes) : null;
        let layerSources = Array.isArray(S.nifLayers) && S.nifLayers.length ? S.nifLayers : [];
        if (!layerSources.length && Array.isArray(S.layers)) {
          layerSources = S.layers.map(layer => ({
            label: String(layer.name || layer.label || '').trim(),
            depthMin: 0, depthMax: 0,
            indices: Array.from({ length: S.alive.length }, (_, i) => i).filter(i => Boolean(layer.mask?.[i])),
          })).filter(layer => layer.label && layer.indices.length);
        }
        if (!layerSources.length && Array.isArray(sourceMeta.editor_scene?.layers)) {
          layerSources = sourceMeta.editor_scene.layers.map(layer => ({
            label: layer.name, depthMin: 0, depthMax: 0, indices: layer.point_indices,
          }));
        }
        const layerData = compactNifLayers(layerSources, aliveIndices, S.alive.length);
        const meta = {
          ...sourceMeta,
          ...(gaussianShMeta ? { gaussian_sh: gaussianShMeta } : {}),
          title: record?.title || sourceMeta.title || 'Exported Scene',
          description: sourceMeta.description || record?.description || '',
        };
        if (window._fumocaSerializeEditorSceneMetadata) {
          meta.editor_scene = window._fumocaSerializeEditorSceneMetadata(aliveIndices);
        } else if (sourceMeta.editor_scene && aliveIndices.length !== S.alive.length) {
          delete meta.editor_scene;
        }
        if (layerData.droppedUnindexed) {
          meta.quality_flags = [...new Set([...(Array.isArray(meta.quality_flags) ? meta.quality_flags : []), 'legacy_layer_geo_dropped_no_indices'])];
          meta.layer_geo_status = 'legacy_layers_dropped_unindexed';
        }
        const compactLidar = source => source ? aliveIndices.map(i => source[i] ?? 0) : null;
        const lidarAttributes = S.lidarIntensity || S.lidarClassification || S.lidarReturnNumber ? {
          intensity: S.lidarIntensity ? Uint16Array.from(compactLidar(S.lidarIntensity)) : null,
          classification: S.lidarClassification ? Uint8Array.from(compactLidar(S.lidarClassification)) : null,
          returnNumber: S.lidarReturnNumber ? Uint8Array.from(compactLidar(S.lidarReturnNumber)) : null,
        } : null;
        const passthroughChunks = (S.nifPassthroughChunks || []).filter(chunk => ![
          CHUNK.KEYFRAME_GEO, CHUNK.META, CHUNK.THUMBNAIL, CHUNK.KEYFRAME_MESH,
          CHUNK.LAYER_GEO, CHUNK.GAUSSIAN_SH, CHUNK.LIDAR_ATTR,
        ].includes(chunk.type));
        nifBuffer = encodeNif({
          sourceBuffer: rows,
          aliveIndices: Array.from({ length: aliveIndices.length }, (_, i) => i),
          rowSize: 32,
          meta,
          gaussianSH: gaussianSH || undefined,
          lidarAttributes,
          layers: layerData.layers,
          mesh: S.nifMesh || undefined,
          thumbnailBytes: thumbnailBytes || undefined,
          vertical: S.nifVertical || sourceMeta.vertical || 'generic',
          passthroughChunks,
        });
        gaussianCount = aliveIndices.length;
      } else {
        const name = String(sourceName).split('?')[0].toLowerCase();
        const isNif = name.endsWith('.nif') ||
          (sourceBytes[0] === 0x4e && sourceBytes[1] === 0x49 && sourceBytes[2] === 0x46);
        const isSplat = name.endsWith('.splat') || record?.meta?.source_format === 'splat';
        if (isNif) {
          onProgress(50, 'Validating existing NIF…');
          const sourceBuffer = sourceBytes.buffer.slice(sourceBytes.byteOffset, sourceBytes.byteOffset + sourceBytes.byteLength);
          const decoded = await decodeNif(sourceBuffer);
          gaussianCount = decoded.gaussians.count;
          // No edits are present in this viewer context: download the original
          // NIF byte-for-byte, retaining every supported and future chunk.
          nifBuffer = sourceBuffer;
        } else if (isSplat) {
          onProgress(45, 'Converting SPLAT to NIF…');
          if (sourceBytes.byteLength === 0 || sourceBytes.byteLength % 32 !== 0) {
            throw new Error('SPLAT source length is not a whole number of 32-byte Gaussian records.');
          }
          const count = sourceBytes.byteLength / 32;
          const meta = {
            ...(record?.meta && typeof record.meta === 'object' ? record.meta : {}),
            title: record?.title || 'Exported Scene',
            description: record?.description || '',
          };
          if (meta.gaussian_sh) {
            throw new Error('This SPLAT source has Gaussian SH metadata but no SH coefficient sidecar. Open the original NIF in Studio to preserve it.');
          }
          const layerSources = Array.isArray(meta.editor_scene?.layers)
            ? meta.editor_scene.layers.map(layer => ({ label: layer.name, depthMin: 0, depthMax: 0, indices: layer.point_indices }))
            : [];
          const layerData = compactNifLayers(layerSources, Array.from({ length: count }, (_, i) => i), count);
          nifBuffer = encodeNif({
            sourceBuffer: sourceBytes,
            aliveIndices: Array.from({ length: count }, (_, i) => i),
            rowSize: 32,
            meta,
            layers: layerData.layers,
            thumbnailBytes: thumbnailBytes || undefined,
            vertical: record?.meta?.vertical || record?.vertical || 'generic',
          });
          gaussianCount = count;
        } else {
          throw new Error('This export panel supports NIF and SPLAT sources. Open PLY or Gaussian PLY in Studio to preserve scales, rotations and SH coefficients.');
        }
      }

      onProgress(90, 'Finalizing NIF…');
      _lastBuffer = nifBuffer;
      _lastStats = {
        inputBytes,
        outputBytes: nifBuffer.byteLength,
        ratio: inputBytes / nifBuffer.byteLength,
        nGaussians: gaussianCount,
        reductionPct: Math.round((1 - nifBuffer.byteLength / inputBytes) * 100),
      };
      const s = _lastStats;
      panel.querySelector('#fepStatIn').textContent = (s.inputBytes / 1048576).toFixed(1) + ' MB';
      panel.querySelector('#fepStatOut').textContent = (s.outputBytes / 1048576).toFixed(1) + ' MB';
      panel.querySelector('#fepStatRatio').textContent = s.ratio.toFixed(1) + '×';
      panel.querySelector('#fepStatN').textContent = s.nGaussians.toLocaleString();
      panel.querySelector('#fepStatSaved').textContent = s.reductionPct > 0
        ? s.reductionPct + '% smaller'
        : s.reductionPct < 0 ? Math.abs(s.reductionPct) + '% larger' : 'same size';
      stats.style.display = 'block';
      encBtn.textContent = '✓ Ready to download';
      dlBtn.disabled = false;
      shBtn.disabled = false;
      onProgress(100, 'NIF export ready.');
    } catch (err) {
      console.error('[FumocExportUI]', err);
      panel.querySelector('#fepProgressLabel').textContent = '⚠ ' + err.message;
      encBtn.textContent = 'Export NIF';
      encBtn.disabled = false;
    } finally {
      _encoding = false;
    }
  });

  panel.querySelector('#fepDownloadBtn').addEventListener('click', () => {
    if (!_lastBuffer) return;
    const record = window._fumocaCurrentRecord;
    const fname = (record?.title || 'scene').replace(/[^a-z0-9_-]/gi, '_');
    const blob = new Blob([_lastBuffer], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fname + '.nif';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  });

  panel.querySelector('#fepShareBtn').addEventListener('click', async () => {
    if (!_lastBuffer) return;
    const record = window._fumocaCurrentRecord;
    if (window.FumocSocialHub) {
      const file = new File([_lastBuffer], (record?.title || 'scene') + '.nif', { type: 'application/octet-stream' });
      await FumocSocialHub.nativeShare(record || {}, file);
    }
  });
}

function _updateEstimate() {
  const S = window.S;
  const record = window._fumocaCurrentRecord;
  const count = S?.alive?.length || record?.gaussian_count || null;
  document.getElementById('fepEstimate').textContent = count
    ? count.toLocaleString() + ' points · actual size measured after export'
    : 'Actual size measured after export';
}

// ── Public API ─────────────────────────────────────────────────────────────────

function open() {
  const panel = _ensurePanel();
  panel.classList.add('open');
  _updateEstimate();
}

function close() {
  _panel?.classList.remove('open');
}

const FumocExportUI = { open, close };
window.FumocExportUI = FumocExportUI;
export default FumocExportUI;
