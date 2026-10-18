/* FUMOCA Image-to-Splat Studio — free camera placement + viewpoint popup.
 * Honest scope: place cameras, preview angles from source photo, package project.
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
  let sourceBitmap = null;

  let cameras = [];
  let selectedCameraId = null;
  let dragState = null;
  let lastDrawLayout = null;
  let previewCache = new Map();
  let popupOpen = false;

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

  function ensureOrbitCanvas() {
    let host = $('itsOrbitLive');
    if (host) return host;
    const card = document.querySelector('.its-orbit-preview') || $('itsOrbitHost');
    if (!card) return null;
    host = document.createElement('div');
    host.id = 'itsOrbitLive';
    host.className = 'its-orbit-live';
    host.innerHTML = `
      <canvas id="itsOrbitCanvas" width="640" height="360" aria-label="Live camera placement"></canvas>
      <div class="its-orbit-legend">
        <span><i class="dot cam"></i> Planned cameras</span>
        <span><i class="dot subj"></i> Subject</span>
        <span><i class="dot cov"></i> Coverage arc</span>
      </div>`;
    card.replaceWith(host);
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
      <p class="its-note" id="itsReadyNote">Add photos and place cameras to unlock local tests. Real Gaussian reconstruction still requires a connected worker.</p>`;
    const exportCard = document.querySelector('.its-export-card');
    if (exportCard) layout.parentElement?.insertBefore(el, exportCard);
    else layout.parentElement?.appendChild(el);
    return el;
  }

  ensureOrbitCanvas();
  ensureReadyPanel();

  const canvas = $('itsOrbitCanvas');
  const popup = $('itsCamPopup');
  const popupCanvas = $('itsCamPopupPreview');
  const orbitHost = $('itsOrbitLive');

  function camFromAngles(yawDeg, elevDeg, radius, fov, index) {
    const yaw = (yawDeg * Math.PI) / 180;
    const elev = (elevDeg * Math.PI) / 180;
    const x = Math.sin(yaw) * radius * Math.cos(elev);
    const y = Math.sin(elev) * radius;
    const z = Math.cos(yaw) * radius * Math.cos(elev);
    return {
      id: `cam_${String(index + 1).padStart(3, '0')}`,
      index,
      yaw_deg: +yawDeg.toFixed(2),
      elevation_deg: +elevDeg.toFixed(2),
      position: { x: +x.toFixed(5), y: +y.toFixed(5), z: +z.toFixed(5) },
      look_at: { x: 0, y: 0, z: 0 },
      fov_deg: fov,
    };
  }

  function reindexCameras() {
    cameras.forEach((c, i) => {
      c.index = i;
      c.id = `cam_${String(i + 1).padStart(3, '0')}`;
    });
    previewCache.clear();
  }

  function buildRingCameras() {
    const count = Math.max(1, Number(settings.count?.value || 12));
    const sweep = Number(settings.sweep?.value || 360);
    const radius = Number(settings.radius?.value || 3);
    const elev = Number(settings.elevation?.value || 5);
    const fov = Number(settings.fov?.value || 35);
    const start = -sweep / 2;
    const next = [];
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0.5 : i / (count - 1);
      const yaw = start + sweep * t;
      next.push(camFromAngles(yaw, elev, radius, fov, i));
    }
    cameras = next;
    selectedCameraId = cameras[0]?.id || null;
    previewCache.clear();
    updateCamCount();
    updateDeleteEnabled();
    drawOrbit();
    updateReadiness();
    if (selectedCameraId) openPopupFor(selectedCameraId);
  }

  function addCamera() {
    const radius = Number(settings.radius?.value || 3);
    const elev = Number(settings.elevation?.value || 5);
    const fov = Number(settings.fov?.value || 35);
    let yaw = 45;
    if (cameras.length) {
      const last = cameras[cameras.length - 1];
      yaw = last.yaw_deg + 30;
      if (yaw > 180) yaw -= 360;
    }
    const cam = camFromAngles(yaw, elev, radius, fov, cameras.length);
    cameras.push(cam);
    selectedCameraId = cam.id;
    previewCache.delete(cam.id);
    updateCamCount();
    updateDeleteEnabled();
    drawOrbit();
    updateReadiness();
    openPopupFor(cam.id);
  }

  function deleteSelected() {
    if (!selectedCameraId) return;
    const idx = cameras.findIndex((c) => c.id === selectedCameraId);
    if (idx < 0) return;
    cameras.splice(idx, 1);
    reindexCameras();
    selectedCameraId = cameras[Math.min(idx, cameras.length - 1)]?.id || null;
    closePopup();
    updateCamCount();
    updateDeleteEnabled();
    drawOrbit();
    updateReadiness();
  }

  function duplicateSelected() {
    const cam = cameras.find((c) => c.id === selectedCameraId);
    if (!cam) return;
    const radius = Number(settings.radius?.value || 3);
    const fov = Number(settings.fov?.value || 35);
    const copy = camFromAngles(cam.yaw_deg + 15, cam.elevation_deg, radius, fov, cameras.length);
    cameras.push(copy);
    selectedCameraId = copy.id;
    updateCamCount();
    updateDeleteEnabled();
    drawOrbit();
    updateReadiness();
    openPopupFor(copy.id);
  }

  function updateCamCount() {
    const el = $('itsCamCount');
    if (el) el.textContent = cameras.length + (cameras.length === 1 ? ' camera' : ' cameras');
  }

  function updateDeleteEnabled() {
    const btn = $('itsDeleteCam');
    if (btn) btn.disabled = !selectedCameraId;
  }

  function screenPosForCam(cam, layout) {
    const { cx, cy, radiusPx } = layout;
    const yawRad = (cam.yaw_deg * Math.PI) / 180;
    const x = cx + Math.sin(yawRad) * radiusPx;
    const y =
      cy +
      Math.cos(yawRad) * radiusPx * 0.38 -
      Math.sin((cam.elevation_deg * Math.PI) / 180) * radiusPx * 0.25;
    return { x, y };
  }

  function drawOrbit() {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || 640;
    const h = canvas.clientHeight || 360;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const g = ctx.createRadialGradient(w * 0.5, h * 0.52, 10, w * 0.5, h * 0.5, w * 0.45);
    g.addColorStop(0, 'rgba(30, 50, 80, 0.35)');
    g.addColorStop(1, 'rgba(8, 11, 18, 0.1)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    const cx = w * 0.5;
    const cy = h * 0.55;
    const radiusPx = Math.min(w, h) * 0.32;
    const elevDefault = Number(settings.elevation?.value || 5) * (Math.PI / 180);

    lastDrawLayout = { cx, cy, radiusPx, elevScale: 0.25, w, h };

    ctx.strokeStyle = 'rgba(200,255,0,0.2)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(cx, cy, radiusPx, radiusPx * 0.38, 0, 0, Math.PI * 2);
    ctx.stroke();

    if (cameras.length >= 2) {
      const yaws = cameras.map((c) => c.yaw_deg).sort((a, b) => a - b);
      ctx.strokeStyle = 'rgba(100, 180, 255, 0.45)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let i = 0; i < yaws.length; i++) {
        const yawRad = (yaws[i] * Math.PI) / 180;
        const x = cx + Math.sin(yawRad) * radiusPx;
        const y = cy + Math.cos(yawRad) * radiusPx * 0.38;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    } else {
      const sweep = Number(settings.sweep?.value || 360) * (Math.PI / 180);
      const startA = -Math.PI / 2 - sweep / 2;
      ctx.strokeStyle = 'rgba(100, 180, 255, 0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i <= 48; i++) {
        const t = i / 48;
        const a = startA + sweep * t;
        const x = cx + Math.cos(a) * radiusPx;
        const y = cy + Math.sin(a) * radiusPx * 0.38 - Math.sin(elevDefault) * radiusPx * 0.25;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    ctx.fillStyle = 'rgba(200,255,0,0.85)';
    ctx.beginPath();
    ctx.ellipse(cx, cy, 28, 16, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(8,11,18,0.9)';
    ctx.font = '600 10px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('SUBJECT', cx, cy + 4);

    cameras.forEach((cam) => {
      const { x, y } = screenPosForCam(cam, lastDrawLayout);
      const selected = cam.id === selectedCameraId;

      ctx.strokeStyle = selected ? 'rgba(200,255,0,0.55)' : 'rgba(255,255,255,0.12)';
      ctx.lineWidth = selected ? 1.5 : 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(cx, cy);
      ctx.stroke();

      ctx.fillStyle = selected ? '#c8ff00' : 'rgba(120, 200, 255, 0.95)';
      ctx.beginPath();
      ctx.arc(x, y, selected ? 7 : 5, 0, Math.PI * 2);
      ctx.fill();
      if (selected) {
        ctx.strokeStyle = 'rgba(200,255,0,0.9)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 10, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.font = '10px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(String(cam.index + 1), x, y - 12);
    });

    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '11px system-ui';
    ctx.textAlign = 'left';
    const label =
      cameras.length > 0
        ? `${cameras.length} placed · drag to move · click to preview`
        : `No cameras — Add or Generate ring · r=${Number(settings.radius?.value || 3).toFixed(1)}`;
    ctx.fillText(label, 12, h - 12);
  }

  function hitTestCamera(clientX, clientY) {
    if (!canvas || !lastDrawLayout) return null;
    const rect = canvas.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * lastDrawLayout.w;
    const y = ((clientY - rect.top) / rect.height) * lastDrawLayout.h;
    let best = null;
    let bestDist = 16;
    for (const cam of cameras) {
      const p = screenPosForCam(cam, lastDrawLayout);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestDist) {
        bestDist = d;
        best = cam;
      }
    }
    return best;
  }

  function pointerToAngles(clientX, clientY) {
    if (!canvas || !lastDrawLayout) return null;
    const rect = canvas.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * lastDrawLayout.w;
    const y = ((clientY - rect.top) / rect.height) * lastDrawLayout.h;
    const { cx, cy, radiusPx } = lastDrawLayout;
    const dx = x - cx;
    const dy = (y - cy) / 0.38;
    const yaw = (Math.atan2(dx, dy) * 180) / Math.PI;
    const elev =
      (-((y - cy) - Math.cos((yaw * Math.PI) / 180) * radiusPx * 0.38) / (radiusPx * 0.25)) *
      (180 / Math.PI);
    const clampedElev = Math.max(-25, Math.min(50, elev));
    return { yaw_deg: yaw, elevation_deg: clampedElev };
  }

  function closePopup() {
    if (popup) popup.hidden = true;
    popupOpen = false;
  }

  function positionPopupNear(cam) {
    if (!popup || !canvas || !lastDrawLayout) return;
    if (window.innerWidth <= 650) return;
    const rect = canvas.getBoundingClientRect();
    const p = screenPosForCam(cam, lastDrawLayout);
    const sx = rect.left + (p.x / lastDrawLayout.w) * rect.width;
    const sy = rect.top + (p.y / lastDrawLayout.h) * rect.height;
    const pad = 12;
    let left = sx + 18;
    let top = sy - 40;
    const pw = popup.offsetWidth || 300;
    const ph = popup.offsetHeight || 280;
    if (left + pw > window.innerWidth - pad) left = sx - pw - 12;
    if (left < pad) left = pad;
    if (top + ph > window.innerHeight - pad) top = window.innerHeight - ph - pad;
    if (top < pad) top = pad;
    popup.style.left = `${Math.round(left)}px`;
    popup.style.top = `${Math.round(top)}px`;
    popup.style.bottom = 'auto';
    popup.style.right = 'auto';
  }

  function renderCameraPreview(cam) {
    if (!popupCanvas) return;
    const ctx = popupCanvas.getContext('2d');
    const w = popupCanvas.width;
    const h = popupCanvas.height;
    ctx.clearRect(0, 0, w, h);

    if (!sourceBitmap && files.length === 0) {
      ctx.fillStyle = '#0a0e16';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.font = '12px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('Load a photo to preview this angle', w / 2, h / 2);
      return;
    }

    const drawFromBitmap = (bitmap) => {
      const shift = (cam.yaw_deg / 180) * bitmap.width * 0.14;
      const elevShift = Math.sin((cam.elevation_deg * Math.PI) / 180) * bitmap.height * 0.06;
      const scale = 1.1;
      const sw = bitmap.width / scale;
      const sh = bitmap.height / scale;
      const sx = Math.max(0, Math.min(bitmap.width - sw, (bitmap.width - sw) / 2 + shift));
      const sy = Math.max(0, Math.min(bitmap.height - sh, (bitmap.height - sh) / 2 - elevShift));
      ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, w, h);
      const vg = ctx.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, h * 0.75);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,0.35)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, h - 24, w, 24);
      ctx.fillStyle = '#c8ff00';
      ctx.font = '11px system-ui';
      ctx.textAlign = 'left';
      ctx.fillText(`${cam.id} · ${cam.yaw_deg.toFixed(0)}° / ${cam.elevation_deg.toFixed(0)}°`, 8, h - 8);
    };

    if (sourceBitmap) {
      drawFromBitmap(sourceBitmap);
      return;
    }

    const f = files[0];
    if (!f) return;
    createImageBitmap(f)
      .then((bmp) => {
        sourceBitmap = bmp;
        drawFromBitmap(bmp);
      })
      .catch(() => {
        ctx.fillStyle = '#0a0e16';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#ff8b8b';
        ctx.font = '12px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText('Could not load preview', w / 2, h / 2);
      });
  }

  function openPopupFor(id) {
    const cam = cameras.find((c) => c.id === id);
    if (!cam || !popup) return;
    selectedCameraId = id;
    updateDeleteEnabled();
    drawOrbit();

    const title = $('itsCamPopupTitle');
    const angles = $('itsCamPopupAngles');
    if (title) title.textContent = cam.id.replace('_', ' ').toUpperCase();
    if (angles) {
      angles.textContent = `Yaw ${cam.yaw_deg.toFixed(1)}° · Elev ${cam.elevation_deg.toFixed(1)}° · FOV ${cam.fov_deg}°`;
    }
    renderCameraPreview(cam);
    popup.hidden = false;
    popupOpen = true;
    requestAnimationFrame(() => positionPopupNear(cam));
  }

  function coverageScore() {
    const n = files.length;
    let score = 0;
    if (n >= 1) score += 20;
    if (n >= 3) score += 20;
    if (n >= 8) score += 20;
    if (n >= 20) score += 10;
    const camN = cameras.length;
    score += Math.min(20, Math.floor(camN * 1.5));
    if (camN >= 2) {
      const yaws = cameras.map((c) => c.yaw_deg);
      const span = Math.max(...yaws) - Math.min(...yaws);
      if (span >= 120) score += 5;
      if (span >= 240) score += 5;
    }
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
        [cameras.length >= 4, `Camera plan density ≥ 4 (${cameras.length} placed)`],
        [cameras.length >= 2, 'At least two camera angles placed'],
        [false, 'GPU reconstruction worker connected (not yet)'],
      ];
      list.innerHTML = items
        .map(([ok, label]) => `<li class="${ok ? 'ok' : 'no'}">${ok ? '✓' : '○'} ${label}</li>`)
        .join('');
    }
    const has = files.length > 0;
    const hasCams = cameras.length > 0;
    ['itsGenPreviews', 'itsSaveLocal', 'itsExportPlan', 'itsExportJson', 'itsClearFiles'].forEach((id) => {
      const el = $(id);
      if (!el) return;
      if (id === 'itsClearFiles') el.disabled = !has;
      else if (id.startsWith('itsExport') || id === 'itsGenPreviews' || id === 'itsSaveLocal') {
        el.disabled = !(has && hasCams);
      }
    });
  }

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

  function renderFiles() {
    cleanupUrls();
    if (sourceBitmap) {
      sourceBitmap.close?.();
      sourceBitmap = null;
    }
    previewCache.clear();
    grid.replaceChildren();
    countLabel.textContent = files.length + (files.length === 1 ? ' image selected' : ' images selected');
    updateReadiness();

    if (!files.length) {
      const empty = document.createElement('div');
      empty.className = 'its-empty';
      empty.innerHTML =
        '<span>▧</span><strong>Your source gallery will appear here</strong><p>Drop listing photos or phone shots — they stay on this device until you export.</p>';
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

    createImageBitmap(files[0])
      .then((bmp) => {
        sourceBitmap = bmp;
        if (popupOpen && selectedCameraId) {
          const cam = cameras.find((c) => c.id === selectedCameraId);
          if (cam) renderCameraPreview(cam);
        }
      })
      .catch(() => {});

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
    const mode = document.querySelector('input[name="itsMode"]:checked')?.value || 'reproject';
    const radius = Number(settings.radius?.value || 3);
    const fov = Number(settings.fov?.value || 35);
    const cams = cameras.map((c, i) =>
      camFromAngles(c.yaw_deg, c.elevation_deg, radius, c.fov_deg || fov, i)
    );
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
        ai_fill: false,
        placement: 'free_or_ring',
      },
      camera_plan: {
        count: cams.length,
        sweep_deg: Number(settings.sweep?.value || 360),
        radius,
        elevation_deg: Number(settings.elevation?.value || 5),
        fov_deg: fov,
        units: 'scene_relative',
        cameras: cams,
      },
      provenance: {
        client: 'fumoca-image-to-splat-studio',
        camera_positions_are_planned: true,
        not_a_trained_splat: true,
        metric_scale_unknown: true,
        viewpoint_previews_are_approximate: true,
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
    if (!files.length || !cameras.length) return;
    const blob = new Blob([JSON.stringify(cameraPlan(), null, 2)], { type: 'application/json' });
    downloadBlob(blob, 'fumoca-image-to-splat-camera-plan.json');
  });

  exportButton.addEventListener('click', async () => {
    if (!files.length || !cameras.length) return;
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
          'Cameras may be free-placed or generated as a ring.\n' +
          'This is NOT a trained Gaussian splat.\n' +
          'Coverage score: ' +
          coverageScore() +
          '\n' +
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

  async function generateAnglePreviews() {
    if (!files.length || !cameras.length) return;
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
    const sample = cameras.filter((_, i) => i % Math.max(1, Math.floor(cameras.length / 6)) === 0).slice(0, 6);

    for (const cam of sample) {
      const c = document.createElement('canvas');
      const w = 240;
      const h = 160;
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      const shift = (cam.yaw_deg / 180) * bitmap.width * 0.12;
      const scale = 1.08;
      const sw = bitmap.width / scale;
      const sh = bitmap.height / scale;
      const sx = Math.max(0, Math.min(bitmap.width - sw, (bitmap.width - sw) / 2 + shift));
      const sy = Math.max(
        0,
        Math.min(bitmap.height - sh, (bitmap.height - sh) / 2 - Math.sin((cam.elevation_deg * Math.PI) / 180) * bitmap.height * 0.04)
      );
      ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, w, h);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, h - 22, w, 22);
      ctx.fillStyle = '#c8ff00';
      ctx.font = '11px system-ui';
      ctx.fillText(`${cam.id} · ${cam.yaw_deg.toFixed(0)}°`, 8, h - 7);
      const url = c.toDataURL('image/jpeg', 0.85);
      previewUrls.push(url);
      const fig = document.createElement('figure');
      fig.innerHTML = `<img src="${url}" alt=""><figcaption>Placed ${cam.yaw_deg.toFixed(0)}°</figcaption>`;
      strip.append(fig);
    }
    bitmap.close?.();
    btn.disabled = false;
    btn.textContent = 'Generate angle previews';
    const note = $('itsReadyNote');
    if (note) {
      note.textContent =
        'Previews are parallax crops of your source photo for plan checking — not AI-generated novel views or a splat.';
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
    if (!files.length || !cameras.length) return;
    try {
      const plan = cameraPlan();
      localStorage.setItem('fumoca_its_last_project', JSON.stringify(plan));
      localStorage.setItem('fumoca_its_last_saved_at', new Date().toISOString());
      alert(
        'Camera plan saved in this browser.\nCoverage score: ' +
          plan.coverage_score +
          '\nCameras: ' +
          cameras.length +
          '\n\nImages were not uploaded. Export ZIP to move the full package.'
      );
    } catch (e) {
      alert('Could not save locally: ' + e.message);
    }
  });

  $('itsOpenChecklist')?.addEventListener('click', () => {
    const score = coverageScore();
    const lines = [
      'FUMOCA Image → Splat test checklist',
      '',
      '1. Load 1+ product photos',
      '2. Add cameras or Generate ring',
      '3. Drag cameras · click to open viewpoint popup',
      '4. Export JSON camera plan',
      '5. Export ZIP project bundle',
      '6. (Later) Hand ZIP to reconstruction worker',
      '',
      'Current coverage score: ' + score,
      'Images: ' + files.length + ' · Cameras: ' + cameras.length,
      'Status: preparation only — not a trained splat',
    ].join('\n');
    alert(lines);
  });

  function onPointerDown(e) {
    if (!canvas) return;
    const hit = hitTestCamera(e.clientX, e.clientY);
    if (hit) {
      selectedCameraId = hit.id;
      updateDeleteEnabled();
      openPopupFor(hit.id);
      dragState = { id: hit.id, pointerId: e.pointerId };
      orbitHost?.classList.add('is-dragging');
      canvas.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    } else {
      selectedCameraId = null;
      updateDeleteEnabled();
      closePopup();
      drawOrbit();
    }
  }

  function onPointerMove(e) {
    if (!dragState || e.pointerId !== dragState.pointerId) return;
    const cam = cameras.find((c) => c.id === dragState.id);
    if (!cam) return;
    const angles = pointerToAngles(e.clientX, e.clientY);
    if (!angles) return;
    const radius = Number(settings.radius?.value || 3);
    const fov = cam.fov_deg || Number(settings.fov?.value || 35);
    const updated = camFromAngles(angles.yaw_deg, angles.elevation_deg, radius, fov, cam.index);
    updated.id = cam.id;
    Object.assign(cam, updated);
    previewCache.delete(cam.id);
    drawOrbit();
    if (popupOpen && selectedCameraId === cam.id) {
      const anglesEl = $('itsCamPopupAngles');
      if (anglesEl) {
        anglesEl.textContent = `Yaw ${cam.yaw_deg.toFixed(1)}° · Elev ${cam.elevation_deg.toFixed(1)}° · FOV ${cam.fov_deg}°`;
      }
      renderCameraPreview(cam);
      positionPopupNear(cam);
    }
    e.preventDefault();
  }

  function onPointerUp(e) {
    if (!dragState || e.pointerId !== dragState.pointerId) return;
    dragState = null;
    orbitHost?.classList.remove('is-dragging');
    updateReadiness();
  }

  if (canvas) {
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
  }

  $('itsAddCam')?.addEventListener('click', () => addCamera());
  $('itsDeleteCam')?.addEventListener('click', () => deleteSelected());
  $('itsGenerateRing')?.addEventListener('click', () => buildRingCameras());
  $('itsCamPopupClose')?.addEventListener('click', () => closePopup());
  $('itsCamPopupDup')?.addEventListener('click', () => duplicateSelected());
  $('itsCamPopupUse')?.addEventListener('click', () => closePopup());

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePopup();
    if (
      (e.key === 'Delete' || e.key === 'Backspace') &&
      selectedCameraId &&
      !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)
    ) {
      e.preventDefault();
      deleteSelected();
    }
  });

  document.querySelectorAll('input[name="itsMode"]').forEach((el) => {
    el.addEventListener('change', () => {
      document.querySelectorAll('.its-mode').forEach((lab) => lab.classList.remove('selected'));
      el.closest('.its-mode')?.classList.add('selected');
      updateReadiness();
    });
  });

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
    if (sourceBitmap) {
      sourceBitmap.close?.();
      sourceBitmap = null;
    }
    const strip = $('itsPreviewStrip');
    if (strip) {
      strip.hidden = true;
      strip.innerHTML = '';
    }
    closePopup();
    renderFiles();
  });

  Object.values(settings).forEach((el) => {
    el?.addEventListener('input', updateOutputs);
  });

  $('itsResetPlan')?.addEventListener('click', () => {
    if (settings.count) settings.count.value = '12';
    if (settings.sweep) settings.sweep.value = '360';
    if (settings.radius) settings.radius.value = '3';
    if (settings.elevation) settings.elevation.value = '5';
    if (settings.fov) settings.fov.value = '35';
    cameras = [];
    selectedCameraId = null;
    previewCache.clear();
    closePopup();
    updateCamCount();
    updateDeleteEnabled();
    updateOutputs();
  });

  window.addEventListener('resize', () => {
    drawOrbit();
    if (popupOpen && selectedCameraId) {
      const cam = cameras.find((c) => c.id === selectedCameraId);
      if (cam) positionPopupNear(cam);
    }
  });
  window.addEventListener('beforeunload', () => {
    cleanupUrls();
    sourceBitmap?.close?.();
  });

  try {
    const prev = localStorage.getItem('fumoca_its_last_project');
    if (prev && $('itsReadyNote')) {
      const p = JSON.parse(prev);
      $('itsReadyNote').textContent = `Last local plan: ${p.source?.image_count || '?'} images, ${
        p.camera_plan?.count ?? '?'
      } cameras, score ${p.coverage_score ?? '—'} (${localStorage.getItem('fumoca_its_last_saved_at') || ''}). Load photos again to continue.`;
    }
  } catch (_) {}

  updateCamCount();
  updateDeleteEnabled();
  renderFiles();
  updateOutputs();
})();
