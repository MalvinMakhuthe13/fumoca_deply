/**
 * Public viewer: restore magazine text + review video from ?present= / localStorage / meta
 */
import { initMagazineText, importAll as importMagazine } from './present-magazine-text.js';
import { initPresentNav, setNavStops } from './present-nav.js';
import { PresentationBase } from './presentation-base.js?v=20261030-base1';
import * as THREE from 'three';

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

let restoredBase=null,restoredBaseScene=null;
function restorePresentationBase(data){
  const config=data?.platformBase;
  if(!config?.enabled){restoredBase?.dispose?.();restoredBase=null;restoredBaseScene=null;return;}
  const scene=window._fumocaViewerScene||window._fumocaViewer?.scene||null;if(!scene)return;
  if(restoredBase&&restoredBaseScene===scene){restoredBase.update(config);restoredBase.assembly.visible=true;return;}
  restoredBase?.dispose?.();restoredBaseScene=scene;restoredBase=new PresentationBase(scene,config);restoredBase.assembly.visible=true;
  console.info('[present-viewer] solid presentation platform restored');
}
function resolvePresent(){
  const q = new URLSearchParams(location.search);
  if (q.get('present')) {
    const d = b64Json(q.get('present'));
    if (d) {
      const saved = window._fumocaCurrentRecord?.meta?.present || window._fumocaCurrentRecord?.metadata?.present;
      if (d.platformBase && !d.platformBase.logoUrl && saved?.platformBase?.logoUrl) {
        d.platformBase.logoUrl = saved.platformBase.logoUrl;
      }
      return d;
    }
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
    restorePresentationBase(data);
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
  window.addEventListener('fumoca:viewerReady', () => { applied = false; tryApply(); });
  window.FumocaPresentViewer = { reload: () => { applied = false; tryApply(); } };
}

if (typeof window !== 'undefined') {
  const boot = () => { try { initPresentViewer(); } catch (e) { console.warn('[present-viewer]', e); } };
  if (document.readyState === 'complete') setTimeout(boot, 350);
  else window.addEventListener('load', () => setTimeout(boot, 350));
}
