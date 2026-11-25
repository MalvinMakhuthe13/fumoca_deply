/**
 * Studio panel: "Solid mesh" — turns the loaded splat into a textured,
 * photoreal solid mesh (OpenMVS-style render → fuse → texture), entirely on
 * the CPU in a background worker. Preview in the viewport, export .glb.
 */
const PRESETS = {
  fast: { views: 24, viewSize: 384, resolution: 128, atlasSize: 2048, label: 'Fast' },
  standard: { views: 40, viewSize: 512, resolution: 192, atlasSize: 4096, label: 'Standard' },
  high: { views: 62, viewSize: 768, resolution: 256, atlasSize: 4096, label: 'High' },
};

function liveGaussians() {
  const S = window.S;
  if (!S?.positions || !S?.alive) return null;
  const n = S.alive.length;
  const keep = [];
  for (let i = 0; i < n; i++) if (S.alive[i] && !S.layerHidden?.[i]) keep.push(i);
  if (!keep.length) return null;
  const count = keep.length;
  const g = { count, positions: new Float32Array(count * 3), colors: new Float32Array(count * 3), opacities: new Float32Array(count), scales: new Float32Array(count * 3), rotations: new Float32Array(count * 4) };
  keep.forEach((src, i) => {
    for (let k = 0; k < 3; k++) {
      g.positions[i * 3 + k] = S.positions[src * 3 + k];
      const painted = S.paintColors?.[src * 3 + k];
      g.colors[i * 3 + k] = Number.isFinite(painted) && painted >= 0 ? painted : (S.colors?.[src * 3 + k] ?? 0.7);
      g.scales[i * 3 + k] = S.scaleXYZ?.[src * 3 + k] ?? S.scale?.[src] ?? 0.01;
    }
    g.opacities[i] = S.opacity?.[src] ?? 1;
    if (S.rotation) for (let k = 0; k < 4; k++) g.rotations[i * 4 + k] = S.rotation[src * 4 + k];
    else g.rotations[i * 4] = 1;
  });
  return g;
}

export function mountSolidMeshPanel(container, { onStatus } = {}) {
  if (!container) return null;
  container.insertAdjacentHTML('beforeend', `
    <section class="section" id="solidMeshSection">
      <div class="sec-head"><span class="sec-label">Solid mesh · photoreal</span><span class="sec-badge">CPU</span></div>
      <div class="sec-body">
        <div class="hint">Turn the splat into a solid, textured mesh (like OpenMVS / KIRI "solid"): renders it from every side, fuses the depth into a surface and bakes the splat's colours into a texture. Runs on your processor — no GPU or AI needed.</div>
        <div style="display:flex;gap:6px;margin:8px 0" id="solidMeshPreset">
          <button type="button" class="ac-btn" data-preset="fast" style="flex:1">Fast</button>
          <button type="button" class="ac-btn" data-preset="standard" style="flex:1;border-color:var(--neon,#c8ff00)">Standard</button>
          <button type="button" class="ac-btn" data-preset="high" style="flex:1">High</button>
        </div>
        <button type="button" class="ac-btn lime full" id="solidMeshBuild">Build solid mesh</button>
        <div style="display:flex;gap:6px;margin-top:6px">
          <button type="button" class="ac-btn" id="solidMeshToggle" disabled style="flex:1">Show splat</button>
          <button type="button" class="ac-btn cyan" id="solidMeshDownload" disabled style="flex:1">Download .glb</button>
        </div>
        <div style="height:4px;border-radius:4px;background:rgba(255,255,255,.1);margin-top:8px;overflow:hidden"><i id="solidMeshBar" style="display:block;height:100%;width:0;background:var(--neon,#c8ff00);transition:width .2s"></i></div>
        <div class="hint" id="solidMeshStatus" role="status" style="margin-top:6px">Load a splat, pick a quality, then build.</div>
      </div>
    </section>`);
  const q = (s) => container.querySelector(s);
  let preset = 'standard', worker = null, glb = null, meshObj = null, showingMesh = false;
  const status = (m, f) => { q('#solidMeshStatus').textContent = m; if (f != null) q('#solidMeshBar').style.width = Math.round(f * 100) + '%'; onStatus?.(m); };

  q('#solidMeshPreset').addEventListener('click', (e) => {
    const b = e.target.closest('[data-preset]'); if (!b) return;
    preset = b.dataset.preset;
    for (const x of q('#solidMeshPreset').querySelectorAll('[data-preset]')) x.style.borderColor = x === b ? 'var(--neon,#c8ff00)' : '';
  });

  const splatObjects = () => {
    const out = [];
    const sc = window.scene || window._fumocaScene;
    sc?.traverse?.((o) => { if (o.name === 'fumoca-spark-splat') out.push(o); });
    if (window.S?.points) out.push(window.S.points);
    return out;
  };
  const setView = (mesh) => {
    showingMesh = mesh;
    if (meshObj) meshObj.visible = mesh;
    for (const o of splatObjects()) o.visible = !mesh && (o !== window.S?.points || !window.FumocaSparkGaussian?.isEnabled?.());
    q('#solidMeshToggle').textContent = mesh ? 'Show splat' : 'Show mesh';
  };

  function showPreview(m) {
    const THREE = window.THREE, scene = window.scene || window._fumocaScene;
    if (!THREE || !scene) return;
    if (meshObj) { meshObj.parent?.remove(meshObj); meshObj.geometry.dispose(); meshObj.material.map?.dispose(); meshObj.material.dispose(); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(m.uvs, 2));
    geo.setIndex(new THREE.BufferAttribute(m.indices, 1));
    const tex = new THREE.DataTexture(m.atlas.rgba, m.atlas.width, m.atlas.height, THREE.RGBAFormat);
    if ('SRGBColorSpace' in THREE) tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    meshObj = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex }));
    meshObj.name = 'fumoca-solid-mesh';
    // Follow the platform rig if the splat is seated on one.
    const holder = scene.getObjectByName?.('fumoca-presentation-splats');
    (holder || scene).add(meshObj);
    setView(true);
  }

  q('#solidMeshBuild').addEventListener('click', () => {
    if (worker) return;
    const g = liveGaussians();
    if (!g) { status('Load a splat first.'); return; }
    const opts = PRESETS[preset];
    status(`Building from ${g.count.toLocaleString()} Gaussians (${opts.label})…`, 0.02);
    q('#solidMeshBuild').disabled = true;
    worker = new Worker(new URL('./solid-mesh-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const d = e.data;
      if (d.type === 'progress') { status(d.message, d.fraction); return; }
      worker.terminate(); worker = null; q('#solidMeshBuild').disabled = false;
      if (d.type === 'error') { status('Could not build the mesh: ' + d.message, 0); return; }
      glb = d.glb;
      showPreview(d.mesh);
      q('#solidMeshToggle').disabled = false; q('#solidMeshDownload').disabled = false;
      status(`Solid mesh ready · ${(d.mesh.indices.length / 3).toLocaleString()} triangles · ${(glb.byteLength / 1048576).toFixed(1)} MB .glb`, 1);
    };
    worker.onerror = (e) => { worker?.terminate(); worker = null; q('#solidMeshBuild').disabled = false; status('Mesh worker failed: ' + (e.message || 'unknown error'), 0); };
    worker.postMessage({ gaussians: g, options: opts }, [g.positions.buffer, g.colors.buffer, g.opacities.buffer, g.scales.buffer, g.rotations.buffer]);
  });
  q('#solidMeshToggle').addEventListener('click', () => setView(!showingMesh));
  q('#solidMeshDownload').addEventListener('click', () => {
    if (!glb) return;
    const name = (window.S?.fileName || 'fumoca').replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '_') + '-solid.glb';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([glb], { type: 'model/gltf-binary' }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });
  window.FumocaSolidMesh = { build: () => q('#solidMeshBuild').click(), get glb() { return glb; }, setPreset: (p) => { preset = p; } };
  return { destroy() { worker?.terminate(); q('#solidMeshSection')?.remove(); } };
}
