/**
 * FUMOCA Present Bridge
 * Wires magazine text + Matterport nav into the studio Present tab.
 * Safe to load after hotspot-pro / viewer camera is ready.
 */

import {
  initMagazineText,
  addText,
  applyPreset,
  exportAll as exportMagazine,
  importAll as importMagazine,
  setEditable as setMagEditable,
} from './present-magazine-text.js';

import {
  initPresentNav,
  setNavStops,
  addNavStop,
  flyToStop,
  stopsFromHotspots,
  exportStops,
  importStops,
} from './present-nav.js';

const STORAGE_KEY = 'fumoca_present_v1';

function loadLocal(splatId) {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return all[splatId || 'default'] || null;
  } catch {
    return null;
  }
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

function mountTools(host) {
  if (!host || host.querySelector('.present-mag-tools')) return;
  const box = document.createElement('div');
  box.className = 'present-mag-tools';
  box.innerHTML = `
    <button type="button" data-act="weekly">WEEKLY look</button>
    <button type="button" data-act="48hours">48 HOURS</button>
    <button type="button" data-act="product">Product cover</button>
    <button type="button" data-act="add-title">+ Title</button>
    <button type="button" data-act="add-nav">+ Nav stop</button>
    <button type="button" data-act="from-hs">Nav from hotspots</button>
    <button type="button" class="primary" data-act="save">Save present</button>
  `;
  host.appendChild(box);
  box.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'weekly') applyPreset('weekly');
    if (act === '48hours') applyPreset('48hours');
    if (act === 'product') applyPreset('product');
    if (act === 'add-title') {
      const t = prompt('Cover text', 'WEEKLY');
      if (t) addText({ text: t, style: 'cover', mode: 'billboard', sx: 50, sy: 40 });
    }
    if (act === 'add-nav') {
      // Use last hotspot world position if available
      const hs = window._fumocaHotspots?.slice?.(-1)?.[0];
      if (hs && Number.isFinite(hs.wx)) {
        addNavStop({
          label: hs.title || 'View',
          wx: hs.wx,
          wy: hs.wy,
          wz: hs.wz,
          zoom: 1.4,
        });
      } else {
        addNavStop({ label: 'Front', sx: 50, sy: 55, zoom: 1.2 });
      }
    }
    if (act === 'from-hs') {
      const list = window._fumocaHotspots || [];
      setNavStops(stopsFromHotspots(list));
    }
    if (act === 'save') persist();
    persist();
  });
}

export function initPresentBridge(opts = {}) {
  initMagazineText({
    editable: opts.editable !== false,
    onChange: () => persist(),
  });
  initPresentNav({
    onArrive: (stop) => {
      window.dispatchEvent(new CustomEvent('fumoca:navArrive', { detail: stop }));
    },
    onChange: () => persist(),
  });
  setMagEditable(opts.editable !== false);

  const saved = loadLocal(currentSplatId());
  if (saved?.magazine?.length) importMagazine(saved.magazine);
  if (saved?.nav?.length) importStops(saved.nav);

  // Prefer Present panel region
  const host =
    document.getElementById('presentPanelBody') ||
    document.querySelector('[data-panel="present"]') ||
    document.getElementById('rightPanel') ||
    null;
  if (host) mountTools(host);
  else {
    // Floating tools under stage
    const stage = document.getElementById('stage') || document.body;
    const float = document.createElement('div');
    float.style.cssText =
      'position:absolute;left:12px;bottom:72px;z-index:40;max-width:280px;';
    stage.appendChild(float);
    mountTools(float);
  }

  // Bridge: when hotspot-pro activates a fly hotspot, use present-nav path
  window.addEventListener('fumoca:hotspotActivate', (ev) => {
    const h = ev.detail;
    if (!h) return;
    if (h.flyOnActivate === false) return;
    if (Number.isFinite(h.wx)) {
      flyToStop({
        id: h.id,
        label: h.title,
        wx: h.wx,
        wy: h.wy,
        wz: h.wz,
        zoom: h.zoom || 1.35,
      });
    }
  });

  window.FumocaPresent = {
    save: persist,
    load: () => loadLocal(currentSplatId()),
    applyPreset,
    addText,
    addNavStop,
    setNavStops,
    flyToStop,
    exportMagazine,
    exportStops,
  };

  return window.FumocaPresent;
}

if (typeof window !== 'undefined') {
  // Auto-init once DOM + camera likely ready
  const boot = () => {
    if (window.__fumocaPresentBooted) return;
    window.__fumocaPresentBooted = true;
    try {
      initPresentBridge({ editable: true });
    } catch (e) {
      console.warn('[present-bridge]', e);
    }
  };
  if (document.readyState === 'complete') setTimeout(boot, 400);
  else window.addEventListener('load', () => setTimeout(boot, 400));
}
