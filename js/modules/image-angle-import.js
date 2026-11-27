import Reconstructor from './fumoc-scene-reconstructor.js';
import { loadPhoto, estimateDepth } from './photo-depth.js';
import { normalizeDepth, depthToGaussians, encodeGaussianPly } from './depth-to-splat.js';

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
        <div class="hint">Estimate depth from one photo and make a shallow splat you can orbit and edit. Hidden sides are guesses, not measured scan data.</div>
        <input type="file" id="imageAngleFile" accept="image/*" hidden>
        <button type="button" class="ac-btn full" id="imageAngleChoose">Choose a photo</button>
        <label style="display:block;font-size:11px;margin-top:8px">Depth method
          <select id="imageAngleMethod" style="display:block;width:100%;padding:7px;margin-top:4px;background:var(--surface2);color:var(--text);border:1px solid var(--border2);border-radius:7px">
            <option value="auto">AI depth with local fallback</option>
            <option value="heuristic">Local depth only (offline)</option>
          </select>
        </label>
        <div class="hint" style="margin-top:6px">AI depth runs on this device. The model is downloaded once and cached. For the moving poster and full controls, open <a href="photo-to-3d.html" style="color:var(--lime,#c8ff00)">Photo → 3D</a>.</div>
        <div id="imageAnglePreview"><canvas id="imageAngleDepth" aria-label="Estimated depth preview"></canvas><div class="hint" style="padding:6px 8px">Estimated depth · near and far are model guesses</div></div>
        <button type="button" class="ac-btn lime full" id="imageAngleBuild" disabled style="margin-top:8px">Build inferred splat</button>
        <button type="button" class="ac-btn cyan full" id="imageAngleOpen" disabled style="margin-top:6px">Open in editor</button>
        <div class="hint" id="imageAngleStatus" role="status" style="margin-top:8px">Choose a photo to begin.</div>
      </div>
    </section>`);

  const q = selector => container.querySelector(selector);
  const input = q('#imageAngleFile'), choose = q('#imageAngleChoose');
  const build = q('#imageAngleBuild'), open = q('#imageAngleOpen');
  const status = message => { q('#imageAngleStatus').textContent = message; onStatus?.(message); };
  let selectedFile = null, result = null, busy = false;

  choose.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    selectedFile = input.files?.[0] || null;
    input.value = '';
    result = null;
    build.disabled = !selectedFile;
    open.disabled = true;
    q('#imageAnglePreview').style.display = 'none';
    if (selectedFile) status(`${selectedFile.name} selected. Build a depth estimate to preview it.`);
  });

  build.addEventListener('click', async () => {
    if (!selectedFile || busy) return;
    busy = true; build.disabled = true; open.disabled = true;
    q('#imageAnglePreview').style.display = 'none';
    try {
      const method = q('#imageAngleMethod').value;
      if (method === 'heuristic') {
        result = await buildLocal(selectedFile, status);
      } else {
        try {
          result = await buildAi(selectedFile, status);
        } catch (aiError) {
          console.warn('[Photo→3D] AI depth unavailable; using local heuristic:', aiError);
          status('AI depth unavailable. Falling back to the local offline depth method…');
          result = await buildLocal(selectedFile, status);
          result.method = 'local fallback';
        }
      }
      const canvas = q('#imageAngleDepth');
      if (result.depthImage) {
        canvas.width = result.depthImage.width; canvas.height = result.depthImage.height;
        const ctx = canvas.getContext('2d');
        const img = ctx.createImageData(canvas.width, canvas.height);
        for (let i = 0; i < result.depthImage.data.length; i++) {
          const v = Math.round(result.depthImage.data[i] * 255);
          img.data.set([v, v, v, 255], i * 4);
        }
        ctx.putImageData(img, 0, 0);
      } else {
        Reconstructor.visualiseDepth(result.depthMap, result.imageData.width, result.imageData.height, canvas);
      }
      q('#imageAnglePreview').style.display = 'block';
      open.disabled = false;
      status(`Depth ready · ${result.count.toLocaleString()} Gaussians · ${result.method}. Inferred 2.5D only; hidden sides are unknown.`);
    } catch (error) {
      result = null;
      status(`Could not build depth estimate: ${error.message || error}`);
    } finally {
      busy = false;
      build.disabled = !selectedFile;
    }
  });

  open.addEventListener('click', () => {
    if (!result?.bytes) return;
    const base = (selectedFile?.name || 'image').replace(/\.[^.]+$/, '');
    window.dispatchEvent(new CustomEvent('fumoca:openReconstructedSplat', {
      detail: { bytes: result.bytes, filename: `${base}-3d.${result.extension}`, kind: 'photo-to-3d' },
    }));
  });

  return { destroy() { style.remove(); container.innerHTML = ''; } };
}

async function buildAi(file, status) {
  status('Reading photo…');
  const photo = await loadPhoto(file);
  const est = await estimateDepth(photo.canvas, { onProgress: (_fraction, message) => status(message) });
  const depth = normalizeDepth(est.raw);
  const g = depthToGaussians({
    rgba: photo.rgba, width: photo.width, height: photo.height,
    depth, depthWidth: est.width, depthHeight: est.height,
  }, { near: 1, far: 3.2 });
  if (!g.count) throw new Error('No visible subject remained after depth estimation.');
  return {
    bytes: encodeGaussianPly(g), count: g.count, method: est.device === 'webgpu' ? 'Depth Anything V2 · GPU' : 'Depth Anything V2 · CPU',
    extension: 'ply', depthImage: { data: depth, width: est.width, height: est.height },
  };
}

async function buildLocal(file, status) {
  status('Using the local offline depth method…');
  const reconstructed = await Reconstructor.reconstruct(file, {
    depthMethod: 'heuristic', resolution: 384, depthScale: 2,
    sourceType: 'single_image_inferred', filename: file.name,
    onProgress: (_percent, message) => status(message),
  });
  if (!reconstructed?.splatBinary?.byteLength) throw new Error('The local depth method returned no splat data.');
  return {
    bytes: reconstructed.splatBinary,
    count: Math.floor(reconstructed.splatBinary.byteLength / 32),
    method: 'local heuristic', extension: 'splat',
    depthMap: reconstructed.depthMap, imageData: reconstructed.imageData,
  };
}
