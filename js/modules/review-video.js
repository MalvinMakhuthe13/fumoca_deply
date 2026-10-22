/**
 * FUMOCA Review Video v2
 * Visible layouts: PIP | BG | Split | Stack | Cinema | Off
 * 3D orbit never blocked by video (except intentional PIP tap).
 */
const STORAGE = 'fumoca_review_video_v2';
const LAYOUTS = ['pip', 'bg', 'split', 'stack', 'cinema', 'hidden'];

let video = null;
let root = null;
let controls = null;
let layout = 'pip';
let src = null;
let raf = 0;

function idKey() {
  const q = new URLSearchParams(location.search);
  return q.get('nifId') || q.get('splatId') || q.get('id') || 'default';
}

function loadSaved() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE) || '{}')[idKey()] || null;
  } catch { return null; }
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
  return loadSaved()?.url || null;
}

function ensureCss() {
  if (document.querySelector('link[href*="review-video.css"]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/css/review-video.css';
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
      <button type="button" data-layout="pip" title="Picture in picture">PIP</button>
      <button type="button" data-layout="bg" title="Bright background">BG</button>
      <button type="button" data-layout="split" title="Video | 3D side by side">Split</button>
      <button type="button" data-layout="stack" title="Video above 3D">Stack</button>
      <button type="button" data-layout="cinema" title="Video main, 3D card">Cinema</button>
      <button type="button" data-layout="hidden" title="Hide video">Off</button>
    </div>
  `;
  document.body.appendChild(controls);

  controls.addEventListener('click', onClick);
  controls.querySelector('[data-act="seek"]')?.addEventListener('input', onSeek);
  ['pointerdown', 'pointermove', 'wheel', 'touchstart'].forEach((ev) => {
    controls.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
  });

  // Tap PIP video toggles play
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
  if (layout !== 'hidden') {
    document.body.classList.add('rv-active', 'rv-layout-' + layout);
  }
  controls.querySelectorAll('[data-layout]').forEach((b) => {
    b.classList.toggle('active', b.dataset.layout === layout);
  });
  video.style.pointerEvents = layout === 'pip' ? 'auto' : 'none';
  saveSaved({ url: src, layout });
  // Nudge resize so Three/GS3D pick new canvas size
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
  saveSaved({ url: src, layout });
  if (!raf) raf = requestAnimationFrame(tick);
}

export function initReviewVideo(opts = {}) {
  ensureCss();
  ensureDom();
  const saved = loadSaved();
  if (saved?.layout) layout = saved.layout;
  const url = resolveSrc();
  if (url) setReviewVideo(url, { layout, autoplay: !!opts.autoplay });
  else controls.style.display = 'none';

  window.addEventListener('fumoca:recordLoaded', () => {
    const u = resolveSrc();
    if (u) setReviewVideo(u, { layout });
  });

  window.FumocaReviewVideo = {
    set: setReviewVideo,
    setLayout,
    play: () => video?.play(),
    pause: () => video?.pause(),
    getSrc: () => src,
    getLayout: () => layout,
  };
  return window.FumocaReviewVideo;
}

if (typeof window !== 'undefined') {
  const boot = () => {
    try { initReviewVideo({ autoplay: false }); } catch (e) {
      console.warn('[review-video]', e);
    }
  };
  if (document.readyState === 'complete') setTimeout(boot, 450);
  else window.addEventListener('load', () => setTimeout(boot, 450));
}
