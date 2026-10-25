/**
 * FUMOCA — Break the Frame + Depth Text + Escape Loop
 *
 * 1) Still: subject looks like it’s leaving a photo / poster / phone
 * 2) Depth text: iPhone lock-screen style — text sits *behind* the subject
 * 3) Short looping video: subject pushes out of the frame
 */

const FRAME_STYLES = {
  polaroid: {
    label: 'Polaroid',
    padTop: 0.06,
    padSide: 0.08,
    padBottom: 0.22,
    radius: 4,
    bg: '#f5f2eb',
    border: '#e8e4dc',
    shadow: true,
  },
  poster: {
    label: 'Poster',
    padTop: 0.04,
    padSide: 0.04,
    padBottom: 0.04,
    radius: 2,
    bg: '#111',
    border: '#222',
    shadow: true,
  },
  phone: {
    label: 'Phone screen',
    padTop: 0.08,
    padSide: 0.06,
    padBottom: 0.1,
    radius: 28,
    bg: '#0a0a0a',
    border: '#1a1a1a',
    shadow: true,
    notch: true,
  },
  magazine: {
    label: 'Magazine',
    padTop: 0.05,
    padSide: 0.05,
    padBottom: 0.12,
    radius: 0,
    bg: '#fafafa',
    border: '#ddd',
    shadow: true,
  },
  plain: {
    label: 'Plain frame',
    padTop: 0.03,
    padSide: 0.03,
    padBottom: 0.03,
    radius: 8,
    bg: '#fff',
    border: '#ccc',
    shadow: true,
  },
};

export function captureSubjectCanvas() {
  const canvas =
    document.querySelector('#viewport canvas') ||
    document.querySelector('#viewer canvas') ||
    document.querySelector('canvas');
  if (!canvas) throw new Error('No 3D canvas found — load a splat first');
  return canvas;
}

export function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not load image'));
    };
    img.src = url;
  });
}

/**
 * Build a canvas of the subject with transparent background.
 * Dark studio void pixels become alpha 0 so text can show “behind”.
 */
export function extractSubjectLayer(sourceCanvas, threshold = 28) {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d');
  ctx.drawImage(sourceCanvas, 0, 0);
  const image = ctx.getImageData(0, 0, w, h);
  const d = image.data;

  // Soft edge: luminance below threshold → transparent
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (lum < threshold) {
      d[i + 3] = 0;
    } else if (lum < threshold + 40) {
      // Feather edge
      d[i + 3] = Math.round(((lum - threshold) / 40) * (d[i + 3] || 255));
    }
  }
  ctx.putImageData(image, 0, 0);
  return out;
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawCover(ctx, img, x, y, w, h) {
  const iw = img.width || 1;
  const ih = img.height || 1;
  const scale = Math.max(w / iw, h / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

function drawContain(ctx, img, x, y, w, h) {
  const iw = img.width || 1;
  const ih = img.height || 1;
  const scale = Math.min(w / iw, h / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

/**
 * Draw large lock-screen style text (can be multi-line).
 */
function drawDepthText(ctx, text, W, H, opts = {}) {
  const {
    color = 'rgba(255,255,255,0.92)',
    fontFamily = 'Outfit, system-ui, -apple-system, sans-serif',
    maxWidthRatio = 0.88,
    yRatio = 0.28,
  } = opts;

  if (!text) return;

  const lines = String(text).split('\n');
  let fontSize = Math.round(W * 0.14);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;

  // Fit width
  for (let i = 0; i < 12; i++) {
    ctx.font = `700 ${fontSize}px ${fontFamily}`;
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    if (widest <= W * maxWidthRatio) break;
    fontSize = Math.floor(fontSize * 0.92);
  }

  const lineH = fontSize * 1.05;
  const startY = H * yRatio - ((lines.length - 1) * lineH) / 2;

  lines.forEach((line, i) => {
    // Soft shadow so it reads on light frames too
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 12;
    ctx.fillText(line, W / 2, startY + i * lineH);
  });
  ctx.shadowBlur = 0;
}

/**
 * Core composite.
 * Layer order (iPhone depth text):
 *   background → frame/photo → depth text → subject (transparent bg)
 * so text appears *behind* the subject.
 */
export async function renderBreakFrame(opts = {}) {
  const {
    subjectCanvas = captureSubjectCanvas(),
    photo = null,
    style = 'polaroid',
    overflow = 0.28,
    subjectScale = 1.15,
    caption = '',
    depthText = '',
    width = 1200,
    bgColor = null,
    subjectThreshold = 28,
  } = opts;

  const frame = FRAME_STYLES[style] || FRAME_STYLES.polaroid;
  const W = width;
  const H = Math.round(width * 1.15);
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const ctx = out.getContext('2d');

  const subjectLayer = extractSubjectLayer(subjectCanvas, subjectThreshold);

  // Void
  ctx.fillStyle = bgColor || '#0a0b10';
  ctx.fillRect(0, 0, W, H);
  const grad = ctx.createRadialGradient(W / 2, H / 2, W * 0.2, W / 2, H / 2, W * 0.75);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  const marginX = W * 0.12;
  const marginY = H * 0.1;
  const frameW = W - marginX * 2;
  const frameH = H - marginY * 2 - (caption ? 20 : 0);
  const fx = marginX;
  const fy = marginY;

  if (frame.shadow) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 40;
    ctx.shadowOffsetY = 18;
    roundRect(ctx, fx, fy, frameW, frameH, frame.radius);
    ctx.fillStyle = frame.bg;
    ctx.fill();
    ctx.restore();
  } else {
    roundRect(ctx, fx, fy, frameW, frameH, frame.radius);
    ctx.fillStyle = frame.bg;
    ctx.fill();
  }

  const ix = fx + frameW * frame.padSide;
  const iy = fy + frameH * frame.padTop;
  const iw = frameW * (1 - frame.padSide * 2);
  const ih = frameH * (1 - frame.padTop - frame.padBottom);

  ctx.save();
  roundRect(ctx, ix, iy, iw, ih, Math.max(0, frame.radius - 4));
  ctx.clip();
  if (photo) {
    drawCover(ctx, photo, ix, iy, iw, ih);
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(ix, iy, iw, ih);
  } else {
    ctx.globalAlpha = 0.5;
    drawCover(ctx, subjectCanvas, ix, iy, iw, ih);
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(20,20,30,0.35)';
    ctx.fillRect(ix, iy, iw, ih);
  }
  ctx.restore();

  if (frame.notch) {
    const nw = iw * 0.35;
    ctx.fillStyle = '#0a0a0a';
    roundRect(ctx, ix + (iw - nw) / 2, iy + 8, nw, 10, 6);
    ctx.fill();
  }

  ctx.strokeStyle = frame.border;
  ctx.lineWidth = 1;
  roundRect(ctx, ix, iy, iw, ih, Math.max(0, frame.radius - 4));
  ctx.stroke();

  // Depth text UNDER subject (full canvas, large type)
  if (depthText) {
    drawDepthText(ctx, depthText, W, H, {
      color:
        frame.bg === '#111' || frame.bg === '#0a0a0a'
          ? 'rgba(255,255,255,0.9)'
          : 'rgba(20,20,30,0.88)',
      yRatio: 0.32,
    });
  }

  // Subject escaping — drawn ON TOP of text → text sits behind
  const sw = iw * subjectScale * (1 + overflow * 0.35);
  const sh = ih * subjectScale * (1 + overflow * 0.35);
  const sx = ix + (iw - sw) / 2;
  const sy = iy + ih * 0.15 - sh * overflow * 0.85;

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(ix + iw / 2, iy + ih * 0.72, iw * 0.28, ih * 0.04, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = 28;
  ctx.shadowOffsetY = 12;
  drawContain(ctx, subjectLayer, sx, sy, sw, sh);
  ctx.restore();

  if (caption) {
    ctx.fillStyle = frame.bg === '#111' || frame.bg === '#0a0a0a' ? '#eee' : '#222';
    ctx.font = `600 ${Math.round(W * 0.028)}px Outfit, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.shadowBlur = 0;
    ctx.fillText(caption, fx + frameW / 2, fy + frameH - frameH * frame.padBottom * 0.35);
  }

  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.font = `600 ${Math.round(W * 0.018)}px Outfit, system-ui, sans-serif`;
  ctx.textAlign = 'right';
  ctx.fillText('FUMOCA', W - marginX * 0.4, H - 16);

  return out;
}

/**
 * Pure depth-text lock-screen style (no polaroid frame).
 * Background + text + subject on top with transparent void.
 */
export async function renderDepthLockScreen(opts = {}) {
  const {
    subjectCanvas = captureSubjectCanvas(),
    depthText = '9:41',
    subText = '',
    width = 1080,
    height = 1920,
    bg = '#0a0b12',
    subjectThreshold = 28,
  } = opts;

  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const ctx = out.getContext('2d');
  const subjectLayer = extractSubjectLayer(subjectCanvas, subjectThreshold);

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  // Subtle gradient like iOS
  const g = ctx.createLinearGradient(0, 0, 0, height);
  g.addColorStop(0, 'rgba(40,50,80,0.35)');
  g.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);

  // Text first (behind)
  drawDepthText(ctx, depthText, width, height, {
    color: 'rgba(255,255,255,0.95)',
    yRatio: 0.22,
    maxWidthRatio: 0.9,
  });
  if (subText) {
    ctx.font = `500 ${Math.round(width * 0.045)}px Outfit, system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.textAlign = 'center';
    ctx.fillText(subText, width / 2, height * 0.22 + width * 0.12);
  }

  // Subject on top, lower third / center
  const sw = width * 1.05;
  const sh = height * 0.75;
  drawContain(ctx, subjectLayer, (width - sw) / 2, height * 0.28, sw, sh);

  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.font = `600 ${Math.round(width * 0.028)}px Outfit, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('FUMOCA', width / 2, height - 40);

  return out;
}

export async function downloadBreakFrame(opts = {}) {
  const canvas = await renderBreakFrame(opts);
  return blobDownload(canvas, `fumoca-break-frame-${opts.style || 'polaroid'}.png`);
}

export async function downloadDepthLockScreen(opts = {}) {
  const canvas = await renderDepthLockScreen(opts);
  return blobDownload(canvas, 'fumoca-depth-text.png');
}

function blobDownload(canvas, filename) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) return resolve(null);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2500);
      resolve(blob);
    }, 'image/png');
  });
}

function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/**
 * Short looping video: subject pushes out of the frame.
 * Uses MediaRecorder on a 2D canvas redrawn each frame.
 */
export async function exportEscapeLoop(opts = {}) {
  const {
    durationSec = 2.4,
    fps = 30,
    overflowFrom = 0.05,
    overflowTo = 0.42,
    width = 720,
    onStatus,
    ...rest
  } = opts;

  const frames = Math.round(durationSec * fps);
  const canvas = await renderBreakFrame({
    ...rest,
    width,
    overflow: overflowFrom,
  });
  // Reuse same size for recorder
  const recCanvas = document.createElement('canvas');
  recCanvas.width = canvas.width;
  recCanvas.height = canvas.height;
  const ctx = recCanvas.getContext('2d');

  const stream = recCanvas.captureStream(fps);
  const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ? 'video/webm;codecs=vp9'
    : MediaRecorder.isTypeSupported('video/webm')
      ? 'video/webm'
      : 'video/mp4';

  const chunks = [];
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };

  const done = new Promise((resolve) => {
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mime });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `fumoca-escape-loop.${mime.includes('webm') ? 'webm' : 'mp4'}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 3000);
      resolve(blob);
    };
  });

  recorder.start();
  onStatus?.('Recording escape loop…');

  for (let i = 0; i < frames; i++) {
    // Ping-pong: out then slightly back for a natural loop
    const t = i / (frames - 1);
    const wave = t < 0.7 ? easeInOut(t / 0.7) : easeInOut(1 - (t - 0.7) / 0.3) * 0.35 + 0.65;
    const overflow = overflowFrom + (overflowTo - overflowFrom) * wave;

    const frame = await renderBreakFrame({
      ...rest,
      width,
      overflow,
    });
    ctx.clearRect(0, 0, recCanvas.width, recCanvas.height);
    ctx.drawImage(frame, 0, 0);
    await new Promise((r) => setTimeout(r, 1000 / fps));
  }

  recorder.stop();
  stream.getTracks().forEach((t) => t.stop());
  onStatus?.('Escape loop downloaded');
  return done;
}

/**
 * Studio UI
 */
export function mountBreakFrameUI(container, { onStatus } = {}) {
  if (!container) return;

  let photoImg = null;

  container.innerHTML = `
    <div class="section">
      <div class="sec-head"><span class="sec-label">Break the frame</span><span class="sec-badge">FUN</span></div>
      <div class="sec-body">
        <div class="hint">Subject leaves the photo — plus iPhone-style text behind the subject, and a short escape loop.</div>

        <div class="ctrl-row" style="margin-top:8px"><span class="ctrl-label">Frame style</span></div>
        <select id="bfStyle" style="width:100%;padding:8px;border-radius:8px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:#fff;margin-bottom:8px">
          ${Object.entries(FRAME_STYLES)
            .map(([k, v]) => `<option value="${k}">${v.label}</option>`)
            .join('')}
        </select>

        <div class="ctrl-row">
          <span class="ctrl-label">How far it “leaves”</span>
          <span class="ctrl-val" id="bfOverflowVal">28%</span>
        </div>
        <input type="range" id="bfOverflow" min="5" max="55" value="28">

        <div class="ctrl-row">
          <span class="ctrl-label">Subject size</span>
          <span class="ctrl-val" id="bfScaleVal">115%</span>
        </div>
        <input type="range" id="bfScale" min="80" max="160" value="115">

        <div class="ctrl-row" style="margin-top:8px"><span class="ctrl-label">Depth text (behind subject)</span></div>
        <input type="text" id="bfDepthText" placeholder="e.g. 9:41  or  LIVE IN 3D"
          style="width:100%;padding:8px;border-radius:8px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:#fff;margin-bottom:6px">
        <div class="hint" style="margin-bottom:8px">Like iPhone lock screen — large type sits behind the subject.</div>

        <div class="ctrl-row"><span class="ctrl-label">Caption (on frame)</span></div>
        <input type="text" id="bfCaption" placeholder="Optional frame caption"
          style="width:100%;padding:8px;border-radius:8px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:#fff;margin-bottom:8px">

        <div class="btn-grid col2" style="margin-top:4px">
          <button type="button" class="ac-btn full" id="bfPhotoBtn">Use my photo</button>
          <button type="button" class="ac-btn lime full" id="bfExportBtn">Export PNG</button>
        </div>
        <div class="btn-grid col2" style="margin-top:6px">
          <button type="button" class="ac-btn cyan full" id="bfLockBtn">Depth lock screen</button>
          <button type="button" class="ac-btn full" id="bfLoopBtn">Escape loop video</button>
        </div>
        <div class="hint" style="margin-top:8px" id="bfHint">Frame the subject in the viewport (dark background works best for depth text). Then export.</div>
        <div id="bfPreview" style="margin-top:10px;border-radius:10px;overflow:hidden;border:1px solid rgba(255,255,255,.1);display:none"></div>
      </div>
    </div>
  `;

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.style.display = 'none';
  container.appendChild(fileInput);

  const readOpts = () => ({
    style: container.querySelector('#bfStyle')?.value || 'polaroid',
    overflow: Number(container.querySelector('#bfOverflow')?.value || 28) / 100,
    subjectScale: Number(container.querySelector('#bfScale')?.value || 115) / 100,
    caption: container.querySelector('#bfCaption')?.value || '',
    depthText: container.querySelector('#bfDepthText')?.value || '',
    photo: photoImg,
  });

  container.querySelector('#bfDepthText')?.addEventListener('change', (e) => {
    const text = e.target.value || '';
    const rec = window._fumocaCurrentRecord;
    if (rec) {
      rec.meta = { ...(rec.meta || {}), depthText: text };
      window._fumocaCurrentRecord = rec;
    }
    window._fumocaDepthText = text;
  });
  container.querySelector('#bfOverflow')?.addEventListener('input', (e) => {
    const el = container.querySelector('#bfOverflowVal');
    if (el) el.textContent = e.target.value + '%';
  });
  container.querySelector('#bfScale')?.addEventListener('input', (e) => {
    const el = container.querySelector('#bfScaleVal');
    if (el) el.textContent = e.target.value + '%';
  });

  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    try {
      photoImg = await loadImageFile(f);
      onStatus?.('Photo loaded');
      container.querySelector('#bfHint').textContent = `Using “${f.name}” as the flat image.`;
    } catch (err) {
      onStatus?.(err.message);
    }
  });

  container.querySelector('#bfPhotoBtn')?.addEventListener('click', () => fileInput.click());

  container.querySelector('#bfExportBtn')?.addEventListener('click', async () => {
    onStatus?.('Rendering break-the-frame…');
    try {
      const opts = readOpts();
      const canvas = await renderBreakFrame(opts);
      const preview = container.querySelector('#bfPreview');
      if (preview) {
        preview.style.display = 'block';
        preview.innerHTML = '';
        const img = document.createElement('img');
        img.src = canvas.toDataURL('image/png');
        img.style.width = '100%';
        preview.appendChild(img);
      }
      await downloadBreakFrame(opts);
      onStatus?.('PNG downloaded');
    } catch (err) {
      onStatus?.(err.message || String(err));
      console.error('[break-frame]', err);
    }
  });

  container.querySelector('#bfLockBtn')?.addEventListener('click', async () => {
    onStatus?.('Rendering depth lock screen…');
    try {
      const depthText = container.querySelector('#bfDepthText')?.value || '9:41';
      const canvas = await renderDepthLockScreen({ depthText, subText: container.querySelector('#bfCaption')?.value || '' });
      const preview = container.querySelector('#bfPreview');
      if (preview) {
        preview.style.display = 'block';
        preview.innerHTML = '';
        const img = document.createElement('img');
        img.src = canvas.toDataURL('image/png');
        img.style.width = '100%';
        preview.appendChild(img);
      }
      await downloadDepthLockScreen({ depthText, subText: container.querySelector('#bfCaption')?.value || '' });
      onStatus?.('Depth lock screen PNG downloaded');
    } catch (err) {
      onStatus?.(err.message || String(err));
    }
  });

  container.querySelector('#bfLoopBtn')?.addEventListener('click', async () => {
    onStatus?.('Recording escape loop (a few seconds)…');
    try {
      const opts = readOpts();
      await exportEscapeLoop({
        ...opts,
        durationSec: 2.5,
        fps: 24,
        width: 720,
        onStatus,
      });
    } catch (err) {
      onStatus?.(err.message || String(err));
      console.error('[escape-loop]', err);
    }
  });
}

export { FRAME_STYLES };

if (typeof window !== 'undefined') {
  window.FUMOCA_BreakFrame = {
    renderBreakFrame,
    renderDepthLockScreen,
    downloadBreakFrame,
    downloadDepthLockScreen,
    exportEscapeLoop,
    extractSubjectLayer,
    mountBreakFrameUI,
    FRAME_STYLES,
  };
}
