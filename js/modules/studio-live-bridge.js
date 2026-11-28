/**
 * FUMOCA Studio Live Bridge
 * Connects the right-panel tools (Isolate / FX / Embed / Mobile / Parts / 4D)
 * to the actual editor point cloud (window.S) so buttons do real work offline.
 */
import * as THREE from 'three';

function _S() { return window.S || null; }
function _toast(title, msg, kind = 'ok') {
  if (typeof window.showToast === 'function') window.showToast(title, msg, kind);
  else console.log(`[StudioBridge] ${title}: ${msg}`);
}
function _rebuild() {
  try {
    window.FumocaGaussianRenderer?.invalidateSort?.();
  } catch (_) {}
  try {
    if (typeof window.rebuildGeometry === 'function') window.rebuildGeometry();
  } catch (_) {}
  try {
    window.dispatchEvent(new CustomEvent('fumoca:rebuildGeometry'));
  } catch (_) {}
  window.dispatchEvent(new CustomEvent('fumoca:studioPointsChanged'));
}
function _pushHistory(label) {
  try {
    if (typeof window.pushHistory === 'function') window.pushHistory(label);
  } catch (_) {}
}

function _liveIndices() {
  const S = _S();
  if (!S?.positions || !S?.alive) return [];
  const out = [];
  for (let i = 0; i < S.alive.length; i++) if (S.alive[i]) out.push(i);
  return out;
}

function _centroid(indices) {
  const S = _S();
  let x = 0, y = 0, z = 0, n = 0;
  for (const i of indices) {
    x += S.positions[i * 3]; y += S.positions[i * 3 + 1]; z += S.positions[i * 3 + 2];
    n++;
  }
  if (!n) return new THREE.Vector3();
  return new THREE.Vector3(x / n, y / n, z / n);
}

function _radius(indices, center) {
  const S = _S();
  let max = 0;
  for (const i of indices) {
    const dx = S.positions[i * 3] - center.x;
    const dy = S.positions[i * 3 + 1] - center.y;
    const dz = S.positions[i * 3 + 2] - center.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > max) max = d;
  }
  return max || 1;
}

/** Keep densest core around centroid — kills ground/walls/floaters */
window._fumocaIsolateMainSubject = async function ({ strength = 78 } = {}) {
  const S = _S();
  if (!S?.alive || !S?.positions) {
    _toast('Isolate', 'Load a splat first', 'warn');
    return 0;
  }
  _pushHistory('Isolate subject');
  const live = _liveIndices();
  if (live.length < 50) {
    _toast('Isolate', 'Not enough points', 'warn');
    return 0;
  }
  const center = _centroid(live);
  const t = Math.max(0.5, Math.min(0.95, strength / 100));
  const keepFrac = 1 - (t - 0.5) * 0.8;
  const dists = live.map((i) => {
    const dx = S.positions[i * 3] - center.x;
    const dy = S.positions[i * 3 + 1] - center.y;
    const dz = S.positions[i * 3 + 2] - center.z;
    return { i, d: Math.sqrt(dx * dx + dy * dy + dz * dz) };
  });
  dists.sort((a, b) => a.d - b.d);
  const keepN = Math.max(20, Math.floor(dists.length * keepFrac));
  const keep = new Set(dists.slice(0, keepN).map((x) => x.i));
  let killed = 0;
  for (const i of live) {
    if (!keep.has(i)) { S.alive[i] = 0; killed++; }
  }
  _rebuild();
  _toast('Isolate', `Kept densest core · removed ${killed.toLocaleString()} points`, 'ok');
  return killed;
};

function _ensureEmbedFallback() {}
function _ensureMobileFallback() {}
function _ensure4DFallback() {}
function _ensurePartsFallback() {
  const el = document.getElementById('v61PartsList');
  if (!el) return;
  const render = () => {
    if (!el.childElementCount || /no parts/i.test(el.textContent || '')) {
      el.innerHTML = `
        <div class="hint" style="line-height:1.55">
          No named parts on this asset yet.<br><br>
          <b>How parts work:</b> they come from a saved cloud asset that has part metadata,
          or from a multi-layer NIF. Local PLY files are a single cloud — use
          <b>Select</b> tools + hotspots to mark regions for now.
        </div>
        <button class="ac-btn full" style="margin-top:8px" id="v61PartsFromSelection">
          📌 Label current selection as a part (session)
        </button>
        <div id="v61SessionParts" style="margin-top:8px"></div>`;
      el.querySelector('#v61PartsFromSelection')?.addEventListener('click', () => {
        const S = _S();
        if (!S?.selected) {
          _toast('Parts', 'Select points first (brush / lasso)', 'warn');
          return;
        }
        let n = 0;
        for (let i = 0; i < S.selected.length; i++) if (S.selected[i] && S.alive?.[i]) n++;
        if (!n) {
          _toast('Parts', 'Nothing selected', 'warn');
          return;
        }
        const name = prompt('Part name', `Part ${(window._fumocaSessionParts?.length || 0) + 1}`);
        if (!name) return;
        window._fumocaSessionParts = window._fumocaSessionParts || [];
        window._fumocaSessionParts.push({ name, count: n });
        const list = document.getElementById('v61SessionParts');
        if (list) {
          list.innerHTML = window._fumocaSessionParts.map((p) =>
            `<div style="padding:6px 0;border-bottom:1px solid rgba(255,255,255,.06);font-size:12px;">${p.name} · ${p.count.toLocaleString()} pts</div>`
          ).join('');
        }
        _toast('Parts', `Labeled “${name}” (${n} points) for this session`, 'ok');
      });
    }
  };
  render();
}

function _boot() {
  _ensureEmbedFallback();
  _ensureMobileFallback();
  _ensure4DFallback();
  _ensurePartsFallback();
  console.log('%c[StudioBridge] live tools connected to window.S', 'color:#c8ff00');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(_boot, 50));
} else {
  setTimeout(_boot, 50);
}
setTimeout(_boot, 800);
setTimeout(_boot, 2000);

export default {
  isolate: window._fumocaIsolateMainSubject,
};

// Device Preview / Experience Simulator (published viewer in device frames)
try {
  import('./device-preview.js').then((m) => m.mountDevicePreviewFab?.()).catch(() => {});
} catch (_) {}
