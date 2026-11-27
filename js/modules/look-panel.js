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
import { LIGHT_MOTIONS, motionFromPreset, normalizeLightMotion, LightAnimator, directionToAngles, raySphere } from './light-motion.js';

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
        <div style="display:flex;gap:6px;margin-top:8px;align-items:center">
          <button type="button" class="ac-btn" id="lkGrab" style="flex:1" title="Shows the light as a sun in the scene: drag it to move the light">☀ Show the light in the scene</button>
          <select id="lkGrabWhich" style="width:92px" title="Which light to move"><option value="key">Key light</option><option value="second">Second light</option></select>
        </div>
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
        ${check('lkSelf', 'Shadows on the object (brim on the crown, walls on the floor)', true)}
        ${row('lkSelfOp', 'Object shadow darkness', 0, 1, 0.05, 0.85, v => Math.round(v * 100) + '%')}
        ${row('lkAo', 'Depth in folds and creases', 0, 1, 0.05, 0.5, v => Math.round(v * 100) + '%')}
        ${row('lkContact', 'Contact shadow (where it touches the ground)', 0, 1, 0.05, 0.6, v => Math.round(v * 100) + '%')}
        ${row('lkDelight', 'Soften shadows baked into the scan', 0, 1, 0.05, 0, v => Math.round(v * 100) + '%')}
        ${check('lkSh', 'Shadow on the ground', true)}
        ${row('lkShOp', 'Shadow darkness', 0, 1, 0.05, L.shadowOpacity, v => Math.round(v * 100) + '%')}
        ${row('lkShSoft', 'Shadow softness', 0, 1, 0.05, L.shadowSoftness, v => Math.round(v * 100) + '%')}
      </div>
    </div>
    <div class="section">
      <div class="sec-head"><span class="sec-label">Light animation</span><span class="sec-badge">NEW</span></div>
      <div class="sec-body" style="padding:10px">
        <div class="hint">Make the light move: pick one, or set the light, press “Add key”, change it, add another. Plays here and on the published page.</div>
        <div id="lmPresets" style="display:flex;flex-wrap:wrap;gap:5px;margin:8px 0">${Object.entries(LIGHT_MOTIONS).map(([k, m]) => `<button type="button" class="ac-btn" data-lmotion="${k}" style="padding:5px 8px;font-size:11px">${m.label}</button>`).join('')}</div>
        <div id="lmKeys" style="font-size:11px"></div>
        <button type="button" class="ac-btn full" id="lmAddKey" style="margin-top:6px">＋ Add key (the light as it is now)</button>
        ${row('lmDur', 'Length', 1, 60, 0.5, 8, v => (+v).toFixed(1) + ' s')}
        <div class="ctrl-row" style="margin-top:6px"><span class="ctrl-label">Repeat</span>
          <select id="lmLoop" style="width:130px"><option value="loop">Loop</option><option value="pingpong">Back and forth</option><option value="once">Play once</option></select></div>
        ${check('lmAuto', 'Play on the published page', true)}
        <div style="display:flex;gap:6px;margin-top:8px">
          <button type="button" class="ac-btn lime" id="lmPlay" style="flex:2">▶ Play</button>
          <button type="button" class="ac-btn" id="lmClear" style="flex:1">Clear</button>
        </div>
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
  let motionKeys = [], motionPreset = 'custom', animator = null;
  // Size of the subject (2–98 %: floaters far out must not count)
  const sceneSize = () => {
    const S = window.S; if (!S?.positions?.length) return 1;
    const ax = [[], [], []], st = Math.max(1, Math.floor(S.positions.length / 3 / 20000));
    for (let i = 0; i < S.positions.length / 3; i += st) if (!S.alive || S.alive[i]) for (let k = 0; k < 3; k++) ax[k].push(S.positions[i * 3 + k]);
    if (!ax[0].length) return 1;
    return Math.max(1e-3, ...ax.map(a => { a.sort((x, y) => x - y); return a[Math.floor(a.length * 0.98)] - a[Math.floor(a.length * 0.02)]; }));
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
    selfShadow: q('#lkSelf').checked, selfShadowStrength: +q('#lkSelfOp').value,
    ao: +q('#lkAo').value, contactShadow: +q('#lkContact').value, delight: +q('#lkDelight').value,
    lamps,
    ...(motionKeys.length >= 2 ? { motion: motionState() } : {}),
  });
  function setLightControls(ls) {
    const set = (id, v) => { const el = q('#' + id); if (el.type === 'checkbox') el.checked = !!v; else el.value = v; };
    set('lkOn', ls.enabled); set('lkAz', ls.azimuth); set('lkEl', ls.elevation); set('lkInt', ls.intensity); set('lkCol', ls.color);
    set('lkAmb', ls.ambient); set('lkAmbCol', ls.ambientColor);
    set('lk2', ls.light2); set('lkAz2', ls.azimuth2); set('lkEl2', ls.elevation2); set('lkInt2', ls.intensity2); set('lkCol2', ls.color2);
    set('lkExp', ls.exposure); set('lkCon', ls.contrast); set('lkSat', ls.saturation); set('lkWarm', ls.warmth); set('lkTint', ls.tint);
    set('lkBgOn', !!ls.background); if (ls.background) set('lkBg', ls.background); set('lkVig', ls.vignette);
    set('lkSh', ls.shadow); set('lkShOp', ls.shadowOpacity); set('lkShSoft', ls.shadowSoftness);
    set('lkSelf', ls.selfShadow !== false); set('lkSelfOp', ls.selfShadowStrength ?? 0.85);
    set('lkAo', ls.ao ?? 0.5); set('lkContact', ls.contactShadow ?? 0.6); set('lkDelight', ls.delight ?? 0);
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
    'lkExp', 'lkCon', 'lkSat', 'lkWarm', 'lkTint', 'lkBgOn', 'lkBg', 'lkVig', 'lkSh', 'lkShOp', 'lkShSoft', 'lkSelf', 'lkSelfOp', 'lkAo', 'lkContact', 'lkDelight'];
  container.querySelectorAll('[data-mood]').forEach(btn => btn.addEventListener('click', () => {
    const ls = { ...moodSettings(btn.dataset.mood, lightState()), lamps };
    setLightControls(ls); syncLabels(); applyLighting();
    window.dispatchEvent(new CustomEvent('fumoca:lookChange'));
    status(MOODS[btn.dataset.mood].label + (ls.enabled ? ' — tweak any slider to make it yours.' : ' — the scan\'s own light.'));
  }));
  q('#lkOn').addEventListener('change', () => { if (!q('#lkOn').checked && grab) setGrab(false); });
  LIGHT_IDS.forEach(id => {
    q('#' + id).addEventListener('input', () => {
      if (id !== 'lkOn' && preset !== 'custom') { preset = 'custom'; container.querySelectorAll('[data-mood]').forEach(b => b.classList.remove('lime')); }
      syncLabels(); applyLighting();
    });
    q('#' + id).addEventListener('change', () => window.dispatchEvent(new CustomEvent('fumoca:lookChange')));
  });

  // Edits written in place use the scan's colours; light them again.
  // (they also move splats — take the new geometry first so the light and
  // the shadow follow, and nothing is written back to where it was)
  window.addEventListener('fumoca:sparkInPlaceUpdate', () => {
    if (lighting) lighting.refreshGeometry?.();
    if (sun?.visible) { centre = subjectCentre(); radius = subjectRadius() * 1.6; }
    if (lightState().enabled) applyLighting();
  });
  // Keep the shadow under a playing rig.
  setInterval(() => {
    const d = window.FumocaRig?.driver;
    if (lighting && lightState().enabled && lightState().shadow && d?.playing) { try { lighting.updateShadow(); } catch (_) {} }
    const mesh = sparkMesh();
    if (lighting && mesh && mesh !== lightingMesh && lightState().enabled) { lighting = null; applyLighting(); }
  }, 160);

  // ── light in the scene: drag to move it ──
  const subjectCentre = () => {
    const S = window.S; if (!S?.positions?.length) return [0, 0, 0];
    const c = [0, 0, 0]; let n = 0; const st = Math.max(1, Math.floor(S.alive.length / 20000));
    for (let i = 0; i < S.alive.length; i += st) if (S.alive[i] && (S.opacity?.[i] ?? 1) >= 0.25) { for (let k = 0; k < 3; k++) c[k] += S.positions[i * 3 + k]; n++; }
    return n ? c.map(v => v / n) : c;
  };
  /** Size of the object itself (solid splats, 2–98 %), so the sun sits just outside it, on screen. */
  const subjectRadius = () => {
    const S = window.S; if (!S?.positions?.length) return 1;
    const st = Math.max(1, Math.floor(S.alive.length / 20000)), c = subjectCentre(), d = [];
    for (let i = 0; i < S.alive.length; i += st) if (S.alive[i] && (S.opacity?.[i] ?? 1) >= 0.25) d.push(Math.hypot(S.positions[i * 3] - c[0], S.positions[i * 3 + 1] - c[1], S.positions[i * 3 + 2] - c[2]));
    if (!d.length) return sceneSize() * 0.5;
    d.sort((a, b) => a - b);
    return Math.max(1e-3, d[Math.floor(d.length * 0.9)]);
  };
  let grab = false, dragging = false, sun = null, grabFrame = 0, centre = [0, 0, 0], radius = 1;
  function ensureSun() {
    if (sun || !window.scene) return sun;
    sun = new THREE.Group(); sun.name = 'fumoca-light-handle'; sun.renderOrder = 60;
    const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({ color: 0xffd54a, depthTest: false, transparent: true, opacity: 0.95, toneMapped: false }));
    const halo = new THREE.Mesh(new THREE.SphereGeometry(1.9, 20, 14), new THREE.MeshBasicMaterial({ color: 0xffd54a, depthTest: false, transparent: true, opacity: 0.18, toneMapped: false }));
    const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, 1)]);
    const line = new THREE.Line(lineGeo, new THREE.LineDashedMaterial({ color: 0xffd54a, dashSize: 0.04, gapSize: 0.03, depthTest: false, transparent: true, opacity: 0.6 }));
    ball.renderOrder = halo.renderOrder = line.renderOrder = 60;
    sun.userData = { ball, halo, line }; sun.add(ball, halo, line);
    window.scene.add(sun);
    return sun;
  }
  function placeSun(settings) {
    if (!sun) return;
    const which = q('#lkGrabWhich').value === 'second' ? 2 : 1;
    const az = (which === 2 ? settings.azimuth2 : settings.azimuth) * Math.PI / 180, el = (which === 2 ? settings.elevation2 : settings.elevation) * Math.PI / 180;
    const d = [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
    const p = centre.map((c, k) => c + d[k] * radius);
    const size = radius * 0.05;
    const { ball, halo, line } = sun.userData;
    ball.position.set(...p); ball.scale.setScalar(size); halo.position.set(...p); halo.scale.setScalar(size);
    ball.material.color.set(which === 2 ? settings.color2 : settings.color); halo.material.color.copy(ball.material.color);
    line.geometry.setFromPoints([new THREE.Vector3(...centre), new THREE.Vector3(...p)]); line.computeLineDistances();
  }
  window.addEventListener('fumoca:lightingApplied', (e) => { if (sun?.visible && e.detail) placeSun(e.detail); });
  // The handle sits in the scene with everything else: drag the sun to move
  // the light; drag anywhere else to orbit / pan as usual.
  function setGrab(on) {
    grab = on;
    centre = subjectCentre(); radius = subjectRadius() * 1.6;
    ensureSun(); if (sun) sun.visible = on;
    q('#lkGrab').classList.toggle('lime', on);
    q('#lkGrab').textContent = on ? '☀ Hide the light handle' : '☀ Show the light in the scene';
    if (!on && canvasEl()) canvasEl().style.cursor = '';
    if (on) {
      if (!q('#lkOn').checked) { q('#lkOn').checked = true; }
      placeSun(lightState()); applyLighting();
      status('Drag the sun to move the light. Drag anywhere else to turn the view as usual.');
    }
  }
  /** Is the pointer on the sun handle? (screen distance to its centre) */
  function overSun(e) {
    if (!grab || !sun?.visible || !window.camera) return false;
    const el = canvasEl(); if (!el) return false;
    const r = el.getBoundingClientRect(), ball = sun.userData.ball;
    const p = ball.position.clone().project(window.camera);
    if (p.z > 1) return false;
    const sx = (p.x * 0.5 + 0.5) * r.width + r.left, sy = (-p.y * 0.5 + 0.5) * r.height + r.top;
    // how big the ball looks on screen, at least a comfortable finger / mouse target
    const edge = ball.position.clone().add(new THREE.Vector3(ball.scale.x * 1.9, 0, 0).applyQuaternion(window.camera.quaternion)).project(window.camera);
    const px = Math.abs((edge.x - p.x) * 0.5 * r.width);
    return Math.hypot(e.clientX - sx, e.clientY - sy) <= Math.max(18, px);
  }
  function dragTo(e) {
    const el = window.renderer?.domElement, cam = window.camera;
    if (!el || !cam) return;
    const r = el.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, cam);
    const o = ray.ray.origin, d = ray.ray.direction;
    const p = raySphere([o.x, o.y, o.z], [d.x, d.y, d.z], centre, radius);
    const a = directionToAngles(p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]);
    const two = q('#lkGrabWhich').value === 'second';
    if (two && !q('#lk2').checked) q('#lk2').checked = true;
    q(two ? '#lkAz2' : '#lkAz').value = Math.round(a.azimuth);
    q(two ? '#lkEl2' : '#lkEl').value = Math.round(Math.max(two ? -30 : 2, a.elevation));
    if (preset !== 'custom') { preset = 'custom'; container.querySelectorAll('[data-mood]').forEach(b => b.classList.remove('lime')); }
    syncLabels();
    const l = ensureLighting();
    const s = lightState();
    if (l) { try { l.apply(s, { fast: true, shadow: 'auto' }); } catch (_) {} }
    placeSun(s);
  }
  const canvasEl = () => window.renderer?.domElement;
  function onGrabDown(e) {
    if (!grab || e.button !== 0 || !overSun(e)) return;      // not on the sun: the view works as usual
    const vp = canvasEl()?.parentElement;
    if (vp && !vp.contains(e.target) && e.target !== canvasEl()) return;   // a panel or button, not the view
    e.stopImmediatePropagation(); e.preventDefault();
    dragging = true; if (window.controls) window.controls.enabled = false;
    dragTo(e);
  }
  let pending = null, raf = 0;
  function onGrabMove(e) {
    if (!dragging) { if (grab && canvasEl()) canvasEl().style.cursor = overSun(e) ? 'grab' : ''; return; }
    if (canvasEl()) canvasEl().style.cursor = 'grabbing';
    pending = e;
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (pending) dragTo(pending); pending = null; });
  }
  function onGrabUp() {
    if (!dragging) return;
    dragging = false; if (window.controls) window.controls.enabled = true;
    if (canvasEl()) canvasEl().style.cursor = 'grab';
    applyLighting(); window.dispatchEvent(new CustomEvent('fumoca:lookChange'));
  }
  q('#lkGrab').addEventListener('click', () => {
    const el = canvasEl();
    // Listen on the window, first: overlays sit on top of the canvas and the
    // orbit controls would otherwise take a press that lands on the sun.
    if (el && !el._lkGrabBound) { window.addEventListener('pointerdown', onGrabDown, true); window.addEventListener('pointermove', onGrabMove); window.addEventListener('pointerup', onGrabUp); el._lkGrabBound = true; }
    setGrab(!grab);
  });
  q('#lkGrabWhich').addEventListener('change', () => { if (sun?.visible) placeSun(lightState()); });

  // ── light animation ──
  const ANIM_FIELDS = ['azimuth', 'elevation', 'intensity', 'ambient', 'azimuth2', 'elevation2', 'intensity2', 'exposure', 'contrast', 'saturation', 'warmth', 'tint', 'vignette', 'color', 'ambientColor', 'color2'];
  function motionState() {
    return normalizeLightMotion({ enabled: motionKeys.length >= 2, preset: motionPreset, duration: +q('#lmDur').value, loop: q('#lmLoop').value, autoplay: q('#lmAuto').checked, keys: motionKeys });
  }
  function loadMotion(m) {
    stopAnim(false);
    motionKeys = m?.keys ? m.keys.map(k => ({ ...k })) : [];
    motionPreset = m?.preset || 'custom';
    if (m) { q('#lmDur').value = m.duration; q('#lmLoop').value = m.loop; q('#lmAuto').checked = m.autoplay; }
    renderKeys(); syncLabels();
  }
  function spreadKeys() { motionKeys.forEach((k, i) => { k.t = motionKeys.length > 1 ? i / (motionKeys.length - 1) : 0; }); }
  function renderKeys() {
    q('#lmKeys').innerHTML = motionKeys.length
      ? motionKeys.map((k, i) => `<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">
          <span style="width:10px;height:10px;border-radius:50%;background:${k.color || '#fff4e6'};border:1px solid rgba(255,255,255,.3)"></span>
          <span style="flex:1;opacity:.85">Key ${i + 1} · ${Math.round(k.t * 100)}%${k.azimuth !== undefined ? ` · ${Math.round(k.azimuth)}°` : ''}${k.elevation !== undefined ? ` / ${Math.round(k.elevation)}° up` : ''}</span>
          <button type="button" class="ac-btn" data-lmdel="${i}" style="padding:2px 6px">✕</button></div>`).join('')
      : '<div style="opacity:.6">No animation yet.</div>';
    q('#lmKeys').querySelectorAll('[data-lmdel]').forEach(b => b.addEventListener('click', () => { motionKeys.splice(+b.dataset.lmdel, 1); spreadKeys(); motionPreset = 'custom'; renderKeys(); motionChanged(); }));
    container.querySelectorAll('[data-lmotion]').forEach(b => b.classList.toggle('lime', b.dataset.lmotion === motionPreset && motionKeys.length >= 2));
  }
  const motionChanged = () => { if (animator?.playing) playAnim(); window.dispatchEvent(new CustomEvent('fumoca:lookChange')); };
  const baseLight = () => { const s = lightState(); delete s.motion; return s; };
  function playAnim() {
    const m = motionState();
    if (!m?.enabled) { status('Pick an animation, or add at least two keys.'); return; }
    if (!q('#lkOn').checked) { q('#lkOn').checked = true; }
    const go = (l) => {
      if (!animator || animator.lighting !== l) { animator?.stop(false); animator = new LightAnimator(l, baseLight, m); }
      else animator.setMotion(m);
      ensureSun(); if (sun) { centre = subjectCentre(); radius = subjectRadius() * 1.6; sun.visible = true; }
      animator.play();
      q('#lmPlay').textContent = '■ Stop';
      status('Playing — the sun marker shows where the light is. Press Stop to edit.');
    };
    const l = ensureLighting();
    if (l) return go(l);
    status('Turning Photoreal (Spark) on…');
    window.FumocaStudioHooks?.ensureSpark?.().then(mesh => { const l2 = mesh && ensureLighting(); if (l2) setTimeout(() => go(l2), 600); else status('Photoreal (Spark) could not start on this device — lighting needs it.'); });
  }
  function stopAnim(restore = true) {
    if (!animator?.playing) return;
    animator.stop(restore);
    if (sun && !grab) sun.visible = false;
    q('#lmPlay').textContent = '▶ Play';
  }
  container.querySelectorAll('[data-lmotion]').forEach(b => b.addEventListener('click', () => {
    if (!q('#lkOn').checked) { q('#lkOn').checked = true; syncLabels(); }
    const base = baseLight();
    const m = motionFromPreset(b.dataset.lmotion, base);
    const extra = LIGHT_MOTIONS[b.dataset.lmotion].base;
    if (extra) { if (extra.light2) q('#lk2').checked = true; if (extra.intensity2 !== undefined) q('#lkInt2').value = extra.intensity2; syncLabels(); }
    loadMotion(m); motionPreset = b.dataset.lmotion; renderKeys();
    playAnim(); window.dispatchEvent(new CustomEvent('fumoca:lookChange'));
  }));
  q('#lmAddKey').addEventListener('click', () => {
    stopAnim(true);
    if (!q('#lkOn').checked) { q('#lkOn').checked = true; applyLighting(); }
    const s = baseLight(), key = {};
    for (const f of ANIM_FIELDS) key[f] = s[f];
    motionKeys.push(key); spreadKeys(); motionPreset = 'custom'; renderKeys();
    status(motionKeys.length < 2 ? 'Key 1 added. Now move the light (drag it or use the sliders) and add key 2.' : `Key ${motionKeys.length} added — press Play.`);
    motionChanged();
  });
  q('#lmPlay').addEventListener('click', () => (animator?.playing ? stopAnim(true) : playAnim()));
  q('#lmClear').addEventListener('click', () => { stopAnim(true); motionKeys = []; motionPreset = 'custom'; renderKeys(); motionChanged(); status('Light animation cleared.'); });
  ['lmDur', 'lmLoop', 'lmAuto'].forEach(id => { q('#' + id).addEventListener('input', () => { syncLabels(); if (id !== 'lmAuto') motionChanged(); }); q('#' + id).addEventListener('change', () => window.dispatchEvent(new CustomEvent('fumoca:lookChange'))); });
  renderKeys();

  // ── view ──
  function syncLabels() {
    const fmt = {
      lkAz: v => Math.round(v) + '°', lkEl: v => Math.round(v) + '°', lkInt: v => Math.round(v * 100) + '%', lkAmb: v => Math.round(v * 100) + '%',
      lkAz2: v => Math.round(v) + '°', lkEl2: v => Math.round(v) + '°', lkInt2: v => Math.round(v * 100) + '%',
      lkExp: v => (v > 0 ? '+' : '') + (+v).toFixed(2), lkCon: v => Math.round(v * 100), lkSat: v => Math.round(v * 100),
      lkWarm: v => Math.round(v * 100), lkTint: v => Math.round(v * 100), lkVig: v => Math.round(v * 100) + '%',
      lkShOp: v => Math.round(v * 100) + '%', lkSelfOp: v => Math.round(v * 100) + '%', lkAo: v => Math.round(v * 100) + '%', lkContact: v => Math.round(v * 100) + '%', lkDelight: v => Math.round(v * 100) + '%', lkShSoft: v => Math.round(v * 100) + '%', lmDur: v => (+v).toFixed(1) + ' s',
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
    stopAnim(false); animator = null; if (grab) setGrab(false);
    lighting?.dispose?.(); lighting = null; lightingMesh = null;
    const present = window._fumocaCurrentRecord?.meta?.present || {};
    const ls = normalizeLighting(present.lighting), vs = normalizeViewSettings(present.view);
    if (ls) {
      setLightControls(ls);
      loadMotion(normalizeLightMotion(ls.motion));
      if (ls.enabled) setTimeout(applyLighting, 2500);
    } else { q('#lkOn').checked = false; loadMotion(null); }
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
    playLight: () => playAnim(), stopLight: () => stopAnim(true),
    get lightAnimator() { return animator; },
  };
  window.FumocaLook = api;
  return api;
}
