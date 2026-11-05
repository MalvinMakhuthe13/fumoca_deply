/**
 * Public viewer: restore magazine text + review video from ?present= / localStorage / meta
 */
import { initMagazineText, importAll as importMagazine } from './present-magazine-text.js';
import { initPresentNav, setNavStops } from './present-nav.js';

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
  initPresentNav({ editable: false });

  let applied = false;
  const tryApply = () => {
    if (applied) return;
    const data = resolvePresent();
    if (!data) return;
    if (data.magazine?.length) {
      importMagazine(data.magazine);
      applied = true;
      console.info('[present-viewer] magazine text restored');
    }
    if (data.nav?.length) setNavStops(data.nav);

    // Restore the same poster composition used in Studio and in the share URL.
    // This changes presentation state only; it does not mutate Gaussian data.
    const poster = data.poster;
    if (poster && window.FumocaPoster) {
      try {
        if (poster.preset) window.FumocaPoster.setPreset(poster.preset);
        if (poster.composition) window.FumocaPoster.updateComposition(poster.composition);
        window.FumocaPoster.setEnabled(!!poster.enabled);
        console.info('[present-viewer] poster composition restored', poster.preset || 'product');
      } catch (error) {
        console.warn('[present-viewer] poster composition could not be restored', error);
      }
    }

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
