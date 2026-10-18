/* FUMOCA Angle Studio v4 — multi-photo match + video turntable, zero distortion */
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

  /** @type {{kind:'image'|'video'|'frame', file?:File, blob?:Blob, name:string, url:string, yaw?:number}[]} */
  let media = [];
  let selectedFrameIndex = -1;
  let cameras = [];
  let selectedCameraId = null;
  let dragState = null;
  let lastDrawLayout = null;
  let popupOpen = false;
  let videoFile = null;

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

  const canvas = $('itsOrbitCanvas');
  const popup = $('itsCamPopup');
  const orbitHost = $('itsOrbitLive');
  const spinRange = $('itsSpin');
  const spinImg = $('itsSpinImg');
  const spinEmpty = $('itsSpinEmpty');

  function framesOnly() {
    return media.filter((m) => m.kind === 'image' || m.kind === 'frame');
  }

  function revokeAll() {
    media.forEach((m) => {
      if (m.url && m.url.startsWith('blob:')) URL.revokeObjectURL(m.url);
    });
  }

  // ── Angle helpers ───────────────────────────────────────────
  function camFromAngles(yawDeg, elevDeg, radius, fov, index, sourceIndex) {
    const yaw = (yawDeg * Math.PI) / 180;
    const elev = (elevDeg * Math.PI) / 180;
    return {
      id: `cam_${String(index + 1).padStart(3, '0')}`,
      index,
      yaw_deg: +yawDeg.toFixed(2),
      elevation_deg: +elevDeg.toFixed(2),
      position: {
        x: +(Math.sin(yaw) * radius * Math.cos(elev)).toFixed(5),
        y: +(Math.sin(elev) * radius).toFixed(5),
        z: +(Math.cos(yaw) * radius * Math.cos(elev)).toFixed(5),
      },
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

  const TAG_YAW = {
    front: 0, front_right: 45, right: 90, rear_right: 135,
    rear: 180, rear_left: 225, left: 270, front_left: 315,
    top: 0, detail: null, other: null,
  };

  /** Best frame index for a yaw — tags + explicit yaw beat gallery order. */
  function bestFrameIndex(yawDeg) {
    const frames = framesOnly();
    if (!frames.length) return -1;
    const target = ((yawDeg % 360) + 360) % 360;
    let best = 0;
    let bestDiff = 1e9;
    frames.forEach((f, i) => {
      let fy = null;
      if (typeof f.yaw === 'number') fy = ((f.yaw % 360) + 360) % 360;
      else if (f.tag && TAG_YAW[f.tag] != null) fy = TAG_YAW[f.tag];
      else fy = (i / Math.max(1, frames.length)) * 360;
      let d = Math.abs(fy - target);
      if (d > 180) d = 360 - d;
      // Prefer tagged frames slightly
      if (f.tag && TAG_YAW[f.tag] != null) d -= 5;
      if (d < bestDiff) {
        bestDiff = d;
        best = i;
      }
    });
    return best;
  }

  function sourceIndexForCam(cam) {
    const frames = framesOnly();
    if (!frames.length) return -1;
    if (cam.sourceIndex != null && cam.sourceIndex >= 0 && cam.sourceIndex < frames.length) {
      return cam.sourceIndex;
    }
    return bestFrameIndex(cam.yaw_deg);
  }

  function frameUrl(idx) {
    const frames = framesOnly();
    if (idx < 0 || idx >= frames.length) return null;
    return frames[idx].url;
  }

  // ── Gap analysis (USP) ──────────────────────────────────────
  function gapAnalysis() {
    const frames = framesOnly();
    if (frames.length < 2) {
      return { gaps: [], message: frames.length ? 'Add more angles for gap detection.' : 'No frames yet.' };
    }
    // Place each frame on 0–360
    const angles = frames.map((f, i) =>
      typeof f.yaw === 'number' ? ((f.yaw % 360) + 360) % 360 : (i / frames.length) * 360
    );
    const sorted = angles.map((a, i) => ({ a, i })).sort((x, y) => x.a - y.a);
    const gaps = [];
    for (let i = 0; i < sorted.length; i++) {
      const a = sorted[i].a;
      const b = sorted[(i + 1) % sorted.length].a + (i + 1 === sorted.length ? 360 : 0);
      const span = b - a;
      if (span > 45) {
        gaps.push({ from: a, to: b % 360, span: +span.toFixed(1), mid: (a + span / 2) % 360 });
      }
    }
    gaps.sort((x, y) => y.span - x.span);
    return { gaps, angles: sorted };
  }

  // ── Camera plan ops ─────────────────────────────────────────
  function buildRingCameras() {
    const count = Math.max(1, Number(settings.count?.value || 12));
    const sweep = Number(settings.sweep?.value || 360);
    const radius = Number(settings.radius?.value || 3);
    const elev = Number(settings.elevation?.value || 5);
    const fov = Number(settings.fov?.value || 35);
    const start = -sweep / 2;
    const frames = framesOnly();
    cameras = [];
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0.5 : i / (count - 1);
      const yaw = start + sweep * t;
      const src = frames.length ? bestFrameIndex(yaw) : null;
      cameras.push(camFromAngles(yaw, elev, radius, fov, i, src));
    }
    selectedCameraId = cameras[0]?.id || null;
    afterCamerasChanged();
    if (selectedCameraId) openPopupFor(selectedCameraId);
  }

  function addCamera() {
    const radius = Number(settings.radius?.value || 3);
    const elev = Number(settings.elevation?.value || 5);
    const fov = Number(settings.fov?.value || 35);
    let yaw = 0;
    if (cameras.length) {
      yaw = cameras[cameras.length - 1].yaw_deg + 30;
      if (yaw > 180) yaw -= 360;
    }
    const cam = camFromAngles(yaw, elev, radius, fov, cameras.length, bestFrameIndex(yaw));
    cameras.push(cam);
    selectedCameraId = cam.id;
    afterCamerasChanged();
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
    afterCamerasChanged();
  }

  function duplicateSelected() {
    const cam = cameras.find((c) => c.id === selectedCameraId);
    if (!cam) return;
    const radius = Number(settings.radius?.value || 3);
    const fov = cam.fov_deg || Number(settings.fov?.value || 35);
    const copy = camFromAngles(cam.yaw_deg + 12, cam.elevation_deg, radius, fov, cameras.length, cam.sourceIndex);
    cameras.push(copy);
    selectedCameraId = copy.id;
    afterCamerasChanged();
    openPopupFor(copy.id);
  }

  function autoAssign() {
    cameras.forEach((c) => {
      c.sourceIndex = bestFrameIndex(c.yaw_deg);
    });
    afterCamerasChanged();
    if (popupOpen && selectedCameraId) {
      const cam = cameras.find((c) => c.id === selectedCameraId);
      if (cam) renderPopup(cam);
    }
  }

  function afterCamerasChanged() {
    updateCamCount();
    updateDeleteEnabled();
    drawOrbit();
    updateReadiness();
    updateGapReport();
    updateSpinFromYaw(Number(spinRange?.value || 0));
  }

  function updateCamCount() {
    const el = $('itsCamCount');
    if (el) el.textContent = cameras.length + (cameras.length === 1 ? ' camera' : ' cameras');
  }
  function updateDeleteEnabled() {
    const btn = $('itsDeleteCam');
    if (btn) btn.disabled = !selectedCameraId;
  }

  // ── Draw orbit + gaps ───────────────────────────────────────
  function screenPosForCam(cam, layout) {
    const { cx, cy, radiusPx } = layout;
    const yawRad = (cam.yaw_deg * Math.PI) / 180;
    return {
      x: cx + Math.sin(yawRad) * radiusPx,
      y:
        cy +
        Math.cos(yawRad) * radiusPx * 0.38 -
        Math.sin((cam.elevation_deg * Math.PI) / 180) * radiusPx * 0.25,
    };
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

    const grad = ctx.createRadialGradient(w * 0.5, h * 0.52, 10, w * 0.5, h * 0.5, w * 0.45);
    grad.addColorStop(0, 'rgba(30,50,80,0.35)');
    grad.addColorStop(1, 'rgba(8,11,18,0.1)');
    ctx.fillStyle = grad;
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

    // Gap arcs
    const { gaps } = gapAnalysis();
    gaps.slice(0, 6).forEach((g) => {
      const a0 = ((g.from - 90) * Math.PI) / 180;
      const a1 = ((g.to - 90) * Math.PI) / 180;
      ctx.strokeStyle = 'rgba(255,140,60,0.55)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      // approximate with points on ellipse
      const steps = 12;
      for (let s = 0; s <= steps; s++) {
        const t = a0 + ((a1 - a0) * s) / steps;
        // map angle: 0 = +z front in our yaw system uses sin/cos differently
        const yaw = g.from + (g.span * s) / steps;
        const yr = (yaw * Math.PI) / 180;
        const x = cx + Math.sin(yr) * radiusPx;
        const y = cy + Math.cos(yr) * radiusPx * 0.38;
        if (s === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    });

    if (cameras.length >= 2) {
      const yaws = cameras.map((c) => c.yaw_deg).sort((a, b) => a - b);
      ctx.strokeStyle = 'rgba(100,180,255,0.45)';
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
      ctx.strokeStyle = selected ? 'rgba(200,255,0,0.55)' : 'rgba(255,255,255,0.1)';
      ctx.lineWidth = selected ? 1.5 : 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(cx, cy);
      ctx.stroke();
      ctx.fillStyle = selected ? '#c8ff00' : 'rgba(120,200,255,0.95)';
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
    const n = framesOnly().length;
    ctx.fillText(
      cameras.length
        ? `${cameras.length} cams · ${n} frames · real match · no warp`
        : n
          ? `${n} frames ready — add cameras or Generate ring`
          : 'Drop photos or a turntable video',
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

  // ── Popup (clean image only) ────────────────────────────────
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
    const pw = popup.offsetWidth || 380;
    const ph = popup.offsetHeight || 360;
    if (left + pw > window.innerWidth - pad) left = sx - pw - 12;
    if (left < pad) left = pad;
    if (top + ph > window.innerHeight - pad) top = window.innerHeight - ph - pad;
    if (top < pad) top = pad;
    popup.style.left = `${Math.round(left)}px`;
    popup.style.top = `${Math.round(top)}px`;
    popup.style.bottom = 'auto';
    popup.style.right = 'auto';
  }

  function renderPopup(cam) {
    const img = $('itsCamPopupImg');
    const note = $('itsCamPopupNote');
    const angles = $('itsCamPopupAngles');
    const assign = $('itsCamSourceAssign');
    const frames = framesOnly();
    const srcIdx = sourceIndexForCam(cam);
    if (img) {
      if (srcIdx >= 0) {
        img.src = frames[srcIdx].url;
        img.hidden = false;
      } else {
        img.removeAttribute('src');
        img.hidden = true;
      }
    }
    if (angles) {
      angles.textContent = `Yaw ${cam.yaw_deg.toFixed(1)}° · Elev ${cam.elevation_deg.toFixed(1)}° · FOV ${cam.fov_deg}°`;
    }
    if (note) {
      note.textContent =
        srcIdx >= 0
          ? `Real frame ${srcIdx + 1}/${frames.length} · ${frames[srcIdx].name} · not distorted`
          : 'No frames yet — drop photos or extract from video';
    }
    if (assign) {
      assign.innerHTML = frames
        .map(
          (f, i) =>
            `<option value="${i}" ${i === srcIdx ? 'selected' : ''}>${i + 1}. ${f.name}${
              typeof f.yaw === 'number' ? ' · ' + f.yaw.toFixed(0) + '°' : ''
            }</option>`
        )
        .join('') || '<option value="-1">No frames</option>';
    }
  }

  function openPopupFor(id) {
    const cam = cameras.find((c) => c.id === id);
    if (!cam || !popup) return;
    selectedCameraId = id;
    updateDeleteEnabled();
    drawOrbit();
    const title = $('itsCamPopupTitle');
    if (title) title.textContent = cam.id.replace('_', ' ').toUpperCase();
    renderPopup(cam);
    popup.hidden = false;
    popupOpen = true;
    requestAnimationFrame(() => positionPopupNear(cam));
  }

  // ── Live spin ───────────────────────────────────────────────
  function updateSpinFromYaw(yaw) {
    if (spinRange) spinRange.value = String(Math.round(((yaw % 360) + 360) % 360));
    if ($('itsSpinOut')) $('itsSpinOut').textContent = `${Math.round(((yaw % 360) + 360) % 360)}°`;
    const idx = bestFrameIndex(yaw);
    const url = frameUrl(idx);
    if (spinImg && url) {
      spinImg.src = url;
      spinImg.hidden = false;
      if (spinEmpty) spinEmpty.hidden = true;
    } else if (spinImg) {
      spinImg.hidden = true;
      if (spinEmpty) spinEmpty.hidden = false;
    }
  }

  spinRange?.addEventListener('input', () => {
    updateSpinFromYaw(Number(spinRange.value));
  });

  // ── Coverage score + gaps ───────────────────────────────────
  function coverageScore() {
    const frames = framesOnly();
    const n = frames.length;
    let score = 0;
    if (n >= 1) score += 8;
    if (n >= 4) score += 12;
    if (n >= 8) score += 12;
    if (n >= 16) score += 8;
    if (n >= 24) score += 5;
    score += Math.min(20, cameras.length * 2);
    const { gaps } = gapAnalysis();
    if (n >= 3 && gaps.length === 0) score += 12;
    else if (gaps.length && gaps[0].span < 90) score += 6;
    const tagged = frames.filter((f) => f.tag).length;
    if (tagged >= 3) score += 8;
    else if (tagged >= 1) score += 3;
    if (Number($('itsScaleCm')?.value) > 0) score += 5;
    let markerCount = 0;
    if (typeof markersByFrame !== 'undefined') {
      markersByFrame.forEach((a) => (markerCount += (a || []).length));
    }
    if (markerCount > 0) score += Math.min(5, markerCount);
    if (cameras.length >= 2) {
      const yaws = cameras.map((c) => c.yaw_deg);
      if (Math.max(...yaws) - Math.min(...yaws) >= 120) score += 5;
    }
    return Math.min(100, score);
  }

  function updateGapReport() {
    const el = $('itsGapReport');
    if (!el) return;
    const { gaps } = gapAnalysis();
    if (!framesOnly().length) {
      el.hidden = true;
      return;
    }
    if (!gaps.length) {
      el.hidden = false;
      el.innerHTML = '<strong>Coverage:</strong> no large gaps detected around the subject.';
      return;
    }
    el.hidden = false;
    const top = gaps
      .slice(0, 3)
      .map((g) => `${g.span}° gap near ${g.mid.toFixed(0)}°`)
      .join(' · ');
    el.innerHTML = `<strong>Coverage gaps:</strong> ${top}. Add a photo or extract more video frames in those directions.`;
  }

  function updateReadiness() {
    const score = coverageScore();
    const scoreEl = $('itsScoreVal');
    if (scoreEl) {
      scoreEl.textContent = String(score);
      scoreEl.style.color = score >= 70 ? '#c8ff00' : score >= 40 ? '#f5c542' : '#ff8b8b';
    }
    const n = framesOnly().length;
    const list = $('itsReadyList');
    if (list) {
      const items = [
        [n >= 1, `Source frames loaded (${n})`],
        [n >= 6, 'Multi-angle set (≥ 6 frames)'],
        [cameras.length >= 4, `Cameras placed (${cameras.length})`],
        [n >= 2 && gapAnalysis().gaps.filter((g) => g.span > 60).length === 0, 'No major coverage gaps'],
        [false, 'GPU splat worker connected (not yet)'],
      ];
      list.innerHTML = items
        .map(([ok, label]) => `<li class="${ok ? 'ok' : 'no'}">${ok ? '✓' : '○'} ${label}</li>`)
        .join('');
    }
    const has = n > 0;
    const hasCams = cameras.length > 0;
    ['itsGenPreviews', 'itsSaveLocal', 'itsExportPlan', 'itsExportJson', 'itsClearFiles'].forEach((id) => {
      const el = $(id);
      if (!el) return;
      if (id === 'itsClearFiles') el.disabled = media.length === 0;
      else el.disabled = !(has && hasCams);
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

  // ── Media grid ──────────────────────────────────────────────
  function renderFiles() {
    grid.replaceChildren();
    const nFrames = framesOnly().length;
    countLabel.textContent =
      media.length === 0
        ? '0 items'
        : `${media.length} item${media.length === 1 ? '' : 's'} · ${nFrames} frame${nFrames === 1 ? '' : 's'}`;
    if (!media.length) {
      const empty = document.createElement('div');
      empty.className = 'its-empty';
      empty.innerHTML =
        '<span>▧</span><strong>Photos or turntable video</strong><p>Auction-style galleries and 360 spins work best. Frames stay clean — no warp.</p>';
      grid.append(empty);
    } else {
      media.forEach((m, idx) => {
        const tile = document.createElement('div');
        tile.className = 'its-thumb' + (m.kind === 'video' ? ' is-video' : m.kind === 'frame' ? ' is-frame' : '');
        if (m.kind === 'video') {
          tile.innerHTML = `
            <div style="aspect-ratio:4/3;display:flex;align-items:center;justify-content:center;background:#111;color:#c8ff00;font-size:12px;font-weight:700">VIDEO</div>
            <div class="its-thumb-meta">
              <span title="${m.name}">${m.name}</span>
              <button type="button" data-remove="${idx}" aria-label="Remove">✕</button>
            </div>`;
        } else {
          const tagBadge = m.tag ? `<span class="its-tag-badge">${m.tag}</span>` : '';
          const yawBit = typeof m.yaw === 'number' ? ' · ' + m.yaw.toFixed(0) + '°' : '';
          const tagBit = m.tag ? ' · ' + m.tag : '';
          tile.innerHTML = `
            <img src="${m.url}" alt="">
            ${tagBadge}
            <div class="its-thumb-meta">
              <span title="${m.name}">${m.name}${yawBit}${tagBit}</span>
              <button type="button" data-remove="${idx}" aria-label="Remove">✕</button>
            </div>`;
          if (idx === selectedFrameIndex) tile.classList.add('is-selected');
          tile.addEventListener('click', (ev) => {
            if (ev.target.closest('[data-remove]')) return;
            selectedFrameIndex = idx;
            renderFiles();
          });
        }
        grid.append(tile);
      });
      grid.querySelectorAll('[data-remove]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const i = Number(btn.getAttribute('data-remove'));
          const m = media[i];
          if (m?.url?.startsWith('blob:')) URL.revokeObjectURL(m.url);
          media.splice(i, 1);
          if (m?.kind === 'video') {
            videoFile = null;
            $('itsVideoPanel').hidden = true;
            const v = $('itsVideo');
            if (v) v.removeAttribute('src');
          }
          renderFiles();
          autoAssign();
        });
      });
    }
    updateSpinFromYaw(Number(spinRange?.value || 0));
    afterCamerasChanged();
  }

  function addFiles(list) {
    const incoming = Array.from(list || []);
    for (const f of incoming) {
      if (f.type.startsWith('image/')) {
        const url = URL.createObjectURL(f);
        media.push({ kind: 'image', file: f, name: f.name, url });
      } else if (f.type.startsWith('video/')) {
        if (videoFile) {
          // replace previous video entry
          media = media.filter((m) => m.kind !== 'video');
        }
        videoFile = f;
        const url = URL.createObjectURL(f);
        media.push({ kind: 'video', file: f, name: f.name, url });
        const panel = $('itsVideoPanel');
        const v = $('itsVideo');
        if (panel) panel.hidden = false;
        if (v) {
          v.src = url;
          v.load();
        }
      }
    }
    renderFiles();
  }

  // ── Video frame extract (turntable USP) ─────────────────────
  async function extractFramesFromVideo() {
    const v = $('itsVideo');
    if (!v || !videoFile) {
      alert('Load a turntable / orbit video first.');
      return;
    }
    const btn = $('itsExtractFrames');
    const n = Math.max(4, Math.min(72, Number($('itsFrameCount')?.value || 24)));
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Extracting…';
    }
    try {
      await new Promise((resolve, reject) => {
        if (v.readyState >= 1) resolve();
        else {
          v.onloadedmetadata = () => resolve();
          v.onerror = () => reject(new Error('Video failed to load'));
        }
      });
      const duration = v.duration;
      if (!isFinite(duration) || duration <= 0) throw new Error('Could not read video duration');
      // Remove previous frames from this extract
      media = media.filter((m) => m.kind !== 'frame');
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      for (let i = 0; i < n; i++) {
        const t = (i / n) * duration;
        const yaw = (i / n) * 360;
        v.currentTime = Math.min(t, duration - 0.05);
        await new Promise((r) => {
          const onSeek = () => {
            v.removeEventListener('seeked', onSeek);
            r();
          };
          v.addEventListener('seeked', onSeek);
        });
        canvas.width = v.videoWidth || 640;
        canvas.height = v.videoHeight || 360;
        ctx.drawImage(v, 0, 0);
        const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.92));
        if (!blob) continue;
        const url = URL.createObjectURL(blob);
        media.push({
          kind: 'frame',
          blob,
          name: `frame_${String(i + 1).padStart(3, '0')}.jpg`,
          url,
          yaw,
        });
        if (btn) btn.textContent = `Extracting ${i + 1}/${n}…`;
      }
      renderFiles();
      if (!cameras.length) buildRingCameras();
      else autoAssign();
    } catch (err) {
      console.error(err);
      alert('Frame extract failed: ' + (err.message || err));
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Extract frames from video';
      }
    }
  }

  $('itsExtractFrames')?.addEventListener('click', () => extractFramesFromVideo());
  $('itsFrameCount')?.addEventListener('input', () => {
    if ($('itsFrameCountOut')) $('itsFrameCountOut').textContent = $('itsFrameCount').value;
  });

  // ── Export ──────────────────────────────────────────────────
  function cameraPlan() {
    const radius = Number(settings.radius?.value || 3);
    const fov = Number(settings.fov?.value || 35);
    const frames = framesOnly();
    const cams = cameras.map((c, i) => {
      const base = camFromAngles(c.yaw_deg, c.elevation_deg, radius, c.fov_deg || fov, i, c.sourceIndex);
      base.matched_frame = sourceIndexForCam(c);
      return base;
    });
    return {
      schema: 'fumoca.angle_studio.project.v5',
      project_name: $('itsProjectName')?.value || '',
      notes: $('itsProjectNotes')?.value || '',
      scale_cm: Number($('itsScaleCm')?.value) || null,
      scale_note: $('itsScaleNote')?.value || '',
      created_at: new Date().toISOString(),
      status: 'multi_photo_matched',
      coverage_score: coverageScore(),
      gaps: gapAnalysis().gaps,
      source: {
        frame_count: frames.length,
        has_video: !!videoFile,
        frames: frames.map((f, i) => ({
          index: i,
          name: f.name,
          kind: f.kind,
          tag: f.tag || null,
          yaw_deg: typeof f.yaw === 'number' ? f.yaw : null,
        })),
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
      subject_type: (typeof getSubject === 'function' ? getSubject() : 'auto'),
      industry_mode: (typeof getIndustry === 'function' ? getIndustry() : 'ecommerce'),
      inspection_markers: (() => {
        const out = [];
        markersByFrame.forEach((arr, frameIndex) => {
          (arr || []).forEach((m) => out.push({ frameIndex, ...m }));
        });
        return out;
      })(),
      provenance: {
        client: 'fumoca-angle-studio-v4',
        viewpoint_previews: 'real_matched_frames',
        no_distortion: true,
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
    if (!framesOnly().length || !cameras.length) return;
    downloadBlob(new Blob([JSON.stringify(cameraPlan(), null, 2)], { type: 'application/json' }), 'fumoca-angle-studio-plan.json');
  });

  exportButton.addEventListener('click', async () => {
    if (!framesOnly().length || !cameras.length) return;
    exportButton.disabled = true;
    exportButton.textContent = 'Packaging…';
    try {
      const { default: JSZip } = await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm');
      const zip = new JSZip();
      zip.file('fumoca-project.json', JSON.stringify(cameraPlan(), null, 2));
      const folder = zip.folder('source-frames');
      const frames = framesOnly();
      for (let i = 0; i < frames.length; i++) {
        const f = frames[i];
        const safe = String(i + 1).padStart(3, '0') + '_' + f.name.replace(/[^\w.\-]+/g, '_');
        if (f.file) folder.file(safe, f.file);
        else if (f.blob) folder.file(safe, f.blob);
      }
      if (videoFile) zip.folder('source-video')?.file(videoFile.name.replace(/[^\w.\-]+/g, '_'), videoFile);
      zip.file(
        'README.txt',
        'FUMOCA Angle Studio v4\nReal matched frames — no distortion.\nCoverage score: ' +
          coverageScore() +
          '\nFrames: ' +
          frames.length +
          '\nCameras: ' +
          cameras.length +
          '\n'
      );
      downloadBlob(await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 3 } }), 'fumoca-angle-studio-project.zip');
    } catch (e) {
      console.error(e);
      alert('Package failed: ' + (e.message || e));
    } finally {
      exportButton.disabled = false;
      exportButton.textContent = 'Export project bundle (.zip)';
      updateReadiness();
    }
  });

  $('itsGenPreviews')?.addEventListener('click', () => {
    const strip = $('itsPreviewStrip');
    if (!strip || !cameras.length) return;
    strip.hidden = false;
    strip.innerHTML = '';
    const sample = cameras.filter((_, i) => i % Math.max(1, Math.floor(cameras.length / 10)) === 0).slice(0, 10);
    sample.forEach((cam) => {
      const idx = sourceIndexForCam(cam);
      const url = frameUrl(idx);
      if (!url) return;
      const fig = document.createElement('figure');
      fig.className = 'is-match';
      fig.innerHTML = `<img src="${url}" alt=""><figcaption>${cam.yaw_deg.toFixed(0)}° · frame ${idx + 1}</figcaption>`;
      strip.append(fig);
    });
  });

  $('itsSaveLocal')?.addEventListener('click', () => {
    try {
      const plan = cameraPlan();
      localStorage.setItem('fumoca_angle_studio_v4', JSON.stringify(plan));
      alert('Saved.\nScore: ' + plan.coverage_score + '\nFrames: ' + plan.source.frame_count + '\nCams: ' + cameras.length);
    } catch (e) {
      alert('Save failed: ' + e.message);
    }
  });

  $('itsOpenChecklist')?.addEventListener('click', () => {
    alert(
      [
        'Angle Studio checklist',
        '',
        '1. Drop listing photos OR a turntable video',
        '2. If video → Extract frames',
        '3. Generate ring or place cameras',
        '4. Auto-match photos',
        '5. Live spin to verify real angles',
        '6. Check gap report — add shots if needed',
        '7. Export ZIP for client / splat worker',
        '',
        'Score: ' + coverageScore(),
      ].join('\n')
    );
  });

  // ── Pointer on orbit ────────────────────────────────────────
  function onPointerDown(e) {
    if (!canvas) return;
    const hit = hitTestCamera(e.clientX, e.clientY);
    if (hit) {
      selectedCameraId = hit.id;
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
      renderPopup(cam);
      positionPopupNear(cam);
    }
    updateSpinFromYaw(cam.yaw_deg);
    e.preventDefault();
  }
  function onPointerUp(e) {
    if (!dragState || e.pointerId !== dragState.pointerId) return;
    const cam = cameras.find((c) => c.id === dragState.id);
    if (cam) cam.sourceIndex = bestFrameIndex(cam.yaw_deg);
    dragState = null;
    orbitHost?.classList.remove('is-dragging');
    afterCamerasChanged();
    if (cam && popupOpen) renderPopup(cam);
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
  $('itsAutoAssign')?.addEventListener('click', () => autoAssign());
  $('itsCamPopupClose')?.addEventListener('click', () => closePopup());
  $('itsCamPopupDup')?.addEventListener('click', () => duplicateSelected());
  $('itsCamPopupUse')?.addEventListener('click', () => closePopup());
  $('itsCamSourceAssign')?.addEventListener('change', () => {
    const cam = cameras.find((c) => c.id === selectedCameraId);
    if (!cam) return;
    cam.sourceIndex = Number($('itsCamSourceAssign').value);
    renderPopup(cam);
  });

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
    revokeAll();
    media = [];
    videoFile = null;
    cameras = [];
    selectedCameraId = null;
    closePopup();
    const panel = $('itsVideoPanel');
    if (panel) panel.hidden = true;
    const strip = $('itsPreviewStrip');
    if (strip) {
      strip.hidden = true;
      strip.innerHTML = '';
    }
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
    afterCamerasChanged();
    updateOutputs();
  });

  window.addEventListener('resize', () => {
    drawOrbit();
    if (popupOpen && selectedCameraId) {
      const cam = cameras.find((c) => c.id === selectedCameraId);
      if (cam) positionPopupNear(cam);
    }
  });
  window.addEventListener('beforeunload', () => revokeAll());





  function buildEmbedPackage() {
    const frames = framesOnly();
    const cams = cameras.map((c) => ({
      id: c.id,
      yaw_deg: c.yaw_deg,
      frame: sourceIndexForCam(c),
    }));
    return {
      type: 'fumoca.embed.spin.v1',
      project: $('itsProjectName')?.value || 'untitled',
      subject_type: typeof getSubject === 'function' ? getSubject() : 'auto',
      industry_mode: typeof getIndustry === 'function' ? getIndustry() : 'ecommerce',
      frames: frames.map((f, i) => ({
        index: i,
        name: f.name,
        tag: f.tag || null,
        yaw_deg: typeof f.yaw === 'number' ? f.yaw : null,
      })),
      cameras: cams,
      note: 'Frame binary assets live in the exported ZIP under source-frames/. Hosts map index → URL after upload.',
    };
  }

  function refreshEmbedCode() {
    const el = $('itsEmbedCode');
    if (!el) return;
    if (!framesOnly().length) {
      el.value = '';
      return;
    }
    el.value = JSON.stringify(buildEmbedPackage(), null, 2);
  }

  $('itsCopyEmbed')?.addEventListener('click', async () => {
    refreshEmbedCode();
    const el = $('itsEmbedCode');
    if (!el?.value) return;
    try {
      await navigator.clipboard.writeText(el.value);
      alert('Embed package JSON copied');
    } catch {
      el.select();
      alert('Copy manually (clipboard blocked)');
    }
  });

  // ── Frame reorder & tags ────────────────────────────────────
  function framesMediaIndices() {
    const idxs = [];
    media.forEach((m, i) => {
      if (m.kind === 'image' || m.kind === 'frame') idxs.push(i);
    });
    return idxs;
  }

  function moveSelectedFrame(dir) {
    if (selectedFrameIndex < 0 || selectedFrameIndex >= media.length) return;
    const m = media[selectedFrameIndex];
    if (m.kind !== 'image' && m.kind !== 'frame') return;
    const order = framesMediaIndices();
    const pos = order.indexOf(selectedFrameIndex);
    const newPos = pos + dir;
    if (newPos < 0 || newPos >= order.length) return;
    const otherMediaIdx = order[newPos];
    const tmp = media[selectedFrameIndex];
    media[selectedFrameIndex] = media[otherMediaIdx];
    media[otherMediaIdx] = tmp;
    selectedFrameIndex = otherMediaIdx;
    renderFiles();
    autoAssign();
  }

  $('itsReorderUp')?.addEventListener('click', () => moveSelectedFrame(-1));
  $('itsReorderDown')?.addEventListener('click', () => moveSelectedFrame(1));
  $('itsTagSelected')?.addEventListener('change', () => {
    const tag = $('itsTagSelected').value;
    if (!tag || selectedFrameIndex < 0) return;
    const m = media[selectedFrameIndex];
    if (!m || (m.kind !== 'image' && m.kind !== 'frame')) return;
    m.tag = tag;
    if (TAG_YAW[tag] != null) m.yaw = TAG_YAW[tag];
    $('itsTagSelected').value = '';
    renderFiles();
    autoAssign();
  });

  // ── Subject type + capture guides (any object) ─────────────
  function getSubject() {
    return document.querySelector('input[name="itsSubject"]:checked')?.value || 'auto';
  }
  function getIndustry() {
    return document.querySelector('input[name="itsIndustry"]:checked')?.value || 'ecommerce';
  }

  const CAPTURE_GUIDES = {
    auto: {
      title: 'General object',
      tips: [
        'Walk a steady arc around the subject (same distance).',
        'Keep the whole subject in frame; avoid extreme close-ups only.',
        'Overlap shots ~30–50% so angles can match.',
        'Or record a slow 360° / turntable video and extract frames.',
        'Even lighting helps matching; avoid hard moving shadows.',
      ],
      ring: { count: 12, elev: 5, sweep: 360 },
      minFrames: 8,
    },
    person: {
      title: 'Person / semi-bust',
      tips: [
        'Front face + left ¾ + right ¾ are the minimum set.',
        'Optional: slight above and below for nose / brow relief.',
        'Keep camera height near eye level; distance steady.',
        'Hair and ears need side coverage — gap finder will flag misses.',
        'Phone pan: 10–20s slow horizontal arc, then Extract frames (24–36).',
        'For print: mark nose tip, cheeks, jaw as print zones on a clear front frame.',
      ],
      ring: { count: 16, elev: 8, sweep: 180 },
      minFrames: 6,
    },
    vehicle: {
      title: 'Vehicle',
      tips: [
        'Auction-style set: front, both ¾, both sides, both rear ¾, rear.',
        'Damage assessment: extra close frames of crush, scrape, panel gaps.',
        'Same time of day / lighting if possible between shots.',
        'Turntable or slow yard walk video works if motion is smooth.',
        'Pin damage markers on the worst frames for insurer / workshop handoff.',
      ],
      ring: { count: 12, elev: 5, sweep: 360 },
      minFrames: 8,
    },
    product: {
      title: 'Product / SKU',
      tips: [
        'Plain background; fill the frame with the product.',
        'Front, back, left, right, top if the listing needs it.',
        'Keep scale consistent — same distance and zoom.',
        'Turntable video is ideal for marketplace spin.',
        'Avoid heavy reflections that change every angle.',
      ],
      ring: { count: 12, elev: 10, sweep: 360 },
      minFrames: 6,
    },
    object: {
      title: 'Object / furniture / art',
      tips: [
        'Full object in frame; include a scale reference if size matters later.',
        'Orbit at mid-height; add high and low passes for complex form.',
        'Texture and silhouette matter more than perfect studio light.',
        'For parts: shoot mating faces and damage close-ups as extra frames.',
      ],
      ring: { count: 14, elev: 12, sweep: 360 },
      minFrames: 8,
    },
    scene: {
      title: 'Scene / room',
      tips: [
        'Overlap panoramas; turn slowly at corners.',
        'Keep horizon level; shoot standing height consistently.',
        'Doors and windows: capture both sides of transitions.',
        'Video walk-through + frame extract is often easier than stills.',
      ],
      ring: { count: 20, elev: 0, sweep: 360 },
      minFrames: 12,
    },
  };

  function applyCaptureGuide() {
    const sub = getSubject();
    const g = CAPTURE_GUIDES[sub] || CAPTURE_GUIDES.auto;
    const list = $('itsCaptureGuideList');
    const note = $('itsCaptureGuideNote');
    if (list) list.innerHTML = g.tips.map((t) => `<li>${t}</li>`).join('');
    if (note) {
      note.textContent = `${g.title}: aim for ≥ ${g.minFrames} frames. Generate ring uses subject defaults when you press it.`;
    }
  }

  function applySubjectRingDefaults() {
    const g = CAPTURE_GUIDES[getSubject()] || CAPTURE_GUIDES.auto;
    if (settings.count) settings.count.value = String(g.ring.count);
    if (settings.elevation) settings.elevation.value = String(g.ring.elev);
    if (settings.sweep) settings.sweep.value = String(g.ring.sweep);
    updateOutputs();
  }

  document.querySelectorAll('input[name="itsSubject"]').forEach((el) => {
    el.addEventListener('change', () => {
      document.querySelectorAll('.its-subject').forEach((lab) => lab.classList.remove('selected'));
      el.closest('.its-subject')?.classList.add('selected');
      applyCaptureGuide();
      applySubjectRingDefaults();
    });
  });

  // Patch Generate ring to use subject defaults first
  const _buildRing = buildRingCameras;
  buildRingCameras = function () {
    applySubjectRingDefaults();
    _buildRing();
  };


  // ── Inspection markers ──────────────────────────────────────
  const markersByFrame = new Map();
  let inspectFrameIndex = 0;
  let markerSeq = 1;

  function industryCopy(mode) {
    const map = {
      ecommerce: 'E-commerce: interactive views from real listing media. Reconstruction is optional and separate.',
      insurance: 'Insurance: markers and frames are observational aids only. Not a substitute for physical inspection or certified assessment.',
      mechanic: 'Mechanic: tag parts and damage for workshop handoff. Verify on the vehicle before ordering parts.',
      print: 'Relief/Print: multi-view improves form. Single-image relief is approximate; export supports later mesh/print prep.',
      heritage: 'Heritage: archive real viewpoints with provenance. Do not treat planned cameras as measured survey data.',
    };
    return map[mode] || map.ecommerce;
  }
  document.querySelectorAll('input[name="itsIndustry"]').forEach((el) => {
    el.addEventListener('change', () => {
      document.querySelectorAll('.its-industry').forEach((lab) => lab.classList.remove('selected'));
      el.closest('.its-industry')?.classList.add('selected');
      const d = $('itsIndustryDisclaimer');
      if (d) d.textContent = industryCopy(el.value);
    });
  });

  function refreshInspectFrameSelect() {
    const sel = $('itsInspectFrame');
    if (!sel) return;
    const frames = framesOnly();
    sel.innerHTML = frames.map((f, i) => `<option value="${i}">${i + 1}. ${f.name}</option>`).join('') || '<option value="0">No frames</option>';
    if (inspectFrameIndex >= frames.length) inspectFrameIndex = 0;
    sel.value = String(inspectFrameIndex);
  }

  function drawInspect() {
    const c = $('itsInspectCanvas');
    if (!c) return;
    const ctx = c.getContext('2d');
    const frames = framesOnly();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = c.clientWidth || 800;
    const h = Math.round(w * 0.62);
    c.width = Math.floor(w * dpr);
    c.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0a0e16';
    ctx.fillRect(0, 0, w, h);
    if (!frames.length) {
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = '13px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('Load frames to annotate', w / 2, h / 2);
      return;
    }
    const frame = frames[Math.min(inspectFrameIndex, frames.length - 1)];
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(w / img.width, h / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      const dx = (w - dw) / 2;
      const dy = (h - dh) / 2;
      ctx.drawImage(img, dx, dy, dw, dh);
      const marks = markersByFrame.get(inspectFrameIndex) || [];
      marks.forEach((m, i) => {
        const px = dx + m.x * dw;
        const py = dy + m.y * dh;
        ctx.fillStyle = m.type === 'damage' ? '#ff5a5a' : m.type === 'print' ? '#c8ff00' : '#56b4ff';
        ctx.beginPath();
        ctx.arc(px, py, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = '10px system-ui';
        ctx.textAlign = 'left';
        ctx.fillText(String(i + 1), px + 10, py + 3);
      });
      c._inspectLayout = { dx, dy, dw, dh };
    };
    img.src = frame.url;
    const list = $('itsMarkerList');
    if (list) {
      const marks = markersByFrame.get(inspectFrameIndex) || [];
      list.innerHTML =
        marks
          .map(
            (m, i) =>
              `<li><strong>#${i + 1} ${m.type}</strong><br>${m.note || '(no note)'} · (${(m.x * 100).toFixed(1)}%, ${(m.y * 100).toFixed(1)}%)</li>`
          )
          .join('') || '<li>No markers on this frame</li>';
    }
  }

  $('itsInspectFrame')?.addEventListener('change', (e) => {
    inspectFrameIndex = Number(e.target.value) || 0;
    drawInspect();
  });
  $('itsInspectCanvas')?.addEventListener('click', (e) => {
    const c = $('itsInspectCanvas');
    const layout = c?._inspectLayout;
    if (!layout || !framesOnly().length) return;
    const rect = c.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (x < layout.dx || y < layout.dy || x > layout.dx + layout.dw || y > layout.dy + layout.dh) return;
    const arr = markersByFrame.get(inspectFrameIndex) || [];
    arr.push({
      id: markerSeq++,
      x: (x - layout.dx) / layout.dw,
      y: (y - layout.dy) / layout.dh,
      type: $('itsMarkerType')?.value || 'damage',
      note: $('itsMarkerNote')?.value || '',
    });
    markersByFrame.set(inspectFrameIndex, arr);
    drawInspect();
  });
  $('itsClearMarkers')?.addEventListener('click', () => {
    markersByFrame.set(inspectFrameIndex, []);
    drawInspect();
  });

  const _rf = renderFiles;
  // Patch: after renderFiles content, we already call afterCamerasChanged; add inspect refresh
  const _after = afterCamerasChanged;
  afterCamerasChanged = function () {
    _after();
    refreshInspectFrameSelect();
    drawInspect();
    refreshEmbedCode();
  };

  function refreshInspectFrameSelect() {
    const sel = $('itsInspectFrame');
    if (!sel) return;
    const frames = framesOnly();
    const prev = sel.value;
    sel.innerHTML = frames.map((f, i) => `<option value="${i}">${i + 1}. ${f.name}</option>`).join('') || '<option value="0">No frames</option>';
    if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
    inspectFrameIndex = Number(sel.value) || 0;
  }

  applyCaptureGuide();
  updateCamCount();
  updateDeleteEnabled();
  renderFiles();
  updateOutputs();
  refreshInspectFrameSelect();
  drawInspect();
})();

