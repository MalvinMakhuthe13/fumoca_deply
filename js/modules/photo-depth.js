/**
 * FUMOCA Photo → 3D — in-browser AI depth for a single photo.
 *
 * Depth Anything V2 Small (Apache-2.0) via Transformers.js. Runs on the
 * user's device (WebGPU when available, otherwise WASM); the photo never
 * leaves the browser. The model (~25 MB) is cached by the browser after the
 * first run.
 *
 * Output is RELATIVE INVERSE depth (bigger = closer), at the photo's size.
 */

const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.3';
const MODEL_ID = 'onnx-community/depth-anything-v2-small';
const MAX_SIDE = 1024;

let _pipe = null;
let _device = null;
let _loading = null;

async function _hasWebGpu() {
  try { return !!(navigator.gpu && await navigator.gpu.requestAdapter()); } catch (_) { return false; }
}

/** Load (once) and return the depth pipeline. */
export async function loadDepthModel({ onProgress } = {}) {
  if (_pipe) return _pipe;
  if (_loading) return _loading;
  _loading = (async () => {
    const { pipeline, env } = await import(TRANSFORMERS_URL);
    env.allowLocalModels = false;
    const files = new Map();
    const progress_callback = (e) => {
      if (e?.status === 'progress' && e.file) {
        files.set(e.file, { loaded: e.loaded || 0, total: e.total || 0 });
        let loaded = 0, total = 0;
        for (const f of files.values()) { loaded += f.loaded; total += f.total; }
        onProgress?.(total ? loaded / total : 0, 'Downloading depth model (first time only)…');
      }
    };
    const attempts = (await _hasWebGpu())
      ? [{ device: 'webgpu', dtype: 'fp16' }, { device: 'wasm', dtype: 'q8' }]
      : [{ device: 'wasm', dtype: 'q8' }];
    let lastError = null;
    for (const opt of attempts) {
      try {
        _pipe = await pipeline('depth-estimation', MODEL_ID, { ...opt, progress_callback });
        _device = opt.device;
        return _pipe;
      } catch (error) {
        lastError = error;
        console.warn('[Photo→3D] depth model failed on', opt.device, error);
      }
    }
    throw lastError || new Error('Depth model could not be loaded');
  })();
  try { return await _loading; } finally { _loading = null; }
}

export function depthDevice() { return _device; }

/** Decode a File/Blob/URL into a canvas no larger than MAX_SIDE. */
export async function loadPhoto(source, maxSide = MAX_SIDE) {
  let bitmap;
  if (source instanceof Blob) bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' });
  else {
    const res = await fetch(source);
    if (!res.ok) throw new Error('Could not load image: HTTP ' + res.status);
    bitmap = await createImageBitmap(await res.blob(), { imageOrientation: 'from-image' });
  }
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(2, Math.round(bitmap.width * scale)), h = Math.max(2, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return { canvas, width: w, height: h, rgba: ctx.getImageData(0, 0, w, h).data };
}

/**
 * Estimate depth for a photo canvas.
 * @returns {{raw: Float32Array, width: number, height: number, device: string}}
 */
export async function estimateDepth(canvas, { onProgress } = {}) {
  const pipe = await loadDepthModel({ onProgress });
  onProgress?.(1, 'Estimating depth…');
  const { RawImage } = await import(TRANSFORMERS_URL);
  const blob = await new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Could not encode photo')), 'image/png'));
  const image = await RawImage.fromBlob(blob);
  const out = await pipe(image);
  const t = out.predicted_depth;
  const dims = t.dims;
  const h = dims[dims.length - 2], w = dims[dims.length - 1];
  return { raw: Float32Array.from(t.data), width: w, height: h, device: _device };
}

export default { loadDepthModel, loadPhoto, estimateDepth, depthDevice };
