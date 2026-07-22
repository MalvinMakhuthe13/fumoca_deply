/**
 * FUMOCA Mesh UI v91
 * ════════════════════════════════════════════════════════════════════════════
 * Panel for converting a Gaussian splat to a printable triangle mesh.
 * Opened via the "🖨 3D Print" item in the hamburger menu.
 *
 * Controls:
 *   - Resolution: Draft (64³) / Standard (128³) / Detailed (256³)
 *     Higher = more detail but slower and larger file
 *   - Threshold: density iso-surface level (advanced — auto-tuned by default)
 *   - Format: STL / OBJ / PLY
 *   - Colour: vertex colours on/off (only for OBJ / PLY)
 *   - Print scale recommendation (50–150mm hides MC blobbiness)
 *
 * Stats shown after extraction:
 *   - Triangle count
 *   - File size
 *   - Watertight status (yes/no — printable or needs cleanup)
 *   - Time elapsed
 *
 * Honest disclaimers shown in the UI:
 *   - "Mesh is an approximation — sharp edges round, thin features may vanish"
 *   - "Print at 50-150mm scale for best results"
 *   - "Open in Blender or MeshLab for cleanup before printing"
 * ════════════════════════════════════════════════════════════════════════════
 */

import FumocMeshExtractor from './fumoc-mesh-extractor.js';
import FumocMeshSplitter  from './fumoc-mesh-splitter.js';

let _panel    = null;
let _processing = false;
let _lastBlob = null;
let _lastStats = null;

function _build() {
  const el = document.createElement('div');
  el.id = 'fumocMeshPanel';
  el.innerHTML = `
    <style>
      #fumocMeshPanel {
        position:fixed;inset:0;z-index:600;
        background:rgba(0,0,0,.65);backdrop-filter:blur(10px);
        display:none;align-items:flex-end;justify-content:center;
        font-family:'DM Sans',system-ui,sans-serif;
      }
      #fumocMeshPanel.open { display:flex; }
      #fmpInner {
        width:min(480px,100vw);max-height:88vh;overflow-y:auto;
        background:rgba(6,8,14,.97);border:1px solid rgba(255,255,255,.1);
        border-radius:24px 24px 0 0;padding:22px 18px 28px;
      }
      .fmp-head { display:flex;align-items:center;justify-content:space-between;margin-bottom:18px; }
      .fmp-title { font-size:16px;font-weight:800;color:#fff; }
      .fmp-close { background:none;border:none;color:rgba(255,255,255,.4);font-size:22px;cursor:pointer; }
      .fmp-label { font-size:11px;font-weight:700;color:rgba(255,255,255,.4);
        text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px;display:block; }
      .fmp-section { margin-bottom:18px; }
      .fmp-toggle { display:flex;gap:6px; }
      .fmp-chip {
        padding:7px 14px;border-radius:10px;cursor:pointer;font-size:12px;font-weight:700;
        background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);
        color:rgba(255,255,255,.65);transition:all .15s;flex:1;text-align:center;
      }
      .fmp-chip.active {
        background:rgba(200,255,0,.15);border-color:rgba(200,255,0,.4);color:#c8ff00;
      }
      .fmp-desc { font-size:11px;color:rgba(255,255,255,.3);margin-top:6px;line-height:1.5; }

      /* Disclaimer */
      #fmpDisclaimer {
        background:rgba(255,200,0,.06);border:1px solid rgba(255,200,0,.18);
        border-radius:10px;padding:10px 12px;margin-bottom:14px;
      }
      #fmpDisclaimer-title { font-size:11px;font-weight:800;color:#ffc800;
        text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px; }
      #fmpDisclaimer-body { font-size:11px;color:rgba(255,255,255,.55);line-height:1.5; }

      /* Stats */
      #fmpStats {
        display:none;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);
        border-radius:12px;padding:12px 14px;margin-bottom:14px;
      }
      .fmp-stat-row { display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px; }
      .fmp-stat-row:last-child { margin-bottom:0; }
      .fmp-sk { color:rgba(255,255,255,.45); }
      .fmp-sv { font-weight:700;color:#fff; }
      .fmp-sv.lime { color:#c8ff00; }
      .fmp-sv.warn { color:#ffc800; }
      .fmp-sv.bad  { color:#ff8a8a; }

      /* Progress */
      #fmpProgress { display:none;margin-bottom:12px; }
      #fmpBar { height:3px;background:rgba(255,255,255,.08);border-radius:999px;overflow:hidden;margin-bottom:6px; }
      #fmpFill { height:100%;width:0%;background:#c8ff00;border-radius:999px;transition:width .3s; }
      #fmpProgressLabel { font-size:11px;color:rgba(255,255,255,.45); }

      /* Buttons */
      .fmp-btn {
        width:100%;padding:13px;border-radius:13px;border:none;
        font-size:14px;font-weight:800;cursor:pointer;transition:all .15s;margin-bottom:8px;
      }
      .fmp-btn.primary { background:#c8ff00;color:#05070b; }
      .fmp-btn.primary:hover { background:#d4ff33; }
      .fmp-btn.primary:disabled { background:rgba(200,255,0,.25);color:rgba(5,7,11,.4);cursor:default; }
      .fmp-btn.ghost { background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.1);color:#fff; }
      .fmp-btn.ghost:disabled { opacity:.4;cursor:default; }
    </style>

    <div id="fmpInner">
      <div class="fmp-head">
        <div class="fmp-title">🖨 3D Print Export</div>
        <button class="fmp-close" id="fmpClose">×</button>
      </div>

      <div id="fmpDisclaimer">
        <div id="fmpDisclaimer-title">Heads up — about mesh extraction</div>
        <div id="fmpDisclaimer-body">
          The mesh is an approximation of the splat. Sharp edges become rounded.
          Thin features (hair, wires, fabric) may disappear. Print at 50–150mm scale
          for best results. For production prints, clean the mesh in Blender first.
        </div>
      </div>

      <!-- Resolution -->
      <div class="fmp-section">
        <span class="fmp-label">Detail level</span>
        <div class="fmp-toggle">
          <div class="fmp-chip"        data-res="96">Draft</div>
          <div class="fmp-chip"        data-res="160">Standard</div>
          <div class="fmp-chip active" data-res="256">Detailed</div>
          <div class="fmp-chip"        data-res="384">Ultra</div>
        </div>
        <div class="fmp-desc" id="fmpResDesc">
          256³ voxels · ~700k triangles · 4mm features · ~70s · best balance for detail
        </div>
      </div>

      <!-- Surface tuning -->
      <div class="fmp-section">
        <span class="fmp-label">Surface tuning</span>
        <div class="fmp-toggle">
          <div class="fmp-chip active" data-thresh="auto">Auto</div>
          <div class="fmp-chip"        data-thresh="manual">Manual</div>
        </div>
        <div id="fmpThresholdManual" style="display:none;margin-top:10px;">
          <input type="range" min="10" max="90" value="50" step="5" id="fmpThreshold"
            style="width:100%;accent-color:#c8ff00;">
          <div style="display:flex;justify-content:space-between;font-size:11px;color:rgba(255,255,255,.3);margin-top:2px;">
            <span>Loose</span><span id="fmpThresholdVal">50%</span><span>Tight</span>
          </div>
        </div>
        <div class="fmp-desc" id="fmpThreshDesc">
          Auto-finds the surface boundary by analysing density distribution.
        </div>
      </div>

      <!-- Smoothing -->
      <div class="fmp-section">
        <span class="fmp-label">Surface smoothing</span>
        <input type="range" min="0" max="6" value="2" step="1" id="fmpSmooth"
          style="width:100%;accent-color:#c8ff00;">
        <div style="display:flex;justify-content:space-between;font-size:11px;color:rgba(255,255,255,.3);margin-top:2px;">
          <span>None (sharp)</span><span id="fmpSmoothVal">2 passes</span><span>Soft</span>
        </div>
        <div class="fmp-desc">
          Removes Marching Cubes stair-stepping. 2 passes is the sweet spot — preserves detail while cleaning artefacts.
        </div>
      </div>

      <!-- Format -->
      <div class="fmp-section">
        <span class="fmp-label">Export format</span>
        <div class="fmp-toggle">
          <div class="fmp-chip active" data-fmt="stl">STL</div>
          <div class="fmp-chip"        data-fmt="obj">OBJ</div>
          <div class="fmp-chip"        data-fmt="ply">PLY</div>
        </div>
        <div class="fmp-desc" id="fmpFmtDesc">
          STL — universal 3D printing format. No colour. Every printer accepts it.
        </div>
      </div>

      <!-- Sectioned Printing -->
      <div class="fmp-section">
        <span class="fmp-label">Split for sectioned printing</span>
        <div class="fmp-toggle">
          <div class="fmp-chip active" data-split="off">Single piece</div>
          <div class="fmp-chip"        data-split="2">2 sections</div>
          <div class="fmp-chip"        data-split="3">3 sections</div>
          <div class="fmp-chip"        data-split="4">4 sections</div>
        </div>
        <div id="fmpSplitOpts" style="display:none;margin-top:10px;">
          <span class="fmp-label" style="margin-top:6px;">Joint type</span>
          <div class="fmp-toggle">
            <div class="fmp-chip active" data-joint="magnet">Magnets</div>
            <div class="fmp-chip"        data-joint="peg">Pegs</div>
            <div class="fmp-chip"        data-joint="dovetail">Dovetails</div>
          </div>
          <div class="fmp-desc" id="fmpJointDesc">
            6mm magnet pockets — easiest assembly. Glue magnets in after printing.
          </div>
          <span class="fmp-label" style="margin-top:10px;">Cut axis</span>
          <div class="fmp-toggle">
            <div class="fmp-chip"        data-axis="x">X (left-right)</div>
            <div class="fmp-chip active" data-axis="y">Y (top-bottom)</div>
            <div class="fmp-chip"        data-axis="z">Z (front-back)</div>
          </div>
        </div>
      </div>

      <!-- Stats -->
      <div id="fmpStats">
        <div class="fmp-stat-row">
          <span class="fmp-sk">Triangles</span>
          <span class="fmp-sv lime" id="fmpStatTris">—</span>
        </div>
        <div class="fmp-stat-row">
          <span class="fmp-sk">File size</span>
          <span class="fmp-sv" id="fmpStatSize">—</span>
        </div>
        <div class="fmp-stat-row">
          <span class="fmp-sk">Watertight</span>
          <span class="fmp-sv" id="fmpStatWater">—</span>
        </div>
        <div class="fmp-stat-row">
          <span class="fmp-sk">Time</span>
          <span class="fmp-sv" id="fmpStatTime">—</span>
        </div>
      </div>

      <!-- Progress -->
      <div id="fmpProgress">
        <div id="fmpBar"><div id="fmpFill"></div></div>
        <div id="fmpProgressLabel">Starting…</div>
      </div>

      <!-- Buttons -->
      <button class="fmp-btn primary" id="fmpExtractBtn">🖨 Extract Mesh</button>
      <button class="fmp-btn ghost" id="fmpDownloadBtn" disabled>⬇ Download</button>
    </div>
  `;
  document.body.appendChild(el);
  _wire(el);
  return el;
}

function _wire(panel) {
  panel.querySelector('#fmpClose').addEventListener('click', close);
  panel.addEventListener('click', e => { if (e.target === panel) close(); });

  // Resolution
  let resolution = 256;
  const resDescs = {
    96:  '96³ voxels · ~50k triangles · 3cm features · ~5s · for quick previews',
    160: '160³ voxels · ~200k triangles · 1cm features · ~25s · good for keychains',
    256: '256³ voxels · ~700k triangles · 4mm features · ~70s · best balance for detail',
    384: '384³ voxels · ~1.8M triangles · 2mm features · ~3 mins · museum-quality detail',
  };
  panel.querySelectorAll('.fmp-chip[data-res]').forEach(chip => {
    chip.addEventListener('click', () => {
      panel.querySelectorAll('.fmp-chip[data-res]').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      resolution = parseInt(chip.dataset.res);
      panel.querySelector('#fmpResDesc').textContent = resDescs[resolution];
    });
  });

  // Threshold mode (auto/manual)
  let thresholdMode = 'auto';
  panel.querySelectorAll('.fmp-chip[data-thresh]').forEach(chip => {
    chip.addEventListener('click', () => {
      panel.querySelectorAll('.fmp-chip[data-thresh]').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      thresholdMode = chip.dataset.thresh;
      panel.querySelector('#fmpThresholdManual').style.display = thresholdMode === 'manual' ? 'block' : 'none';
      panel.querySelector('#fmpThreshDesc').textContent = thresholdMode === 'auto'
        ? 'Auto-finds the surface boundary by analysing density distribution.'
        : 'Manual override — drag to adjust where the surface sits.';
    });
  });

  panel.querySelector('#fmpThreshold').addEventListener('input', e => {
    panel.querySelector('#fmpThresholdVal').textContent = e.target.value + '%';
  });

  // Smoothing
  panel.querySelector('#fmpSmooth').addEventListener('input', e => {
    const v = parseInt(e.target.value);
    panel.querySelector('#fmpSmoothVal').textContent = v === 0 ? 'None' : `${v} passes`;
  });

  // Splitting
  let splitCount = 0;  // 0 = no split
  let jointType = 'magnet';
  let cutAxis = 'y';
  const jointDescs = {
    magnet:   '6mm magnet pockets — easiest assembly. Glue magnets in after printing.',
    peg:      'Cylindrical pegs and holes — most universal, no extra parts needed.',
    dovetail: 'Dovetail joints — strongest mechanical lock, dry-fit possible.',
  };

  panel.querySelectorAll('.fmp-chip[data-split]').forEach(chip => {
    chip.addEventListener('click', () => {
      panel.querySelectorAll('.fmp-chip[data-split]').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      splitCount = chip.dataset.split === 'off' ? 0 : parseInt(chip.dataset.split);
      panel.querySelector('#fmpSplitOpts').style.display = splitCount > 0 ? 'block' : 'none';
    });
  });

  panel.querySelectorAll('.fmp-chip[data-joint]').forEach(chip => {
    chip.addEventListener('click', () => {
      panel.querySelectorAll('.fmp-chip[data-joint]').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      jointType = chip.dataset.joint;
      panel.querySelector('#fmpJointDesc').textContent = jointDescs[jointType];
    });
  });

  panel.querySelectorAll('.fmp-chip[data-axis]').forEach(chip => {
    chip.addEventListener('click', () => {
      panel.querySelectorAll('.fmp-chip[data-axis]').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      cutAxis = chip.dataset.axis;
    });
  });

  // Format
  let format = 'stl';
  const fmtDescs = {
    stl: 'STL — universal 3D printing format. No colour. Every printer accepts it.',
    obj: 'OBJ — text format with vertex colours. Import to Blender, Unity, MeshLab.',
    ply: 'PLY — binary with reliable colour preservation. Used by 3D scanning workflows.',
  };
  panel.querySelectorAll('.fmp-chip[data-fmt]').forEach(chip => {
    chip.addEventListener('click', () => {
      panel.querySelectorAll('.fmp-chip[data-fmt]').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      format = chip.dataset.fmt;
      panel.querySelector('#fmpFmtDesc').textContent = fmtDescs[format];
    });
  });

  // Extract
  panel.querySelector('#fmpExtractBtn').addEventListener('click', async () => {
    if (_processing) return;

    const gaussians = window._fumocaCurrentGaussians;
    if (!gaussians) {
      alert('No splat loaded. Load a splat first.');
      return;
    }

    _processing = true;
    const extractBtn  = panel.querySelector('#fmpExtractBtn');
    const downloadBtn = panel.querySelector('#fmpDownloadBtn');
    const progress    = panel.querySelector('#fmpProgress');
    const stats       = panel.querySelector('#fmpStats');

    extractBtn.disabled  = true;
    downloadBtn.disabled = true;
    progress.style.display = 'block';
    stats.style.display    = 'none';

    const onProgress = (pct, label) => {
      panel.querySelector('#fmpFill').style.width  = pct + '%';
      panel.querySelector('#fmpProgressLabel').textContent = label;
    };

    try {
      const threshold = thresholdMode === 'auto'
        ? null
        : parseInt(panel.querySelector('#fmpThreshold').value) / 100;
      const smooth   = parseInt(panel.querySelector('#fmpSmooth').value);
      const record   = window._fumocaCurrentRecord;
      const name     = record?.title?.replace(/\s+/g, '_').toLowerCase() || 'fumoca_mesh';

      const meshOpts = {
        resolution, threshold, smooth, format, name,
        transferColours: format !== 'stl',
        onProgress: (pct, label) => onProgress(pct * (splitCount > 0 ? 0.6 : 1.0), label),
      };

      const result = await FumocMeshExtractor.extractMesh(gaussians, meshOpts);

      // If splitting requested, do it now
      if (splitCount > 0) {
        onProgress(60, `Splitting into ${splitCount} sections…`);
        await new Promise(r => setTimeout(r, 0));

        const cutPlanes = FumocMeshSplitter.generateHorizontalCuts(
          result.mesh, splitCount, cutAxis
        );
        const splitResult = await FumocMeshSplitter.splitMesh(result.mesh, {
          planes:      cutPlanes,
          jointType,
          jointCount:  3,
          jointRadius: 3,
          jointDepth:  4,
          onProgress: (pct, label) => onProgress(60 + pct * 0.35, label),
        });

        // Build a zip with all sections + assembly guide
        onProgress(96, 'Building zip archive…');
        await new Promise(r => setTimeout(r, 0));

        const files = [];
        for (const chunk of splitResult.chunks) {
          const blob =
            format === 'obj' ? FumocMeshExtractor.exportOBJ(chunk.mesh, chunk.label) :
            format === 'ply' ? FumocMeshExtractor.exportPLY(chunk.mesh, chunk.label) :
                               FumocMeshExtractor.exportSTL(chunk.mesh, chunk.label);
          files.push({ name: `${chunk.label.replace(/\s+/g,'_')}.${format}`, blob });
        }
        const guide = FumocMeshSplitter.generateAssemblyGuide(splitResult, jointType);
        files.push({ name: 'ASSEMBLY_GUIDE.txt', blob: new Blob([guide], { type: 'text/plain' }) });

        // Build a simple uncompressed zip in-browser (no library)
        const zipBlob = await _buildZip(files);
        _lastBlob  = zipBlob;
        _lastStats = {
          ...result.stats,
          sections: splitResult.chunks.length,
          jointType,
          totalTriangles: splitResult.stats.totalTriangles,
          fileSize: zipBlob.size,
          format: 'zip',
        };
      } else {
        _lastBlob  = result.blob;
        _lastStats = result.stats;
      }

      // Show stats
      panel.querySelector('#fmpStatTris').textContent = result.stats.triangles.toLocaleString();
      panel.querySelector('#fmpStatSize').textContent = (result.blob.size / 1048576).toFixed(2) + ' MB';

      const waterEl = panel.querySelector('#fmpStatWater');
      if (result.stats.watertight) {
        waterEl.textContent = '✓ Yes — printable';
        waterEl.className   = 'fmp-sv lime';
      } else {
        waterEl.textContent = `⚠ ${result.stats.openEdges} open edges — needs cleanup`;
        waterEl.className   = 'fmp-sv warn';
      }

      panel.querySelector('#fmpStatTime').textContent = (result.stats.elapsedMs / 1000).toFixed(1) + 's';

      stats.style.display = 'block';
      progress.style.display = 'none';
      downloadBtn.disabled = false;
      extractBtn.textContent = '🖨 Extract Again';

    } catch (err) {
      console.error('[MeshUI]', err);
      panel.querySelector('#fmpProgressLabel').textContent = '⚠ ' + err.message;
    } finally {
      _processing = false;
      extractBtn.disabled = false;
    }
  });

  // Download
  panel.querySelector('#fmpDownloadBtn').addEventListener('click', () => {
    if (!_lastBlob) return;
    const record = window._fumocaCurrentRecord;
    const name   = record?.title?.replace(/\s+/g, '_').toLowerCase() || 'fumoca_mesh';
    const ext    = _lastStats?.format || 'stl';
    const fname  = ext === 'zip' ? `${name}_sections.zip` : `${name}.${ext}`;
    const url    = URL.createObjectURL(_lastBlob);
    const a      = document.createElement('a');
    a.href = url; a.download = fname; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  });
}

// ── Minimal STORE-only zip builder (no compression — files inside are already binary) ───
async function _buildZip(files) {
  const enc = new TextEncoder();
  const localHeaders = []; const centralHeaders = [];
  let offset = 0;

  // CRC-32 table (computed once)
  if (!_crcTable) {
    _crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      _crcTable[n] = c >>> 0;
    }
  }
  function _crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = _crcTable[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  for (const file of files) {
    const nameBytes = enc.encode(file.name);
    const data = new Uint8Array(await file.blob.arrayBuffer());
    const crc  = _crc32(data);
    const size = data.length;

    // Local header (30 bytes + name)
    const local = new ArrayBuffer(30 + nameBytes.length + size);
    const lview = new DataView(local);
    const lu8   = new Uint8Array(local);
    lview.setUint32(0, 0x04034b50, true);
    lview.setUint16(4, 20, true);    // version
    lview.setUint16(6, 0, true);     // flags
    lview.setUint16(8, 0, true);     // compression: store
    lview.setUint16(10, 0, true);    // mod time
    lview.setUint16(12, 0, true);    // mod date
    lview.setUint32(14, crc, true);
    lview.setUint32(18, size, true); // compressed size
    lview.setUint32(22, size, true); // uncompressed size
    lview.setUint16(26, nameBytes.length, true);
    lview.setUint16(28, 0, true);    // extra
    lu8.set(nameBytes, 30);
    lu8.set(data, 30 + nameBytes.length);
    localHeaders.push({ buf: local, name: nameBytes, offset, size, crc });

    // Central header (46 bytes + name)
    const central = new ArrayBuffer(46 + nameBytes.length);
    const cview = new DataView(central);
    const cu8   = new Uint8Array(central);
    cview.setUint32(0, 0x02014b50, true);
    cview.setUint16(4, 20, true);   // version made by
    cview.setUint16(6, 20, true);   // version needed
    cview.setUint16(8, 0, true);    // flags
    cview.setUint16(10, 0, true);   // compression
    cview.setUint16(12, 0, true);   // mod time
    cview.setUint16(14, 0, true);   // mod date
    cview.setUint32(16, crc, true);
    cview.setUint32(20, size, true);
    cview.setUint32(24, size, true);
    cview.setUint16(28, nameBytes.length, true);
    cview.setUint16(30, 0, true);   // extra len
    cview.setUint16(32, 0, true);   // comment
    cview.setUint16(34, 0, true);   // disk
    cview.setUint16(36, 0, true);   // internal attrs
    cview.setUint32(38, 0, true);   // external attrs
    cview.setUint32(42, offset, true);
    cu8.set(nameBytes, 46);
    centralHeaders.push(central);

    offset += local.byteLength;
  }

  // EOCD
  const centralOffset = offset;
  let centralSize = 0;
  for (const h of centralHeaders) centralSize += h.byteLength;

  const eocd = new ArrayBuffer(22);
  const eview = new DataView(eocd);
  eview.setUint32(0, 0x06054b50, true);
  eview.setUint16(4, 0, true);
  eview.setUint16(6, 0, true);
  eview.setUint16(8,  centralHeaders.length, true);
  eview.setUint16(10, centralHeaders.length, true);
  eview.setUint32(12, centralSize, true);
  eview.setUint32(16, centralOffset, true);
  eview.setUint16(20, 0, true);

  // Concatenate everything
  return new Blob([
    ...localHeaders.map(h => h.buf),
    ...centralHeaders,
    eocd
  ], { type: 'application/zip' });
}
let _crcTable = null;

function open() {
  if (!_panel) _panel = _build();
  _panel.classList.add('open');
}

function close() { _panel?.classList.remove('open'); }

const FumocMeshUI = { open, close };
window.FumocMeshUI = FumocMeshUI;
export default FumocMeshUI;
