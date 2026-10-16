import FumocMeshExtractor from './fumoc-mesh-extractor.js';
import { exportSelectionAsFigurine, pollPrintJob } from './print-export.js';
import r2 from '../r2Client.js';
import { supabase } from '../supabaseClient.js';

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
      <div class="sec-head"><span class="sec-label">Mesh from points</span><span class="sec-badge">LOCAL</span></div>
      <div class="sec-body">
        <div class="hint">Build a surface from the current live NIF, PLY, or LiDAR points. PLY and OBJ keep transferred vertex color; STL is for printing.</div>
        <div class="hint" style="margin-top:5px">The colored mesh is stored in NIF beside the original splats. Use the layer switches to inspect either representation or overlay them.</div>
        <div class="ctrl-row">
          <span class="ctrl-label">Surface detail</span>
        <span class="ctrl-val" id="meshResVal">32³</span>
        </div>
        <input type="range" id="meshRes" min="64" max="160" step="32" value="128">
        <label style="display:block;font-size:11px;margin-top:8px">Surface continuity <span id="meshContinuityVal" style="float:right;color:var(--neon)">1.50x</span>
          <input id="meshContinuity" type="range" min="0.75" max="2.5" step="0.05" value="1.5" style="display:block;width:100%">
        </label>
        <div class="hint">Lower keeps sharper gaps and panel edges. Higher blends sparse areas and may soften detail. It cannot recover surfaces the capture never saw.</div>
        <label style="display:block;font-size:11px;margin-top:8px">Surface threshold (0 = automatic)
          <input id="meshThreshold" type="number" min="0" max="10" step="0.01" value="0" style="display:block;width:100%;padding:7px;border-radius:7px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:#fff;margin-top:4px">
        </label>
        <label style="display:block;font-size:11px">Smoothing passes
          <input id="meshSmooth" type="range" min="0" max="4" step="1" value="1" style="width:100%">
        </label>
        <div class="hint">Higher detail preserves finer surfaces but takes longer and uses more memory. 160³ is the high-detail browser setting. Smoothing uses a size-preserving pass. Closed results still depend on capture coverage.</div>
        <label style="display:block;font-size:11px;margin:8px 0 6px">Mesh format
          <select id="meshFormat" style="display:block;width:100%;padding:8px;border-radius:8px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:#fff;margin-top:4px">
            <option value="ply">Colored PLY - keep scene scale</option>
            <option value="obj">Colored OBJ - keep scene scale</option>
            <option value="stl">STL - scale to print height</option>
          </select>
        </label>
        <label style="display:flex;align-items:center;gap:7px;font-size:11px;margin:6px 0"><input id="meshPreviewToggle" type="checkbox" disabled> Show mesh object</label>
        <label style="display:flex;align-items:center;gap:7px;font-size:11px;margin:6px 0"><input id="meshSplatLayerToggle" type="checkbox" checked> Show splat object</label>
        <label style="display:block;font-size:11px">Preview light <input id="meshPreviewLight" type="range" min="0" max="2" step="0.05" value="0.25" style="width:100%"></label>
        <label style="display:block;font-size:11px">Surface roughness <input id="meshPreviewRoughness" type="range" min="0.05" max="1" step="0.05" value="0.72" style="width:100%"></label>
        <label style="display:block;font-size:11px">Metalness <input id="meshPreviewMetalness" type="range" min="0" max="1" step="0.05" value="0.05" style="width:100%"></label>
        <label style="display:block;font-size:11px;margin:8px 0">Cap boundary loops up to <input id="meshHoleSize" type="number" min="3" max="128" step="1" value="48" style="width:64px;padding:4px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:#fff"> edges</label>
        <label style="display:block;font-size:11px;margin:8px 0">Remove islands smaller than <input id="meshFloaterSize" type="number" min="1" max="10000" step="1" value="32" style="width:72px;padding:4px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:#fff"> faces</label>
        <div class="btn-grid col2" style="margin-top:8px">
          <button type="button" class="ac-btn lime full" id="meshExtractBtn">Extract mesh</button>
          <button type="button" class="ac-btn full" id="meshFillHolesBtn" disabled>Fill small mesh holes</button>
          <button type="button" class="ac-btn full" id="meshRemoveFloatersBtn" disabled>Remove small islands</button>
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
        <div class="hint">STL is enabled only for one connected, watertight shell. The worker reports mesh repairs and limitations.</div>
        <div class="btn-grid col2">
          <button type="button" class="ac-btn cyan full" id="printStlBtn" disabled>Download STL</button>
          <button type="button" class="ac-btn full" id="printQueueBtn">Queue GPU print</button>
        </div>
        <button type="button" class="ac-btn lime full" id="saveMeshBtn" disabled style="margin-top:7px">Save colored PLY to Library</button>
        <div class="hint" id="meshPrintStatus" style="margin-top:8px">Load a splat or PLY to begin.</div>
      </div>
    </div>
  `;

  container.querySelector('#meshRes')?.addEventListener('input', (e) => {
    const el = container.querySelector('#meshResVal');
    if (el) el.textContent = `${e.target.value}³`;
  });
  const initialResolutionLabel = container.querySelector('#meshResVal');
  if (initialResolutionLabel) initialResolutionLabel.textContent = `${container.querySelector('#meshRes')?.value || 48}${String.fromCharCode(179)}`;
  container.querySelector('#meshContinuity')?.addEventListener('input', (e) => {
    const label = container.querySelector('#meshContinuityVal');
    if (label) label.textContent = `${Number(e.target.value).toFixed(2)}x`;
  });
  const presetHeights = { product: 120, figurine: 120, bust: 150, large: 200 };
  const height = container.querySelector('#printH');
  const heightLabel = container.querySelector('#printHVal');
  container.querySelector('#printPreset')?.addEventListener('change', (e) => {
    height.value = presetHeights[e.target.value] || 120;
    if (heightLabel) heightLabel.textContent = height.value;
  });
  height?.addEventListener('input', (e) => {
    const el = container.querySelector('#printHVal');
    if (el) el.textContent = e.target.value;
  });

  let lastMesh = null;
  let lastMeshFormat = 'ply';
  let lastMeshData = null;
  let lastMeshStats = null;
  const syncNifMesh = (mesh) => {
    lastMeshData = mesh || null;
    const previewToggle = container.querySelector('#meshPreviewToggle');
    if (previewToggle) {
      previewToggle.disabled = !lastMeshData;
      previewToggle.checked = !!lastMeshData;
    }
    if (lastMeshData) {
      window.previewSolidMesh?.(lastMeshData, { visible: true });
      lastMeshStats = FumocMeshExtractor.validateWatertight(lastMeshData);
      lastMesh = makeMeshBlob();
      const splatToggle = container.querySelector('#meshSplatLayerToggle');
      if (splatToggle) splatToggle.checked = false;
      if (window.S?.points) window.S.points.visible = false;
      container.querySelector('#meshFillHolesBtn').disabled = false;
      container.querySelector('#meshRemoveFloatersBtn').disabled = false;
      container.querySelector('#saveMeshBtn').disabled = !lastMeshData.colours;
      container.querySelector('#printStlBtn').disabled = lastMeshFormat === 'stl' && !lastMeshStats.printable;
      meshStatus('Loaded NIF mesh component. Toggle its preview here; it remains separate from the splats.');
    }
  };
  window.addEventListener('fumoca:nifMeshLoaded', (event) => syncNifMesh(event.detail?.mesh));
  const updateMeshPreview = () => window.previewSolidMesh?.(lastMeshData, {
    visible: !!container.querySelector('#meshPreviewToggle')?.checked,
    light: Number(container.querySelector('#meshPreviewLight')?.value || 0.25),
    roughness: Number(container.querySelector('#meshPreviewRoughness')?.value || 0.72),
    metalness: Number(container.querySelector('#meshPreviewMetalness')?.value || 0.05),
  });
  container.querySelector('#meshPreviewToggle')?.addEventListener('change', updateMeshPreview);
  container.querySelector('#meshSplatLayerToggle')?.addEventListener('change', (event) => {
    if (window.S?.points) window.S.points.visible = event.target.checked;
  });
  ['#meshPreviewLight', '#meshPreviewRoughness', '#meshPreviewMetalness'].forEach(selector => container.querySelector(selector)?.addEventListener('input', updateMeshPreview));
  const meshStatus = (message) => {
    const el = container.querySelector('#meshPrintStatus');
    if (el) el.textContent = message;
    onStatus?.(message);
  };
  const makeMeshBlob = () => {
    if (!lastMeshData) return null;
    if (lastMeshFormat === 'obj') return FumocMeshExtractor.exportOBJ(lastMeshData, 'fumoca-mesh');
    if (lastMeshFormat === 'ply') return FumocMeshExtractor.exportPLY(lastMeshData, 'fumoca-mesh');
    const printMesh = { ...lastMeshData, vertices: lastMeshData.vertices.slice() };
    let minY = Infinity, maxY = -Infinity;
    for (let i = 1; i < printMesh.vertices.length; i += 3) { minY = Math.min(minY, printMesh.vertices[i]); maxY = Math.max(maxY, printMesh.vertices[i]); }
    const factor = Number(height?.value || 120) / Math.max(maxY - minY, 1e-6);
    for (let i = 0; i < printMesh.vertices.length; i += 3) {
      printMesh.vertices[i] *= factor;
      printMesh.vertices[i + 1] = (printMesh.vertices[i + 1] - minY) * factor;
      printMesh.vertices[i + 2] *= factor;
    }
    return FumocMeshExtractor.exportSTL(printMesh, 'fumoca-mesh');
  };
  const refreshMeshAfterRepair = (message) => {
    if (!lastMeshData) return;
    window.S.nifMesh = lastMeshData;
    lastMeshStats = { ...lastMeshStats, ...FumocMeshExtractor.validateWatertight(lastMeshData),
      vertices: lastMeshData.vertices.length / 3, triangles: lastMeshData.triangles.length / 3 };
    lastMesh = makeMeshBlob();
    window.previewSolidMesh?.(lastMeshData, { visible: true,
      light: Number(container.querySelector('#meshPreviewLight')?.value || 0.25),
      roughness: Number(container.querySelector('#meshPreviewRoughness')?.value || 0.72),
      metalness: Number(container.querySelector('#meshPreviewMetalness')?.value || 0.05) });
    window.dispatchEvent(new CustomEvent('fumoca:solidMeshReady', { detail: { mesh: lastMeshData, stats: lastMeshStats } }));
    meshStatus(`${message} Mesh now has ${lastMeshStats.triangles.toLocaleString()} faces; ${lastMeshStats.watertight ? 'watertight' : `${lastMeshStats.openEdges} open edges remain`}.`);
  };
  if (window.S?.nifMesh) syncNifMesh(window.S.nifMesh);

  const extractMesh = async () => {
    const state = window.S;
    if (!state?.positions || !state?.alive) { meshStatus('Load a splat or PLY before extracting a mesh.'); return false; }
    if (lastMeshData) window.previewSolidMesh?.(lastMeshData, { visible: false });
    lastMesh = null;
    lastMeshData = null;
    lastMeshStats = null;
    container.querySelector('#saveMeshBtn').disabled = true;
    container.querySelector('#printStlBtn').disabled = true;
    container.querySelector('#meshFillHolesBtn').disabled = true;
    container.querySelector('#meshRemoveFloatersBtn').disabled = true;
    container.querySelector('#meshPreviewToggle').checked = false;
    container.querySelector('#meshPreviewToggle').disabled = true;
    meshStatus('Preparing current live points…');
    try {
      const maxPoints = 250_000;
      const ids = [];
      let skippedSeen=0,randomState=((state.alive.length^0x6d2b79f5)>>>0)||1;
      for(let i=0;i<state.alive.length;i++)if(state.alive[i]){
        if(ids.length<maxPoints){ids.push(i);continue;}
        skippedSeen++;
        randomState^=randomState<<13;randomState^=randomState>>>17;randomState^=randomState<<5;
        const pick=(randomState>>>0)%(ids.length+skippedSeen);
        if(pick<ids.length)ids[pick]=i;
      }
      ids.sort((a,b)=>a-b);
      if (ids.length < 50) throw new Error('At least 50 live points are needed for mesh extraction.');
      const g = { N: ids.length };
      for (const key of ['posX','posY','posZ','sclX','sclY','sclZ','rotW','rotX','rotY','rotZ','colR','colG','colB','colA']) g[key] = new Float32Array(ids.length);
      ids.forEach((i, row) => {
        const sx = Math.max(0.0001, Number(state.scaleXYZ?.[i * 3]) || Number(state.scale?.[i]) || 0.01);
        const sy = Math.max(0.0001, Number(state.scaleXYZ?.[i * 3 + 1]) || Number(state.scale?.[i]) || 0.01);
        const sz = Math.max(0.0001, Number(state.scaleXYZ?.[i * 3 + 2]) || Number(state.scale?.[i]) || 0.01);
        g.posX[row] = state.positions[i * 3]; g.posY[row] = state.positions[i * 3 + 1]; g.posZ[row] = state.positions[i * 3 + 2];
        g.sclX[row] = Math.log(sx); g.sclY[row] = Math.log(sy); g.sclZ[row] = Math.log(sz);
        const q = state.rotation;
        g.rotW[row] = q?.[i * 4] ?? 1; g.rotX[row] = q?.[i * 4 + 1] ?? 0;
        g.rotY[row] = q?.[i * 4 + 2] ?? 0; g.rotZ[row] = q?.[i * 4 + 3] ?? 0;
        // LiDAR attribute palettes are only a viewport visualization. Keep
        // mesh vertex color tied to the source RGB, unless the user painted it.
        const meshColors = state.colors;
        const paint = state.paintColors;
        g.colR[row] = (paint?.[i * 3] >= 0 ? paint[i * 3] : (meshColors?.[i * 3] ?? 0.7)) * 255;
        g.colG[row] = (paint?.[i * 3 + 1] >= 0 ? paint[i * 3 + 1] : (meshColors?.[i * 3 + 1] ?? 0.7)) * 255;
        g.colB[row] = (paint?.[i * 3 + 2] >= 0 ? paint[i * 3 + 2] : (meshColors?.[i * 3 + 2] ?? 0.7)) * 255;
        g.colA[row] = (state.opacity?.[i] ?? 1) * 255;
      });
      const resolution = Number(container.querySelector('#meshRes')?.value || 32);
      const format = container.querySelector('#meshFormat')?.value || 'ply';
      const thresholdValue = Number(container.querySelector('#meshThreshold')?.value || 0);
      const sigmaScale = Number(container.querySelector('#meshContinuity')?.value || 1.5);
      const smooth = Number(container.querySelector('#meshSmooth')?.value || 0);
      const result = await FumocMeshExtractor.extractMesh(g, {
        resolution, threshold: thresholdValue > 0 ? thresholdValue : null, sigmaScale,
        format, previewColours: true, name: 'fumoca-mesh', smooth,
        onProgress: (_pct, label) => meshStatus(label),
      });
      lastMeshData = { ...result.mesh, vertices: result.mesh.vertices.slice(), triangles: result.mesh.triangles.slice(), colours: result.mesh.colours?.slice() };
      // Preserve the extracted surface as a separate NIF mesh component.
      if (window.S) window.S.nifMesh = lastMeshData;
      if (format === 'stl') {
        // Print scaling belongs only to the STL download, not the scene mesh
        // retained for NIF export or preview.
        const exportMesh = { ...result.mesh, vertices: result.mesh.vertices.slice() };
        let minY = Infinity, maxY = -Infinity;
        for (let i = 1; i < exportMesh.vertices.length; i += 3) { minY = Math.min(minY, exportMesh.vertices[i]); maxY = Math.max(maxY, exportMesh.vertices[i]); }
        const factor = Number(height?.value || 120) / Math.max(maxY - minY, 1e-6);
        for (let i = 0; i < exportMesh.vertices.length; i += 3) {
          exportMesh.vertices[i] *= factor;
          exportMesh.vertices[i + 1] = (exportMesh.vertices[i + 1] - minY) * factor;
          exportMesh.vertices[i + 2] *= factor;
        }
        lastMesh = FumocMeshExtractor.exportSTL(exportMesh, 'fumoca-mesh');
      }
      lastMeshFormat = format;
      lastMeshStats = result.stats;
      if (format !== 'stl') lastMesh = format === 'obj' ? FumocMeshExtractor.exportOBJ(result.mesh, 'fumoca-mesh')
        : FumocMeshExtractor.exportPLY(result.mesh, 'fumoca-mesh');
      const shellStatus = result.stats.watertight
        ? (result.stats.components === 1 ? 'one connected watertight shell' : `${result.stats.components} disconnected watertight shells`)
        : `open surface — ${result.stats.openEdges} open edges${result.stats.components > 1 ? ` across ${result.stats.components} shells` : ''}`;
      const colorNote = format === 'stl' ? ', color kept in preview (STL stores geometry only)' : ', vertex color transferred';
      meshStatus(`Mesh ready: ${result.stats.triangles.toLocaleString()} triangles, ${(lastMesh.size / 1048576).toFixed(2)} MB, ${shellStatus}${colorNote}.`);
      const downloadButton = container.querySelector('#printStlBtn');
      downloadButton.disabled = format === 'stl' && !result.stats.printable;
      downloadButton.textContent = downloadButton.disabled ? 'STL needs one closed shell' : `Download ${format.toUpperCase()}`;
      const previewToggle = container.querySelector('#meshPreviewToggle');
      previewToggle.disabled = false;
      previewToggle.checked = true;
      container.querySelector('#meshFillHolesBtn').disabled = false;
      container.querySelector('#meshRemoveFloatersBtn').disabled = false;
      const splatToggle = container.querySelector('#meshSplatLayerToggle');
      if (splatToggle) splatToggle.checked = false;
      if (state.points) state.points.visible = false;
      updateMeshPreview();
      window.dispatchEvent(new CustomEvent('fumoca:solidMeshReady', { detail: { mesh: lastMeshData, stats: lastMeshStats } }));
      container.querySelector('#saveMeshBtn').disabled = !result.mesh.colours;
      return lastMeshData;
    } catch (err) {
      meshStatus(err.message || String(err));
      return false;
    }
  };
  window.FUMOCA_StudioMeshPrint = { mountMeshPrintPanel, extractMesh, get lastStats() { return lastMeshStats; } };
  container.querySelector('#meshExtractBtn')?.addEventListener('click', extractMesh);

  container.querySelector('#meshFillHolesBtn')?.addEventListener('click', () => {
    if (!lastMeshData) return meshStatus('Extract a mesh before repairing mesh holes.');
    const result = FumocMeshExtractor.fillSmallHoles(lastMeshData, Number(container.querySelector('#meshHoleSize')?.value || 48));
    if (!result.filledLoops) return meshStatus('No small, unbranched boundary loops were found. Larger or complex gaps need a reconstruction pass.');
    lastMeshData = result.mesh;
    refreshMeshAfterRepair(`Capped ${result.filledLoops} small boundary loop${result.filledLoops === 1 ? '' : 's'} (${result.filledTriangles} faces).`);
  });

  container.querySelector('#meshRemoveFloatersBtn')?.addEventListener('click', () => {
    if (!lastMeshData) return meshStatus('Extract a mesh before removing mesh islands.');
    const result = FumocMeshExtractor.removeSmallComponents(lastMeshData, Number(container.querySelector('#meshFloaterSize')?.value || 32));
    if (!result.removedTriangles) return meshStatus('No disconnected mesh islands are below that face threshold.');
    lastMeshData = result.mesh;
    refreshMeshAfterRepair(`Removed ${result.removedComponents} small island${result.removedComponents === 1 ? '' : 's'} (${result.removedTriangles} faces).`);
  });

  container.querySelector('#saveMeshBtn')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    if (!lastMeshData?.colours) return meshStatus('Extract a colored mesh first.');
    button.disabled = true;
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) throw new Error('Sign in before saving a mesh to your library.');
      const parent = window._fumocaCurrentRecord || {};
      const blob = FumocMeshExtractor.exportPLY(lastMeshData, 'fumoca-mesh');
      const filePath = `${user.id}/${Date.now()}_solid_mesh.ply`;
      meshStatus('Uploading colored mesh to your library...');
      const { publicUrl, fileKey, error: uploadError } = await r2.from('nif-files').upload(filePath, blob, { contentType: 'model/x-ply' });
      if (uploadError || !fileKey || !publicUrl) throw new Error(uploadError?.message || 'Mesh upload did not return a file URL.');
      const { data: record, error: dbError } = await supabase.from('nif_files').insert([{
        user_id: user.id,
        title: `${parent.title || 'Scene'} - Solid mesh`,
        description: 'Colored solid mesh extracted in FUMOCA Studio.',
        vertical: parent.vertical || 'other',
        r2_key: fileKey,
        file_size: blob.size,
        thumbnail_url: parent.thumbnail_url || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        meta: {
          source_type: 'direct_mesh',
          source_scene_id: parent.id || null,
          source_capture: parent.meta?.source_capture || null,
          nif_url: publicUrl,
          output_url: publicUrl,
          status: 'done',
          processing_stage: 'published',
          processing_progress: 100,
          mesh_stats: {
            vertices: lastMeshData.vertices.length / 3,
            triangles: lastMeshData.triangles.length / 3,
            watertight: lastMeshStats?.watertight ?? null,
            components: lastMeshStats?.components ?? null,
            resolution: lastMeshStats?.resolution ?? null,
            threshold: lastMeshStats?.threshold ?? null,
            sigma_scale: lastMeshStats?.sigmaScale ?? null,
            smoothing: lastMeshStats?.smoothing ?? null,
          },
        },
      }]).select().single();
      if (dbError) throw dbError;
      meshStatus('Colored mesh saved to your library.');
      const status = container.querySelector('#meshPrintStatus');
      const link = document.createElement('a');
      link.href = `viewer.html?nifId=${encodeURIComponent(record.id)}`;
      link.textContent = ' Open saved mesh in viewer';
      link.style.cssText = 'display:inline-block;margin-left:6px;color:#58e8ff;text-decoration:underline';
      status?.append(link);
    } catch (err) {
      meshStatus(err.message || String(err));
      button.disabled = false;
    }
  });

  container.querySelector('#printStlBtn')?.addEventListener('click', () => {
    if (!lastMesh) return meshStatus('Extract a local mesh first.');
    const url = URL.createObjectURL(lastMesh);
    const a = document.createElement('a');
    a.href = url; a.download = `fumoca-mesh.${lastMeshFormat}`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    meshStatus(`${lastMeshFormat.toUpperCase()} download started.`);
  });

  container.querySelector('#printQueueBtn')?.addEventListener('click', async () => {
    const btn = container.querySelector('#printQueueBtn');
    btn.disabled = true;
    try {
      const jobId = await exportSelectionAsFigurine({
        title: window._fumocaCurrentRecord?.title || 'FUMOCA print export',
        preset: container.querySelector('#printPreset')?.value || 'product',
        heightMm: Number(height?.value || 120),
        onStatus: meshStatus,
      });
      meshStatus(`Print job ${jobId.slice(0, 8)} queued. Watching worker progress…`);
      pollPrintJob(jobId, (job) => {
        const terminal = ['complete','failed','needs_retry'].includes(job.status);
        meshStatus(`Print job ${String(job.status || 'queued')}: ${Number(job.progress || 0)}%${job.error_message ? ` — ${job.error_message}` : ''}`);
        if (terminal) {
          btn.disabled = false;
          if (job.status === 'complete' && job.meta?.stl_url) {
            const status = container.querySelector('#meshPrintStatus');
            const link = document.createElement('a');
            link.href = job.meta.stl_url;
            link.download = 'fumoca-print.stl';
            link.textContent = ' Download STL';
            link.style.cssText = 'display:inline-block;margin-left:6px;color:#58e8ff;text-decoration:underline';
            status?.append(link);
            if (job.meta.print_warning) status?.append(document.createTextNode(` ${job.meta.print_warning}`));
          }
        }
      });
    } catch (err) {
      meshStatus(err.message || String(err));
      btn.disabled = false;
    }
  });

}

if (typeof window !== 'undefined') {
  window.FUMOCA_StudioMeshPrint = { mountMeshPrintPanel };
}
