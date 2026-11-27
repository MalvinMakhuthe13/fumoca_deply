/**
 * Studio "Tour" tab: turn a scan of a house, flat, shop or venue into a
 * Matterport-style tour — dollhouse, floor plan and walk-through at eye
 * height, with tour stops visitors can click. No flipping, spinning or tilting.
 */
import * as THREE from 'three';
import { normalizeTour, detectFloor, TourController } from './tour-mode.js';
import { pickSplat } from './scan-link.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function mountTourPanel(container, { onStatus } = {}) {
  if (!container) return null;
  container.innerHTML = `
    <div class="section">
      <div class="sec-head"><span class="sec-label">House &amp; building tour</span><span class="sec-badge">NEW</span></div>
      <div class="sec-body" style="padding:10px">
        <div class="hint">For houses, flats, shops and venues: visitors get a dollhouse view, a floor plan and a walk-through at eye height — the building never flips, spins or tilts.</div>
        <label style="display:flex;gap:6px;align-items:center;font-size:12px;margin-top:8px"><input type="checkbox" id="trOn"> This scan is a building (use the tour on the published page)</label>
        <div class="btn-grid col2" style="margin-top:8px">
          <button type="button" class="ac-btn full" id="trLevel" title="Sets the floor flat on the grid">① Level it</button>
          <button type="button" class="ac-btn full" id="trFloor">② Find floor &amp; ceiling</button>
        </div>
        <div class="ctrl-row" style="margin-top:8px"><span class="ctrl-label">Floor height</span><span class="ctrl-val" id="trFloorVal">–</span></div>
        <div class="ctrl-row"><span class="ctrl-label">Eye height</span><span class="ctrl-val" id="trEyeVal">–</span></div>
        <input type="range" id="trEye" min="0.25" max="0.9" step="0.01" value="0.6" style="width:100%" title="Share of the room height (0.6 ≈ 1.6 m in a 2.6 m room)">
        <div class="ctrl-row" style="margin-top:6px"><span class="ctrl-label">Visitors start in</span></div>
        <select id="trStart" style="width:100%"><option value="dollhouse">Dollhouse (whole building)</option><option value="walk">Walk (first stop)</option><option value="plan">Floor plan</option></select>
      </div>
    </div>
    <div class="section">
      <div class="sec-head"><span class="sec-label">Tour stops</span></div>
      <div class="sec-body" style="padding:10px">
        <div class="hint">Stops are the dots visitors click to walk to — the front door, the lounge, the kitchen, each bedroom. Each stop remembers which way to look.</div>
        <button type="button" class="ac-btn full" id="trPick" style="margin-top:6px">🎯 Click the floor to add stops</button>
        <div id="trStops" style="margin-top:8px"></div>
      </div>
    </div>
    <div class="section">
      <div class="sec-head"><span class="sec-label">Try it</span></div>
      <div class="sec-body" style="padding:10px">
        <button type="button" class="ac-btn lime full" id="trTry">▶ Try the tour here</button>
      </div>
    </div>
    <div class="hint" id="trStatus" role="status" style="margin:8px 10px"></div>`;

  const q = (s) => container.querySelector(s);
  const status = (m) => { q('#trStatus').textContent = m; onStatus?.(m); };
  let floorY = null, ceilingY = null, stops = [], picking = false, preview = null;
  const changed = () => window.dispatchEvent(new CustomEvent('fumoca:tourChange'));
  const room = () => (ceilingY ?? 0) - (floorY ?? 0);
  const fmt = (v) => (Math.abs(v) < 10 ? v.toFixed(3) : v.toFixed(1));

  function getTour() {
    if (floorY === null) return q('#trOn').checked ? normalizeTour({ enabled: true, stops, start: q('#trStart').value }) : null;
    return normalizeTour({ enabled: q('#trOn').checked, floorY, ceilingY, eyeHeight: room() * +q('#trEye').value, stops, start: q('#trStart').value });
  }

  function syncLabels() {
    q('#trFloorVal').textContent = floorY === null ? 'press ②' : `${fmt(floorY)} (room ${fmt(room())} high)`;
    q('#trEyeVal').textContent = floorY === null ? '–' : `${fmt(room() * +q('#trEye').value)} (${Math.round(+q('#trEye').value * 100)}% of the room)`;
  }

  function renderStops() {
    q('#trStops').innerHTML = stops.map((s, i) => `
      <div style="display:flex;gap:5px;align-items:center;margin-bottom:5px">
        <span style="color:#c8ff00;font-weight:800;width:16px">${i + 1}</span>
        <input data-name="${i}" value="${esc(s.name)}" maxlength="60" style="flex:1">
        <button type="button" class="ac-btn" data-look="${i}" title="Look the way the camera faces now" style="padding:4px 6px">👁</button>
        <button type="button" class="ac-btn" data-up="${i}" style="padding:4px 6px">↑</button>
        <button type="button" class="ac-btn" data-del="${i}" style="padding:4px 6px">✕</button>
      </div>`).join('') || '<div class="hint">No stops yet.</div>';
    q('#trStops').querySelectorAll('[data-name]').forEach(el => el.addEventListener('change', () => { stops[+el.dataset.name].name = el.value.slice(0, 60); changed(); }));
    q('#trStops').querySelectorAll('[data-look]').forEach(el => el.addEventListener('click', () => { Object.assign(stops[+el.dataset.look], lookNow()); changed(); status('That stop now looks the way the camera faces.'); }));
    q('#trStops').querySelectorAll('[data-up]').forEach(el => el.addEventListener('click', () => { const i = +el.dataset.up; if (i > 0) { [stops[i - 1], stops[i]] = [stops[i], stops[i - 1]]; renderStops(); changed(); } }));
    q('#trStops').querySelectorAll('[data-del]').forEach(el => el.addEventListener('click', () => { stops.splice(+el.dataset.del, 1); renderStops(); changed(); }));
  }

  const lookNow = () => {
    const d = new THREE.Vector3(); window.camera?.getWorldDirection(d);
    return { yaw: Math.atan2(d.x, d.z), pitch: Math.max(-0.6, Math.min(0.6, Math.asin(Math.max(-1, Math.min(1, d.y))))) };
  };

  function findFloor() {
    const S = window.S;
    if (!S?.positions) { status('Open a scan first.'); return false; }
    try {
      const f = detectFloor(S.positions, S.alive, S.opacity);
      floorY = f.floorY; ceilingY = f.ceilingY;
      syncLabels(); changed();
      status(`Floor found at ${fmt(floorY)}, ceiling at ${fmt(ceilingY)}. Eye height is ${Math.round(+q('#trEye').value * 100)}% of the room — adjust if it looks too high or low.`);
      return true;
    } catch (e) { status(e.message); return false; }
  }

  // picking stops on the floor
  let down = null;
  const canvas = () => window.renderer?.domElement;
  function onDown(e) { if (picking) down = { x: e.clientX, y: e.clientY }; }
  function onUp(e) {
    if (!picking || !down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y); down = null;
    if (moved > 5) return;
    const S = window.S, el = canvas(); if (!S?.positions || !el) return;
    if (floorY === null && !findFloor()) return;
    const r = el.getBoundingClientRect();
    const hit = pickSplat(S.positions, S.alive.length, (i) => S.alive[i] && (S.opacity?.[i] ?? 1) >= 0.3, window.camera, e.clientX - r.left, e.clientY - r.top, r.width, r.height, 10);
    if (!hit) { status('Click on the floor of the scan.'); return; }
    e.stopPropagation();
    stops.push({ id: 'stop' + Date.now().toString(36), name: `Stop ${stops.length + 1}`, position: [hit.point[0], floorY, hit.point[2]], ...lookNow() });
    renderStops(); changed();
    status(`Stop ${stops.length} added. Name it (e.g. “Kitchen”), and press 👁 to set which way it looks.`);
  }
  q('#trPick').addEventListener('click', () => {
    picking = !picking;
    const el = canvas();
    if (el && !el._trBound) { el.addEventListener('pointerdown', onDown, true); el.addEventListener('pointerup', onUp, true); el._trBound = true; }
    if (picking) { window.FumocaStudioHooks?.setMode?.('orbit'); status('Click spots on the floor to add stops. Press the button again when done.'); }
    q('#trPick').textContent = picking ? '■ Done adding stops' : '🎯 Click the floor to add stops';
    q('#trPick').classList.toggle('lime', picking);
  });

  q('#trLevel').addEventListener('click', async () => {
    const res = await window.FumocaSitFlat?.();
    if (res) { findFloor(); status(`Levelled (turned ${res.angleDeg.toFixed(1)}°). Floor and ceiling found.`); }
  });
  q('#trFloor').addEventListener('click', findFloor);
  q('#trEye').addEventListener('input', () => { syncLabels(); changed(); });
  q('#trStart').addEventListener('change', changed);
  q('#trOn').addEventListener('change', () => { if (q('#trOn').checked && floorY === null) findFloor(); changed(); });

  function stopPreview() {
    preview?.dispose(); preview = null;
    q('#trTry').textContent = '▶ Try the tour here';
    status('Back to editing.');
  }
  q('#trTry').addEventListener('click', () => {
    if (preview) return stopPreview();
    const S = window.S;
    if (!S?.positions) return status('Open a scan first.');
    if (floorY === null && !findFloor()) return;
    try {
      preview = new TourController(getTour() || {}, {
        THREE, camera: window.camera, controls: window.controls, dom: canvas(), parent: window.scene,
        mesh: window.FumocaSparkGaussian?.isEnabled?.() ? window.FumocaSparkGaussian.getMesh?.() : null,
        positions: S.positions, count: S.alive.length, accept: (i) => S.alive[i] && (S.opacity?.[i] ?? 1) >= 0.3,
        host: canvas()?.parentElement, barBottom: 62,
      });
      preview.setMode(q('#trStart').value);
      q('#trTry').textContent = '■ Stop trying the tour';
      status('This is what visitors get: Dollhouse, Floor plan, Walk (drag to look, click the floor to walk, scroll or W/S to step).');
    } catch (e) { status(e.message); preview = null; }
  });

  window.addEventListener('fumoca:fileLoaded', () => {
    if (preview) stopPreview();
    const t = normalizeTour(window._fumocaCurrentRecord?.meta?.present?.tour);
    q('#trOn').checked = !!t?.enabled;
    floorY = t ? t.floorY : null; ceilingY = t ? t.ceilingY : null;
    stops = t?.stops || [];
    if (t) { q('#trEye').value = Math.min(0.9, Math.max(0.25, t.eyeHeight / Math.max(1e-6, t.ceilingY - t.floorY))); q('#trStart').value = t.start; }
    renderStops(); syncLabels();
  });

  renderStops(); syncLabels();
  const api = { getTour, findFloor, get stops() { return stops; }, get preview() { return preview; } };
  window.FumocaTour = api;
  return api;
}
