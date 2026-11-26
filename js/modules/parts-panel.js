/**
 * Studio "Parts" tab: make moving parts from a selection — car doors,
 * bonnet, boot, house doors, drawers, bottle caps, can lids, a reclining
 * couch — and wire them to hotspots in the viewer. CPU only, no AI.
 */
import * as THREE from 'three';
import { PartAnimator, normalizeParts, suggestHinge, cellsFromIndices } from './part-animator.js';
import { regionFromPoints } from './food-pick.js';

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
  binLid:   { label: 'Bin lid (flips up)', name: 'Bin lid',    type: 'hinge', side: 'back', axisKey: 'x', angle: -105, ease: 'spring', duration: 1.1 },
  boxLid:   { label: 'Box / chest lid',  name: 'Lid',          type: 'hinge', side: 'back', axisKey: 'x', angle: -100, ease: 'ease-in-out', duration: 1.6 },
  potLid:   { label: 'Pot / pan lid (lifts off)', name: 'Pot lid', type: 'lift', side: 'center', axisKey: 'y', angle: 14, liftSpanFrac: 0.45, ease: 'ease-out', duration: 1.0 },
  jarLid:   { label: 'Jar / tub lid (unscrews)', name: 'Jar lid', type: 'twist', side: 'center', axisKey: 'y', angle: -360, liftFrac: 1.4, ease: 'ease-in-out', duration: 1.4 },
  laptop:   { label: 'Laptop / case lid', name: 'Screen',      type: 'hinge', side: 'back', axisKey: 'x', angle: -110, ease: 'ease-in-out', duration: 1.8 },
  toiletLid:{ label: 'Toilet / seat lid', name: 'Seat lid',    type: 'hinge', side: 'back', axisKey: 'x', angle: -95, ease: 'ease-out', duration: 1.2 },
  ovenDoor: { label: 'Oven / dishwasher door (drops down)', name: 'Oven door', type: 'hinge', side: 'bottom', axisKey: 'x', angle: 85, ease: 'ease-in-out', duration: 1.4 },
  cupboard: { label: 'Cupboard / wardrobe door', name: 'Cupboard door', type: 'hinge', side: 'left', angle: -100, ease: 'ease-in-out', duration: 1.3 },
  fridge:   { label: 'Fridge door',      name: 'Fridge door',  type: 'hinge', side: 'left', angle: -110, ease: 'spring', duration: 1.5 },
  sliding:  { label: 'Sliding door / panel', name: 'Sliding door', type: 'slide', axisKey: 'x', distanceFrac: 0.9, ease: 'ease-in-out', duration: 1.4 },
  // food that reacts when picked up (select the piece: a slice, a bite, a dumpling)
  pizza:    { label: '🍕 Pizza slice (cheese pull)', name: 'Pizza slice', type: 'pick', food: { utensil: 'none', hold: 'crust', lift: 0.55, dist: 0.45, angle: 10, droop: 0.4, stretch: 0.95, zone: 0.2 }, ease: 'ease-in-out', duration: 2.2 },
  pie:      { label: '🥧 Pie / cake / lasagne slice (server)', name: 'Pie slice', type: 'pick', food: { utensil: 'server', hold: 'bottom', lift: 0.5, dist: 0.5, angle: 4, droop: 0.05, stretch: 0.45, zone: 0.12 }, ease: 'ease-in-out', duration: 2.4 },
  chop:     { label: '🥢 With chopsticks (meat, sushi, dumpling)', name: 'Bite', type: 'pick', food: { utensil: 'chopsticks', hold: 'top', lift: 1.1, dist: 0.25, angle: 14, droop: 0.12, stretch: 0.2, zone: 0.08 }, ease: 'ease-in-out', duration: 1.8 },
  noodles:  { label: '🍜 Noodles / salad with chopsticks', name: 'Noodles', type: 'pick', food: { utensil: 'chopsticks', hold: 'top', lift: 1.3, dist: 0.15, angle: 6, droop: 0.9, stretch: 0.6, zone: 0.12 }, ease: 'ease-in-out', duration: 2.2 },
  fork:     { label: '🍴 On a fork (steak, salad, cake)', name: 'Fork bite', type: 'pick', food: { utensil: 'fork', hold: 'top', lift: 1.0, dist: 0.3, angle: 10, droop: 0.06, stretch: 0.15, zone: 0.06 }, ease: 'ease-in-out', duration: 1.8 },
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
        <select id="ptType" class="ac-select" style="width:100%"><option value="hinge">Swing on a hinge</option><option value="slide">Slide</option><option value="twist">Twist off (caps, lids)</option><option value="lift">Lift off (pot lids)</option><option value="pick">Pick up (food)</option></select>
        <div class="ctrl-row" style="margin-top:6px"><span class="ctrl-label">Hinge / pivot on</span></div>
        <select id="ptSide" class="ac-select" style="width:100%">${['left', 'right', 'front', 'back', 'top', 'bottom', 'center'].map(s => `<option value="${s}">${s[0].toUpperCase() + s.slice(1)} edge</option>`).join('').replace('Center edge', 'Centre')}</select>
        <div class="ctrl-row" style="margin-top:6px"><span class="ctrl-label">Axis</span></div>
        <select id="ptAxis" class="ac-select" style="width:100%"><option value="auto">Automatic</option><option value="x">Left–right (X)</option><option value="y">Up–down (Y)</option><option value="z">Front–back (Z)</option></select>
        <div id="ptAngleRow"><div class="ctrl-row"><span class="ctrl-label">Opens by</span><span class="ctrl-val" id="ptAngleVal"></span></div><input type="range" id="ptAngle" min="-720" max="720" step="1" style="width:100%"></div>
        <div id="ptDistRow"><div class="ctrl-row"><span class="ctrl-label">Slides by</span><span class="ctrl-val" id="ptDistVal"></span></div><input type="range" id="ptDist" min="-1" max="1" step="0.001" style="width:100%"></div>
        <div id="ptLiftRow"><div class="ctrl-row"><span class="ctrl-label">Lifts by</span><span class="ctrl-val" id="ptLiftVal"></span></div><input type="range" id="ptLift" min="0" max="1" step="0.001" style="width:100%"></div>
        <div id="ptFoodRows">
          <div class="ctrl-row" style="margin-top:6px"><span class="ctrl-label">Picked up with</span></div>
          <select id="ptUtensil" class="ac-select" style="width:100%"><option value="none">Nothing shown (by hand)</option><option value="chopsticks">Chopsticks</option><option value="fork">Fork</option><option value="server">Pie / cake server</option></select>
          <div class="ctrl-row"><span class="ctrl-label">Pulls away by</span><span class="ctrl-val" id="ptReachVal"></span></div><input type="range" id="ptReach" min="0" max="1" step="0.001" style="width:100%">
          <div class="ctrl-row"><span class="ctrl-label">Cheese / filling stretch</span><span class="ctrl-val" id="ptStretchVal"></span></div><input type="range" id="ptStretch" min="0" max="1" step="0.01" style="width:100%">
          <div class="ctrl-row"><span class="ctrl-label">Floppiness (droops)</span><span class="ctrl-val" id="ptDroopVal"></span></div><input type="range" id="ptDroop" min="0" max="1.5" step="0.01" style="width:100%">
        </div>
        <div class="ctrl-row"><span class="ctrl-label">Speed</span><span class="ctrl-val" id="ptDurVal"></span></div>
        <input type="range" id="ptDur" min="0.2" max="6" step="0.1" style="width:100%">
        <div class="ctrl-row" style="margin-top:6px"><span class="ctrl-label">Feel</span></div>
        <select id="ptEase" class="ac-select" style="width:100%"><option value="ease-in-out">Smooth</option><option value="spring">Sprung (little bounce)</option><option value="ease-out">Quick then soft</option><option value="linear">Mechanical</option></select>
        <div class="ctrl-row" style="margin-top:6px"><span class="ctrl-label">On the published page</span></div>
        <select id="ptAuto" class="ac-select" style="width:100%"><option value="none">Opens when clicked (hotspot)</option><option value="once">Opens by itself once</option><option value="loop">Keeps opening and closing</option></select>
        <div id="ptHoldRow"><div class="ctrl-row"><span class="ctrl-label">Pause open / closed</span><span class="ctrl-val" id="ptHoldVal"></span></div><input type="range" id="ptHold" min="0" max="6" step="0.1" style="width:100%"></div>
        <div class="ctrl-row" style="margin-top:6px"><span class="ctrl-label">Try it</span><span class="ctrl-val" id="ptOpenVal">closed</span></div>
        <input type="range" id="ptOpen" min="0" max="1" step="0.01" value="0" style="width:100%">
        <div style="display:flex;gap:6px;margin-top:6px">
          <button type="button" class="ac-btn lime" id="ptPlay" style="flex:1">▶ Open / close</button>
          <button type="button" class="ac-btn" id="ptFlip" style="flex:1" title="Swings or slides the wrong way? Reverse it.">⇄ Other way</button>
          <button type="button" class="ac-btn" id="ptDelete" style="flex:1">Delete part</button>
        </div>
        <button type="button" class="ac-btn full" id="ptReselect" style="margin-top:6px" title="Select the part's area again (lasso, box or outline points), then press this">Area = current selection</button>
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
  // Studio wrote the splats (an edit, a selection): take new geometry when all
  // parts are closed; otherwise put the open parts back where they are.
  window.addEventListener('fumoca:sparkInPlaceUpdate', () => { if (animator && !animator.refreshGeometry?.()) animator.reapply?.(); });
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
    let n = 0; const indices = [];
    for (let i = 0; i < S.selected.length; i++) {
      if (!S.selected[i] || (S.alive && !S.alive[i])) continue;
      n++; indices.push(i);
      for (let k = 0; k < 3; k++) { const v = S.positions[i * 3 + k]; if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v; }
    }
    if (n < 10) return null;
    const pad = Math.max(...max.map((v, i) => v - min[i])) * 0.015;
    return { box: { min: min.map(v => v - pad), max: max.map(v => v + pad) }, n, indices };
  }

  function motionFromKind(kindKey, box) {
    const k = KINDS[kindKey] || KINDS.carDoor;
    const h = suggestHinge(box, k.side || 'center');
    const span = Math.max(...box.max.map((v, i) => v - box.min[i]));
    return {
      type: k.type, pivot: h.pivot, axis: k.axisKey ? AXES[k.axisKey] : h.axis,
      angle: k.angle ?? 0, distance: (k.distanceFrac || 0) * span, lift: (k.liftSpanFrac ? k.liftSpanFrac * span : (k.liftFrac || 0) * (box.max[1] - box.min[1])),
      duration: k.duration, ease: k.ease, side: k.side || 'center', axisKey: k.axisKey || 'auto',
    };
  }

  /**
   * A food piece from the selection: its outline (so a wedge stays a wedge),
   * where it is held, which way it is pulled from the rest, and its size.
   */
  function foodFromSelection(f, box) {
    const S = window.S, idx = [];
    for (let i = 0; i < S.selected.length; i++) if (S.selected[i] && (!S.alive || S.alive[i])) idx.push(i);
    const region = regionFromPoints(S.positions, idx);
    const c = [0, 0, 0]; for (const i of idx) for (let k = 0; k < 3; k++) c[k] += S.positions[i * 3 + k] / idx.length;
    // the dish: everything else nearby (centre of all live splats)
    const all = [0, 0, 0]; let n = 0; const st = Math.max(1, Math.floor(S.alive.length / 30000));
    for (let i = 0; i < S.alive.length; i += st) if (S.alive[i]) { for (let k = 0; k < 3; k++) all[k] += S.positions[i * 3 + k]; n++; }
    for (let k = 0; k < 3; k++) all[k] /= n || 1;
    const size = Math.max(box.max[0] - box.min[0], box.max[2] - box.min[2], 1e-4);
    // pull away from the dish; a piece in the middle comes towards the viewer
    let dir = [c[0] - all[0], 0, c[2] - all[2]];
    if (Math.hypot(dir[0], dir[2]) < size * 0.15 && window.camera) dir = [window.camera.position.x - c[0], 0, window.camera.position.z - c[2]];
    const dl = Math.hypot(dir[0], dir[2]) || 1; dir = [dir[0] / dl, 0, dir[2] / dl];
    const top = region.ymax, bottom = region.ymin;
    const pivot = f.hold === 'bottom' ? [c[0], bottom, c[2]]
      : f.hold === 'crust' ? [c[0] + dir[0] * size * 0.4, (top + bottom) / 2, c[2] + dir[2] * size * 0.4]
      : [c[0], top, c[2]];
    return {
      region,
      motion: {
        type: 'pick', pivot, axis: [0, 1, 0], dir, size, bottom,
        lift: f.lift * size, distance: f.dist * size, angle: f.angle, droop: f.droop, stretch: f.stretch, zone: f.zone * size,
        utensil: f.utensil, side: 'center', axisKey: 'auto',
      },
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
    q('#ptAuto').value = editing.autoplay || 'none'; q('#ptHold').value = editing.hold ?? 1.2;
    if (m.type === 'pick') {
      const sz = m.size || span;
      q('#ptUtensil').value = m.utensil || 'none';
      q('#ptReach').max = 2 * sz; q('#ptReach').step = sz / 500; q('#ptReach').value = m.distance;
      q('#ptStretch').value = m.stretch ?? 0; q('#ptDroop').value = m.droop ?? 0;
    }
    syncEditLabels();
  }

  function syncEditLabels() {
    if (!editing) return;
    const t = q('#ptType').value;
    q('#ptAngleRow').style.display = t === 'slide' ? 'none' : '';
    q('#ptDistRow').style.display = t === 'slide' ? '' : 'none';
    q('#ptLiftRow').style.display = t === 'twist' || t === 'lift' ? '' : 'none';
    q('#ptAngleRow').querySelector('.ctrl-label').textContent = t === 'lift' ? 'Tips by' : t === 'twist' ? 'Turns by' : 'Opens by';
    q('#ptHoldRow').style.display = q('#ptAuto').value === 'loop' ? '' : 'none';
    q('#ptFoodRows').style.display = t === 'pick' ? '' : 'none';
    q('#ptSide').closest('select') && (q('#ptSide').style.display = t === 'pick' ? 'none' : '');
    q('#ptAxis').style.display = t === 'pick' ? 'none' : '';
    if (t === 'pick') {
      q('#ptAngleRow').querySelector('.ctrl-label').textContent = 'Tips by';
      q('#ptLiftRow').style.display = '';
      q('#ptReachVal').textContent = (+q('#ptReach').value).toFixed(3);
      q('#ptStretchVal').textContent = Math.round(+q('#ptStretch').value * 100) + '%';
      q('#ptDroopVal').textContent = Math.round(+q('#ptDroop').value * 100) + '%';
    }
    q('#ptHoldVal').textContent = (+q('#ptHold').value).toFixed(1) + ' s';
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
    editing.autoplay = q('#ptAuto').value; editing.hold = +q('#ptHold').value;
    const t = q('#ptType').value;
    editing.motion = t === 'pick' && editing.motion.type === 'pick'
      ? { ...editing.motion, angle: +q('#ptAngle').value, lift: +q('#ptLift').value, distance: +q('#ptReach').value,
          stretch: +q('#ptStretch').value, droop: +q('#ptDroop').value, utensil: q('#ptUtensil').value,
          duration: +q('#ptDur').value, ease: q('#ptEase').value }
      : {
        ...editing.motion,
        type: t === 'pick' ? 'hinge' : t, side, axisKey, pivot: h.pivot, axis: axisKey === 'auto' ? h.axis : AXES[axisKey],
        angle: +q('#ptAngle').value, distance: +q('#ptDist').value, lift: +q('#ptLift').value,
        duration: +q('#ptDur').value, ease: q('#ptEase').value,
      };
    if (t === 'pick' && editing.motion.type !== 'pick') status('To make food, select the piece and pick a food type above, then “Make part”.');
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

  q('#ptMake').addEventListener('click', async () => {
    if (!sparkMesh()) {
      status('Turning Photoreal (Spark) on — parts move the photoreal splats…');
      if (!(await window.FumocaStudioHooks?.ensureSpark?.())) { status('Photoreal (Spark) could not start on this device — parts need it.'); return; }
      await new Promise(r => setTimeout(r, 600));
    }
    const sel = selectionBox();
    if (!sel) { status('Select the part first (at least a few splats), e.g. with the lasso on the door.'); return; }
    const kind = q('#ptKind').value;
    const base = KINDS[kind];
    let name = base.name, k = 2;
    while (parts.some(p => p.name === name)) name = `${base.name} ${k++}`;
    // Exact area (cells hugging the selected splats), so only what you picked moves.
    const cells = base.type === 'pick' ? null : cellsFromIndices(window.S.positions, sel.indices);
    const part = { id: 'part_' + Date.now().toString(36), name, box: sel.box, ...(cells ? { cells } : {}), motion: motionFromKind(kind, sel.box) };
    if (base.type === 'pick') Object.assign(part, foodFromSelection(base.food, sel.box));
    parts = normalizeParts([...parts, part]).map(p => (p.id === part.id ? { ...p, motion: { ...p.motion, side: part.motion.side, axisKey: part.motion.axisKey } } : p));
    changed();
    edit(part.id);
    // Clear the selection so its dots don't sit on top of the part and hide it moving.
    try { const S = window.S; if (S?.selected) { S.selected.fill(0); window.rebuildGeometry?.(); } } catch (_) {}
    status(`${name} made from ${sel.n.toLocaleString()} selected splats. Press ▶ to try it; adjust the hinge side if it swings the wrong way.`);
  });
  const EDIT_IDS = ['ptName', 'ptType', 'ptSide', 'ptAxis', 'ptAngle', 'ptDist', 'ptLift', 'ptDur', 'ptEase', 'ptAuto', 'ptHold', 'ptUtensil', 'ptReach', 'ptStretch', 'ptDroop'];
  EDIT_IDS.forEach(id =>
    q('#' + id).addEventListener('input', () => { syncEditLabels(); readEdit(); }));
  EDIT_IDS.forEach(id =>
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
  q('#ptReselect').addEventListener('click', () => {
    if (!editing) return;
    const sel = selectionBox();
    if (!sel) { status('Select the part again first (at least a few splats), then press this.'); return; }
    const a = ensureAnimator(); a?.set(editing.id, 0);
    const cells = cellsFromIndices(window.S.positions, sel.indices);
    parts = parts.map(p => (p.id === editing.id ? { ...p, box: sel.box, ...(cells ? { cells } : {}) } : p));
    try { window.S.selected.fill(0); window.rebuildGeometry?.(); } catch (_) {}
    changed(); edit(editing.id);
    status(`${editing.name}: area updated from ${sel.n.toLocaleString()} selected splats.`);
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
    get animator() { return ensureAnimator(); },
    /** Change a part (used when a second scan's door panel is attached). */
    updatePart(id, patch) {
      const i = parts.findIndex(p => p.id === id);
      if (i < 0) return false;
      const next = normalizeParts([{ ...parts[i], ...patch, id }])[0];
      if (!next) return false;
      parts[i] = next; changed(); return true;
    },
    get(id) { const p = parts.find(x => x.id === id); return p ? JSON.parse(JSON.stringify(p)) : null; },
  };
  window.FumocaParts = api;
  return api;
}
