import assert from 'node:assert/strict';
import { smoothSurface, removeSpikes, trimRaggedEdges, evenColours, simplify, autoClean, boundaryVertices } from '../js/modules/mesh-cleanup.js';
let seed = 3; const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
// a noisy open hemisphere (a hat crown) as a grid mesh, with speckled colours and a few spikes
const N = 60, V = [], C = [], T = [];
for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
  const th = (i / N) * Math.PI / 2, ph = (j / N) * Math.PI * 2, rad = 1 + (r() - 0.5) * 0.06;
  V.push(rad * Math.sin(th) * Math.cos(ph), rad * Math.cos(th), rad * Math.sin(th) * Math.sin(ph));
  const speck = r() < 0.08 ? 250 : 40; C.push(speck, speck, speck);
}
const id = (i, j) => i * (N + 1) + j;
for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) T.push(id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j), id(i + 1, j + 1), id(i, j + 1));
// spikes: 20 vertices pulled far out → long-edged faces
for (let k = 0; k < 20; k++) { const v = Math.floor(r() * (V.length / 3)); V[v * 3] *= 3; V[v * 3 + 1] *= 3; }
const mesh = { vertices: Float32Array.from(V), triangles: Uint32Array.from(T), colours: Uint8Array.from(C) };
const radiusErr = (m) => { let e = 0, n = 0; for (let i = 0; i < m.vertices.length; i += 3) { const d = Math.hypot(m.vertices[i], m.vertices[i + 1], m.vertices[i + 2]); if (d < 1.5) { e += Math.abs(d - 1); n++; } } return e / n; };
const spikes = removeSpikes(mesh, { factor: 4 });
assert.ok(spikes.removedTriangles >= 40 && spikes.removedTriangles < 400, 'spike faces removed: ' + spikes.removedTriangles);
const sm = smoothSurface(spikes.mesh, { strength: 0.5 });
assert.ok(radiusErr(sm.mesh) < radiusErr(spikes.mesh) * 0.6, `smoother: ${radiusErr(spikes.mesh).toFixed(4)} → ${radiusErr(sm.mesh).toFixed(4)}`);
let mean = 0; for (let i = 0; i < sm.mesh.vertices.length; i += 3) mean += Math.hypot(sm.mesh.vertices[i], sm.mesh.vertices[i + 1], sm.mesh.vertices[i + 2]);
mean /= sm.mesh.vertices.length / 3;
assert.ok(mean > 0.97, 'Taubin keeps the size (no shrinking): ' + mean.toFixed(3));
const nb = boundaryVertices(mesh.vertices.length / 3, mesh.triangles).reduce((a, b) => a + b, 0);
assert.ok(nb > 0, 'open hemisphere has a rim');
const trimmed = trimRaggedEdges(spikes.mesh, { rings: 1 });
assert.ok(trimmed.removedTriangles > N && trimmed.mesh.triangles.length < spikes.mesh.triangles.length, 'rim ring trimmed: ' + trimmed.removedTriangles);
const ev = evenColours(mesh);
let bright = 0; for (let i = 0; i < ev.mesh.colours.length; i += 3) if (ev.mesh.colours[i] > 200) bright++;
assert.ok(bright < 0.01 * ev.mesh.colours.length / 3, 'speckle gone: ' + bright);
const sim = simplify(mesh, { ratio: 0.25 });
assert.ok(sim.after < sim.before * 0.45 && sim.after > sim.before * 0.05, `simplified ${sim.before} → ${sim.after}`);
assert.equal(sim.mesh.colours.length, sim.mesh.vertices.length);
for (const t of sim.mesh.triangles) assert.ok(t < sim.mesh.vertices.length / 3);
const auto = autoClean(mesh);
assert.ok(auto.log.length >= 3, auto.log.join('; '));
console.log('mesh-cleanup: all tests passed (' + auto.log.join('; ') + ')');
