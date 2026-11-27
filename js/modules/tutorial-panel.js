/**
 * Studio "Guide" tab: build a step-by-step product tutorial on the scan —
 * "how to switch it on", "where to find battery health", "how to recline".
 * Steps fly the camera, ring a button, put a screenshot or screen recording
 * on the device's screen, open parts / switch lights, and play a voice-over.
 */
import * as THREE from 'three';
import { fitScreenQuad, normalizeTutorial, TutorialPlayer, makeProjector } from './tutorial.js';
import { runAction } from './hotspot-actions.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inputCss = 'width:100%;padding:6px 8px;border-radius:6px;border:1px solid rgba(255,255,255,.12);background:rgba(0,0,0,.3);color:inherit;font-size:12px';

export function mountTutorialPanel(container, { onStatus } = {}) {
  if (!container) return null;
  container.innerHTML = `
    <div class="section">
      <div class="sec-head"><span class="sec-label">Product guide</span><span class="sec-badge">NEW</span></div>
      <div class="sec-body" style="padding:10px">
        <div class="hint">Show people how to use the product: each step moves the camera, rings a button, shows a screenshot or screen recording on the device, and can open parts, switch lights or play a voice-over.</div>
        <input id="tgTitle" placeholder="Guide title, e.g. Getting started" style="${inputCss};margin-top:6px" maxlength="80" value="How it works">
        <label style="display:flex;gap:6px;align-items:center;font-size:11px;margin-top:6px"><input type="checkbox" id="tgAuto"> Start automatically when the page opens</label>
      </div>
    </div>
    <div class="section">
      <div class="sec-head"><span class="sec-label">Screens</span></div>
      <div class="sec-body" style="padding:10px">
        <div class="hint">Select the device's screen (phone, laptop, car display, TV) and make it a screen. Steps can then show your own screenshots or recordings on it.</div>
        <button type="button" class="ac-btn full" id="tgScreen" style="margin-top:6px">＋ Screen from selection</button>
        <div id="tgScreens" style="margin-top:6px"></div>
      </div>
    </div>
    <div class="section">
      <div class="sec-head"><span class="sec-label">Steps</span></div>
      <div class="sec-body" style="padding:10px">
        <button type="button" class="ac-btn lime full" id="tgAdd">＋ Add step from this view</button>
        <div id="tgSteps" style="margin-top:8px"></div>
        <button type="button" class="ac-btn full" id="tgPreview" style="margin-top:8px">▶ Preview guide</button>
      </div>
    </div>
    <div class="hint" id="tgStatus" role="status" style="margin:8px 10px"></div>`;

  const q = (s) => container.querySelector(s);
  const status = (m) => { q('#tgStatus').textContent = m; onStatus?.(m); };
  let screens = [], steps = [], open = null, player = null;

  const selectedIdx = () => {
    const S = window.S, out = [];
    if (!S?.selected) return out;
    for (let i = 0; i < S.selected.length; i++) if (S.selected[i] && (!S.alive || S.alive[i])) out.push(i);
    return out;
  };
  const viewNow = () => {
    const c = window.camera, t = window.controls?.target;
    return c && t ? { position: [c.position.x, c.position.y, c.position.z], target: [t.x, t.y, t.z] } : null;
  };
  const changed = () => window.dispatchEvent(new CustomEvent('fumoca:tutorialChange'));
  const state = () => normalizeTutorial({ title: q('#tgTitle').value, autoplay: q('#tgAuto').checked, screens, steps });

  function actionOptions(step) {
    const cur = step.action ? (step.action.type === 'part' ? 'part:' + step.action.partId : step.action.lampId ? 'lamp:' + step.action.lampId : step.action.mood ? 'mood:' + step.action.mood : '') : '';
    const opts = [['', 'No action']];
    for (const p of window.FumocaParts?.list?.() || []) opts.push(['part:' + p.id, 'Open / close: ' + p.name]);
    for (const l of window.FumocaLook?.lamps?.() || []) opts.push(['lamp:' + l.id, 'Light switch: ' + l.name]);
    for (const [k, l] of [['natural', 'Natural'], ['studio', 'Studio'], ['golden', 'Golden hour'], ['night', 'Night'], ['neon', 'Neon'], ['product', 'Clean product']]) opts.push(['mood:' + k, 'Mood: ' + l]);
    return opts.map(([v, l]) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`).join('');
  }

  function renderScreens() {
    q('#tgScreens').innerHTML = screens.map((s, i) => `
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px">
        <input data-sc-name="${i}" value="${esc(s.name)}" style="${inputCss};flex:1" maxlength="40">
        <button type="button" class="ac-btn" data-sc-flip="${i}" title="Show on the other side" style="padding:4px 8px">⇄</button>
        <button type="button" class="ac-btn" data-sc-del="${i}" style="padding:4px 8px">✕</button>
      </div>`).join('') || '<div class="hint">No screens yet.</div>';
    q('#tgScreens').querySelectorAll('[data-sc-name]').forEach(el => el.addEventListener('change', () => { screens[+el.dataset.scName].name = el.value.slice(0, 40); changed(); renderSteps(); }));
    q('#tgScreens').querySelectorAll('[data-sc-flip]').forEach(el => el.addEventListener('click', () => { const s = screens[+el.dataset.scFlip]; s.flip = !s.flip; changed(); status('Screen flipped to the other side.'); }));
    q('#tgScreens').querySelectorAll('[data-sc-del]').forEach(el => el.addEventListener('click', () => { const id = screens[+el.dataset.scDel].id; screens.splice(+el.dataset.scDel, 1); steps.forEach(s => { if (s.screenId === id) s.screenId = ''; }); renderScreens(); renderSteps(); changed(); }));
  }

  function renderSteps() {
    q('#tgSteps').innerHTML = steps.map((s, i) => {
      const isOpen = open === s.id;
      return `<div style="border:1px solid rgba(255,255,255,${isOpen ? '.25' : '.08'});border-radius:10px;padding:8px;margin-bottom:6px">
        <div style="display:flex;align-items:center;gap:6px;cursor:pointer" data-toggle="${esc(s.id)}">
          <span style="font-size:11px;color:#c8ff00;font-weight:800">${i + 1}</span>
          <span style="flex:1;font-size:12px;font-weight:700">${esc(s.title)}</span>
          <span style="font-size:10px;opacity:.5">${[s.highlight && '◎', s.media && '🖥', s.action && '⚡', s.narration && '🎙'].filter(Boolean).join(' ')}</span>
        </div>
        ${isOpen ? `<div style="display:grid;gap:6px;margin-top:8px">
          <input data-f="title" value="${esc(s.title)}" maxlength="80" style="${inputCss}" placeholder="Step title">
          <textarea data-f="text" rows="3" maxlength="600" style="${inputCss};resize:vertical" placeholder="What to do / what they see">${esc(s.text)}</textarea>
          <div style="display:flex;gap:6px">
            <button type="button" class="ac-btn" data-do="view" style="flex:1">📷 Use this view</button>
            <button type="button" class="ac-btn" data-do="ring" style="flex:1">◎ Ring the selection</button>
          </div>
          ${s.highlight ? '<button type="button" class="ac-btn" data-do="unring">Remove ring</button>' : ''}
          <select data-f="screenId" style="${inputCss}"><option value="">No screen media</option>${screens.map(sc => `<option value="${esc(sc.id)}" ${sc.id === s.screenId ? 'selected' : ''}>On ${esc(sc.name)}</option>`).join('')}</select>
          ${s.screenId ? `<input data-f="media" value="${esc(s.media)}" style="${inputCss}" placeholder="Screenshot / GIF / video URL (e.g. Settings → Battery)">` : ''}
          <select data-f="action" style="${inputCss}">${actionOptions(s)}</select>
          <input data-f="narration" value="${esc(s.narration)}" style="${inputCss}" placeholder="Voice-over URL (optional, the guide waits for it)">
          <div class="ctrl-row"><span class="ctrl-label">Show for</span><span class="ctrl-val">${s.seconds}s</span></div>
          <input type="range" data-f="seconds" min="2" max="30" step="1" value="${s.seconds}" style="width:100%">
          <div style="display:flex;gap:6px">
            <button type="button" class="ac-btn" data-do="up" style="flex:1">↑</button>
            <button type="button" class="ac-btn" data-do="down" style="flex:1">↓</button>
            <button type="button" class="ac-btn" data-do="try" style="flex:2">▶ Try step</button>
            <button type="button" class="ac-btn" data-do="del" style="flex:1">✕</button>
          </div></div>` : ''}
      </div>`;
    }).join('') || '<div class="hint">No steps yet — frame the first thing to show and press “Add step”.</div>';
    q('#tgSteps').querySelectorAll('[data-toggle]').forEach(el => el.addEventListener('click', () => { open = open === el.dataset.toggle ? null : el.dataset.toggle; renderSteps(); }));
    const s = steps.find(x => x.id === open);
    if (!s) return;
    const box = q(`[data-toggle="${CSS.escape(s.id)}"]`).parentElement;
    box.querySelectorAll('[data-f]').forEach(el => el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => {
      const f = el.dataset.f;
      if (f === 'action') {
        const [k, ...r] = el.value.split(':'); const ref = r.join(':');
        s.action = !el.value ? null : k === 'part' ? { type: 'part', partId: ref, to: 'toggle' } : k === 'lamp' ? { type: 'lighting', lampId: ref, to: 'toggle' } : { type: 'lighting', mood: ref };
      } else if (f === 'seconds') s.seconds = +el.value;
      else s[f] = el.value;
      changed();
      if (f === 'screenId' || f === 'seconds' || f === 'title') renderSteps();
    }));
    box.querySelectorAll('[data-do]').forEach(el => el.addEventListener('click', () => {
      const i = steps.indexOf(s);
      switch (el.dataset.do) {
        case 'view': s.view = viewNow(); status('Step view updated.'); break;
        case 'ring': {
          const idx = selectedIdx();
          if (!idx.length) { status('Select the button or spot to ring first.'); return; }
          const P = window.S.positions, c = [0, 0, 0];
          for (const k of idx) for (let d = 0; d < 3; d++) c[d] += P[k * 3 + d];
          s.highlight = c.map(v => v / idx.length); status('This step rings the selected spot.'); break;
        }
        case 'unring': s.highlight = null; break;
        case 'up': if (i > 0) [steps[i - 1], steps[i]] = [steps[i], steps[i - 1]]; break;
        case 'down': if (i < steps.length - 1) [steps[i + 1], steps[i]] = [steps[i], steps[i + 1]]; break;
        case 'del': steps.splice(i, 1); open = null; break;
        case 'try': preview(i); return;
      }
      changed(); renderSteps();
    }));
  }

  function preview(from = 0) {
    const t = state();
    if (!t?.steps.length) { status('Add a step first.'); return; }
    player?.dispose();
    const host = window.renderer?.domElement?.parentElement || document.getElementById('viewport');
    const mesh = window.FumocaSparkGaussian?.getMesh?.();
    try {
      player = new TutorialPlayer(t, { THREE, camera: window.camera, controls: window.controls, host, parent: mesh || window.scene, runAction, project: makeProjector(THREE, window.camera, host) });
      player.start(true);
      if (from) player.go(from);
      status('Previewing — this is what visitors see.');
    } catch (e) { status(e.message); }
  }

  q('#tgScreen').addEventListener('click', () => {
    const idx = selectedIdx();
    try {
      const fit = fitScreenQuad(window.S.positions, idx);
      screens.push({ id: 'screen' + Date.now().toString(36), name: 'Screen ' + (screens.length + 1), center: fit.center, u: fit.u, v: fit.v, flip: false });
      renderScreens(); renderSteps(); changed();
      status(`Screen fitted to ${idx.length.toLocaleString()} splats. If media appears on the back, press ⇄.`);
    } catch (e) { status(e.message); }
  });
  q('#tgAdd').addEventListener('click', () => {
    const v = viewNow(); if (!v) return;
    const s = { id: 'step' + Date.now().toString(36), title: `Step ${steps.length + 1}`, text: '', view: v, highlight: null, screenId: '', media: '', action: null, narration: '', seconds: 6 };
    steps.push(s); open = s.id; renderSteps(); changed();
    status('Step added from this view. Give it a title and what to do.');
  });
  q('#tgPreview').addEventListener('click', () => preview(0));
  q('#tgTitle').addEventListener('change', changed);
  q('#tgAuto').addEventListener('change', changed);

  window.addEventListener('fumoca:fileLoaded', () => {
    player?.dispose(); player = null; open = null;
    const t = normalizeTutorial(window._fumocaCurrentRecord?.meta?.present?.tutorial);
    screens = t?.screens || []; steps = t?.steps || [];
    q('#tgTitle').value = t?.title || 'How it works'; q('#tgAuto').checked = !!t?.autoplay;
    renderScreens(); renderSteps();
  });

  renderScreens(); renderSteps();
  const api = { getTutorial: () => state(), preview, get player() { return player; } };
  window.FumocaTutorial = api;
  return api;
}
