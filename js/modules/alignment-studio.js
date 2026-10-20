/* FUMOCA Alignment Studio v2 — scrub path, multi-export, no splats */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const fileInput = $('alignFiles');
  const drop = $('alignDrop');
  const listEl = $('alignFrameList');
  if (!fileInput || !drop || !listEl) return;

  /** @type {{id:string,name:string,url:string,file?:File,blob?:Blob,enabled:boolean,yaw:number,kind:string}[]} */
  let frames = [];
  let activeIndex = -1;
  /** path cursor into enabledFrames() */
  let pathCursor = 0;
  let controlPoints = [];
  let cameras = [];
  let videoFile = null;
  let cpSeq = 1;
  let playTimer = null;

  function enabledFrames() {
    return frames.filter((f) => f.enabled);
  }

  function enabledIndices() {
    const out = [];
    frames.forEach((f, i) => {
      if (f.enabled) out.push(i);
    });
    return out;
  }

  function revokeAll() {
    frames.forEach((f) => {
      if (f.url?.startsWith('blob:')) URL.revokeObjectURL(f.url);
    });
  }

  function updateCounts() {
    const n = frames.length;
    const on = enabledFrames().length;
    const el = $('alignFileCount');
    if (el) el.textContent = `${n} frames · ${on} enabled`;
    const has = on > 0;
    ['alignExportZip', 'alignExportJson', 'alignExportNerf', 'alignExportColmap', 'alignExportSeq', 'alignSaveLocal', 'alignClear'].forEach((id) => {
      const b = $(id);
      if (b) b.disabled = id === 'alignClear' ? n === 0 : !has;
    });
    const scrub = $('alignScrub');
    if (scrub) {
      scrub.max = String(Math.max(0, on - 1));
      if (pathCursor > on - 1) pathCursor = Math.max(0, on - 1);
      scrub.value = String(pathCursor);
    }
    if ($('alignScrubOut')) {
      $('alignScrubOut').textContent = on ? `${pathCursor + 1} / ${on}` : '0 / 0';
    }
  }

  function setActiveFromPath() {
    const idxs = enabledIndices();
    if (!idxs.length) {
      activeIndex = -1;
      return;
    }
    pathCursor = Math.max(0, Math.min(pathCursor, idxs.length - 1));
    activeIndex = idxs[pathCursor];
  }

  function renderList() {
    listEl.innerHTML = '';
    if (!frames.length) {
      listEl.innerHTML = '<li class="meta" style="padding:12px;color:#666">No frames yet</li>';
      updateCounts();
      drawFrame();
      drawView();
      renderFilmstrip();
      return;
    }
    frames.forEach((f, i) => {
      const li = document.createElement('li');
      li.className = (i === activeIndex ? 'is-active ' : '') + (f.enabled ? '' : 'is-off');
      li.innerHTML = `
        <img src="${f.url}" alt="">
        <div class="meta" title="${f.name}">${String(i + 1).padStart(3, '0')} · ${f.name}${f.enabled ? '' : ' (off)'}</div>
        <label style="font-size:10px;color:#9ab"><input type="checkbox" data-en="${i}" ${f.enabled ? 'checked' : ''}> on</label>`;
      li.addEventListener('click', (e) => {
        if (e.target.closest('input')) return;
        activeIndex = i;
        const idxs = enabledIndices();
        const p = idxs.indexOf(i);
        if (p >= 0) pathCursor = p;
        renderList();
        drawFrame();
        drawView();
        drawPath();
        renderFilmstrip();
        updateCounts();
      });
      li.querySelector('input')?.addEventListener('change', (e) => {
        f.enabled = !!e.target.checked;
        rebuildPath();
        setActiveFromPath();
        renderList();
        drawFrame();
        drawView();
        renderFilmstrip();
      });
      listEl.append(li);
    });
    updateCounts();
  }

  function renderFilmstrip() {
    const strip = $('alignFilmstrip');
    if (!strip) return;
    strip.innerHTML = '';
    const idxs = enabledIndices();
    idxs.forEach((fi, p) => {
      const f = frames[fi];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = p === pathCursor ? 'is-active' : '';
      btn.innerHTML = `<img src="${f.url}" alt=""><span>${p + 1}</span>`;
      btn.addEventListener('click', () => {
        pathCursor = p;
        setActiveFromPath();
        renderList();
        drawFrame();
        drawView();
        drawPath();
        renderFilmstrip();
        updateCounts();
        btn.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
      });
      strip.append(btn);
    });
  }

  function drawImageOnCanvas(canvas, frame, withPoints) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || canvas.width || 800;
    const h = Math.round(w * (canvas === $('alignViewCanvas') ? 0.56 : 0.62));
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0a0e16';
    ctx.fillRect(0, 0, w, h);
    if (!frame) {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.font = '13px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('Select or enable a frame', w / 2, h / 2);
      canvas._layout = null;
      return;
    }
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(w / img.width, h / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      const dx = (w - dw) / 2;
      const dy = (h - dh) / 2;
      ctx.drawImage(img, dx, dy, dw, dh);
      canvas._layout = { dx, dy, dw, dh };
      if (withPoints) {
        controlPoints
          .filter((p) => p.frameIndex === activeIndex)
          .forEach((p) => {
            const px = dx + p.x * dw;
            const py = dy + p.y * dh;
            ctx.fillStyle = '#c8ff00';
            ctx.beginPath();
            ctx.arc(px, py, 6, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.font = '10px system-ui';
            ctx.textAlign = 'left';
            ctx.fillText(p.id, px + 8, py + 3);
          });
      }
      // path badge
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(10, 10, 160, 28);
      ctx.fillStyle = '#c8ff00';
      ctx.font = '12px system-ui';
      ctx.textAlign = 'left';
      ctx.fillText(`Path ${pathCursor + 1}/${enabledFrames().length || 0}`, 18, 28);
    };
    img.src = frame.url;
  }

  function drawFrame() {
    drawImageOnCanvas($('alignFrameCanvas'), frames[activeIndex], true);
    renderCpList();
  }

  function drawView() {
    const f = frames[activeIndex];
    drawImageOnCanvas($('alignViewCanvas'), f, false);
    const meta = $('alignViewMeta');
    if (!meta) return;
    if (!f) {
      meta.textContent = 'No frames — drop images below';
      return;
    }
    const cam = cameras[pathCursor];
    const yaw = cam ? cam.yaw_deg.toFixed(1) : (f.yaw || 0).toFixed?.(1) || '0';
    meta.textContent = `${f.name} · path ${pathCursor + 1}/${enabledFrames().length} · yaw ${yaw}° · ${f.enabled ? 'enabled' : 'disabled'}`;
  }

  function renderCpList() {
    const ul = $('alignCpList');
    if (!ul) return;
    const pts = controlPoints.filter((p) => p.frameIndex === activeIndex);
    ul.innerHTML =
      pts.map((p) => `<li><strong>${p.id}</strong> · (${(p.x * 100).toFixed(1)}%, ${(p.y * 100).toFixed(1)}%)</li>`).join('') ||
      '<li>No control points on this frame — click the image</li>';
  }

  $('alignFrameCanvas')?.addEventListener('click', (e) => {
    const c = $('alignFrameCanvas');
    const layout = c?._layout;
    if (!layout || activeIndex < 0) return;
    const rect = c.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (x < layout.dx || y < layout.dy || x > layout.dx + layout.dw || y > layout.dy + layout.dh) return;
    let id = ($('alignCpId')?.value || '').trim() || `cp_${cpSeq}`;
    controlPoints.push({
      id,
      frameIndex: activeIndex,
      x: (x - layout.dx) / layout.dw,
      y: (y - layout.dy) / layout.dh,
    });
    drawFrame();
  });

  $('alignCpClear')?.addEventListener('click', () => {
    controlPoints = controlPoints.filter((p) => p.frameIndex !== activeIndex);
    drawFrame();
  });
  $('alignCpNextId')?.addEventListener('click', () => {
    cpSeq += 1;
    if ($('alignCpId')) $('alignCpId').value = `cp_${cpSeq}`;
  });

  function rebuildPath() {
    const type = $('alignPathType')?.value || 'orbit';
    const radius = Number($('alignRadius')?.value || 2.5);
    const elev = (Number($('alignElev')?.value || 10) * Math.PI) / 180;
    const list = enabledFrames();
    cameras = [];
    list.forEach((f, i) => {
      const t = list.length <= 1 ? 0 : i / (list.length - 1);
      let yaw = 0;
      if (type === 'orbit') yaw = t * Math.PI * 2;
      else if (type === 'arc') yaw = -Math.PI / 2 + t * Math.PI;
      else yaw = 0;
      const x = Math.sin(yaw) * radius * Math.cos(elev);
      const y = Math.sin(elev) * radius;
      const z = Math.cos(yaw) * radius * Math.cos(elev);
      cameras.push({
        frame_id: f.id,
        frame_name: f.name,
        index: i,
        yaw_deg: (yaw * 180) / Math.PI,
        elevation_deg: (elev * 180) / Math.PI,
        position: { x, y, z },
        look_at: { x: 0, y: 0, z: 0 },
        prior: type,
      });
      f.yaw = (yaw * 180) / Math.PI;
    });
    drawPath();
    drawView();
    const note = $('alignPathNote');
    if (note) {
      note.textContent = list.length
        ? `${list.length} cameras · ${type} · r=${radius} · elev ${$('alignElev')?.value || 10}°`
        : 'Enable frames to build a path.';
    }
    updateCounts();
  }

  function drawPath() {
    const c = $('alignPathCanvas');
    if (!c) return;
    const ctx = c.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = c.clientWidth || 320;
    const h = w;
    c.width = Math.floor(w * dpr);
    c.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0a0e16';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    for (let i = 0; i < 10; i++) {
      ctx.beginPath();
      ctx.moveTo((i / 9) * w, 0);
      ctx.lineTo((i / 9) * w, h);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, (i / 9) * h);
      ctx.lineTo(w, (i / 9) * h);
      ctx.stroke();
    }
    const cx = w * 0.5;
    const cy = h * 0.55;
    const scale = Math.min(w, h) * 0.14;
    ctx.fillStyle = 'rgba(200,255,0,0.9)';
    ctx.beginPath();
    ctx.ellipse(cx, cy, 14, 8, 0, 0, Math.PI * 2);
    ctx.fill();

    if (cameras.length >= 2) {
      ctx.strokeStyle = 'rgba(100,180,255,0.45)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      cameras.forEach((cam, i) => {
        const x = cx + cam.position.x * scale;
        const y = cy - cam.position.z * scale * 0.55 - cam.position.y * scale * 0.25;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
    cameras.forEach((cam, i) => {
      const x = cx + cam.position.x * scale;
      const y = cy - cam.position.z * scale * 0.55 - cam.position.y * scale * 0.25;
      ctx.strokeStyle = 'rgba(255,255,255,0.1)';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(cx, cy);
      ctx.stroke();
      const active = i === pathCursor;
      ctx.fillStyle = active ? '#c8ff00' : 'rgba(120,200,255,0.9)';
      ctx.beginPath();
      ctx.arc(x, y, active ? 6 : 3, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function goPath(delta) {
    const n = enabledFrames().length;
    if (!n) return;
    pathCursor = (pathCursor + delta + n) % n;
    setActiveFromPath();
    renderList();
    drawFrame();
    drawView();
    drawPath();
    renderFilmstrip();
    updateCounts();
  }

  function stopPlay() {
    if (playTimer) clearInterval(playTimer);
    playTimer = null;
    const b = $('alignPlay');
    if (b) b.textContent = 'Play';
  }

  function togglePlay() {
    if (playTimer) {
      stopPlay();
      return;
    }
    if (!enabledFrames().length) return;
    const b = $('alignPlay');
    if (b) b.textContent = 'Pause';
    playTimer = setInterval(() => goPath(1), 120);
  }

  $('alignPrev')?.addEventListener('click', () => {
    stopPlay();
    goPath(-1);
  });
  $('alignNext')?.addEventListener('click', () => {
    stopPlay();
    goPath(1);
  });
  $('alignPlay')?.addEventListener('click', () => togglePlay());
  $('alignScrub')?.addEventListener('input', () => {
    stopPlay();
    pathCursor = Number($('alignScrub').value) || 0;
    setActiveFromPath();
    renderList();
    drawFrame();
    drawView();
    drawPath();
    renderFilmstrip();
    updateCounts();
  });

  window.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, select')) return;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      stopPlay();
      goPath(-1);
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      stopPlay();
      goPath(1);
    }
    if (e.key === ' ') {
      e.preventDefault();
      togglePlay();
    }
  });

  function projectPayload() {
    return {
      schema: 'fumoca.alignment.v2',
      created_at: new Date().toISOString(),
      project_name: $('alignProjectName')?.value || '',
      notes: $('alignNotes')?.value || '',
      scale_cm: Number($('alignScale')?.value) || null,
      status: 'path_prior',
      frames: frames.map((f, i) => ({
        id: f.id,
        index: i,
        name: f.name,
        enabled: f.enabled,
        yaw_deg: typeof f.yaw === 'number' ? f.yaw : null,
      })),
      control_points: controlPoints,
      cameras,
      path: {
        type: $('alignPathType')?.value || 'orbit',
        radius: Number($('alignRadius')?.value || 2.5),
        elevation_deg: Number($('alignElev')?.value || 10),
        keyframes: cameras.map((c) => c.frame_id),
      },
      provenance: {
        client: 'fumoca-alignment-studio-v2',
        poses: 'path_prior_not_bundle_adjusted',
        splat: false,
        next: 'export_to_worker_or_external_trainer',
      },
    };
  }

  function downloadBlob(blob, name) {
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function quatLookAt(pos, target) {
    // Simple camera looking at target, Y-up — approximate for nerfstudio-style export
    const zx = target.x - pos.x;
    const zy = target.y - pos.y;
    const zz = target.z - pos.z;
    const len = Math.hypot(zx, zy, zz) || 1;
    const fx = zx / len,
      fy = zy / len,
      fz = zz / len;
    // up
    let ux = 0,
      uy = 1,
      uz = 0;
    // right = up × forward
    let rx = uy * fz - uz * fy;
    let ry = uz * fx - ux * fz;
    let rz = ux * fy - uy * fx;
    const rl = Math.hypot(rx, ry, rz) || 1;
    rx /= rl;
    ry /= rl;
    rz /= rl;
    // true up = forward × right
    ux = fy * rz - fz * ry;
    uy = fz * rx - fx * rz;
    uz = fx * ry - fy * rx;
    // rotation matrix to quat (columns = right, up, -forward for OpenCV-ish)
    // Use camera-to-world with -Z forward convention-ish
    const m00 = rx,
      m01 = ux,
      m02 = -fx;
    const m10 = ry,
      m11 = uy,
      m12 = -fy;
    const m20 = rz,
      m21 = uz,
      m22 = -fz;
    const tr = m00 + m11 + m22;
    let qw, qx, qy, qz;
    if (tr > 0) {
      const s = Math.sqrt(tr + 1) * 2;
      qw = 0.25 * s;
      qx = (m21 - m12) / s;
      qy = (m02 - m20) / s;
      qz = (m10 - m01) / s;
    } else if (m00 > m11 && m00 > m22) {
      const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
      qw = (m21 - m12) / s;
      qx = 0.25 * s;
      qy = (m01 + m10) / s;
      qz = (m02 + m20) / s;
    } else if (m11 > m22) {
      const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
      qw = (m02 - m20) / s;
      qx = (m01 + m10) / s;
      qy = 0.25 * s;
      qz = (m12 + m21) / s;
    } else {
      const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
      qw = (m10 - m01) / s;
      qx = (m02 + m20) / s;
      qy = (m12 + m21) / s;
      qz = 0.25 * s;
    }
    return [qw, qx, qy, qz];
  }

  function matrix44(pos, target) {
    const [qw, qx, qy, qz] = quatLookAt(pos, target);
    // row-major 3x4 transform [R|t] simplified as 4x4 c2w for nerfstudio-ish
    const x = pos.x,
      y = pos.y,
      z = pos.z;
    // build rotation from quat
    const xx = qx * qx,
      yy = qy * qy,
      zz = qz * qz;
    const xy = qx * qy,
      xz = qx * qz,
      yz = qy * qz;
    const wx = qw * qx,
      wy = qw * qy,
      wz = qw * qz;
    const r00 = 1 - 2 * (yy + zz);
    const r01 = 2 * (xy - wz);
    const r02 = 2 * (xz + wy);
    const r10 = 2 * (xy + wz);
    const r11 = 1 - 2 * (xx + zz);
    const r12 = 2 * (yz - wx);
    const r20 = 2 * (xz - wy);
    const r21 = 2 * (yz + wx);
    const r22 = 1 - 2 * (xx + yy);
    return [
      [r00, r01, r02, x],
      [r10, r11, r12, y],
      [r20, r21, r22, z],
      [0, 0, 0, 1],
    ];
  }

  async function loadJSZip() {
    const { default: JSZip } = await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm');
    return JSZip;
  }

  async function addEnabledImages(folder) {
    const list = enabledFrames();
    const names = [];
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      const safe = String(i).padStart(4, '0') + '_' + f.name.replace(/[^\w.\-]+/g, '_');
      if (f.file) folder.file(safe, f.file);
      else if (f.blob) folder.file(safe, f.blob);
      names.push(safe);
    }
    return names;
  }

  $('alignExportJson')?.addEventListener('click', () => {
    if (!enabledFrames().length) return;
    rebuildPath();
    downloadBlob(new Blob([JSON.stringify(projectPayload(), null, 2)], { type: 'application/json' }), 'fumoca-cameras.json');
  });

  $('alignExportZip')?.addEventListener('click', async () => {
    if (!enabledFrames().length) return;
    const btn = $('alignExportZip');
    try {
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Packaging…';
      }
      rebuildPath();
      const JSZip = await loadJSZip();
      const zip = new JSZip();
      zip.file('fumoca-alignment.json', JSON.stringify(projectPayload(), null, 2));
      zip.file('cameras.json', JSON.stringify({ cameras, path: projectPayload().path }, null, 2));
      const folder = zip.folder('images');
      await addEnabledImages(folder);
      zip.file(
        'README.txt',
        'FUMOCA Alignment Studio v2\nNo splat in this package.\nImport images/ + cameras into your trainer or worker.\n'
      );
      downloadBlob(await zip.generateAsync({ type: 'blob' }), 'fumoca-alignment-package.zip');
    } catch (e) {
      alert('Export failed: ' + (e.message || e));
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'FUMOCA package (.zip)';
      }
      updateCounts();
    }
  });

  $('alignExportNerf')?.addEventListener('click', async () => {
    if (!enabledFrames().length) return;
    const btn = $('alignExportNerf');
    try {
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Packaging…';
      }
      rebuildPath();
      const JSZip = await loadJSZip();
      const zip = new JSZip();
      const folder = zip.folder('images');
      const names = await addEnabledImages(folder);
      const framesOut = cameras.map((cam, i) => ({
        file_path: `images/${names[i]}`,
        transform_matrix: matrix44(cam.position, cam.look_at),
        yaw_deg: cam.yaw_deg,
      }));
      const transforms = {
        camera_model: 'OPENCV',
        fl_x: 1200,
        fl_y: 1200,
        cx: 960,
        cy: 540,
        w: 1920,
        h: 1080,
        frames: framesOut,
        fumoca_note: 'Path-prior poses; refine or re-run SfM for production quality.',
      };
      zip.file('transforms.json', JSON.stringify(transforms, null, 2));
      zip.file('README.txt', 'Nerfstudio-style package from FUMOCA Alignment.\nns-train nerfacto --data .\n(Poses are orbit priors — not COLMAP-refined.)\n');
      downloadBlob(await zip.generateAsync({ type: 'blob' }), 'fumoca-nerfstudio-export.zip');
    } catch (e) {
      alert('Export failed: ' + (e.message || e));
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Nerfstudio transforms.json + images';
      }
      updateCounts();
    }
  });

  $('alignExportColmap')?.addEventListener('click', async () => {
    if (!enabledFrames().length) return;
    const btn = $('alignExportColmap');
    try {
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Packaging…';
      }
      rebuildPath();
      const JSZip = await loadJSZip();
      const zip = new JSZip();
      const imgFolder = zip.folder('images');
      const names = await addEnabledImages(imgFolder);
      // Minimal COLMAP text model (cameras.txt, images.txt, points3D.txt empty)
      let camerasTxt = '# Camera list with one line of data per camera:\n# CAMERA_ID, MODEL, WIDTH, HEIGHT, PARAMS[]\n';
      camerasTxt += '1 PINHOLE 1920 1080 1200 1200 960 540\n';
      let imagesTxt = '# Image list with two lines of data per image:\n# IMAGE_ID, QW, QX, QY, QZ, TX, TY, TZ, CAMERA_ID, NAME\n# POINTS2D[] as (X, Y, POINT3D_ID)\n';
      cameras.forEach((cam, i) => {
        const [qw, qx, qy, qz] = quatLookAt(cam.position, cam.look_at);
        // world-to-camera translation approx -R^T * C
        const tx = -cam.position.x;
        const ty = -cam.position.y;
        const tz = -cam.position.z;
        imagesTxt += `${i + 1} ${qw} ${qx} ${qy} ${qz} ${tx} ${ty} ${tz} 1 ${names[i]}\n\n`;
      });
      const sparse = zip.folder('sparse/0');
      sparse.file('cameras.txt', camerasTxt);
      sparse.file('images.txt', imagesTxt);
      sparse.file('points3D.txt', '# Empty — path prior only\n');
      zip.file(
        'README.txt',
        'COLMAP-style text model from FUMOCA Alignment (path prior).\nOpen in COLMAP or converters. Re-run feature matching for real sparse points.\n'
      );
      downloadBlob(await zip.generateAsync({ type: 'blob' }), 'fumoca-colmap-export.zip');
    } catch (e) {
      alert('Export failed: ' + (e.message || e));
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'COLMAP-style cameras + images';
      }
      updateCounts();
    }
  });

  $('alignExportSeq')?.addEventListener('click', async () => {
    if (!enabledFrames().length) return;
    const btn = $('alignExportSeq');
    try {
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Packaging…';
      }
      const JSZip = await loadJSZip();
      const zip = new JSZip();
      const folder = zip.folder('images');
      await addEnabledImages(folder);
      downloadBlob(await zip.generateAsync({ type: 'blob' }), 'fumoca-image-sequence.zip');
    } catch (e) {
      alert('Export failed: ' + (e.message || e));
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Image sequence only';
      }
      updateCounts();
    }
  });

  $('alignSaveLocal')?.addEventListener('click', () => {
    try {
      localStorage.setItem('fumoca_alignment_v2', JSON.stringify(projectPayload()));
      alert('Draft saved in this browser.');
    } catch (e) {
      alert('Save failed: ' + e.message);
    }
  });

  $('alignRebuildPath')?.addEventListener('click', () => {
    rebuildPath();
    drawView();
    renderFilmstrip();
  });
  $('alignPathType')?.addEventListener('change', () => rebuildPath());
  $('alignRadius')?.addEventListener('input', () => {
    if ($('alignRadiusOut')) $('alignRadiusOut').textContent = Number($('alignRadius').value).toFixed(1);
  });
  $('alignElev')?.addEventListener('input', () => {
    if ($('alignElevOut')) $('alignElevOut').textContent = $('alignElev').value;
  });

  $('alignEnableAll')?.addEventListener('click', () => {
    frames.forEach((f) => (f.enabled = true));
    rebuildPath();
    setActiveFromPath();
    renderList();
    drawFrame();
    drawView();
    renderFilmstrip();
  });

  $('alignDisableWeak')?.addEventListener('click', () => {
    const n = Number($('alignNth')?.value || 3);
    frames.forEach((f, i) => {
      f.enabled = i % n === 0;
    });
    pathCursor = 0;
    rebuildPath();
    setActiveFromPath();
    renderList();
    drawFrame();
    drawView();
    renderFilmstrip();
  });

  function addFiles(fileList) {
    const incoming = Array.from(fileList || []);
    for (const file of incoming) {
      if (file.type.startsWith('image/')) {
        frames.push({
          id: `f_${String(frames.length + 1).padStart(4, '0')}`,
          name: file.name,
          url: URL.createObjectURL(file),
          file,
          enabled: true,
          yaw: 0,
          kind: 'image',
        });
      } else if (file.type.startsWith('video/')) {
        videoFile = file;
        const url = URL.createObjectURL(file);
        const panel = $('alignVideoPanel');
        const v = $('alignVideo');
        if (panel) panel.hidden = false;
        if (v) {
          v.src = url;
          v.load();
        }
      }
    }
    if (frames.length && activeIndex < 0) {
      activeIndex = 0;
      pathCursor = 0;
    }
    rebuildPath();
    setActiveFromPath();
    renderList();
    drawFrame();
    drawView();
    renderFilmstrip();
  }

  async function extractFrames() {
    const v = $('alignVideo');
    if (!v || !videoFile) {
      alert('Load a video first');
      return;
    }
    const n = Math.max(8, Math.min(120, Number($('alignFrameCount')?.value || 36)));
    const btn = $('alignExtract');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Extracting…';
    }
    try {
      await new Promise((resolve, reject) => {
        if (v.readyState >= 1) resolve();
        else {
          v.onloadedmetadata = () => resolve();
          v.onerror = () => reject(new Error('Video failed'));
        }
      });
      const duration = v.duration;
      if (!isFinite(duration) || duration <= 0) throw new Error('Bad duration');
      frames = frames.filter((f) => f.kind !== 'frame');
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      for (let i = 0; i < n; i++) {
        const t = (i / n) * duration;
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
        const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.9));
        if (!blob) continue;
        frames.push({
          id: `f_${String(frames.length + 1).padStart(4, '0')}`,
          name: `frame_${String(i + 1).padStart(4, '0')}.jpg`,
          url: URL.createObjectURL(blob),
          blob,
          enabled: true,
          yaw: (i / n) * 360,
          kind: 'frame',
        });
        if (btn) btn.textContent = `Extracting ${i + 1}/${n}…`;
      }
      pathCursor = 0;
      activeIndex = frames.length ? 0 : -1;
      rebuildPath();
      setActiveFromPath();
      renderList();
      drawFrame();
      drawView();
      renderFilmstrip();
    } catch (e) {
      alert('Extract failed: ' + (e.message || e));
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Extract frames';
      }
    }
  }

  $('alignExtract')?.addEventListener('click', () => extractFrames());
  $('alignFrameCount')?.addEventListener('input', () => {
    if ($('alignFrameOut')) $('alignFrameOut').textContent = $('alignFrameCount').value;
  });

  fileInput.addEventListener('change', () => {
    addFiles(fileInput.files);
    fileInput.value = '';
  });
  ['dragenter', 'dragover'].forEach((ev) => {
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.add('is-drag');
    });
  });
  ['dragleave', 'drop'].forEach((ev) => {
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.remove('is-drag');
    });
  });
  drop.addEventListener('drop', (e) => addFiles(e.dataTransfer?.files));

  $('alignClear')?.addEventListener('click', () => {
    stopPlay();
    revokeAll();
    frames = [];
    controlPoints = [];
    cameras = [];
    activeIndex = -1;
    pathCursor = 0;
    videoFile = null;
    const panel = $('alignVideoPanel');
    if (panel) panel.hidden = true;
    renderList();
    drawFrame();
    drawView();
    drawPath();
    renderFilmstrip();
  });

  window.addEventListener('resize', () => {
    drawFrame();
    drawView();
    drawPath();
  });
  window.addEventListener('beforeunload', () => {
    stopPlay();
    revokeAll();
  });

  renderList();
  drawFrame();
  drawView();
  drawPath();
  updateCounts();
})();
