/**
 * Public viewer: restore magazine text + review video from ?present= / localStorage / meta
 */
import { initMagazineText, importAll as importMagazine } from './present-magazine-text.js';
import { initPresentNav, setNavStops } from './present-nav.js';
import { initMagazineImages, importAll as importImages } from './present-image-layer.js?v=20261030-decal6';

function b64Json(s) {
  try { return JSON.parse(decodeURIComponent(escape(atob(s)))); }
  catch {
    try { return JSON.parse(atob(s)); } catch { return null; }
  }
}

function idFromPage() {
  const q = new URLSearchParams(location.search);
  return q.get('nifId') || q.get('splatId') || q.get('id') || null;
}

function resolvePresent() {
  const q = new URLSearchParams(location.search);
  if (q.get('present')) {
    const d = b64Json(q.get('present'));
    if (d) return d;
  }
  if (window.__FUMOCA_PRESENT__) return window.__FUMOCA_PRESENT__;
  const rec = window._fumocaCurrentRecord;
  const meta = rec?.meta || rec?.metadata || {};
  if (meta.present) return meta.present;
  try {
    const all = JSON.parse(localStorage.getItem('fumoca_present_v1') || '{}');
    return all[idFromPage()] || all.default || null;
  } catch { return null; }
}

export function initPresentViewer() {
  if (!document.querySelector('link[href*="present-unified.css"]') &&
      !document.querySelector('link[href*="present-magazine.css"]')) {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = 'css/present-unified.css';
    document.head.appendChild(l);
  }

  initMagazineText({ editable: false });
  initMagazineImages({ editable: false });
  initPresentNav({ editable: false });

  let applied = false;
  const tryApply = () => {
    if (applied) return;
    const data = resolvePresent();
    if (!data) return;
    if (data.images?.length) { importImages(data.images); applied = true; console.info('[present-viewer] image layers restored'); }
    if (data.magazine?.length) {
      importMagazine(data.magazine);
      applied = true;
      console.info('[present-viewer] magazine text restored');
    }
    if (data.nav?.length) setNavStops(data.nav);

    const review =
      data.reviewUrl ||
      new URLSearchParams(location.search).get('review') ||
      data.meta?.reviewVideo?.url;
    const layout =
      data.reviewLayout ||
      new URLSearchParams(location.search).get('rvLayout') ||
      'stack';
    if (review && window.FumocaReviewVideo?.set) {
      window.FumocaReviewVideo.set(review, { layout });
    }
  };

  tryApply();
  [500, 1500, 3000].forEach((ms) => setTimeout(tryApply, ms));
  window.addEventListener('fumoca:recordLoaded', tryApply);
  window.addEventListener('fumoca:splatLoaded', tryApply);
  window.FumocaPresentViewer = { reload: () => { applied = false; tryApply(); } };
}

if (typeof window !== 'undefined') {
  const boot = () => { try { initPresentViewer(); } catch (e) { console.warn('[present-viewer]', e); } };
  if (document.readyState === 'complete') setTimeout(boot, 350);
  else window.addEventListener('load', () => setTimeout(boot, 350));
}
