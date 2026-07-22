import { runQuickClean, getSceneType } from './ai-cleanup.js';

function isEventMode(record = null) {
  const q = new URLSearchParams(location.search);
  if (q.get('mode') === 'event' || q.get('event') === '1') return true;
  const hint = String(record?.metadata?.capture_mode || record?.metadata?.experience_mode || record?.category || '').toLowerCase();
  return hint.includes('event') || hint.includes('glam') || hint.includes('concert') || hint.includes('awards');
}

function ensureBadge() {
  let el = document.getElementById('eventModeBadge');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'eventModeBadge';
  el.textContent = 'EVENT MODE';
  Object.assign(el.style, {
    position: 'fixed', right: '18px', top: '88px', zIndex: '11',
    padding: '10px 14px', borderRadius: '999px',
    background: 'rgba(200,255,0,.12)', border: '1px solid rgba(200,255,0,.32)',
    color: '#c8ff00', font: '700 12px/1 Arial,sans-serif', letterSpacing: '.08em'
  });
  document.body.appendChild(el);
  return el;
}

function decorateActions(record = null) {
  const teaserBtn = document.getElementById('teaserBtn');
  if (teaserBtn) {
    teaserBtn.textContent = 'Event teaser';
    teaserBtn.title = 'Open public event teaser';
    teaserBtn.addEventListener('click', () => {
      const url = new URL('public-preview.html', location.href);
      if (record?.id) url.searchParams.set('id', record.id);
      if (record?.splat_url) url.searchParams.set('file', record.splat_url);
      url.searchParams.set('mode', 'event');
      const pv = record?.preview_video_url || window._fumocaPreviewVideoUrl;
      const th = record?.thumbnail_url || window._fumocaThumbnailUrl;
      if (pv) url.searchParams.set('video', pv);
      if (th) url.searchParams.set('thumb', th);
      window.open(url.toString(), '_blank', 'noopener');
    }, { once: true });
  }
}

function cinematicHint(text) {
  const hint = document.getElementById('hint');
  if (!hint) return;
  hint.textContent = text;
  hint.classList.remove('hidden');
  setTimeout(() => hint.classList.add('hidden'), 2200);
}

async function runEventMode(record = null) {
  if (!isEventMode(record)) return;
  window._fumocaMode = 'event';
  ensureBadge();
  decorateActions(record);
  cinematicHint('Event Mode active · fast capture, instant teaser, interactive moment');
  try {
    await runQuickClean({ record, aggressive: true });
  } catch (_) {}
  try {
    const controls = window._fumocaViewerControls || window._fumocaViewer?.controls;
    const engine = window._fumocaCameraEngine;
    if (engine?.focusCurrentTarget && controls?.target) {
      setTimeout(() => engine.focusCurrentTarget({ zoom: 1.02, duration: 520, verticalLift: 0.02, overshoot: 0.012 }), 220);
      setTimeout(() => engine.focusCurrentTarget({ zoom: 1.08, duration: 940, verticalLift: 0.045, overshoot: 0.02 }), 1120);
      setTimeout(() => engine.focusCurrentTarget({ zoom: 1.12, duration: 1180, verticalLift: 0.055, overshoot: 0.024 }), 2440);
    }
  } catch (_) {}
  window.dispatchEvent(new CustomEvent('fumoca:eventModeReady', { detail: { recordId: record?.id || null, sceneType: getSceneType(record) } }));
}

window.addEventListener('fumoca:recordLoaded', (e) => {
  setTimeout(() => runEventMode(e.detail?.record || window._fumocaCurrentRecord || null), 220);
});
window.addEventListener('fumoca:viewerReady', () => {
  setTimeout(() => runEventMode(window._fumocaCurrentRecord || null), 900);
});
window.FumocaEventMode = { isEventMode, runEventMode };
