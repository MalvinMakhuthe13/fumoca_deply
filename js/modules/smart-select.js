/**
 * FUMOCA Smart Selection v1
 * ══════════════════════════════════════════════════════
 * Depth-aware and object-aware selection tools.
 *
 * Tools:
 *  - selectDepthSlice(center, radius, depthTolerance)
 *    Selects Gaussians in a depth band around a clicked point
 *  - selectObject(clickX, clickY, camera)
 *    Flood-fills from clicked Gaussian by proximity + colour similarity
 *  - selectBackground()
 *    Selects everything outside the dense central cluster
 *  - selectForeground()
 *    Selects the densest central cluster (main subject)
 *  - smartBrush(x, y, radius, depthAware)
 *    Brush that only selects Gaussians at the same depth layer
 * ══════════════════════════════════════════════════════
 */

const FumocaSmartSelect = (() => {

  // ── Project a Gaussian to screen space ────────────────
  // Pure JS matrix multiply — no THREE dependency needed
  function _mulM4V4(m, x, y, z, w) {
    const e = m.elements;
    return {
      x: e[0]*x + e[4]*y + e[8]*z  + e[12]*w,
      y: e[1]*x + e[5]*y + e[9]*z  + e[13]*w,
      z: e[2]*x + e[6]*y + e[10]*z + e[14]*w,
      w: e[3]*x + e[7]*y + e[11]*z + e[15]*w,
    };
  }

  function _project(px, py, pz, camera, W, H) {
    // View space
    const vp = _mulM4V4(camera.matrixWorldInverse, px, py, pz, 1);
    // Clip space
    const cp = _mulM4V4(camera.projectionMatrix, vp.x, vp.y, vp.z, vp.w);
    if (Math.abs(cp.w) < 0.0001) return { x: -9999, y: -9999, depth: 999 };
    return {
      x: (cp.x / cp.w * 0.5 + 0.5) * W,
      y: (1 - (cp.y / cp.w * 0.5 + 0.5)) * H,
      depth: cp.z / cp.w
    };
  }

  // ── Get the closest Gaussian to a screen click ────────
  function _closestGaussian(sx, sy, camera, W, H, maxScreenDist = 20) {
    const S = window.S;
    if (!S?.positions || !S.alive) return -1;

    let bestIdx = -1, bestDist = maxScreenDist * maxScreenDist;
    for (let i = 0; i < S.alive.length; i++) {
      if (!S.alive[i]) continue;
      const p = _project(S.positions[i*3], S.positions[i*3+1], S.positions[i*3+2], camera, W, H);
      if (p.depth < -1 || p.depth > 1) continue;
      const dx = p.x - sx, dy = p.y - sy;
      const d2 = dx*dx + dy*dy;
      if (d2 < bestDist) { bestDist = d2; bestIdx = i; }
    }
    return bestIdx;
  }

  // ── Colour similarity ─────────────────────────────────
  function _colourDist(S, i, j) {
    const dr = S.colors[i*3]   - S.colors[j*3];
    const dg = S.colors[i*3+1] - S.colors[j*3+1];
    const db = S.colors[i*3+2] - S.colors[j*3+2];
    return Math.sqrt(dr*dr + dg*dg + db*db);
  }

  // ── Smart object select (flood fill by proximity + colour) ──
  function selectObject(clickX, clickY) {
    const S = window.S;
    if (!S?.alive) return 0;
    const cam = window._fumocaViewerCamera;
    if (!cam) return 0;

    const vp = document.getElementById('viewport') || document.body;
    const W = vp.clientWidth, H = vp.clientHeight;

    const seed = _closestGaussian(clickX, clickY, cam, W, H);
    if (seed < 0) return 0;

    // Compute bounding stats for the whole cloud
    let cx=0, cy=0, cz=0, cnt=0;
    for (let i=0; i<S.alive.length; i++) {
      if (!S.alive[i]) continue;
      cx += S.positions[i*3]; cy += S.positions[i*3+1]; cz += S.positions[i*3+2]; cnt++;
    }
    cx /= cnt; cy /= cnt; cz /= cnt;
    let maxR = 0;
    for (let i=0; i<S.alive.length; i++) {
      if (!S.alive[i]) continue;
      const dx=S.positions[i*3]-cx, dy=S.positions[i*3+1]-cy, dz=S.positions[i*3+2]-cz;
      maxR = Math.max(maxR, Math.sqrt(dx*dx+dy*dy+dz*dz));
    }

    // Neighbourhood radius: 8% of scene radius
    const neighbourR = maxR * 0.08;
    const colourThresh = 0.22;

    // BFS flood fill from seed
    const queue = [seed];
    const visited = new Uint8Array(S.alive.length);
    visited[seed] = 1;
    let count = 0;

    while (queue.length > 0 && count < 50000) {
      const cur = queue.shift();
      S.selected[cur] = 1;
      count++;

      const px=S.positions[cur*3], py=S.positions[cur*3+1], pz=S.positions[cur*3+2];
      for (let j=0; j<S.alive.length; j++) {
        if (!S.alive[j] || visited[j]) continue;
        const dx=S.positions[j*3]-px, dy=S.positions[j*3+1]-py, dz=S.positions[j*3+2]-pz;
        const dist = Math.sqrt(dx*dx+dy*dy+dz*dz);
        if (dist < neighbourR && _colourDist(S, cur, j) < colourThresh) {
          visited[j] = 1;
          queue.push(j);
        }
      }
    }

    return count;
  }

  // ── Select background (outer sparse region) ───────────
  function selectBackground(aggressiveness = 0.5) {
    const S = window.S;
    if (!S?.positions || !S.alive) return 0;

    // Compute scene centroid and radius
    let cx=0,cy=0,cz=0,cnt=0;
    for (let i=0; i<S.alive.length; i++) {
      if (!S.alive[i]) continue;
      cx+=S.positions[i*3]; cy+=S.positions[i*3+1]; cz+=S.positions[i*3+2]; cnt++;
    }
    cx/=cnt; cy/=cnt; cz/=cnt;

    // Compute distances
    const dists = new Float32Array(S.alive.length);
    let maxDist = 0;
    for (let i=0; i<S.alive.length; i++) {
      if (!S.alive[i]) continue;
      const dx=S.positions[i*3]-cx, dy=S.positions[i*3+1]-cy, dz=S.positions[i*3+2]-cz;
      dists[i] = Math.sqrt(dx*dx+dy*dy+dz*dz);
      if (dists[i] > maxDist) maxDist = dists[i];
    }

    // Select outer fraction based on aggressiveness
    const cutoff = maxDist * (0.35 + aggressiveness * 0.35);
    let count = 0;
    for (let i=0; i<S.alive.length; i++) {
      if (!S.alive[i]) continue;
      if (dists[i] > cutoff) { S.selected[i] = 1; count++; }
    }
    return count;
  }

  // ── Select foreground (dense central subject) ─────────
  function selectForeground(aggressiveness = 0.5) {
    const S = window.S;
    if (!S?.positions || !S.alive) return 0;

    let cx=0,cy=0,cz=0,cnt=0;
    for (let i=0; i<S.alive.length; i++) {
      if (!S.alive[i]) continue;
      cx+=S.positions[i*3]; cy+=S.positions[i*3+1]; cz+=S.positions[i*3+2]; cnt++;
    }
    cx/=cnt; cy/=cnt; cz/=cnt;

    let maxDist=0;
    const dists = new Float32Array(S.alive.length);
    for (let i=0; i<S.alive.length; i++) {
      if (!S.alive[i]) continue;
      const dx=S.positions[i*3]-cx, dy=S.positions[i*3+1]-cy, dz=S.positions[i*3+2]-cz;
      dists[i]=Math.sqrt(dx*dx+dy*dy+dz*dz);
      if (dists[i]>maxDist) maxDist=dists[i];
    }

    const cutoff = maxDist * (0.4 - aggressiveness * 0.2);
    let count=0;
    for (let i=0; i<S.alive.length; i++) {
      if (!S.alive[i]) continue;
      if (dists[i] < cutoff) { S.selected[i]=1; count++; }
    }
    return count;
  }

  // ── Depth-aware brush ─────────────────────────────────
  function smartBrush(sx, sy, brushRadius, depthAware = true) {
    const S = window.S;
    if (!S?.alive) return 0;
    const cam = window._fumocaViewerCamera;
    if (!cam) return 0;

    const vp = document.getElementById('viewport') || document.body;
    const W = vp.clientWidth, H = vp.clientHeight;

    // Find the depth of the nearest Gaussian under the brush
    let anchorDepth = null;
    if (depthAware) {
      const anchor = _closestGaussian(sx, sy, cam, W, H, brushRadius);
      if (anchor >= 0) {
        const p = _project(S.positions[anchor*3], S.positions[anchor*3+1], S.positions[anchor*3+2], cam, W, H);
        anchorDepth = p.depth;
      }
    }

    const depthTolerance = 0.12;
    let count = 0;

    for (let i=0; i<S.alive.length; i++) {
      if (!S.alive[i]) continue;
      const p = _project(S.positions[i*3], S.positions[i*3+1], S.positions[i*3+2], cam, W, H);
      const dx=p.x-sx, dy=p.y-sy;
      if (dx*dx+dy*dy > brushRadius*brushRadius) continue;
      if (depthAware && anchorDepth !== null && Math.abs(p.depth - anchorDepth) > depthTolerance) continue;
      S.selected[i] = 1;
      count++;
    }
    return count;
  }

  // ── Select depth slice at a 3D point ─────────────────
  function selectDepthSlice(worldPos, radius) {
    const S = window.S;
    if (!S?.alive) return 0;
    const { x, y, z } = worldPos;
    let count = 0;
    for (let i=0; i<S.alive.length; i++) {
      if (!S.alive[i]) continue;
      const dx=S.positions[i*3]-x, dy=S.positions[i*3+1]-y, dz=S.positions[i*3+2]-z;
      if (dx*dx+dy*dy+dz*dz < radius*radius) { S.selected[i]=1; count++; }
    }
    return count;
  }

  return { selectObject, selectBackground, selectForeground, smartBrush, selectDepthSlice };
})();

window.FumocaSmartSelect = FumocaSmartSelect;
export default FumocaSmartSelect;
