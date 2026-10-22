/**
 * FUMOCA Gap Fill Engine v3
 * - Honours paintColors sentinel (-1 = use source S.colors)
 * - Front-surface densify with median body colour
 * - Guaranteed rebuild + status feedback
 */
(function (global) {
  'use strict';

  const FillState = {
    image: null, imageCanvas: null, imageCtx: null, imageUrl: null,
    offsetX: 0, offsetY: 0, scale: 1, opacity: 0.45,
    colourMode: 'neighbours',
    density: 1.2,
    showOverlay: true,
  };

  function getS() { return global.S || null; }
  function getCamera() { return global._fumocaCamera || global.camera || null; }
  function setStatus(msg, kind) {
    if (typeof global.setStatus === 'function') global.setStatus(msg, kind);
    const el = document.getElementById('statusText');
    if (el) el.textContent = msg;
  }

  /** Resolve display RGB for point i — never trust -1 paint sentinel as colour */
  function pointColour(S, i) {
    const pc = S.paintColors;
    if (pc && pc[i * 3] >= 0 && pc[i * 3 + 1] >= 0 && pc[i * 3 + 2] >= 0) {
      return [pc[i * 3], pc[i * 3 + 1], pc[i * 3 + 2]];
    }
    if (S.colors && S.colors.length >= (i + 1) * 3) {
      return [
        Math.max(0, S.colors[i * 3] || 0),
        Math.max(0, S.colors[i * 3 + 1] || 0),
        Math.max(0, S.colors[i * 3 + 2] || 0),
      ];
    }
    return [0.75, 0.75, 0.75];
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

  function median(arr) {
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
    // paintColors: -1 means "use source"; new points get real colours (>=0)
    if (S.paintColors) {
      const pc = new Float32Array((oldCount + added) * 3);
      pc.set(S.paintColors);
      pc.set(addCol, oldCount * 3);
      S.paintColors = pc;
    } else {
      const pc = new Float32Array((oldCount + added) * 3);
      for (let i = 0; i < oldCount * 3; i++) pc[i] = -1;
      pc.set(addCol, oldCount * 3);
      S.paintColors = pc;
    }
    if (S.scale) S.scale = join(S.scale, addSc);
    else S.scale = join(new Float32Array(oldCount).fill(0.012), addSc);
    if (S.scaleXYZ) {
      const xyz = new Float32Array(added * 3);
      for (let i = 0; i < added; i++) xyz[i * 3] = xyz[i * 3 + 1] = xyz[i * 3 + 2] = addSc[i];
      S.scaleXYZ = join(S.scaleXYZ, xyz);
    }
    if (S.opacity) S.opacity = join(S.opacity, addOp);
    else S.opacity = join(new Float32Array(oldCount).fill(1), addOp);
    const alive = new Uint8Array(oldCount + added);
    if (S.alive) alive.set(S.alive);
    alive.fill(1, oldCount);
    S.alive = alive;
    const selected = new Uint8Array(oldCount + added);
    if (S.selected) selected.set(S.selected);
    S.selected = selected;
    // Optional SH / rotation pads so geometry builders don't crash
    if (S.rotation) {
      const rot = new Float32Array((oldCount + added) * 4);
      rot.set(S.rotation);
      for (let i = oldCount; i < oldCount + added; i++) {
        rot[i * 4 + 3] = 1; // identity quat w
      }
      S.rotation = rot;
    }
    if (S.fileType !== 'ply') { S.fileType = 'ply'; S.sourceBuffer = null; }
    return added;
  }

  function fillStroke(cx, cy, viewW, viewH, brushRadiusPx) {
    const S = getS();
    const camera = getCamera();
    const THREE = global.THREE;
    if (!S?.positions || !S.alive || !camera || !THREE) {
      setStatus('Fill: load a splat first', 'warn');
      return 0;
    }
    const r2 = Math.max(8, brushRadiusPx) * Math.max(8, brushRadiusPx);
    const n = S.alive.length;
    const samples = [];
    const proj = new THREE.Vector3();
    const view = new THREE.Vector3();
    let frontDepth = Infinity;

    for (let i = 0; i < n; i++) {
      if (!S.alive[i]) continue;
      const x = S.positions[i * 3], y = S.positions[i * 3 + 1], z = S.positions[i * 3 + 2];
      view.set(x, y, z);
      const depth = -view.applyMatrix4(camera.matrixWorldInverse).z;
      if (!(depth > 0) || !Number.isFinite(depth)) continue;
      proj.set(x, y, z).project(camera);
      if (Math.abs(proj.z) > 1) continue; // behind near/far
      const sx = (proj.x * 0.5 + 0.5) * viewW;
      const sy = (-proj.y * 0.5 + 0.5) * viewH;
      const dx = sx - cx, dy = sy - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      const [r, g, b] = pointColour(S, i);
      samples.push({
        x, y, z, r, g, b,
        sc: S.scale ? (S.scale[i] || 0.012) : 0.012,
        depth, sx, sy, d2,
      });
      if (depth < frontDepth) frontDepth = depth;
    }

    if (samples.length < 1 || !Number.isFinite(frontDepth)) {
      setStatus('Fill: put the lime ring ON the car surface, then drag', 'warn');
      return 0;
    }

    // Front band — but never empty
    const depthTol = Math.max(frontDepth * 0.06, 1e-4);
    let pool = samples.filter((s) => s.depth <= frontDepth + depthTol);
    if (pool.length < 1) pool = samples;
    pool.sort((a, b) => a.d2 - b.d2);
    pool = pool.slice(0, Math.min(32, pool.length));

    const baseR = median(pool.map((s) => s.r));
    const baseG = median(pool.map((s) => s.g));
    const baseB = median(pool.map((s) => s.b));

    let wx = 0, wy = 0, wz = 0, wsc = 0, wsum = 0;
    for (const s of pool) {
      const w = 1 / (1 + s.d2 / Math.max(1, r2));
      wx += s.x * w; wy += s.y * w; wz += s.z * w;
      wsc += s.sc * w; wsum += w;
    }
    wx /= wsum; wy /= wsum; wz /= wsum; wsc /= wsum;

    const density = Math.max(0.5, Math.min(3, FillState.density || 1.2));
    const targetAdd = Math.min(180, Math.max(20, Math.round((brushRadiusPx / 14) * density * 36)));
    const worldPerPixel =
      (2 * frontDepth * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / Math.max(1, viewH);
    const radiusWorld = worldPerPixel * brushRadiusPx * 0.9;

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
      // Slightly toward camera so points sit on front shell, not buried
      const nudge = worldPerPixel * (0.5 + Math.random());
      const px = wx + ox + toCam.x * nudge;
      const py = wy + oy + toCam.y * nudge;
      const pz = wz + oz + toCam.z * nudge;
      addPos[k * 3] = px; addPos[k * 3 + 1] = py; addPos[k * 3 + 2] = pz;

      const j = (Math.random() - 0.5) * 0.03;
      let cr = baseR + j, cg = baseG + j, cb = baseB + j;

      if (mode !== 'neighbours' && FillState.imageCtx) {
        proj.set(px, py, pz).project(camera);
        const sx = (proj.x * 0.5 + 0.5) * viewW;
        const sy = (-proj.y * 0.5 + 0.5) * viewH;
        const ic = sampleImageColour(sx, sy, viewW, viewH);
        if (ic && ic.a > 0.1) {
          usedImage++;
          if (mode === 'image') { cr = ic.r; cg = ic.g; cb = ic.b; }
          else { cr = ic.r * 0.75 + cr * 0.25; cg = ic.g * 0.75 + cg * 0.25; cb = ic.b * 0.75 + cb * 0.25; }
        }
      }
      addCol[k * 3] = Math.min(1, Math.max(0, cr));
      addCol[k * 3 + 1] = Math.min(1, Math.max(0, cg));
      addCol[k * 3 + 2] = Math.min(1, Math.max(0, cb));
      addSc[k] = Math.max(0.004, Math.min(0.03, wsc * (0.95 + Math.random() * 0.1)));
      addOp[k] = 1;
    }

    const before = S.alive.length;
    const added = appendPoints(addPos, addCol, addSc, addOp);
    try {
      if (typeof global.rebuildGeometry === 'function') global.rebuildGeometry();
      window.FumocaGaussianRenderer?.invalidateSort?.();
    } catch (e) {
      console.warn('[GapFill] rebuild', e);
    }
    const after = S.alive.length;
    setStatus(`Fill OK +${added} points (${before} → ${after})${usedImage ? ' · photo tint' : ''}`, 'ok');
    console.log('[GapFill] added', added, 'total', after);
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
    state: FillState, loadImageFromFile, clearImage, fillStroke, drawOverlay, pointColour,
    setColourMode(m) { FillState.colourMode = m; },
    setDensity(d) { FillState.density = d; },
  };
  console.log('[GapFill] engine v3 ready');
})(typeof window !== 'undefined' ? window : globalThis);
