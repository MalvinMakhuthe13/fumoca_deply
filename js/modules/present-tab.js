/**
 * FUMOCA Present Tab — all Present tools live in the Present sidebar section
 * Magazine text · Nav · Review video · Save / share (keeps text for viewer)
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

function idKey() {
  const q = new URLSearchParams(location.search);
  return (
    q.get('nifId') || q.get('splatId') || q.get('id') ||
    window._fumocaCurrentSplatId ||
    window._fumocaCurrentRecord?.id ||
    'default'
  );
}

function loadLocal() {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return all[idKey()] || all.default || null;
  } catch { return null; }
}

function saveLocal(data) {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    const id = idKey();
    all[id] = data;
    all.default = data;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch (_) {}
}

function payload() {
  return {
    magazine: exportMagazine(),
    nav: exportStops(),
    reviewLayout: window.FumocaReviewVideo?.getLayout?.() || null,
    reviewUrl: (window.FumocaReviewVideo?.getSrc?.() && !String(window.FumocaReviewVideo.getSrc()).startsWith('blob:'))
      ? window.FumocaReviewVideo.getSrc()
      : null,
    updatedAt: Date.now(),
  };
}

function persist() {
  const data = payload();
  saveLocal(data);
  window.__FUMOCA_PRESENT__ = data;
  try {
    const rec = window._fumocaCurrentRecord;
    if (rec) {
      rec.meta = rec.meta || {};
      rec.metadata = rec.metadata || {};
      rec.meta.present = data;
      rec.metadata.present = data;
      if (data.reviewUrl) {
        rec.meta.reviewVideo = { url: data.reviewUrl };
        rec.metadata.reviewVideo = { url: data.reviewUrl };
      }
    }
  } catch (_) {}
  return data;
}

function copyViewerLink() {
  const data = persist();
  let json;
  try {
    json = btoa(unescape(encodeURIComponent(JSON.stringify({
      magazine: data.magazine,
      nav: data.nav,
      reviewUrl: data.reviewUrl,
      reviewLayout: data.reviewLayout || 'stack',
    }))));
  } catch {
    json = '';
  }
  const id = idKey();
  let base = window._fumocaShareUrl || `${location.origin}/viewer?nifId=${encodeURIComponent(id === 'default' ? '' : id)}`;
  const url = new URL(base, location.origin);
  if (json) url.searchParams.set('present', json);
  if (data.reviewUrl) url.searchParams.set('review', data.reviewUrl);
  if (data.reviewLayout) url.searchParams.set('rvLayout', data.reviewLayout);
  const str = url.toString();
  navigator.clipboard?.writeText(str).then(
    () => alert('Viewer link copied.\nIncludes magazine text' + (data.reviewUrl ? ' + review video URL' : ' (local video stays on this device only)') + '.'),
    () => prompt('Copy link:', str)
  );
}

function findPresentHost() {
  // Prefer visible Present tab content region
  const candidates = [
    document.querySelector('[data-panel="present"]'),
    document.querySelector('#presentPanel'),
    document.querySelector('.panel-present'),
    document.querySelector('[data-tab="present"]'),
    ...Array.from(document.querySelectorAll('aside, .sidebar, .left-panel, #leftPanel')).flatMap((el) =>
      Array.from(el.querySelectorAll('[class*="present"], [id*="present"]'))
    ),
  ].filter(Boolean);

  for (const el of candidates) {
    if (el && el.offsetParent !== null) return el;
  }

  // Fallback: create dock under left column
  let dock = document.getElementById('fumocaPresentDock');
  if (!dock) {
    dock = document.createElement('div');
    dock.id = 'fumocaPresentDock';
    dock.style.cssText = 'position:absolute;left:12px;top:120px;width:260px;z-index:35;max-height:calc(100vh - 180px);overflow:auto;pointer-events:auto';
    const stage = document.getElementById('stage') || document.getElementById('viewport') || document.body;
    stage.appendChild(dock);
  }
  return dock;
}

function mountPanel() {
  let panel = document.getElementById('fumocaPresentTabPanel');
  if (panel) return panel;

  panel = document.createElement('div');
  panel.id = 'fumocaPresentTabPanel';
  panel.innerHTML = `
    <div class="ptp-section">
      <div class="ptp-title">Magazine cover text</div>
      <div class="ptp-row">
        <button type="button" data-act="weekly">WEEKLY</button>
        <button type="button" data-act="48hours">48 HOURS</button>
        <button type="button" data-act="product">Product</button>
        <button type="button" data-act="hero">Hero title</button>
        <button type="button" data-act="clear-text">Clear text</button>
      </div>
      <div class="ptp-hint">Text is saved with Copy viewer link so public viewers keep the cover.</div>
    </div>
    <div class="ptp-section">
      <div class="ptp-title">Nav · Matterport style</div>
      <div class="ptp-row">
        <button type="button" data-act="add-nav">+ Nav stop</button>
        <button type="button" data-act="from-hs">From hotspots</button>
        <button type="button" data-act="save" class="primary">Save</button>
        <button type="button" data-act="copy" class="primary">Copy viewer link</button>
      </div>
    </div>
    <div class="ptp-section">
      <div class="ptp-title">Review video</div>
      <div class="ptp-row">
        <button type="button" data-act="pick" class="primary">Upload from device</button>
        <button type="button" data-act="url">Paste URL</button>
        <button type="button" data-act="clear-vid">Clear</button>
      </div>
      <div class="ptp-row" style="margin-top:8px">
        <button type="button" data-layout="pip">PIP</button>
        <button type="button" data-layout="stack">Stack 50/50</button>
        <button type="button" data-layout="split">Split 50/50</button>
        <button type="button" data-layout="full">Full video</button>
        <button type="button" data-layout="cinema">Cinema</button>
        <button type="button" data-layout="bg">BG</button>
        <button type="button" data-layout="hidden">Off</button>
      </div>
      <div class="ptp-status" id="ptpVidStatus">Stack / Split = equal space. Full = video only.</div>
    </div>
  `;

  const host = findPresentHost();
  host.appendChild(panel);

  panel.addEventListener('click', (e) => {
    const layoutBtn = e.target.closest('[data-layout]');
    if (layoutBtn) {
      window.FumocaReviewVideo?.setLayout?.(layoutBtn.dataset.layout);
      panel.querySelectorAll('[data-layout]').forEach((b) =>
        b.classList.toggle('active', b === layoutBtn)
      );
      persist();
      return;
    }
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'weekly') applyPreset('weekly');
    if (act === '48hours') applyPreset('48hours');
    if (act === 'product') applyPreset('product');
    if (act === 'hero') applyPreset('hero');
    if (act === 'clear-text') clearText();
    if (act === 'add-nav') {
      const hs = window._fumocaHotspots?.slice?.(-1)?.[0];
      if (hs && Number.isFinite(hs.wx)) {
        addNavStop({ label: hs.title || 'View', wx: hs.wx, wy: hs.wy, wz: hs.wz, zoom: 1.4 });
      } else addNavStop({ label: 'View', sx: 50, sy: 50, zoom: 1.25 });
    }
    if (act === 'from-hs') setNavStops(stopsFromHotspots(window._fumocaHotspots || []));
    if (act === 'save') {
      persist();
      alert('Present saved for this asset (text + nav). Use Copy viewer link to keep text on the public page.');
    }
    if (act === 'copy') copyViewerLink();
    if (act === 'pick') window.FumocaReviewVideo?.pickFromDevice?.({ layout: 'stack' });
    if (act === 'url') {
      const u = prompt('Direct MP4 URL', 'https://');
      if (u?.startsWith('http')) window.FumocaReviewVideo?.set?.(u, { layout: 'stack' });
    }
    if (act === 'clear-vid') {
      window.FumocaReviewVideo?.set?.(null);
      const st = document.getElementById('ptpVidStatus');
      if (st) st.textContent = 'Video cleared';
    }
    persist();
  });

  window.addEventListener('fumoca:reviewVideoLocal', (ev) => {
    const st = document.getElementById('ptpVidStatus');
    if (st && ev.detail?.name) {
      st.textContent = ev.detail.name + ' · session preview. Paste CDN URL + Copy viewer link to share.';
    }
  });

  return panel;
}

export function initPresentTab() {
  // CSS
  if (!document.querySelector('link[href*="present-unified.css"]')) {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = 'css/present-unified.css';
    document.head.appendChild(l);
  }

  initMagazineText({ editable: true, onChange: () => persist() });
  initPresentNav({
    onArrive: (s) => window.dispatchEvent(new CustomEvent('fumoca:navArrive', { detail: s })),
    onChange: () => persist(),
  });
  setMagEditable(true);

  const saved = loadLocal();
  if (saved?.magazine?.length) importMagazine(saved.magazine);
  if (saved?.nav?.length) importStops(saved.nav);

  const tryMount = () => mountPanel();
  tryMount();
  [500, 1200, 2500].forEach((t) => setTimeout(tryMount, t));

  // When user clicks Present tab, remount into that panel
  document.addEventListener('click', (e) => {
    const t = e.target.closest?.('[data-tab], button, a, .tab');
    if (!t) return;
    const label = (t.textContent || '').toLowerCase();
    if (label.includes('present') || t.getAttribute('data-tab') === 'present') {
      setTimeout(tryMount, 100);
    }
  });

  window.addEventListener('fumoca:hotspotActivate', (ev) => {
    const h = ev.detail;
    if (!h || !Number.isFinite(h.wx)) return;
    flyToStop({ id: h.id, label: h.title, wx: h.wx, wy: h.wy, wz: h.wz, zoom: h.zoom || 1.35 });
  });

  window.FumocaPresent = {
    save: persist,
    copyViewerLink,
    applyPreset,
    clearText,
    exportMagazine,
    exportStops,
  };
}

if (typeof window !== 'undefined') {
  const boot = () => {
    if (window.__fumocaPresentTabBooted) return;
    // Only on editor-like pages
    if (!/\/edit/i.test(location.pathname) && !document.body?.classList?.contains('editor')) {
      // still allow if present tools wanted
    }
    window.__fumocaPresentTabBooted = true;
    try { initPresentTab(); } catch (e) { console.warn('[present-tab]', e); }
  };
  if (document.readyState === 'complete') setTimeout(boot, 400);
  else window.addEventListener('load', () => setTimeout(boot, 400));
}
