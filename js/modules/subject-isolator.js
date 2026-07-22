/**
 * FUMOCA Subject Isolator
 * Removes backgrounds from frames before reconstruction.
 * Supports: people, vehicles, any subject with defined edges.
 * Uses canvas-based masking client-side + optional server-side segmentation.
 */

const SI = (() => {
  const CFG = {
    // Server-side segmentation endpoint (your backend)
    segmentEndpoint: '/api/segment',
    // Fallback: try Hugging Face Inference API (requires user's HF token or your proxy)
    hfEndpoint: 'https://api-inference.huggingface.co/models/facebook/sam-vit-base',
    // Client-side: simple chroma/edge-based rough mask (works without server)
    clientFallback: true,
    // Background fill for masked regions
    bgFill: [0, 0, 0, 0], // transparent
    // Edge feathering radius (px at full resolution)
    featherRadius: 4,
  };

  // ─── Detect subject type from record metadata ──────────────────────────────
  function detectSubjectType(record = null) {
    const hint = String(
      record?.metadata?.scene_mode || record?.category || record?.type || ''
    ).toLowerCase();
    if (hint.includes('car') || hint.includes('vehicle') || hint.includes('truck')) return 'vehicle';
    if (hint.includes('person') || hint.includes('event') || hint.includes('portrait') || hint.includes('glam')) return 'person';
    if (hint.includes('product')) return 'product';
    return 'auto'; // let segmentation decide
  }

  // ─── Server-side segmentation (best quality) ──────────────────────────────
  async function _segmentServerSide(frameBlob, subjectType) {
    try {
      const form = new FormData();
      form.append('image', frameBlob, 'frame.jpg');
      form.append('subject_type', subjectType);
      const res = await fetch(CFG.segmentEndpoint, { method: 'POST', body: form });
      if (!res.ok) throw new Error(`Segment API ${res.status}`);
      const { mask_base64 } = await res.json();
      return mask_base64 ? _base64ToImageData(mask_base64) : null;
    } catch {
      return null;
    }
  }

  // ─── Client-side rough mask (no server needed) ────────────────────────────
  // Simple center-weighted grab-cut style: assumes subject is near center of frame
  function _clientRoughMask(pixels, w, h) {
    const mask = new Uint8Array(w * h);
    const cx = w / 2, cy = h / 2;
    const rx = w * 0.38, ry = h * 0.52; // ellipse covering typical subject

    // Background color sampling: corners
    const corners = [
      _getPixel(pixels, w, 0, 0),
      _getPixel(pixels, w, w-1, 0),
      _getPixel(pixels, w, 0, h-1),
      _getPixel(pixels, w, w-1, h-1),
    ];
    const bgR = corners.reduce((s,c) => s+c[0], 0) / 4;
    const bgG = corners.reduce((s,c) => s+c[1], 0) / 4;
    const bgB = corners.reduce((s,c) => s+c[2], 0) / 4;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const inEllipse = ((x-cx)/rx)**2 + ((y-cy)/ry)**2 <= 1.0;
        const px = _getPixel(pixels, w, x, y);
        const colorDist = Math.sqrt((px[0]-bgR)**2 + (px[1]-bgG)**2 + (px[2]-bgB)**2);
        // Inside ellipse AND sufficiently different from bg color = subject
        mask[y*w+x] = (inEllipse && colorDist > 28) ? 255 : 0;
      }
    }
    _featherMask(mask, w, h, 3);
    return mask;
  }

  function _getPixel(pixels, w, x, y) {
    const i = (y * w + x) * 4;
    return [pixels[i], pixels[i+1], pixels[i+2]];
  }

  // ─── Edge feathering for clean mask borders ────────────────────────────────
  function _featherMask(mask, w, h, radius) {
    const copy = new Uint8Array(mask);
    for (let y = radius; y < h - radius; y++) {
      for (let x = radius; x < w - radius; x++) {
        let sum = 0, count = 0;
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            sum += copy[(y+dy)*w+(x+dx)];
            count++;
          }
        }
        mask[y*w+x] = sum / count;
      }
    }
  }

  function _base64ToImageData(b64) {
    return b64; // pass-through for now — caller converts
  }

  // ─── Apply mask to canvas image data ──────────────────────────────────────
  function applyMaskToPixels(pixels, mask, w, h) {
    const out = new Uint8ClampedArray(pixels);
    for (let i = 0; i < w * h; i++) {
      const alpha = mask[i] ?? 255;
      out[i*4+3] = alpha; // set alpha channel from mask
    }
    return out;
  }

  // ─── Process a single frame blob ──────────────────────────────────────────
  async function isolateFrame(frameBlob, subjectType = 'auto', useServer = true) {
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(frameBlob);
      img.onload = async () => {
        const w = img.naturalWidth, h = img.naturalHeight;
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, w, h);
        URL.revokeObjectURL(url);

        let mask = null;
        if (useServer) mask = await _segmentServerSide(frameBlob, subjectType);
        if (!mask) mask = _clientRoughMask(imageData.data, w, h);

        const maskedPixels = applyMaskToPixels(imageData.data, mask, w, h);
        const outImageData = new ImageData(maskedPixels, w, h);
        ctx.putImageData(outImageData, 0, 0);

        canvas.toBlob(blob => resolve({ blob, mask, w, h }), 'image/png');
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve({ blob: frameBlob, mask: null }); };
      img.src = url;
    });
  }

  // ─── Batch process frames from video ──────────────────────────────────────
  async function isolateFrameBatch(videoFile, frameTimes, subjectType = 'auto', onProgress) {
    const url = URL.createObjectURL(videoFile);
    const video = document.createElement('video');
    video.muted = true; video.playsInline = true; video.src = url;

    await new Promise(res => {
      video.addEventListener('loadedmetadata', res, { once: true });
      video.load();
    });

    const results = [];
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    for (let i = 0; i < frameTimes.length; i++) {
      await new Promise(res => {
        video.currentTime = frameTimes[i];
        video.addEventListener('seeked', res, { once: true });
      });

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const mask = _clientRoughMask(imageData.data, canvas.width, canvas.height);
      const maskedPixels = applyMaskToPixels(imageData.data, mask, canvas.width, canvas.height);
      ctx.putImageData(new ImageData(maskedPixels, canvas.width, canvas.height), 0, 0);

      const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
      results.push({ time: frameTimes[i], blob, frameIndex: i });

      if (onProgress) onProgress((i + 1) / frameTimes.length);
    }

    URL.revokeObjectURL(url);
    return results;
  }

  // ─── Vehicle-specific: isolate from ground plane ──────────────────────────
  // Removes floor/shadow by masking bottom N% of frame where ground plane typically sits
  function isolateVehicleGround(pixels, w, h, groundFraction = 0.08) {
    const mask = new Uint8Array(w * h).fill(255);
    const groundStart = Math.floor(h * (1 - groundFraction));
    for (let y = groundStart; y < h; y++) {
      for (let x = 0; x < w; x++) {
        mask[y*w+x] = 0;
      }
    }
    return mask;
  }

  // ─── Composite subject splat onto venue background splat ──────────────────
  // Used at render time in viewer — subject and background are separate splats
  function buildCompositeConfig(subjectSplatUrl, backgroundSplatUrl, subjectScale = 1.0) {
    return {
      type: 'composite',
      layers: [
        { role: 'background', splatUrl: backgroundSplatUrl, opacity: 1.0, locked: true },
        { role: 'subject', splatUrl: subjectSplatUrl, scale: subjectScale, opacity: 1.0, editable: true }
      ]
    };
  }

  return {
    detectSubjectType,
    isolateFrame,
    isolateFrameBatch,
    isolateVehicleGround,
    buildCompositeConfig,
    applyMaskToPixels,
    CFG
  };
})();

window.FumocaSubjectIsolator = SI;
export default SI;
