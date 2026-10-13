/**
 * Studio Mesh & Print panel
 *
 * Wires existing fumoc-mesh-* / print-export / gap-filler into a calm UI:
 *  Extract mesh → fill holes → quality preset → export STL / queue print job
 */

export function mountMeshPrintPanel(container, { onStatus } = {}) {
  if (!container) return;

  container.innerHTML = `
    <div class="section">
      <div class="sec-head"><span class="sec-label">Mesh from splat</span><span class="sec-badge">GPU / LOCAL</span></div>
      <div class="sec-body">
        <div class="hint">Extract a solid mesh for inspection or 3D print. Best after Clean + Sparse boost.</div>
        <div class="ctrl-row">
          <span class="ctrl-label">Resolution</span>
          <span class="ctrl-val" id="meshResVal">Med</span>
        </div>
        <input type="range" id="meshRes" min="0" max="2" step="1" value="1">
        <div class="btn-grid col2" style="margin-top:8px">
          <button type="button" class="ac-btn lime full" id="meshExtractBtn">Extract mesh</button>
          <button type="button" class="ac-btn full" id="meshFillHolesBtn">Fill holes</button>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="sec-head"><span class="sec-label">Print prep</span></div>
      <div class="sec-body">
        <div class="ctrl-row">
          <span class="ctrl-label">Preset</span>
        </div>
        <select id="printPreset" style="width:100%;padding:8px;border-radius:8px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:#fff;margin-bottom:8px">
          <option value="product">Product / vehicle detail</option>
          <option value="figurine">Figurine / miniature</option>
          <option value="bust">Bust / portrait</option>
          <option value="large">Large display (lower res)</option>
        </select>
        <div class="ctrl-row">
          <span class="ctrl-label">Target height (mm)</span>
          <span class="ctrl-val" id="printHVal">120</span>
        </div>
        <input type="range" id="printH" min="30" max="400" value="120">
        <label style="display:flex;align-items:center;gap:8px;margin:8px 0;font-size:12px;color:rgba(255,255,255,.7)">
          <input type="checkbox" id="printHollow" checked> Hollow with escape holes
        </label>
        <div class="btn-grid col2">
          <button type="button" class="ac-btn cyan full" id="printStlBtn">Download STL</button>
          <button type="button" class="ac-btn full" id="printQueueBtn">Queue GPU print</button>
        </div>
        <div class="hint" style="margin-top:8px">GPU print uses the NIF print pipeline (Marching Cubes → repair → hollow). Local STL uses current mesh if available.</div>
      </div>
    </div>
  `;

  const resLabel = ['Low', 'Med', 'High'];
  container.querySelector('#meshRes')?.addEventListener('input', (e) => {
    const el = container.querySelector('#meshResVal');
    if (el) el.textContent = resLabel[Number(e.target.value)] || 'Med';
  });
  container.querySelector('#printH')?.addEventListener('input', (e) => {
    const el = container.querySelector('#printHVal');
    if (el) el.textContent = e.target.value;
  });

  container.querySelector('#meshExtractBtn')?.addEventListener('click', async () => {
    onStatus?.('Extracting mesh…');
    try {
      if (typeof window.FUMOCA_MeshExtractor?.extract === 'function') {
        await window.FUMOCA_MeshExtractor.extract({
          resolution: Number(container.querySelector('#meshRes')?.value ?? 1),
        });
        onStatus?.('Mesh extracted');
      } else if (typeof window.extractMeshFromStudio === 'function') {
        await window.extractMeshFromStudio();
        onStatus?.('Mesh extracted');
      } else {
        onStatus?.('Mesh extractor module not loaded yet — use Clean first, then retry');
      }
    } catch (err) {
      onStatus?.(err.message || String(err));
    }
  });

  container.querySelector('#meshFillHolesBtn')?.addEventListener('click', async () => {
    onStatus?.('Filling holes…');
    try {
      if (typeof window.FUMOCA_GapFiller?.fillHoles === 'function') {
        await window.FUMOCA_GapFiller.fillHoles();
        onStatus?.('Holes filled');
      } else if (typeof window.fillMeshHoles === 'function') {
        await window.fillMeshHoles();
        onStatus?.('Holes filled');
      } else {
        onStatus?.('Gap filler not loaded — run AI Clean, then try again');
      }
    } catch (err) {
      onStatus?.(err.message || String(err));
    }
  });

  container.querySelector('#printStlBtn')?.addEventListener('click', async () => {
    onStatus?.('Building STL…');
    try {
      const preset = container.querySelector('#printPreset')?.value;
      const heightMm = Number(container.querySelector('#printH')?.value || 120);
      const hollow = container.querySelector('#printHollow')?.checked;
      if (typeof window.FUMOCA_PrintExport?.downloadSTL === 'function') {
        await window.FUMOCA_PrintExport.downloadSTL({ preset, heightMm, hollow });
        onStatus?.('STL download started');
      } else {
        onStatus?.('Print export module not wired — export PLY and use the GPU print pipeline');
      }
    } catch (err) {
      onStatus?.(err.message || String(err));
    }
  });

  container.querySelector('#printQueueBtn')?.addEventListener('click', async () => {
    onStatus?.('Queueing print job…');
    try {
      const preset = container.querySelector('#printPreset')?.value;
      const heightMm = Number(container.querySelector('#printH')?.value || 120);
      if (typeof window.FUMOCA_PrintExport?.queuePrintJob === 'function') {
        await window.FUMOCA_PrintExport.queuePrintJob({ preset, heightMm });
        onStatus?.('Print job queued');
      } else {
        onStatus?.('Queue helper not available — ensure Supabase + worker are configured');
      }
    } catch (err) {
      onStatus?.(err.message || String(err));
    }
  });
}

if (typeof window !== 'undefined') {
  window.FUMOCA_StudioMeshPrint = { mountMeshPrintPanel };
}
