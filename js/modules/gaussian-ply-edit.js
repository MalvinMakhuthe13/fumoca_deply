/**
 * Safely bake editor transforms into a binary little-endian Gaussian PLY.
 * Unknown scalar vertex properties (including SH coefficients) are preserved.
 */
function parseBinaryGaussianPly(bytes) {
  const src = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const marker = new TextEncoder().encode('end_header');
  let markerAt = -1;
  for (let i = 0; i <= src.length - marker.length; i++) {
    let match = true;
    for (let j = 0; j < marker.length; j++) if (src[i+j] !== marker[j]) { match = false; break; }
    if (match) { markerAt = i; break; }
  }
  if (markerAt < 0) throw new Error('PLY header terminator not found');
  let headerEnd = markerAt + marker.length;
  if (src[headerEnd] === 13 && src[headerEnd + 1] === 10) headerEnd += 2;
  else if (src[headerEnd] === 10) headerEnd += 1;
  else throw new Error('PLY header terminator has no supported line ending');

  const header = new TextDecoder().decode(src.subarray(0, headerEnd));
  const headerLines = header.split(/\r?\n/);
  if (!headerLines.includes('format binary_little_endian 1.0')) {
    throw new Error('High-fidelity Gaussian export requires binary little-endian PLY');
  }
  const vertexLine = headerLines.find(line => line.startsWith('element vertex '));
  const vertexMatch = vertexLine?.match(/^element vertex (\d+)$/);
  if (!vertexMatch) throw new Error('PLY vertex element not found');
  const count = Number(vertexMatch[1]);
  const newline = header.includes('\r\n') ? '\r\n' : '\n';
  const typeInfo = {
    char:[1,'getInt8','setInt8'], int8:[1,'getInt8','setInt8'],
    uchar:[1,'getUint8','setUint8'], uint8:[1,'getUint8','setUint8'],
    short:[2,'getInt16','setInt16'], int16:[2,'getInt16','setInt16'],
    ushort:[2,'getUint16','setUint16'], uint16:[2,'getUint16','setUint16'],
    int:[4,'getInt32','setInt32'], int32:[4,'getInt32','setInt32'],
    uint:[4,'getUint32','setUint32'], uint32:[4,'getUint32','setUint32'],
    float:[4,'getFloat32','setFloat32'], float32:[4,'getFloat32','setFloat32'],
    double:[8,'getFloat64','setFloat64'], float64:[8,'getFloat64','setFloat64']
  };
  let inVertex = false, rowBytes = 0;
  const properties = [];
  for (const line of header.split(/\r?\n/)) {
    if (line.startsWith('element ')) { inVertex = /^element vertex \d+$/.test(line); continue; }
    if (!inVertex || !line.startsWith('property ')) continue;
    const parts = line.trim().split(/\s+/);
    if (parts[1] === 'list') throw new Error('Gaussian vertex list properties are unsupported');
    const info = typeInfo[parts[1]];
    if (!info) throw new Error('Unsupported PLY vertex property type: ' + parts[1]);
    properties.push({ name:parts[2], type:parts[1], offset:rowBytes, size:info[0], getter:info[1], setter:info[2] });
    rowBytes += info[0];
  }
  const xyz = ['x','y','z'].map(name => properties.find(p => p.name === name));
  if (xyz.some(p => !p || !['float','float32','double','float64'].includes(p.type))) {
    throw new Error('PLY must contain scalar floating-point x, y, z properties');
  }
  if (headerEnd + count * rowBytes !== src.length) {
    throw new Error('PLY contains trailing elements or unexpected data; safe Gaussian export refused');
  }
  return {
    src, header, headerEnd, newline, count, rowBytes, xyz,
    scaleProps:[0,1,2].map(i => properties.find(p => p.name === 'scale_' + i)),
    rotationProps:[0,1,2,3].map(i => properties.find(p => p.name === 'rot_' + i)),
    opacityProp:properties.find(p => p.name === 'opacity')
  };
}

export function makeEditedGaussianPlyBytes(originalBytes, state) {
  const parsed = parseBinaryGaussianPly(originalBytes);
  if (!state?.alive || state.alive.length !== parsed.count || !state.positions || state.positions.length !== parsed.count*3) {
    throw new Error('Editor arrays do not match the original Gaussian PLY vertex count');
  }
  const rows = [];
  for (let i=0;i<parsed.count;i++) {
    if (!state.alive[i]) continue;
    const row = parsed.src.slice(parsed.headerEnd + i*parsed.rowBytes, parsed.headerEnd + (i+1)*parsed.rowBytes);
    const view = new DataView(row.buffer, row.byteOffset, row.byteLength);
    for (let axis=0;axis<3;axis++) {
      const prop = parsed.xyz[axis], value = state.positions[i*3+axis];
      if (!Number.isFinite(value)) throw new Error('Non-finite transformed position at vertex ' + i);
      view[prop.setter](prop.offset, value, true);
    }
    if (state.scaleXYZ && parsed.scaleProps.every(Boolean)) {
      for (let axis=0;axis<3;axis++) {
        const scale = Number(state.scaleXYZ[i*3+axis]);
        if (!(scale > 0) || !Number.isFinite(scale)) throw new Error('Invalid Gaussian scale at vertex ' + i);
        const prop = parsed.scaleProps[axis];
        view[prop.setter](prop.offset, Math.log(scale), true);
      }
    }
    if (state.opacity && parsed.opacityProp) {
      const alpha = Number(state.opacity[i]);
      if (!Number.isFinite(alpha)) throw new Error('Invalid Gaussian opacity at vertex ' + i);
      const safeAlpha = Math.max(0.0001, Math.min(0.9999, alpha));
      view[parsed.opacityProp.setter](parsed.opacityProp.offset, Math.log(safeAlpha / (1 - safeAlpha)), true);
    }
    if (state.rotation && parsed.rotationProps.every(Boolean)) {
      let norm = 0;
      for (let axis=0;axis<4;axis++) norm += state.rotation[i*4+axis] ** 2;
      norm = Math.sqrt(norm);
      if (!(norm > 1e-8) || !Number.isFinite(norm)) throw new Error('Invalid Gaussian rotation at vertex ' + i);
      for (let axis=0;axis<4;axis++) {
        const prop = parsed.rotationProps[axis];
        view[prop.setter](prop.offset, state.rotation[i*4+axis] / norm, true);
      }
    }
    rows.push(row);
  }
  const headerLines = parsed.header.split(/\r?\n/);
  const vertexLineIndex = headerLines.findIndex(line => /^element vertex \d+$/.test(line));
  if (vertexLineIndex < 0) throw new Error('PLY vertex element could not be rewritten');
  headerLines[vertexLineIndex] = 'element vertex ' + rows.length;
  const header = headerLines.join(parsed.newline);
  const headerBytes = new TextEncoder().encode(header);
  const out = new Uint8Array(headerBytes.length + rows.length*parsed.rowBytes);
  out.set(headerBytes);
  let offset = headerBytes.length;
  for (const row of rows) { out.set(row, offset); offset += row.length; }
  return out;
}
