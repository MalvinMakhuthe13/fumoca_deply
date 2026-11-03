import FumocMeshExtractor from './fumoc-mesh-extractor.js';
import { computeGaussianSourceSignature, compareGaussianSourceSignature } from './dual-surface-contract.js';
import { exportSelectionAsFigurine, reconstructSceneWithOrientedSurfels, pollPrintJob } from './print-export.js';
import { decodeNif } from './nif-format.js';
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
        <label style="display:block;font-size:11px;margin-top:8px">Density bridging passes <span id="meshDensitySmoothingVal" style="float:right;color:var(--neon)">1</span>
          <input id="meshDensitySmoothing" type="range" min="0" max="3" step="1" value="1" style="width:100%">
        </label>
        <div class="hint">Bridges only small density cavities with support from multiple opposing directions. A single gap between two separate nearby sheets is not enough to trigger a bridge. This does not invent unseen geometry.</div>
        <label style="display:block;font-size:11px">Mesh smoothing passes
          <input id="meshSmooth" type="range" min="0" max="4" step="1" value="1" style="width:100%">
        </label>
        <div class="hint">This smooths the extracted triangles after reconstruction. It is separate from density bridging and cannot close large holes. Closed results still depend on capture coverage.</div>
        <label style="display:block;font-size:11px;margin:8px 0 6px">Mesh format
          <select id="meshFormat" style="display:block;width:100%;padding:8px;border-radius:8px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:#fff;margin-top:4px">
            <option value="ply">Colored PLY - keep scene scale</option>
            <option value="obj">Colored OBJ - keep scene scale</option>
            <option value="stl">STL - scale to print height</option>
          </select>
        </label>
        <label style="display:flex;align-items:center;gap:7px;font-size:11px;margin:6px 0"><input id="meshPreviewToggle" type="checkbox" disabled> Show solid mesh</label>
        <label style="display:flex;align-items:center;gap:7px;font-size:11px;margin:6px 0"><input id="meshSplatLayerToggle" type="checkbox" checked> Show original Gaussian splat</label>
        <label style="display:flex;align-items:center;gap:7px;font-size:11px;margin:8px 0 4px"><input id="meshSelectedOnly" type="checkbox"> Extract selected splats only</label>
        <div class="hint" id="meshSelectionStatus" style="margin:4px 0">0 live points selected</div>
        <div id="meshDiagnostics" class="hint" style="margin:8px 0;padding:8px;border:1px solid rgba(255,255,255,.12);border-radius:7px">No mesh diagnostics yet. Extract a mesh to inspect its topology.</div>
        <div id="meshComponentsPanel" style="display:none;margin:8px 0;padding:8px;border:1px solid rgba(255,255,255,.12);border-radius:7px">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:7px">
            <strong style="font-size:11px">Independent scene components</strong>
            <span id="meshComponentsCount" class="hint">0</span>
          </div>
          <div style="display:flex;gap:5px;margin-bottom:7px">
            <button type="button" id="meshComponentsShowAll" class="mini-btn">Show all</button>
            <button type="button" id="meshComponentsHideAll" class="mini-btn">Hide all</button>
            <button type="button" id="meshComponentDelete" class="mini-btn" disabled>Delete selected</button>
          </div>
          <div id="meshComponentsList" style="display:grid;gap:5px"></div>
          <div class="hint" style="margin-top:6px">Each connected surface has independent visibility and selection. Selecting a component highlights it; deleting removes only that component from the scene geometry.</div>
        </div>
        <div class="hint">Depth-aware lasso/box selection adds only the visible surface layer. Rotate and select again from other sides to build the complete object selection. Hold Shift to add and Alt to subtract; check the live point count before enabling selected-only extraction. The source splat is never deleted or changed.</div>
        <label style="display:block;font-size:11px;margin-top:8px">Hybrid mesh opacity <span id="meshPreviewOpacityVal" style="float:right;color:var(--neon)">38%</span>
          <input id="meshPreviewOpacity" type="range" min="0.05" max="1" step="0.01" value="0.38" style="width:100%">
        </label>
        <div class="hint">Keep both layers enabled to compare the reconstructed surface against the untouched splat. Lower opacity reveals the original Gaussian detail through the solid surface.</div>
        <label style="display:block;font-size:11px">Preview light <input id="meshPreviewLight" type="range" min="0" max="2" step="0.05" value="0.25" style="width:100%"></label>
        <label style="display:block;font-size:11px">Surface roughness <input id="meshPreviewRoughness" type="range" min="0.05" max="1" step="0.05" value="0.72" style="width:100%"></label>
        <label style="display:block;font-size:11px">Metalness <input id="meshPreviewMetalness" type="range" min="0" max="1" step="0.05" value="0.05" style="width:100%"></label>
        <label style="display:block;font-size:11px;margin:8px 0">Cap boundary loops up to <input id="meshHoleSize" type="number" min="3" max="128" step="1" value="48" style="width:64px;padding:4px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:#fff"> edges</label>
        <label style="display:block;font-size:11px;margin:8px 0">Remove noise islands smaller than <input id="meshFloaterSize" type="number" min="0" max="10000" step="1" value="0" style="width:72px;padding:4px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:#fff"> faces</label>
        <div class="hint">Set to 0 to preserve every disconnected component during full-scene extraction. Remove tiny islands later only after inspecting the scene; small components may be real objects or details.</div>
        <div class="hint" style="margin:8px 0">For the oriented-surfel TSDF path, send the complete live scene to the reconstruction worker. It preserves scene coordinates, returns separate mesh components, and leaves the original Gaussian layer untouched.</div>
        <button type="button" class="ac-btn cyan full" id="meshOrientedReconstructBtn">Reconstruct full scene · oriented surfels</button>
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
  const selectionStatus = container.querySelector('#meshSelectionStatus');
  const updateSelectionStatus = (event) => {
    const count = Number(event?.detail?.count ?? window.S?.selected?.reduce?.((sum, value, index) => sum + (value && window.S?.alive?.[index] ? 1 : 0), 0) ?? 0);
    if (selectionStatus) selectionStatus.textContent = `${count.toLocaleString()} live points selected`;
  };
  window.addEventListener('fumoca:selectionChanged', updateSelectionStatus);
  updateSelectionStatus();
  container.querySelector('#meshDensitySmoothing')?.addEventListener('input', (e) => {
    const label = container.querySelector('#meshDensitySmoothingVal');
    if (label) label.textContent = String(Number(e.target.value));
  });
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
  let lastMeshSourceSignature = null;
  const checkSourceFreshness = () => {
    if (!window.S?.nifMesh && !window.S?.nifMeshComponents?.length) return { ok: true, message: '' };
    return compareGaussianSourceSignature(window.S, lastMeshSourceSignature);
  };
  const syncNifMesh = (mesh) => {
    lastMeshData = mesh || null;
    if (mesh) {
      const currentSignature = computeGaussianSourceSignature(window.S);
      const persistedSignature = window.S?.nifMeta?.dual_surface_source_signature;
      lastMeshSourceSignature = persistedSignature || currentSignature;
      // Older NIF files predate the signature contract. Adopt their co-stored
      // Gaussian/mesh pair as the baseline and persist the baseline on next save.
      if (!persistedSignature && currentSignature && window.S) {
        window.S.nifMeta = { ...(window.S.nifMeta || {}), dual_surface_source_signature: currentSignature };
      }
    } else {
      lastMeshSourceSignature = null;
    }
    const previewToggle = container.querySelector('#meshPreviewToggle');
    if (previewToggle) {
      previewToggle.disabled = !lastMeshData;
      previewToggle.checked = !!lastMeshData;
    }
    if (lastMeshData) {
      if (window.S?.nifMeshComponents?.length) {
        window.previewSolidMesh?.(lastMeshData, { visible: false });
        window.previewSolidMeshComponents?.(window.S.nifMeshComponents, {
          visible: true, opacity: Number(container.querySelector('#meshPreviewOpacity')?.value || 0.95),
        });
        renderMeshComponents(window.S.nifMeshComponents);
      } else {
        window.previewSolidMesh?.(lastMeshData, {
          visible: true,
          opacity: Number(container.querySelector('#meshPreviewOpacity')?.value || 0.38),
        });
      }
      lastMeshStats = FumocMeshExtractor.validateWatertight(lastMeshData);
      lastMesh = makeMeshBlob();
      // Keep the source Gaussian layer visible. The default is a true hybrid
      // view: original splat + reconstructed mesh, independently toggleable.
      const splatToggle = container.querySelector('#meshSplatLayerToggle');
      if (splatToggle) splatToggle.checked = true;
      if (window.S?.points) window.S.points.visible = true;
      container.querySelector('#meshFillHolesBtn').disabled = false;
      container.querySelector('#meshRemoveFloatersBtn').disabled = false;
      container.querySelector('#saveMeshBtn').disabled = !lastMeshData.colours;
      container.querySelector('#printStlBtn').disabled = lastMeshFormat === 'stl' && !lastMeshStats.printable;
      meshStatus('Loaded NIF mesh component. Toggle its preview here; it remains separate from the splats.');
    }
  };
  window.addEventListener('fumoca:nifMeshLoaded', (event) => syncNifMesh(event.detail?.mesh));
  const renderMeshComponents = (components = []) => {
    const panel = container.querySelector('#meshComponentsPanel');
    const list = container.querySelector('#meshComponentsList');
    const count = container.querySelector('#meshComponentsCount');
    const removeButton = container.querySelector('#meshComponentDelete');
    if (!panel || !list) return;
    const items = Array.isArray(components) ? components : [];
    panel.style.display = items.length ? '' : 'none';
    if (count) count.textContent = String(items.length);
    if (removeButton) removeButton.disabled = !items.some(item => item.id === window.S?.activeMeshComponentId);
    list.innerHTML = '';
    for (const component of items) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:5px;border-radius:6px;background:rgba(255,255,255,.035)';
      const visible = document.createElement('input');
      visible.type = 'checkbox'; visible.checked = component.visible !== false;
      visible.title = 'Show or hide this component';
      visible.addEventListener('change', () => {
        component.visible = visible.checked;
        window.setSolidMeshComponentVisibility?.(component.id, visible.checked);
      });
      const select = document.createElement('button');
      select.type = 'button'; select.className = 'mini-btn';
      select.textContent = component.id === window.S?.activeMeshComponentId ? 'Selected' : 'Select';
      select.style.flex = '1'; select.style.textAlign = 'left';
      select.addEventListener('click', () => {
        if (window.S) window.S.activeMeshComponentId = component.id;
        window.highlightSolidMeshComponent?.(component.id);
        renderMeshComponents(items);
        meshStatus('Selected component ' + component.id + '. Its visibility and geometry are independent of the other scene components.');
      });
      const isolate = document.createElement('button');
      isolate.type = 'button'; isolate.className = 'mini-btn'; isolate.textContent = 'Isolate';
      isolate.addEventListener('click', () => {
        for (const item of items) item.visible = item.id === component.id;
        window.previewSolidMeshComponents?.(items, { visible: true, opacity: 1 });
        renderMeshComponents(items);
      });
      const role = document.createElement('span');
      role.className = 'hint';
      role.textContent = component.supportSurfaceCandidate ? 'Support surface candidate' : '';
      role.style.color = component.supportSurfaceCandidate ? 'var(--neon)' : 'var(--muted)';
      const faces = document.createElement('span');
      faces.className = 'hint'; faces.textContent = Number(component.triangles?.length || component.faces?.length || 0) / 3 + ' tris';
      row.append(visible, select, isolate, role, faces);
      list.append(row);
    }
  };
  window.addEventListener('fumoca:nifMeshComponentsLoaded', (event) => {
    const components = event.detail?.components || [];
    renderMeshComponents(components);
    if (components.length) {
      window.previewSolidMeshComponents?.(components, { visible: true, opacity: 0.95 });
      window.highlightSolidMeshComponent?.(window.S?.activeMeshComponentId || components[0].id);
    }
  });
  container.querySelector('#meshComponentsShowAll')?.addEventListener('click', () => {
    for (const component of window.S?.nifMeshComponents || []) component.visible = true;
    window.previewSolidMeshComponents?.(window.S?.nifMeshComponents || [], { visible: true, opacity: 1 });
    renderMeshComponents(window.S?.nifMeshComponents || []);
  });
  container.querySelector('#meshComponentsHideAll')?.addEventListener('click', () => {
    for (const component of window.S?.nifMeshComponents || []) component.visible = false;
    window.setSolidMeshComponentsVisibility?.(false);
    renderMeshComponents(window.S?.nifMeshComponents || []);
  });
  container.querySelector('#meshComponentDelete')?.addEventListener('click', () => {
    const state = window.S;
    if (!state?.activeMeshComponentId) return;
    const id = state.activeMeshComponentId;
    state.nifMeshComponents = (state.nifMeshComponents || []).filter(component => component.id !== id);
    state.activeMeshComponentId = state.nifMeshComponents[0]?.id || null;
    // The old combined mesh is derived data; discard it so NIF export rebuilds
    // the compatibility mesh from the remaining independent components.
    state.nifMesh = null;
    lastMeshData = null;
    lastMeshStats = null;
    lastMesh = null;
    container.querySelector('#saveMeshBtn').disabled = true;
    container.querySelector('#printStlBtn').disabled = true;
    container.querySelector('#meshPreviewToggle').checked = true;
    window.previewSolidMeshComponents?.(state.nifMeshComponents, { visible: true, opacity: 1 });
    window.highlightSolidMeshComponent?.(state.activeMeshComponentId);
    window.setSolidMeshComponentsVisibility?.(true);
    renderMeshComponents(state.nifMeshComponents);
    meshStatus('Deleted component ' + id + '. Other reconstructed components and the original Gaussian layer are unchanged.');
  });
  const updateMeshPreview = () => {
    const visible = !!container.querySelector('#meshPreviewToggle')?.checked;
    if (window.S?.nifMeshComponents?.length) {
      window.setSolidMeshComponentsVisibility?.(visible);
      window.previewSolidMeshComponents?.(window.S.nifMeshComponents, {
        visible, opacity: Number(container.querySelector('#meshPreviewOpacity')?.value || 0.95),
        light: Number(container.querySelector('#meshPreviewLight')?.value || 0.25),
        roughness: Number(container.querySelector('#meshPreviewRoughness')?.value || 0.72),
        metalness: Number(container.querySelector('#meshPreviewMetalness')?.value || 0.05),
      });
    } else {
      window.previewSolidMesh?.(lastMeshData, {
        visible,
        light: Number(container.querySelector('#meshPreviewLight')?.value || 0.25),
        roughness: Number(container.querySelector('#meshPreviewRoughness')?.value || 0.72),
        metalness: Number(container.querySelector('#meshPreviewMetalness')?.value || 0.05),
        opacity: Number(container.querySelector('#meshPreviewOpacity')?.value || 0.38),
      });
    }
  };
  container.querySelector('#meshPreviewToggle')?.addEventListener('change', updateMeshPreview);
  container.querySelector('#meshPreviewOpacity')?.addEventListener('input', (event) => {
    const value = Number(event.target.value);
    const label = container.querySelector('#meshPreviewOpacityVal');
    if (label) label.textContent = Math.round(value * 100) + '%';
    updateMeshPreview();
  });
  container.querySelector('#meshSplatLayerToggle')?.addEventListener('change', (event) => {
    if (window.S?.points) window.S.points.visible = event.target.checked;
  });
  ['#meshPreviewLight', '#meshPreviewRoughness', '#meshPreviewMetalness'].forEach(selector => container.querySelector(selector)?.addEventListener('input', updateMeshPreview));
  const meshStatus = (message) => {
    const el = container.querySelector('#meshPrintStatus');
    if (el) el.textContent = message;
    onStatus?.(message);
  };
  const renderMeshDiagnostics = (stats) => {
    const el = container.querySelector('#meshDiagnostics');
    if (!el) return;
    if (!stats) {
      el.textContent = 'No mesh diagnostics yet. Extract a mesh to inspect its topology.';
      return;
    }
    const components = Number(stats.components ?? stats.n_connected_components ?? 0);
    const open = Number(stats.openEdges ?? stats.n_boundary_edges ?? 0);
    const nonManifold = Number(stats.nonManifoldEdges ?? stats.n_nonmanifold_edges ?? 0);
    const triangles = Number(stats.triangles ?? stats.n_faces ?? 0);
    const watertight = stats.watertight ?? stats.is_watertight;
    const coverage = Number.isFinite(Number(stats.tsdf_coverage_ratio))
      ? ` · TSDF support ${(Number(stats.tsdf_coverage_ratio) * 100).toFixed(1)}%` : '';
    el.textContent = `Components: ${components} · Triangles: ${triangles.toLocaleString()} · Open edges: ${open.toLocaleString()} · Non-manifold edges: ${nonManifold.toLocaleString()} · ${watertight ? 'Watertight' : 'Open surface'}${coverage}`;
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
      metalness: Number(container.querySelector('#meshPreviewMetalness')?.value || 0.05),
      opacity: Number(container.querySelector('#meshPreviewOpacity')?.value || 0.38) });
    window.dispatchEvent(new CustomEvent('fumoca:solidMeshReady', { detail: { mesh: lastMeshData, stats: lastMeshStats } }));
    meshStatus(`${message} Mesh now has ${lastMeshStats.triangles.toLocaleString()} faces; ${lastMeshStats.watertight ? 'watertight' : `${lastMeshStats.openEdges} open edges remain`}.`);
  };
  if (window.S?.nifMesh) syncNifMesh(window.S.nifMesh);

  const extractMesh = async () => {
    const state = window.S;
    if (!state?.positions || !state?.alive) { meshStatus('Load a splat or PLY before extracting a mesh.'); return false; }
    const extractionSourceSignature = computeGaussianSourceSignature(state);
    if (!extractionSourceSignature) { meshStatus('The current Gaussian source is empty or invalid.'); return false; }
    if (lastMeshData) window.previewSolidMesh?.(lastMeshData, { visible: false });
    window.previewSolidMeshComponents?.([], { visible: false });
    state.nifMeshComponents = [];
    state.activeMeshComponentId = null;
    renderMeshComponents([]);
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
      const selectedOnly = !!container.querySelector("#meshSelectedOnly")?.checked;
      if (selectedOnly && !state.selected) throw new Error("No Studio selection is available. Select the object with the Select tools, then retry.");
      let eligibleCount = 0;
      let skippedSeen=0,randomState=((state.alive.length^0x6d2b79f5)>>>0)||1;
      for(let i=0;i<state.alive.length;i++)if(state.alive[i] && (!selectedOnly || state.selected[i])){
        eligibleCount++;
        if(ids.length<maxPoints){ids.push(i);continue;}
        skippedSeen++;
        randomState^=randomState<<13;randomState^=randomState>>>17;randomState^=randomState<<5;
        const pick=(randomState>>>0)%(ids.length+skippedSeen);
        if(pick<ids.length)ids[pick]=i;
      }
      ids.sort((a,b)=>a-b);
      if (ids.length < 50) throw new Error(selectedOnly ? "Only " + eligibleCount + " selected live points are available. Select at least 50 points on the object; do not include the support surface." : "At least 50 live points are needed for mesh extraction.");
      meshStatus("Extracting " + ids.length.toLocaleString() + (selectedOnly ? " selected object points" : " live scene points") + (eligibleCount > maxPoints ? " (sampled from " + eligibleCount.toLocaleString() + ")" : "") + "…");
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
      const densitySmoothing = Number(container.querySelector('#meshDensitySmoothing')?.value ?? 1);
      const smooth = Number(container.querySelector('#meshSmooth')?.value || 0);
      const result = await FumocMeshExtractor.extractMesh(g, {
        resolution, threshold: thresholdValue > 0 ? thresholdValue : null, sigmaScale,
        minComponentTriangles: Number(container.querySelector('#meshFloaterSize')?.value || 32),
        densityBridgingPasses: densitySmoothing,
        format, previewColours: true, name: 'fumoca-mesh', smooth,
        onProgress: (_pct, label) => meshStatus(label),
      });
      // Extraction is asynchronous. If the user edits the splat while the
      // worker is building the surface, discard the result rather than pairing
      // geometry from an old snapshot with the newly edited Gaussian state.
      const currentSourceSignature = computeGaussianSourceSignature(window.S);
      if (currentSourceSignature !== extractionSourceSignature) {
        throw new Error('The Gaussian source changed while the mesh was extracting. The result was discarded; run Extract mesh again.');
      }
      lastMeshData = { ...result.mesh, vertices: result.mesh.vertices.slice(), triangles: result.mesh.triangles.slice(), colours: result.mesh.colours?.slice() };
      const extractedComponents = (result.components || []).map(component => ({
        id: component.id,
        vertices: component.vertices.slice(),
        triangles: component.triangles.slice(),
        colours: component.colours?.slice(),
        watertight: component.watertight,
        visible: true,
      }));
      // Preserve the combined compatibility mesh and the independently
      // addressable connected surfaces. Gaussian geometry remains untouched.
      if (window.S) {
        window.S.nifMesh = lastMeshData;
        window.S.nifMeshComponents = extractedComponents;
        window.S.activeMeshComponentId = extractedComponents[0]?.id || null;
        window.S.nifMeta = { ...(window.S.nifMeta || {}), dual_surface_source_signature: extractionSourceSignature };
      }
      window.previewSolidMesh?.(lastMeshData, { visible: false });
      window.previewSolidMeshComponents?.(extractedComponents, { visible: true, opacity: 0.95 });
      renderMeshComponents(extractedComponents);
      window.dispatchEvent(new CustomEvent('fumoca:nifMeshComponentsLoaded', { detail: { components: extractedComponents } }));
      lastMeshSourceSignature = extractionSourceSignature;
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
      lastMeshStats = {
        ...result.stats,
        extractionMode: selectedOnly ? 'selected-only' : 'all-live',
        sourcePointCount: eligibleCount,
        extractedPointCount: ids.length,
      };
      renderMeshDiagnostics(lastMeshStats);
      if (window.S) {
        window.S.nifMeta = {
          ...(window.S.nifMeta || {}),
          mesh_extraction_mode: selectedOnly ? 'selected-only' : 'all-live',
          mesh_source_point_count: eligibleCount,
          mesh_extracted_point_count: ids.length,
          mesh_extracted_at: new Date().toISOString(),
        };
      }
      if (format !== 'stl') lastMesh = format === 'obj' ? FumocMeshExtractor.exportOBJ(result.mesh, 'fumoca-mesh')
        : FumocMeshExtractor.exportPLY(result.mesh, 'fumoca-mesh');
      const shellStatus = result.stats.watertight
        ? (result.stats.components === 1 ? 'one connected watertight shell' : `${result.stats.components} disconnected watertight shells`)
        : `open surface — ${result.stats.openEdges} open edges${result.stats.components > 1 ? ` across ${result.stats.components} shells` : ''}`;
      const colorNote = format === 'stl' ? ', color kept in preview (STL stores geometry only)' : ', vertex color transferred';
      const bridgeCount = Number(result.stats.densityBridging?.bridgedVoxels || 0);
      meshStatus(`Mesh ready from ${eligibleCount.toLocaleString()} ${selectedOnly ? 'selected' : 'live'} source points (${ids.length.toLocaleString()} sampled): ${result.stats.triangles.toLocaleString()} triangles, ${(lastMesh.size / 1048576).toFixed(2)} MB, ${shellStatus}, ${bridgeCount.toLocaleString()} density voxels bridged${colorNote}.`);
      const downloadButton = container.querySelector('#printStlBtn');
      downloadButton.disabled = format === 'stl' && !result.stats.printable;
      downloadButton.textContent = downloadButton.disabled ? 'STL needs one closed shell' : `Download ${format.toUpperCase()}`;
      const previewToggle = container.querySelector('#meshPreviewToggle');
      previewToggle.disabled = false;
      previewToggle.checked = true;
      container.querySelector('#meshFillHolesBtn').disabled = false;
      container.querySelector('#meshRemoveFloatersBtn').disabled = false;
      // Keep the source Gaussian renderer active after extraction. Users can
      // inspect both representations together or hide either layer manually.
      const splatToggle = container.querySelector('#meshSplatLayerToggle');
      if (splatToggle) splatToggle.checked = true;
      if (state.points) state.points.visible = true;
      updateMeshPreview();
      window.dispatchEvent(new CustomEvent('fumoca:solidMeshReady', { detail: { mesh: lastMeshData, stats: lastMeshStats } }));
      container.querySelector('#saveMeshBtn').disabled = !result.mesh.colours;
      return lastMeshData;
    } catch (err) {
      meshStatus(err.message || String(err));
      return false;
    }
  };
  window.FUMOCA_StudioMeshPrint = {
    mountMeshPrintPanel,
    extractMesh,
    checkSourceFreshness,
    get lastStats() { return lastMeshStats; },
  };
  container.querySelector('#meshOrientedReconstructBtn')?.addEventListener('click', async () => {
    const button = container.querySelector('#meshOrientedReconstructBtn');
    const state = window.S;
    if (!state?.alive || !state?.sourceBuffer && state.fileType !== 'ply') {
      meshStatus('Load a full scene before starting oriented-surfel reconstruction.');
      return;
    }
    const sourceSignature = computeGaussianSourceSignature(state);
    if (!sourceSignature) { meshStatus('The current Gaussian source is empty or invalid.'); return; }
    button.disabled = true;
    try {
      const jobId = await reconstructSceneWithOrientedSurfels({ onStatus: meshStatus });
      meshStatus(`Oriented-surfel job ${jobId.slice(0, 8)} queued for the full live scene. The Gaussian layer remains unchanged.`);
      let applied = false;
      pollPrintJob(jobId, async (job) => {
        if (job.status === 'failed' || job.status === 'needs_retry') {
          meshStatus(`Oriented-surfel reconstruction ${job.status}: ${job.error_message || 'The worker could not produce a supported surface.'}`);
          button.disabled = false;
          return;
        }
        meshStatus(`Oriented-surfel reconstruction ${String(job.status || 'queued')}: ${Number(job.progress || 0)}%`);
        if (job.status !== 'complete' || applied) return;
        applied = true;
        try {
          const currentSignature = computeGaussianSourceSignature(window.S);
          if (currentSignature !== sourceSignature) {
            throw new Error('The Gaussian scene changed while the worker was reconstructing it. The old result was not applied; run reconstruction again.');
          }
          const key = job.meta?.mesh_nif_r2_key;
          if (!key) throw new Error('The worker completed but did not return the reconstructed NIF scene key.');
          meshStatus('Downloading oriented mesh components…');
          const { data, error } = await r2.from('nif-files').download(key);
          if (error || !data) throw new Error(error?.message || 'Could not download the oriented reconstruction NIF.');
          const decoded = await decodeNif(await data.arrayBuffer());
          if (!decoded.mesh) throw new Error('The oriented reconstruction NIF contains no combined compatibility mesh.');
          const components = (decoded.meshComponents || []).map(component => ({
            id: component.id,
            vertices: component.positions,
            colours: component.colors,
            triangles: component.faces,
            watertight: component.watertight,
            visible: component.visible !== false,
            supportSurfaceCandidate: component.supportSurfaceCandidate === true,
          }));
          state.nifMesh = {
            vertices: decoded.mesh.positions,
            colours: decoded.mesh.colors,
            triangles: decoded.mesh.faces,
          };
          state.nifMeshComponents = components;
          state.activeMeshComponentId = components[0]?.id || null;
          state.nifMeta = {
            ...(state.nifMeta || {}),
            ...(decoded.meta || {}),
            dual_surface_source_signature: sourceSignature,
            surface_reconstruction: 'oriented-gaussian-surfel-tsdf',
          };
          lastMeshFormat = 'ply';
          syncNifMesh(state.nifMesh);
          renderMeshDiagnostics({
            ...FumocMeshExtractor.validateWatertight(lastMeshData),
            tsdf_coverage_ratio: decoded.meta?.mesh_diagnostics?.tsdf_coverage_ratio,
          });
          window.previewSolidMesh?.(lastMeshData, { visible: false });
          window.previewSolidMeshComponents?.(components, { visible: true, opacity: 0.95 });
          renderMeshComponents(components);
          window.highlightSolidMeshComponent?.(state.activeMeshComponentId);
          window.dispatchEvent(new CustomEvent('fumoca:nifMeshComponentsLoaded', { detail: { components } }));
          const previewToggle = container.querySelector('#meshPreviewToggle');
          if (previewToggle) { previewToggle.disabled = false; previewToggle.checked = true; }
          meshStatus(`Oriented-surfel reconstruction loaded: ${components.length} independent components. Source splats remain intact; inspect component visibility and support-surface candidates before editing.`);
        } catch (error) {
          meshStatus(error.message || String(error));
        } finally {
          button.disabled = false;
        }
      });
    } catch (error) {
      meshStatus(error.message || String(error));
      button.disabled = false;
    }
  });
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
            density_bridging: lastMeshStats?.densityBridging ?? null,
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
