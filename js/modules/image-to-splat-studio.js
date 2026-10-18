/* FUMOCA Image-to-Splat Studio v3 — depth-aware angles + multi-photo match.
 * Place cameras → depth map lifts the subject → previews show doors/tyres/panels shifting.
 * Not a trained Gaussian splat. Worker still required for full reconstruction.
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

  /** Per-source depth + image data cache */
  const sourceCache = new Map(); // index -> { bitmap, imageData, depthMap, width, height, method }

  let cameras = [];
  let selectedCameraId = null;
  let dragState = null;
  let lastDrawLayout = null;
  let popupOpen = false;
  let depthBusy = false;

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

  // ── Orbit canvas host ───────────────────────────────────────
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
        <div><h2>Test readiness</h2><p>Depth-aware local previews vs full reconstruction backend.</p></div>
      </div>
      <div class="its-depth-status" id="itsDepthStatus">Depth: waiting for a photo…</div>
      <div class="its-ready-grid">
        <div class="its-ready-score"><div class="its-score-val" id="itsScoreVal">0</div><div class="its-score-lbl">Coverage score</div></div>
        <ul class="its-ready-list" id="itsReadyList"></ul>
      </div>
      <div class="its-actions its-ready-actions">
        <button type="button" class="its-primary" id="itsGenPreviews" disabled>Generate angle previews</button>
        <button type="button" class="its-secondary" id="itsRebuildDepth" disabled>Rebuild depth</button>
        <button type="button" class="its-secondary" id="itsSaveLocal" disabled>Save project locally</button>
        <button type="button" class="its-secondary" id="itsOpenChecklist">Open test checklist</button>
      </div>
      <div id="itsPreviewStrip" class="its-preview-strip" hidden></div>
      <p class="its-note" id="itsReadyNote">Load photos → depth lifts the subject → place cameras → previews shift panels and edges. Full Gaussian splat still needs a worker.</p>`;
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

  function setDepthStatus(msg, state) {
    const el = $('itsDepthStatus');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('is-ready', 'is-busy');
    if (state) el.classList.add(state);
  }

  // ── Depth estimation ────────────────────────────────────────
  function estimateDepthHeuristicLocal(imgData) {
    const { data, width, height } = imgData;
    const depth = new Float32Array(width * height);
    const lum = new Float32Array(width * height);
    for (let i = 0; i < width * height; i++) {
      const r = data[i * 4] / 255, g = data[i * 4 + 1] / 255, b = data[i * 4 + 2] / 255;
      lum[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    }
    const edges = new Float32Array(width * height);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x;
        const gx =
          -lum[(y - 1) * width + x - 1] + lum[(y - 1) * width + x + 1] -
          2 * lum[y * width + x - 1] + 2 * lum[y * width + x + 1] -
          lum[(y + 1) * width + x - 1] + lum[(y + 1) * width + x + 1];
        const gy =
          -lum[(y - 1) * width + x - 1] - 2 * lum[(y - 1) * width + x] - lum[(y - 1) * width + x + 1] +
          lum[(y + 1) * width + x - 1] + 2 * lum[(y + 1) * width + x] + lum[(y + 1) * width + x + 1];
        edges[i] = Math.sqrt(gx * gx + gy * gy);
      }
    }
    // box blur edges lightly
    const smooth = new Float32Array(edges.length);
    const r = 2;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0, c = 0;
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              sum += edges[ny * width + nx];
              c++;
            }
          }
        }
        smooth[y * width + x] = sum / c;
      }
    }
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const vert = y / height;
        const edgeCue = Math.min(1, smooth[i] * 4);
        const lumCue = 1 - lum[i];
        // centre bias: subject often in middle → nearer
        const cx = (x / width - 0.5) * 2;
        const cy = (y / height - 0.5) * 2;
        const centre = 1 - Math.min(1, Math.sqrt(cx * cx + cy * cy * 0.6));
        depth[i] = 0.28 * vert + 0.22 * edgeCue + 0.2 * lumCue + 0.3 * centre;
      }
    }
    // simple horizontal blur pass for stability
    const out = new Float32Array(depth.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let s = 0, c = 0;
        for (let dx = -3; dx <= 3; dx++) {
          const nx = Math.max(0, Math.min(width - 1, x + dx));
          s += depth[y * width + nx];
          c++;
        }
        out[y * width + x] = s / c;
      }
    }
    return out;
  }

  async function buildDepthForIndex(index) {
    const file = files[index];
    if (!file) return null;
    setDepthStatus(`Building depth for photo ${index + 1}…`, 'is-busy');
    depthBusy = true;
    try {
      const bitmap = await createImageBitmap(file);
      // downsample for depth speed
      const maxSide = 480;
      const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(32, Math.round(bitmap.width * scale));
      const h = Math.max(32, Math.round(bitmap.height * scale));
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bitmap, 0, 0, w, h);
      const imageData = ctx.getImageData(0, 0, w, h);

      let depthMap = null;
      let method = 'heuristic';
      const R = window.FumocSceneReconstructor;
      if (R && typeof R.estimateDepthHeuristic === 'function') {
        depthMap = R.estimateDepthHeuristic(imageData);
        method = 'heuristic (engine)';
      } else {
        depthMap = estimateDepthHeuristicLocal(imageData);
      }
      // Prefer midas if available and not too slow — try auto once for first image
      if (R && typeof R.estimateDepthMidas === 'function' && index === 0) {
        try {
          setDepthStatus('Trying neural depth model…', 'is-busy');
          const midas = await Promise.race([
            R.estimateDepthMidas(imageData, (p, m) => setDepthStatus(m || `Depth ${p}%`, 'is-busy')),
            new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 25000)),
          ]);
          if (midas && midas.length === depthMap.length) {
            depthMap = midas;
            method = R.estimateDepthMidas.lastMethod || 'midas';
          }
        } catch (_) {
          /* keep heuristic */
        }
      }

      const entry = { bitmap, imageData, depthMap, width: w, height: h, method, fullBitmap: bitmap };
      sourceCache.set(index, entry);
      setDepthStatus(`Depth ready · ${method} · ${w}×${h} · photo ${index + 1}/${files.length}`, 'is-ready');
      return entry;
    } catch (err) {
      console.warn('[ITS] depth failed', err);
      setDepthStatus('Depth failed — using flat parallax fallback', 'is-busy');
      return null;
    } finally {
      depthBusy = false;
    }
  }

  async function ensureAllDepth() {
    for (let i = 0; i < files.length; i++) {
      if (!sourceCache.has(i)) await buildDepthForIndex(i);
    }
  }

  // ── Depth-aware viewpoint warp ──────────────────────────────
  /**
   * Warp source image as if the camera moved by yaw/elevation.
   * Near pixels (high depth) shift more → doors/tyres/panels separate from background.
   */
  function renderDepthView(entry, cam, targetCanvas, opts = {}) {
    const ctx = targetCanvas.getContext('2d');
    const tw = targetCanvas.width;
    const th = targetCanvas.height;
    ctx.clearRect(0, 0, tw, th);
    if (!entry) {
      ctx.fillStyle = '#0a0e16';
      ctx.fillRect(0, 0, tw, th);
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.font = '12px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('Load a photo for depth preview', tw / 2, th / 2);
      return;
    }

    const { imageData, depthMap, width: sw, height: sh, bitmap } = entry;
    const yaw = (cam.yaw_deg * Math.PI) / 180;
    const elev = (cam.elevation_deg * Math.PI) / 180;
    // Strength tuned for product photos — noticeable but stable
    const strength = opts.strength != null ? opts.strength : 0.22;
    const maxShiftX = sw * strength * Math.sin(yaw);
    const maxShiftY = sh * strength * 0.55 * Math.sin(elev);

    // Work at intermediate resolution then scale up for quality
    const rw = Math.min(tw, 420);
    const rh = Math.min(th, Math.round((rw * th) / tw));
    const out = document.createElement('canvas');
    out.width = rw;
    out.height = rh;
    const octx = out.getContext('2d');
    const outData = octx.createImageData(rw, rh);
    const src = imageData.data;

    // Inverse mapping: for each output pixel, sample source with depth-dependent offset
    for (let oy = 0; oy < rh; oy++) {
      for (let ox = 0; ox < rw; ox++) {
        const u = ox / (rw - 1);
        const v = oy / (rh - 1);
        // base sample in source
        let sx = u * (sw - 1);
        let sy = v * (sh - 1);
        const ix = Math.max(0, Math.min(sw - 1, Math.round(sx)));
        const iy = Math.max(0, Math.min(sh - 1, Math.round(sy)));
        const d = depthMap[iy * sw + ix]; // 0 far … 1 near
        // near = more parallax
        const parallax = (d - 0.35) * 2; // centre around mid depth
        sx = sx - maxShiftX * parallax;
        sy = sy + maxShiftY * parallax;
        // slight FOV zoom toward subject centre for stronger "orbit" feel
        const zoom = 1 + 0.06 * Math.abs(Math.sin(yaw)) + 0.04 * Math.abs(Math.sin(elev));
        sx = (sx - (sw - 1) / 2) / zoom + (sw - 1) / 2;
        sy = (sy - (sh - 1) / 2) / zoom + (sh - 1) / 2;

        const sx0 = Math.max(0, Math.min(sw - 1, Math.floor(sx)));
        const sy0 = Math.max(0, Math.min(sh - 1, Math.floor(sy)));
        const sx1 = Math.min(sw - 1, sx0 + 1);
        const sy1 = Math.min(sh - 1, sy0 + 1);
        const fx = sx - sx0;
        const fy = sy - sy0;
        const oi = (oy * rw + ox) * 4;
        for (let ch = 0; ch < 3; ch++) {
          const p00 = src[(sy0 * sw + sx0) * 4 + ch];
          const p10 = src[(sy0 * sw + sx1) * 4 + ch];
          const p01 = src[(sy1 * sw + sx0) * 4 + ch];
          const p11 = src[(sy1 * sw + sx1) * 4 + ch];
          outData.data[oi + ch] =
            p00 * (1 - fx) * (1 - fy) + p10 * fx * (1 - fy) + p01 * (1 - fx) * fy + p11 * fx * fy;
        }
        outData.data[oi + 3] = 255;
      }
    }
    octx.putImageData(outData, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(out, 0, 0, tw, th);

    // vignette + label
    const vg = ctx.createRadialGradient(tw / 2, th / 2, th * 0.15, tw / 2, th / 2, th * 0.8);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.4)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, tw, th);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, th - 26, tw, 26);
    ctx.fillStyle = '#c8ff00';
    ctx.font = '11px system-ui';
    ctx.textAlign = 'left';
    ctx.fillText(
      `${cam.id} · ${cam.yaw_deg.toFixed(0)}°/${cam.elevation_deg.toFixed(0)}° · depth ${entry.method}`,
      8,
      th - 9
    );
  }

  /** Pick best source index for a camera (multi-photo). */
  function bestSourceForCam(cam) {
    if (files.length === 0) return -1;
    if (files.length === 1) return 0;
    // Prefer photo assigned on camera, else nearest by index spread across yaw
    if (cam.sourceIndex != null && cam.sourceIndex >= 0 && cam.sourceIndex < files.length) {
      return cam.sourceIndex;
    }
    // Map yaw -180..180 to file index
    const t = (cam.yaw_deg + 180) / 360;
    return Math.min(files.length - 1, Math.max(0, Math.round(t * (files.length - 1))));
  }

  // ── Camera math ─────────────────────────────────────────────
  function camFromAngles(yawDeg, elevDeg, radius, fov, index, sourceIndex) {
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
      sourceIndex: sourceIndex != null ? sourceIndex : null,
    };
  }

  function reindexCameras() {
    cameras.forEach((c, i) => {
      c.index = i;
      c.id = `cam_${String(i + 1).padStart(3, '0')}`;
    });
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
      const src = files.length ? Math.min(files.length - 1, Math.round(t * (files.length - 1))) : 0;
      next.push(camFromAngles(yaw, elev, radius, fov, i, src));
    }
    cameras = next;
    selectedCameraId = cameras[0]?.id || null;
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
      yaw = cameras[cameras.length - 1].yaw_deg + 30;
      if (yaw > 180) yaw -= 360;
    }
    const cam = camFromAngles(yaw, elev, radius, fov, cameras.length, bestSourceForCam({ yaw_deg: yaw }));
    cameras.push(cam);
    selectedCameraId = cam.id;
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
    const copy = camFromAngles(cam.yaw_deg + 15, cam.elevation_deg, radius, fov, cameras.length, cam.sourceIndex);
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
    lastDrawLayout = { cx, cy, radiusPx, w, h };

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
      yaws.forEach((yawDeg, i) => {
        const yawRad = (yawDeg * Math.PI) / 180;
        const x = cx + Math.sin(yawRad) * radiusPx;
        const y = cy + Math.cos(yawRad) * radiusPx * 0.38;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
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
    ctx.fillText(
      cameras.length
        ? `${cameras.length} placed · depth previews · drag · click`
        : 'Add camera or Generate ring',
      12,
      h - 12
    );
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
    return { yaw_deg: yaw, elevation_deg: Math.max(-25, Math.min(50, elev)) };
  }

  function closePopup() {
    if (popup) popup.hidden = true;
    popupOpen = false;
  }

  function positionPopupNear(cam) {
    if (!popup || !canvas || !lastDrawLayout || window.innerWidth <= 650) return;
    const rect = canvas.getBoundingClientRect();
    const p = screenPosForCam(cam, lastDrawLayout);
    const sx = rect.left + (p.x / lastDrawLayout.w) * rect.width;
    const sy = rect.top + (p.y / lastDrawLayout.h) * rect.height;
    const pad = 12;
    let left = sx + 18;
    let top = sy - 40;
    const pw = popup.offsetWidth || 360;
    const ph = popup.offsetHeight || 320;
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
    // Ensure canvas resolution
    if (popupCanvas.width < 320) {
      popupCanvas.width = 320;
      popupCanvas.height = 200;
    }
    const srcIdx = bestSourceForCam(cam);
    const entry = sourceCache.get(srcIdx);
    renderDepthView(entry, cam, popupCanvas, { strength: 0.28 });

    const note = $('itsCamPopupNote');
    if (note) {
      note.textContent = entry
        ? `Depth-aware view · ${entry.method} · photo ${srcIdx + 1}`
        : 'Load a photo — depth builds automatically';
    }

    // Photo assign dropdown
    let assign = $('itsCamSourceAssign');
    if (!assign && popup) {
      const wrap = document.createElement('div');
      wrap.className = 'its-photo-assign';
      wrap.innerHTML = `<label>Source photo for this camera<select id="itsCamSourceAssign"></select></label>`;
      popup.querySelector('.its-cam-popup-actions')?.before(wrap);
      assign = $('itsCamSourceAssign');
      assign?.addEventListener('change', () => {
        const c = cameras.find((x) => x.id === selectedCameraId);
        if (!c) return;
        c.sourceIndex = Number(assign.value);
        renderCameraPreview(c);
      });
    }
    if (assign) {
      assign.innerHTML = files
        .map((f, i) => `<option value="${i}" ${i === srcIdx ? 'selected' : ''}>${i + 1}. ${f.name}</option>`)
        .join('');
      if (!files.length) assign.innerHTML = '<option value="-1">No photos</option>';
    }
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
    if (n >= 1) score += 15;
    if (n >= 3) score += 20;
    if (n >= 6) score += 15;
    if (n >= 12) score += 10;
    score += Math.min(25, cameras.length * 2);
    if (sourceCache.size > 0) score += 10;
    if (cameras.length >= 2) {
      const yaws = cameras.map((c) => c.yaw_deg);
      const span = Math.max(...yaws) - Math.min(...yaws);
      if (span >= 120) score += 5;
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
      const items = [
        [files.length >= 1, 'Source images loaded'],
        [files.length >= 3, 'Multi-view overlap likely (3+ photos)'],
        [sourceCache.size >= 1, `Depth map ready (${sourceCache.size} photo${sourceCache.size === 1 ? '' : 's'})`],
        [cameras.length >= 4, `Camera plan density ≥ 4 (${cameras.length} placed)`],
        [false, 'GPU reconstruction worker connected (not yet)'],
      ];
      list.innerHTML = items
        .map(([ok, label]) => `<li class="${ok ? 'ok' : 'no'}">${ok ? '✓' : '○'} ${label}</li>`)
        .join('');
    }
    const has = files.length > 0;
    const hasCams = cameras.length > 0;
    ['itsGenPreviews', 'itsSaveLocal', 'itsExportPlan', 'itsExportJson', 'itsClearFiles', 'itsRebuildDepth'].forEach(
      (id) => {
        const el = $(id);
        if (!el) return;
        if (id === 'itsClearFiles') el.disabled = !has;
        else if (id === 'itsRebuildDepth') el.disabled = !has || depthBusy;
        else el.disabled = !(has && hasCams);
      }
    );
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
  function clearSourceCache() {
    sourceCache.forEach((e) => {
      e.bitmap?.close?.();
      e.fullBitmap?.close?.();
    });
    sourceCache.clear();
  }

  function renderFiles() {
    cleanupUrls();
    grid.replaceChildren();
    countLabel.textContent = files.length + (files.length === 1 ? ' image selected' : ' images selected');
    updateReadiness();
    if (!files.length) {
      clearSourceCache();
      setDepthStatus('Depth: waiting for a photo…');
      const empty = document.createElement('div');
      empty.className = 'its-empty';
      empty.innerHTML =
        '<span>▧</span><strong>Your source gallery will appear here</strong><p>Drop listing photos — depth builds so angle previews can shift doors, tyres and panels.</p>';
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
        clearSourceCache();
        renderFiles();
        if (files.length) ensureAllDepth().then(() => updateReadiness());
      });
    });
    drawOrbit();
    ensureAllDepth().then(() => {
      updateReadiness();
      if (popupOpen && selectedCameraId) {
        const cam = cameras.find((c) => c.id === selectedCameraId);
        if (cam) renderCameraPreview(cam);
      }
    });
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
    const cams = cameras.map((c, i) => {
      const base = camFromAngles(c.yaw_deg, c.elevation_deg, radius, c.fov_deg || fov, i, c.sourceIndex);
      return base;
    });
    return {
      schema: 'fumoca.image_to_splat.project.v3',
      created_at: new Date().toISOString(),
      status: 'camera_plan_depth_preview',
      coverage_score: coverageScore(),
      source: {
        image_count: files.length,
        files: files.map((f, i) => ({ index: i, name: f.name, size: f.size, type: f.type })),
        depth_ready: sourceCache.size,
      },
      mode: { reconstruction: mode, placement: 'free_or_ring', depth_previews: true },
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
        client: 'fumoca-image-to-splat-studio-v3',
        camera_positions_are_planned: true,
        not_a_trained_splat: true,
        metric_scale_unknown: true,
        viewpoint_previews: 'depth_aware_reprojection',
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
    downloadBlob(new Blob([JSON.stringify(cameraPlan(), null, 2)], { type: 'application/json' }), 'fumoca-image-to-splat-camera-plan.json');
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
        'FUMOCA Image-to-Splat v3\nDepth-aware previews are local approximations.\nNot a trained Gaussian splat.\nCoverage: ' +
          coverageScore() +
          '\n'
      );
      downloadBlob(await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 3 } }), 'fumoca-image-to-splat-project.zip');
    } catch (error) {
      console.error(error);
      alert('Could not package the images.');
    } finally {
      exportButton.disabled = false;
      exportButton.textContent = 'Export project bundle (.zip)';
      updateReadiness();
    }
  });

  async function generateAnglePreviews() {
    if (!files.length || !cameras.length) return;
    await ensureAllDepth();
    const strip = $('itsPreviewStrip');
    const btn = $('itsGenPreviews');
    if (!strip || !btn) return;
    btn.disabled = true;
    btn.textContent = 'Generating…';
    cleanupPreviews();
    strip.hidden = false;
    strip.innerHTML = '';
    const sample = cameras.filter((_, i) => i % Math.max(1, Math.floor(cameras.length / 8)) === 0).slice(0, 8);
    for (const cam of sample) {
      const c = document.createElement('canvas');
      c.width = 240;
      c.height = 150;
      const srcIdx = bestSourceForCam(cam);
      renderDepthView(sourceCache.get(srcIdx), cam, c, { strength: 0.3 });
      const url = c.toDataURL('image/jpeg', 0.88);
      previewUrls.push(url);
      const fig = document.createElement('figure');
      fig.className = 'is-depth';
      fig.innerHTML = `<img src="${url}" alt=""><figcaption><span class="its-tag">Depth</span> ${cam.yaw_deg.toFixed(0)}° · photo ${srcIdx + 1}</figcaption>`;
      strip.append(fig);
    }
    btn.disabled = false;
    btn.textContent = 'Generate angle previews';
    const note = $('itsReadyNote');
    if (note) {
      note.textContent =
        'Previews use depth-aware re-projection: near surfaces (body panels, tyres) shift more than the background. Still approximate — not AI novel views or a trained splat.';
    }
  }

  $('itsGenPreviews')?.addEventListener('click', () => {
    generateAnglePreviews().catch((e) => {
      console.error(e);
      alert('Preview generation failed: ' + (e.message || e));
      updateReadiness();
    });
  });

  $('itsRebuildDepth')?.addEventListener('click', async () => {
    clearSourceCache();
    await ensureAllDepth();
    if (popupOpen && selectedCameraId) {
      const cam = cameras.find((c) => c.id === selectedCameraId);
      if (cam) renderCameraPreview(cam);
    }
    updateReadiness();
  });

  $('itsSaveLocal')?.addEventListener('click', () => {
    if (!files.length || !cameras.length) return;
    try {
      const plan = cameraPlan();
      localStorage.setItem('fumoca_its_last_project', JSON.stringify(plan));
      localStorage.setItem('fumoca_its_last_saved_at', new Date().toISOString());
      alert('Camera plan saved.\nCoverage: ' + plan.coverage_score + '\nCameras: ' + cameras.length);
    } catch (e) {
      alert('Could not save: ' + e.message);
    }
  });

  $('itsOpenChecklist')?.addEventListener('click', () => {
    alert(
      [
        'FUMOCA Image → Splat checklist',
        '',
        '1. Load 1+ product photos (3–8 ideal)',
        '2. Wait for depth status = ready',
        '3. Add cameras or Generate ring',
        '4. Click a camera — door/tyre/panel should shift',
        '5. Generate angle previews strip',
        '6. Export ZIP for worker later',
        '',
        'Score: ' + coverageScore() + ' · Photos: ' + files.length + ' · Cams: ' + cameras.length,
      ].join('\n')
    );
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
    const updated = camFromAngles(angles.yaw_deg, angles.elevation_deg, radius, fov, cam.index, cam.sourceIndex);
    updated.id = cam.id;
    Object.assign(cam, updated);
    drawOrbit();
    if (popupOpen && selectedCameraId === cam.id) {
      const anglesEl = $('itsCamPopupAngles');
      if (anglesEl) anglesEl.textContent = `Yaw ${cam.yaw_deg.toFixed(1)}° · Elev ${cam.elevation_deg.toFixed(1)}° · FOV ${cam.fov_deg}°`;
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
      !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)
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
    clearSourceCache();
    const strip = $('itsPreviewStrip');
    if (strip) {
      strip.hidden = true;
      strip.innerHTML = '';
    }
    closePopup();
    renderFiles();
  });

  Object.values(settings).forEach((el) => el?.addEventListener('input', updateOutputs));

  $('itsResetPlan')?.addEventListener('click', () => {
    if (settings.count) settings.count.value = '12';
    if (settings.sweep) settings.sweep.value = '360';
    if (settings.radius) settings.radius.value = '3';
    if (settings.elevation) settings.elevation.value = '5';
    if (settings.fov) settings.fov.value = '35';
    cameras = [];
    selectedCameraId = null;
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
    clearSourceCache();
  });

  updateCamCount();
  updateDeleteEnabled();
  renderFiles();
  updateOutputs();
})();
