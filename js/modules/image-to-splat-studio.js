/* FUMOCA Image-to-Splat Studio — upgraded preparation + local test surface.
 * Honest scope: camera planning, coverage scoring, project packaging.
 * Does not run GPU Gaussian training until a backend adapter is connected.
 */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const fileInput = $('itsFiles');
  const dropzone = $('itsDropzone');
  const grid = $('itsImageGrid');
  const countLabel = $('itsFileCount');
  const clearButton = $('itsClearFiles');
  const exportButton = $('itsExportPlan');
  const exportJsonButton = $('itsExportJson');
  if (!fileInput || !dropzone || !grid || !exportButton) return;

  let files = [];
  let objectUrls = [];
  let previewUrls = [];

  const settings = {
    count: $('itsCount'),
    sweep: $('itsSweep'),
    radius: $('itsRadius'),
    elevation: $('itsElevation'),
    fov: $('itsFov'),
  };

  const outputs = {
    count: $('itsCountOut'),
    sweep: $('itsSweepOut'),
    radius: $('itsRadiusOut'),
    elevation: $('itsElevationOut'),
    fov: $('itsFovOut'),
  };

  // Ensure interactive orbit canvas exists
  function ensureOrbitCanvas() {
    let host = $('itsOrbitLive');
    if (host) return host;
    const card = document.querySelector('.its-orbit-preview') || document.querySelector('.its-camera-card .its-card-head')?.parentElement;
    if (!card) return null;
    host = document.createElement('div');
    host.id = 'itsOrbitLive';
    host.className = 'its-orbit-live';
    host.innerHTML = `
      <canvas id="itsOrbitCanvas" width="640" height="360" aria-label="Live camera orbit preview"></canvas>
      <div class="its-orbit-legend">
        <span><i class="dot cam"></i> Planned cameras</span>
        <span><i class="dot subj"></i> Subject</span>
        <span><i class="dot cov"></i> Coverage arc</span>
      </div>`;
    const old = card.querySelector('.its-orbit-preview');
    if (old) old.replaceWith(host);
    else card.insertBefore(host, card.querySelector('.its-controls') || card.querySelector('.its-actions'));
    return host;
  }

  function ensureReadyPanel() {
    let el = $('itsReadyPanel');
    if (el) return el;
    const layout = document.querySelector('.its-layout');
    if (!layout) return null;
    el = document.createElement('section');
    el.id = 'itsReadyPanel';
    el.className = 'its-card its-ready-card';
    el.innerHTML = `
      <div class="its-card-head"><span class="its-step">✓</span>
        <div><h2>Test readiness</h2><p>What you can run locally vs what needs the reconstruction backend.</p></div>
      </div>
      <div class="its-ready-grid">
        <div class="its-ready-score"><div class="its-score-val" id="itsScoreVal">0</div><div class="its-score-lbl">Coverage score</div></div>
        <ul class="its-ready-list" id="itsReadyList"></ul>
      </div>
      <div class="its-actions its-ready-actions">
        <button type="button" class="its-primary" id="itsGenPreviews" disabled>Generate angle previews</button>
        <button type="button" class="its-secondary" id="itsSaveLocal" disabled>Save project locally</button>
        <button type="button" class="its-secondary" id="itsOpenChecklist">Open test checklist</button>
      </div>
      <div id="itsPreviewStrip" class="its-preview-strip" hidden></div>
      <p class="its-note" id="itsReadyNote">Add photos to unlock local tests. Real Gaussian reconstruction still requires a connected worker.</p>`;
    const exportCard = document.querySelector('.its-export-card');
    if (exportCard) layout.insertBefore(el, exportCard);
    else layout.appendChild(el);
    return el;
  }

  ensureOrbitCanvas();
  ensureReadyPanel();

  function updateOutputs() {
    if (outputs.count) outputs.count.textContent = settings.count?.value || '12';
    if (outputs.sweep) outputs.sweep.textContent = (settings.sweep?.value || '360') + '°';
    if (outputs.radius) outputs.radius.textContent = Number(settings.radius?.value || 3).toFixed(2);
    if (outputs.elevation) outputs.elevation.textContent = (settings.elevation?.value || '5') + '°';
    if (outputs.fov) outputs.fov.textContent = (settings.fov?.value || '35') + '°';
    drawOrbit();
    updateReadiness();
  }

  function cleanupUrls() {
    objectUrls.forEach((url) => URL.revokeObjectURL(url));
    objectUrls = [];
  }
  function cleanupPreviews() {
    previewUrls.forEach((url) => URL.revokeObjectURL(url));
    previewUrls = [];
  }

  function coverageScore() {
    const n = files.length;
    const sweep = Number(settings.sweep?.value || 360);
    const count = Number(settings.count?.value || 12);
    let score = 0;
    if (n >= 1) score += 20;
    if (n >= 3) score += 20;
    if (n >= 8) score += 20;
    if (n >= 20) score += 10;
    // denser planned cameras help multi-view
    score += Math.min(15, Math.floor(count / 2));
    if (sweep >= 180) score += 10;
    if (sweep >= 300) score += 5;
    return Math.min(100, score);
  }

  function updateReadiness() {
    const score = coverageScore();
    const scoreEl = $('itsScoreVal');
    if (scoreEl) {
      scoreEl.textContent = String(score);
      scoreEl.style.color = score >= 70 ? '#c8ff00' : score >= 40 ? '#f5c542' : '#ff8b8b';
    }
    const list = $('itsReadyList');
    if (list) {
      const n = files.length;
      const items = [
        [n >= 1, 'Source images loaded'],
        [n >= 3, 'Multi-view overlap likely (3+ photos)'],
        [Number(settings.count?.value || 0) >= 8, 'Camera plan density ≥ 8 poses'],
        [Number(settings.sweep?.value || 0) >= 180, 'Sweep covers at least a half-circle'],
        [false, 'GPU reconstruction worker connected (not yet)'],
      ];
      list.innerHTML = items.map(([ok, label]) =>
        `<li class="${ok ? 'ok' : 'no'}">${ok ? '✓' : '○'} ${label}</li>`
      ).join('');
    }
    const has = files.length > 0;
    ['itsGenPreviews', 'itsSaveLocal', 'itsExportPlan', 'itsExportJson', 'itsClearFiles'].forEach((id) => {
      const el = $(id);
      if (el) el.disabled = id === 'itsClearFiles' ? !has : (id.startsWith('itsExport') || id === 'itsGenPreviews' || id === 'itsSaveLocal') ? !has : el.disabled;
    });
    if (exportButton) exportButton.disabled = !has;
    if (exportJsonButton) exportJsonButton.disabled = !has;
    if (clearButton) clearButton.disabled = !has;
  }

  function drawOrbit() {
    const canvas = $('itsOrbitCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || 640;
    const h = canvas.clientHeight || 360;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // background
    const g = ctx.createRadialGradient(w * 0.5, h * 0.52, 10, w * 0.5, h * 0.5, w * 0.45);
    g.addColorStop(0, 'rgba(30, 50, 80, 0.35)');
    g.addColorStop(1, 'rgba(8, 11, 18, 0.1)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    const cx = w * 0.5;
    const cy = h * 0.55;
    const count = Math.max(1, Number(settings.count?.value || 12));
    const sweep = Number(settings.sweep?.value || 360) * Math.PI / 180;
    const elev = Number(settings.elevation?.value || 5) * Math.PI / 180;
    const radiusPx = Math.min(w, h) * 0.32;

    // ground ellipse
    ctx.strokeStyle = 'rgba(200,255,0,0.2)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(cx, cy, radiusPx, radiusPx * 0.38, 0, 0, Math.PI * 2);
    ctx.stroke();

    // coverage arc
    ctx.strokeStyle = 'rgba(100, 180, 255, 0.45)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    const startA = -Math.PI / 2 - sweep / 2;
    for (let i = 0; i <= 48; i++) {
      const t = i / 48;
      const a = startA + sweep * t;
      const x = cx + Math.cos(a) * radiusPx;
      const y = cy + Math.sin(a) * radiusPx * 0.38 - Math.sin(elev) * radiusPx * 0.25;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // subject
    ctx.fillStyle = 'rgba(200,255,0,0.85)';
    ctx.beginPath();
    ctx.ellipse(cx, cy, 28, 16, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(8,11,18,0.9)';
    ctx.font = '600 10px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('SUBJECT', cx, cy + 4);

    // cameras
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0.5 : i / (count - 1);
      const a = startA + sweep * t;
      const x = cx + Math.cos(a) * radiusPx;
      const y = cy + Math.sin(a) * radiusPx * 0.38 - Math.sin(elev) * radiusPx * 0.25;
      // line to subject
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(cx, cy);
      ctx.stroke();
      // camera marker
      ctx.fillStyle = i === 0 ? '#c8ff00' : 'rgba(120, 200, 255, 0.95)';
      ctx.beginPath();
      ctx.arc(x, y, i === 0 ? 5 : 3.5, 0, Math.PI * 2);
      ctx.fill();
      // frustum tick
      ctx.strokeStyle = 'rgba(120, 200, 255, 0.5)';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a + Math.PI) * 10, y + Math.sin(a + Math.PI) * 6);
      ctx.stroke();
    }

    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '11px system-ui';
    ctx.textAlign = 'left';
    ctx.fillText(`${count} poses · ${settings.sweep?.value || 360}° sweep · r=${Number(settings.radius?.value || 3).toFixed(1)}`, 12, h - 12);
  }

  function renderFiles() {
    cleanupUrls();
    grid.replaceChildren();
    countLabel.textContent = files.length + (files.length === 1 ? ' image selected' : ' images selected');
    updateReadiness();

    // auto-suggest mode
    const multi = document.querySelector('input[name="itsMode"][value="multi"]');
    const single = document.querySelector('input[name="itsMode"][value="single"]');
    if (files.length >= 3 && multi) multi.checked = true;
    else if (files.length === 1 && single) single.checked = true;

    if (!files.length) {
      const empty = document.createElement('div');
      empty.className = 'its-empty';
      empty.innerHTML = '<span>▧</span><strong>Your source gallery will appear here</strong><p>Drop listing photos or phone shots — they stay on this device until you export.</p>';
      grid.append(empty);
      drawOrbit();
      return;
    }

    files.forEach((file, idx) => {
      const url = URL.createObjectURL(file);
      objectUrls.push(url);
      const tile = document.createElement('div');
      tile.className = 'its-thumb';
      tile.innerHTML = `
        <img src="${url}" alt="">
        <div class="its-thumb-meta">
          <span title="${file.name}">${file.name}</span>
          <button type="button" data-remove="${idx}" aria-label="Remove">✕</button>
        </div>`;
      grid.append(tile);
    });
    grid.querySelectorAll('[data-remove]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = Number(btn.getAttribute('data-remove'));
        files.splice(i, 1);
        renderFiles();
      });
    });
    drawOrbit();
  }

  function addFiles(list) {
    const incoming = Array.from(list || []).filter((f) => f.type.startsWith('image/'));
    if (!incoming.length) return;
    const key = (f) => f.name + ':' + f.size + ':' + f.lastModified;
    const have = new Set(files.map(key));
    incoming.forEach((f) => {
      if (!have.has(key(f))) files.push(f);
    });
    renderFiles();
  }

  function cameraPlan() {
    const count = Number(settings.count?.value || 12);
    const sweep = Number(settings.sweep?.value || 360);
    const radius = Number(settings.radius?.value || 3);
    const elevationDeg = Number(settings.elevation?.value || 5);
    const elevation = elevationDeg * Math.PI / 180;
    const fov = Number(settings.fov?.value || 35);
    const mode = document.querySelector('input[name="itsMode"]:checked')?.value || 'multi';
    const aiFill = !!document.querySelector('#itsAiFill')?.checked;
    const cameras = [];
    const start = -sweep / 2;
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0.5 : i / (count - 1);
      const yaw = (start + sweep * t) * Math.PI / 180;
      const x = Math.sin(yaw) * radius * Math.cos(elevation);
      const y = Math.sin(elevation) * radius;
      const z = Math.cos(yaw) * radius * Math.cos(elevation);
      cameras.push({
        id: `cam_${String(i + 1).padStart(3, '0')}`,
        index: i,
        yaw_deg: (start + sweep * t),
        elevation_deg: elevationDeg,
        position: { x: +x.toFixed(5), y: +y.toFixed(5), z: +z.toFixed(5) },
        look_at: { x: 0, y: 0, z: 0 },
        fov_deg: fov,
      });
    }
    return {
      schema: 'fumoca.image_to_splat.project.v2',
      created_at: new Date().toISOString(),
      status: 'camera_plan_only',
      coverage_score: coverageScore(),
      source: {
        image_count: files.length,
        files: files.map((f, i) => ({
          index: i,
          name: f.name,
          size: f.size,
          type: f.type,
        })),
      },
      mode: {
        reconstruction: mode,
        ai_fill: aiFill,
      },
      camera_plan: {
        count,
        sweep_deg: sweep,
        radius,
        elevation_deg: elevationDeg,
        fov_deg: fov,
        units: 'scene_relative',
        cameras,
      },
      provenance: {
        client: 'fumoca-image-to-splat-studio',
        camera_positions_are_planned: true,
        not_a_trained_splat: true,
        metric_scale_unknown: true,
      },
    };
  }

  function downloadBlob(blob, filename) {
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  exportJsonButton?.addEventListener('click', () => {
    if (!files.length) return;
    const blob = new Blob([JSON.stringify(cameraPlan(), null, 2)], { type: 'application/json' });
    downloadBlob(blob, 'fumoca-image-to-splat-camera-plan.json');
  });

  exportButton.addEventListener('click', async () => {
    if (!files.length) return;
    exportButton.disabled = true;
    exportButton.textContent = 'Packaging…';
    try {
      const { default: JSZip } = await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm');
      const zip = new JSZip();
      zip.file('fumoca-project.json', JSON.stringify(cameraPlan(), null, 2));
      const sourceFolder = zip.folder('source-images');
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const safe = String(i + 1).padStart(3, '0') + '_' + f.name.replace(/[^\w.\-]+/g, '_');
        sourceFolder.file(safe, f);
      }
      zip.file(
        'README.txt',
        'FUMOCA Image-to-Splat project package v2\n\n' +
          'Contains original source images + camera-plan manifest.\n' +
          'This is NOT a trained Gaussian splat.\n' +
          'Coverage score: ' + coverageScore() + '\n' +
          'Next: hand to reconstruction worker / Kaggle pipeline when connected.\n'
      );
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 3 } });
      downloadBlob(blob, 'fumoca-image-to-splat-project.zip');
    } catch (error) {
      console.error('[FUMOCA Image-to-Splat] Package export failed', error);
      window.alert('Could not package the images. Check your connection (JSZip CDN) and try again. Files were not uploaded.');
    } finally {
      exportButton.disabled = false;
      exportButton.textContent = 'Export project bundle (.zip)';
      updateReadiness();
    }
  });

  // Generate simple angle previews (parallax crops) for testing UI — not real novel views
  async function generateAnglePreviews() {
    if (!files.length) return;
    const strip = $('itsPreviewStrip');
    const btn = $('itsGenPreviews');
    if (!strip || !btn) return;
    btn.disabled = true;
    btn.textContent = 'Generating…';
    cleanupPreviews();
    strip.hidden = false;
    strip.innerHTML = '';

    const srcFile = files[0];
    const bitmap = await createImageBitmap(srcFile);
    const plan = cameraPlan().camera_plan.cameras;
    const sample = plan.filter((_, i) => i % Math.max(1, Math.floor(plan.length / 6)) === 0).slice(0, 6);

    for (const cam of sample) {
      const canvas = document.createElement('canvas');
      const w = 240;
      const h = 160;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      // parallax shift from yaw — honest "preview aid" not novel view synthesis
      const shift = (cam.yaw_deg / 180) * bitmap.width * 0.12;
      const scale = 1.08;
      const sw = bitmap.width / scale;
      const sh = bitmap.height / scale;
      const sx = Math.max(0, Math.min(bitmap.width - sw, (bitmap.width - sw) / 2 + shift));
      const sy = Math.max(0, Math.min(bitmap.height - sh, (bitmap.height - sh) / 2 - Math.sin(cam.elevation_deg * Math.PI / 180) * bitmap.height * 0.04));
      ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, w, h);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, h - 22, w, 22);
      ctx.fillStyle = '#c8ff00';
      ctx.font = '11px system-ui';
      ctx.fillText(`${cam.id} · ${cam.yaw_deg.toFixed(0)}°`, 8, h - 7);
      const url = canvas.toDataURL('image/jpeg', 0.85);
      previewUrls.push(url);
      const fig = document.createElement('figure');
      fig.innerHTML = `<img src="${url}" alt=""><figcaption>Planned ${cam.yaw_deg.toFixed(0)}°</figcaption>`;
      strip.append(fig);
    }
    bitmap.close?.();
    btn.disabled = false;
    btn.textContent = 'Generate angle previews';
    const note = $('itsReadyNote');
    if (note) {
      note.textContent = 'Previews are parallax crops of your source photo for plan checking — not AI-generated novel views or a splat.';
    }
  }

  $('itsGenPreviews')?.addEventListener('click', () => {
    generateAnglePreviews().catch((e) => {
      console.error(e);
      alert('Preview generation failed: ' + (e.message || e));
      updateReadiness();
    });
  });

  $('itsSaveLocal')?.addEventListener('click', () => {
    if (!files.length) return;
    try {
      const plan = cameraPlan();
      // store plan only (not image bytes) — images stay as user files
      localStorage.setItem('fumoca_its_last_project', JSON.stringify(plan));
      localStorage.setItem('fumoca_its_last_saved_at', new Date().toISOString());
      alert('Camera plan saved in this browser.\nCoverage score: ' + plan.coverage_score + '\n\nImages were not uploaded. Export ZIP to move the full package.');
    } catch (e) {
      alert('Could not save locally: ' + e.message);
    }
  });

  $('itsOpenChecklist')?.addEventListener('click', () => {
    const score = coverageScore();
    const lines = [
      'FUMOCA Image → Splat test checklist',
      '',
      '1. Load 1 image (single-photo path) or 8+ (multi-view path)',
      '2. Adjust camera count / sweep — watch live orbit update',
      '3. Generate angle previews (plan check only)',
      '4. Export JSON camera plan',
      '5. Export ZIP project bundle',
      '6. (Later) Hand ZIP to reconstruction worker when connected',
      '',
      'Current coverage score: ' + score,
      'Images selected: ' + files.length,
      'Status: preparation only — not a trained splat',
    ].join('\n');
    alert(lines);
  });

  // Drag & drop + input
  fileInput.addEventListener('change', () => {
    addFiles(fileInput.files);
    fileInput.value = '';
  });
  ['dragenter', 'dragover'].forEach((ev) => {
    dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropzone.classList.add('is-drag');
    });
  });
  ['dragleave', 'drop'].forEach((ev) => {
    dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropzone.classList.remove('is-drag');
    });
  });
  dropzone.addEventListener('drop', (e) => addFiles(e.dataTransfer?.files));

  clearButton?.addEventListener('click', () => {
    files = [];
    cleanupPreviews();
    const strip = $('itsPreviewStrip');
    if (strip) {
      strip.hidden = true;
      strip.innerHTML = '';
    }
    renderFiles();
  });

  Object.values(settings).forEach((el) => {
    el?.addEventListener('input', updateOutputs);
  });
  document.querySelectorAll('input[name="itsMode"]').forEach((el) => {
    el.addEventListener('change', updateReadiness);
  });
  $('itsAiFill')?.addEventListener('change', updateReadiness);

  $('itsResetPlan')?.addEventListener('click', () => {
    if (settings.count) settings.count.value = '12';
    if (settings.sweep) settings.sweep.value = '360';
    if (settings.radius) settings.radius.value = '3';
    if (settings.elevation) settings.elevation.value = '5';
    if (settings.fov) settings.fov.value = '35';
    updateOutputs();
  });

  window.addEventListener('resize', () => drawOrbit());
  window.addEventListener('beforeunload', () => {
    cleanupUrls();
  });

  // restore note if prior plan exists
  try {
    const prev = localStorage.getItem('fumoca_its_last_project');
    if (prev && $('itsReadyNote')) {
      const p = JSON.parse(prev);
      $('itsReadyNote').textContent =
        `Last local plan: ${p.source?.image_count || '?'} images, score ${p.coverage_score ?? '—'} (${localStorage.getItem('fumoca_its_last_saved_at') || ''}). Load photos again to continue.`;
    }
  } catch (_) {}

  renderFiles();
  updateOutputs();
})();
