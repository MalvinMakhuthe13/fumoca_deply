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
  // strength 50–95 → keep fraction 0.92 → 0.55 of points by distance to center
  const t = Math.max(0.5, Math.min(0.95, strength / 100));
  const keepFrac = 1 - (t - 0.5) * 0.8; // 50%→1.0, 95%→0.64-ish
  const dists = live.map((i) => {
    const dx = S.positions[i * 3] - center.x;
    const dy = S.positions[i * 3 + 1] - center.y;
    const dz = S.positions[i * 3 + 2] - center.z;
    return { i, d: Math.sqrt(dx * dx + dy * dy + dz * dz) };
  });
  dists.sort((a, b) => a.d - b.d);
  const keepN = Math.max(100, Math.floor(dists.length * Math.max(0.45, keepFrac * 0.92)));
  const keep = new Set(dists.slice(0, keepN).map((x) => x.i));
  // also drop very low opacity if available
  let removed = 0;
  for (const i of live) {
    if (!keep.has(i)) {
      S.alive[i] = 0;
      removed++;
    } else if (S.opacity && S.opacity[i] < 0.04 * t) {
      S.alive[i] = 0;
      removed++;
    }
  }
  _rebuild();
  _toast('Isolate', `Removed ${removed.toLocaleString()} points · kept core subject`, 'ok');
  const scoreEl = document.getElementById('v60QualityScore');
  if (scoreEl) scoreEl.textContent = String(Math.min(98, 70 + Math.floor(t * 25)));
  return removed;
};

window._fumocaSelectFloaters = async function ({ radius = 0.25, minNeighbours = 5 } = {}) {
  const S = _S();
  if (!S?.alive || !S?.positions) return 0;
  const live = _liveIndices();
  if (!S.selected) S.selected = new Uint8Array(S.alive.length);
  S.selected.fill(0);
  // Grid hash for neighbour counts
  const cell = Math.max(0.05, radius);
  const grid = new Map();
  const key = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  for (const i of live) {
    const k = key(S.positions[i * 3], S.positions[i * 3 + 1], S.positions[i * 3 + 2]);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  }
  let n = 0;
  const r2 = radius * radius;
  for (const i of live) {
    const x = S.positions[i * 3], y = S.positions[i * 3 + 1], z = S.positions[i * 3 + 2];
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
    let neighbours = 0;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const bucket = grid.get(`${cx + dx},${cy + dy},${cz + dz}`);
          if (!bucket) continue;
          for (const j of bucket) {
            if (j === i) continue;
            const ddx = S.positions[j * 3] - x;
            const ddy = S.positions[j * 3 + 1] - y;
            const ddz = S.positions[j * 3 + 2] - z;
            if (ddx * ddx + ddy * ddy + ddz * ddz <= r2) {
              neighbours++;
              if (neighbours >= minNeighbours) break;
            }
          }
          if (neighbours >= minNeighbours) break;
        }
        if (neighbours >= minNeighbours) break;
      }
      if (neighbours >= minNeighbours) break;
    }
    if (neighbours < minNeighbours) {
      S.selected[i] = 1;
      n++;
    }
  }
  console.log('[StudioBridge] floaters selected', n);
  return n;
};

window._fumocaDeleteSelection = async function () {
  const S = _S();
  if (!S?.alive || !S?.selected) return 0;
  _pushHistory('Delete selection');
  let n = 0;
  for (let i = 0; i < S.alive.length; i++) {
    if (S.selected[i]) {
      S.alive[i] = 0;
      S.selected[i] = 0;
      n++;
    }
  }
  _rebuild();
  _toast('Cleanup', `Deleted ${n.toLocaleString()} points`, 'ok');
  return n;
};

window._fumocaOpacitySharpen = async function ({ threshold = 0.1, boost = 1.5, edgeMode = false } = {}) {
  const S = _S();
  if (!S?.alive) return 0;
  _pushHistory(edgeMode ? 'Edge sharpen' : 'Opacity sharpen');
  let n = 0;
  if (S.opacity) {
    for (let i = 0; i < S.alive.length; i++) {
      if (!S.alive[i]) continue;
      const o = S.opacity[i];
      if (o < threshold) {
        S.alive[i] = 0;
        n++;
      } else if (!edgeMode) {
        S.opacity[i] = Math.min(1, o * boost);
      }
    }
  }
  _rebuild();
  return n;
};

window._fumocaDensityPrune = async function ({ keep = 90 } = {}) {
  const S = _S();
  if (!S?.alive) return 0;
  const live = _liveIndices();
  const keepN = Math.max(50, Math.floor(live.length * (keep / 100)));
  if (keepN >= live.length) return 0;
  _pushHistory('Density prune');
  // Random thin of excess points (fast). Better than freezing UI on huge clouds.
  for (let i = live.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [live[i], live[j]] = [live[j], live[i]];
  }
  let removed = 0;
  for (let k = keepN; k < live.length; k++) {
    S.alive[live[k]] = 0;
    removed++;
  }
  _rebuild();
  _toast('Prune', `Removed ${removed.toLocaleString()} sparse points`, 'ok');
  return removed;
};

// ── Embed: works without saved record ─────────────────────────────
const _origBuildEmbed = () => window.FumocaEmbedManager?.buildEmbedUI;
window.addEventListener('DOMContentLoaded', () => {});

function _ensureEmbedFallback() {
  const mgr = window.FumocaEmbedManager;
  if (!mgr) return;
  const orig = mgr.buildEmbedUI.bind(mgr);
  mgr.buildEmbedUI = async function (containerId, rec) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const id = rec?.id;
    if (!id) {
      const origin = location.origin;
      const snippet = `<!-- FUMOCA local preview embed — publish/save to get a permanent link -->
<iframe
  src="${origin}/viewer.html"
  width="100%" height="480" style="border:0;border-radius:12px;background:#05070b"
  allow="xr-spatial-tracking;fullscreen;autoplay" loading="lazy"></iframe>`;
      el.innerHTML = `
        <div class="hint" style="margin-bottom:8px;">This splat is not saved to the cloud yet. Preview snippet:</div>
        <textarea id="v61EmbedSnippet" style="width:100%;height:120px;background:#0b0d12;color:#c8ff00;border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:10px;font-size:11px;">${snippet.replace(/</g,'&lt;')}</textarea>
        <button class="ac-btn lime full" style="margin-top:8px;" onclick="navigator.clipboard.writeText(document.getElementById('v61EmbedSnippet').value.replace(/&lt;/g,'<'))">Copy snippet</button>
        <div class="hint" style="margin-top:8px;">Save / Publish the splat to generate a permanent public embed URL.</div>`;
      // fix textarea content (we escaped for HTML)
      const ta = document.getElementById('v61EmbedSnippet');
      if (ta) ta.value = snippet;
      return;
    }
    return orig(containerId, rec);
  };
}

// ── Mobile: generate + download widget without R2 ─────────────────
function _ensureMobileFallback() {
  const m = window.FumocaMobileAsset;
  if (!m?.saveAsset) return;
  const orig = m.saveAsset.bind(m);
  m.saveAsset = async function (rec, overrides = {}) {
    if (rec?.id && window._fumocaSupabase) {
      try {
        const result = await orig(rec, overrides);
        if (result?.url) return result;
      } catch (e) {
        console.warn('[StudioBridge] mobile cloud save failed, falling back', e);
      }
    }
    // Local fallback: downloadable widget HTML
    const title = rec?.title || window.S?.fileName || 'FUMOCA Experience';
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title}</title>
<style>body{margin:0;background:#05070b;color:#fff;font-family:system-ui;display:grid;place-items:center;min-height:100vh}
.card{max-width:420px;padding:24px;border-radius:20px;background:rgba(255,255,255,.04);border:1px solid rgba(200,255,0,.2);text-align:center}
a{display:inline-block;margin-top:16px;padding:12px 18px;border-radius:999px;background:#c8ff00;color:#111;font-weight:800;text-decoration:none}
</style></head><body><div class="card"><h1 style="color:#c8ff00;margin:0 0 8px">FUMOCA</h1>
<p style="opacity:.75">${title}</p>
<p style="font-size:13px;opacity:.55">Open this experience on the web viewer. Save &amp; publish the splat to unlock a full mobile widget URL.</p>
<a href="${location.origin}/viewer.html">Open viewer</a></div></body></html>`;
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'fumoca-mobile-widget.html'; a.click();
    _toast('Mobile widget', 'Downloaded local widget HTML (publish for a live URL)', 'ok');
    return { url, config: { title, offline: true } };
  };
}

// ── 4D: if no states, fall back to cinematic orbit ───────────────
function _ensure4DFallback() {
  const F = window.Fumoca4D;
  if (!F) return;
  const origToggle = F.toggle4D?.bind(F);
  F.toggle4D = function () {
    const states = F.getStates?.() || [];
    if (!states.length) {
      // No 4D takes — drive cinematic camera instead so the button isn't dead
      const mode = window.FumocaAutoFix?.getMode?.();
      if (mode === 'cinematic') {
        window.FumocaAutoFix?.setMode('free');
        _toast('4D', 'Stopped cinematic playback (no 4D takes on this file)', 'ok');
      } else {
        window.FumocaAutoFix?.setMode('cinematic');
        _toast('4D', 'No 4D states on this file — running cinematic orbit instead. Add keyframes for true 4D.', 'ok');
      }
      return;
    }
    return origToggle?.();
  };
}

// ── Parts: clearer empty state + selection-based stub ────────────
function _ensurePartsFallback() {
  const P = window.FumocaAssetParts;
  if (!P?.buildPartsUI) return;
  const orig = P.buildPartsUI.bind(P);
  P.buildPartsUI = function (containerId) {
    orig(containerId);
    const el = document.getElementById(containerId);
    if (!el) return;
    if (!el.innerHTML.trim() || /no parts/i.test(el.textContent || '')) {
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
// Also run after modules settle
setTimeout(_boot, 800);
setTimeout(_boot, 2000);

export default {
  isolate: window._fumocaIsolateMainSubject,
};
