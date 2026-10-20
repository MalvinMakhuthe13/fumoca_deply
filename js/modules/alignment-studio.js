/* FUMOCA Alignment Studio v1 — frames, control points, flight path, export (no splats) */
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
  /** controlPoints: { id, frameIndex, x, y } normalized 0-1 */
  let controlPoints = [];
  /** cameras from path */
  let cameras = [];
  let videoFile = null;
  let cpSeq = 1;

  function enabledFrames() {
    return frames.filter((f) => f.enabled);
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
    if (el) el.textContent = `${n} frame${n === 1 ? '' : 's'} · ${on} enabled`;
    const has = on > 0;
    ['alignExportZip', 'alignExportJson', 'alignSaveLocal', 'alignClear'].forEach((id) => {
      const b = $(id);
      if (b) b.disabled = id === 'alignClear' ? n === 0 : !has;
    });
  }

  function renderList() {
    listEl.innerHTML = '';
    if (!frames.length) {
      listEl.innerHTML = '<li class="meta" style="padding:12px;color:#666">No frames yet</li>';
      updateCounts();
      drawFrame();
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
        renderList();
        drawFrame();
      });
      li.querySelector('input')?.addEventListener('change', (e) => {
        f.enabled = !!e.target.checked;
        updateCounts();
        renderList();
        rebuildPath();
      });
      listEl.append(li);
    });
    updateCounts();
  }

  function drawFrame() {
    const c = $('alignFrameCanvas');
    if (!c) return;
    const ctx = c.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = c.clientWidth || 800;
    const h = Math.round(w * 0.62);
    c.width = Math.floor(w * dpr);
    c.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0a0e16';
    ctx.fillRect(0, 0, w, h);
    if (activeIndex < 0 || !frames[activeIndex]) {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.font = '13px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('Select a frame', w / 2, h / 2);
      c._layout = null;
      renderCpList();
      return;
    }
    const f = frames[activeIndex];
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(w / img.width, h / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      const dx = (w - dw) / 2;
      const dy = (h - dh) / 2;
      ctx.drawImage(img, dx, dy, dw, dh);
      c._layout = { dx, dy, dw, dh };
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
      renderCpList();
    };
    img.src = f.url;
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
      // look at origin
      const pos = { x, y, z };
      cameras.push({
        frame_id: f.id,
        frame_name: f.name,
        index: i,
        yaw_deg: (yaw * 180) / Math.PI,
        elevation_deg: (elev * 180) / Math.PI,
        position: pos,
        look_at: { x: 0, y: 0, z: 0 },
        prior: type,
      });
      f.yaw = (yaw * 180) / Math.PI;
    });
    drawPath();
    const note = $('alignPathNote');
    if (note) {
      note.textContent = list.length
        ? `${list.length} cameras on ${type} path · radius ${radius} · elev ${$('alignElev')?.value || 10}° · prior poses for worker`
        : 'Enable frames and rebuild path.';
    }
  }

  function drawPath() {
    const c = $('alignPathCanvas');
    if (!c) return;
    const ctx = c.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = c.clientWidth || 640;
    const h = Math.round(w * 0.5);
    c.width = Math.floor(w * dpr);
    c.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0a0e16';
    ctx.fillRect(0, 0, w, h);
    // grid
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    for (let i = 0; i < 12; i++) {
      ctx.beginPath();
      ctx.moveTo((i / 11) * w, 0);
      ctx.lineTo((i / 11) * w, h);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, (i / 11) * h);
      ctx.lineTo(w, (i / 11) * h);
      ctx.stroke();
    }
    const cx = w * 0.5;
    const cy = h * 0.55;
    const scale = Math.min(w, h) * 0.12;
    // subject
    ctx.fillStyle = 'rgba(200,255,0,0.85)';
    ctx.beginPath();
    ctx.ellipse(cx, cy, 18, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.font = '9px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('SUBJECT', cx, cy + 3);

    if (cameras.length >= 2) {
      ctx.strokeStyle = 'rgba(100,180,255,0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      cameras.forEach((cam, i) => {
        const x = cx + cam.position.x * scale;
        const y = cy - cam.position.z * scale * 0.5 - cam.position.y * scale * 0.3;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
    cameras.forEach((cam, i) => {
      const x = cx + cam.position.x * scale;
      const y = cy - cam.position.z * scale * 0.5 - cam.position.y * scale * 0.3;
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(cx, cy);
      ctx.stroke();
      ctx.fillStyle = i === 0 ? '#c8ff00' : 'rgba(120,200,255,0.95)';
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '11px system-ui';
    ctx.textAlign = 'left';
    ctx.fillText(
      cameras.length ? `${cameras.length} cameras · flight path prior` : 'No path — enable frames',
      12,
      h - 12
    );
  }

  function projectPayload() {
    return {
      schema: 'fumoca.alignment.v1',
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
        client: 'fumoca-alignment-studio-v1',
        poses: 'path_prior_not_bundle_adjusted',
        splat: false,
        next: 'worker_feature_align_optional_then_splat',
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

  $('alignExportJson')?.addEventListener('click', () => {
    if (!enabledFrames().length) return;
    rebuildPath();
    downloadBlob(
      new Blob([JSON.stringify(projectPayload(), null, 2)], { type: 'application/json' }),
      'fumoca-cameras.json'
    );
  });

  $('alignExportZip')?.addEventListener('click', async () => {
    if (!enabledFrames().length) return;
    const btn = $('alignExportZip');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Packaging…';
    }
    try {
      rebuildPath();
      const { default: JSZip } = await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm');
      const zip = new JSZip();
      zip.file('fumoca-alignment.json', JSON.stringify(projectPayload(), null, 2));
      zip.file('cameras.json', JSON.stringify({ cameras, path: projectPayload().path }, null, 2));
      const folder = zip.folder('frames');
      const list = enabledFrames();
      for (let i = 0; i < list.length; i++) {
        const f = list[i];
        const safe = String(i + 1).padStart(4, '0') + '_' + f.name.replace(/[^\w.\-]+/g, '_');
        if (f.file) folder.file(safe, f.file);
        else if (f.blob) folder.file(safe, f.blob);
      }
      zip.file(
        'README.txt',
        'FUMOCA Alignment Studio v1\nNo splat in this package.\nPoses are path priors; worker may refine with feature alignment.\nThen train splat from frames + cameras.\n'
      );
      downloadBlob(await zip.generateAsync({ type: 'blob' }), 'fumoca-alignment-package.zip');
    } catch (e) {
      alert('Export failed: ' + (e.message || e));
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Export package (.zip)';
      }
      updateCounts();
    }
  });

  $('alignSaveLocal')?.addEventListener('click', () => {
    try {
      localStorage.setItem('fumoca_alignment_v1', JSON.stringify(projectPayload()));
      alert('Draft saved in this browser.');
    } catch (e) {
      alert('Save failed: ' + e.message);
    }
  });

  $('alignRebuildPath')?.addEventListener('click', () => rebuildPath());
  $('alignPathType')?.addEventListener('change', () => rebuildPath());
  $('alignRadius')?.addEventListener('input', () => {
    if ($('alignRadiusOut')) $('alignRadiusOut').textContent = Number($('alignRadius').value).toFixed(1);
  });
  $('alignElev')?.addEventListener('input', () => {
    if ($('alignElevOut')) $('alignElevOut').textContent = $('alignElev').value;
  });

  $('alignEnableAll')?.addEventListener('click', () => {
    frames.forEach((f) => (f.enabled = true));
    renderList();
    rebuildPath();
  });

  $('alignDisableWeak')?.addEventListener('click', () => {
    const n = Number($('alignNth')?.value || 3);
    frames.forEach((f, i) => {
      f.enabled = i % n === 0;
    });
    renderList();
    rebuildPath();
  });

  function addFiles(fileList) {
    const incoming = Array.from(fileList || []);
    for (const file of incoming) {
      if (file.type.startsWith('image/')) {
        const url = URL.createObjectURL(file);
        frames.push({
          id: `f_${String(frames.length + 1).padStart(4, '0')}`,
          name: file.name,
          url,
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
    if (frames.length && activeIndex < 0) activeIndex = 0;
    renderList();
    drawFrame();
    rebuildPath();
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
      // keep non-frame images; replace previous extracted
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
        const url = URL.createObjectURL(blob);
        frames.push({
          id: `f_${String(frames.length + 1).padStart(4, '0')}`,
          name: `frame_${String(i + 1).padStart(4, '0')}.jpg`,
          url,
          blob,
          enabled: true,
          yaw: (i / n) * 360,
          kind: 'frame',
        });
        if (btn) btn.textContent = `Extracting ${i + 1}/${n}…`;
      }
      activeIndex = frames.length ? 0 : -1;
      renderList();
      drawFrame();
      rebuildPath();
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
    revokeAll();
    frames = [];
    controlPoints = [];
    cameras = [];
    activeIndex = -1;
    videoFile = null;
    const panel = $('alignVideoPanel');
    if (panel) panel.hidden = true;
    renderList();
    drawFrame();
    drawPath();
  });

  window.addEventListener('resize', () => {
    drawFrame();
    drawPath();
  });
  window.addEventListener('beforeunload', () => revokeAll());

  renderList();
  drawFrame();
  drawPath();
  updateCounts();
})();
