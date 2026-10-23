/**
 * FUMOCA Review Video
 * One player for editor and viewer.
 * Stack / Split are real halves of the workspace. PIP can be dragged.
 * A device upload plays immediately, then is stored and written onto the NIF record
 * so the public viewer opens the same video + splat mix.
 */
import { r2 } from '../r2Client.js';

const STORAGE = 'fumoca_review_video_v3';
const BUCKET = 'nif-videos';
const LAYOUTS = ['pip', 'bg', 'split', 'stack', 'full', 'cinema', 'hidden'];

let video = null;
let root = null;
let controls = null;
let empty = null;
let layout = 'split';
let src = null;
let objectUrl = null;
let raf = 0;
let drag = null;
let fitting = false;

export function layoutFrame(name) {
  if (name === 'stack') {
    return {
      video: { top: '0', left: '0', width: '100%', height: '50%', right: 'auto', bottom: 'auto' },
      canvas: { top: '50%', left: '0', width: '100%', height: '50%', right: 'auto', bottom: 'auto' },
    };
  }
  if (name === 'split') {
    return {
      video: { top: '0', left: '0', width: '50%', height: '100%', right: 'auto', bottom: 'auto' },
      canvas: { top: '0', left: '50%', width: '50%', height: '100%', right: 'auto', bottom: 'auto' },
    };
  }
  if (name === 'pip') {
    return {
      video: { top: 'auto', left: 'auto', right: '16px', bottom: '16px', width: '300px', height: '170px' },
      canvas: null,
    };
  }
  if (name === 'cinema') {
    return {
      video: { top: '0', left: '0', width: '100%', height: '100%', right: 'auto', bottom: 'auto' },
      canvas: { top: 'auto', left: 'auto', right: '16px', bottom: '16px', width: '280px', height: '158px' },
    };
  }
  if (name === 'full') {
    return {
      video: { top: '0', left: '0', width: '100%', height: '100%', right: 'auto', bottom: 'auto' },
      canvas: { hidden: true },
    };
  }
  if (name === 'bg') {
    return {
      video: { top: '0', left: '0', width: '100%', height: '100%', right: 'auto', bottom: 'auto' },
      canvas: null,
    };
  }
  return { video: null, canvas: null };
}

function idKey() {
  const q = new URLSearchParams(location.search);
  return q.get('nifId') || q.get('splatId') || q.get('id') ||
    window._fumocaCurrentSplatId || window._fumocaCurrentRecord?.id || 'default';
}

function loadSaved() {
  try { return JSON.parse(localStorage.getItem(STORAGE) || '{}')[idKey()] || null; }
  catch { return null; }
}

function saveSaved(data) {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE) || '{}');
    all[idKey()] = data;
    localStorage.setItem(STORAGE, JSON.stringify(all));
  } catch (_) {}
}

function httpUrl(url) {
  return !!url && /^https?:\/\//i.test(url);
}

function resolveSrc() {
  const q = new URLSearchParams(location.search);
  const fromQ = q.get('review') || q.get('video') || q.get('reviewVideo');
  if (httpUrl(fromQ)) return fromQ;
  const opened = window._fumocaOpenedMeta;
  if (httpUrl(opened?.reviewVideo?.url)) return opened.reviewVideo.url;
  const rec = window._fumocaCurrentRecord;
  const meta = rec?.meta || rec?.metadata || {};
  if (httpUrl(meta.reviewVideo?.url)) return meta.reviewVideo.url;
  if (httpUrl(meta.review_video_url)) return meta.review_video_url;
  if (httpUrl(rec?.review_video_url)) return rec.review_video_url;
  const saved = loadSaved();
  if (httpUrl(saved?.url)) return saved.url;
  return null;
}

const GRID = {
  stack: 'rv-grid-stack',
  split: 'rv-grid-split',
  pip: 'rv-grid-pip',
  full: 'rv-grid-full',
  cinema: 'rv-grid-cinema',
  bg: 'rv-grid-bg',
  hidden: 'rv-grid-off',
};

function workspace() {
  return document.getElementById('viewport') || document.getElementById('stage') || document.getElementById('stageHost');
}

function workEl(host) {
  let work = document.getElementById('fumocaWork');
  if (!work) {
    work = document.createElement('div');
    work.id = 'fumocaWork';
    work.className = 'rv-grid-off';
    host.appendChild(work);
  }
  return work;
}

function realCanvas() {
  const gl = window._fumocaGlRenderer?.domElement;
  if (gl?.tagName === 'CANVAS') return gl;
  return document.querySelector('#stageHost canvas, #fumocaSplatPane canvas');
}

function splatPane(host) {
  if (host?.id === 'stage' || document.getElementById('stageHost')) {
    const stage = document.getElementById('stageHost');
    if (stage && host?.id !== 'viewport') return stage;
  }
  const work = workEl(host);
  let pane = document.getElementById('fumocaSplatPane');
  if (!pane) {
    pane = document.createElement('div');
    pane.id = 'fumocaSplatPane';
    work.appendChild(pane);
  }
  const canvas = realCanvas();
  if (canvas && canvas.parentElement !== pane) pane.appendChild(canvas);
  const decoy = document.getElementById('viewportCanvas');
  if (decoy) decoy.style.display = 'none';
  return pane;
}

function fitRenderer() {
  const pane = document.getElementById('fumocaSplatPane') || document.getElementById('stageHost');
  if (!pane || pane.clientWidth < 2 || pane.clientHeight < 2) return;
  const renderer = window._fumocaGlRenderer;
  const camera = window._fumocaCamera;
  if (renderer && camera) {
    const W = pane.clientWidth;
    const H = pane.clientHeight;
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    renderer.setSize(W, H, false);
    window.FumocaGaussianRenderer?.setViewport?.(W, H);
  }
}

function toast(msg) {
  let t = document.getElementById('rvToast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'rvToast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), 4200);
}

function ensureDom() {
  if (root) return;
  const host = workspace() || document.body;
  if (host !== document.body) host.style.position = host.style.position || 'relative';
  root = document.createElement('div');
  root.id = 'fumocaReviewRoot';
  root.className = 'layout-hidden';
  empty = document.createElement('div');
  empty.className = 'rv-empty';
  empty.textContent = 'Upload a video in Present';
  video = document.createElement('video');
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.loop = true;
  video.preload = 'auto';
  controls = document.createElement('div');
  controls.id = 'fumocaReviewControls';
  controls.innerHTML = `
    <button type="button" data-act="play" class="primary">Play</button>
    <button type="button" data-act="back">-10</button>
    <button type="button" data-act="fwd">+10</button>
    <input type="range" data-act="seek" min="0" max="1000" value="0" />
    <span class="rv-time">0:00</span>
    <button type="button" data-act="mute">Mute</button>
    <span class="rv-layouts">
      <button type="button" data-layout="stack">Stack</button>
      <button type="button" data-layout="split">Split</button>
      <button type="button" data-layout="pip">PIP</button>
      <button type="button" data-layout="full">Full</button>
      <button type="button" data-layout="cinema">Cinema</button>
      <button type="button" data-layout="bg">BG</button>
      <button type="button" data-layout="hidden">Off</button>
    </span>
  `;
  root.append(empty, video, controls);
  const work = workEl(host);
  work.appendChild(root);
  if (host.id === 'viewport') splatPane(host);
  controls.addEventListener('click', onClick);
  controls.querySelector('[data-act="seek"]').addEventListener('input', onSeek);
  controls.addEventListener('pointerdown', (e) => e.stopPropagation());
  root.addEventListener('pointerdown', onDragStart);
  window.addEventListener('pointermove', onDragMove);
  window.addEventListener('pointerup', () => { drag = null; });
  window.addEventListener('resize', () => { if (!fitting) applyFrame(); });
}

function fmt(t) {
  if (!Number.isFinite(t) || t < 0) return '0:00';
  return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
}

function tick() {
  if (!video || !controls) return;
  const seek = controls.querySelector('[data-act="seek"]');
  const time = controls.querySelector('.rv-time');
  if (video.duration && seek && document.activeElement !== seek) {
    seek.value = String(Math.round((video.currentTime / video.duration) * 1000));
  }
  if (time) time.textContent = `${fmt(video.currentTime)} / ${fmt(video.duration || 0)}`;
  const playBtn = controls.querySelector('[data-act="play"]');
  if (playBtn) playBtn.textContent = video.paused ? 'Play' : 'Pause';
  raf = requestAnimationFrame(tick);
}

function onSeek(e) {
  if (!video?.duration) return;
  video.currentTime = (Number(e.target.value) / 1000) * video.duration;
}

function onDragStart(e) {
  if (layout !== 'pip' || e.target.closest('button, input')) return;
  const work = document.getElementById('fumocaWork');
  if (!work) return;
  const hr = work.getBoundingClientRect();
  const rr = root.getBoundingClientRect();
  drag = { x: e.clientX, y: e.clientY, l: rr.left - hr.left, t: rr.top - hr.top };
  root.setPointerCapture?.(e.pointerId);
}

function onDragMove(e) {
  if (!drag || layout !== 'pip') return;
  const work = document.getElementById('fumocaWork');
  if (!work) return;
  const hr = work.getBoundingClientRect();
  let x = drag.l + e.clientX - drag.x;
  let y = drag.t + e.clientY - drag.y;
  x = Math.max(8, Math.min(x, hr.width - root.offsetWidth - 8));
  y = Math.max(8, Math.min(y, hr.height - root.offsetHeight - 8));
  root.style.setProperty('left', x + 'px', 'important');
  root.style.setProperty('top', y + 'px', 'important');
  root.style.setProperty('right', 'auto', 'important');
  root.style.setProperty('bottom', 'auto', 'important');
}

function pokeViewer() {
  const pane = document.getElementById('stageHost') || document.getElementById('fumocaSplatPane');
  const w = pane?.clientWidth || 0;
  const h = pane?.clientHeight || 0;
  const canvas = pane?.querySelector?.('canvas');
  if (canvas) {
    canvas.style.setProperty('display', 'block', 'important');
    canvas.style.setProperty('width', '100%', 'important');
    canvas.style.setProperty('height', '100%', 'important');
  }
  const viewer = window._fumocaViewerInstance;
  try { viewer?.renderer?.setSize?.(w, h, false); } catch (_) {}
  try { viewer?.forceRenderNextFrame?.(); } catch (_) {}
  try { window._fumocaViewerControls?.handleResize?.(); } catch (_) {}
  window.dispatchEvent(new Event('resize'));
}

function restoreViewerStage() {
  const stage = document.getElementById('stage');
  const stageHost = document.getElementById('stageHost');
  const work = document.getElementById('fumocaWork');
  if (stage && stageHost && stageHost.parentElement !== stage) stage.appendChild(stageHost);
  if (stageHost) {
    stageHost.style.setProperty('position', 'absolute', 'important');
    stageHost.style.setProperty('inset', '0', 'important');
    stageHost.style.setProperty('width', '100%', 'important');
    stageHost.style.setProperty('height', '100%', 'important');
    stageHost.style.setProperty('display', 'block', 'important');
  }
  if (work) work.style.setProperty('display', 'none', 'important');
}

function applyFrame() {
  if (!root) return;
  const host = workspace();
  if (!host) return;
  const viewerPage = host.id === 'stage';
  const showMix = !!src && layout !== 'hidden';
  const work = workEl(host);

  if (viewerPage && !showMix) {
    restoreViewerStage();
    root.style.display = 'none';
    fitting = true;
    requestAnimationFrame(() => { pokeViewer(); fitting = false; });
    return;
  }

  const pane = viewerPage ? document.getElementById('stageHost') : splatPane(host);
  if (root.parentElement !== work) work.appendChild(root);
  if (pane && pane.parentElement !== work) work.appendChild(pane);
  if (pane && root.nextSibling !== pane) work.insertBefore(root, pane);
  work.style.setProperty('display', 'block', 'important');
  Object.values(GRID).forEach((name) => work.classList.remove(name));
  work.classList.add(GRID[layout] || GRID.hidden);
  host.classList.toggle('rv-split', layout === 'split');
  host.classList.toggle('rv-stack', layout === 'stack');
  host.classList.toggle('rv-full', layout === 'full');
  root.className = 'layout-' + layout;
  root.style.display = layout === 'hidden' ? 'none' : 'block';
  if (layout !== 'pip') {
    ['left', 'top', 'right', 'bottom'].forEach((p) => root.style.removeProperty(p));
  }
  const shell = document.getElementById('fumoca-video-shell');
  if (shell) shell.style.setProperty('display', 'none', 'important');
  empty.style.display = src ? 'none' : 'flex';
  video.style.display = src ? 'block' : 'none';
  video.style.setProperty('position', 'absolute', 'important');
  video.style.setProperty('inset', '0', 'important');
  video.style.setProperty('width', '100%', 'important');
  video.style.setProperty('height', '100%', 'important');
  video.style.setProperty('object-fit', 'contain', 'important');
  const box = host.getBoundingClientRect();
  const W = Math.max(host.clientWidth, box.width, 2);
  const H = Math.max(host.clientHeight, box.height, 2);
  work.style.setProperty('position', 'absolute', 'important');
  work.style.setProperty('inset', '0', 'important');
  work.style.setProperty('width', W + 'px', 'important');
  work.style.setProperty('height', H + 'px', 'important');
  work.style.setProperty('overflow', 'hidden', 'important');
  if (layout === 'split' || layout === 'stack') {
    work.style.setProperty('display', 'grid', 'important');
    if (layout === 'split') {
      work.style.setProperty('grid-template-columns', 'minmax(0,1fr) minmax(0,1fr)', 'important');
      work.style.setProperty('grid-template-rows', 'minmax(0,1fr)', 'important');
    } else {
      work.style.setProperty('grid-template-columns', 'minmax(0,1fr)', 'important');
      work.style.setProperty('grid-template-rows', 'minmax(0,1fr) minmax(0,1fr)', 'important');
    }
    const pw = layout === 'split' ? Math.floor(W / 2) : W;
    const ph = layout === 'stack' ? Math.floor(H / 2) : H;
    [root, pane].forEach((el) => {
      if (!el) return;
      el.style.setProperty('position', 'relative', 'important');
      el.style.setProperty('display', 'block', 'important');
      el.style.setProperty('width', pw + 'px', 'important');
      el.style.setProperty('height', ph + 'px', 'important');
      el.style.setProperty('min-width', '0', 'important');
      el.style.setProperty('min-height', '0', 'important');
      el.style.setProperty('overflow', 'hidden', 'important');
      el.style.setProperty('inset', 'auto', 'important');
    });
  }
  controls.style.display = layout === 'hidden' ? 'none' : 'flex';
  controls.querySelectorAll('[data-layout]').forEach((b) => b.classList.toggle('active', b.dataset.layout === layout));
  fitting = true;
  requestAnimationFrame(() => {
    fitRenderer();
    pokeViewer();
    fitting = false;
  });
}

function setLayout(next) {
  if (!LAYOUTS.includes(next)) next = 'split';
  layout = next;
  ensureDom();
  applyFrame();
  const saved = loadSaved() || {};
  saveSaved({ url: httpUrl(src) ? src : saved.url, layout });
  if (httpUrl(src)) persistRecord(src, layout);
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
    if (!src) return;
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  } else if (act === 'back') video.currentTime = Math.max(0, video.currentTime - 10);
  else if (act === 'fwd') video.currentTime = Math.min(video.duration || 0, video.currentTime + 10);
  else if (act === 'mute') {
    video.muted = !video.muted;
    btn.textContent = video.muted ? 'Muted' : 'Mute';
  }
}

async function persistRecord(url, nextLayout) {
  const reviewVideo = { url, layout: nextLayout || layout, kind: 'splat-video', savedAt: Date.now() };
  if (window._fumocaOpenedMeta) window._fumocaOpenedMeta.reviewVideo = reviewVideo;
  const rec = window._fumocaCurrentRecord;
  if (rec) {
    rec.meta = { ...(rec.meta || {}), reviewVideo };
    rec.metadata = { ...(rec.metadata || {}), reviewVideo };
  }
  const id = idKey();
  const sb = window.supabase;
  if (!id || id === 'default' || !sb?.from) return;
  try {
    const { data, error: readErr } = await sb.from('nif_files').select('meta').eq('id', id).maybeSingle();
    if (readErr) throw readErr;
    const meta = { ...(data?.meta || {}), reviewVideo };
    const { error } = await sb.from('nif_files').update({ meta }).eq('id', id);
    if (error) throw error;
    console.info('[review-video] saved with splat', id);
  } catch (err) {
    console.warn('[review-video] record save failed', err?.message || err);
  }
}

export function setReviewVideo(url, opts = {}) {
  ensureDom();
  src = url || null;
  if (opts.layout && LAYOUTS.includes(opts.layout)) layout = opts.layout;
  if (!src) {
    video.removeAttribute('src');
    try { video.load(); } catch (_) {}
    layout = 'hidden';
    applyFrame();
    return;
  }
  controls.style.display = 'flex';
  if (video.src !== src) {
    video.src = src;
    video.load();
  }
  applyFrame();
  if (opts.autoplay !== false) {
    video.muted = true;
    video.play().catch(() => {});
  }
  if (httpUrl(src)) {
    saveSaved({ url: src, layout });
    persistRecord(src, layout);
  }
  if (!raf) raf = requestAnimationFrame(tick);
}

export function pickFromDevice(opts = {}) {
  ensureDom();
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'video/mp4,video/webm,video/quicktime,video/*';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(file);
    setReviewVideo(objectUrl, { layout: opts.layout || layout || 'split', autoplay: true });
    const status = document.getElementById('ptpVidStatus') || document.getElementById('rvUploadStatus');
    if (status) status.textContent = file.name + ' · uploading so the viewer keeps it';
    toast('Uploading video…');
    try {
      const key = `review/${Date.now()}_${file.name.replace(/[^\w.\-]+/g, '_')}`;
      const res = await r2.from(BUCKET).upload(key, file, { contentType: file.type || 'video/mp4' });
      if (res?.error || !res?.publicUrl) throw res?.error || new Error('no public url');
      setReviewVideo(res.publicUrl, { layout: layout || 'split', autoplay: true });
      if (status) status.textContent = 'Saved with this splat. Open the viewer to see both.';
      toast('Saved. The viewer will play this with the splat.');
      window.dispatchEvent(new CustomEvent('fumoca:reviewVideoLocal', { detail: { name: file.name, url: res.publicUrl } }));
    } catch (err) {
      console.warn('[review-video] upload', err);
      if (status) status.textContent = file.name + ' · plays here only. Sign in and retry to keep it.';
      toast('Playing here. Sign in, then upload again so the viewer keeps it.');
    }
  });
  input.click();
}

export function currentReviewMeta() {
  return httpUrl(src) ? { url: src, layout, kind: 'splat-video' } : null;
}

export function initReviewVideo() {
  if (window.__fumocaReviewBooted) return window.FumocaReviewVideo;
  window.__fumocaReviewBooted = true;
  ensureDom();
  const saved = loadSaved();
  const qLayout = new URLSearchParams(location.search).get('rvLayout');
  if (LAYOUTS.includes(qLayout)) layout = qLayout;
  else if (LAYOUTS.includes(saved?.layout)) layout = saved.layout;
  else if (LAYOUTS.includes(window._fumocaOpenedMeta?.reviewVideo?.layout)) layout = window._fumocaOpenedMeta.reviewVideo.layout;
  const url = resolveSrc();
  if (url) setReviewVideo(url, { layout, autoplay: true });
  else {
    layout = 'hidden';
    applyFrame();
  }

  const adopt = () => {
    const u = resolveSrc();
    if (u && u !== src) setReviewVideo(u, { layout, autoplay: true });
  };
  window.addEventListener('fumoca:recordLoaded', adopt);
  window.addEventListener('fumoca:nifMeta', (ev) => {
    const review = ev.detail?.reviewVideo;
    if (httpUrl(review?.url)) setReviewVideo(review.url, { layout: review.layout || layout, autoplay: true });
  });

  window.FumocaReviewVideo = {
    set: setReviewVideo,
    setLayout,
    pickFromDevice,
    play: () => video?.play(),
    pause: () => video?.pause(),
    getSrc: () => src,
    getLayout: () => layout,
    meta: currentReviewMeta,
  };
  return window.FumocaReviewVideo;
}

if (typeof window !== 'undefined') {
  const boot = () => { try { initReviewVideo(); } catch (e) { console.warn('[review-video]', e); } };
  if (document.readyState === 'complete') setTimeout(boot, 300);
  else window.addEventListener('load', () => setTimeout(boot, 300));
}
