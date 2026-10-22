/**
 * FUMOCA Review Video v2.1
 * Viewer + Editor: layouts + from-device upload
 */
const STORAGE = 'fumoca_review_video_v2';
const LAYOUTS = ['pip', 'bg', 'split', 'stack', 'cinema', 'hidden'];

let video = null;
let root = null;
let controls = null;
let layout = 'pip';
let src = null;
let objectUrl = null; // local file blob URL
let raf = 0;
let studioBar = null;

function isEditor() {
  return /\/edit/i.test(location.pathname) || document.body?.classList?.contains('editor');
}

function idKey() {
  const q = new URLSearchParams(location.search);
  return (
    q.get('nifId') ||
    q.get('splatId') ||
    q.get('id') ||
    window._fumocaCurrentSplatId ||
    window._fumocaCurrentRecord?.id ||
    'default'
  );
}

function loadSaved() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE) || '{}')[idKey()] || null;
  } catch {
    return null;
  }
}

function saveSaved(data) {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE) || '{}');
    all[idKey()] = data;
    localStorage.setItem(STORAGE, JSON.stringify(all));
  } catch (_) {}
}

function resolveSrc() {
  const q = new URLSearchParams(location.search);
  const fromQ = q.get('review') || q.get('video') || q.get('reviewVideo');
  if (fromQ) return fromQ;
  const rec = window._fumocaCurrentRecord;
  const meta = rec?.meta || rec?.metadata || {};
  if (meta.reviewVideo?.url) return meta.reviewVideo.url;
  if (meta.review_video_url) return meta.review_video_url;
  if (rec?.review_video_url) return rec.review_video_url;
  const saved = loadSaved();
  // blob: only valid this session — skip if stale
  if (saved?.url && !String(saved.url).startsWith('blob:')) return saved.url;
  return null;
}

function ensureCss() {
  if (document.querySelector('link[href*="review-video.css"]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'css/review-video.css';
  document.head.appendChild(link);
}

function ensureDom() {
  if (root) return;
  root = document.createElement('div');
  root.id = 'fumocaReviewRoot';
  video = document.createElement('video');
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.preload = 'auto';
  video.controls = false;
  root.appendChild(video);
  document.body.insertBefore(root, document.body.firstChild);

  controls = document.createElement('div');
  controls.id = 'fumocaReviewControls';
  controls.innerHTML = `
    <span class="rv-brand">Review</span>
    <button type="button" data-act="play" class="primary">▶ Play</button>
    <button type="button" data-act="back">−10</button>
    <button type="button" data-act="fwd">+10</button>
    <input type="range" data-act="seek" min="0" max="1000" value="0" />
    <span class="rv-time">0:00 / 0:00</span>
    <button type="button" data-act="mute">🔊</button>
    <div class="rv-layouts">
      <button type="button" data-layout="pip">PIP</button>
      <button type="button" data-layout="bg">BG</button>
      <button type="button" data-layout="split">Split</button>
      <button type="button" data-layout="stack">Stack</button>
      <button type="button" data-layout="cinema">Cinema</button>
      <button type="button" data-layout="hidden">Off</button>
    </div>
  `;
  document.body.appendChild(controls);

  controls.addEventListener('click', onClick);
  controls.querySelector('[data-act="seek"]')?.addEventListener('input', onSeek);
  ['pointerdown', 'pointermove', 'wheel', 'touchstart'].forEach((ev) => {
    controls.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
  });

  video.addEventListener('click', (e) => {
    if (layout !== 'pip') return;
    e.stopPropagation();
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  });
}

function fmt(t) {
  if (!Number.isFinite(t) || t < 0) return '0:00';
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function tick() {
  if (!video || !controls) return;
  const seek = controls.querySelector('[data-act="seek"]');
  const time = controls.querySelector('.rv-time');
  if (video.duration && seek) {
    seek.value = String(Math.round((video.currentTime / video.duration) * 1000));
  }
  if (time) time.textContent = `${fmt(video.currentTime)} / ${fmt(video.duration || 0)}`;
  const playBtn = controls.querySelector('[data-act="play"]');
  if (playBtn) playBtn.textContent = video.paused ? '▶ Play' : '❚❚ Pause';
  raf = requestAnimationFrame(tick);
}

function onSeek(e) {
  if (!video?.duration) return;
  video.currentTime = (Number(e.target.value) / 1000) * video.duration;
}

function clearBodyLayoutClasses() {
  LAYOUTS.forEach((l) => document.body.classList.remove('rv-layout-' + l));
  document.body.classList.remove('rv-active');
}

function setLayout(next) {
  if (!LAYOUTS.includes(next)) next = 'pip';
  layout = next;
  root.className = 'layout-' + layout;
  clearBodyLayoutClasses();
  if (layout !== 'hidden' && src) {
    document.body.classList.add('rv-active', 'rv-layout-' + layout);
  }
  controls.querySelectorAll('[data-layout]').forEach((b) => {
    b.classList.toggle('active', b.dataset.layout === layout);
  });
  video.style.pointerEvents = layout === 'pip' ? 'auto' : 'none';
  if (src && !String(src).startsWith('blob:')) saveSaved({ url: src, layout });
  else saveSaved({ layout, url: src && !String(src).startsWith('blob:') ? src : undefined });
  setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
}

function onClick(e) {
  const layoutBtn = e.target.closest('[data-layout]');
  if (layoutBtn) {
    e.preventDefault();
    e.stopPropagation();
    setLayout(layoutBtn.dataset.layout);
    return;
  }
  const btn = e.target.closest('button[data-act]');
  if (!btn || !video) return;
  e.preventDefault();
  e.stopPropagation();
  const act = btn.dataset.act;
  if (act === 'play') {
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  }
  if (act === 'back') video.currentTime = Math.max(0, video.currentTime - 10);
  if (act === 'fwd') video.currentTime = Math.min(video.duration || 0, video.currentTime + 10);
  if (act === 'mute') {
    video.muted = !video.muted;
    btn.textContent = video.muted ? '🔇' : '🔊';
  }
}

export function setReviewVideo(url, opts = {}) {
  ensureCss();
  ensureDom();
  src = url || null;
  if (!src) {
    setLayout('hidden');
    controls.style.display = 'none';
    return;
  }
  controls.style.display = 'flex';
  video.src = src;
  video.load();
  setLayout(opts.layout || layout || 'pip');
  if (opts.autoplay) {
    video.muted = true;
    video.play().catch(() => {});
  }
  if (!String(src).startsWith('blob:')) saveSaved({ url: src, layout });
  if (!raf) raf = requestAnimationFrame(tick);
}

/** Pick MP4/WebM from device — works in Editor & Viewer */
export function pickFromDevice(opts = {}) {
  ensureCss();
  ensureDom();
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'video/mp4,video/webm,video/quicktime,video/*';
  input.style.display = 'none';
  document.body.appendChild(input);
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;
    if (objectUrl) {
      try { URL.revokeObjectURL(objectUrl); } catch (_) {}
    }
    objectUrl = URL.createObjectURL(file);
    setReviewVideo(objectUrl, {
      layout: opts.layout || layout || 'stack',
      autoplay: opts.autoplay !== false,
    });
    // Studio status
    const status = document.getElementById('rvUploadStatus');
    if (status) {
      status.textContent = file.name + ' · this session only (upload to CDN to share)';
    }
    window.dispatchEvent(
      new CustomEvent('fumoca:reviewVideoLocal', {
        detail: { name: file.name, size: file.size, type: file.type },
      })
    );
  });
  input.click();
}

function mountStudioUpload() {
  if (studioBar) return;
  const host =
    document.getElementById('fumocaPresentBar') ||
    document.getElementById('stage') ||
    document.getElementById('viewport') ||
    document.body;

  studioBar = document.createElement('div');
  studioBar.id = 'fumocaReviewStudio';
  studioBar.innerHTML = `
    <div class="fp-card" style="background:rgba(8,10,14,.92);border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:10px 12px;margin-top:8px;max-width:280px;font-family:Inter,system-ui,sans-serif">
      <div style="font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.45);margin-bottom:8px">Review video</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px">
        <button type="button" id="rvPickBtn" style="padding:7px 11px;border-radius:8px;border:none;background:#c8ff00;color:#0a0c10;font:600 11px Inter,system-ui;cursor:pointer">Upload from device</button>
        <button type="button" id="rvUrlBtn" style="padding:7px 11px;border-radius:8px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:#e8e8e8;font:600 11px Inter,system-ui;cursor:pointer">Paste URL</button>
        <button type="button" id="rvClearBtn" style="padding:7px 11px;border-radius:8px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:#e8e8e8;font:600 11px Inter,system-ui;cursor:pointer">Clear</button>
      </div>
      <div id="rvUploadStatus" style="margin-top:8px;font-size:10px;color:rgba(255,255,255,.4);line-height:1.35">MP4 / WebM from phone or PC</div>
    </div>
  `;
  // Prefer under present bar
  if (host.id === 'fumocaPresentBar') host.appendChild(studioBar);
  else {
    studioBar.style.cssText = 'position:absolute;left:12px;bottom:160px;z-index:43;pointer-events:auto';
    host.appendChild(studioBar);
  }

  studioBar.querySelector('#rvPickBtn')?.addEventListener('click', () => pickFromDevice({ layout: 'stack' }));
  studioBar.querySelector('#rvUrlBtn')?.addEventListener('click', () => {
    const u = prompt('Direct MP4 URL (https://…mp4)', 'https://');
    if (u && u.startsWith('http')) setReviewVideo(u, { layout: 'stack' });
  });
  studioBar.querySelector('#rvClearBtn')?.addEventListener('click', () => {
    if (objectUrl) {
      try { URL.revokeObjectURL(objectUrl); } catch (_) {}
      objectUrl = null;
    }
    setReviewVideo(null);
    const status = document.getElementById('rvUploadStatus');
    if (status) status.textContent = 'Cleared';
  });
}

export function initReviewVideo(opts = {}) {
  ensureCss();
  ensureDom();
  const saved = loadSaved();
  if (saved?.layout) layout = saved.layout;
  const url = resolveSrc();
  if (url) setReviewVideo(url, { layout, autoplay: !!opts.autoplay });
  else if (controls) controls.style.display = 'none';

  window.addEventListener('fumoca:recordLoaded', () => {
    const u = resolveSrc();
    if (u) setReviewVideo(u, { layout });
  });

  // Editor: upload card
  if (opts.studio !== false && (isEditor() || opts.studio === true)) {
    const tryMount = () => mountStudioUpload();
    tryMount();
    setTimeout(tryMount, 800);
    setTimeout(tryMount, 2000);
  }

  window.FumocaReviewVideo = {
    set: setReviewVideo,
    setLayout,
    pickFromDevice,
    play: () => video?.play(),
    pause: () => video?.pause(),
    getSrc: () => src,
    getLayout: () => layout,
  };
  return window.FumocaReviewVideo;
}

if (typeof window !== 'undefined') {
  const boot = () => {
    try {
      initReviewVideo({ autoplay: false, studio: true });
    } catch (e) {
      console.warn('[review-video]', e);
    }
  };
  if (document.readyState === 'complete') setTimeout(boot, 500);
  else window.addEventListener('load', () => setTimeout(boot, 500));
}
