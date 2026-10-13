/**
 * FUMOCA LiDAR / dense point import
 *
 * Browser-side: ASCII/binary PLY + XYZ/CSV point dumps.
 * Full LAS/LAZ → queue to worker (same pattern as video jobs) when available.
 *
 * Goal: merge real depth/structure into a sparse Gaussian capture so
 * solid surfaces and ground planes hold up for mesh + print.
 */

/**
 * Parse a simple XYZ / CSV point cloud (x y z [r g b]).
 * @returns {{ positions: Float32Array, colors: Float32Array|null, count: number }}
 */
export function parseXYZ(text) {
  const lines = text.split(/\r?\n/);
  const pts = [];
  const cols = [];
  let hasColor = false;

  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#') || t.startsWith('//')) continue;
    const parts = t.split(/[\s,;]+/).map(Number);
    if (parts.length < 3 || parts.slice(0, 3).some((n) => Number.isNaN(n))) continue;
    pts.push(parts[0], parts[1], parts[2]);
    if (parts.length >= 6) {
      hasColor = true;
      cols.push(
        Math.min(255, Math.max(0, parts[3])) / 255,
        Math.min(255, Math.max(0, parts[4])) / 255,
        Math.min(255, Math.max(0, parts[5])) / 255
      );
    }
  }

  const count = pts.length / 3;
  return {
    positions: new Float32Array(pts),
    colors: hasColor ? new Float32Array(cols) : null,
    count,
    source: 'xyz',
  };
}

/**
 * Minimal ASCII PLY reader (x y z [red green blue] [nx ny nz]).
 */
export function parseAsciiPLY(text) {
  const lines = text.split(/\r?\n/);
  let i = 0;
  let vertexCount = 0;
  const props = [];

  if (!lines[0] || !lines[0].includes('ply')) {
    throw new Error('Not a PLY file');
  }

  for (; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('element vertex')) {
      vertexCount = parseInt(line.split(/\s+/).pop(), 10);
    } else if (line.startsWith('property')) {
      props.push(line.split(/\s+/).pop());
    } else if (line === 'end_header') {
      i++;
      break;
    }
  }

  const ix = props.indexOf('x');
  const iy = props.indexOf('y');
  const iz = props.indexOf('z');
  if (ix < 0 || iy < 0 || iz < 0) throw new Error('PLY missing x/y/z');

  const ir = props.indexOf('red') >= 0 ? props.indexOf('red') : props.indexOf('r');
  const ig = props.indexOf('green') >= 0 ? props.indexOf('green') : props.indexOf('g');
  const ib = props.indexOf('blue') >= 0 ? props.indexOf('blue') : props.indexOf('b');
  const hasColor = ir >= 0 && ig >= 0 && ib >= 0;

  const positions = new Float32Array(vertexCount * 3);
  const colors = hasColor ? new Float32Array(vertexCount * 3) : null;

  let v = 0;
  for (; i < lines.length && v < vertexCount; i++) {
    const t = lines[i].trim();
    if (!t) continue;
    const parts = t.split(/\s+/).map(Number);
    positions[v * 3] = parts[ix];
    positions[v * 3 + 1] = parts[iy];
    positions[v * 3 + 2] = parts[iz];
    if (hasColor) {
      const scale = parts[ir] > 1 ? 1 / 255 : 1;
      colors[v * 3] = parts[ir] * scale;
      colors[v * 3 + 1] = parts[ig] * scale;
      colors[v * 3 + 2] = parts[ib] * scale;
    }
    v++;
  }

  return { positions, colors, count: v, source: 'ply' };
}

/**
 * Detect format from filename + content and parse.
 */
export async function importPointCloud(file) {
  const name = (file.name || '').toLowerCase();
  const buf = await file.arrayBuffer();
  const head = new TextDecoder().decode(buf.slice(0, 80));

  if (name.endsWith('.las') || name.endsWith('.laz')) {
    return {
      deferred: true,
      message:
        'LAS/LAZ will be processed on the GPU worker (same queue as video). Upload queued when worker is configured.',
      filename: file.name,
      size: file.size,
    };
  }

  const text = new TextDecoder().decode(buf);
  if (name.endsWith('.ply') || head.startsWith('ply')) {
    return parseAsciiPLY(text);
  }
  if (name.endsWith('.xyz') || name.endsWith('.txt') || name.endsWith('.csv')) {
    return parseXYZ(text);
  }

  // Heuristic: if first non-empty line has 3+ numbers → XYZ
  try {
    return parseXYZ(text);
  } catch {
    throw new Error('Unsupported point format. Use PLY, XYZ, or CSV (x y z [r g b]).');
  }
}

/**
 * Downsample for browser safety (max points).
 */
export function downsample(cloud, maxPoints = 800_000) {
  if (cloud.count <= maxPoints) return cloud;
  const step = Math.ceil(cloud.count / maxPoints);
  const n = Math.floor(cloud.count / step);
  const positions = new Float32Array(n * 3);
  const colors = cloud.colors ? new Float32Array(n * 3) : null;
  let j = 0;
  for (let i = 0; i < cloud.count; i += step) {
    positions[j * 3] = cloud.positions[i * 3];
    positions[j * 3 + 1] = cloud.positions[i * 3 + 1];
    positions[j * 3 + 2] = cloud.positions[i * 3 + 2];
    if (colors) {
      colors[j * 3] = cloud.colors[i * 3];
      colors[j * 3 + 1] = cloud.colors[i * 3 + 1];
      colors[j * 3 + 2] = cloud.colors[i * 3 + 2];
    }
    j++;
  }
  return { positions, colors, count: j, source: cloud.source + '+downsampled' };
}

/**
 * Attach to studio UI: file input + status.
 */
export function mountLidarImport({ dropEl, onCloud, onStatus } = {}) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.ply,.xyz,.txt,.csv,.las,.laz';
  input.style.display = 'none';
  document.body.appendChild(input);

  async function handle(file) {
    onStatus?.(`Reading ${file.name}…`);
    try {
      let cloud = await importPointCloud(file);
      if (cloud.deferred) {
        onStatus?.(cloud.message);
        onCloud?.(cloud);
        return;
      }
      cloud = downsample(cloud);
      onStatus?.(`Loaded ${cloud.count.toLocaleString()} points (${cloud.source})`);
      onCloud?.(cloud);
    } catch (err) {
      onStatus?.(err.message || String(err));
      console.error('[lidar]', err);
    }
  }

  input.addEventListener('change', () => {
    const f = input.files?.[0];
    if (f) handle(f);
    input.value = '';
  });

  if (dropEl) {
    dropEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropEl.classList.add('drag');
    });
    dropEl.addEventListener('dragleave', () => dropEl.classList.remove('drag'));
    dropEl.addEventListener('drop', (e) => {
      e.preventDefault();
      dropEl.classList.remove('drag');
      const f = e.dataTransfer?.files?.[0];
      if (f) handle(f);
    });
  }

  return {
    openPicker: () => input.click(),
    importPointCloud,
    downsample,
  };
}

if (typeof window !== 'undefined') {
  window.FUMOCA_LidarImport = { importPointCloud, parseXYZ, parseAsciiPLY, downsample, mountLidarImport };
}
