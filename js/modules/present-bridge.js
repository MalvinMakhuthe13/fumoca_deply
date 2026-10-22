/**
 * FUMOCA Present Bridge — clean toolbar (not jammed into timeline)
 */

import {
  initMagazineText, addText, applyPreset, clearText,
  exportAll as exportMagazine, importAll as importMagazine, setEditable as setMagEditable,
} from './present-magazine-text.js';

import {
  initPresentNav, setNavStops, addNavStop, flyToStop,
  stopsFromHotspots, exportStops, importStops,
} from './present-nav.js';

const STORAGE_KEY = 'fumoca_present_v1';

function loadLocal(splatId) {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return all[splatId || 'default'] || null;
  } catch { return null; }
}

function saveLocal(splatId, data) {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    all[splatId || 'default'] = data;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch (_) {}
}

function currentSplatId() {
  return (
    window._fumocaCurrentSplatId ||
    window._fumocaCurrentRecord?.id ||
    new URLSearchParams(location.search).get('splatId') ||
    'default'
  );
}

function persist() {
  saveLocal(currentSplatId(), {
    magazine: exportMagazine(),
    nav: exportStops(),
    updatedAt: Date.now(),
  });
}

function mountToolbar() {
  // Remove any old messy injectors
  document.querySelectorAll('.present-mag-tools').forEach((el) => el.remove());
  const old = document.getElementById('fumocaPresentBar');
  if (old) old.remove();

  const stage =
    document.getElementById('stage') ||
    document.getElementById('viewport') ||
    document.getElementById('stageHost') ||
    document.body;

  const bar = document.createElement('div');
  bar.id = 'fumocaPresentBar';
  bar.innerHTML = `
    <div class="fp-card">
      <div class="fp-title">Magazine cover</div>
      <div class="fp-row">
        <button type="button" data-act="weekly">WEEKLY</button>
        <button type="button" data-act="48hours">48 HOURS</button>
        <button type="button" data-act="product">Product</button>
        <button type="button" data-act="hero">Hero title</button>
        <button type="button" data-act="clear-text">Clear text</button>
      </div>
    </div>
    <div class="fp-card">
      <div class="fp-title">Nav · Matterport style</div>
      <div class="fp-row">
        <button type="button" data-act="add-nav">+ Nav stop</button>
        <button type="button" data-act="from-hs">From hotspots</button>
        <button type="button" data-act="add-title">+ Custom text</button>
        <button type="button" class="primary" data-act="save">Save</button>
      </div>
    </div>
  `;
  stage.appendChild(bar);

  bar.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'weekly') applyPreset('weekly');
    if (act === '48hours') applyPreset('48hours');
    if (act === 'product') applyPreset('product');
    if (act === 'hero') applyPreset('hero');
    if (act === 'clear-text') clearText();
    if (act === 'add-title') {
      const t = prompt('Cover text', 'TAZZ');
      if (t) addText({ text: t, style: 'cover', mode: 'locked', sx: 50, sy: 20, fontSize: 64, align: 'center' });
    }
    if (act === 'add-nav') {
      const hs = window._fumocaHotspots?.slice?.(-1)?.[0];
      if (hs && Number.isFinite(hs.wx)) {
        addNavStop({ label: hs.title || 'View', wx: hs.wx, wy: hs.wy, wz: hs.wz, zoom: 1.4 });
      } else {
        addNavStop({ label: 'View', sx: 50, sy: 50, zoom: 1.25 });
      }
    }
    if (act === 'from-hs') setNavStops(stopsFromHotspots(window._fumocaHotspots || []));
    if (act === 'save') persist();
    persist();
  });
}

export function initPresentBridge(opts = {}) {
  initMagazineText({ editable: opts.editable !== false, onChange: () => persist() });
  initPresentNav({
    onArrive: (stop) => window.dispatchEvent(new CustomEvent('fumoca:navArrive', { detail: stop })),
    onChange: () => persist(),
  });
  setMagEditable(opts.editable !== false);

  const saved = loadLocal(currentSplatId());
  if (saved?.magazine?.length) importMagazine(saved.magazine);
  if (saved?.nav?.length) importStops(saved.nav);

  mountToolbar();

  window.addEventListener('fumoca:hotspotActivate', (ev) => {
    const h = ev.detail;
    if (!h || h.flyOnActivate === false) return;
    if (Number.isFinite(h.wx)) {
      flyToStop({ id: h.id, label: h.title, wx: h.wx, wy: h.wy, wz: h.wz, zoom: h.zoom || 1.35 });
    }
  });

  window.FumocaPresent = {
    save: persist,
    load: () => loadLocal(currentSplatId()),
    applyPreset, addText, clearText, addNavStop, setNavStops, flyToStop,
    exportMagazine, exportStops,
  };
  return window.FumocaPresent;
}

if (typeof window !== 'undefined') {
  const boot = () => {
    if (window.__fumocaPresentBooted) return;
    window.__fumocaPresentBooted = true;
    try { initPresentBridge({ editable: true }); } catch (e) { console.warn('[present-bridge]', e); }
  };
  if (document.readyState === 'complete') setTimeout(boot, 500);
  else window.addEventListener('load', () => setTimeout(boot, 500));
}
