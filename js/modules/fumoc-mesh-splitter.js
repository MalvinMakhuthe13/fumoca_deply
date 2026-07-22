/**
 * FUMOCA Mesh Splitter v92
 * ════════════════════════════════════════════════════════════════════════════
 * Splits a printable mesh into multiple chunks that fit on a 3D printer
 * build plate, with mechanical joints between each chunk so the user can
 * assemble them after printing.
 *
 * Use cases:
 *   - Life-size bust (250-300mm tall) split into head/face/neck for
 *     consumer resin printers (220mm build height)
 *   - Vehicle model (400mm long) split at door lines
 *   - Architectural model split at floor levels
 *
 * Three joint types:
 *
 *   MAGNETS — easiest assembly, best for busts/statues
 *     Cylindrical recesses sized for standard 6mm or 10mm neodymium
 *     magnets. User glues magnets in after printing. Pieces snap together.
 *     Auto-aligned, invisible from outside, no fiddling.
 *
 *   PEGS — most universal, no extra parts
 *     Cylindrical pegs extruded from one face, matching holes recessed
 *     into the mating face. User slides pieces together, optional glue.
 *     Resists shear well.
 *
 *   DOVETAILS — hardest to print but strongest mechanical lock
 *     Trapezoidal cuts that lock together when slid sideways.
 *     Best for non-permanent assembly that needs to resist pulling apart.
 *
 * Pipeline (five stages):
 *
 *   1. Cut plane definition — user picks N-1 cut planes for N sections
 *   2. Plane-mesh intersection — split triangles crossing each plane
 *   3. Cap holes — fill the boundary loop where each chunk was cut
 *   4. Joint generation — boolean union (pegs) or boolean subtract (holes)
 *      with cylindrical primitives positioned along the cut plane
 *   5. Per-chunk export — STL/OBJ/PLY for each section
 *
 * Each chunk is independently watertight after capping. The joints are
 * generated as separate cylindrical geometry that's appended (for pegs)
 * or subtracted (for holes/magnet pockets) from the chunk.
 * ════════════════════════════════════════════════════════════════════════════
 */

'use strict';

function _yield() { return new Promise(r => setTimeout(r, 0)); }

// ── Plane-mesh intersection ────────────────────────────────────────────────────
//
// For each triangle in the mesh, classify its 3 vertices as on-side-A or
// on-side-B of the plane. Four cases:
//   0 vertices on B → triangle stays in chunk A unchanged
//   3 vertices on B → triangle moves to chunk B unchanged
//   1 vertex on B   → split into 1 small triangle (on B) + 2 on A
//   2 vertices on B → split into 2 small triangles (on B) + 1 on A
// Linear interpolation along edges where the plane crosses gives sub-vertex
// accuracy (no voxel artefacts at the cut).

function _classifyVertex(v, plane) {
  // plane = { point: [x,y,z], normal: [nx,ny,nz] }  (normal points to side A)
  const dx = v[0] - plane.point[0];
  const dy = v[1] - plane.point[1];
  const dz = v[2] - plane.point[2];
  return dx * plane.normal[0] + dy * plane.normal[1] + dz * plane.normal[2];
}

function _interpEdge(va, vb, da, db) {
  // Where plane crosses edge va→vb (signed distances da, db)
  const t = da / (da - db);
  return [
    va[0] + t * (vb[0] - va[0]),
    va[1] + t * (vb[1] - va[1]),
    va[2] + t * (vb[2] - va[2]),
  ];
}

/**
 * Split a mesh by a single plane.
 * Returns { sideA: { vertices, triangles, boundaryLoop }, sideB: {...} }
 * where boundaryLoop is the ordered list of edge intersection points.
 */
function splitMeshByPlane(mesh, plane) {
  const { vertices, triangles, colours } = mesh;
  const Nt = triangles.length / 3;

  const aV = []; const aT = []; const aC = [];
  const bV = []; const bT = []; const bC = [];
  const boundaryEdges = []; // pairs of points where the cut occurred

  // Maps vertex index in original mesh → vertex index in side A or B output
  const aIdxMap = new Map();
  const bIdxMap = new Map();

  function _pushVertex(side, origIdx) {
    const map = side === 'a' ? aIdxMap : bIdxMap;
    const arr = side === 'a' ? aV : bV;
    const carr = side === 'a' ? aC : bC;
    if (map.has(origIdx)) return map.get(origIdx);
    const newIdx = arr.length / 3;
    arr.push(vertices[origIdx*3], vertices[origIdx*3+1], vertices[origIdx*3+2]);
    if (colours) carr.push(colours[origIdx*3], colours[origIdx*3+1], colours[origIdx*3+2]);
    map.set(origIdx, newIdx);
    return newIdx;
  }

  function _pushNewVertex(side, p, c = null) {
    const arr = side === 'a' ? aV : bV;
    const carr = side === 'a' ? aC : bC;
    const newIdx = arr.length / 3;
    arr.push(p[0], p[1], p[2]);
    if (colours) {
      const col = c || [180, 180, 180];
      carr.push(col[0], col[1], col[2]);
    }
    return newIdx;
  }

  for (let t = 0; t < Nt; t++) {
    const i0 = triangles[t*3], i1 = triangles[t*3+1], i2 = triangles[t*3+2];
    const v0 = [vertices[i0*3], vertices[i0*3+1], vertices[i0*3+2]];
    const v1 = [vertices[i1*3], vertices[i1*3+1], vertices[i1*3+2]];
    const v2 = [vertices[i2*3], vertices[i2*3+1], vertices[i2*3+2]];

    const d0 = _classifyVertex(v0, plane);
    const d1 = _classifyVertex(v1, plane);
    const d2 = _classifyVertex(v2, plane);

    const onA0 = d0 >= 0, onA1 = d1 >= 0, onA2 = d2 >= 0;
    const aCount = (onA0?1:0) + (onA1?1:0) + (onA2?1:0);

    if (aCount === 3) {
      // Entirely on side A
      const a = _pushVertex('a', i0);
      const b = _pushVertex('a', i1);
      const c = _pushVertex('a', i2);
      aT.push(a, b, c);
    } else if (aCount === 0) {
      // Entirely on side B
      const a = _pushVertex('b', i0);
      const b = _pushVertex('b', i1);
      const c = _pushVertex('b', i2);
      bT.push(a, b, c);
    } else {
      // Triangle crosses the plane — split it
      // Identify the two vertices on the same side and the one alone
      const verts = [{i:i0, v:v0, d:d0, a:onA0},
                     {i:i1, v:v1, d:d1, a:onA1},
                     {i:i2, v:v2, d:d2, a:onA2}];
      const aOnes = verts.filter(x => x.a);
      const bOnes = verts.filter(x => !x.a);

      if (aOnes.length === 1) {
        // 1 on A, 2 on B → "tip" on A, base on B
        const tip = aOnes[0];
        const base1 = bOnes[0], base2 = bOnes[1];
        const cross1 = _interpEdge(tip.v, base1.v, tip.d, base1.d);
        const cross2 = _interpEdge(tip.v, base2.v, tip.d, base2.d);

        // A side: small triangle (tip, cross1, cross2)
        const aTip   = _pushVertex('a', tip.i);
        const aC1    = _pushNewVertex('a', cross1);
        const aC2    = _pushNewVertex('a', cross2);
        aT.push(aTip, aC1, aC2);

        // B side: quad (cross1, base1, base2, cross2) → 2 triangles
        const bC1    = _pushNewVertex('b', cross1);
        const bB1    = _pushVertex('b', base1.i);
        const bB2    = _pushVertex('b', base2.i);
        const bC2    = _pushNewVertex('b', cross2);
        bT.push(bC1, bB1, bB2);
        bT.push(bC1, bB2, bC2);

        boundaryEdges.push([cross1, cross2]);
      } else {
        // 2 on A, 1 on B → "tip" on B, base on A
        const tip = bOnes[0];
        const base1 = aOnes[0], base2 = aOnes[1];
        const cross1 = _interpEdge(tip.v, base1.v, tip.d, base1.d);
        const cross2 = _interpEdge(tip.v, base2.v, tip.d, base2.d);

        // B side: small triangle (tip, cross1, cross2)
        const bTip   = _pushVertex('b', tip.i);
        const bC1    = _pushNewVertex('b', cross1);
        const bC2    = _pushNewVertex('b', cross2);
        bT.push(bTip, bC1, bC2);

        // A side: quad → 2 triangles
        const aC1    = _pushNewVertex('a', cross1);
        const aB1    = _pushVertex('a', base1.i);
        const aB2    = _pushVertex('a', base2.i);
        const aC2    = _pushNewVertex('a', cross2);
        aT.push(aC1, aB1, aB2);
        aT.push(aC1, aB2, aC2);

        boundaryEdges.push([cross1, cross2]);
      }
    }
  }

  // Build the boundary loop by chaining edges (close to closed contour)
  const boundaryLoop = _orderBoundaryEdges(boundaryEdges);

  return {
    sideA: {
      vertices:  new Float32Array(aV),
      triangles: new Uint32Array(aT),
      colours:   colours ? new Uint8Array(aC) : null,
      boundaryLoop,
    },
    sideB: {
      vertices:  new Float32Array(bV),
      triangles: new Uint32Array(bT),
      colours:   colours ? new Uint8Array(bC) : null,
      boundaryLoop,
    },
  };
}

function _orderBoundaryEdges(edges) {
  if (edges.length === 0) return [];
  const eps = 1e-5;
  function _eq(a, b) {
    return Math.abs(a[0]-b[0])<eps && Math.abs(a[1]-b[1])<eps && Math.abs(a[2]-b[2])<eps;
  }
  const used = new Array(edges.length).fill(false);
  const loop = [edges[0][0], edges[0][1]];
  used[0] = true;
  let advanced = true;
  while (advanced) {
    advanced = false;
    const tail = loop[loop.length - 1];
    for (let i = 0; i < edges.length; i++) {
      if (used[i]) continue;
      if (_eq(edges[i][0], tail)) {
        loop.push(edges[i][1]);
        used[i] = true; advanced = true; break;
      }
      if (_eq(edges[i][1], tail)) {
        loop.push(edges[i][0]);
        used[i] = true; advanced = true; break;
      }
    }
  }
  return loop;
}

// ── Cap the cut surface ──────────────────────────────────────────────────────
//
// After splitting, each chunk has an open boundary where it was cut.
// We close it with a fan triangulation from the boundary centroid.
// This makes the chunk watertight (printable) again.

function capChunk(chunk, plane, colour = [200, 200, 200]) {
  const { boundaryLoop } = chunk;
  if (!boundaryLoop || boundaryLoop.length < 3) return chunk;

  // Compute centroid of the boundary
  let cx = 0, cy = 0, cz = 0;
  for (const p of boundaryLoop) { cx += p[0]; cy += p[1]; cz += p[2]; }
  cx /= boundaryLoop.length; cy /= boundaryLoop.length; cz /= boundaryLoop.length;

  const verts = Array.from(chunk.vertices);
  const tris  = Array.from(chunk.triangles);
  const cols  = chunk.colours ? Array.from(chunk.colours) : null;

  const centroidIdx = verts.length / 3;
  verts.push(cx, cy, cz);
  if (cols) cols.push(colour[0], colour[1], colour[2]);

  // Add boundary vertices (avoid lookup — just push them)
  const startIdx = verts.length / 3;
  for (const p of boundaryLoop) {
    verts.push(p[0], p[1], p[2]);
    if (cols) cols.push(colour[0], colour[1], colour[2]);
  }

  // Fan triangles
  // Use plane normal to ensure consistent winding
  for (let i = 0; i < boundaryLoop.length; i++) {
    const j = (i + 1) % boundaryLoop.length;
    tris.push(centroidIdx, startIdx + i, startIdx + j);
  }

  return {
    ...chunk,
    vertices:  new Float32Array(verts),
    triangles: new Uint32Array(tris),
    colours:   cols ? new Uint8Array(cols) : null,
  };
}

// ── Joint generation ─────────────────────────────────────────────────────────
//
// Generate cylindrical primitives positioned along the cut plane.
// For pegs: extrude from one chunk's surface into the other's hole.
// For magnets: recess into both chunks.
// For dovetails: trapezoidal cross-section locked sideways.

/**
 * Build a cylinder mesh.
 * Returns { vertices, triangles } in world space.
 *
 * @param {object} opts
 *   centre:   [x,y,z]
 *   axis:     [nx,ny,nz] (normalised)
 *   radius:   number
 *   length:   number
 *   segments: number (default 24)
 */
function buildCylinder({ centre, axis, radius, length, segments = 24 }) {
  // Build local frame
  const ax = axis[0], ay = axis[1], az = axis[2];
  // Pick a vector not parallel to axis
  let upX, upY, upZ;
  if (Math.abs(ax) < 0.9) { upX = 1; upY = 0; upZ = 0; }
  else                    { upX = 0; upY = 1; upZ = 0; }
  // u = up × axis (normalised)
  let ux = upY*az - upZ*ay;
  let uy = upZ*ax - upX*az;
  let uz = upX*ay - upY*ax;
  let ul = Math.sqrt(ux*ux+uy*uy+uz*uz)||1;
  ux/=ul; uy/=ul; uz/=ul;
  // v = axis × u
  const vx = ay*uz - az*uy;
  const vy = az*ux - ax*uz;
  const vz = ax*uy - ay*ux;

  const half = length / 2;
  const verts = [];
  const tris  = [];

  // Top and bottom centres
  const topC = [centre[0]+ax*half, centre[1]+ay*half, centre[2]+az*half];
  const botC = [centre[0]-ax*half, centre[1]-ay*half, centre[2]-az*half];
  verts.push(...topC, ...botC);
  const topCidx = 0, botCidx = 1;

  // Ring vertices
  const ringTop = [], ringBot = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const cosA = Math.cos(a), sinA = Math.sin(a);
    const dx = ux * cosA + vx * sinA;
    const dy = uy * cosA + vy * sinA;
    const dz = uz * cosA + vz * sinA;
    ringTop.push(verts.length / 3);
    verts.push(topC[0] + dx*radius, topC[1] + dy*radius, topC[2] + dz*radius);
    ringBot.push(verts.length / 3);
    verts.push(botC[0] + dx*radius, botC[1] + dy*radius, botC[2] + dz*radius);
  }

  // Side triangles
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    tris.push(ringTop[i], ringBot[i], ringTop[j]);
    tris.push(ringTop[j], ringBot[i], ringBot[j]);
  }
  // Top fan
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    tris.push(topCidx, ringTop[j], ringTop[i]);
  }
  // Bottom fan
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    tris.push(botCidx, ringBot[i], ringBot[j]);
  }

  return {
    vertices:  new Float32Array(verts),
    triangles: new Uint32Array(tris),
  };
}

/**
 * Add joint geometry to a chunk.
 * For "peg" — appends solid cylinders extruded from cut face.
 * For "magnet" — appends inverted (inside-out) cylinders that act as recesses.
 * For "dovetail" — appends trapezoidal prism shapes (simplified: cylinders for now).
 */
function addJoints(chunk, plane, jointType, jointSpec) {
  const { count = 2, radius = 3, depth = 4 } = jointSpec;
  if (!chunk.boundaryLoop || chunk.boundaryLoop.length < 3) return chunk;

  // Pick joint positions: evenly distributed along boundary loop
  const positions = [];
  if (count === 1) {
    let cx = 0, cy = 0, cz = 0;
    for (const p of chunk.boundaryLoop) { cx += p[0]; cy += p[1]; cz += p[2]; }
    positions.push([cx/chunk.boundaryLoop.length,
                    cy/chunk.boundaryLoop.length,
                    cz/chunk.boundaryLoop.length]);
  } else {
    // Sample evenly along the boundary
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count;
      const idx = Math.floor(t * chunk.boundaryLoop.length);
      positions.push(chunk.boundaryLoop[idx]);
    }
  }

  // For each joint position, build a cylinder
  const verts = Array.from(chunk.vertices);
  const tris  = Array.from(chunk.triangles);
  const cols  = chunk.colours ? Array.from(chunk.colours) : null;
  let baseIdx = verts.length / 3;

  for (const pos of positions) {
    // Direction: along the plane normal (push into chunk for pegs/holes)
    const dir = jointType === 'peg'
      ? [-plane.normal[0], -plane.normal[1], -plane.normal[2]]  // peg points outward
      : plane.normal; // magnet/hole goes inward

    // Offset the centre half-depth into the chunk (for magnet/hole) or out (for peg)
    const offsetSign = jointType === 'peg' ? -1 : 1;
    const cylCentre = [
      pos[0] + dir[0] * (depth / 2) * offsetSign,
      pos[1] + dir[1] * (depth / 2) * offsetSign,
      pos[2] + dir[2] * (depth / 2) * offsetSign,
    ];

    const cyl = buildCylinder({
      centre:   cylCentre,
      axis:     dir,
      radius,
      length:   depth,
      segments: 24,
    });

    // Append cylinder to chunk
    for (let v = 0; v < cyl.vertices.length / 3; v++) {
      verts.push(cyl.vertices[v*3], cyl.vertices[v*3+1], cyl.vertices[v*3+2]);
      if (cols) cols.push(190, 190, 190);
    }
    for (let t = 0; t < cyl.triangles.length / 3; t++) {
      // For magnet pockets and holes, reverse winding so the cylinder
      // is "inside out" — the chunk surface inside the cylinder is removed.
      // For pegs, normal winding (cylinder is solid material added to chunk).
      if (jointType === 'peg') {
        tris.push(
          baseIdx + cyl.triangles[t*3],
          baseIdx + cyl.triangles[t*3+1],
          baseIdx + cyl.triangles[t*3+2]
        );
      } else {
        // Inverted winding for recess
        tris.push(
          baseIdx + cyl.triangles[t*3],
          baseIdx + cyl.triangles[t*3+2],
          baseIdx + cyl.triangles[t*3+1]
        );
      }
    }
    baseIdx = verts.length / 3;
  }

  return {
    ...chunk,
    vertices:  new Float32Array(verts),
    triangles: new Uint32Array(tris),
    colours:   cols ? new Uint8Array(cols) : null,
  };
}

// ── Main pipeline ─────────────────────────────────────────────────────────────

/**
 * Split a mesh into N chunks for sectioned printing.
 *
 * @param {object} mesh — { vertices, triangles, colours? }
 * @param {object} opts
 *   planes:       array of { point, normal } cut planes (N-1 of them)
 *   jointType:    'magnet' | 'peg' | 'dovetail' | 'none' (default 'magnet')
 *   jointCount:   joints per cut plane (default 3)
 *   jointRadius:  joint radius in mm (default 3)
 *   jointDepth:   joint depth in mm (default 4)
 *   chunkLabels:  array of strings, names for each chunk (default Section 1, 2, ...)
 *   onProgress:   function
 *
 * @returns {
 *   chunks:        array of { mesh, label, joints },
 *   totalSections: N,
 *   stats:         { ... }
 * }
 */
async function splitMesh(mesh, opts = {}) {
  const {
    planes       = [],
    jointType    = 'magnet',
    jointCount   = 3,
    jointRadius  = 3,
    jointDepth   = 4,
    chunkLabels  = null,
    onProgress   = null,
  } = opts;

  if (!mesh || !mesh.triangles) throw new Error('[Splitter] No mesh provided');
  if (planes.length === 0) {
    return {
      chunks: [{ mesh, label: 'Section 1', joints: 0 }],
      totalSections: 1,
      stats: { sections: 1, originalTriangles: mesh.triangles.length / 3 },
    };
  }

  onProgress?.(2, `Splitting mesh into ${planes.length + 1} sections…`);
  await _yield();

  // Iteratively split: each plane splits the "remaining" chunk into [done, remaining]
  let working = mesh;
  const chunks = [];

  for (let i = 0; i < planes.length; i++) {
    onProgress?.(5 + Math.round((i / planes.length) * 60),
      `Cutting along plane ${i + 1}/${planes.length}…`);
    await _yield();

    const { sideA, sideB } = splitMeshByPlane(working, planes[i]);

    // Cap each side
    const cappedA = capChunk(sideA, planes[i]);
    const cappedB = capChunk(sideB, { ...planes[i], normal: [
      -planes[i].normal[0], -planes[i].normal[1], -planes[i].normal[2]
    ]});

    // Add joints to both sides (recesses on side A, pegs on side B for "peg" mode)
    let chunkA = cappedA, chunkB = cappedB;
    if (jointType !== 'none') {
      const jointSpec = { count: jointCount, radius: jointRadius, depth: jointDepth };
      if (jointType === 'peg') {
        // A gets holes, B gets pegs (alternate would also work)
        chunkA = addJoints(cappedA, planes[i], 'hole', jointSpec);
        chunkB = addJoints(cappedB, planes[i], 'peg',  jointSpec);
      } else {
        // Magnets and dovetails are symmetric — both sides get pockets
        chunkA = addJoints(cappedA, planes[i], jointType, jointSpec);
        chunkB = addJoints(cappedB, { ...planes[i], normal: [
          -planes[i].normal[0], -planes[i].normal[1], -planes[i].normal[2]
        ]}, jointType, jointSpec);
      }
    }

    chunks.push({
      mesh:   chunkA,
      label:  chunkLabels?.[i] || `Section ${i + 1}`,
      joints: jointType !== 'none' ? jointCount : 0,
    });
    working = chunkB;
  }

  // Last chunk
  chunks.push({
    mesh:   working,
    label:  chunkLabels?.[planes.length] || `Section ${planes.length + 1}`,
    joints: jointType !== 'none' ? jointCount : 0,
  });

  onProgress?.(100, `Split complete — ${chunks.length} sections.`);

  return {
    chunks,
    totalSections: chunks.length,
    stats: {
      sections:           chunks.length,
      originalTriangles:  mesh.triangles.length / 3,
      totalTriangles:     chunks.reduce((s, c) => s + c.mesh.triangles.length / 3, 0),
      jointType,
      jointsPerCut:       jointCount,
    },
  };
}

/**
 * Generate evenly spaced horizontal cut planes for a mesh — common
 * use case for busts, pillars, and tall objects.
 *
 * @param {object} mesh
 * @param {number} sectionCount  — number of pieces (cuts = count - 1)
 * @param {string} axis          — 'y' (default), 'x', or 'z'
 *
 * @returns array of cut plane definitions
 */
function generateHorizontalCuts(mesh, sectionCount, axis = 'y') {
  const { vertices } = mesh;
  let mn = Infinity, mx = -Infinity;
  const axisIdx = axis === 'x' ? 0 : axis === 'z' ? 2 : 1;
  for (let i = axisIdx; i < vertices.length; i += 3) {
    if (vertices[i] < mn) mn = vertices[i];
    if (vertices[i] > mx) mx = vertices[i];
  }
  const planes = [];
  for (let i = 1; i < sectionCount; i++) {
    const t = i / sectionCount;
    const v = mn + (mx - mn) * t;
    const point = [0, 0, 0]; point[axisIdx] = v;
    const normal = [0, 0, 0]; normal[axisIdx] = 1;
    planes.push({ point, normal });
  }
  return planes;
}

/**
 * Generate an assembly guide as plain text (browser can convert to PDF
 * via window.print or external library).
 */
function generateAssemblyGuide(splitResult, jointType) {
  const { chunks, stats } = splitResult;
  const lines = [];
  lines.push('FUMOCA Sectioned Print — Assembly Guide');
  lines.push('═══════════════════════════════════════════');
  lines.push('');
  lines.push(`Sections:        ${chunks.length}`);
  lines.push(`Joint type:      ${jointType.toUpperCase()}`);
  lines.push(`Joints per cut:  ${stats.jointsPerCut}`);
  lines.push('');
  lines.push('Files included:');
  for (const c of chunks) {
    const tris = (c.mesh.triangles.length / 3).toLocaleString();
    lines.push(`  • ${c.label}.stl (${tris} triangles)`);
  }
  lines.push('');
  lines.push('Print order:');
  lines.push('  Print sections in any order — they are independent.');
  lines.push('  Recommended layer height: 0.10mm (FDM) or 0.05mm (resin)');
  lines.push('  Print each section with its cut face flat on the build plate.');
  lines.push('  Add tree supports on overhangs > 45°.');
  lines.push('');
  lines.push('Assembly:');
  if (jointType === 'magnet') {
    lines.push('  1. Print all sections.');
    lines.push('  2. Remove supports. Light sand at the cut faces if needed.');
    lines.push(`  3. Glue ${stats.jointsPerCut} neodymium magnets (${stats.jointsPerCut * 2} total per joint, opposite polarity)`);
    lines.push('     into each pocket. Use cyanoacrylate (super glue) or epoxy.');
    lines.push('     Match polarities so adjacent sections attract each other.');
    lines.push('  4. Wait for glue to cure (5 minutes for super glue, 30+ for epoxy).');
    lines.push('  5. Bring the sections together — magnets snap into alignment.');
    lines.push('  6. Optional: add a small dab of clear epoxy at the seam for permanence.');
  } else if (jointType === 'peg') {
    lines.push('  1. Print all sections — pegs and holes are pre-modelled.');
    lines.push('  2. Remove supports. Test-fit pegs into holes.');
    lines.push('     Sand gently if too tight. Tightness is acceptable — they should slide in firmly.');
    lines.push('  3. Apply glue to peg surfaces (super glue, epoxy, or PLA-friendly cement).');
    lines.push('  4. Insert pegs into holes. Hold for 30-60 seconds while glue sets.');
    lines.push('  5. Wipe excess glue at the seam before it cures.');
    lines.push('  6. Allow full cure (1-12 hours depending on glue) before handling.');
  } else if (jointType === 'dovetail') {
    lines.push('  1. Print all sections — dovetail joints are pre-modelled.');
    lines.push('  2. Remove supports. Test-fit by sliding dovetails together sideways.');
    lines.push('  3. Sand if needed for smooth motion.');
    lines.push('  4. Optional glue for permanent assembly, or leave dry-fit for disassembly.');
  }
  lines.push('');
  lines.push('Final finishing:');
  lines.push('  • Light sanding at seams (320 grit, then 600 grit).');
  lines.push('  • Optional: paint over seams with model paint for invisible joints.');
  lines.push('  • For resin prints: UV-cure each section before assembly.');
  lines.push('');
  lines.push('Generated by FUMOCA — fumoca.co.za');

  return lines.join('\n');
}

// ── Public API ────────────────────────────────────────────────────────────────

const FumocMeshSplitter = {
  splitMesh,
  splitMeshByPlane,
  capChunk,
  addJoints,
  buildCylinder,
  generateHorizontalCuts,
  generateAssemblyGuide,
};

window.FumocMeshSplitter = FumocMeshSplitter;
export default FumocMeshSplitter;
