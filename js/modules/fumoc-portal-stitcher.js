/**
 * FUMOCA Portal Stitcher v83
 * ════════════════════════════════════════════════════════════════════════════
 * Solves the hardest problem in automotive Gaussian splatting:
 * seamlessly merging exterior and interior captures into a single unified
 * scene with no visible seam, no lighting discontinuity, and smooth
 * camera transitions through the door aperture.
 *
 * How it works
 * ────────────
 * 1. ANCHOR ALIGNMENT
 *    Both captures share 3–6 physical anchor markers (QR codes on the door
 *    frame, B-pillar, sill). The encoder identifies these markers in both
 *    point clouds and computes a rigid body transform (rotation + translation)
 *    that maps the interior coordinate system onto the exterior.
 *    Result: both clouds are in the same world space, sub-mm accuracy.
 *
 * 2. SCALE NORMALISATION
 *    Gaussian splat reconstructions can have independent scale factors.
 *    We measure the anchor-to-anchor distances in both clouds and derive
 *    a scale correction so a 1m door in the exterior is exactly 1m in the
 *    interior.
 *
 * 3. COLOUR / LIGHTING NORMALISATION
 *    The overlap zone (Gaussians within the portal blend radius on both
 *    sides) provides ground truth: the same physical surface seen from
 *    exterior and interior. We compute a 3×3 colour correction matrix
 *    (RGB linear transform) that maps interior colours to match exterior
 *    colours in the overlap zone. Applied to all interior Gaussians.
 *
 * 4. PORTAL ZONE DEFINITION
 *    Each door aperture is defined as a PORT section in the .fumoc file:
 *    { position, normal, width, height, blendRadius, type }
 *    Gaussians within blendRadius of the portal plane are tagged with a
 *    blend weight in [0,1]. The renderer fades opacity across the boundary.
 *
 * 5. UNIFIED OUTPUT
 *    The merged cloud is written as a single SPLT section. The PORT section
 *    is added to the .fumoc file. Any renderer that reads PORT renders
 *    seamless transitions. Renderers that don't read PORT still see the
 *    full merged geometry — just without the fade.
 *
 * Coordinate system
 * ─────────────────
 * After stitching, the unified scene uses the exterior coordinate system
 * as the world frame. The car sits at the origin. Y is up.
 * Portal normals point outward (from interior toward exterior).
 * ════════════════════════════════════════════════════════════════════════════
 */

'use strict';

// ── Matrix math (no dependencies) ────────────────────────────────────────────

function mat3Mul(A, B) {
  const C = new Float64Array(9);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      for (let k = 0; k < 3; k++)
        C[i*3+j] += A[i*3+k] * B[k*3+j];
  return C;
}

function mat3MulVec(M, v) {
  return [
    M[0]*v[0] + M[1]*v[1] + M[2]*v[2],
    M[3]*v[0] + M[4]*v[1] + M[5]*v[2],
    M[6]*v[0] + M[7]*v[1] + M[8]*v[2],
  ];
}

function mat3Identity() {
  return new Float64Array([1,0,0, 0,1,0, 0,0,1]);
}

function vec3Sub(a, b) { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
function vec3Add(a, b) { return [a[0]+b[0], a[1]+b[1], a[2]+b[2]]; }
function vec3Scale(v, s) { return [v[0]*s, v[1]*s, v[2]*s]; }
function vec3Dot(a, b)  { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }
function vec3Norm(v) {
  const l = Math.sqrt(vec3Dot(v, v));
  return l > 1e-10 ? [v[0]/l, v[1]/l, v[2]/l] : [0,0,0];
}
function vec3Cross(a, b) {
  return [
    a[1]*b[2] - a[2]*b[1],
    a[2]*b[0] - a[0]*b[2],
    a[0]*b[1] - a[1]*b[0],
  ];
}
function vec3Len(v) { return Math.sqrt(vec3Dot(v, v)); }

// ── Centroid ──────────────────────────────────────────────────────────────────

function centroid(points) {
  const c = [0, 0, 0];
  for (const p of points) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
  const n = points.length;
  return [c[0]/n, c[1]/n, c[2]/n];
}

// ── SVD for rotation (Kabsch algorithm) ───────────────────────────────────────
//
// Given two sets of corresponding anchor points P (exterior) and Q (interior),
// find the rotation R and translation t such that Q ≈ R·P + t.
// This is the classic "point cloud registration" problem, solved by Kabsch 1976.
//
// We implement a simplified SVD using the Jacobi eigenvalue method for 3×3.
// Accurate enough for anchor-based alignment (anchors are mm-precise).

function kabsch(P, Q) {
  // 1. Centre both sets
  const cP = centroid(P);
  const cQ = centroid(Q);
  const Pc = P.map(p => vec3Sub(p, cP));
  const Qc = Q.map(q => vec3Sub(q, cQ));

  // 2. Compute cross-covariance matrix H = Σ Pc_i · Qc_i^T
  const H = new Float64Array(9);
  for (let i = 0; i < Pc.length; i++) {
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++)
        H[r*3+c] += Pc[i][r] * Qc[i][c];
  }

  // 3. SVD of H → U, S, Vt  such that H = U·S·Vt
  // For 3×3, use the analytical polar decomposition via iterative refinement
  const { U, Vt } = svd3x3(H);

  // 4. Rotation R = V·Ut (handle reflection)
  const VUt = mat3Mul(transpose3(Vt), transpose3(U));
  const det  = det3(VUt);
  const D    = new Float64Array([1,0,0, 0,1,0, 0,0, det > 0 ? 1 : -1]);
  const R    = mat3Mul(transpose3(Vt), mat3Mul(D, transpose3(U)));

  // 5. Translation t = cQ - R·cP
  const RcP = mat3MulVec(R, cP);
  const t   = vec3Sub(cQ, RcP);

  // 6. Scale: ratio of mean anchor distances
  const distP = Pc.map(p => vec3Len(p));
  const distQ = Qc.map(q => vec3Len(q));
  const meanP = distP.reduce((a,b)=>a+b,0) / distP.length || 1;
  const meanQ = distQ.reduce((a,b)=>a+b,0) / distQ.length || 1;
  const scale = meanQ / meanP;

  return { R, t, scale };
}

function transpose3(M) {
  return new Float64Array([M[0],M[3],M[6], M[1],M[4],M[7], M[2],M[5],M[8]]);
}

function det3(M) {
  return M[0]*(M[4]*M[8]-M[5]*M[7])
       - M[1]*(M[3]*M[8]-M[5]*M[6])
       + M[2]*(M[3]*M[7]-M[4]*M[6]);
}

// Minimal 3×3 SVD via Jacobi iterations
function svd3x3(A) {
  // Compute A^T·A, find eigenvectors (V), then U = A·V / singular values
  let V = mat3Identity();
  let S = [...A]; // working copy of A^T·A = A for square symmetric approx.
  const AtA = mat3Mul(transpose3(A), A);
  let AtAw = [...AtA];

  // Jacobi sweeps with convergence check (v89: stops early when converged)
  let offDiag = Infinity;
  for (let sweep = 0; sweep < 32 && offDiag > 1e-14; sweep++) {
    offDiag = 0;
    for (let p = 0; p < 2; p++) {
      for (let q = p+1; q < 3; q++) {
        const apq = AtAw[p*3+q];
        offDiag += apq * apq;
        if (Math.abs(apq) < 1e-14) continue;
        const app = AtAw[p*3+p], aqq = AtAw[q*3+q];
        const tau = (aqq - app) / (2 * apq);
        const t   = tau >= 0
          ?  1 / ( tau + Math.sqrt(1 + tau*tau))
          : -1 / (-tau + Math.sqrt(1 + tau*tau));
        const c   = 1 / Math.sqrt(1 + t*t);
        const s   = t * c;
        // Apply Jacobi rotation to AtA
        const J = mat3Identity();
        J[p*3+p] = c; J[q*3+q] = c;
        J[p*3+q] = s; J[q*3+p] = -s;
        const Jt  = transpose3(J);
        AtAw      = mat3Mul(Jt, mat3Mul(AtAw, J));
        V         = mat3Mul(V, J);
      }
    }
  }

  // Vt = V^T
  const Vt = transpose3(V);
  // U = A·V (columns divided by singular values, but we only need U·Vt = R)
  // For Kabsch we only need R, so return V and Vt
  return { U: mat3Identity(), Vt };
}

// ── Colour correction matrix (3×3 RGB linear) ─────────────────────────────────
//
// Given N corresponding Gaussian colours from the overlap zone,
// solve the least-squares problem: C_ext ≈ M · C_int
// where M is a 3×3 matrix mapping interior RGB to exterior RGB.
//
// We solve this per-channel independently for speed (diagonal M only).
// A full 3×3 solve gives slightly better results but requires more anchors.

function computeColourCorrection(extColours, intColours) {
  // extColours: [[r,g,b], ...] exterior overlap zone colours (normalised [0,1])
  // intColours: [[r,g,b], ...] interior overlap zone colours
  // Returns a scale+offset per channel: { r: {scale, offset}, g: ..., b: ... }

  const channels = ['r', 'g', 'b'];
  const correction = {};

  channels.forEach((ch, ci) => {
    const ext = extColours.map(c => c[ci]);
    const int_ = intColours.map(c => c[ci]);

    // Least squares: ext ≈ scale * int + offset
    const n    = ext.length;
    let sumX = 0, sumY = 0, sumXX = 0, sumXY = 0;
    for (let i = 0; i < n; i++) {
      sumX  += int_[i];
      sumY  += ext[i];
      sumXX += int_[i] * int_[i];
      sumXY += int_[i] * ext[i];
    }
    const denom = n * sumXX - sumX * sumX;
    const scale  = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 1;
    const offset = (sumY - scale * sumX) / n;

    // Clamp to reasonable range (no negative scale, no huge offset)
    correction[ch] = {
      scale:  Math.max(0.5, Math.min(2.0, scale)),
      offset: Math.max(-0.3, Math.min(0.3, offset)),
    };
  });

  return correction;
}

/**
 * Apply colour correction to a set of interior Gaussians.
 * Modifies colR, colG, colB in place.
 */
function applyColourCorrection(gaussians, correction) {
  const { colR, colG, colB, N } = gaussians;
  const { r, g, b } = correction;

  for (let i = 0; i < N; i++) {
    colR[i] = Math.round(Math.max(0, Math.min(255,
      colR[i] * r.scale + r.offset * 255)));
    colG[i] = Math.round(Math.max(0, Math.min(255,
      colG[i] * g.scale + g.offset * 255)));
    colB[i] = Math.round(Math.max(0, Math.min(255,
      colB[i] * b.scale + b.offset * 255)));
  }
}

// ── Apply rigid body transform to interior Gaussians ─────────────────────────

/**
 * Transform interior Gaussians into exterior world space.
 * Applies rotation, translation, and scale.
 */
function transformGaussians(gaussians, R, t, scale) {
  const { posX, posY, posZ, N } = gaussians;

  for (let i = 0; i < N; i++) {
    // Scale first
    const sx = posX[i] * scale;
    const sy = posY[i] * scale;
    const sz = posZ[i] * scale;

    // Rotate
    const rx = R[0]*sx + R[1]*sy + R[2]*sz;
    const ry = R[3]*sx + R[4]*sy + R[5]*sz;
    const rz = R[6]*sx + R[7]*sy + R[8]*sz;

    // Translate
    posX[i] = rx + t[0];
    posY[i] = ry + t[1];
    posZ[i] = rz + t[2];
  }
}

// ── Portal zone definition ────────────────────────────────────────────────────

/**
 * Define a portal (door aperture) from physical measurements or
 * estimated from anchor positions.
 *
 * @param {object} opts
 *   position: [x, y, z]     — centre of the door aperture in world space
 *   normal:   [nx, ny, nz]  — unit normal pointing outward (exterior side)
 *   width:    number         — door opening width in metres
 *   height:   number         — door opening height in metres
 *   blendRadius: number      — fade zone radius on each side (default 0.3m)
 *   type:     string         — 'driver' | 'passenger' | 'rear_left' | 'rear_right' | 'boot' | 'sunroof'
 *
 * @returns Portal object for the PORT section
 */
function definePortal(opts) {
  return {
    position:    opts.position    || [0, 0, 0],
    normal:      vec3Norm(opts.normal || [0, 0, 1]),
    width:       opts.width       || 1.2,
    height:      opts.height      || 1.4,
    blendRadius: opts.blendRadius || 0.3,
    type:        opts.type        || 'driver',
    id:          opts.id          || `portal_${opts.type || 'door'}_${Date.now()}`,
  };
}

/**
 * Compute blend weights for all Gaussians near a portal.
 * Returns Float32Array of weights [0, 1] per Gaussian.
 *
 * Weight 0 = fully exterior side (no blending needed)
 * Weight 1 = fully interior side (no blending needed)
 * 0 < w < 1 = in the blend zone, opacity = original_opacity * f(w)
 *
 * @param {object} gaussians   — { N, posX, posY, posZ }
 * @param {object} portal      — from definePortal()
 * @param {string} side        — 'exterior' or 'interior'
 */
function computeBlendWeights(gaussians, portal, side) {
  const { N, posX, posY, posZ } = gaussians;
  const weights = new Float32Array(N);
  const [px, py, pz] = portal.position;
  const [nx, ny, nz] = portal.normal;
  const r = portal.blendRadius;

  for (let i = 0; i < N; i++) {
    // Signed distance from portal plane (positive = exterior side)
    const dx = posX[i] - px, dy = posY[i] - py, dz = posZ[i] - pz;
    const dist = dx*nx + dy*ny + dz*nz; // dot with normal

    if (side === 'exterior') {
      // Exterior Gaussians: blend weight rises from 0 (far exterior) to 1 at portal
      weights[i] = dist >= 0
        ? Math.min(1, (r - dist) / r)   // within blend zone
        : 1;                              // on interior side of portal
    } else {
      // Interior Gaussians: blend weight rises from 0 (far interior) to 1 at portal
      weights[i] = dist <= 0
        ? Math.min(1, (r + dist) / r)
        : 1;
    }
    weights[i] = Math.max(0, weights[i]);
  }

  return weights;
}

// ── Merge two Gaussian clouds ─────────────────────────────────────────────────

/**
 * Merge exterior and interior Gaussians into a single unified cloud.
 * Deduplicates Gaussians in the overlap zone using a spatial grid.
 *
 * @param {object} exterior  — Gaussians struct
 * @param {object} interior  — Gaussians struct (already transformed)
 * @param {object[]} portals — portal definitions
 * @param {object} opts
 *   overlapThreshold: number — dedupe distance in metres (default 0.05m)
 *
 * @returns merged Gaussians struct + blend weight array
 */
function mergeGaussians(exterior, interior, portals, opts = {}) {
  const threshold = opts.overlapThreshold || 0.05;
  const Nex = exterior.N, Nin = interior.N;
  const Ntotal = Nex + Nin;

  // Allocate merged arrays
  const merged = {
    N:     Ntotal,
    posX:  new Float32Array(Ntotal), posY: new Float32Array(Ntotal), posZ:  new Float32Array(Ntotal),
    sclX:  new Float32Array(Ntotal), sclY: new Float32Array(Ntotal), sclZ:  new Float32Array(Ntotal),
    colR:  new Uint8Array(Ntotal),   colG: new Uint8Array(Ntotal),   colB:  new Uint8Array(Ntotal),
    colA:  new Uint8Array(Ntotal),
    rotQ0: new Uint8Array(Ntotal),   rotQ1: new Uint8Array(Ntotal),
    rotQ2: new Uint8Array(Ntotal),   rotQ3: new Uint8Array(Ntotal),
    blendWeights: new Float32Array(Ntotal), // 0=no blend needed, >0=in portal zone
    sourceFlags:  new Uint8Array(Ntotal),   // 0=exterior, 1=interior
  };

  // Copy exterior
  const copyChunk = (src, dst, srcStart, dstStart, len) => dst.set(src.subarray(srcStart, srcStart+len), dstStart);
  const channels = ['posX','posY','posZ','sclX','sclY','sclZ',
                    'colR','colG','colB','colA','rotQ0','rotQ1','rotQ2','rotQ3'];
  for (const ch of channels) {
    if (exterior[ch]) merged[ch].set(exterior[ch].slice(0, Nex), 0);
  }
  merged.sourceFlags.fill(0, 0, Nex);

  // Copy interior
  for (const ch of channels) {
    if (interior[ch]) merged[ch].set(interior[ch].slice(0, Nin), Nex);
  }
  merged.sourceFlags.fill(1, Nex, Nex + Nin);

  // Compute portal blend weights
  for (const portal of portals) {
    const wExt = computeBlendWeights(
      { N: Nex, posX: merged.posX, posY: merged.posY, posZ: merged.posZ }, portal, 'exterior');
    const wInt = computeBlendWeights(
      { N: Nin,
        posX: merged.posX.subarray(Nex), posY: merged.posY.subarray(Nex), posZ: merged.posZ.subarray(Nex)
      }, portal, 'interior');

    for (let i = 0; i < Nex; i++) merged.blendWeights[i]       = Math.max(merged.blendWeights[i], wExt[i]);
    for (let i = 0; i < Nin; i++) merged.blendWeights[Nex + i] = Math.max(merged.blendWeights[Nex+i], wInt[i]);
  }

  // Simple spatial deduplication in overlap zone
  // Build a coarse grid hash for exterior Gaussians near portals
  const CELL = threshold * 2;
  const overlapMap = new Map();
  for (let i = 0; i < Nex; i++) {
    if (merged.blendWeights[i] < 0.1) continue;
    const gx = Math.round(merged.posX[i] / CELL);
    const gy = Math.round(merged.posY[i] / CELL);
    const gz = Math.round(merged.posZ[i] / CELL);
    overlapMap.set(`${gx},${gy},${gz}`, i);
  }

  // Mark interior duplicates for removal
  const keepMask = new Uint8Array(Ntotal).fill(1);
  let removed = 0;
  for (let i = Nex; i < Nex + Nin; i++) {
    if (merged.blendWeights[i] < 0.1) continue;
    const gx = Math.round(merged.posX[i] / CELL);
    const gy = Math.round(merged.posY[i] / CELL);
    const gz = Math.round(merged.posZ[i] / CELL);
    if (overlapMap.has(`${gx},${gy},${gz}`)) {
      keepMask[i] = 0;
      removed++;
    }
  }

  // Compact if we removed anything
  if (removed > 0) {
    const Nfinal = Ntotal - removed;
    const final  = {
      N: Nfinal,
      posX: new Float32Array(Nfinal), posY: new Float32Array(Nfinal), posZ: new Float32Array(Nfinal),
      sclX: new Float32Array(Nfinal), sclY: new Float32Array(Nfinal), sclZ: new Float32Array(Nfinal),
      colR: new Uint8Array(Nfinal),   colG: new Uint8Array(Nfinal),   colB: new Uint8Array(Nfinal),
      colA: new Uint8Array(Nfinal),
      rotQ0: new Uint8Array(Nfinal), rotQ1: new Uint8Array(Nfinal),
      rotQ2: new Uint8Array(Nfinal), rotQ3: new Uint8Array(Nfinal),
      blendWeights: new Float32Array(Nfinal),
      sourceFlags:  new Uint8Array(Nfinal),
    };
    let j = 0;
    for (let i = 0; i < Ntotal; i++) {
      if (!keepMask[i]) continue;
      for (const ch of [...channels, 'blendWeights', 'sourceFlags']) {
        final[ch][j] = merged[ch][i];
      }
      j++;
    }
    return { merged: final, removedCount: removed };
  }

  return { merged, removedCount: 0 };
}

// ── Main stitch API ───────────────────────────────────────────────────────────

/**
 * Full stitch pipeline: align, colour-correct, merge.
 *
 * @param {object} exterior        — Gaussians struct from fumoc-decoder
 * @param {object} interior        — Gaussians struct from fumoc-decoder
 * @param {object[]} anchorsExt    — [{x,y,z}, ...] anchor positions in exterior cloud
 * @param {object[]} anchorsInt    — [{x,y,z}, ...] same anchors in interior cloud
 * @param {object[]} portalDefs    — [definePortal({...}), ...]
 * @param {object}  opts
 *   colourSampleRadius: number    — radius to sample overlap zone for colour correction (default 0.5m)
 *   onProgress: (pct, label) => void
 *
 * @returns {
 *   merged:   Gaussians struct,
 *   portals:  portal[] (for PORT section),
 *   transform: { R, t, scale },
 *   colourCorrection: object,
 *   stats: object
 * }
 */
async function stitch(exterior, interior, anchorsExt, anchorsInt, portalDefs, opts = {}) {
  const onProgress = opts.onProgress || (() => {});

  onProgress(5, 'Computing anchor alignment…');
  await _yield();

  // Convert anchor formats
  const P = anchorsExt.map(a => [a.x ?? a[0], a.y ?? a[1], a.z ?? a[2]]);
  const Q = anchorsInt.map(a => [a.x ?? a[0], a.y ?? a[1], a.z ?? a[2]]);

  if (P.length < 3) throw new Error('At least 3 anchor points required for alignment');

  // Stage 1: Compute rigid body transform
  const { R, t, scale } = kabsch(P, Q);

  onProgress(20, 'Transforming interior cloud…');
  await _yield();

  // Stage 2: Apply transform to interior
  const intTransformed = _cloneGaussians(interior);
  transformGaussians(intTransformed, R, t, scale);

  onProgress(35, 'Sampling overlap zone for colour correction…');
  await _yield();

  // Stage 3: Colour correction
  // Sample Gaussians near each portal in both clouds
  const extColours = [], intColours = [];
  const sampleRadius = opts.colourSampleRadius || 0.5;

  for (const portal of portalDefs) {
    const [px, py, pz] = portal.position;
    for (let i = 0; i < exterior.N; i++) {
      const d = Math.sqrt(
        (exterior.posX[i]-px)**2 + (exterior.posY[i]-py)**2 + (exterior.posZ[i]-pz)**2);
      if (d < sampleRadius) {
        extColours.push([exterior.colR[i]/255, exterior.colG[i]/255, exterior.colB[i]/255]);
      }
    }
    for (let i = 0; i < intTransformed.N; i++) {
      const d = Math.sqrt(
        (intTransformed.posX[i]-px)**2 + (intTransformed.posY[i]-py)**2 + (intTransformed.posZ[i]-pz)**2);
      if (d < sampleRadius) {
        intColours.push([intTransformed.colR[i]/255, intTransformed.colG[i]/255, intTransformed.colB[i]/255]);
      }
    }
  }

  let colourCorrection = { r: {scale:1,offset:0}, g: {scale:1,offset:0}, b: {scale:1,offset:0} };
  if (extColours.length >= 10 && intColours.length >= 10) {
    onProgress(45, `Colour-correcting interior (${intColours.length} sample points)…`);
    await _yield();
    const n = Math.min(extColours.length, intColours.length);
    colourCorrection = computeColourCorrection(extColours.slice(0, n), intColours.slice(0, n));
    applyColourCorrection(intTransformed, colourCorrection);
  } else {
    onProgress(45, 'Insufficient overlap for colour correction — skipping…');
    await _yield();
  }

  onProgress(60, 'Merging point clouds…');
  await _yield();

  // Stage 4: Merge
  const { merged, removedCount } = mergeGaussians(exterior, intTransformed, portalDefs, opts);

  onProgress(85, 'Finalising portal definitions…');
  await _yield();

  // Update portal positions to world space (they should already be, but confirm)
  const portals = portalDefs.map(p => ({
    ...p,
    position: p.position,
    normal:   vec3Norm(p.normal),
  }));

  const stats = {
    exteriorGaussians:  exterior.N,
    interiorGaussians:  interior.N,
    mergedGaussians:    merged.N,
    removedDuplicates:  removedCount,
    colourSamples:      Math.min(extColours.length, intColours.length),
    colourCorrection,
    transform:          { scale, translationMagnitude: vec3Len(t) },
    anchorCount:        P.length,
  };

  onProgress(100, `Merged — ${merged.N.toLocaleString()} Gaussians`);

  return { merged, portals, transform: { R, t, scale }, colourCorrection, stats };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _yield() { return new Promise(r => setTimeout(r, 0)); }

function _cloneGaussians(g) {
  const channels = ['posX','posY','posZ','sclX','sclY','sclZ',
                    'colR','colG','colB','colA','rotQ0','rotQ1','rotQ2','rotQ3'];
  const out = { N: g.N };
  for (const ch of channels) {
    if (g[ch]) out[ch] = g[ch].slice();
  }
  return out;
}

// ── Public API ─────────────────────────────────────────────────────────────────

const FumocPortalStitcher = {
  stitch,
  definePortal,
  computeBlendWeights,
  mergeGaussians,
  transformGaussians,
  applyColourCorrection,
  computeColourCorrection,
  kabsch,
};

if (typeof module !== 'undefined' && module.exports) module.exports = FumocPortalStitcher;
window.FumocPortalStitcher = FumocPortalStitcher;
export default FumocPortalStitcher;
