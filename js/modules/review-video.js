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
let pendingFile = null;
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
  return document.getElementById('viewportCanvas')
    || document.querySelector('#stageHost canvas, #fumocaSplatPane canvas');
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
  if (canvas) {
    canvas.style.setProperty('display', 'block', 'important');
    canvas.style.setProperty('width', '100%', 'important');
    canvas.style.setProperty('height', '100%', 'important');
  }
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
  const stage = document.getElementById('stage');
  if (stage) {
    stage.style.position = 'fixed';
    stage.style.inset = '0';
    stage.style.width = '100%';
    stage.style.height = '100%';
  }
  if (host !== document.body && host.id !== 'stage' && host.id !== 'viewerShell') {
    host.style.position = host.style.position || 'relative';
  }
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

function releaseEditorCanvas() {
  const host = document.getElementById('viewport');
  const pane = document.getElementById('fumocaSplatPane');
  const canvas = realCanvas();
  if (host && canvas && pane && canvas.parentElement === pane) host.appendChild(canvas);
  if (canvas) {
    canvas.style.setProperty('display', 'block', 'important');
    canvas.style.setProperty('width', '100%', 'important');
    canvas.style.setProperty('height', '100%', 'important');
  }
  const work = document.getElementById('fumocaWork');
  if (work) work.style.setProperty('display', 'none', 'important');
}

function restoreViewerStage() {
  const stage = document.getElementById('stage');
  const stageHost = document.getElementById('stageHost');
  const work = document.getElementById('fumocaWork');
  if (stage && stageHost && stageHost.parentElement !== stage) stage.appendChild(stageHost);
  if (stageHost) {
    ['position', 'inset', 'left', 'top', 'right', 'bottom', 'width', 'height', 'display'].forEach((prop) => stageHost.style.removeProperty(prop));
    stageHost.style.setProperty('display', 'block', 'important');
    stageHost.style.setProperty('visibility', 'visible', 'important');
  }
  if (work) {
    work.className = 'rv-grid-off';
    work.style.setProperty('display', 'none', 'important');
    work.style.setProperty('pointer-events', 'none', 'important');
  }
  if (stage) stage.classList.remove('rv-split', 'rv-stack', 'rv-full', 'rv-pip', 'rv-bg', 'rv-cinema');
}

function placeViewerVideo(stage, mode) {
  if (!root || !stage) return;
  if (root.parentElement !== stage) stage.appendChild(root);
  root.style.setProperty('position', 'absolute', 'important');
  root.style.setProperty('z-index', '4', 'important');
  root.style.setProperty('margin', '0', 'important');
  root.style.setProperty('overflow', 'hidden', 'important');
  root.style.setProperty('background', '#05070b', 'important');
  const boxes = {
    split: { left: '0', top: '0', width: '50%', height: '100%', right: 'auto', bottom: 'auto' },
    stack: { left: '0', top: '0', width: '100%', height: '50%', right: 'auto', bottom: 'auto' },
    pip: { left: 'auto', top: 'auto', right: '16px', bottom: '72px', width: '200px', height: '112px' },
    full: { left: '0', top: '0', width: '100%', height: '100%', right: 'auto', bottom: 'auto' },
    cinema: { left: '0', top: '0', width: '100%', height: '100%', right: 'auto', bottom: 'auto' },
    bg: { left: '0', top: '0', width: '100%', height: '100%', right: 'auto', bottom: 'auto' },
  };
  const box = boxes[mode] || boxes.split;
  Object.entries(box).forEach(([k, v]) => root.style.setProperty(k, v, 'important'));
  stage.classList.remove('rv-split', 'rv-stack', 'rv-full', 'rv-pip', 'rv-bg', 'rv-cinema');
  stage.classList.add('rv-' + mode);
}

function showViewerBar(on) {
  if (!document.getElementById('stage')) return;
  let bar = document.getElementById('fumocaReviewBar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'fumocaReviewBar';
    bar.innerHTML = `
      <span>Review</span>
      <button type="button" data-layout="pip">PIP</button>
      <button type="button" data-layout="stack">Stack</button>
      <button type="button" data-layout="split">Split</button>
      <button type="button" data-layout="full">Full</button>
      <button type="button" data-layout="cinema">Cinema</button>
      <button type="button" data-layout="bg">BG</button>
      <button type="button" data-layout="hidden">Off</button>
    `;
    bar.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-layout]');
      if (!btn) return;
      setLayout(btn.dataset.layout);
    });
    document.body.appendChild(bar);
  }
  bar.style.display = on ? 'flex' : 'none';
  bar.querySelectorAll('[data-layout]').forEach((b) => b.classList.toggle('active', b.dataset.layout === layout));
}

function applyFrame() {
  if (!root) return;
  const host = workspace();
  if (!host) return;
  const showMix = !!src && layout !== 'hidden';
  const stageHost = document.getElementById('stageHost');

  if (src && layout === 'hidden') {
    // Off hides the picture and keeps the reviewer audio.
    restoreViewerStage();
    releaseEditorCanvas();
    root.style.setProperty('display', 'none', 'important');
    if (controls) controls.style.display = 'none';
    if (empty) empty.style.display = 'none';
    if (video) {
      video.style.display = 'none';
      video.muted = false;
      video.play().catch(() => {});
    }
    showViewerBar(true);
    return;
  }

  if (!showMix) {
    restoreViewerStage();
    releaseEditorCanvas();
    root.style.setProperty('display', 'none', 'important');
    if (controls) controls.style.display = 'none';
    if (empty) empty.style.display = 'none';
    if (video) video.style.display = 'none';
    showViewerBar(false);
    return;
  }

  if (host.id === 'stage') {
    if (stageHost && stageHost.parentElement !== host) host.appendChild(stageHost);
    if (stageHost) {
      stageHost.style.setProperty('display', layout === 'full' ? 'none' : 'block', 'important');
      stageHost.style.setProperty('visibility', 'visible', 'important');
      stageHost.style.setProperty('opacity', '1', 'important');
    }
    const work = document.getElementById('fumocaWork');
    if (work && work.parentElement === host) work.style.setProperty('display', 'none', 'important');
    placeViewerVideo(host, layout);
    root.style.setProperty('display', 'block', 'important');
    const shell = document.getElementById('fumoca-video-shell');
    if (shell) shell.style.setProperty('display', 'none', 'important');
    empty.style.display = 'none';
    video.style.display = 'block';
    video.style.setProperty('position', 'absolute', 'important');
    video.style.setProperty('inset', '0', 'important');
    video.style.setProperty('width', '100%', 'important');
    video.style.setProperty('height', '100%', 'important');
    video.style.setProperty('object-fit', 'contain', 'important');
    controls.style.display = 'flex';
    controls.querySelectorAll('[data-layout]').forEach((b) => b.classList.toggle('active', b.dataset.layout === layout));
    showViewerBar(true);
    fitting = true;
    requestAnimationFrame(() => { pokeViewer(); fitting = false; });
    setTimeout(pokeViewer, 400);
    setTimeout(pokeViewer, 1200);
    return;
  }

  const work = workEl(host);
  const pane = splatPane(host);
  if (root.parentElement !== work) work.appendChild(root);
  if (pane && pane.parentElement !== work) work.appendChild(pane);
  if (pane && root.nextSibling !== pane) work.insertBefore(root, pane);
  work.style.setProperty('display', 'block', 'important');
  work.style.setProperty('pointer-events', 'none', 'important');
  root.style.setProperty('pointer-events', 'auto', 'important');
  if (pane) pane.style.setProperty('pointer-events', 'auto', 'important');
  Object.values(GRID).forEach((name) => work.classList.remove(name));
  work.classList.add(GRID[layout] || GRID.hidden);
  host.classList.toggle('rv-split', layout === 'split');
  host.classList.toggle('rv-stack', layout === 'stack');
  host.classList.toggle('rv-full', layout === 'full');
  root.className = 'layout-' + layout;
  root.style.display = 'block';
  // PIP chrome must not leak into Stack, Split, Full or BG.
  ['position', 'left', 'top', 'right', 'bottom', 'width', 'height', 'max-width', 'max-height', 'z-index', 'border', 'border-radius', 'box-shadow', 'cursor'].forEach((prop) => {
    root.style.removeProperty(prop);
    if (pane) pane.style.removeProperty(prop);
  });
  ['max-width', 'max-height'].forEach((prop) => video.style.removeProperty(prop));
  empty.style.display = 'none';
  video.style.display = 'block';
  video.style.setProperty('position', 'absolute', 'important');
  video.style.setProperty('inset', '0', 'important');
  video.style.setProperty('width', '100%', 'important');
  video.style.setProperty('height', '100%', 'important');
  video.style.setProperty('max-width', 'none', 'important');
  video.style.setProperty('max-height', 'none', 'important');
  video.style.setProperty('object-fit', 'contain', 'important');
  work.style.setProperty('position', 'absolute', 'important');
  work.style.setProperty('inset', '0', 'important');
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
    [root, pane].forEach((el) => {
      if (!el) return;
      el.style.setProperty('position', 'relative', 'important');
      el.style.setProperty('inset', 'auto', 'important');
      el.style.setProperty('width', '100%', 'important');
      el.style.setProperty('height', '100%', 'important');
      el.style.setProperty('min-width', '0', 'important');
      el.style.setProperty('min-height', '0', 'important');
      el.style.setProperty('overflow', 'hidden', 'important');
    });
  } else if (layout === 'pip') {
    work.style.setProperty('display', 'block', 'important');
    if (pane) {
      pane.style.setProperty('position', 'absolute', 'important');
      pane.style.setProperty('inset', '0', 'important');
      pane.style.setProperty('width', '100%', 'important');
      pane.style.setProperty('height', '100%', 'important');
    }
    // Small window only while PIP is the active layout. Absolute inside the workspace, not the whole app.
    root.style.setProperty('position', 'absolute', 'important');
    root.style.setProperty('left', 'auto', 'important');
    root.style.setProperty('top', 'auto', 'important');
    root.style.setProperty('right', '16px', 'important');
    root.style.setProperty('bottom', '16px', 'important');
    root.style.setProperty('width', '280px', 'important');
    root.style.setProperty('height', '158px', 'important');
    root.style.setProperty('max-width', '280px', 'important');
    root.style.setProperty('max-height', '158px', 'important');
    root.style.setProperty('z-index', '30', 'important');
    root.style.setProperty('border-radius', '12px', 'important');
    root.style.setProperty('overflow', 'hidden', 'important');
    root.style.setProperty('border', '2px solid #c8ff00', 'important');
    root.style.setProperty('box-shadow', '0 12px 32px rgba(0,0,0,.55)', 'important');
    root.style.setProperty('cursor', 'grab', 'important');
  } else if (layout === 'cinema') {
    work.style.setProperty('display', 'block', 'important');
    root.style.setProperty('position', 'absolute', 'important');
    root.style.setProperty('inset', '0', 'important');
    root.style.setProperty('width', '100%', 'important');
    root.style.setProperty('height', '100%', 'important');
    if (pane) {
      pane.style.setProperty('position', 'absolute', 'important');
      pane.style.setProperty('left', 'auto', 'important');
      pane.style.setProperty('top', 'auto', 'important');
      pane.style.setProperty('right', '16px', 'important');
      pane.style.setProperty('bottom', '16px', 'important');
      pane.style.setProperty('width', '280px', 'important');
      pane.style.setProperty('height', '158px', 'important');
      pane.style.setProperty('z-index', '30', 'important');
    }
  } else {
    work.style.setProperty('display', 'block', 'important');
    if (pane && layout !== 'full') {
      pane.style.setProperty('position', 'absolute', 'important');
      pane.style.setProperty('inset', '0', 'important');
      pane.style.setProperty('width', '100%', 'important');
      pane.style.setProperty('height', '100%', 'important');
    }
    root.style.setProperty('position', 'absolute', 'important');
    root.style.setProperty('inset', '0', 'important');
    root.style.setProperty('width', '100%', 'important');
    root.style.setProperty('height', '100%', 'important');
  }
  controls.style.display = 'flex';
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
    pendingFile = file;
    window._fumocaReviewFile = file;
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

export async function ensurePublic() {
  if (httpUrl(src)) return currentReviewMeta();
  const file = pendingFile || window._fumocaReviewFile || null;
  if (!file) return null;
  const key = `review/${Date.now()}_${file.name.replace(/[^\w.\-]+/g, '_')}`;
  const res = await r2.from(BUCKET).upload(key, file, { contentType: file.type || 'video/mp4' });
  if (res?.error || !res?.publicUrl) throw res?.error || new Error(res?.error?.message || 'review video upload failed');
  setReviewVideo(res.publicUrl, { layout: layout || 'split', autoplay: true });
  return currentReviewMeta();
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
    ensurePublic,
  };
  return window.FumocaReviewVideo;
}

if (typeof window !== 'undefined') {
  const boot = () => { try { initReviewVideo(); } catch (e) { console.warn('[review-video]', e); } };
  if (document.readyState === 'complete') setTimeout(boot, 300);
  else window.addEventListener('load', () => setTimeout(boot, 300));
}
