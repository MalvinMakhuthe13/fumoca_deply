/**
 * FUMOCA Gap Fill Engine v2 — solid surface colour matching
 */
(function (global) {
  'use strict';

  const FillState = {
    image: null, imageCanvas: null, imageCtx: null, imageUrl: null,
    offsetX: 0, offsetY: 0, scale: 1, opacity: 0.45,
    colourMode: 'neighbours', // default neighbours — most reliable match
    density: 1, showOverlay: true,
  };

  function getS() { return global.S || null; }
  function getCamera() { return global._fumocaCamera || global.camera || null; }
  function setStatus(msg, kind) {
    if (typeof global.setStatus === 'function') global.setStatus(msg, kind);
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
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        FillState.image = img; FillState.imageCanvas = c; FillState.imageCtx = ctx; FillState.imageUrl = url;
        resolve(FillState);
      };
      img.onerror = () => reject(new Error('Could not load image'));
      img.src = url;
    });
  }

  function viewportToImage(vx, vy, viewW, viewH) {
    if (!FillState.imageCanvas) return null;
    const iw = FillState.imageCanvas.width, ih = FillState.imageCanvas.height;
    const cover = Math.max(viewW / iw, viewH / ih) * (FillState.scale || 1);
    const dw = iw * cover, dh = ih * cover;
    const ox = (viewW - dw) / 2 + (FillState.offsetX || 0);
    const oy = (viewH - dh) / 2 + (FillState.offsetY || 0);
    const ix = (vx - ox) / cover, iy = (vy - oy) / cover;
    if (ix < 0 || iy < 0 || ix >= iw || iy >= ih) return null;
    return { ix: ix | 0, iy: iy | 0 };
  }

  function sampleImageColour(vx, vy, viewW, viewH) {
    const m = viewportToImage(vx, vy, viewW, viewH);
    if (!m || !FillState.imageCtx) return null;
    try {
      const d = FillState.imageCtx.getImageData(m.ix, m.iy, 1, 1).data;
      return { r: d[0] / 255, g: d[1] / 255, b: d[2] / 255, a: d[3] / 255 };
    } catch { return null; }
  }

  function median3(arr) {
    const a = arr.slice().sort((x, y) => x - y);
    const m = (a.length - 1) / 2;
    return a.length % 2 ? a[m | 0] : 0.5 * (a[m | 0] + a[(m + 0.5) | 0]);
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
    S.colors = join(S.colors || new Float32Array(oldCount * 3), addCol);
    if (S.paintColors) S.paintColors = join(S.paintColors, addCol);
    else {
      const pc = new Float32Array((oldCount + added) * 3);
      if (oldCount && S.colors) pc.set(S.colors.subarray(0, oldCount * 3));
      pc.set(addCol, oldCount * 3);
      S.paintColors = pc;
    }
    if (S.scale) S.scale = join(S.scale, addSc);
    else S.scale = join(new Float32Array(oldCount).fill(0.008), addSc);
    if (S.scaleXYZ) {
      const xyz = new Float32Array(addSc.length * 3);
      for (let i = 0; i < addSc.length; i++) {
        xyz[i * 3] = xyz[i * 3 + 1] = xyz[i * 3 + 2] = addSc[i];
      }
      S.scaleXYZ = join(S.scaleXYZ, xyz);
    }
    if (S.opacity) S.opacity = join(S.opacity, addOp);
    const alive = new Uint8Array(oldCount + added);
    if (S.alive) alive.set(S.alive);
    alive.fill(1, oldCount);
    S.alive = alive;
    const selected = new Uint8Array(oldCount + added);
    if (S.selected) selected.set(S.selected);
    S.selected = selected;
    if (S.fileType !== 'ply') { S.fileType = 'ply'; S.sourceBuffer = null; }
    return added;
  }

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

    // Only points strictly under the brush (not a wide ring)
    for (let i = 0; i < n; i++) {
      if (!S.alive[i]) continue;
      const x = S.positions[i * 3], y = S.positions[i * 3 + 1], z = S.positions[i * 3 + 2];
      view.set(x, y, z);
      const depth = -view.applyMatrix4(camera.matrixWorldInverse).z;
      if (depth <= 0) continue;
      proj.set(x, y, z).project(camera);
      const sx = (proj.x * 0.5 + 0.5) * viewW;
      const sy = (-proj.y * 0.5 + 0.5) * viewH;
      const dx = sx - cx, dy = sy - cy;
      if (dx * dx + dy * dy > r2) continue;
      const src = S.paintColors || S.colors;
      let r = src ? src[i * 3] : 0.7, g = src ? src[i * 3 + 1] : 0.7, b = src ? src[i * 3 + 2] : 0.7;
      // skip near-black / pure garbage samples
      if (r + g + b < 0.08) continue;
      samples.push({
        x, y, z, r, g, b,
        sc: S.scale ? (S.scale[i] || 0.008) : 0.008,
        depth, sx, sy,
        d2: dx * dx + dy * dy,
      });
      if (depth < frontDepth) frontDepth = depth;
    }

    if (samples.length < 2 || !Number.isFinite(frontDepth)) {
      setStatus('Fill: paint on the visible surface (not empty sky)', 'warn');
      return 0;
    }

    // Front surface only — tight depth band (kills interior rainbow points)
    const depthTol = Math.max(frontDepth * 0.04, 1e-4);
    let pool = samples.filter((s) => s.depth <= frontDepth + depthTol);
    if (pool.length < 2) pool = samples.filter((s) => s.depth <= frontDepth + depthTol * 3);
    if (pool.length < 2) pool = samples;
    // Prefer closest to cursor
    pool.sort((a, b) => a.d2 - b.d2);
    pool = pool.slice(0, Math.min(24, pool.length));

    // Median colour = stable match to body paint (not average of interior junk)
    const medR = median3(pool.map((s) => s.r));
    const medG = median3(pool.map((s) => s.g));
    const medB = median3(pool.map((s) => s.b));
    // Drop outliers far from median (internal multi-colour noise)
    const clean = pool.filter((s) => {
      const dr = s.r - medR, dg = s.g - medG, db = s.b - medB;
      return dr * dr + dg * dg + db * db < 0.12; // ~0.35 RGB distance
    });
    const use = clean.length >= 2 ? clean : pool;

    let wx = 0, wy = 0, wz = 0, wsc = 0, wsum = 0;
    for (const s of use) {
      const w = 1 / (1 + s.d2 / Math.max(1, r2));
      wx += s.x * w; wy += s.y * w; wz += s.z * w;
      wsc += s.sc * w; wsum += w;
    }
    wx /= wsum; wy /= wsum; wz /= wsum; wsc /= wsum;
    const baseR = median3(use.map((s) => s.r));
    const baseG = median3(use.map((s) => s.g));
    const baseB = median3(use.map((s) => s.b));

    const density = Math.max(0.4, Math.min(2.5, FillState.density || 1));
    const targetAdd = Math.min(100, Math.max(8, Math.round((brushRadiusPx / 18) * density * 24)));
    const worldPerPixel =
      (2 * frontDepth * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / Math.max(1, viewH);
    const radiusWorld = worldPerPixel * brushRadiusPx * 0.85;

    const right = new THREE.Vector3(), up = new THREE.Vector3();
    camera.matrixWorld.extractBasis(right, up, new THREE.Vector3());
    right.normalize(); up.normalize();
    const camPos = camera.position.clone();
    const toCam = camPos.clone().sub(new THREE.Vector3(wx, wy, wz)).normalize();

    const addPos = new Float32Array(targetAdd * 3);
    const addCol = new Float32Array(targetAdd * 3);
    const addSc = new Float32Array(targetAdd);
    const addOp = new Float32Array(targetAdd);
    const mode = FillState.colourMode || 'neighbours';
    let usedImage = 0;

    for (let k = 0; k < targetAdd; k++) {
      const ang = Math.random() * Math.PI * 2;
      const rad = Math.sqrt(Math.random()) * radiusWorld;
      const ox = right.x * Math.cos(ang) * rad + up.x * Math.sin(ang) * rad;
      const oy = right.y * Math.cos(ang) * rad + up.y * Math.sin(ang) * rad;
      const oz = right.z * Math.cos(ang) * rad + up.z * Math.sin(ang) * rad;
      const nudge = (Math.random() - 0.2) * radiusWorld * 0.06;
      const px = wx + ox + toCam.x * nudge;
      const py = wy + oy + toCam.y * nudge;
      const pz = wz + oz + toCam.z * nudge;
      addPos[k * 3] = px; addPos[k * 3 + 1] = py; addPos[k * 3 + 2] = pz;

      // Tiny variation around median surface colour (not random interior)
      const j = (Math.random() - 0.5) * 0.04;
      let cr = baseR + j, cg = baseG + j, cb = baseB + j;

      if (mode !== 'neighbours' && FillState.imageCtx) {
        proj.set(px, py, pz).project(camera);
        const sx = (proj.x * 0.5 + 0.5) * viewW;
        const sy = (-proj.y * 0.5 + 0.5) * viewH;
        const ic = sampleImageColour(sx, sy, viewW, viewH);
        if (ic && ic.a > 0.1) {
          usedImage++;
          if (mode === 'image') { cr = ic.r; cg = ic.g; cb = ic.b; }
          else { cr = ic.r * 0.8 + cr * 0.2; cg = ic.g * 0.8 + cg * 0.2; cb = ic.b * 0.8 + cb * 0.2; }
        }
      }
      addCol[k * 3] = Math.min(1, Math.max(0, cr));
      addCol[k * 3 + 1] = Math.min(1, Math.max(0, cg));
      addCol[k * 3 + 2] = Math.min(1, Math.max(0, cb));
      // Tight scale — avoids new "soap bubble" blobs
      addSc[k] = Math.max(1e-4, Math.min(0.02, wsc * (0.9 + Math.random() * 0.15)));
      addOp[k] = 1;
    }

    const added = appendPoints(addPos, addCol, addSc, addOp);
    if (typeof global.rebuildGeometry === 'function') global.rebuildGeometry();
    setStatus(`Fill +${added} · surface colour matched${usedImage ? ' (+photo)' : ''}`, 'ok');
    return added;
  }

  function drawOverlay(ctx, viewW, viewH) {
    if (!FillState.showOverlay || !FillState.image || !ctx) return;
    const iw = FillState.image.naturalWidth, ih = FillState.image.naturalHeight;
    const cover = Math.max(viewW / iw, viewH / ih) * (FillState.scale || 1);
    const dw = iw * cover, dh = ih * cover;
    const ox = (viewW - dw) / 2 + (FillState.offsetX || 0);
    const oy = (viewH - dh) / 2 + (FillState.offsetY || 0);
    ctx.save(); ctx.globalAlpha = FillState.opacity;
    ctx.drawImage(FillState.image, ox, oy, dw, dh); ctx.restore();
  }

  function clearImage() {
    if (FillState.imageUrl && FillState.imageUrl.startsWith('blob:')) {
      try { URL.revokeObjectURL(FillState.imageUrl); } catch (_) {}
    }
    FillState.image = null; FillState.imageCanvas = null; FillState.imageCtx = null; FillState.imageUrl = null;
  }

  global.FumocaGapFill = {
    state: FillState, loadImageFromFile, clearImage, fillStroke, drawOverlay,
    setColourMode(m) { FillState.colourMode = m; },
    setDensity(d) { FillState.density = d; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
