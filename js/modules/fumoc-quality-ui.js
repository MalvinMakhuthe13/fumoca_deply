/**
 * FUMOCA Quality Panel v87
 * ════════════════════════════════════════════════════════════════════════════
 * The UI panel that gives creators control over presentation quality
 * before exporting a .fumoc file.
 *
 * Accessible via the "✨ Clean" button in the viewer topbar.
 *
 * Controls:
 *   - Floater removal (on/off + sensitivity)
 *   - Subject isolation (off / cutout / soft)
 *   - Background: black / white / transparent / custom colour
 *   - Opacity refinement (on/off)
 *   - Live preview of Gaussian count before/after
 *   - Apply → runs the pipeline, updates the viewer with cleaned splat
 *   - Export → runs pipeline then opens compression panel
 * ════════════════════════════════════════════════════════════════════════════
 */

import FumocQualityPipeline from './fumoc-quality-pipeline.js';

let _panel = null;
let _processing = false;

function _build() {
  const el = document.createElement('div');
  el.id = 'fumocQualityPanel';
  el.innerHTML = `
    <style>
      #fumocQualityPanel {
        position:fixed;inset:0;z-index:600;
        background:rgba(0,0,0,.65);backdrop-filter:blur(10px);
        display:none;align-items:flex-end;justify-content:center;
        font-family:'DM Sans',system-ui,sans-serif;
      }
      #fumocQualityPanel.open { display:flex; }
      #fqpInner {
        width:min(460px,100vw);max-height:88vh;overflow-y:auto;
        background:rgba(6,8,14,.97);border:1px solid rgba(255,255,255,.1);
        border-radius:24px 24px 0 0;padding:22px 18px 28px;
      }
      .fqp-head { display:flex;align-items:center;justify-content:space-between;margin-bottom:18px; }
      .fqp-title { font-size:16px;font-weight:800;color:#fff; }
      .fqp-close { background:none;border:none;color:rgba(255,255,255,.4);font-size:22px;cursor:pointer; }
      .fqp-label { font-size:11px;font-weight:700;color:rgba(255,255,255,.4);
        text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px;display:block; }
      .fqp-section { margin-bottom:18px; }
      .fqp-row { display:flex;align-items:center;gap:10px;margin-bottom:8px; }
      .fqp-toggle {
        display:flex;gap:6px;
      }
      .fqp-chip {
        padding:7px 14px;border-radius:10px;cursor:pointer;font-size:12px;font-weight:700;
        background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);
        color:rgba(255,255,255,.65);transition:all .15s;
      }
      .fqp-chip.active {
        background:rgba(200,255,0,.15);border-color:rgba(200,255,0,.4);color:#c8ff00;
      }
      .fqp-slider { flex:1;accent-color:#c8ff00; }
      .fqp-slider-label { font-size:11px;color:rgba(255,255,255,.4);width:32px;text-align:right; }

      /* Background colour picker */
      .fqp-bg-row { display:flex;gap:8px;flex-wrap:wrap; }
      .fqp-bg-swatch {
        width:36px;height:36px;border-radius:10px;cursor:pointer;
        border:2px solid rgba(255,255,255,.1);transition:all .15s;flex-shrink:0;
      }
      .fqp-bg-swatch.active { border-color:#c8ff00;transform:scale(1.1); }
      .fqp-bg-swatch.custom { background:none;display:flex;align-items:center;justify-content:center;
        font-size:16px;background:rgba(255,255,255,.06); }
      #fqpCustomColour { width:0;height:0;opacity:0;position:absolute; }

      /* Stats */
      #fqpStats {
        background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);
        border-radius:12px;padding:12px 14px;margin-bottom:14px;
      }
      .fqp-stat-row { display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px; }
      .fqp-stat-row:last-child { margin-bottom:0; }
      .fqp-sk { color:rgba(255,255,255,.45); }
      .fqp-sv { font-weight:700;color:#fff; }
      .fqp-sv.lime { color:#c8ff00; }

      /* Progress */
      #fqpProgress { display:none;margin-bottom:12px; }
      #fqpBar { height:3px;background:rgba(255,255,255,.08);border-radius:999px;overflow:hidden;margin-bottom:6px; }
      #fqpFill { height:100%;width:0%;background:#c8ff00;border-radius:999px;transition:width .3s; }
      #fqpProgressLabel { font-size:11px;color:rgba(255,255,255,.45); }

      /* Buttons */
      .fqp-btn {
        width:100%;padding:13px;border-radius:13px;border:none;
        font-size:14px;font-weight:800;cursor:pointer;transition:all .15s;margin-bottom:8px;
      }
      .fqp-btn.primary { background:#c8ff00;color:#05070b; }
      .fqp-btn.primary:hover { background:#d4ff33; }
      .fqp-btn.primary:disabled { background:rgba(200,255,0,.25);color:rgba(5,7,11,.4);cursor:default; }
      .fqp-btn.ghost { background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.1);color:#fff; }
      .fqp-btn.ghost:disabled { opacity:.4;cursor:default; }
    </style>

    <div id="fqpInner">
      <div class="fqp-head">
        <div class="fqp-title">✨ Clean & Isolate</div>
        <button class="fqp-close" id="fqpClose">×</button>
      </div>

      <!-- Floater removal -->
      <div class="fqp-section">
        <span class="fqp-label">Floater removal</span>
        <div class="fqp-toggle">
          <div class="fqp-chip active" data-floater="on">On</div>
          <div class="fqp-chip"        data-floater="off">Off</div>
        </div>
        <div class="fqp-row" style="margin-top:10px;">
          <span style="font-size:12px;color:rgba(255,255,255,.5);width:80px;">Sensitivity</span>
          <input type="range" class="fqp-slider" id="fqpFloaterSens"
            min="4" max="20" value="8" step="1">
          <span class="fqp-slider-label" id="fqpFloaterSensLabel">8</span>
        </div>
        <div style="font-size:11px;color:rgba(255,255,255,.3);margin-top:2px;">
          Higher = removes more floaters. Lower = more conservative.
        </div>
      </div>

      <!-- Subject isolation -->
      <div class="fqp-section">
        <span class="fqp-label">Subject isolation</span>
        <div class="fqp-toggle">
          <div class="fqp-chip active" data-isolate="off">Full scene</div>
          <div class="fqp-chip"        data-isolate="cutout">Cutout</div>
          <div class="fqp-chip"        data-isolate="soft">Soft focus</div>
        </div>
        <div style="font-size:11px;color:rgba(255,255,255,.3);margin-top:8px;" id="fqpIsolateDesc">
          Keep the full scene as captured.
        </div>
        <div id="fqpSoftControls" style="display:none;margin-top:10px;">
          <div class="fqp-row">
            <span style="font-size:12px;color:rgba(255,255,255,.5);width:120px;">Background opacity</span>
            <input type="range" class="fqp-slider" id="fqpBgOpacity"
              min="0" max="40" value="8" step="1">
            <span class="fqp-slider-label" id="fqpBgOpacityLabel">8%</span>
          </div>
        </div>
      </div>

      <!-- Background -->
      <div class="fqp-section">
        <span class="fqp-label">Background</span>
        <div class="fqp-bg-row">
          <div class="fqp-bg-swatch active" data-bg="scene"
            style="background:linear-gradient(135deg,#1a1a2e,#16213e);"
            title="Scene (no change)"></div>
          <div class="fqp-bg-swatch" data-bg="black"
            style="background:#000;" title="Black"></div>
          <div class="fqp-bg-swatch" data-bg="white"
            style="background:#fff;" title="White"></div>
          <div class="fqp-bg-swatch" data-bg="transparent"
            style="background:repeating-conic-gradient(#888 0% 25%,#555 0% 50%) 0 0/16px 16px;"
            title="Transparent"></div>
          <div class="fqp-bg-swatch" data-bg="brand"
            style="background:#c8ff00;" title="Brand colour"></div>
          <div class="fqp-bg-swatch custom" data-bg="custom" title="Custom colour">
            🎨
            <input type="color" id="fqpCustomColour" value="#1a1a2e">
          </div>
        </div>
        <div style="font-size:11px;color:rgba(255,255,255,.3);margin-top:8px;" id="fqpBgDesc">
          Keeps the captured environment background.
        </div>
      </div>

      <!-- Stats -->
      <div id="fqpStats">
        <div class="fqp-stat-row">
          <span class="fqp-sk">Current Gaussians</span>
          <span class="fqp-sv" id="fqpStatIn">—</span>
        </div>
        <div class="fqp-stat-row">
          <span class="fqp-sk">After cleaning</span>
          <span class="fqp-sv lime" id="fqpStatOut">Run to preview</span>
        </div>
        <div class="fqp-stat-row">
          <span class="fqp-sk">Compression improvement</span>
          <span class="fqp-sv lime" id="fqpStatComp">—</span>
        </div>
      </div>

      <!-- Progress -->
      <div id="fqpProgress">
        <div id="fqpBar"><div id="fqpFill"></div></div>
        <div id="fqpProgressLabel">Starting…</div>
      </div>

      <!-- Buttons -->
      <button class="fqp-btn primary" id="fqpApplyBtn">✨ Apply & Preview</button>
      <button class="fqp-btn ghost"   id="fqpRefineBtn" disabled
        title="Pre-seed the lasso tool with the isolated region for manual refinement">
        ✏ Refine with lasso
      </button>
      <button class="fqp-btn ghost"   id="fqpExportBtn" disabled>⬇ Apply & Export .fumoc</button>
      <button class="fqp-btn ghost"   id="fqpResetBtn">↺ Reset to original</button>
    </div>
  `;
  document.body.appendChild(el);
  _wirePanel(el);
  return el;
}

function _wirePanel(panel) {
  // Close
  panel.querySelector('#fqpClose').addEventListener('click', close);
  panel.addEventListener('click', e => { if (e.target === panel) close(); });

  // Floater toggle
  let doFloaters = true;
  panel.querySelectorAll('.fqp-chip[data-floater]').forEach(chip => {
    chip.addEventListener('click', () => {
      panel.querySelectorAll('.fqp-chip[data-floater]').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      doFloaters = chip.dataset.floater === 'on';
    });
  });

  // Floater sensitivity
  panel.querySelector('#fqpFloaterSens').addEventListener('input', e => {
    panel.querySelector('#fqpFloaterSensLabel').textContent = e.target.value;
  });

  // Isolation mode
  const isolateDescs = {
    off:    'Keep the full scene as captured.',
    cutout: 'Automatically identify and isolate the main subject. Background is removed entirely.',
    soft:   'Subject stays fully sharp. Background fades to a ghost — keeps context, removes distraction.',
  };
  let isolateMode = 'off';
  panel.querySelectorAll('.fqp-chip[data-isolate]').forEach(chip => {
    chip.addEventListener('click', () => {
      panel.querySelectorAll('.fqp-chip[data-isolate]').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      isolateMode = chip.dataset.isolate;
      panel.querySelector('#fqpIsolateDesc').textContent = isolateDescs[isolateMode];
      panel.querySelector('#fqpSoftControls').style.display = isolateMode === 'soft' ? 'block' : 'none';
    });
  });

  panel.querySelector('#fqpBgOpacity').addEventListener('input', e => {
    panel.querySelector('#fqpBgOpacityLabel').textContent = e.target.value + '%';
  });

  // Background
  const bgDescs = {
    scene:       'Keeps the captured environment background.',
    black:       'Clean black background — ideal for product shots and ads.',
    white:       'Clean white background — ideal for e-commerce and print.',
    transparent: 'Transparent background — embed over any colour or image.',
    brand:       'FUMOCA brand green (#c8ff00) background.',
    custom:      'Custom colour background.',
  };
  let bgMode = 'scene';
  panel.querySelectorAll('.fqp-bg-swatch[data-bg]').forEach(swatch => {
    swatch.addEventListener('click', () => {
      panel.querySelectorAll('.fqp-bg-swatch').forEach(s => s.classList.remove('active'));
      swatch.classList.add('active');
      bgMode = swatch.dataset.bg;
      panel.querySelector('#fqpBgDesc').textContent = bgDescs[bgMode] || '';
      if (bgMode === 'custom') panel.querySelector('#fqpCustomColour').click();
    });
  });

  // Apply
  panel.querySelector('#fqpApplyBtn').addEventListener('click', () => _runPipeline(panel, {
    doFloaters, isolateMode, bgMode,
    minNeighbours: parseInt(panel.querySelector('#fqpFloaterSens').value),
    bgOpacity:     parseInt(panel.querySelector('#fqpBgOpacity').value) / 100,
    customColour:  panel.querySelector('#fqpCustomColour').value,
    exportAfter:   false,
  }));

  panel.querySelector('#fqpExportBtn').addEventListener('click', () => _runPipeline(panel, {
    doFloaters, isolateMode, bgMode,
    minNeighbours: parseInt(panel.querySelector('#fqpFloaterSens').value),
    bgOpacity:     parseInt(panel.querySelector('#fqpBgOpacity').value) / 100,
    customColour:  panel.querySelector('#fqpCustomColour').value,
    exportAfter:   true,
  }));

  panel.querySelector('#fqpResetBtn').addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('fumoca:resetSplat'));
    panel.querySelector('#fqpStatOut').textContent = 'Reset to original';
    panel.querySelector('#fqpExportBtn').disabled  = true;
  });
}

async function _runPipeline(panel, opts) {
  if (_processing) return;
  _processing = true;

  const applyBtn  = panel.querySelector('#fqpApplyBtn');
  const exportBtn = panel.querySelector('#fqpExportBtn');
  const progress  = panel.querySelector('#fqpProgress');

  applyBtn.disabled  = true;
  exportBtn.disabled = true;
  progress.style.display = 'block';

  const onProgress = (pct, label) => {
    panel.querySelector('#fqpFill').style.width          = pct + '%';
    panel.querySelector('#fqpProgressLabel').textContent = label;
  };

  try {
    // Get current gaussians from viewer
    const gaussians = window._fumocaCurrentGaussians;
    if (!gaussians) throw new Error('No splat loaded. Load a splat first.');

    const bgMap = {
      scene:       null,
      black:       'black',
      white:       'white',
      transparent: null, // handled via isolation
      brand:       [200, 255, 0],
      custom:      _hexToRgb(opts.customColour),
    };

    const result = await FumocQualityPipeline.runQualityPipeline(gaussians, {
      removeFloaters:  opts.doFloaters,
      minNeighbours:   opts.minNeighbours,
      floaterRadius:   0.15,
      isolate:         opts.isolateMode === 'off' ? false : opts.isolateMode,
      backgroundAlpha: opts.bgOpacity,
      refineOpacity:   true,
      background:      bgMap[opts.bgMode],
      onProgress,
    });

    // Update stats
    panel.querySelector('#fqpStatIn').textContent   = gaussians.N.toLocaleString();
    panel.querySelector('#fqpStatOut').textContent  = result.gaussians.N.toLocaleString();
    panel.querySelector('#fqpStatComp').textContent =
      result.stats.reductionPct > 0
        ? `~${result.stats.reductionPct}% fewer Gaussians → better compression`
        : 'No reduction';

    // Store cleaned gaussians and push to viewer
    window._fumocaCleanedGaussians = result.gaussians;
    window._fumocaCleanedSplat     = result.splatBinary;

    // Tell viewer to reload from the cleaned binary
    const blob = new Blob([result.splatBinary], { type: 'application/octet-stream' });
    const url  = URL.createObjectURL(blob);
    window.dispatchEvent(new CustomEvent('fumoca:loadUrl', { detail: { url, fromQuality: true } }));
    setTimeout(() => URL.revokeObjectURL(url), 5000);

    // Set viewer background
    _setViewerBackground(opts.bgMode, opts.customColour);

    exportBtn.disabled = false;
    applyBtn.textContent = '✓ Applied — adjust and re-apply';

    // Enable refine button if isolation was run
    const refineBtn = panel.querySelector('#fqpRefineBtn');
    if (refineBtn && result.stats.centroid) {
      refineBtn.disabled = false;
      refineBtn.onclick = () => {
        // Dispatch event so lasso bridge picks it up
        window.dispatchEvent(new CustomEvent('fumoca:subjectIsolated', {
          detail: { centroid: result.stats.centroid, radius: result.stats.radius }
        }));
        close();
      };
    }

    if (opts.exportAfter && window.FumocExportUI) {
      // Override export to use cleaned binary
      window._fumocaExportSplatBytes = () => result.splatBinary.buffer;
      close();
      FumocExportUI.open();
    }

  } catch (err) {
    console.error('[QualityPanel]', err);
    panel.querySelector('#fqpProgressLabel').textContent = '⚠ ' + err.message;
  } finally {
    _processing    = false;
    applyBtn.disabled = false;
    progress.style.display = 'none';
  }
}

function _setViewerBackground(mode, customColour) {
  const canvas = document.querySelector('#stage canvas');
  if (!canvas) return;
  const renderer = window._fumocaRenderer;
  if (!renderer) return;

  const colours = {
    black:       [0,   0,   0  ],
    white:       [1,   1,   1  ],
    brand:       [0.78,1,   0  ],
    transparent: null,
    custom:      customColour ? _hexToRgbNorm(customColour) : null,
  };

  if (mode === 'scene') {
    renderer.setClearColor?.(0x05070b, 1);
  } else if (mode === 'transparent') {
    renderer.setClearAlpha?.(0);
    canvas.style.background = 'transparent';
  } else {
    const c = colours[mode];
    if (c) renderer.setClearColor?.(
      (Math.round(c[0]*255) << 16) | (Math.round(c[1]*255) << 8) | Math.round(c[2]*255),
      1
    );
  }
}

function _hexToRgb(hex) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return [r, g, b];
}

function _hexToRgbNorm(hex) {
  const [r,g,b] = _hexToRgb(hex);
  return [r/255, g/255, b/255];
}

// ── Public ─────────────────────────────────────────────────────────────────────

function open() {
  if (!_panel) _panel = _build();
  _panel.classList.add('open');

  // Populate current Gaussian count
  const g = window._fumocaCurrentGaussians;
  const el = document.getElementById('fqpStatIn');
  if (el && g) el.textContent = g.N.toLocaleString();
}

function close() { _panel?.classList.remove('open'); }

const FumocQualityUI = { open, close };
window.FumocQualityUI = FumocQualityUI;
export default FumocQualityUI;
