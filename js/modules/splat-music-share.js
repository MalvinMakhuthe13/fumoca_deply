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
      <input type="file" id="smFile" accept="audio/*,.mp3,.m4a,.wav,.ogg" style="width:100%;margin:8px 0;color:#fff;font-size:12px">
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
  status('Uploading music…', 'busy');
  $('smStatus').textContent = 'Uploading…';
  try {
    const res = await uploadAudioToR2(file);
    const url = res?.publicUrl || res?.url || res;
    if (!url || typeof url !== 'string') throw new Error('Upload returned no URL');
    $('smUrl').value = url;
    // Probe duration for trim max hint
    const a = new Audio(url);
    a.addEventListener('loadedmetadata', () => {
      $('smStatus').textContent = `Loaded · ${a.duration.toFixed(1)}s — set trim if needed, then Save`;
    });
    status('Music uploaded', 'ok');
  } catch (e) {
    $('smStatus').textContent = e.message || String(e);
    status(e.message || 'Upload failed', 'warn');
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
  return (
    document.querySelector('#viewer canvas') ||
    document.querySelector('canvas.viewer') ||
    document.querySelector('canvas') ||
    window._fumocaViewer?.renderer?.domElement
  );
}

async function recordStatusVideo() {
  const canvas = getViewerCanvas();
  if (!canvas) {
    status('Load a splat first', 'warn');
    $('svStatus').textContent = 'No viewer canvas';
    return;
  }
  const seconds = Number($('svDur')?.value) || 8;
  const mixMusic = $('svMixMusic')?.checked !== false;
  const cfg = readMusicForm();
  $('svRecordBtn').disabled = true;
  $('svStatus').textContent = `Recording ${seconds}s (9:16)…`;
  status('Recording status video…', 'busy');

  // Compose 9:16 offscreen canvas
  const W = 1080;
  const H = 1920;
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const ctx = out.getContext('2d');
  let raf = 0;
  const draw = () => {
    ctx.fillStyle = '#05070b';
    ctx.fillRect(0, 0, W, H);
    const cw = canvas.width || canvas.clientWidth;
    const ch = canvas.height || canvas.clientHeight;
    if (cw && ch) {
      const scale = Math.max(W / cw, H / ch);
      const dw = cw * scale;
      const dh = ch * scale;
      ctx.drawImage(canvas, (W - dw) / 2, (H - dh) / 2, dw, dh);
    }
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    ctx.fillRect(0, H - 120, W, 120);
    ctx.fillStyle = '#c8ff00';
    ctx.font = 'bold 36px system-ui,sans-serif';
    ctx.fillText('FUMOCA', 48, H - 56);
    ctx.fillStyle = 'rgba(255,255,255,.75)';
    ctx.font = '24px system-ui,sans-serif';
    ctx.fillText('View in 3D · fumoca.co.za', 48, H - 24);
    raf = requestAnimationFrame(draw);
  };
  draw();

  // Optional orbit
  try {
    window._fumocaOrbit?.(true);
  } catch (_) {}

  const stream = out.captureStream(30);
  // Mix audio if possible
  let audioCtx = null;
  try {
    if (mixMusic && cfg.url && window.AudioContext) {
      audioCtx = new AudioContext();
      const dest = audioCtx.createMediaStreamDestination();
      const audio = new Audio(cfg.url);
      audio.crossOrigin = 'anonymous';
      audio.loop = true;
      audio.volume = cfg.volume;
      const start = cfg.trimStart || 0;
      await new Promise((res) => {
        audio.addEventListener('loadeddata', res, { once: true });
        audio.load();
        setTimeout(res, 2000);
      });
      try {
        audio.currentTime = start;
      } catch (_) {}
      const src = audioCtx.createMediaElementSource(audio);
      const gain = audioCtx.createGain();
      gain.gain.value = cfg.volume;
      src.connect(gain);
      gain.connect(dest);
      gain.connect(audioCtx.destination);
      await audio.play().catch(() => {});
      dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
      // stop audio later
      stream._fumocaAudio = audio;
    }
  } catch (e) {
    console.warn('[MusicShare] audio mix skip', e);
  }

  const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
    ? 'video/webm;codecs=vp9,opus'
    : MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
      ? 'video/webm;codecs=vp8,opus'
      : 'video/webm';
  const chunks = [];
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
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
  try {
    window._fumocaOrbit?.(false);
  } catch (_) {}
  try {
    stream._fumocaAudio?.pause();
  } catch (_) {}
  try {
    audioCtx?.close();
  } catch (_) {}
  stream.getTracks().forEach((t) => t.stop());

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
