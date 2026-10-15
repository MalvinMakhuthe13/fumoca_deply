import Reconstructor from './fumoc-scene-reconstructor.js';

const STYLE = `
  #imageAnglePreview{display:none;width:100%;margin-top:8px;border-radius:8px;background:#080a0e;border:1px solid rgba(255,255,255,.12)}
  #imageAnglePreview canvas{display:block;width:100%;height:auto;max-height:220px;object-fit:contain}
`;

export function mountImageAngleImport(container, { onStatus } = {}) {
  if (!container) return;
  const style = document.createElement('style');
  style.textContent = STYLE;
  container.appendChild(style);
  container.insertAdjacentHTML('beforeend', `
    <section class="section" aria-labelledby="imageAngleTitle">
      <div class="sec-head"><span class="sec-label" id="imageAngleTitle">Single image · inferred 2.5D</span><span class="sec-badge">EXPERIMENTAL</span></div>
      <div class="sec-body">
        <div class="hint">Estimate depth from one photo and make a shallow splat you can orbit and edit. This cannot recover hidden sides or create genuine scan views.</div>
        <input type="file" id="imageAngleFile" accept="image/*" hidden>
        <button type="button" class="ac-btn full" id="imageAngleChoose">Choose a photo</button>
        <label style="display:block;font-size:11px;margin-top:8px">Depth model
          <select id="imageAngleMethod" style="display:block;width:100%;padding:7px;margin-top:4px;background:var(--surface2);color:var(--text);border:1px solid var(--border2);border-radius:7px">
            <option value="auto">Depth model, with local fallback</option>
            <option value="heuristic">Local depth heuristic</option>
          </select>
        </label>
        <div id="imageAnglePreview"><canvas id="imageAngleDepth" aria-label="Estimated depth preview"></canvas><div class="hint" style="padding:6px 8px">Estimated depth · near and far are model guesses</div></div>
        <button type="button" class="ac-btn lime full" id="imageAngleBuild" disabled style="margin-top:8px">Build inferred splat</button>
        <button type="button" class="ac-btn cyan full" id="imageAngleOpen" disabled style="margin-top:6px">Open in editor</button>
        <div class="hint" id="imageAngleStatus" role="status" style="margin-top:8px">Choose a photo to begin.</div>
      </div>
    </section>`);

  const q = (selector) => container.querySelector(selector);
  const input = q('#imageAngleFile');
  const choose = q('#imageAngleChoose');
  const build = q('#imageAngleBuild');
  const open = q('#imageAngleOpen');
  const status = (message) => {
    q('#imageAngleStatus').textContent = message;
    onStatus?.(message);
  };
  let selectedFile = null;
  let result = null;
  let busy = false;

  choose.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    selectedFile = input.files?.[0] || null;
    result = null;
    build.disabled = !selectedFile;
    open.disabled = true;
    q('#imageAnglePreview').style.display = 'none';
    if (selectedFile) status(`${selectedFile.name} selected. Build a depth estimate to preview it.`);
  });

  build.addEventListener('click', async () => {
    if (!selectedFile || busy) return;
    busy = true;
    build.disabled = true;
    open.disabled = true;
    q('#imageAnglePreview').style.display = 'none';
    try {
      result = await Reconstructor.reconstruct(selectedFile, {
        depthMethod: q('#imageAngleMethod').value,
        resolution: 384,
        depthScale: 2,
        sourceType: 'single_image_inferred',
        filename: selectedFile.name,
        onProgress: (_pct, message) => status(message),
      });
      Reconstructor.visualiseDepth(result.depthMap, result.imageData.width, result.imageData.height, q('#imageAngleDepth'));
      q('#imageAnglePreview').style.display = 'block';
      open.disabled = false;
      const points = Math.floor(result.splatBinary.byteLength / 32);
      status(`Depth estimate ready · ${points.toLocaleString()} points · ${result.depthMethod}. Inferred 2.5D only; back and side surfaces are unknown.`);
    } catch (error) {
      result = null;
      status(`Could not build depth estimate: ${error.message || error}`);
    } finally {
      busy = false;
      build.disabled = !selectedFile;
    }
  });

  open.addEventListener('click', () => {
    if (!result?.splatBinary) return;
    window.dispatchEvent(new CustomEvent('fumoca:openReconstructedSplat', {
      detail: { bytes: result.splatBinary, filename: `${selectedFile?.name || 'image'}.splat` },
    }));
  });

  return { destroy() { style.remove(); container.innerHTML = ''; } };
}
