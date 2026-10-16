/**
 * Pure text point-cloud parser, intentionally independent of Three.js so CI can
 * exercise import semantics without a browser or GPU.
 *
 * Supported headers: x/y/z plus optional r/g/b (or red/green/blue),
 * intensity, classification, and return_number/returnnumber.
 * Headerless rows remain compatible with x y z [r g b]; four-column rows
 * are interpreted as x y z intensity. Intensity values are treated as raw
 * integer units; normalized 0..1 intensity is ambiguous and is not rescaled.
 */
const aliases = {
  x: ['x'], y: ['y'], z: ['z'],
  r: ['r', 'red', 'red8'], g: ['g', 'green', 'green8'], b: ['b', 'blue', 'blue8'],
  intensity: ['intensity', 'reflectance', 'return_intensity'],
  classification: ['classification', 'class', 'classification_id'],
  returnNumber: ['return_number', 'returnnumber', 'return_num', 'returnnumberid'],
};

function normalizeName(value) {
  return String(value).trim().toLowerCase().replace(/[ -]+/g, '_');
}

function resolveColumns(header) {
  const names = header.map(normalizeName);
  const out = {};
  for (const [key, choices] of Object.entries(aliases)) {
    out[key] = names.findIndex(name => choices.includes(name));
  }
  return out;
}

function numericRow(line, delimiter) {
  const parts = delimiter === 'whitespace'
    ? line.trim().split(/\s+/)
    : line.split(delimiter).map(value => value.trim());
  return parts.map(value => value === '' ? NaN : Number(value));
}

export function parseXYZ(text) {
  if (typeof text !== 'string') throw new TypeError('Point-cloud text must be a string.');
  const lines = text.split(/\r?\n/);
  const meaningful = lines.map((line, index) => ({ line: line.trim(), index }))
    .filter(item => item.line && !item.line.startsWith('#') && !item.line.startsWith('//'));
  if (!meaningful.length) throw new Error('Point-cloud text contains no point records.');

  const first = meaningful[0].line;
  const delimiter = first.includes(',') ? ',' : first.includes(';') ? ';' : 'whitespace';
  const tokens = delimiter === 'whitespace' ? first.split(/\s+/) : first.split(delimiter).map(v => v.trim());
  const headerCandidate = tokens.map(normalizeName);
  const hasHeader = ['x','y','z'].every(key => headerCandidate.includes(key)) &&
    tokens.some(token => !Number.isFinite(Number(token)));
  const columns = hasHeader ? resolveColumns(tokens) : null;
  if (hasHeader && (columns.x < 0 || columns.y < 0 || columns.z < 0)) {
    throw new Error('Point-cloud header must identify x, y, and z columns.');
  }

  const pts = [], cols = [], intensityValues = [], classValues = [], returnValues = [];
  let hasColor = false, hasIntensity = false, hasClassification = false, hasReturnNumber = false;
  let maxColor = 0, validRows = 0;
  const rows = meaningful.slice(hasHeader ? 1 : 0);
  for (const item of rows) {
    const rowDelimiter = hasHeader
      ? (item.line.includes(',') ? ',' : item.line.includes(';') ? ';' : 'whitespace')
      : delimiter;
    const values = numericRow(item.line, rowDelimiter);
    let x, y, z, rgb = null, intensity = null, classification = null, returnNumber = null;
    if (hasHeader) {
      if (values.length < tokens.length) continue;
      x = values[columns.x]; y = values[columns.y]; z = values[columns.z];
      if ([columns.r, columns.g, columns.b].every(i => i >= 0)) {
        rgb = [values[columns.r], values[columns.g], values[columns.b]];
        hasColor = true;
      }
      if (columns.intensity >= 0) { intensity = values[columns.intensity]; hasIntensity = true; }
      if (columns.classification >= 0) { classification = values[columns.classification]; hasClassification = true; }
      if (columns.returnNumber >= 0) { returnNumber = values[columns.returnNumber]; hasReturnNumber = true; }
    } else {
      [x, y, z] = values;
      if (values.length >= 6) { rgb = values.slice(3, 6); hasColor = true; }
      else if (values.length === 4) { intensity = values[3]; hasIntensity = true; }
    }
    if (![x, y, z].every(Number.isFinite)) continue;
    pts.push(x, y, z);
    if (hasColor || rgb) {
      const safeRgb = rgb && rgb.every(Number.isFinite) ? rgb : [184,184,184];
      maxColor = Math.max(maxColor, ...safeRgb);
      cols.push(...safeRgb);
    }
    if (hasIntensity) intensityValues.push(Number.isFinite(intensity) ? intensity : 0);
    if (hasClassification) classValues.push(Number.isFinite(classification) ? classification : 0);
    if (hasReturnNumber) returnValues.push(Number.isFinite(returnNumber) ? returnNumber : 0);
    validRows++;
  }
  if (!validRows) throw new Error('Point-cloud text contains no valid x/y/z point records.');

  const colors = hasColor
    ? new Float32Array(cols.map(value => Math.min(1, Math.max(0, value / (maxColor > 1.5 ? 255 : 1)))))
    : null;
  const toUint16 = values => new Uint16Array(values.map(value => Math.round(Math.max(0, Math.min(65535, value)))));
  const toUint8 = values => new Uint8Array(values.map(value => Math.round(Math.max(0, Math.min(255, value)))));
  return {
    positions: new Float32Array(pts),
    colors,
    intensities: hasIntensity ? toUint16(intensityValues) : null,
    classifications: hasClassification ? toUint8(classValues) : null,
    returnNumbers: hasReturnNumber ? toUint8(returnValues) : null,
    count: validRows,
    source: 'xyz',
    coordinateMetadata: { source: 'text', crs: 'unknown_not_parsed', units: 'unknown', metricScaleVerified: false },
  };
}
