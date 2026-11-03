/**
 * Cap only closed boundary loops that lie on a specified support plane.
 * Triangulation uses ear clipping in the plane, so concave bases are supported.
 * Existing geometry is never modified; a new mesh object is returned.
 */
function cross2(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}
function pointInTriangle(p, a, b, c, orientation, epsilon) {
  const c1 = cross2(a, b, p) * orientation;
  const c2 = cross2(b, c, p) * orientation;
  const c3 = cross2(c, a, p) * orientation;
  return c1 >= -epsilon && c2 >= -epsilon && c3 >= -epsilon;
}
function segmentsIntersect(a, b, c, d, epsilon = 1e-10) {
  const abC = cross2(a, b, c), abD = cross2(a, b, d);
  const cdA = cross2(c, d, a), cdB = cross2(c, d, b);
  return ((abC > epsilon && abD < -epsilon) || (abC < -epsilon && abD > epsilon))
    && ((cdA > epsilon && cdB < -epsilon) || (cdA < -epsilon && cdB > epsilon));
}
function isSimplePolygon(points, epsilon = 1e-10) {
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    for (let j = i + 1; j < points.length; j++) {
      if (j === i || j === (i + 1) % points.length || (j + 1) % points.length === i) continue;
      const c = points[j], d = points[(j + 1) % points.length];
      if (segmentsIntersect(a, b, c, d, epsilon)) return false;
    }
  }
  return true;
}
function triangulatePolygon(points, epsilon = 1e-10) {
  if (points.length < 3) return null;
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  area *= 0.5;
  if (!Number.isFinite(area) || Math.abs(area) <= epsilon) return null;
  const orientation = Math.sign(area);
  const remaining = points.map((_, index) => index);
  const triangles = [];
  let guard = points.length * points.length;
  while (remaining.length > 3 && guard-- > 0) {
    let earFound = false;
    for (let i = 0; i < remaining.length; i++) {
      const previous = remaining[(i - 1 + remaining.length) % remaining.length];
      const current = remaining[i];
      const next = remaining[(i + 1) % remaining.length];
      if (cross2(points[previous], points[current], points[next]) * orientation <= epsilon) continue;
      let containsVertex = false;
      for (const candidate of remaining) {
        if (candidate === previous || candidate === current || candidate === next) continue;
        if (pointInTriangle(points[candidate], points[previous], points[current], points[next], orientation, epsilon)) {
          containsVertex = true;
          break;
        }
      }
      if (containsVertex) continue;
      // The object occupies the +normal side; the cap's outward face points -normal.
      if (orientation > 0) triangles.push(previous, next, current);
      else triangles.push(previous, current, next);
      remaining.splice(i, 1);
      earFound = true;
      break;
    }
    if (!earFound) return null;
  }
  if (remaining.length !== 3) return null;
  if (orientation > 0) triangles.push(remaining[0], remaining[2], remaining[1]);
  else triangles.push(remaining[0], remaining[1], remaining[2]);
  return triangles;
}

export function capPlanarBoundaryLoops(mesh, { normal, offset, tolerance = 1e-4 } = {}) {
  if (!mesh?.vertices?.length || !mesh?.triangles?.length || mesh.vertices.length % 3 || mesh.triangles.length % 3) {
    throw new TypeError('a valid triangle mesh is required for planar capping');
  }
  for (const value of mesh.vertices) {
    if (!Number.isFinite(Number(value))) throw new Error('mesh vertices must be finite');
  }
  const vertexCount = mesh.vertices.length / 3;
  for (const index of mesh.triangles) {
    if (!Number.isInteger(Number(index)) || Number(index) < 0 || Number(index) >= vertexCount) {
      throw new RangeError('mesh face index is outside its vertex array');
    }
  }
  const n = Array.from(normal || [], Number);
  const d = Number(offset), tol = Number(tolerance);
  if (n.length !== 3 || !n.every(Number.isFinite) || !Number.isFinite(d) || !Number.isFinite(tol) || tol < 0) {
    throw new TypeError('cap plane and non-negative tolerance must be finite');
  }
  const length = Math.hypot(...n);
  if (length < 1e-8) throw new RangeError('cap plane normal is degenerate');
  for (let axis = 0; axis < 3; axis++) n[axis] /= length;
  let planeOffset = d / length;
  if (n[1] < 0) {
    for (let axis = 0; axis < 3; axis++) n[axis] *= -1;
    planeOffset *= -1;
  }

  const edgeCounts = new Map();
  const edgeKey = (a, b) => a < b ? a + ':' + b : b + ':' + a;
  const faces = mesh.triangles;
  for (let i = 0; i < faces.length; i += 3) {
    for (let e = 0; e < 3; e++) {
      const a = faces[i + e], b = faces[i + (e + 1) % 3];
      if (a >= mesh.vertices.length / 3 || b >= mesh.vertices.length / 3) throw new RangeError('mesh face index is outside its vertex array');
      const key = edgeKey(a, b);
      const entry = edgeCounts.get(key);
      if (entry) entry.count++;
      else edgeCounts.set(key, { a, b, count: 1 });
    }
  }
  const boundaryEdges = [...edgeCounts.values()].filter(edge => edge.count === 1);
  const adjacency = new Map();
  for (const edge of boundaryEdges) {
    if (!adjacency.has(edge.a)) adjacency.set(edge.a, []);
    if (!adjacency.has(edge.b)) adjacency.set(edge.b, []);
    adjacency.get(edge.a).push(edge.b);
    adjacency.get(edge.b).push(edge.a);
  }
  const visited = new Set();
  const loops = [];
  let skippedOpen = 0, skippedNonPlanar = 0, skippedTriangulation = 0;
  for (const edge of boundaryEdges) {
    const initialKey = edgeKey(edge.a, edge.b);
    if (visited.has(initialKey)) continue;
    let start = edge.a, previous = -1, current = start;
    const loop = [], localEdges = new Set();
    let closed = false;
    for (let guard = 0; guard <= boundaryEdges.length + 1; guard++) {
      loop.push(current);
      const neighbours = adjacency.get(current) || [];
      if (neighbours.length !== 2) break;
      const next = neighbours[0] === previous ? neighbours[1] : neighbours[0];
      const key = edgeKey(current, next);
      if (localEdges.has(key)) break;
      localEdges.add(key);
      previous = current;
      current = next;
      if (current === start) { closed = true; break; }
    }
    for (const key of localEdges) visited.add(key);
    if (!closed || loop.length < 3) { skippedOpen++; continue; }

    const positions = loop.map(index => [
      mesh.vertices[index * 3], mesh.vertices[index * 3 + 1], mesh.vertices[index * 3 + 2],
    ]);
    const distances = positions.map(point => point[0] * n[0] + point[1] * n[1] + point[2] * n[2] - planeOffset);
    if (distances.some(distance => Math.abs(distance) > tol)) { skippedNonPlanar++; continue; }

    // Construct a stable 2D basis with cross(u,v) = +normal.
    const reference = Math.abs(n[0]) < 0.8 ? [1, 0, 0] : [0, 0, 1];
    let u = [
      reference[1] * n[2] - reference[2] * n[1],
      reference[2] * n[0] - reference[0] * n[2],
      reference[0] * n[1] - reference[1] * n[0],
    ];
    const uLength = Math.hypot(...u);
    u = u.map(value => value / uLength);
    const v = [
      n[1] * u[2] - n[2] * u[1],
      n[2] * u[0] - n[0] * u[2],
      n[0] * u[1] - n[1] * u[0],
    ];
    const origin = n.map(value => value * planeOffset);
    const points2D = positions.map(point => {
      const relative = point.map((value, axis) => value - origin[axis]);
      return [relative[0] * u[0] + relative[1] * u[1] + relative[2] * u[2],
        relative[0] * v[0] + relative[1] * v[1] + relative[2] * v[2]];
    });
    const capFaces = isSimplePolygon(points2D) ? triangulatePolygon(points2D) : null;
    if (!capFaces) { skippedTriangulation++; continue; }
    loops.push({ indices: loop, triangles: capFaces });
  }

  if (!loops.length) {
    return {
      mesh,
      cappedLoops: 0,
      cappedTriangles: 0,
      skippedOpen,
      skippedNonPlanar,
      skippedTriangulation,
      unchanged: true,
    };
  }
  const nextVertices = mesh.vertices.slice();
  // Snap only the accepted boundary-loop vertices onto the exact support plane.
  // This makes the generated base genuinely planar while limiting shape change
  // to the caller-approved cap tolerance.
  for (const loop of loops) {
    for (const index of loop.indices) {
      const at = index * 3;
      const distance = nextVertices[at] * n[0] + nextVertices[at + 1] * n[1]
        + nextVertices[at + 2] * n[2] - planeOffset;
      nextVertices[at] -= distance * n[0];
      nextVertices[at + 1] -= distance * n[1];
      nextVertices[at + 2] -= distance * n[2];
    }
  }
  const nextTriangles = new Uint32Array(faces.length + loops.reduce((sum, loop) => sum + loop.triangles.length, 0));
  nextTriangles.set(faces);
  let cursor = faces.length;
  for (const loop of loops) {
    for (const index of loop.triangles) nextTriangles[cursor++] = loop.indices[index];
  }
  return {
    mesh: { ...mesh, vertices: nextVertices, triangles: nextTriangles, colours: mesh.colours?.slice?.() || mesh.colours },
    cappedLoops: loops.length,
    cappedTriangles: (nextTriangles.length - faces.length) / 3,
    skippedOpen,
    skippedNonPlanar,
    skippedTriangulation,
    unchanged: false,
  };
}
