/**
 * Studio "Parts" tab: make moving parts from a selection — car doors,
 * bonnet, boot, house doors, drawers, bottle caps, can lids, a reclining
 * couch — and wire them to hotspots in the viewer. CPU only, no AI.
 */
import * as THREE from 'three';
import { PartAnimator, normalizeParts, suggestHinge } from './part-animator.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Ready-made starting points; everything stays editable.
const KINDS = {
  carDoor:  { label: 'Car door',        name: 'Driver door', type: 'hinge', side: 'front', angle: 62, ease: 'spring', duration: 1.3 },
  bonnet:   { label: 'Bonnet / hood',   name: 'Bonnet',      type: 'hinge', side: 'back', axisKey: 'x', angle: -55, ease: 'ease-in-out', duration: 1.6 },
  boot:     { label: 'Boot / trunk',    name: 'Boot',        type: 'hinge', side: 'top', axisKey: 'x', angle: 60, ease: 'ease-in-out', duration: 1.6 },
  houseDoor:{ label: 'House door',      name: 'Front door',  type: 'hinge', side: 'left', angle: -95, ease: 'ease-in-out', duration: 1.8 },
  drawer:   { label: 'Drawer',          name: 'Drawer',      type: 'slide', axisKey: 'z', distanceFrac: 0.8, ease: 'ease-out', duration: 0.9 },
  cap:      { label: 'Bottle cap',      name: 'Cap',         type: 'twist', side: 'center', axisKey: 'y', angle: -540, liftFrac: 1.6, ease: 'ease-in-out', duration: 1.6 },
  canLid:   { label: 'Can ring / lid',  name: 'Ring pull',   type: 'hinge', side: 'back', axisKey: 'x', angle: -75, ease: 'spring', duration: 0.8 },
  recline:  { label: 'Recliner back',   name: 'Backrest',    type: 'hinge', side: 'bottom', axisKey: 'x', angle: -28, ease: 'ease-in-out', duration: 2.2 },
};
const AXES = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

export function mountPartsPanel(container, { onStatus } = {}) {
  if (!container) return null;
  container.innerHTML = `
    <div class="section">
      <div class="sec-head"><span class="sec-label">Moving parts</span><span class="sec-badge">CPU</span></div>
      <div class="sec-body" style="padding:10px">
        <div class="hint">Select the part in the viewport (lasso / brush), pick what it is, and press <b>Make part</b>. Then link it to a hotspot in the viewer so visitors can open it.</div>
        <div class="ctrl-row" style="margin-top:8px"><span class="ctrl-label">It is a…</span></div>
        <select id="ptKind" class="ac-select" style="width:100%">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select>
        <button type="button" class="ac-btn lime full" id="ptMake" style="margin-top:6px">Make part from selection</button>
      </div>
    </div>
    <div class="section" id="ptEditSec" style="display:none">
      <div class="sec-head"><span class="sec-label" id="ptEditTitle">Part</span></div>
      <div class="sec-body" style="padding:10px">
        <input id="ptName" class="ac-input" style="width:100%;padding:6px 8px" maxlength="60">
        <div class="ctrl-row" style="margin-top:6px"><span class="ctrl-label">Motion</span></div>
        <select id="ptType" class="ac-select" style="width:100%"><option value="hinge">Swing on a hinge</option><option value="slide">Slide</option><option value="twist">Twist off (caps, lids)</option></select>
        <div class="ctrl-row" style="margin-top:6px"><span class="ctrl-label">Hinge / pivot on</span></div>
        <select id="ptSide" class="ac-select" style="width:100%">${['left', 'right', 'front', 'back', 'top', 'bottom', 'center'].map(s => `<option value="${s}">${s[0].toUpperCase() + s.slice(1)} edge</option>`).join('').replace('Center edge', 'Centre')}</select>
        <div class="ctrl-row" style="margin-top:6px"><span class="ctrl-label">Axis</span></div>
        <select id="ptAxis" class="ac-select" style="width:100%"><option value="auto">Automatic</option><option value="x">Left–right (X)</option><option value="y">Up–down (Y)</option><option value="z">Front–back (Z)</option></select>
        <div id="ptAngleRow"><div class="ctrl-row"><span class="ctrl-label">Opens by</span><span class="ctrl-val" id="ptAngleVal"></span></div><input type="range" id="ptAngle" min="-720" max="720" step="1" style="width:100%"></div>
        <div id="ptDistRow"><div class="ctrl-row"><span class="ctrl-label">Slides by</span><span class="ctrl-val" id="ptDistVal"></span></div><input type="range" id="ptDist" min="-1" max="1" step="0.001" style="width:100%"></div>
        <div id="ptLiftRow"><div class="ctrl-row"><span class="ctrl-label">Lifts by</span><span class="ctrl-val" id="ptLiftVal"></span></div><input type="range" id="ptLift" min="0" max="1" step="0.001" style="width:100%"></div>
        <div class="ctrl-row"><span class="ctrl-label">Speed</span><span class="ctrl-val" id="ptDurVal"></span></div>
        <input type="range" id="ptDur" min="0.2" max="6" step="0.1" style="width:100%">
        <div class="ctrl-row" style="margin-top:6px"><span class="ctrl-label">Feel</span></div>
        <select id="ptEase" class="ac-select" style="width:100%"><option value="ease-in-out">Smooth</option><option value="spring">Sprung (little bounce)</option><option value="ease-out">Quick then soft</option><option value="linear">Mechanical</option></select>
        <div class="ctrl-row" style="margin-top:6px"><span class="ctrl-label">Try it</span><span class="ctrl-val" id="ptOpenVal">closed</span></div>
        <input type="range" id="ptOpen" min="0" max="1" step="0.01" value="0" style="width:100%">
        <div style="display:flex;gap:6px;margin-top:6px">
          <button type="button" class="ac-btn lime" id="ptPlay" style="flex:1">▶ Open / close</button>
          <button type="button" class="ac-btn" id="ptFlip" style="flex:1" title="Swings or slides the wrong way? Reverse it.">⇄ Other way</button>
          <button type="button" class="ac-btn" id="ptDelete" style="flex:1">Delete part</button>
        </div>
      </div>
    </div>
    <div class="section">
      <div class="sec-head"><span class="sec-label">Parts in this scan</span></div>
      <div class="sec-body" style="padding:10px" id="ptList"><div class="hint">No parts yet.</div></div>
    </div>
    <div class="hint" id="ptStatus" role="status" style="margin:8px 10px"></div>`;

  const q = (s) => container.querySelector(s);
  const status = (m) => { q('#ptStatus').textContent = m; onStatus?.(m); };
  let parts = [], editing = null, animator = null, animMesh = null;
  const sparkMesh = () => (window.FumocaSparkGaussian?.isEnabled?.() ? window.FumocaSparkGaussian.getMesh?.() : null);

  function ensureAnimator() {
    const mesh = sparkMesh();
    if (!mesh) return null;
    if (animator && animMesh === mesh) return animator;
    animator?.dispose?.();
    try { animator = new PartAnimator(THREE, mesh, parts); animMesh = mesh; }
    catch (e) { animator = null; status(e.message); }
    return animator;
  }
  const changed = () => {
    window.dispatchEvent(new CustomEvent('fumoca:partsChange', { detail: parts }));
    ensureAnimator()?.setParts(parts);
    renderList();
  };

  function boxSpan(p) { return Math.max(...p.box.max.map((v, i) => v - p.box.min[i])); }

  function selectionBox() {
    const S = window.S;
    if (!S?.selected || !S.positions) return null;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    let n = 0;
    for (let i = 0; i < S.selected.length; i++) {
      if (!S.selected[i] || (S.alive && !S.alive[i])) continue;
      n++;
      for (let k = 0; k < 3; k++) { const v = S.positions[i * 3 + k]; if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v; }
    }
    if (n < 10) return null;
    const pad = Math.max(...max.map((v, i) => v - min[i])) * 0.015;
    return { box: { min: min.map(v => v - pad), max: max.map(v => v + pad) }, n };
  }

  function motionFromKind(kindKey, box) {
    const k = KINDS[kindKey] || KINDS.carDoor;
    const h = suggestHinge(box, k.side || 'center');
    const span = Math.max(...box.max.map((v, i) => v - box.min[i]));
    return {
      type: k.type, pivot: h.pivot, axis: k.axisKey ? AXES[k.axisKey] : h.axis,
      angle: k.angle ?? 0, distance: (k.distanceFrac || 0) * span, lift: (k.liftFrac || 0) * (box.max[1] - box.min[1]),
      duration: k.duration, ease: k.ease, side: k.side || 'center', axisKey: k.axisKey || 'auto',
    };
  }

  function edit(id) {
    editing = parts.find(p => p.id === id) || null;
    q('#ptEditSec').style.display = editing ? '' : 'none';
    if (!editing) return;
    const m = editing.motion, span = boxSpan(editing);
    q('#ptEditTitle').textContent = editing.name;
    q('#ptName').value = editing.name;
    q('#ptType').value = m.type; q('#ptSide').value = m.side || 'center'; q('#ptAxis').value = m.axisKey || 'auto';
    q('#ptAngle').value = m.angle; q('#ptDur').value = m.duration; q('#ptEase').value = m.ease;
    q('#ptDist').min = -2 * span; q('#ptDist').max = 2 * span; q('#ptDist').step = span / 500; q('#ptDist').value = m.distance;
    q('#ptLift').max = 2 * span; q('#ptLift').step = span / 500; q('#ptLift').value = m.lift;
    syncEditLabels();
  }

  function syncEditLabels() {
    if (!editing) return;
    const t = q('#ptType').value;
    q('#ptAngleRow').style.display = t === 'slide' ? 'none' : '';
    q('#ptDistRow').style.display = t === 'slide' ? '' : 'none';
    q('#ptLiftRow').style.display = t === 'twist' ? '' : 'none';
    q('#ptAngleVal').textContent = Math.round(+q('#ptAngle').value) + '°';
    q('#ptDistVal').textContent = (+q('#ptDist').value).toFixed(3);
    q('#ptLiftVal').textContent = (+q('#ptLift').value).toFixed(3);
    q('#ptDurVal').textContent = (+q('#ptDur').value).toFixed(1) + ' s';
    const o = +q('#ptOpen').value;
    q('#ptOpenVal').textContent = o < 0.01 ? 'closed' : o > 0.99 ? 'open' : Math.round(o * 100) + '%';
  }

  function readEdit() {
    if (!editing) return;
    const side = q('#ptSide').value, axisKey = q('#ptAxis').value;
    const h = suggestHinge(editing.box, side);
    editing.name = q('#ptName').value.trim().slice(0, 60) || 'Part';
    editing.motion = {
      ...editing.motion,
      type: q('#ptType').value, side, axisKey, pivot: h.pivot, axis: axisKey === 'auto' ? h.axis : AXES[axisKey],
      angle: +q('#ptAngle').value, distance: +q('#ptDist').value, lift: +q('#ptLift').value,
      duration: +q('#ptDur').value, ease: q('#ptEase').value,
    };
    parts = normalizeParts(parts.map(p => (p.id === editing.id ? editing : p))).map((p) => {
      const src = p.id === editing.id ? editing : parts.find(x => x.id === p.id);
      return { ...p, motion: { ...p.motion, side: src?.motion?.side, axisKey: src?.motion?.axisKey } };
    });
    editing = parts.find(p => p.id === editing.id);
    q('#ptEditTitle').textContent = editing.name;
    const a = ensureAnimator();
    if (a) { a.setParts(parts); a.set(editing.id, +q('#ptOpen').value); }
  }

  function renderList() {
    if (!parts.length) { q('#ptList').innerHTML = '<div class="hint">No parts yet.</div>'; return; }
    const info = new Map((animator?.list() || []).map(x => [x.id, x]));
    q('#ptList').innerHTML = parts.map(p => `
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
        <button type="button" class="ac-btn" data-run="${esc(p.id)}" title="Open / close" style="padding:4px 8px">▶</button>
        <span style="flex:1;font-size:12px">${esc(p.name)} <span style="opacity:.5">· ${esc(p.motion.type)} · ${(info.get(p.id)?.members ?? 0).toLocaleString()} splats</span></span>
        <button type="button" class="ac-btn" data-edit="${esc(p.id)}" style="padding:4px 8px">Edit</button>
      </div>`).join('');
    q('#ptList').querySelectorAll('[data-run]').forEach(b => b.addEventListener('click', () => ensureAnimator()?.run(b.dataset.run)));
    q('#ptList').querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => edit(b.dataset.edit)));
  }

  q('#ptMake').addEventListener('click', () => {
    if (!sparkMesh()) { status('Turn on Photoreal (Spark) first — parts move the photoreal splats.'); return; }
    const sel = selectionBox();
    if (!sel) { status('Select the part first (at least a few splats), e.g. with the lasso on the door.'); return; }
    const kind = q('#ptKind').value;
    const base = KINDS[kind];
    let name = base.name, k = 2;
    while (parts.some(p => p.name === name)) name = `${base.name} ${k++}`;
    const part = { id: 'part_' + Date.now().toString(36), name, box: sel.box, motion: motionFromKind(kind, sel.box) };
    parts = normalizeParts([...parts, part]).map(p => (p.id === part.id ? { ...p, motion: { ...p.motion, side: part.motion.side, axisKey: part.motion.axisKey } } : p));
    changed();
    edit(part.id);
    status(`${name} made from ${sel.n.toLocaleString()} selected splats. Press ▶ to try it; adjust the hinge side if it swings the wrong way.`);
  });
  ['ptName', 'ptType', 'ptSide', 'ptAxis', 'ptAngle', 'ptDist', 'ptLift', 'ptDur', 'ptEase'].forEach(id =>
    q('#' + id).addEventListener('input', () => { syncEditLabels(); readEdit(); }));
  ['ptName', 'ptType', 'ptSide', 'ptAxis', 'ptAngle', 'ptDist', 'ptLift', 'ptDur', 'ptEase'].forEach(id =>
    q('#' + id).addEventListener('change', () => changed()));
  q('#ptOpen').addEventListener('input', () => { syncEditLabels(); if (editing) ensureAnimator()?.set(editing.id, +q('#ptOpen').value); });
  q('#ptPlay').addEventListener('click', async () => {
    if (!editing) return;
    const a = ensureAnimator(); if (!a) return;
    await a.run(editing.id);
    q('#ptOpen').value = a.parts.get(editing.id)?.t ?? 0; syncEditLabels();
  });
  q('#ptFlip').addEventListener('click', () => {
    if (!editing) return;
    q('#ptAngle').value = -(+q('#ptAngle').value); q('#ptDist').value = -(+q('#ptDist').value);
    syncEditLabels(); readEdit(); changed();
  });
  q('#ptDelete').addEventListener('click', () => {
    if (!editing) return;
    ensureAnimator()?.set(editing.id, 0);
    parts = parts.filter(p => p.id !== editing.id);
    edit(null); changed(); status('Part deleted.');
  });

  // Spark rebuilds its mesh after edits; follow it and keep parts where they were.
  setInterval(() => {
    const mesh = sparkMesh();
    if (parts.length && mesh && animator && mesh !== animMesh) {
      Promise.resolve(mesh.initialized).then(() => { animator = null; ensureAnimator(); renderList(); });
    }
  }, 800);

  window.addEventListener('fumoca:fileLoaded', () => {
    animator?.dispose?.(); animator = null; animMesh = null; edit(null);
    parts = normalizeParts(window._fumocaCurrentRecord?.meta?.present?.parts);
    renderList();
    if (parts.length) setTimeout(() => { ensureAnimator(); renderList(); }, 2200);
  });

  const api = {
    getParts: () => parts.map(p => ({ ...p })),
    list: () => parts.map(p => ({ id: p.id, name: p.name })),
    run: (id, to) => ensureAnimator()?.run(id, to),
    get animator() { return animator; },
  };
  window.FumocaParts = api;
  return api;
}
