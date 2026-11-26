/**
 * Public viewer: restore magazine text + review video from ?present= / localStorage / meta
 */
import { initMagazineText, importAll as importMagazine } from './present-magazine-text.js?v=20261127-layouts01';
import { restoreFonts } from './present-fonts.js';
import { filterLayer } from './present-filters.js';
import inspect from './present-inspect.js';
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
  const meta = { ...(rec?.metadata || {}), ...(rec?.meta || {}) };
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

  // Restore each presentation feature independently. The poster module and
  // review-video API may become ready after the magazine text, so one global
  // "applied" flag would permanently skip late-loading features.
  let magazineApplied = false;
  let navApplied = false;
  let posterApplied = false;
  let reviewApplied = false;
  let platformApplied = false;
  let rigApplied = false;
  let livingApplied = false;
  let viewApplied = false;
  let lightingApplied = false;
  let partsApplied = false;
  let tutorialApplied = false;
  let tourApplied = false;
  let fontsApplied = false;
  let filterApplied = false;
  const tryApply = () => {
    const data = resolvePresent();
    if (!data) return;

    // Uploaded fonts first, so the copy draws in them straight away.
    if (!fontsApplied && Array.isArray(data.fonts) && data.fonts.length) { fontsApplied = true; restoreFonts(data.fonts).catch(() => {}); }

    if (!magazineApplied && Array.isArray(data.magazine) && data.magazine.length) {
      importMagazine(data.magazine);
      magazineApplied = true;
      console.info('[present-viewer] magazine text restored');
    }

    if (!navApplied && Array.isArray(data.nav)) {
      setNavStops(data.nav);
      navApplied = true;
    }

    // Restore the same poster composition used in Studio and in the share URL.
    // Wait for the module instead of silently losing the restore on early boot.
    const poster = data.poster;
    if (!posterApplied && poster && window.FumocaPoster) {
      try {
        if (poster.preset) window.FumocaPoster.setPreset(poster.preset);
        if (poster.composition) window.FumocaPoster.updateComposition(poster.composition);
        window.FumocaPoster.setEnabled(!!poster.enabled);
        posterApplied = true;
        inspect.mountButton();   // ⛶ Inspect: out of the layout to full screen and back
        // the viewer's dark focus vignette fights a layout's own look (it turns
        // into a white blob on light paper): only show it with no layout on
        const syncVignette = () => { const fo = document.getElementById('focusOverlay'); if (fo) fo.style.display = window.FumocaPoster?.getState?.()?.enabled ? 'none' : ''; };
        syncVignette(); window.addEventListener('fumoca:posterChange', syncVignette);
        console.info('[present-viewer] poster composition restored', poster.preset || 'product');
      } catch (error) {
        console.warn('[present-viewer] poster composition could not be restored', error);
      }
    }

    // Camera filter (and tap-to-reveal real colour) once the 3D canvas exists.
    if (!filterApplied && data.filter && data.filter.id && data.filter.id !== 'none' && (window._fumocaViewerRenderer || document.querySelector('canvas'))) {
      filterApplied = true;
      setTimeout(() => { try { filterLayer().set(data.filter); } catch (error) { console.warn('[present-viewer] filter', error); } }, 400);
    }

    // Presentation platform saved in Studio (base + logo + turntable).
    if (!platformApplied && data.platform?.enabled && !data.tour?.enabled && window._fumocaPublishedSparkGroup) {   // buildings are not put on a turntable
      platformApplied = true;
      import('./platform-viewer.js')
        .then(m => m.restorePlatform(data.platform))
        .then(ok => { if (!ok) platformApplied = false; else console.info('[present-viewer] platform restored'); })
        .catch(error => { platformApplied = false; console.warn('[present-viewer] platform could not be restored', error); });
    }

    // Skeleton + motion saved in Studio's Rig tab.
    if (!rigApplied && data.rig?.clip && data.rig.autoplay !== false && window._fumocaPublishedSparkMesh) {
      rigApplied = true;
      Promise.all([import('three'), import('./splat-rig-driver.js')])
        .then(([THREE, m]) => m.restoreRigOnViewer(THREE, window._fumocaPublishedSparkMesh, data.rig))
        .then(driver => { if (driver) { window._fumocaRigDriver = driver; console.info('[present-viewer] rig motion playing'); } })
        .catch(error => { console.warn('[present-viewer] rig could not be restored', error); });
    }

    // How it's viewed (start view, zoom limits, locks, spin) + embed URL overrides.
    // (a building tour drives the camera itself: no spin, no product view settings)
    if (!viewApplied && !data.tour?.enabled && window._fumocaViewerCamera && window._fumocaViewerControls && window._fumocaPublishedSparkMesh) {
      viewApplied = true;
      Promise.all([import('three'), import('./view-settings.js')]).then(([THREE, m]) => {
        const settings = m.viewSettingsFromUrl(location.search, m.normalizeViewSettings(data.view));
        if (!settings) return;
        window._fumocaViewController?.dispose?.();
        const vc = new m.ViewController(THREE, window._fumocaViewerCamera, window._fumocaViewerControls, settings,
          { domElement: window._fumocaViewerRenderer?.domElement || window._fumocaPublishedSpark?.renderer?.domElement || null });
        // let the first auto-framing settle, then take over
        setTimeout(() => { vc.apply(); window._fumocaViewController = vc; }, settings.startView ? 0 : 2300);
      }).catch(error => console.warn('[present-viewer] view settings failed', error));
    }

    // Lighting & shadow saved in Studio's Look tab.
    if (!lightingApplied && data.lighting?.enabled && window._fumocaPublishedSparkMesh) {
      lightingApplied = true;
      Promise.all([import('three'), import('./splat-lighting.js')])
        .then(([THREE, m]) => m.applyLightingOnViewer(THREE, window._fumocaPublishedSparkMesh, data.lighting))
        .then(l => { if (l) { window._fumocaLighting = l; console.info('[present-viewer] lighting applied'); } })
        .catch(error => console.warn('[present-viewer] lighting failed', error));
    }

    // Moving parts (doors, lids, caps…) driven by hotspots.
    if (!partsApplied && Array.isArray(data.parts) && data.parts.length && window._fumocaPublishedSparkMesh) {
      partsApplied = true;
      Promise.all([import('three'), import('./part-animator.js')])
        .then(([THREE, m]) => m.restorePartsOnViewer(THREE, window._fumocaPublishedSparkMesh, data.parts))
        .then(a => {
          if (!a) return;
          window._fumocaPartAnimator = a;
          window.FumocaParts = { run: (id, to) => a.run(id, to, { by: 'visitor' }), list: () => a.list().map(p => ({ id: p.id, name: p.name })) };
          // Linked insides (cabin, rooms, inside a fridge) fade in as their doors open.
          if (Array.isArray(data.links) && data.links.length) {
            return Promise.all([import('three'), import('./scan-link.js')]).then(([THREE, sl]) => {
              window._fumocaInsideReveal = new sl.InsideReveal(THREE, window._fumocaPublishedSparkMesh, a, data.links);
            });
          }
        })
        .catch(error => console.warn('[present-viewer] moving parts failed', error));
    }

    // House / building tour: dollhouse, floor plan, walk-through (no flipping).
    if (!tourApplied && data.tour?.enabled && window._fumocaViewerCamera && window._fumocaPublishedSparkMesh) {
      tourApplied = true;
      Promise.all([import('three'), import('./tour-mode.js'), import('./splat-rig-driver.js')]).then(async ([THREE, m, rig]) => {
        const mesh = window._fumocaPublishedSparkMesh;
        if (mesh.initialized) await mesh.initialized;
        const rest = rig.readRest(mesh);
        mesh.updateMatrixWorld(true);
        // world-space positions for picking the floor
        const P = new Float32Array(rest.positions.length), v = new THREE.Vector3();
        for (let i = 0; i < rest.count; i++) { v.set(rest.positions[i * 3], rest.positions[i * 3 + 1], rest.positions[i * 3 + 2]).applyMatrix4(mesh.matrixWorld); P[i * 3] = v.x; P[i * 3 + 1] = v.y; P[i * 3 + 2] = v.z; }
        const ctrl = new m.TourController(data.tour, {
          THREE, camera: window._fumocaViewerCamera, controls: window._fumocaViewerControls,
          dom: window._fumocaViewerRenderer?.domElement, parent: window._fumocaViewerScene || mesh.parent, mesh,
          positions: P, count: rest.count, accept: (i) => rest.opacity[i] >= 0.3,
          host: window._fumocaViewerRenderer?.domElement?.parentElement,
        });
        // a building doesn't spin
        if (window._fumocaViewController) { window._fumocaViewController.s.spin = 0; }
        ctrl.setMode(m.normalizeTour(data.tour).start);
        window._fumocaTour = ctrl;
      }).catch(error => console.warn('[present-viewer] tour failed', error));
    }

    // Product guide: "How it works" button and step-by-step player.
    if (!tutorialApplied && data.tutorial?.steps?.length && window._fumocaViewerCamera && window._fumocaPublishedSparkMesh) {
      tutorialApplied = true;
      Promise.all([import('three'), import('./tutorial.js'), import('./hotspot-actions.js')]).then(([THREE, m, actions]) => {
        const host = window._fumocaViewerRenderer?.domElement?.parentElement;
        window._fumocaTutorial = m.mountTutorialOnViewer(THREE, data.tutorial, {
          camera: window._fumocaViewerCamera, controls: window._fumocaViewerControls, host,
          parent: window._fumocaPublishedSparkMesh, runAction: (a) => actions.runAction(a),
        });
      }).catch(error => console.warn('[present-viewer] guide failed', error));
    }

    // Living photo: gentle camera motion saved in Studio.
    if (!livingApplied && data.living?.enabled && window._fumocaViewerCamera && window._fumocaPublishedSparkMesh) {
      livingApplied = true;
      Promise.all([import('three'), import('./living-photo-motion.js')])
        .then(([THREE, m]) => { window._fumocaLivingMotion = m.startLivingMotionOnViewer(THREE, data.living); })
        .catch(error => console.warn('[present-viewer] living photo motion could not start', error));
    }

    const review =
      data.reviewUrl ||
      new URLSearchParams(location.search).get('review') ||
      data.meta?.reviewVideo?.url;
    const layout =
      data.reviewLayout ||
      new URLSearchParams(location.search).get('rvLayout') ||
      'stack';
    if (!reviewApplied && review && window.FumocaReviewVideo?.set) {
      window.FumocaReviewVideo.set(review, { layout });
      reviewApplied = true;
    }
  };

  tryApply();
  [500, 1500, 3000].forEach((ms) => setTimeout(tryApply, ms));
  window.addEventListener('fumoca:recordLoaded', tryApply);
  window.addEventListener('fumoca:splatLoaded', tryApply);
  // viewer.js imports poster-composer asynchronously; restore immediately when
  // its API becomes available, even if the initial boot retries have elapsed.
  window.addEventListener('fumoca:posterReady', tryApply);
  window.addEventListener('fumoca:viewerReady', tryApply);
  window.FumocaPresentViewer = {
    reload: () => {
      magazineApplied = false;
      navApplied = false;
      posterApplied = false;
      reviewApplied = false;
      platformApplied = false;
      window._fumocaRigDriver?.dispose?.(); window._fumocaRigDriver = null;
      rigApplied = false;
      window._fumocaLivingMotion?.dispose?.(); window._fumocaLivingMotion = null;
      livingApplied = false;
      window._fumocaViewController?.dispose?.(); window._fumocaViewController = null; viewApplied = false;
      window._fumocaLighting?.dispose?.(); window._fumocaLighting = null; lightingApplied = false;
      window._fumocaInsideReveal?.dispose?.(); window._fumocaInsideReveal = null;
      window._fumocaPartAnimator?.dispose?.(); window._fumocaPartAnimator = null; partsApplied = false;
      window._fumocaTour?.dispose?.(); window._fumocaTour = null; tourApplied = false;
      window._fumocaTutorial?.player?.dispose?.(); window._fumocaTutorial?.button?.remove?.(); window._fumocaTutorial = null; tutorialApplied = false;
      tryApply();
    },
  };
}

if (typeof window !== 'undefined') {
  const boot = () => { try { initPresentViewer(); } catch (e) { console.warn('[present-viewer]', e); } };
  if (document.readyState === 'complete') setTimeout(boot, 350);
  else window.addEventListener('load', () => setTimeout(boot, 350));
}
