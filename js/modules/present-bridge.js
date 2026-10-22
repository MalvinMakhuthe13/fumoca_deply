/**
 * FUMOCA Present Bridge (studio) — toolbar + share link with present payload
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
    const id = splatId || 'default';
    all[id] = data;
    all.default = data;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch (_) {}
}

function currentSplatId() {
  return (
    window._fumocaCurrentSplatId ||
    window._fumocaCurrentRecord?.id ||
    new URLSearchParams(location.search).get('splatId') ||
    new URLSearchParams(location.search).get('nifId') ||
    'default'
  );
}

function payload() {
  return {
    magazine: exportMagazine(),
    nav: exportStops(),
    updatedAt: Date.now(),
  };
}

function persist() {
  const data = payload();
  saveLocal(currentSplatId(), data);
  window.__FUMOCA_PRESENT__ = data;
  // Attach to record meta so publish paths can pick it up if they serialize metadata
  try {
    const rec = window._fumocaCurrentRecord;
    if (rec) {
      rec.meta = rec.meta || {};
      rec.metadata = rec.metadata || {};
      rec.meta.present = data;
      rec.metadata.present = data;
    }
  } catch (_) {}
}

function presentQueryParam() {
  const json = JSON.stringify(payload());
  // base64url
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return b64;
}

function copyViewerLink() {
  persist();
  const id = currentSplatId();
  const present = presentQueryParam();
  // Prefer existing share URL if host set one
  let base = window._fumocaShareUrl || '';
  if (!base) {
    base = `${location.origin}/viewer?nifId=${encodeURIComponent(id === 'default' ? '' : id)}`;
  }
  const url = new URL(base, location.origin);
  url.searchParams.set('present', present);
  const str = url.toString();
  navigator.clipboard?.writeText(str).then(
    () => alert('Viewer link with cover text copied.\n\nOpen it in a new tab to see magazine text on the public viewer.'),
    () => prompt('Copy this viewer link:', str)
  );
}

function mountToolbar() {
  document.querySelectorAll('.present-mag-tools').forEach((el) => el.remove());
  document.getElementById('fumocaPresentBar')?.remove();

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
      <div class="fp-title">Nav · share</div>
      <div class="fp-row">
        <button type="button" data-act="add-nav">+ Nav stop</button>
        <button type="button" data-act="from-hs">From hotspots</button>
        <button type="button" data-act="add-title">+ Custom text</button>
        <button type="button" class="primary" data-act="save">Save</button>
        <button type="button" class="primary" data-act="copy-link">Copy viewer link</button>
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
      } else addNavStop({ label: 'View', sx: 50, sy: 50, zoom: 1.25 });
    }
    if (act === 'from-hs') setNavStops(stopsFromHotspots(window._fumocaHotspots || []));
    if (act === 'save') persist();
    if (act === 'copy-link') copyViewerLink();
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
    copyViewerLink,
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
