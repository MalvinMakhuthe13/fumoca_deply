/**
 * FUMOCA Present Viewer — magazine text + nav in public viewer
 * Loads from:
 *  1) ?present= base64 JSON
 *  2) localStorage fumoca_present_v1[nifId|splatId]
 *  3) window.__FUMOCA_PRESENT__ (injected)
 *  4) record.meta.present if host sets it
 */
import {
  initMagazineText, importAll as importMagazine, clearText,
} from './present-magazine-text.js';
import {
  initPresentNav, setNavStops, importStops,
} from './present-nav.js';

function b64Json(s) {
  try {
    const json = decodeURIComponent(escape(atob(s)));
    return JSON.parse(json);
  } catch {
    try { return JSON.parse(atob(s)); } catch { return null; }
  }
}

function idFromPage() {
  const q = new URLSearchParams(location.search);
  return (
    q.get('nifId') ||
    q.get('splatId') ||
    q.get('id') ||
    window._fumocaCurrentSplatId ||
    window._fumocaCurrentRecord?.id ||
    null
  );
}

function fromLocal(id) {
  if (!id) return null;
  try {
    const all = JSON.parse(localStorage.getItem('fumoca_present_v1') || '{}');
    return all[id] || all.default || null;
  } catch { return null; }
}

function fromQuery() {
  const p = new URLSearchParams(location.search).get('present');
  if (!p) return null;
  return b64Json(p);
}

function applyPayload(data) {
  if (!data) return false;
  if (Array.isArray(data.magazine) && data.magazine.length) {
    importMagazine(data.magazine);
  }
  if (Array.isArray(data.nav) && data.nav.length) {
    setNavStops(data.nav);
  }
  return !!(data.magazine?.length || data.nav?.length);
}

export function initPresentViewer() {
  // CSS
  if (!document.querySelector('link[href*="present-magazine.css"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/css/present-magazine.css';
    document.head.appendChild(link);
  }

  initMagazineText({ editable: false });
  initPresentNav({ editable: false });

  let applied = false;
  const tryApply = () => {
    if (applied) return;
    const data =
      fromQuery() ||
      window.__FUMOCA_PRESENT__ ||
      window._fumocaCurrentRecord?.meta?.present ||
      window._fumocaCurrentRecord?.metadata?.present ||
      fromLocal(idFromPage());
    if (data && applyPayload(data)) {
      applied = true;
      console.info('[present-viewer] applied cover/nav');
    }
  };

  tryApply();
  [600, 1500, 3000].forEach((ms) => setTimeout(tryApply, ms));
  window.addEventListener('fumoca:splatLoaded', tryApply);
  window.addEventListener('fumoca:recordReady', tryApply);

  window.FumocaPresentViewer = {
    apply: applyPayload,
    clear: () => { clearText(); setNavStops([]); },
    reload: () => { applied = false; tryApply(); },
  };
}

if (typeof window !== 'undefined') {
  const boot = () => {
    try { initPresentViewer(); } catch (e) { console.warn('[present-viewer]', e); }
  };
  if (document.readyState === 'complete') setTimeout(boot, 300);
  else window.addEventListener('load', () => setTimeout(boot, 300));
}
