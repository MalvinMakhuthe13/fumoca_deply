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
        <div class="hint">Estimate depth from one photo and make a shallow splat you can orbit and edit. This cannot recover hidden sides or create genuine scan views.</div>
        <input type="file" id="imageAngleFile" accept="image/*" hidden>
        <button type="button" class="ac-btn full" id="imageAngleChoose">Choose a photo</button>
        <div class="hint" style="margin-top:6px">AI depth (Depth Anything V2) runs on this device. For 3D posters and more controls, open <a href="photo-to-3d.html" style="color:var(--lime,#c8ff00)">Photo → 3D</a>.</div>
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
      status('Reading photo…');
      const photo = await loadPhoto(selectedFile);
      const est = await estimateDepth(photo.canvas, { onProgress: (_f, message) => status(message) });
      const depth = normalizeDepth(est.raw);
      const g = depthToGaussians({ rgba: photo.rgba, width: photo.width, height: photo.height, depth, depthWidth: est.width, depthHeight: est.height }, { near: 1, far: 3.2 });
      result = { bytes: encodeGaussianPly(g), count: g.count };
      const canvas = q('#imageAngleDepth');
      canvas.width = est.width; canvas.height = est.height;
      const ctx = canvas.getContext('2d');
      const img = ctx.createImageData(est.width, est.height);
      for (let i = 0; i < depth.length; i++) { const v = Math.round(depth[i] * 255); img.data.set([v, v, v, 255], i * 4); }
      ctx.putImageData(img, 0, 0);
      q('#imageAnglePreview').style.display = 'block';
      open.disabled = false;
      status(`Depth estimate ready · ${g.count.toLocaleString()} Gaussians. Inferred from one photo; hidden sides are unknown.`);
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
    window.dispatchEvent(new CustomEvent('fumoca:openReconstructedSplat', {
      detail: { bytes: result.bytes, filename: `${(selectedFile?.name || 'image').replace(/\.[^.]+$/, '')}-3d.ply` },
    }));
  });

  return { destroy() { style.remove(); container.innerHTML = ''; } };
}
