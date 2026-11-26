/**
 * Studio "Look" tab:
 *   • Lighting & shadow — relight the splats with a movable light and a soft
 *     shadow that follows them (and a rig's motion)
 *   • How it's viewed — start view, zoom limits, locks, steady mode and spin
 *     speed for the published page and embeds
 * Both are saved with the NIF and applied in the public viewer.
 */
import * as THREE from 'three';
import { SplatLighting, normalizeLighting, DEFAULT_LIGHTING, MOODS, moodSettings } from './splat-lighting.js';
import { ViewController, normalizeViewSettings, captureView, DEFAULT_VIEW } from './view-settings.js';

const row = (id, label, min, max, step, value, fmt = (v) => v) =>
  `<div class="ctrl-row"><span class="ctrl-label">${label}</span><span class="ctrl-val" id="${id}Val">${fmt(value)}</span></div>
   <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${value}" style="width:100%">`;
const check = (id, label, on = false) => `<label style="display:flex;gap:6px;align-items:center;font-size:11px;margin-top:6px"><input type="checkbox" id="${id}"${on ? ' checked' : ''}> ${label}</label>`;

export function mountLookPanel(container, { onStatus } = {}) {
  if (!container) return null;
  const L = DEFAULT_LIGHTING, V = DEFAULT_VIEW;
  container.innerHTML = `
    <div class="section">
      <div class="sec-head"><span class="sec-label">Lighting &amp; shadow</span><span class="sec-badge">CPU</span></div>
      <div class="sec-body" style="padding:10px">
        <div class="hint">Set the mood of a scan: pick a look, then tweak anything. The shadow follows the splat, the platform and any rig animation. Turn it off to get the scan's own colours back exactly.</div>
        <div id="lkMoods" style="display:flex;flex-wrap:wrap;gap:5px;margin:8px 0">${Object.entries(MOODS).map(([k, m]) => `<button type="button" class="ac-btn" data-mood="${k}" style="padding:5px 8px;font-size:11px">${m.label}</button>`).join('')}</div>
        ${check('lkOn', 'Use lighting')}
        <div class="hint" style="margin-top:8px;opacity:.8">Key light</div>
        ${row('lkAz', 'Direction', -180, 180, 1, L.azimuth, v => Math.round(v) + '°')}
        ${row('lkEl', 'Height', 2, 90, 1, L.elevation, v => Math.round(v) + '°')}
        ${row('lkInt', 'Light strength', 0, 2, 0.05, L.intensity, v => Math.round(v * 100) + '%')}
        <div class="ctrl-row"><span class="ctrl-label">Light colour</span><input type="color" id="lkCol" value="${L.color}" style="width:48px;height:22px;border:0;background:none"></div>
        ${row('lkAmb', 'Fill (ambient)', 0, 1.5, 0.05, L.ambient, v => Math.round(v * 100) + '%')}
        <div class="ctrl-row"><span class="ctrl-label">Fill colour</span><input type="color" id="lkAmbCol" value="${L.ambientColor}" style="width:48px;height:22px;border:0;background:none"></div>
        ${check('lk2', 'Second light (rim, back or coloured accent)')}
        ${row('lkAz2', 'Direction', -180, 180, 1, L.azimuth2, v => Math.round(v) + '°')}
        ${row('lkEl2', 'Height', -30, 90, 1, L.elevation2, v => Math.round(v) + '°')}
        ${row('lkInt2', 'Strength', 0, 2, 0.05, L.intensity2, v => Math.round(v * 100) + '%')}
        <div class="ctrl-row"><span class="ctrl-label">Colour</span><input type="color" id="lkCol2" value="${L.color2}" style="width:48px;height:22px;border:0;background:none"></div>
        <div class="hint" style="margin-top:8px;opacity:.8">Colour grade</div>
        ${row('lkExp', 'Exposure', -2, 2, 0.05, 0, v => (v > 0 ? '+' : '') + (+v).toFixed(2))}
        ${row('lkCon', 'Contrast', -1, 1, 0.05, 0, v => Math.round(v * 100))}
        ${row('lkSat', 'Saturation', -1, 1, 0.05, 0, v => Math.round(v * 100))}
        ${row('lkWarm', 'Warmth', -1, 1, 0.05, 0, v => Math.round(v * 100))}
        ${row('lkTint', 'Tint', -1, 1, 0.05, 0, v => Math.round(v * 100))}
        <div class="hint" style="margin-top:8px;opacity:.8">Atmosphere</div>
        <div class="ctrl-row"><span class="ctrl-label">Background</span><span><input type="checkbox" id="lkBgOn"> <input type="color" id="lkBg" value="#0b0d10" style="width:48px;height:22px;border:0;background:none"></span></div>
        ${row('lkVig', 'Vignette', 0, 1, 0.05, 0, v => Math.round(v * 100) + '%')}
        <div class="hint" style="margin-top:8px;opacity:.8">Lamps — room lights, headlights, a glowing screen</div>
        <div class="hint" style="font-size:10px;opacity:.6">Select the light fitting (or aim the view at it) and add a lamp. Hotspots can switch lamps on and off in the viewer.</div>
        <div style="display:flex;gap:6px;margin-top:4px">
          <button type="button" class="ac-btn" id="lkLampSel" style="flex:1">＋ Lamp at selection</button>
          <button type="button" class="ac-btn" id="lkLampView" style="flex:1">＋ Lamp at view centre</button>
        </div>
        <div id="lkLamps" style="margin-top:6px"></div>
        <div class="hint" style="margin-top:8px;opacity:.8">Shadow</div>
        ${check('lkSh', 'Shadow', true)}
        ${row('lkShOp', 'Shadow darkness', 0, 1, 0.05, L.shadowOpacity, v => Math.round(v * 100) + '%')}
        ${row('lkShSoft', 'Shadow softness', 0, 1, 0.05, L.shadowSoftness, v => Math.round(v * 100) + '%')}
      </div>
    </div>
    <div class="section">
      <div class="sec-head"><span class="sec-label">How it's viewed · website &amp; embed</span></div>
      <div class="sec-body" style="padding:10px">
        <div class="hint">Set exactly how people first see it, how far they can zoom, and whether it spins. Great for a steady view on a website.</div>
        <div style="display:flex;gap:6px;margin-top:6px">
          <button type="button" class="ac-btn lime" id="vwCapture" style="flex:1">Use this view as the start</button>
          <button type="button" class="ac-btn" id="vwClear" style="flex:1">Auto-frame</button>
        </div>
        <div class="hint" id="vwStart" style="margin-top:4px">Start view: auto-framed</div>
        ${row('vwMin', 'Closest zoom', 0.05, 1, 0.05, V.zoomMin, v => Math.round(v * 100) + '% of start')}
        ${row('vwMax', 'Farthest zoom', 1, 10, 0.25, V.zoomMax, v => (+v).toFixed(2) + '× start')}
        ${check('vwLockZoom', 'Lock zoom')}
        ${check('vwLockRot', 'Lock rotation')}
        ${check('vwPan', 'Allow panning')}
        ${check('vwFixed', 'Steady view — nothing moves except the spin')}
        ${row('vwSpin', 'Spin speed', -60, 60, 1, V.spin, v => (+v === 0 ? 'off' : Math.round(v) + '°/s'))}
        <div style="display:flex;gap:6px;margin-top:8px">
          <button type="button" class="ac-btn" id="vwPreview" style="flex:1">▶ Preview here</button>
        </div>
        <div class="hint" style="margin-top:8px">Embed overrides: add <code>?spin=12&amp;lock=1&amp;zoomMin=0.6&amp;zoomMax=2.5&amp;fixed=1</code> to the viewer link.</div>
      </div>
    </div>
    <div class="hint" id="lkStatus" role="status" style="margin:8px 10px"></div>`;

  const q = (s) => container.querySelector(s);
  const status = (m) => { q('#lkStatus').textContent = m; onStatus?.(m); };
  let lighting = null, lightingMesh = null, startView = null, preview = null;

  const sparkMesh = () => (window.FumocaSparkGaussian?.isEnabled?.() ? window.FumocaSparkGaussian.getMesh?.() : null);
  let preset = 'custom';
  let lamps = [];
  const sceneSize = () => {
    const S = window.S; if (!S?.positions?.length) return 1;
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < S.positions.length; i += 3 * Math.max(1, Math.floor(S.positions.length / 3 / 20000)))
      for (let k = 0; k < 3; k++) { const v = S.positions[i + k]; if (v < lo[k]) lo[k] = v; if (v > hi[k]) hi[k] = v; }
    return Math.max(1e-3, ...hi.map((v, k) => v - lo[k]));
  };
  function addLamp(position) {
    const size = sceneSize();
    lamps.push({ id: 'lamp' + Date.now().toString(36), name: 'Light ' + (lamps.length + 1), position, color: '#ffd9a0', intensity: 1.4, radius: size * 0.18, on: true });
    if (!q('#lkOn').checked) q('#lkOn').checked = true;
    renderLamps(); applyLighting(); window.dispatchEvent(new CustomEvent('fumoca:lookChange'));
  }
  function renderLamps() {
    const size = sceneSize();
    q('#lkLamps').innerHTML = lamps.map((l, i) => `
      <div style="border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:6px;margin-bottom:6px">
        <div style="display:flex;gap:6px;align-items:center">
          <input type="checkbox" data-lamp-on="${i}" ${l.on ? 'checked' : ''} title="On / off">
          <input data-lamp-name="${i}" value="${l.name.replace(/"/g, '&quot;')}" maxlength="40" style="flex:1;min-width:0;background:transparent;border:1px solid rgba(255,255,255,.1);color:inherit;border-radius:6px;padding:2px 6px;font-size:11px">
          <input type="color" data-lamp-col="${i}" value="${l.color}" style="width:28px;height:20px;border:0;background:none">
          <button type="button" class="ac-btn" data-lamp-del="${i}" style="padding:2px 6px">✕</button>
        </div>
        <div class="ctrl-row"><span class="ctrl-label">Strength</span></div><input type="range" data-lamp-int="${i}" min="0" max="5" step="0.05" value="${l.intensity}" style="width:100%">
        <div class="ctrl-row"><span class="ctrl-label">Reach</span></div><input type="range" data-lamp-rad="${i}" min="${(size * 0.01).toFixed(4)}" max="${(size * 1.2).toFixed(4)}" step="${(size / 500).toFixed(5)}" value="${l.radius}" style="width:100%">
      </div>`).join('');
    const bind = (sel, fn, ev = 'input') => q('#lkLamps').querySelectorAll(sel).forEach(el => el.addEventListener(ev, () => { fn(el); applyLighting(); }));
    bind('[data-lamp-on]', el => { lamps[+el.dataset.lampOn].on = el.checked; }, 'change');
    bind('[data-lamp-name]', el => { lamps[+el.dataset.lampName].name = el.value.slice(0, 40); });
    bind('[data-lamp-col]', el => { lamps[+el.dataset.lampCol].color = el.value; });
    bind('[data-lamp-int]', el => { lamps[+el.dataset.lampInt].intensity = +el.value; });
    bind('[data-lamp-rad]', el => { lamps[+el.dataset.lampRad].radius = +el.value; });
    q('#lkLamps').querySelectorAll('[data-lamp-del]').forEach(b => b.addEventListener('click', () => { lamps.splice(+b.dataset.lampDel, 1); renderLamps(); applyLighting(); window.dispatchEvent(new CustomEvent('fumoca:lookChange')); }));
    q('#lkLamps').querySelectorAll('input').forEach(el => el.addEventListener('change', () => window.dispatchEvent(new CustomEvent('fumoca:lookChange'))));
  }
  const lightState = () => normalizeLighting({
    enabled: q('#lkOn').checked, preset,
    azimuth: +q('#lkAz').value, elevation: +q('#lkEl').value, intensity: +q('#lkInt').value, color: q('#lkCol').value,
    ambient: +q('#lkAmb').value, ambientColor: q('#lkAmbCol').value,
    light2: q('#lk2').checked, azimuth2: +q('#lkAz2').value, elevation2: +q('#lkEl2').value, intensity2: +q('#lkInt2').value, color2: q('#lkCol2').value,
    exposure: +q('#lkExp').value, contrast: +q('#lkCon').value, saturation: +q('#lkSat').value, warmth: +q('#lkWarm').value, tint: +q('#lkTint').value,
    background: q('#lkBgOn').checked ? q('#lkBg').value : '', vignette: +q('#lkVig').value,
    shadow: q('#lkSh').checked, shadowOpacity: +q('#lkShOp').value, shadowSoftness: +q('#lkShSoft').value,
    lamps,
  });
  function setLightControls(ls) {
    const set = (id, v) => { const el = q('#' + id); if (el.type === 'checkbox') el.checked = !!v; else el.value = v; };
    set('lkOn', ls.enabled); set('lkAz', ls.azimuth); set('lkEl', ls.elevation); set('lkInt', ls.intensity); set('lkCol', ls.color);
    set('lkAmb', ls.ambient); set('lkAmbCol', ls.ambientColor);
    set('lk2', ls.light2); set('lkAz2', ls.azimuth2); set('lkEl2', ls.elevation2); set('lkInt2', ls.intensity2); set('lkCol2', ls.color2);
    set('lkExp', ls.exposure); set('lkCon', ls.contrast); set('lkSat', ls.saturation); set('lkWarm', ls.warmth); set('lkTint', ls.tint);
    set('lkBgOn', !!ls.background); if (ls.background) set('lkBg', ls.background); set('lkVig', ls.vignette);
    set('lkSh', ls.shadow); set('lkShOp', ls.shadowOpacity); set('lkShSoft', ls.shadowSoftness);
    preset = ls.preset || 'custom';
    if (Array.isArray(ls.lamps)) { lamps = ls.lamps.map(l => ({ ...l })); renderLamps(); }
    container.querySelectorAll('[data-mood]').forEach(b => b.classList.toggle('lime', b.dataset.mood === preset));
  }
  const viewState = () => normalizeViewSettings({
    startView, zoomMin: +q('#vwMin').value, zoomMax: +q('#vwMax').value,
    lockZoom: q('#vwLockZoom').checked, lockRotate: q('#vwLockRot').checked, allowPan: q('#vwPan').checked,
    fixed: q('#vwFixed').checked, spin: +q('#vwSpin').value,
  });

  // ── lighting ──
  function ensureLighting() {
    const mesh = sparkMesh();
    if (!mesh) return null;
    if (lighting && lightingMesh === mesh) return lighting;
    lighting?.dispose?.();
    try { lighting = new SplatLighting(THREE, mesh, null, { scene: window.scene || null, host: window.renderer?.domElement?.parentElement || null }); lightingMesh = mesh; }
    catch (e) { lighting = null; status(e.message); }
    return lighting;
  }
  let lightTimer = 0;
  function applyLighting() {
    clearTimeout(lightTimer);
    lightTimer = setTimeout(() => {
      const s = lightState();
      if (!s.enabled && !lighting) return;
      let l = ensureLighting();
      if (!l) {
        status('Turning Photoreal (Spark) on to light the splat…');
        window.FumocaStudioHooks?.ensureSpark?.().then((mesh) => {
          if (!mesh) { status('Photoreal (Spark) could not start on this device — lighting needs it.'); return; }
          setTimeout(applyLighting, 600);
        });
        return;
      }
      const t0 = performance.now();
      try { l.apply(s); status(s.enabled ? `Lit in ${Math.round(performance.now() - t0)} ms.` : 'Lighting off — original colours.'); }
      catch (e) { status(e.message); }
    }, 60);
  }
  q('#lkLampSel').addEventListener('click', () => {
    const S = window.S; let c = [0, 0, 0], n = 0;
    if (S?.selected) for (let i = 0; i < S.selected.length; i++) if (S.selected[i] && (!S.alive || S.alive[i])) { c[0] += S.positions[i * 3]; c[1] += S.positions[i * 3 + 1]; c[2] += S.positions[i * 3 + 2]; n++; }
    if (!n) { status('Select the light fitting first (or use "Lamp at view centre").'); return; }
    addLamp(c.map(v => v / n)); status('Lamp added at the selection. Adjust its reach to fill the room.');
  });
  q('#lkLampView').addEventListener('click', () => {
    const t = window.controls?.target; if (!t) return;
    addLamp([t.x, t.y, t.z]); status('Lamp added where the view is pointing.');
  });
  const LIGHT_IDS = ['lkOn', 'lkAz', 'lkEl', 'lkInt', 'lkCol', 'lkAmb', 'lkAmbCol', 'lk2', 'lkAz2', 'lkEl2', 'lkInt2', 'lkCol2',
    'lkExp', 'lkCon', 'lkSat', 'lkWarm', 'lkTint', 'lkBgOn', 'lkBg', 'lkVig', 'lkSh', 'lkShOp', 'lkShSoft'];
  container.querySelectorAll('[data-mood]').forEach(btn => btn.addEventListener('click', () => {
    const ls = { ...moodSettings(btn.dataset.mood, lightState()), lamps };
    setLightControls(ls); syncLabels(); applyLighting();
    window.dispatchEvent(new CustomEvent('fumoca:lookChange'));
    status(MOODS[btn.dataset.mood].label + (ls.enabled ? ' — tweak any slider to make it yours.' : ' — the scan\'s own light.'));
  }));
  LIGHT_IDS.forEach(id => {
    q('#' + id).addEventListener('input', () => {
      if (id !== 'lkOn' && preset !== 'custom') { preset = 'custom'; container.querySelectorAll('[data-mood]').forEach(b => b.classList.remove('lime')); }
      syncLabels(); applyLighting();
    });
    q('#' + id).addEventListener('change', () => window.dispatchEvent(new CustomEvent('fumoca:lookChange')));
  });

  // Edits written in place use the scan's colours; light them again.
  window.addEventListener('fumoca:sparkInPlaceUpdate', () => { if (lightState().enabled) applyLighting(); });
  // Keep the shadow under a playing rig.
  setInterval(() => {
    const d = window.FumocaRig?.driver;
    if (lighting && lightState().enabled && lightState().shadow && d?.playing) { try { lighting.updateShadow(); } catch (_) {} }
    const mesh = sparkMesh();
    if (lighting && mesh && mesh !== lightingMesh && lightState().enabled) { lighting = null; applyLighting(); }
  }, 160);

  // ── view ──
  function syncLabels() {
    const fmt = {
      lkAz: v => Math.round(v) + '°', lkEl: v => Math.round(v) + '°', lkInt: v => Math.round(v * 100) + '%', lkAmb: v => Math.round(v * 100) + '%',
      lkAz2: v => Math.round(v) + '°', lkEl2: v => Math.round(v) + '°', lkInt2: v => Math.round(v * 100) + '%',
      lkExp: v => (v > 0 ? '+' : '') + (+v).toFixed(2), lkCon: v => Math.round(v * 100), lkSat: v => Math.round(v * 100),
      lkWarm: v => Math.round(v * 100), lkTint: v => Math.round(v * 100), lkVig: v => Math.round(v * 100) + '%',
      lkShOp: v => Math.round(v * 100) + '%', lkShSoft: v => Math.round(v * 100) + '%',
      vwMin: v => Math.round(v * 100) + '% of start', vwMax: v => (+v).toFixed(2) + '× start', vwSpin: v => (+v === 0 ? 'off' : Math.round(v) + '°/s'),
    };
    for (const [id, f] of Object.entries(fmt)) { const el = q('#' + id + 'Val'); if (el) el.textContent = f(+q('#' + id).value); }
    q('#vwStart').textContent = startView ? 'Start view: saved from Studio' : 'Start view: auto-framed';
  }
  ['vwMin', 'vwMax', 'vwLockZoom', 'vwLockRot', 'vwPan', 'vwFixed', 'vwSpin'].forEach(id => {
    q('#' + id).addEventListener('input', () => { syncLabels(); if (preview) preview.update(viewState()); });
    q('#' + id).addEventListener('change', () => window.dispatchEvent(new CustomEvent('fumoca:lookChange')));
  });
  q('#vwCapture').addEventListener('click', () => {
    if (!window.camera) return;
    startView = captureView(window.camera, window.controls);
    syncLabels(); window.dispatchEvent(new CustomEvent('fumoca:lookChange'));
    status('Start view saved — the published page opens exactly here.');
  });
  q('#vwClear').addEventListener('click', () => { startView = null; syncLabels(); window.dispatchEvent(new CustomEvent('fumoca:lookChange')); status('Start view: auto-framed.'); });

  let saved = null;
  q('#vwPreview').addEventListener('click', () => {
    if (preview) {
      preview.dispose(); preview = null;
      if (saved && window.controls) {
        const c = window.controls;
        Object.assign(c, saved.flags);
        c.minDistance = saved.min; c.maxDistance = saved.max;
      }
      q('#vwPreview').textContent = '▶ Preview here';
      status('Preview stopped — Studio controls are back.');
      return;
    }
    const c = window.controls;
    if (!window.camera || !c) return;
    saved = { min: c.minDistance, max: c.maxDistance, flags: { enableZoom: c.enableZoom, enableRotate: c.enableRotate, enablePan: c.enablePan } };
    preview = new ViewController(THREE, window.camera, c, viewState(), { domElement: window.renderer?.domElement || c.domElement });
    preview.apply();
    globalThis._fumocaViewSettings = null;            // Studio itself never locks framing
    q('#vwPreview').textContent = '■ Stop preview';
    status('Previewing how visitors will see it.');
  });

  // ── persistence ──
  window.addEventListener('fumoca:fileLoaded', () => {
    lighting?.dispose?.(); lighting = null; lightingMesh = null;
    const present = window._fumocaCurrentRecord?.meta?.present || {};
    const ls = normalizeLighting(present.lighting), vs = normalizeViewSettings(present.view);
    if (ls) {
      setLightControls(ls);
      if (ls.enabled) setTimeout(applyLighting, 2500);
    } else q('#lkOn').checked = false;
    if (vs) {
      startView = vs.startView; q('#vwMin').value = vs.zoomMin; q('#vwMax').value = vs.zoomMax; q('#vwLockZoom').checked = vs.lockZoom;
      q('#vwLockRot').checked = vs.lockRotate; q('#vwPan').checked = vs.allowPan; q('#vwFixed').checked = vs.fixed; q('#vwSpin').value = vs.spin;
    } else startView = null;
    syncLabels();
  });

  syncLabels();
  const api = {
    getLighting: () => { const s = lightState(); return s.enabled ? s : null; },
    lamps: () => lamps.map(l => ({ id: l.id, name: l.name, on: l.on })),
    setLamp: async (id, to) => { const l = ensureLighting(); if (!l) return false; l.settings = lightState(); const ok = await l.setLamp(id, to); const lamp = lamps.find(x => x.id === id); if (lamp) lamp.on = l.settings.lamps.find(x => x.id === id)?.on ?? lamp.on; renderLamps(); return ok; },
    setMood: (name) => container.querySelector(`[data-mood="${name}"]`)?.click(),
    getView: () => viewState(),
    get lighting() { return lighting; },
  };
  window.FumocaLook = api;
  return api;
}
