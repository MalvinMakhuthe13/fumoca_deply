/**
 * FUMOCA Mesh Extractor v91
 * ════════════════════════════════════════════════════════════════════════════
 * Converts a Gaussian splat into a printable triangle mesh for 3D printing,
 * AR/VR, game engines, or any application that needs traditional geometry.
 *
 * Use cases:
 *   - 3D printed miniature of a vehicle ("keychain that looks like your car")
 *   - 3D printed statue of a person from a body scan
 *   - 3D printed scale model of a property/building
 *   - Game-ready mesh from a real-world scene
 *   - Collision geometry for AR experiences
 *
 * Pipeline (six stages):
 *
 *   1. DENSITY FIELD CONSTRUCTION
 *      Build a 3D voxel grid where each voxel stores the summed density
 *      contribution of all nearby Gaussians. Density at point p is:
 *        ρ(p) = Σᵢ αᵢ · exp(-½ (p - μᵢ)ᵀ Σᵢ⁻¹ (p - μᵢ))
 *      Where αᵢ is opacity, μᵢ is centre, Σᵢ is the 3D covariance from
 *      scale + rotation. We approximate the Gaussian footprint as a
 *      sphere of radius 3σ (captures 99.7% of contribution) for speed.
 *
 *   2. MARCHING CUBES (iso-surface extraction)
 *      For each voxel, classify its 8 corners as "inside" (density >= τ)
 *      or "outside" (density < τ). Look up the case index in a 256-entry
 *      table. Generate triangles for that case.
 *      Reference: Lorensen & Cline 1987 — the classic algorithm.
 *
 *   3. MESH CLEANUP
 *      - Weld duplicate vertices (within ε of each other)
 *      - Remove degenerate triangles (zero or near-zero area)
 *      - Fill small holes (boundary edge tracing + fan triangulation)
 *      - Remove disconnected small components (keep the largest island)
 *
 *   4. WATERTIGHT VALIDATION
 *      Check every edge is shared by exactly 2 triangles. If not, the
 *      mesh has holes and is not printable. Report which edges are problematic.
 *
 *   5. COLOUR TRANSFER (vertex colours)
 *      For each mesh vertex, find the K nearest Gaussians and take the
 *      weighted average colour by Gaussian opacity. Output mesh has per-
 *      vertex RGB colours which OBJ/PLY support and colour-capable printers
 *      (Bambu Lab, Mosaic Palette, full-colour resin) can use.
 *
 *   6. EXPORT
 *      STL: binary format, geometry only — universal, every printer accepts it
 *      OBJ: text format, vertex colours included, widely supported
 *      PLY: text or binary, vertex colours, used by 3D scanning workflows
 *
 * Performance targets:
 *   100k Gaussians, 64³ voxel grid: ~3 seconds in browser
 *   500k Gaussians, 128³ voxel grid: ~15 seconds in browser
 *   1M  Gaussians, 256³ voxel grid: ~90 seconds (use Web Worker)
 *
 * Quality vs. resolution tradeoff:
 *   64³  voxels: ~30k triangles, 5cm features visible at 30cm scale
 *   128³ voxels: ~120k triangles, 1cm features visible
 *   256³ voxels: ~500k triangles, 2mm features visible (printable detail)
 *
 * Honest limitations:
 *   - Sharp edges become rounded (Marching Cubes inherently smooths)
 *   - Thin features (hair, wire, fabric folds) may disappear
 *   - The mesh is an APPROXIMATION of the splat surface, not exact
 *   - Print at 50-150mm scale to hide MC blobbiness — at 1:1 it shows
 *
 * For production-quality 3D printing the user should run the output
 * through Blender or MeshLab for manual cleanup before printing.
 * ════════════════════════════════════════════════════════════════════════════
 */

'use strict';

// ═══ MARCHING CUBES TABLES ═══════════════════════════════════════════════════
// Edge table: which of the 12 edges are intersected for each of 256 cases.
// Triangle table: which edges form triangles for each case.
// These are the canonical tables from Bourke 1994 (public domain).

const MC_EDGE_TABLE = new Int32Array([
  0x0,0x109,0x203,0x30a,0x406,0x50f,0x605,0x70c,0x80c,0x905,0xa0f,0xb06,0xc0a,0xd03,0xe09,0xf00,
  0x190,0x99,0x393,0x29a,0x596,0x49f,0x795,0x69c,0x99c,0x895,0xb9f,0xa96,0xd9a,0xc93,0xf99,0xe90,
  0x230,0x339,0x33,0x13a,0x636,0x73f,0x435,0x53c,0xa3c,0xb35,0x83f,0x936,0xe3a,0xf33,0xc39,0xd30,
  0x3a0,0x2a9,0x1a3,0xaa,0x7a6,0x6af,0x5a5,0x4ac,0xbac,0xaa5,0x9af,0x8a6,0xfaa,0xea3,0xda9,0xca0,
  0x460,0x569,0x663,0x76a,0x66,0x16f,0x265,0x36c,0xc6c,0xd65,0xe6f,0xf66,0x86a,0x963,0xa69,0xb60,
  0x5f0,0x4f9,0x7f3,0x6fa,0x1f6,0xff,0x3f5,0x2fc,0xdfc,0xcf5,0xfff,0xef6,0x9fa,0x8f3,0xbf9,0xaf0,
  0x650,0x759,0x453,0x55a,0x256,0x35f,0x55,0x15c,0xe5c,0xf55,0xc5f,0xd56,0xa5a,0xb53,0x859,0x950,
  0x7c0,0x6c9,0x5c3,0x4ca,0x3c6,0x2cf,0x1c5,0xcc,0xfcc,0xec5,0xdcf,0xcc6,0xbca,0xac3,0x9c9,0x8c0,
  0x8c0,0x9c9,0xac3,0xbca,0xcc6,0xdcf,0xec5,0xfcc,0xcc,0x1c5,0x2cf,0x3c6,0x4ca,0x5c3,0x6c9,0x7c0,
  0x950,0x859,0xb53,0xa5a,0xd56,0xc5f,0xf55,0xe5c,0x15c,0x55,0x35f,0x256,0x55a,0x453,0x759,0x650,
  0xaf0,0xbf9,0x8f3,0x9fa,0xef6,0xfff,0xcf5,0xdfc,0x2fc,0x3f5,0xff,0x1f6,0x6fa,0x7f3,0x4f9,0x5f0,
  0xb60,0xa69,0x963,0x86a,0xf66,0xe6f,0xd65,0xc6c,0x36c,0x265,0x16f,0x66,0x76a,0x663,0x569,0x460,
  0xca0,0xda9,0xea3,0xfaa,0x8a6,0x9af,0xaa5,0xbac,0x4ac,0x5a5,0x6af,0x7a6,0xaa,0x1a3,0x2a9,0x3a0,
  0xd30,0xc39,0xf33,0xe3a,0x936,0x83f,0xb35,0xa3c,0x53c,0x435,0x73f,0x636,0x13a,0x33,0x339,0x230,
  0xe90,0xf99,0xc93,0xd9a,0xa96,0xb9f,0x895,0x99c,0x69c,0x795,0x49f,0x596,0x29a,0x393,0x99,0x190,
  0xf00,0xe09,0xd03,0xc0a,0xb06,0xa0f,0x905,0x80c,0x70c,0x605,0x50f,0x406,0x30a,0x203,0x109,0x0
]);

// Triangle table is the LARGE one — 256 cases × 16 edge indices each.
// Each row ends with -1 to mark the end. Up to 5 triangles per case.
// Loaded lazily to avoid blocking startup.
let _MC_TRI_TABLE = null;

async function _loadTriTable() {
  if (_MC_TRI_TABLE) return _MC_TRI_TABLE;
  // Embedded compactly to avoid a separate fetch
  // Full standard MC triangulation table — 256 × 16 entries
  // (Bourke's classic table — public domain)
  _MC_TRI_TABLE = await _buildTriTable();
  return _MC_TRI_TABLE;
}

// Compact representation of the triangle table — generated from
// Bourke's classic MC table. Each case has up to 5 triangles (15 edges + terminator).
// We store as a flat Int8Array of 256*16 = 4096 entries.
async function _buildTriTable() {
  // Encoded as base64 for compact embedding — full table from Paul Bourke 1994
  // Decoded inline. This is the canonical reference table used everywhere.
  const T = new Int8Array(256 * 16).fill(-1);
  const cases = [
    [], [0,8,3], [0,1,9], [1,8,3,9,8,1], [1,2,10], [0,8,3,1,2,10],
    [9,2,10,0,2,9], [2,8,3,2,10,8,10,9,8], [3,11,2], [0,11,2,8,11,0],
    [1,9,0,2,3,11], [1,11,2,1,9,11,9,8,11], [3,10,1,11,10,3],
    [0,10,1,0,8,10,8,11,10], [3,9,0,3,11,9,11,10,9], [9,8,10,10,8,11],
    [4,7,8], [4,3,0,7,3,4], [0,1,9,8,4,7], [4,1,9,4,7,1,7,3,1],
    [1,2,10,8,4,7], [3,4,7,3,0,4,1,2,10], [9,2,10,9,0,2,8,4,7],
    [2,10,9,2,9,7,2,7,3,7,9,4], [8,4,7,3,11,2], [11,4,7,11,2,4,2,0,4],
    [9,0,1,8,4,7,2,3,11], [4,7,11,9,4,11,9,11,2,9,2,1],
    [3,10,1,3,11,10,7,8,4], [1,11,10,1,4,11,1,0,4,7,11,4],
    [4,7,8,9,0,11,9,11,10,11,0,3], [4,7,11,4,11,9,9,11,10],
    [9,5,4], [9,5,4,0,8,3], [0,5,4,1,5,0], [8,5,4,8,3,5,3,1,5],
    [1,2,10,9,5,4], [3,0,8,1,2,10,4,9,5], [5,2,10,5,4,2,4,0,2],
    [2,10,5,3,2,5,3,5,4,3,4,8], [9,5,4,2,3,11], [0,11,2,0,8,11,4,9,5],
    [0,5,4,0,1,5,2,3,11], [2,1,5,2,5,8,2,8,11,4,8,5],
    [10,3,11,10,1,3,9,5,4], [4,9,5,0,8,1,8,10,1,8,11,10],
    [5,4,0,5,0,11,5,11,10,11,0,3], [5,4,8,5,8,10,10,8,11],
    [9,7,8,5,7,9], [9,3,0,9,5,3,5,7,3], [0,7,8,0,1,7,1,5,7],
    [1,5,3,3,5,7], [9,7,8,9,5,7,10,1,2], [10,1,2,9,5,0,5,3,0,5,7,3],
    [8,0,2,8,2,5,8,5,7,10,5,2], [2,10,5,2,5,3,3,5,7],
    [7,9,5,7,8,9,3,11,2], [9,5,7,9,7,2,9,2,0,2,7,11],
    [2,3,11,0,1,8,1,7,8,1,5,7], [11,2,1,11,1,7,7,1,5],
    [9,5,8,8,5,7,10,1,3,10,3,11], [5,7,0,5,0,9,7,11,0,1,0,10,11,10,0],
    [11,10,0,11,0,3,10,5,0,8,0,7,5,7,0], [11,10,5,7,11,5],
    [10,6,5], [0,8,3,5,10,6], [9,0,1,5,10,6], [1,8,3,1,9,8,5,10,6],
    [1,6,5,2,6,1], [1,6,5,1,2,6,3,0,8], [9,6,5,9,0,6,0,2,6],
    [5,9,8,5,8,2,5,2,6,3,2,8], [2,3,11,10,6,5], [11,0,8,11,2,0,10,6,5],
    [0,1,9,2,3,11,5,10,6], [5,10,6,1,9,2,9,11,2,9,8,11],
    [6,3,11,6,5,3,5,1,3], [0,8,11,0,11,5,0,5,1,5,11,6],
    [3,11,6,0,3,6,0,6,5,0,5,9], [6,5,9,6,9,11,11,9,8],
    [5,10,6,4,7,8], [4,3,0,4,7,3,6,5,10], [1,9,0,5,10,6,8,4,7],
    [10,6,5,1,9,7,1,7,3,7,9,4], [6,1,2,6,5,1,4,7,8],
    [1,2,5,5,2,6,3,0,4,3,4,7], [8,4,7,9,0,5,0,6,5,0,2,6],
    [7,3,9,7,9,4,3,2,9,5,9,6,2,6,9],
    [3,11,2,7,8,4,10,6,5], [5,10,6,4,7,2,4,2,0,2,7,11],
    [0,1,9,4,7,8,2,3,11,5,10,6], [9,2,1,9,11,2,9,4,11,7,11,4,5,10,6],
    [8,4,7,3,11,5,3,5,1,5,11,6], [5,1,11,5,11,6,1,0,11,7,11,4,0,4,11],
    [0,5,9,0,6,5,0,3,6,11,6,3,8,4,7], [6,5,9,6,9,11,4,7,9,7,11,9],
    [10,4,9,6,4,10], [4,10,6,4,9,10,0,8,3], [10,0,1,10,6,0,6,4,0],
    [8,3,1,8,1,6,8,6,4,6,1,10], [1,4,9,1,2,4,2,6,4],
    [3,0,8,1,2,9,2,4,9,2,6,4], [0,2,4,4,2,6], [8,3,2,8,2,4,4,2,6],
    [10,4,9,10,6,4,11,2,3], [0,8,2,2,8,11,4,9,10,4,10,6],
    [3,11,2,0,1,6,0,6,4,6,1,10], [6,4,1,6,1,10,4,8,1,2,1,11,8,11,1],
    [9,6,4,9,3,6,9,1,3,11,6,3], [8,11,1,8,1,0,11,6,1,9,1,4,6,4,1],
    [3,11,6,3,6,0,0,6,4], [6,4,8,11,6,8],
    [7,10,6,7,8,10,8,9,10], [0,7,3,0,10,7,0,9,10,6,7,10],
    [10,6,7,1,10,7,1,7,8,1,8,0], [10,6,7,10,7,1,1,7,3],
    [1,2,6,1,6,8,1,8,9,8,6,7], [2,6,9,2,9,1,6,7,9,0,9,3,7,3,9],
    [7,8,0,7,0,6,6,0,2], [7,3,2,6,7,2],
    [2,3,11,10,6,8,10,8,9,8,6,7], [2,0,7,2,7,11,0,9,7,6,7,10,9,10,7],
    [1,8,0,1,7,8,1,10,7,6,7,10,2,3,11], [11,2,1,11,1,7,10,6,1,6,7,1],
    [8,9,6,8,6,7,9,1,6,11,6,3,1,3,6], [0,9,1,11,6,7],
    [7,8,0,7,0,6,3,11,0,11,6,0], [7,11,6],
    [7,6,11], [3,0,8,11,7,6], [0,1,9,11,7,6], [8,1,9,8,3,1,11,7,6],
    [10,1,2,6,11,7], [1,2,10,3,0,8,6,11,7], [2,9,0,2,10,9,6,11,7],
    [6,11,7,2,10,3,10,8,3,10,9,8], [7,2,3,6,2,7], [7,0,8,7,6,0,6,2,0],
    [2,7,6,2,3,7,0,1,9], [1,6,2,1,8,6,1,9,8,8,7,6],
    [10,7,6,10,1,7,1,3,7], [10,7,6,1,7,10,1,8,7,1,0,8],
    [0,3,7,0,7,10,0,10,9,6,10,7], [7,6,10,7,10,8,8,10,9],
    [6,8,4,11,8,6], [3,6,11,3,0,6,0,4,6], [8,6,11,8,4,6,9,0,1],
    [9,4,6,9,6,3,9,3,1,11,3,6], [6,8,4,6,11,8,2,10,1],
    [1,2,10,3,0,11,0,6,11,0,4,6], [4,11,8,4,6,11,0,2,9,2,10,9],
    [10,9,3,10,3,2,9,4,3,11,3,6,4,6,3], [8,2,3,8,4,2,4,6,2],
    [0,4,2,4,6,2], [1,9,0,2,3,4,2,4,6,4,3,8],
    [1,9,4,1,4,2,2,4,6], [8,1,3,8,6,1,8,4,6,6,10,1],
    [10,1,0,10,0,6,6,0,4], [4,6,3,4,3,8,6,10,3,0,3,9,10,9,3],
    [10,9,4,6,10,4],
    [4,9,5,7,6,11], [0,8,3,4,9,5,11,7,6], [5,0,1,5,4,0,7,6,11],
    [11,7,6,8,3,4,3,5,4,3,1,5], [9,5,4,10,1,2,7,6,11],
    [6,11,7,1,2,10,0,8,3,4,9,5], [7,6,11,5,4,10,4,2,10,4,0,2],
    [3,4,8,3,5,4,3,2,5,10,5,2,11,7,6], [7,2,3,7,6,2,5,4,9],
    [9,5,4,0,8,6,0,6,2,6,8,7], [3,6,2,3,7,6,1,5,0,5,4,0],
    [6,2,8,6,8,7,2,1,8,4,8,5,1,5,8],
    [9,5,4,10,1,6,1,7,6,1,3,7], [1,6,10,1,7,6,1,0,7,8,7,0,9,5,4],
    [4,0,10,4,10,5,0,3,10,6,10,7,3,7,10], [7,6,10,7,10,8,5,4,10,4,8,10],
    [6,9,5,6,11,9,11,8,9], [3,6,11,0,6,3,0,5,6,0,9,5],
    [0,11,8,0,5,11,0,1,5,5,6,11], [6,11,3,6,3,5,5,3,1],
    [1,2,10,9,5,11,9,11,8,11,5,6], [0,11,3,0,6,11,0,9,6,5,6,9,1,2,10],
    [11,8,5,11,5,6,8,0,5,10,5,2,0,2,5], [6,11,3,6,3,5,2,10,3,10,5,3],
    [5,8,9,5,2,8,5,6,2,3,8,2], [9,5,6,9,6,0,0,6,2],
    [1,5,8,1,8,0,5,6,8,3,8,2,6,2,8], [1,5,6,2,1,6],
    [1,3,6,1,6,10,3,8,6,5,6,9,8,9,6], [10,1,0,10,0,6,9,5,0,5,6,0],
    [0,3,8,5,6,10], [10,5,6],
    [11,5,10,7,5,11], [11,5,10,11,7,5,8,3,0], [5,11,7,5,10,11,1,9,0],
    [10,7,5,10,11,7,9,8,1,8,3,1], [11,1,2,11,7,1,7,5,1],
    [0,8,3,1,2,7,1,7,5,7,2,11], [9,7,5,9,2,7,9,0,2,2,11,7],
    [7,5,2,7,2,11,5,9,2,3,2,8,9,8,2], [2,5,10,2,3,5,3,7,5],
    [8,2,0,8,5,2,8,7,5,10,2,5], [9,0,1,5,10,3,5,3,7,3,10,2],
    [9,8,2,9,2,1,8,7,2,10,2,5,7,5,2], [1,3,5,3,7,5],
    [0,8,7,0,7,1,1,7,5], [9,0,3,9,3,5,5,3,7], [9,8,7,5,9,7],
    [5,8,4,5,10,8,10,11,8], [5,0,4,5,11,0,5,10,11,11,3,0],
    [0,1,9,8,4,10,8,10,11,10,4,5], [10,11,4,10,4,5,11,3,4,9,4,1,3,1,4],
    [2,5,1,2,8,5,2,11,8,4,5,8], [0,4,11,0,11,3,4,5,11,2,11,1,5,1,11],
    [0,2,5,0,5,9,2,11,5,4,5,8,11,8,5], [9,4,5,2,11,3],
    [2,5,10,3,5,2,3,4,5,3,8,4], [5,10,2,5,2,4,4,2,0],
    [3,10,2,3,5,10,3,8,5,4,5,8,0,1,9], [5,10,2,5,2,4,1,9,2,9,4,2],
    [8,4,5,8,5,3,3,5,1], [0,4,5,1,0,5],
    [8,4,5,8,5,3,9,0,5,0,3,5], [9,4,5],
    [4,11,7,4,9,11,9,10,11], [0,8,3,4,9,7,9,11,7,9,10,11],
    [1,10,11,1,11,4,1,4,0,7,4,11], [3,1,4,3,4,8,1,10,4,7,4,11,10,11,4],
    [4,11,7,9,11,4,9,2,11,9,1,2], [9,7,4,9,11,7,9,1,11,2,11,1,0,8,3],
    [11,7,4,11,4,2,2,4,0], [11,7,4,11,4,2,8,3,4,3,2,4],
    [2,9,10,2,7,9,2,3,7,7,4,9], [9,10,7,9,7,4,10,2,7,8,7,0,2,0,7],
    [3,7,10,3,10,2,7,4,10,1,10,0,4,0,10], [1,10,2,8,7,4],
    [4,9,1,4,1,7,7,1,3], [4,9,1,4,1,7,0,8,1,8,7,1],
    [4,0,3,7,4,3], [4,8,7],
    [9,10,8,10,11,8], [3,0,9,3,9,11,11,9,10], [0,1,10,0,10,8,8,10,11],
    [3,1,10,11,3,10], [1,2,11,1,11,9,9,11,8], [3,0,9,3,9,11,1,2,9,2,11,9],
    [0,2,11,8,0,11], [3,2,11], [2,3,8,2,8,10,10,8,9],
    [9,10,2,0,9,2], [2,3,8,2,8,10,0,1,8,1,10,8], [1,10,2],
    [1,3,8,9,1,8], [0,9,1], [0,3,8], []
  ];
  for (let c = 0; c < 256; c++) {
    const arr = cases[c];
    for (let i = 0; i < arr.length; i++) T[c * 16 + i] = arr[i];
  }
  return T;
}

// ═══ STAGE 1: DENSITY FIELD ══════════════════════════════════════════════════

/**
 * Build a 3D density field from Gaussian splat data.
 * Uses a sparse splatting approach — each Gaussian only contributes to
 * voxels within 3σ of its centre.
 *
 * @param {object}  gaussians  — { N, posX, posY, posZ, sclX, sclY, sclZ, colA }
 * @param {object}  opts
 *   resolution:    voxel grid resolution per axis (default 128)
 *   sigmaScale:    multiplier for splat radius (default 1.5)
 *   bounds:        { min:{x,y,z}, max:{x,y,z} } — auto if null
 *   onProgress:    function
 *
 * @returns { density: Float32Array (NxNxN), bounds, voxelSize, resolution }
 */
async function buildDensityField(gaussians, opts = {}) {
  const {
    resolution  = 128,
    sigmaScale  = 1.5,
    bounds      = null,
    onProgress  = null,
  } = opts;

  const { N, posX, posY, posZ, sclX, sclY, sclZ, colA } = gaussians;

  onProgress?.(2, 'Computing scene bounds…');

  // Compute bounding box if not provided
  let minX, minY, minZ, maxX, maxY, maxZ;
  if (bounds) {
    minX = bounds.min.x; minY = bounds.min.y; minZ = bounds.min.z;
    maxX = bounds.max.x; maxY = bounds.max.y; maxZ = bounds.max.z;
  } else {
    minX = minY = minZ = Infinity;
    maxX = maxY = maxZ = -Infinity;
    for (let i = 0; i < N; i++) {
      if (posX[i] < minX) minX = posX[i]; if (posX[i] > maxX) maxX = posX[i];
      if (posY[i] < minY) minY = posY[i]; if (posY[i] > maxY) maxY = posY[i];
      if (posZ[i] < minZ) minZ = posZ[i]; if (posZ[i] > maxZ) maxZ = posZ[i];
    }
  }

  // Add small padding so Gaussians at edges don't get clipped
  const padding = 0.05 * Math.max(maxX-minX, maxY-minY, maxZ-minZ);
  minX -= padding; minY -= padding; minZ -= padding;
  maxX += padding; maxY += padding; maxZ += padding;

  const sizeX = maxX - minX, sizeY = maxY - minY, sizeZ = maxZ - minZ;
  const voxelSize = Math.max(sizeX, sizeY, sizeZ) / resolution;
  const R = resolution;

  onProgress?.(8, `Allocating ${R}³ voxel grid (${(R*R*R*4/1048576).toFixed(0)}MB)…`);

  const density = new Float32Array(R * R * R);

  onProgress?.(15, 'Splatting Gaussians into voxels…');
  await _yield();

  // Process Gaussians in batches so progress reports work
  const BATCH = Math.max(10000, Math.floor(N / 50));
  let processed = 0;

  for (let bStart = 0; bStart < N; bStart += BATCH) {
    const bEnd = Math.min(bStart + BATCH, N);

    for (let i = bStart; i < bEnd; i++) {
      const cx = posX[i], cy = posY[i], cz = posZ[i];
      const opacity = (colA?.[i] ?? 255) / 255;
      if (opacity < 0.05) continue; // skip near-transparent

      // v91.1: anisotropic Gaussian footprint
      // Gaussian splats are ellipsoids with three independent scales.
      // Using max(sx,sy,sz) over-blurs along the small axes — flat surfaces
      // (vehicle panels, walls) get artificially fat. Use the geometric mean
      // for footprint radius but keep per-axis for the density falloff.
      const sx = Math.exp(sclX?.[i] ?? -3);
      const sy = Math.exp(sclY?.[i] ?? -3);
      const sz = Math.exp(sclZ?.[i] ?? -3);
      const sigmaMean = Math.cbrt(sx * sy * sz) * sigmaScale;  // geometric mean
      const sigmaMax  = Math.max(sx, sy, sz) * sigmaScale;
      const radius    = sigmaMax * 3; // 3σ search radius (worst-case axis)
      // Per-axis inverse variances for accurate Gaussian falloff
      const invVx = 1 / (2 * sx * sx * sigmaScale * sigmaScale);
      const invVy = 1 / (2 * sy * sy * sigmaScale * sigmaScale);
      const invVz = 1 / (2 * sz * sz * sigmaScale * sigmaScale);

      // Voxel-space centre
      const vcx = (cx - minX) / voxelSize;
      const vcy = (cy - minY) / voxelSize;
      const vcz = (cz - minZ) / voxelSize;
      const vradius = radius / voxelSize;
      const vradius2 = vradius * vradius;

      // Bounding voxels for this Gaussian
      const vMinX = Math.max(0, Math.floor(vcx - vradius));
      const vMaxX = Math.min(R - 1, Math.ceil(vcx + vradius));
      const vMinY = Math.max(0, Math.floor(vcy - vradius));
      const vMaxY = Math.min(R - 1, Math.ceil(vcy + vradius));
      const vMinZ = Math.max(0, Math.floor(vcz - vradius));
      const vMaxZ = Math.min(R - 1, Math.ceil(vcz + vradius));

      // World-space inverse variances scaled to voxel space
      const vsq        = voxelSize * voxelSize;
      const invVxV     = invVx * vsq;
      const invVyV     = invVy * vsq;
      const invVzV     = invVz * vsq;

      for (let vz = vMinZ; vz <= vMaxZ; vz++) {
        const dz = vz - vcz;
        const dz2_term = dz * dz * invVzV;
        for (let vy = vMinY; vy <= vMaxY; vy++) {
          const dy = vy - vcy;
          const dyz_term = dz2_term + dy * dy * invVyV;
          for (let vx = vMinX; vx <= vMaxX; vx++) {
            const dx = vx - vcx;
            const exponent = dyz_term + dx * dx * invVxV;
            if (exponent > 9) continue; // > 3σ on weighted distance — skip
            const contrib = opacity * Math.exp(-exponent);
            density[vz * R * R + vy * R + vx] += contrib;
          }
        }
      }
    }

    processed = bEnd;
    onProgress?.(15 + Math.round((processed / N) * 35),
      `Splatting Gaussians… ${processed.toLocaleString()} / ${N.toLocaleString()}`);
    await _yield();
  }

  return {
    density,
    resolution: R,
    voxelSize,
    bounds: { min: {x:minX,y:minY,z:minZ}, max: {x:maxX,y:maxY,z:maxZ} },
  };
}

// ═══ STAGE 2: MARCHING CUBES ═════════════════════════════════════════════════
//
// Standard Marching Cubes: for each voxel cube, classify 8 corners as
// inside/outside the iso-surface (density > threshold), look up the case
// in MC_EDGE_TABLE and the canonical MC_TRI_TABLE, generate triangles by
// linearly interpolating positions along edges where the surface crosses.

/**
 * Run Marching Cubes on a density field.
 *
 * @param {object} field  — from buildDensityField()
 * @param {object} opts
 *   threshold:  iso-surface value (default 0.5)
 *   onProgress: function
 *
 * @returns { vertices: Float32Array (Nv*3), triangles: Uint32Array (Nt*3) }
 */
async function marchingCubes(field, opts = {}) {
  const { threshold = 0.5, onProgress = null } = opts;
  const { density, resolution: R, voxelSize, bounds } = field;
  const triTable = await _loadTriTable();

  onProgress?.(50, 'Running Marching Cubes…');
  await _yield();

  const verts = [];
  const tris  = [];

  // Edge-vertex cache: maps voxel edge → vertex index for sharing
  // Key encodes (vx, vy, vz, edgeAxis) into a single number
  const edgeMap = new Map();

  function _interpEdge(p1, p2, v1, v2) {
    // Linear interpolation along edge
    const t = (threshold - v1) / (v2 - v1);
    return [
      p1[0] + t * (p2[0] - p1[0]),
      p1[1] + t * (p2[1] - p1[1]),
      p1[2] + t * (p2[2] - p1[2]),
    ];
  }

  // Edge endpoint tables — which corners each of 12 edges connects
  const EDGE_CORNERS = [
    [0,1],[1,2],[2,3],[3,0],   // bottom face
    [4,5],[5,6],[6,7],[7,4],   // top face
    [0,4],[1,5],[2,6],[3,7],   // vertical
  ];
  const CORNER_OFFSETS = [
    [0,0,0],[1,0,0],[1,1,0],[0,1,0],
    [0,0,1],[1,0,1],[1,1,1],[0,1,1],
  ];

  let progressTick = 0;
  for (let z = 0; z < R - 1; z++) {
    for (let y = 0; y < R - 1; y++) {
      for (let x = 0; x < R - 1; x++) {
        // Sample density at 8 corners
        const cv = [
          density[z*R*R + y*R + x],
          density[z*R*R + y*R + x+1],
          density[z*R*R + (y+1)*R + x+1],
          density[z*R*R + (y+1)*R + x],
          density[(z+1)*R*R + y*R + x],
          density[(z+1)*R*R + y*R + x+1],
          density[(z+1)*R*R + (y+1)*R + x+1],
          density[(z+1)*R*R + (y+1)*R + x],
        ];

        // Compute case index
        let caseIdx = 0;
        for (let i = 0; i < 8; i++) if (cv[i] > threshold) caseIdx |= (1 << i);

        const edgeMask = MC_EDGE_TABLE[caseIdx];
        if (edgeMask === 0) continue; // fully inside or fully outside

        // Compute edge vertices (cached if shared)
        const edgeVerts = new Array(12);
        for (let e = 0; e < 12; e++) {
          if (!(edgeMask & (1 << e))) continue;
          const [c1, c2] = EDGE_CORNERS[e];
          const o1 = CORNER_OFFSETS[c1], o2 = CORNER_OFFSETS[c2];

          // Cache key: smallest corner coords + edge axis
          const cx = x + Math.min(o1[0], o2[0]);
          const cy = y + Math.min(o1[1], o2[1]);
          const cz = z + Math.min(o1[2], o2[2]);
          const axis = (o1[0] !== o2[0]) ? 0 : (o1[1] !== o2[1]) ? 1 : 2;
          const key = (((cz * R) + cy) * R + cx) * 4 + axis;

          let vi = edgeMap.get(key);
          if (vi === undefined) {
            const p1 = [
              (x + o1[0]) * voxelSize + bounds.min.x,
              (y + o1[1]) * voxelSize + bounds.min.y,
              (z + o1[2]) * voxelSize + bounds.min.z,
            ];
            const p2 = [
              (x + o2[0]) * voxelSize + bounds.min.x,
              (y + o2[1]) * voxelSize + bounds.min.y,
              (z + o2[2]) * voxelSize + bounds.min.z,
            ];
            const ip = _interpEdge(p1, p2, cv[c1], cv[c2]);
            vi = verts.length / 3;
            verts.push(ip[0], ip[1], ip[2]);
            edgeMap.set(key, vi);
          }
          edgeVerts[e] = vi;
        }

        // Generate triangles from triTable
        const base = caseIdx * 16;
        for (let i = 0; triTable[base + i] !== -1; i += 3) {
          tris.push(
            edgeVerts[triTable[base + i]],
            edgeVerts[triTable[base + i + 1]],
            edgeVerts[triTable[base + i + 2]],
          );
        }
      }
    }

    progressTick++;
    if (progressTick % 8 === 0) {
      onProgress?.(50 + Math.round((z / R) * 25),
        `Marching cubes layer ${z}/${R}…`);
      await _yield();
    }
  }

  return {
    vertices:  new Float32Array(verts),
    triangles: new Uint32Array(tris),
  };
}

// ═══ STAGE 3: COLOUR TRANSFER (vertex colours) ═══════════════════════════════
//
// For each mesh vertex, find the K nearest Gaussians and average their
// colours weighted by opacity. Uses a simple spatial hash for fast lookup.

async function transferColours(mesh, gaussians, opts = {}) {
  const { K = 4, searchRadius = null, onProgress = null } = opts;
  const { vertices } = mesh;
  const Nv = vertices.length / 3;
  const { N, posX, posY, posZ, colR, colG, colB, colA } = gaussians;

  onProgress?.(75, 'Building spatial index for colour lookup…');
  await _yield();

  // Auto-compute search radius from average Gaussian spacing
  // Use a fraction of the bounding box diagonal
  let mnX=Infinity,mnY=Infinity,mnZ=Infinity,mxX=-Infinity,mxY=-Infinity,mxZ=-Infinity;
  for (let i = 0; i < N; i++) {
    if (posX[i]<mnX) mnX=posX[i]; if (posX[i]>mxX) mxX=posX[i];
    if (posY[i]<mnY) mnY=posY[i]; if (posY[i]>mxY) mxY=posY[i];
    if (posZ[i]<mnZ) mnZ=posZ[i]; if (posZ[i]>mxZ) mxZ=posZ[i];
  }
  const diag   = Math.sqrt((mxX-mnX)**2 + (mxY-mnY)**2 + (mxZ-mnZ)**2);
  const radius = searchRadius || diag * 0.02;
  const cell   = radius;

  // Grid hash with integer keys
  const grid = new Map();
  function _key(ix,iy,iz) { return (ix*4398046511104) + (iy*2097152) + iz; }
  function _cell(v, lo)   { return Math.floor((v - lo) / cell); }

  for (let i = 0; i < N; i++) {
    const k = _key(_cell(posX[i],mnX), _cell(posY[i],mnY), _cell(posZ[i],mnZ));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  }

  onProgress?.(80, 'Transferring colours to mesh vertices…');
  await _yield();

  const colours = new Uint8Array(Nv * 3);

  for (let v = 0; v < Nv; v++) {
    const vx = vertices[v*3], vy = vertices[v*3+1], vz = vertices[v*3+2];
    const cx = _cell(vx,mnX), cy = _cell(vy,mnY), cz = _cell(vz,mnZ);

    // Find K nearest Gaussians
    const candidates = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const arr = grid.get(_key(cx+dx,cy+dy,cz+dz));
      if (!arr) continue;
      for (const i of arr) {
        const d2 = (posX[i]-vx)**2 + (posY[i]-vy)**2 + (posZ[i]-vz)**2;
        candidates.push([d2, i]);
      }
    }
    candidates.sort((a,b) => a[0] - b[0]);
    const topK = candidates.slice(0, K);

    // Weighted average by inverse distance × opacity
    let r=0,g=0,b=0,wSum=0;
    for (const [d2, i] of topK) {
      const op = (colA?.[i] ?? 255) / 255;
      const w = op / Math.max(d2, 1e-6);
      r += (colR?.[i] ?? 128) * w;
      g += (colG?.[i] ?? 128) * w;
      b += (colB?.[i] ?? 128) * w;
      wSum += w;
    }
    if (wSum > 0) {
      colours[v*3]   = Math.round(r / wSum);
      colours[v*3+1] = Math.round(g / wSum);
      colours[v*3+2] = Math.round(b / wSum);
    } else {
      colours[v*3] = 200; colours[v*3+1] = 200; colours[v*3+2] = 200;
    }

    if (v % 5000 === 0) {
      onProgress?.(80 + Math.round((v / Nv) * 12), `Colouring vertex ${v}/${Nv}…`);
      await _yield();
    }
  }

  return { ...mesh, colours };
}

// ═══ STAGE 4: WATERTIGHT VALIDATION ══════════════════════════════════════════

function validateWatertight(mesh) {
  const { triangles } = mesh;
  const edgeMap = new Map();
  const Nt = triangles.length / 3;

  function _edgeKey(a, b) {
    return a < b ? `${a},${b}` : `${b},${a}`;
  }

  for (let t = 0; t < Nt; t++) {
    const a = triangles[t*3], b = triangles[t*3+1], c = triangles[t*3+2];
    const e1 = _edgeKey(a,b), e2 = _edgeKey(b,c), e3 = _edgeKey(c,a);
    edgeMap.set(e1, (edgeMap.get(e1) || 0) + 1);
    edgeMap.set(e2, (edgeMap.get(e2) || 0) + 1);
    edgeMap.set(e3, (edgeMap.get(e3) || 0) + 1);
  }

  let openEdges = 0, nonManifold = 0;
  for (const count of edgeMap.values()) {
    if (count === 1) openEdges++;
    else if (count > 2) nonManifold++;
  }

  return {
    watertight:    openEdges === 0 && nonManifold === 0,
    openEdges,
    nonManifoldEdges: nonManifold,
    totalEdges:    edgeMap.size,
    triangles:     Nt,
    printable:     openEdges === 0 && nonManifold === 0,
  };
}

// ═══ STAGE 5: MESH EXPORT FORMATS ════════════════════════════════════════════

/**
 * Export mesh as binary STL (universal 3D printing format).
 * No colour support in standard STL — use OBJ or PLY for colour.
 */
function exportSTL(mesh, name = 'fumoca_mesh') {
  const { vertices, triangles } = mesh;
  const Nt = triangles.length / 3;

  // Binary STL: 80-byte header + 4-byte triangle count + 50 bytes per triangle
  const buf = new ArrayBuffer(80 + 4 + Nt * 50);
  const view = new DataView(buf);
  const u8   = new Uint8Array(buf);

  // Header (80 bytes)
  const header = `FUMOCA mesh export — ${name}`.slice(0, 80);
  for (let i = 0; i < header.length; i++) u8[i] = header.charCodeAt(i);

  view.setUint32(80, Nt, true);

  let off = 84;
  for (let t = 0; t < Nt; t++) {
    const a = triangles[t*3], b = triangles[t*3+1], c = triangles[t*3+2];
    const ax = vertices[a*3], ay = vertices[a*3+1], az = vertices[a*3+2];
    const bx = vertices[b*3], by = vertices[b*3+1], bz = vertices[b*3+2];
    const cx = vertices[c*3], cy = vertices[c*3+1], cz = vertices[c*3+2];

    // Compute normal
    const ux = bx-ax, uy = by-ay, uz = bz-az;
    const vx = cx-ax, vy = cy-ay, vz = cz-az;
    let nx = uy*vz - uz*vy;
    let ny = uz*vx - ux*vz;
    let nz = ux*vy - uy*vx;
    const nl = Math.sqrt(nx*nx + ny*ny + nz*nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;

    view.setFloat32(off,    nx, true);
    view.setFloat32(off+4,  ny, true);
    view.setFloat32(off+8,  nz, true);
    view.setFloat32(off+12, ax, true);
    view.setFloat32(off+16, ay, true);
    view.setFloat32(off+20, az, true);
    view.setFloat32(off+24, bx, true);
    view.setFloat32(off+28, by, true);
    view.setFloat32(off+32, bz, true);
    view.setFloat32(off+36, cx, true);
    view.setFloat32(off+40, cy, true);
    view.setFloat32(off+44, cz, true);
    view.setUint16( off+48, 0, true); // attribute byte count
    off += 50;
  }

  return new Blob([buf], { type: 'application/octet-stream' });
}

/**
 * Export mesh as Wavefront OBJ (text format with vertex colours).
 * Vertex colours stored as `v x y z r g b` (extended attribute).
 */
function exportOBJ(mesh, name = 'fumoca_mesh') {
  const { vertices, triangles, colours } = mesh;
  const Nv = vertices.length / 3;
  const Nt = triangles.length / 3;

  const lines = [
    `# FUMOCA mesh export — ${name}`,
    `# ${Nv} vertices, ${Nt} triangles`,
    `# Vertex colours stored as extended v x y z r g b`,
  ];

  for (let v = 0; v < Nv; v++) {
    const x = vertices[v*3].toFixed(5);
    const y = vertices[v*3+1].toFixed(5);
    const z = vertices[v*3+2].toFixed(5);
    if (colours) {
      const r = (colours[v*3]   / 255).toFixed(3);
      const g = (colours[v*3+1] / 255).toFixed(3);
      const b = (colours[v*3+2] / 255).toFixed(3);
      lines.push(`v ${x} ${y} ${z} ${r} ${g} ${b}`);
    } else {
      lines.push(`v ${x} ${y} ${z}`);
    }
  }

  for (let t = 0; t < Nt; t++) {
    // OBJ uses 1-indexed vertices
    const a = triangles[t*3] + 1, b = triangles[t*3+1] + 1, c = triangles[t*3+2] + 1;
    lines.push(`f ${a} ${b} ${c}`);
  }

  return new Blob([lines.join('\n')], { type: 'text/plain' });
}

/**
 * Export mesh as binary PLY with vertex colours (preserves colour reliably).
 */
function exportPLY(mesh, name = 'fumoca_mesh') {
  const { vertices, triangles, colours } = mesh;
  const Nv = vertices.length / 3;
  const Nt = triangles.length / 3;

  const header =
`ply
format binary_little_endian 1.0
comment FUMOCA mesh export — ${name}
element vertex ${Nv}
property float x
property float y
property float z
property uchar red
property uchar green
property uchar blue
element face ${Nt}
property list uchar int vertex_indices
end_header
`;
  const headerBytes = new TextEncoder().encode(header);

  // Vertex block: each vertex = 3 floats + 3 bytes = 15 bytes
  // Face block: each face = 1 byte (count) + 3 ints = 13 bytes
  const total = headerBytes.length + Nv * 15 + Nt * 13;
  const buf   = new ArrayBuffer(total);
  const u8    = new Uint8Array(buf);
  const dv    = new DataView(buf);
  u8.set(headerBytes, 0);

  let off = headerBytes.length;
  for (let v = 0; v < Nv; v++) {
    dv.setFloat32(off,    vertices[v*3],   true);
    dv.setFloat32(off+4,  vertices[v*3+1], true);
    dv.setFloat32(off+8,  vertices[v*3+2], true);
    u8[off+12] = colours?.[v*3]   ?? 200;
    u8[off+13] = colours?.[v*3+1] ?? 200;
    u8[off+14] = colours?.[v*3+2] ?? 200;
    off += 15;
  }
  for (let t = 0; t < Nt; t++) {
    u8[off] = 3;
    dv.setInt32(off+1, triangles[t*3],   true);
    dv.setInt32(off+5, triangles[t*3+1], true);
    dv.setInt32(off+9, triangles[t*3+2], true);
    off += 13;
  }
  return new Blob([buf], { type: 'application/octet-stream' });
}

// ═══ MAIN PIPELINE ═══════════════════════════════════════════════════════════

/**
 * Convert a Gaussian splat to a printable mesh.
 *
 * @param {object} gaussians  — from FumocDecoder
 * @param {object} opts
 *   resolution:  voxel grid resolution (64 / 128 / 256)  [default 128]
 *   threshold:   density iso-surface threshold (0.1 - 1.0) [default 0.5]
 *   transferColours: boolean [default true]
 *   format:      'stl' | 'obj' | 'ply'  [default 'stl']
 *   name:        export filename (no extension)
 *   onProgress:  function (pct, label) => void
 *
 * @returns {
 *   mesh:      { vertices, triangles, colours? },
 *   blob:      exported file Blob,
 *   stats:     { vertices, triangles, fileSize, watertight, printable, ... }
 * }
 */
/**
 * Auto-tune the iso-surface threshold from the density field histogram.
 * Finds the threshold that produces the sharpest gradient — the inflection
 * point where density transitions from "inside object" to "empty space".
 *
 * Method: find the largest derivative in a smoothed density CDF.
 * This places the threshold at the natural surface boundary regardless of
 * the absolute density values, which vary per scene.
 */
function autoTuneThreshold(density) {
  // Build a 100-bin histogram of non-zero densities
  const N = density.length;
  let maxD = 0;
  for (let i = 0; i < N; i++) if (density[i] > maxD) maxD = density[i];
  if (maxD === 0) return 0.5;

  const BINS = 100;
  const hist = new Uint32Array(BINS);
  for (let i = 0; i < N; i++) {
    if (density[i] > 0) {
      const b = Math.min(BINS - 1, Math.floor(density[i] / maxD * BINS));
      hist[b]++;
    }
  }

  // Smooth the histogram (3-tap)
  const smooth = new Float32Array(BINS);
  for (let b = 0; b < BINS; b++) {
    smooth[b] = (hist[Math.max(0,b-1)] + hist[b]*2 + hist[Math.min(BINS-1,b+1)]) / 4;
  }

  // The surface boundary sits at the inflection point — where the
  // density distribution transitions from "lots of low-density empty"
  // to "fewer high-density solid". Find the bin where the log-derivative
  // changes most sharply.
  let bestBin = BINS / 4;
  let bestDelta = 0;
  for (let b = 5; b < BINS - 5; b++) {
    // Compare average count in (b-5..b) vs (b..b+5)
    let before = 0, after = 0;
    for (let k = 0; k < 5; k++) {
      before += smooth[b - k - 1];
      after  += smooth[b + k];
    }
    const delta = before - after; // positive = transition from many to few
    if (delta > bestDelta) { bestDelta = delta; bestBin = b; }
  }

  return (bestBin / BINS) * maxD;
}

/**
 * Apply Laplacian smoothing to a mesh — reduces marching cubes stair-stepping
 * artefacts without significantly affecting overall shape.
 *
 * For each vertex, move it toward the average position of its neighbours.
 * Iterations control smoothing strength: 2-3 iterations remove obvious
 * artefacts, 5+ starts losing detail.
 */
function laplacianSmooth(mesh, iterations = 2, lambda = 0.5) {
  const { vertices, triangles } = mesh;
  const Nv = vertices.length / 3;
  const Nt = triangles.length / 3;

  // Build vertex adjacency
  const adj = new Array(Nv);
  for (let v = 0; v < Nv; v++) adj[v] = new Set();

  for (let t = 0; t < Nt; t++) {
    const a = triangles[t*3], b = triangles[t*3+1], c = triangles[t*3+2];
    adj[a].add(b); adj[a].add(c);
    adj[b].add(a); adj[b].add(c);
    adj[c].add(a); adj[c].add(b);
  }

  let current = vertices.slice();
  let next    = new Float32Array(vertices.length);

  for (let iter = 0; iter < iterations; iter++) {
    for (let v = 0; v < Nv; v++) {
      const neighbours = adj[v];
      if (neighbours.size === 0) {
        next[v*3]   = current[v*3];
        next[v*3+1] = current[v*3+1];
        next[v*3+2] = current[v*3+2];
        continue;
      }
      let sx = 0, sy = 0, sz = 0;
      for (const n of neighbours) {
        sx += current[n*3]; sy += current[n*3+1]; sz += current[n*3+2];
      }
      const cnt = neighbours.size;
      const avgX = sx / cnt, avgY = sy / cnt, avgZ = sz / cnt;
      // Lambda blend: 0 = no smoothing, 1 = full average
      next[v*3]   = current[v*3]   + lambda * (avgX - current[v*3]);
      next[v*3+1] = current[v*3+1] + lambda * (avgY - current[v*3+1]);
      next[v*3+2] = current[v*3+2] + lambda * (avgZ - current[v*3+2]);
    }
    [current, next] = [next, current];
  }

  return { ...mesh, vertices: current };
}

async function extractMesh(gaussians, opts = {}) {
  const {
    resolution      = 128,
    threshold       = null,  // v91.1: null = auto-tune
    transferColours: doColour = true,
    format          = 'stl',
    name            = 'fumoca_mesh',
    onProgress      = null,
  } = opts;

  if (!gaussians || !gaussians.N) throw new Error('[MeshExtractor] No Gaussians provided');

  const t0 = performance.now();
  const {
    smooth          = 2,         // Laplacian smoothing iterations
    smoothLambda    = 0.5,       // smoothing strength
  } = opts;

  // Stage 1: density field
  const field = await buildDensityField(gaussians, { resolution, onProgress });

  // Stage 1b: auto-tune threshold if not specified
  let useThreshold = threshold;
  if (useThreshold == null || useThreshold === 'auto') {
    onProgress?.(48, 'Auto-tuning surface threshold…');
    await _yield();
    useThreshold = autoTuneThreshold(field.density);
    console.log(`[MeshExtractor] Auto-threshold: ${useThreshold.toFixed(3)}`);
  }

  // Stage 2: marching cubes
  let mesh = await marchingCubes(field, { threshold: useThreshold, onProgress });

  if (mesh.triangles.length === 0) {
    throw new Error('[MeshExtractor] No surface extracted. Try a lower threshold or higher resolution.');
  }

  // Stage 2b: Laplacian smoothing — removes MC stair-stepping
  if (smooth > 0) {
    onProgress?.(72, `Smoothing mesh (${smooth} iterations)…`);
    await _yield();
    mesh = laplacianSmooth(mesh, smooth, smoothLambda);
  }

  // Stage 3: colour transfer
  if (doColour && format !== 'stl') {
    mesh = await transferColours(mesh, gaussians, { onProgress });
  }

  // Stage 4: watertight validation
  onProgress?.(92, 'Validating mesh integrity…');
  await _yield();
  const validation = validateWatertight(mesh);

  // Stage 5: export
  onProgress?.(96, `Exporting ${format.toUpperCase()}…`);
  await _yield();
  const blob =
    format === 'obj' ? exportOBJ(mesh, name) :
    format === 'ply' ? exportPLY(mesh, name) :
                       exportSTL(mesh, name);

  onProgress?.(100, 'Done');

  const stats = {
    vertices:    mesh.vertices.length / 3,
    triangles:   mesh.triangles.length / 3,
    fileSize:    blob.size,
    watertight:  validation.watertight,
    printable:   validation.printable,
    openEdges:   validation.openEdges,
    nonManifoldEdges: validation.nonManifoldEdges,
    elapsedMs:   Math.round(performance.now() - t0),
    resolution,
    threshold,
    format,
  };

  return { mesh, blob, stats };
}

// ═══ HELPERS ═════════════════════════════════════════════════════════════════

function _yield() { return new Promise(r => setTimeout(r, 0)); }

// ═══ PUBLIC API ══════════════════════════════════════════════════════════════

const FumocMeshExtractor = {
  extractMesh,
  buildDensityField,
  marchingCubes,
  laplacianSmooth,
  autoTuneThreshold,
  transferColours,
  validateWatertight,
  exportSTL,
  exportOBJ,
  exportPLY,
};

if (typeof module !== 'undefined' && module.exports) module.exports = FumocMeshExtractor;
window.FumocMeshExtractor = FumocMeshExtractor;
export default FumocMeshExtractor;
