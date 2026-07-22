/**
 * FUMOCA PLY Validator & Scene Organiser v1
 * ══════════════════════════════════════════════════════
 * Validates uploaded .ply files, extracts camera positions,
 * aligns scene coordinate space, and reports scene health.
 * ══════════════════════════════════════════════════════
 */

const FumocaPLYValidator = (() => {

  // ── Parse PLY header ──────────────────────────────────
  function parseHeader(buffer) {
    const bytes = new Uint8Array(buffer);
    let headerEnd = -1;
    const endMagic = [101,110,100,95,104,101,97,100,101,114]; // "end_header"
    for (let i = 0; i < bytes.length - 12; i++) {
      let match = true;
      for (let j = 0; j < endMagic.length; j++) {
        if (bytes[i+j] !== endMagic[j]) { match = false; break; }
      }
      if (match) { headerEnd = i + endMagic.length + 1; break; }
    }
    if (headerEnd < 0) return null;

    const headerText = new TextDecoder().decode(bytes.slice(0, headerEnd));
    const lines = headerText.split('\n').map(l => l.trim());

    const info = {
      format: 'unknown', version: '1.0',
      elements: [], headerBytes: headerEnd,
      hasColor: false, hasOpacity: false, hasScale: false,
      hasNormals: false, hasCameras: false,
      gaussianCount: 0, cameraCount: 0,
      properties: []
    };

    let currentElement = null;
    for (const line of lines) {
      if (line.startsWith('format')) {
        const p = line.split(' ');
        info.format = p[1]; info.version = p[2];
      } else if (line.startsWith('element')) {
        const p = line.split(' ');
        currentElement = { name: p[1], count: parseInt(p[2]), properties: [] };
        info.elements.push(currentElement);
        if (p[1] === 'vertex') info.gaussianCount = parseInt(p[2]);
        if (p[1] === 'camera') { info.hasCameras = true; info.cameraCount = parseInt(p[2]); }
      } else if (line.startsWith('property') && currentElement) {
        const p = line.split(' ');
        const propName = p[p.length - 1];
        currentElement.properties.push({ type: p[1], name: propName });
        info.properties.push(propName);
        if (['red','green','blue','r','g','b','f_dc_0'].some(n => propName.includes(n))) info.hasColor = true;
        if (['opacity','alpha','f_opacity'].some(n => propName.includes(n))) info.hasOpacity = true;
        if (['scale_0','scale_1','sx','sy'].some(n => propName.includes(n))) info.hasScale = true;
        if (['nx','ny','nz','normal_x'].some(n => propName.includes(n))) info.hasNormals = true;
      }
    }
    return info;
  }

  // ── Validate and score the PLY ────────────────────────
  function validate(buffer, filename = '') {
    const result = {
      valid: false, score: 0, issues: [], warnings: [], info: null,
      isGaussianSplat: false, isPointCloud: false, hasCameras: false,
      recommendations: []
    };

    if (!buffer || buffer.byteLength < 10) {
      result.issues.push('File is empty or too small');
      return result;
    }

    const magic = new TextDecoder().decode(new Uint8Array(buffer, 0, 3));
    if (magic !== 'ply') {
      result.issues.push('Not a valid PLY file — missing "ply" magic bytes');
      return result;
    }

    const header = parseHeader(buffer);
    if (!header) {
      result.issues.push('Could not parse PLY header — file may be corrupted');
      return result;
    }

    result.info = header;
    result.hasCameras = header.hasCameras;
    result.valid = true;

    // Score and classify
    let score = 50; // base

    if (header.gaussianCount > 0) score += 10;
    if (header.gaussianCount > 10000) score += 10;
    if (header.hasColor) { score += 10; result.isPointCloud = true; }
    if (header.hasOpacity) { score += 10; result.isGaussianSplat = true; }
    if (header.hasScale) { score += 10; result.isGaussianSplat = true; }
    if (header.hasNormals) score += 5;
    if (header.hasCameras) score += 5;
    if (header.format === 'binary_little_endian') score += 5; // efficient

    result.score = Math.min(100, score);

    // Warnings
    if (!header.hasColor) result.warnings.push('No colour data — splat will render as white points');
    if (!header.hasOpacity) result.warnings.push('No opacity channel — Gaussian splat blending may not work');
    if (!header.hasScale) result.warnings.push('No scale data — Gaussians will use uniform size');
    if (header.gaussianCount < 1000) result.warnings.push(`Only ${header.gaussianCount} points — scene may look sparse`);
    if (header.format === 'ascii') result.warnings.push('ASCII format — consider binary for better performance');
    if (!header.hasCameras) result.warnings.push('No camera positions embedded — camera view panel will be unavailable');

    // Recommendations
    if (result.isGaussianSplat) result.recommendations.push('Full Gaussian splat detected — all editing tools available');
    else if (result.isPointCloud) result.recommendations.push('Point cloud detected — colour editing available, Gaussian effects limited');
    if (header.hasCameras) result.recommendations.push(`${header.cameraCount} camera positions found — Camera View panel will show capture trajectory`);

    return result;
  }

  // ── Extract camera positions from PLY ─────────────────
  function extractCameras(buffer, header) {
    if (!header || !header.hasCameras) return [];
    const cameras = [];

    // Find camera element
    const camEl = header.elements.find(e => e.name === 'camera');
    if (!camEl || camEl.count === 0) return [];

    // Compute byte offset to camera element data
    let byteOffset = header.headerBytes;
    for (const el of header.elements) {
      if (el.name === 'camera') break;
      // Estimate bytes per element (rough — assumes float32 for all props)
      byteOffset += el.count * el.properties.length * 4;
    }

    const dv = new DataView(buffer);
    const le = header.format === 'binary_little_endian';
    const stride = camEl.properties.length * 4;

    for (let i = 0; i < camEl.count; i++) {
      const base = byteOffset + i * stride;
      if (base + stride > buffer.byteLength) break;
      try {
        cameras.push({
          index: i,
          x: dv.getFloat32(base, le),
          y: dv.getFloat32(base + 4, le),
          z: dv.getFloat32(base + 8, le),
        });
      } catch (_) { break; }
    }

    return cameras;
  }

  // ── Scene health report ───────────────────────────────
  function sceneReport(buffer, filename) {
    const validation = validate(buffer, filename);
    if (!validation.valid) return validation;

    // Extract cameras if available
    if (validation.hasCameras) {
      validation.cameras = extractCameras(buffer, validation.info);
    }

    // Bounding box estimate from header
    validation.estimatedSize = (() => {
      const mb = buffer.byteLength / (1024 * 1024);
      if (mb > 200) return 'Very large scene (200MB+) — may load slowly on mobile';
      if (mb > 50) return 'Large scene — full quality editing available';
      if (mb > 10) return 'Medium scene — ideal for editing and sharing';
      return 'Compact scene — fast loading and sharing';
    })();

    return validation;
  }

  return { validate, parseHeader, extractCameras, sceneReport };
})();

window.FumocaPLYValidator = FumocaPLYValidator;
export default FumocaPLYValidator;
