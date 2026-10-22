/**
 * FUMOCA Studio — Splat Music + Status Video Share
 * ════════════════════════════════════════════════
 * - Upload / trim background music for a splat (plays when viewers open / share)
 * - Record a vertical status video (WhatsApp / IG) with optional music
 * - Upload teaser → public link + Web Share
 */
import * as SceneAudio from './scene-audio.js';

function $(id) {
  return document.getElementById(id);
}
function status(msg, kind) {
  if (typeof window.status === 'function' && window.status !== status) {
    try {
      window.status(msg);
    } catch (_) {}
  }
  const el = $('statusText');
  if (el) el.textContent = msg;
  const sb = $('statusBar');
  if (sb && kind) {
    sb.classList.remove('busy', 'ok', 'warn');
    if (kind) sb.classList.add(kind);
  }
  console.log('[MusicShare]', msg);
}

function getRecord() {
  return window._fumocaCurrentRecord || {};
}

function getMeta() {
  const rec = getRecord();
  return { ...(rec.meta || {}), ...(rec.metadata || {}) };
}

async function uploadAudioToR2(file) {
  // Prefer existing platform upload helpers
  if (typeof window.uploadToR2 === 'function') {
    return window.uploadToR2(file, { folder: 'audio', contentType: file.type || 'audio/mpeg' });
  }
  if (typeof window.fumocaUploadFile === 'function') {
    return window.fumocaUploadFile(file, 'audio');
  }
  // Fallback: data URL (works for preview; publish may need R2)
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve({ publicUrl: r.result, key: null, local: true });
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function readMusicForm() {
  const url = $('smUrl')?.value?.trim() || '';
  const volume = Math.min(1, Math.max(0, (Number($('smVol')?.value) || 35) / 100));
  const loop = $('smLoop')?.checked !== false;
  const trimStart = Math.max(0, Number($('smTrimStart')?.value) || 0);
  let trimEnd = $('smTrimEnd')?.value;
  trimEnd = trimEnd === '' || trimEnd == null ? null : Math.max(trimStart + 0.5, Number(trimEnd));
  return { url, volume, loop, trimStart, trimEnd };
}

function applyMusicToWindow(cfg) {
  window._fumocaSceneAudio = {
    bed: {
      url: cfg.url,
      volume: cfg.volume,
      loop: cfg.loop,
      trimStart: cfg.trimStart,
      trimEnd: cfg.trimEnd,
    },
    mutedDefault: true,
  };
  // Legacy fields for viewer.html ambient path
  const rec = getRecord();
  rec.ambient_audio_url = cfg.url;
  rec.ambient_audio_volume = cfg.volume;
  rec.ambient_audio_loop = cfg.loop;
  rec.ambient_audio_trim_start = cfg.trimStart;
  rec.ambient_audio_trim_end = cfg.trimEnd;
  rec.meta = rec.meta || {};
  rec.meta.sceneAudio = window._fumocaSceneAudio;
  window._fumocaCurrentRecord = rec;
}

export function getMusicPublishPayload() {
  const sa = window._fumocaSceneAudio;
  if (!sa?.bed?.url) return {};
  return {
    ambient_audio_url: sa.bed.url,
    ambient_audio_volume: sa.bed.volume,
    ambient_audio_loop: sa.bed.loop,
    ambient_audio_trim_start: sa.bed.trimStart ?? 0,
    ambient_audio_trim_end: sa.bed.trimEnd ?? null,
    meta: {
      sceneAudio: sa,
    },
  };
}

function buildPanelHTML() {
  return `
  <div class="section" id="splatMusicPanel">
    <div class="sec-head"><span class="sec-label">🎵 Scene music</span><span class="sec-badge">SPLAT</span></div>
    <div class="sec-body">
      <div class="hint">Background track while people view or share this splat. Trim the section you want; it loops in the viewer.</div>
      <input type="file" id="smFile" accept="audio/*,.mp3,.m4a,.wav,.ogg" style="display:none">
      <button type="button" class="ac-btn lime full" id="smPickBtn" style="margin:8px 0">📁 Choose MP3 / audio file</button>
      <div class="hint" id="smFileName" style="margin-bottom:6px">No file chosen</div>
      <input type="url" id="smUrl" placeholder="Or paste https://…/track.mp3"
        style="width:100%;padding:8px;border-radius:8px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:#fff;margin-bottom:8px">
      <div class="ctrl-row"><span class="ctrl-label">Volume</span><span class="ctrl-val" id="smVolVal">35%</span></div>
      <input type="range" id="smVol" min="0" max="100" value="35">
      <div class="ctrl-row" style="margin-top:8px"><span class="ctrl-label">Trim start (s)</span></div>
      <input type="number" id="smTrimStart" min="0" step="0.5" value="0"
        style="width:100%;padding:6px;border-radius:6px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:#fff">
      <div class="ctrl-row" style="margin-top:6px"><span class="ctrl-label">Trim end (s, empty = full)</span></div>
      <input type="number" id="smTrimEnd" min="0" step="0.5" placeholder="optional"
        style="width:100%;padding:6px;border-radius:6px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:#fff">
      <label style="display:flex;align-items:center;gap:8px;margin:10px 0;font-size:12px;color:rgba(255,255,255,.75)">
        <input type="checkbox" id="smLoop" checked> Loop in viewer
      </label>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button type="button" class="ac-btn amber" id="smPreviewBtn">▶ Preview</button>
        <button type="button" class="ac-btn" id="smStopBtn">Stop</button>
        <button type="button" class="ac-btn lime full" id="smSaveBtn" style="flex:1">Save music on splat</button>
      </div>
      <div class="hint" id="smStatus" style="margin-top:8px">No music set</div>
    </div>
  </div>
  <div class="section" id="splatStatusVideoPanel" style="margin-top:12px">
    <div class="sec-head"><span class="sec-label">📱 Status / share video</span><span class="sec-badge">9:16</span></div>
    <div class="sec-body">
      <div class="hint">Record a vertical clip for WhatsApp Status, IG Stories, TikTok. Music is mixed in if set. You get a download + shareable link.</div>
      <div class="ctrl-row"><span class="ctrl-label">Duration</span><span class="ctrl-val" id="svDurVal">8s</span></div>
      <input type="range" id="svDur" min="4" max="30" value="8">
      <label style="display:flex;align-items:center;gap:8px;margin:10px 0;font-size:12px;color:rgba(255,255,255,.75)">
        <input type="checkbox" id="svMixMusic" checked> Mix scene music into video
      </label>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button type="button" class="ac-btn cyan full" id="svRecordBtn">⏺ Record status video</button>
        <button type="button" class="ac-btn full" id="svShareLinkBtn" disabled>↗ Copy share link</button>
      </div>
      <div class="hint" id="svStatus" style="margin-top:8px">Ready</div>
      <video id="svPreview" controls playsinline style="display:none;width:100%;margin-top:8px;border-radius:10px;background:#000;max-height:280px"></video>
    </div>
  </div>`;
}

async function onUploadFile(file) {
  if (!file) return;
  const nameEl = $('smFileName');
  if (nameEl) nameEl.textContent = file.name + ' · ' + (file.size / 1e6).toFixed(2) + ' MB';
  // Local preview immediately (works even if R2 upload fails)
  const localUrl = URL.createObjectURL(file);
  window._fumocaLocalMusicBlob = file;
  window._fumocaLocalMusicUrl = localUrl;
  $('smUrl').value = localUrl;
  status('Loading track…', 'busy');
  $('smStatus').textContent = 'Loading local file…';
  const a = new Audio(localUrl);
  a.addEventListener('loadedmetadata', () => {
    $('smStatus').textContent = `Ready · ${a.duration.toFixed(1)}s — Preview, trim, then Save`;
    status('Track ready — Preview then Save', 'ok');
  });
  // Try permanent R2 upload in background
  try {
    $('smStatus').textContent = 'Uploading to storage…';
    const res = await uploadAudioToR2(file);
    const url = res?.publicUrl || res?.url || res;
    if (url && typeof url === 'string' && !url.startsWith('blob:')) {
      $('smUrl').value = url;
      $('smStatus').textContent = 'Uploaded ✓ — Preview, trim, then Save music on splat';
      status('Music uploaded', 'ok');
    } else if (url && typeof url === 'string') {
      $('smUrl').value = url;
      $('smStatus').textContent = 'Local only — Save works for this session; Publish needs R2 URL';
    }
  } catch (e) {
    console.warn('[MusicShare] R2 upload', e);
    $('smStatus').textContent = 'Local preview OK — Save for this session. For public viewers, host the MP3 and paste a https://…/file.mp3 URL.';
    status('Using local file (upload helper missing)', 'warn');
  }
}

async function onPreview() {
  const cfg = readMusicForm();
  if (!cfg.url) {
    status('Add a file or URL first', 'warn');
    return;
  }
  applyMusicToWindow(cfg);
  await SceneAudio.playSceneBed(window._fumocaSceneAudio, { force: true });
  $('smStatus').textContent = 'Playing preview…';
}

function onStop() {
  SceneAudio.stopSceneBed();
  $('smStatus').textContent = 'Stopped';
}

function onSave() {
  const cfg = readMusicForm();
  if (!cfg.url) {
    status('Add music URL or upload a file', 'warn');
    return;
  }
  applyMusicToWindow(cfg);
  $('smStatus').textContent = 'Saved on this session — Publish / Save listing to keep it';
  status('Scene music saved — publish to ship with splat', 'ok');
  // Try live save if available
  if (typeof window.saveLiveEdit === 'function') {
    window
      .saveLiveEdit({
        ambient_audio_url: cfg.url,
        ambient_audio_volume: cfg.volume,
        ambient_audio_loop: cfg.loop,
        ambient_audio_trim_start: cfg.trimStart,
        ambient_audio_trim_end: cfg.trimEnd,
        meta: { sceneAudio: window._fumocaSceneAudio },
      })
      .then(() => {
        $('smStatus').textContent = 'Saved to listing ✓';
        status('Music saved to listing', 'ok');
      })
      .catch((e) => console.warn('[MusicShare] saveLiveEdit', e));
  }
}

function getViewerCanvas() {
  // Prefer the real THREE WebGL canvas in Studio (#viewport)
  const gl =
    window._fumocaGlRenderer?.domElement ||
    window.renderer?.domElement ||
    document.querySelector('#viewport canvas') ||
    document.querySelector('#viewer canvas') ||
    document.querySelector('canvas');
  return gl || null;
}

function forceRenderFrame() {
  try {
    const r = window._fumocaGlRenderer || window.renderer;
    const s = window._fumocaScene || window.scene;
    const c = window._fumocaCamera || window.camera;
    const o = window._fumocaOrbitControls || window.controls;
    if (o) o.update();
    if (r && s && c) r.render(s, c);
  } catch (_) {}
}

async function recordStatusVideo() {
  const canvas = getViewerCanvas();
  if (!canvas) {
    status('Load a splat first', 'warn');
    $('svStatus').textContent = 'No viewer canvas';
    return;
  }
  // WebGL must keep the buffer for drawImage (set in edit.html)
  try {
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    // cannot change preserveDrawingBuffer after creation — relies on renderer flag
  } catch (_) {}

  const seconds = Number($('svDur')?.value) || 8;
  const mixMusic = $('svMixMusic')?.checked !== false;
  const cfg = readMusicForm();
  $('svRecordBtn').disabled = true;
  $('svStatus').textContent = `Recording ${seconds}s (9:16)… keep this tab visible`;
  status('Recording status video…', 'busy');

  // Ensure at least one painted frame exists
  forceRenderFrame();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  const W = 1080;
  const H = 1920;
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const ctx = out.getContext('2d', { alpha: false });

  // Auto-orbit during capture
  const controls = window._fumocaOrbitControls || window.controls;
  const prevAuto = controls?.autoRotate;
  const prevSpeed = controls?.autoRotateSpeed;
  if (controls) {
    controls.autoRotate = true;
    controls.autoRotateSpeed = 4.0;
  }

  let raf = 0;
  let framesDrawn = 0;
  const draw = () => {
    forceRenderFrame();
    ctx.fillStyle = '#05070b';
    ctx.fillRect(0, 0, W, H);
    const cw = canvas.width;
    const ch = canvas.height;
    if (cw > 0 && ch > 0) {
      // object-fit: cover into 9:16
      const srcRatio = cw / ch;
      const dstRatio = W / H;
      let sx = 0, sy = 0, sW = cw, sH = ch;
      if (srcRatio > dstRatio) {
        sW = ch * dstRatio;
        sx = (cw - sW) / 2;
      } else {
        sH = cw / dstRatio;
        sy = (ch - sH) / 2;
      }
      try {
        ctx.drawImage(canvas, sx, sy, sW, sH, 0, 0, W, H);
        framesDrawn++;
      } catch (e) {
        console.warn('[StatusVideo] drawImage', e);
      }
    }
    // Branding strip
    const stripH = 120;
    const g = ctx.createLinearGradient(0, H - stripH, 0, H);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.88)');
    ctx.fillStyle = g;
    ctx.fillRect(0, H - stripH, W, stripH);
    ctx.fillStyle = '#c8ff00';
    ctx.font = 'bold 36px system-ui,sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('FUMOCA', 48, H - 56);
    ctx.fillStyle = 'rgba(255,255,255,.8)';
    ctx.font = '24px system-ui,sans-serif';
    ctx.fillText('View in 3D · fumoca.co.za', 48, H - 24);
    raf = requestAnimationFrame(draw);
  };
  draw();

  // Warm up a few frames before MediaRecorder starts
  await new Promise((r) => setTimeout(r, 400));

  let stream;
  try {
    stream = out.captureStream(30);
  } catch (e) {
    // Fallback: capture WebGL canvas directly (may not be 9:16)
    console.warn('[StatusVideo] compositor stream failed, using GL canvas', e);
    stream = canvas.captureStream(30);
  }

  let audioCtx = null;
  try {
    if (mixMusic && cfg.url && window.AudioContext) {
      audioCtx = new AudioContext();
      const dest = audioCtx.createMediaStreamDestination();
      const audio = new Audio(cfg.url);
      audio.crossOrigin = 'anonymous';
      audio.loop = true;
      await new Promise((res) => {
        audio.addEventListener('loadeddata', res, { once: true });
        audio.load();
        setTimeout(res, 1500);
      });
      try {
        audio.currentTime = cfg.trimStart || 0;
      } catch (_) {}
      const src = audioCtx.createMediaElementSource(audio);
      const gain = audioCtx.createGain();
      gain.gain.value = cfg.volume ?? 0.35;
      src.connect(gain);
      gain.connect(dest);
      gain.connect(audioCtx.destination);
      await audio.play().catch(() => {});
      dest.stream.getAudioTracks().forEach((tr) => stream.addTrack(tr));
      stream._fumocaAudio = audio;
    }
  } catch (e) {
    console.warn('[StatusVideo] audio mix skip', e);
  }

  const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
    ? 'video/webm;codecs=vp9,opus'
    : MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
      ? 'video/webm;codecs=vp8,opus'
      : MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : 'video/webm';
  const chunks = [];
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  rec.ondataavailable = (e) => {
    if (e.data?.size) chunks.push(e.data);
  };

  const blob = await new Promise((resolve, reject) => {
    rec.onerror = () => reject(new Error('MediaRecorder error'));
    rec.onstop = () => resolve(new Blob(chunks, { type: mime }));
    rec.start(100);
    setTimeout(() => {
      try {
        rec.stop();
      } catch (e) {
        reject(e);
      }
    }, seconds * 1000);
  });

  cancelAnimationFrame(raf);
  if (controls) {
    controls.autoRotate = prevAuto || false;
    if (prevSpeed != null) controls.autoRotateSpeed = prevSpeed;
  }
  try {
    stream._fumocaAudio?.pause();
  } catch (_) {}
  try {
    audioCtx?.close();
  } catch (_) {}
  try {
    stream.getTracks().forEach((tr) => tr.stop());
  } catch (_) {}

  if (framesDrawn < 5) {
    $('svStatus').textContent = 'Capture may be blank — keep the Studio tab visible and try again';
    status('Few frames captured', 'warn');
  }

  console.log('[StatusVideo] framesDrawn=', framesDrawn, 'blobMB=', (blob.size / 1e6).toFixed(2));

const blobUrl = URL.createObjectURL(blob);
  const vid = $('svPreview');
  if (vid) {
    vid.src = blobUrl;
    vid.style.display = 'block';
  }
  window._fumocaLastStatusBlob = blob;
  window._fumocaLastStatusBlobUrl = blobUrl;

  // Upload for shareable link
  let publicUrl = null;
  try {
    $('svStatus').textContent = 'Uploading share link…';
    const file = new File([blob], `status_${Date.now()}.webm`, { type: blob.type });
    if (typeof window.uploadToR2 === 'function') {
      const up = await window.uploadToR2(file, { folder: 'teasers', contentType: blob.type });
      publicUrl = up?.publicUrl || up?.url;
    } else if (typeof window.saveLiveEdit === 'function') {
      // teaser path via existing social recorder if present
      publicUrl = null;
    }
    if (publicUrl) {
      window._fumocaLastStatusUrl = publicUrl;
      const rec2 = getRecord();
      rec2.teaser_video_url = publicUrl;
      rec2.meta = { ...(rec2.meta || {}), teaser_video_url: publicUrl, status_video_url: publicUrl };
      if (typeof window.saveLiveEdit === 'function') {
        await window.saveLiveEdit({
          teaser_video_url: publicUrl,
          meta: { status_video_url: publicUrl, teaser_video_url: publicUrl },
        });
      }
      $('svShareLinkBtn').disabled = false;
      $('svStatus').textContent = `Ready · ${(blob.size / 1e6).toFixed(1)} MB — download or copy link`;
    } else {
      $('svStatus').textContent = `Recorded · ${(blob.size / 1e6).toFixed(1)} MB — use Download (link upload unavailable)`;
      // Offer download
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = 'fumoca-status.webm';
      a.textContent = '⬇ Download video';
      a.className = 'ac-btn lime full';
      a.style.display = 'block';
      a.style.marginTop = '8px';
      a.style.textAlign = 'center';
      $('svStatus')?.parentElement?.appendChild(a);
    }
  } catch (e) {
    console.warn(e);
    $('svStatus').textContent = `Recorded offline · ${(blob.size / 1e6).toFixed(1)} MB`;
  }

  // Web Share with file when possible (Android WhatsApp etc.)
  try {
    const file = new File([blob], 'fumoca-status.webm', { type: blob.type });
    if (navigator.canShare?.({ files: [file] })) {
      $('svStatus').textContent += ' · Share sheet available';
      window._fumocaShareStatusFile = async () => {
        await navigator.share({
          files: [file],
          title: 'FUMOCA',
          text: 'View in 3D on FUMOCA',
        });
      };
    }
  } catch (_) {}

  $('svRecordBtn').disabled = false;
  status('Status video ready', 'ok');
}

function onCopyShareLink() {
  const url =
    window._fumocaLastStatusUrl ||
    getRecord().teaser_video_url ||
    getRecord()?.meta?.status_video_url;
  if (!url) {
    status('No share link yet — record first', 'warn');
    return;
  }
  navigator.clipboard?.writeText(url).then(
    () => {
      status('Link copied', 'ok');
      $('svStatus').textContent = 'Link copied to clipboard';
    },
    () => status('Copy failed', 'warn')
  );
  if (navigator.share) {
    navigator.share({ title: 'FUMOCA status', url, text: '3D on FUMOCA' }).catch(() => {});
  }
}

export function mountSplatMusicShare(root) {
  if (!root) return;
  root.innerHTML = buildPanelHTML();

  // Restore existing music
  const meta = getMeta();
  const cfg = SceneAudio.getSceneAudioConfig(meta, getRecord());
  if (cfg?.bed?.url) {
    $('smUrl').value = cfg.bed.url;
    $('smVol').value = Math.round((cfg.bed.volume ?? 0.35) * 100);
    $('smVolVal').textContent = `${$('smVol').value}%`;
    $('smTrimStart').value = cfg.bed.trimStart ?? 0;
    if (cfg.bed.trimEnd != null) $('smTrimEnd').value = cfg.bed.trimEnd;
    $('smLoop').checked = cfg.bed.loop !== false;
    $('smStatus').textContent = 'Music loaded from listing';
    applyMusicToWindow({
      url: cfg.bed.url,
      volume: cfg.bed.volume ?? 0.35,
      loop: cfg.bed.loop !== false,
      trimStart: cfg.bed.trimStart ?? 0,
      trimEnd: cfg.bed.trimEnd ?? null,
    });
  }

  $('smVol')?.addEventListener('input', () => {
    $('smVolVal').textContent = `${$('smVol').value}%`;
  });
  $('svDur')?.addEventListener('input', () => {
    $('svDurVal').textContent = `${$('svDur').value}s`;
  });
  $('smPickBtn')?.addEventListener('click', () => $('smFile')?.click());
  $('smFile')?.addEventListener('change', (e) => onUploadFile(e.target.files?.[0]));
  $('smPreviewBtn')?.addEventListener('click', () => onPreview());
  $('smStopBtn')?.addEventListener('click', () => onStop());
  $('smSaveBtn')?.addEventListener('click', () => onSave());
  $('svRecordBtn')?.addEventListener('click', () => recordStatusVideo());
  $('svShareLinkBtn')?.addEventListener('click', () => onCopyShareLink());
}

export function installSplatMusicShare() {
  const root = document.getElementById('studioAudioRoot');
  if (root) mountSplatMusicShare(root);
  // Hook publish payload
  window.FUMOCA_getMusicPublishPayload = getMusicPublishPayload;
}

if (typeof window !== 'undefined') {
  window.FUMOCA_SplatMusicShare = { mountSplatMusicShare, installSplatMusicShare, getMusicPublishPayload };
}
