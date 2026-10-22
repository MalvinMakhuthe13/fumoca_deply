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
      if (Math.abs(proj.z) > 1) continue;
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

    if (samples.length < 3 || !Number.isFinite(frontDepth)) {
      setStatus('Fill: put the lime ring ON the car surface, then drag', 'warn');
      return 0;
    }

    // Front surface band only
    const depthTol = Math.max(frontDepth * 0.05, 1e-4);
    let pool = samples.filter((s) => s.depth <= frontDepth + depthTol);
    if (pool.length < 3) pool = samples.slice();
    pool.sort((a, b) => a.d2 - b.d2);
    pool = pool.slice(0, Math.min(40, pool.length));

    // --- Local surface frame (PCA-ish): centroid + two tangent axes in the point cloud ---
    let cxw = 0, cyw = 0, czw = 0;
    for (const s of pool) { cxw += s.x; cyw += s.y; czw += s.z; }
    cxw /= pool.length; cyw /= pool.length; czw /= pool.length;

    // Covariance (symmetric 3x3)
    let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
    for (const s of pool) {
      const dx = s.x - cxw, dy = s.y - cyw, dz = s.z - czw;
      xx += dx * dx; xy += dx * dy; xz += dx * dz;
      yy += dy * dy; yz += dy * dz; zz += dz * dz;
    }
    // Approximate normal = smallest eigenvector via cross of two dominant spread directions
    // Use camera-facing heuristic: normal should point somewhat toward camera
    const camPos = camera.position;
    // Build tangent basis from camera right/up projected onto plane perpendicular to view-to-centroid
    const toCam = new THREE.Vector3(camPos.x - cxw, camPos.y - cyw, camPos.z - czw).normalize();
    // Prefer data-driven normal: normal ~ direction of least variance using power iteration on adj
    // Simple: normal = normalize(cross of two vectors from centroid to farthest samples in pool)
    let bestA = pool[0], bestB = pool[1], bestArea = -1;
    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        const ax = pool[i].x - cxw, ay = pool[i].y - cyw, az = pool[i].z - czw;
        const bx = pool[j].x - cxw, by = pool[j].y - cyw, bz = pool[j].z - czw;
        const cxv = ay * bz - az * by, cyv = az * bx - ax * bz, czv = ax * by - ay * bx;
        const area = cxv * cxv + cyv * cyv + czv * czv;
        if (area > bestArea) { bestArea = area; bestA = pool[i]; bestB = pool[j]; }
      }
    }
    const t1 = new THREE.Vector3(bestA.x - cxw, bestA.y - cyw, bestA.z - czw);
    const t2 = new THREE.Vector3(bestB.x - cxw, bestB.y - cyw, bestB.z - czw);
    let normal = new THREE.Vector3().crossVectors(t1, t2);
    if (normal.lengthSq() < 1e-12) normal.copy(toCam);
    else normal.normalize();
    // Flip normal to face camera
    if (normal.dot(toCam) < 0) normal.negate();

    // Orthonormal tangent basis on the surface
    let right = new THREE.Vector3().crossVectors(normal, new THREE.Vector3(0, 1, 0));
    if (right.lengthSq() < 1e-8) right.crossVectors(normal, new THREE.Vector3(1, 0, 0));
    right.normalize();
    const up = new THREE.Vector3().crossVectors(normal, right).normalize();

    // Surface radius from neighbour spread (not screen disk floating in air)
    let maxR = 0;
    for (const s of pool) {
      const dx = s.x - cxw, dy = s.y - cyw, dz = s.z - czw;
      // distance in plane
      const px = dx * right.x + dy * right.y + dz * right.z;
      const py = dx * up.x + dy * up.y + dz * up.z;
      maxR = Math.max(maxR, Math.sqrt(px * px + py * py));
    }
    const worldPerPixel =
      (2 * frontDepth * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / Math.max(1, viewH);
    const brushWorld = worldPerPixel * brushRadiusPx;
    const radiusWorld = Math.min(Math.max(maxR * 1.05, brushWorld * 0.35), brushWorld * 0.95);

    const baseR = median(pool.map((s) => s.r));
    const baseG = median(pool.map((s) => s.g));
    const baseB = median(pool.map((s) => s.b));
    let wsc = 0;
    for (const s of pool) wsc += s.sc;
    wsc /= pool.length;

    const density = Math.max(0.5, Math.min(3, FillState.density || 1.2));
    const targetAdd = Math.min(140, Math.max(16, Math.round((brushRadiusPx / 14) * density * 30)));

    const addPos = new Float32Array(targetAdd * 3);
    const addCol = new Float32Array(targetAdd * 3);
    const addSc = new Float32Array(targetAdd);
    const addOp = new Float32Array(targetAdd);
    const mode = FillState.colourMode || 'neighbours';
    let usedImage = 0;

    for (let k = 0; k < targetAdd; k++) {
      // Sample in the SURFACE plane (not camera plane) — points stay on the body
      const ang = Math.random() * Math.PI * 2;
      const rad = Math.sqrt(Math.random()) * radiusWorld;
      let px = cxw + right.x * Math.cos(ang) * rad + up.x * Math.sin(ang) * rad;
      let py = cyw + right.y * Math.cos(ang) * rad + up.y * Math.sin(ang) * rad;
      let pz = czw + right.z * Math.cos(ang) * rad + up.z * Math.sin(ang) * rad;

      // Project onto plane through centroid with estimated normal (kills floaters)
      const vx = px - cxw, vy = py - cyw, vz = pz - czw;
      const dist = vx * normal.x + vy * normal.y + vz * normal.z;
      px -= normal.x * dist;
      py -= normal.y * dist;
      pz -= normal.z * dist;

      // Tiny noise along normal (half toward outside only) — stay glued
      const micro = (Math.random() - 0.15) * worldPerPixel * 0.25;
      px += normal.x * micro;
      py += normal.y * micro;
      pz += normal.z * micro;

      // Snap toward nearest neighbour to reduce gaps off the mesh
      let nearest = pool[0], bestD = Infinity;
      for (const s of pool) {
        const ddx = s.x - px, ddy = s.y - py, ddz = s.z - pz;
        const d = ddx * ddx + ddy * ddy + ddz * ddz;
        if (d < bestD) { bestD = d; nearest = s; }
      }
      // Blend 15% toward nearest surface point
      px = px * 0.85 + nearest.x * 0.15;
      py = py * 0.85 + nearest.y * 0.15;
      pz = pz * 0.85 + nearest.z * 0.15;

      addPos[k * 3] = px; addPos[k * 3 + 1] = py; addPos[k * 3 + 2] = pz;

      const j = (Math.random() - 0.5) * 0.025;
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
      // Match local scale — avoid giant detached blobs
      addSc[k] = Math.max(0.003, Math.min(0.02, wsc * (0.9 + Math.random() * 0.15)));
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
    setStatus(`Fill OK +${added} on surface (${before} → ${S.alive.length})`, 'ok');
    console.log('[GapFill] surface-snap added', added);
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
