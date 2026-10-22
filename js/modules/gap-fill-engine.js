/**
 * FUMOCA Gap Fill Engine
 * ─────────────────────
 * In-app densify / heal for splats (CPU only, no retrain, no GPU job).
 *
 * Modes:
 *   neighbours — colour from nearby splat points (heal/clone)
 *   image      — colour from a reference photo (collect from image)
 *   hybrid     — blend neighbours + image
 *
 * Depth / placement always comes from nearby 3D points so fills sit on the surface.
 */
(function (global) {
  'use strict';

  const FillState = {
    image: null,       // HTMLImageElement
    imageCanvas: null, // for getImageData
    imageCtx: null,
    imageUrl: null,
    // Map image onto current view: full-bleed cover of viewport
    // User can offset/scale for alignment
    offsetX: 0,
    offsetY: 0,
    scale: 1,
    opacity: 0.45,     // overlay preview opacity
    colourMode: 'hybrid', // neighbours | image | hybrid
    density: 1,        // 0.5–2 multiplier on points per stroke
    showOverlay: true,
  };

  function getS() {
    return global.S || null;
  }

  function getCamera() {
    return global._fumocaCamera || global.camera || null;
  }

  function setStatus(msg, kind) {
    if (typeof global.setStatus === 'function') global.setStatus(msg, kind);
    else if (typeof global.status === 'function') global.status(msg);
    const el = document.getElementById('statusText');
    if (el) el.textContent = msg;
  }

  function loadImageFromFile(file) {
    return new Promise((resolve, reject) => {
      if (!file) return reject(new Error('No file'));
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        FillState.image = img;
        FillState.imageCanvas = c;
        FillState.imageCtx = ctx;
        FillState.imageUrl = url;
        resolve(FillState);
      };
      img.onerror = () => reject(new Error('Could not load image'));
      img.src = url;
    });
  }

  function loadImageFromUrl(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        FillState.image = img;
        FillState.imageCanvas = c;
        FillState.imageCtx = ctx;
        FillState.imageUrl = url;
        resolve(FillState);
      };
      img.onerror = () => reject(new Error('Could not load image URL'));
      img.src = url;
    });
  }

  /** Map viewport pixel → image pixel (cover + user offset/scale). */
  function viewportToImage(vx, vy, viewW, viewH) {
    if (!FillState.imageCanvas) return null;
    const iw = FillState.imageCanvas.width;
    const ih = FillState.imageCanvas.height;
    const cover = Math.max(viewW / iw, viewH / ih) * (FillState.scale || 1);
    const dw = iw * cover;
    const dh = ih * cover;
    const ox = (viewW - dw) / 2 + (FillState.offsetX || 0);
    const oy = (viewH - dh) / 2 + (FillState.offsetY || 0);
    const ix = (vx - ox) / cover;
    const iy = (vy - oy) / cover;
    if (ix < 0 || iy < 0 || ix >= iw || iy >= ih) return null;
    return { ix: ix | 0, iy: iy | 0 };
  }

  function sampleImageColour(vx, vy, viewW, viewH) {
    const m = viewportToImage(vx, vy, viewW, viewH);
    if (!m || !FillState.imageCtx) return null;
    try {
      const d = FillState.imageCtx.getImageData(m.ix, m.iy, 1, 1).data;
      return { r: d[0] / 255, g: d[1] / 255, b: d[2] / 255, a: d[3] / 255 };
    } catch {
      return null;
    }
  }

  function appendPoints(addPos, addCol, addSc, addOp) {
    const S = getS();
    if (!S) return 0;
    const added = addPos.length / 3;
    if (!added) return 0;
    const oldCount = S.alive?.length || 0;
    const join = (a, b) => {
      const out = new Float32Array((a?.length || 0) + b.length);
      if (a) out.set(a);
      out.set(b, a?.length || 0);
      return out;
    };
    S.positions = join(S.positions, addPos);
    const baseCol = S.colors || new Float32Array(oldCount * 3);
    S.colors = join(baseCol, addCol);
    if (S.paintColors) S.paintColors = join(S.paintColors, addCol);
    else {
      const pc = new Float32Array((oldCount + added) * 3);
      if (oldCount) pc.set(S.colors.subarray(0, oldCount * 3));
      pc.set(addCol, oldCount * 3);
      S.paintColors = pc;
    }
    if (S.scale) S.scale = join(S.scale, addSc);
    else S.scale = join(new Float32Array(oldCount).fill(0.01), addSc);
    if (S.opacity) S.opacity = join(S.opacity, addOp);
    const alive = new Uint8Array(oldCount + added);
    if (S.alive) alive.set(S.alive);
    alive.fill(1, oldCount);
    S.alive = alive;
    const selected = new Uint8Array(oldCount + added);
    if (S.selected) selected.set(S.selected);
    S.selected = selected;
    if (S.fileType !== 'ply') {
      S.fileType = 'ply';
      S.sourceBuffer = null;
    }
    return added;
  }

  /**
   * Main stroke: densify under brush at screen (cx,cy).
   */
  function fillStroke(cx, cy, viewW, viewH, brushRadiusPx) {
    const S = getS();
    const camera = getCamera();
    const THREE = global.THREE;
    if (!S?.positions || !S.alive || !camera || !THREE) {
      setStatus('Load a splat first', 'warn');
      return 0;
    }
    const r2 = brushRadiusPx * brushRadiusPx;
    const n = S.alive.length;
    const samples = [];
    const proj = new THREE.Vector3();
    const view = new THREE.Vector3();
    let frontDepth = Infinity;

    for (let i = 0; i < n; i++) {
      if (!S.alive[i]) continue;
      const x = S.positions[i * 3];
      const y = S.positions[i * 3 + 1];
      const z = S.positions[i * 3 + 2];
      view.set(x, y, z);
      const depth = -view.applyMatrix4(camera.matrixWorldInverse).z;
      if (depth <= 0) continue;
      proj.set(x, y, z).project(camera);
      const sx = (proj.x * 0.5 + 0.5) * viewW;
      const sy = (-proj.y * 0.5 + 0.5) * viewH;
      const dx = sx - cx;
      const dy = sy - cy;
      if (dx * dx + dy * dy > r2 * 2.5) continue;
      const src = S.paintColors || S.colors;
      samples.push({
        x, y, z,
        r: src ? src[i * 3] : 0.7,
        g: src ? src[i * 3 + 1] : 0.7,
        b: src ? src[i * 3 + 2] : 0.7,
        sc: S.scale ? S.scale[i] || 0.01 : 0.01,
        depth, sx, sy,
      });
      if (dx * dx + dy * dy <= r2 && depth < frontDepth) frontDepth = depth;
    }

    if (samples.length < 2 || !Number.isFinite(frontDepth)) {
      setStatus('Fill: stroke next to existing surface so depth & colour can match', 'warn');
      return 0;
    }

    const depthTol = Math.max(frontDepth * 0.1, 1e-3);
    const near = samples.filter((s) => Math.abs(s.depth - frontDepth) <= depthTol * 2);
    const pool = near.length >= 2 ? near : samples;

    let wx = 0, wy = 0, wz = 0, wr = 0, wg = 0, wb = 0, wsc = 0, wsum = 0;
    for (const s of pool) {
      const d2 = (s.sx - cx) ** 2 + (s.sy - cy) ** 2;
      const w = 1 / (1 + d2 / Math.max(1, r2));
      wx += s.x * w; wy += s.y * w; wz += s.z * w;
      wr += s.r * w; wg += s.g * w; wb += s.b * w;
      wsc += s.sc * w;
      wsum += w;
    }
    wx /= wsum; wy /= wsum; wz /= wsum;
    wr /= wsum; wg /= wsum; wb /= wsum;
    wsc /= wsum;

    const density = Math.max(0.4, Math.min(2.5, FillState.density || 1));
    const targetAdd = Math.min(160, Math.max(10, Math.round((brushRadiusPx / 16) * density * 32)));
    const worldPerPixel =
      (2 * frontDepth * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / Math.max(1, viewH);
    const radiusWorld = worldPerPixel * brushRadiusPx;

    const right = new THREE.Vector3();
    const up = new THREE.Vector3();
    camera.matrixWorld.extractBasis(right, up, new THREE.Vector3());
    right.normalize();
    up.normalize();
    const camPos = camera.position.clone();
    const toCam = camPos.clone().sub(new THREE.Vector3(wx, wy, wz)).normalize();

    const addPos = new Float32Array(targetAdd * 3);
    const addCol = new Float32Array(targetAdd * 3);
    const addSc = new Float32Array(targetAdd);
    const addOp = new Float32Array(targetAdd);
    const mode = FillState.colourMode || 'hybrid';
    let usedImage = 0;

    for (let k = 0; k < targetAdd; k++) {
      const ang = Math.random() * Math.PI * 2;
      const rad = Math.sqrt(Math.random()) * radiusWorld * 0.95;
      const ox = right.x * Math.cos(ang) * rad + up.x * Math.sin(ang) * rad;
      const oy = right.y * Math.cos(ang) * rad + up.y * Math.sin(ang) * rad;
      const oz = right.z * Math.cos(ang) * rad + up.z * Math.sin(ang) * rad;
      const nudge = (Math.random() - 0.35) * radiusWorld * 0.12;
      const px = wx + ox + toCam.x * nudge;
      const py = wy + oy + toCam.y * nudge;
      const pz = wz + oz + toCam.z * nudge;
      addPos[k * 3] = px;
      addPos[k * 3 + 1] = py;
      addPos[k * 3 + 2] = pz;

      // Screen position of this new point for image sample
      proj.set(px, py, pz).project(camera);
      const sx = (proj.x * 0.5 + 0.5) * viewW;
      const sy = (-proj.y * 0.5 + 0.5) * viewH;

      const nb = pool[(Math.random() * pool.length) | 0];
      let cr = wr * 0.6 + nb.r * 0.4;
      let cg = wg * 0.6 + nb.g * 0.4;
      let cb = wb * 0.6 + nb.b * 0.4;

      if (mode !== 'neighbours' && FillState.imageCtx) {
        const ic = sampleImageColour(sx, sy, viewW, viewH);
        if (ic && ic.a > 0.05) {
          usedImage++;
          if (mode === 'image') {
            cr = ic.r; cg = ic.g; cb = ic.b;
          } else {
            // hybrid
            cr = ic.r * 0.72 + cr * 0.28;
            cg = ic.g * 0.72 + cg * 0.28;
            cb = ic.b * 0.72 + cb * 0.28;
          }
        }
      }

      addCol[k * 3] = cr;
      addCol[k * 3 + 1] = cg;
      addCol[k * 3 + 2] = cb;
      addSc[k] = Math.max(1e-4, wsc * (0.8 + Math.random() * 0.4));
      addOp[k] = 0.92;
    }

    const added = appendPoints(addPos, addCol, addSc, addOp);
    if (typeof global.rebuildGeometry === 'function') global.rebuildGeometry();
    const imgNote = usedImage ? `, ${usedImage} from photo` : '';
    setStatus(`Fill +${added} points${imgNote}`, 'ok');
    return added;
  }

  /** Draw reference image overlay on a 2d canvas covering the viewport (optional). */
  function drawOverlay(ctx, viewW, viewH) {
    if (!FillState.showOverlay || !FillState.image || !ctx) return;
    const iw = FillState.image.naturalWidth;
    const ih = FillState.image.naturalHeight;
    const cover = Math.max(viewW / iw, viewH / ih) * (FillState.scale || 1);
    const dw = iw * cover;
    const dh = ih * cover;
    const ox = (viewW - dw) / 2 + (FillState.offsetX || 0);
    const oy = (viewH - dh) / 2 + (FillState.offsetY || 0);
    ctx.save();
    ctx.globalAlpha = FillState.opacity;
    ctx.drawImage(FillState.image, ox, oy, dw, dh);
    ctx.restore();
  }

  function clearImage() {
    if (FillState.imageUrl && FillState.imageUrl.startsWith('blob:')) {
      try { URL.revokeObjectURL(FillState.imageUrl); } catch (_) {}
    }
    FillState.image = null;
    FillState.imageCanvas = null;
    FillState.imageCtx = null;
    FillState.imageUrl = null;
  }

  global.FumocaGapFill = {
    state: FillState,
    loadImageFromFile,
    loadImageFromUrl,
    clearImage,
    fillStroke,
    sampleImageColour,
    drawOverlay,
    setColourMode(m) { FillState.colourMode = m; },
    setDensity(d) { FillState.density = d; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
