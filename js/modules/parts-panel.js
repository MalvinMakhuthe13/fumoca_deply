/**
 * Studio "Parts" tab: make moving parts from a selection — car doors,
 * bonnet, boot, house doors, drawers, bottle caps, can lids, a reclining
 * couch — and wire them to hotspots in the viewer. CPU only, no AI.
 */
import * as THREE from 'three';
import { PartAnimator, normalizeParts, suggestHinge, cellsFromIndices, MAX_SOUND_BYTES } from './part-animator.js';
import './part-effects.js';   // sounds and mist for parts
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
  // perfume & aerosols: the cap comes off, then a press sprays mist
  perfumeCap: { label: '🧴 Perfume cap (lifts off)', name: 'Perfume cap', type: 'lift', side: 'center', axisKey: 'y', angle: 6, liftSpanFrac: 0.9, ease: 'ease-out', duration: 0.9, group: 'Perfume', order: 1, sound: 'click' },
  perfumeNozzle: { label: '🧴 Perfume nozzle (press → mist)', name: 'Spray nozzle', type: 'slide', axisKey: 'y', distanceFrac: -0.25, ease: 'ease-out', duration: 0.18, group: 'Perfume', order: 2, sound: 'spray', springBack: true, mist: true },
  button:   { label: 'Button / switch (press)', name: 'Button', type: 'slide', axisKey: 'y', distanceFrac: -0.2, ease: 'ease-out', duration: 0.15, sound: 'click', springBack: true },
  // suitcase: zip pull runs round the seam, clasps click, then the lid swings up
  zipPull:  { label: '🧳 Suitcase zip pull (runs round the seam)', name: 'Zip pull', type: 'path', ease: 'ease-in-out', duration: 1.8, group: 'Suitcase', order: 1, sound: 'zip', autoPath: true },
  clasp:    { label: '🧳 Suitcase clasp / latch (clicks open)', name: 'Clasp', type: 'hinge', side: 'top', axisKey: 'x', angle: -45, ease: 'spring', duration: 0.3, group: 'Suitcase', order: 2, sound: 'click' },
  caseLid:  { label: '🧳 Suitcase lid (opens last)', name: 'Suitcase lid', type: 'hinge', side: 'back', axisKey: 'x', angle: -95, ease: 'ease-in-out', duration: 1.6, group: 'Suitcase', order: 3, sound: 'whoosh' },
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
        <select id="ptType" class="ac-select" style="width:100%"><option value="hinge">Swing on a hinge</option><option value="slide">Slide</option><option value="twist">Twist off (caps, lids)</option><option value="lift">Lift off (pot lids)</option><option value="pick">Pick up (food)</option><option value="path">Follow a path (zip pull)</option></select>
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
        <div id="ptPathRows">
          <div class="hint" style="margin-top:6px">The zip pull follows a path. Place outline dots (⬠, O) along the zip, then press “Path = outline dots” — or let Fumoca trace the seam round the case.</div>
          <div style="display:flex;gap:6px;margin-top:4px">
            <button type="button" class="ac-btn" id="ptPathDots" style="flex:1">Path = outline dots</button>
            <button type="button" class="ac-btn" id="ptPathAuto" style="flex:1">Trace the seam</button>
          </div>
          <div class="hint" id="ptPathInfo"></div>
        </div>
        <div class="ctrl-row" style="margin-top:6px"><span class="ctrl-label">Sound</span></div>
        <select id="ptSound" class="ac-select" style="width:100%"><option value="none">No sound</option><option value="click">Click (clasp, latch, button)</option><option value="zip">Zip</option><option value="spray">Spray hiss</option><option value="thunk">Thunk when it shuts</option><option value="whoosh">Whoosh</option></select>
        <div style="margin-top:6px;padding:8px;border:1px dashed rgba(200,255,0,.3);border-radius:8px">
          <div style="display:flex;gap:6px;align-items:center"><span class="ctrl-label" style="flex:1">Your own recording</span><button type="button" class="ac-btn" id="ptSoundUp">＋ Upload</button><input type="file" id="ptSoundFile" accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.webm" hidden></div>
          <div class="hint" id="ptSoundName">Record it yourself and upload it (.mp3 / .wav / .ogg / .m4a, up to 1.5 MB). It replaces the built-in sound and is saved with the asset.</div>
          <div id="ptSoundRows" style="display:none">
            <select id="ptSoundOn" class="ac-select" style="width:100%;margin-top:4px"><option value="open">Plays when it opens</option><option value="close">Plays when it closes</option><option value="both">Plays both ways</option></select>
            <div class="ctrl-row"><span class="ctrl-label">Volume</span><span class="ctrl-val" id="ptSoundVolVal"></span></div><input type="range" id="ptSoundVol" min="0" max="1" step="0.05" style="width:100%">
            <div style="display:flex;gap:6px;margin-top:4px"><button type="button" class="ac-btn" id="ptSoundTry" style="flex:1">▶ Listen</button><button type="button" class="ac-btn" id="ptSoundDel" style="flex:1">Remove</button></div>
          </div>
        </div>
        <label style="display:flex;gap:6px;align-items:center;font-size:11px;margin-top:6px"><input type="checkbox" id="ptSpring"> Springs back by itself (a press: nozzle, button)</label>
        <div class="ctrl-row" style="margin-top:6px"><span class="ctrl-label">Effect</span></div>
        <select id="ptEffect" class="ac-select" style="width:100%"><option value="none">None</option><option value="mist">Mist / spray (perfume, aerosol)</option></select>
        <div id="ptMistRows">
          <div class="ctrl-row"><span class="ctrl-label">Mist sprays toward</span></div>
          <select id="ptMistDir" class="ac-select" style="width:100%"><option value="view">Where I'm looking from now</option><option value="front">Front (+Z)</option><option value="back">Back (−Z)</option><option value="left">Left (−X)</option><option value="right">Right (+X)</option><option value="up">Up</option></select>
          <div style="display:flex;gap:6px;align-items:center;margin-top:4px"><span class="ctrl-label" style="flex:1">Mist colour</span><input type="color" id="ptMistColor" value="#e8f1ff"></div>
          <div class="ctrl-row"><span class="ctrl-label">Amount</span><span class="ctrl-val" id="ptMistAmtVal"></span></div><input type="range" id="ptMistAmt" min="0.05" max="1" step="0.05" style="width:100%">
          <div class="ctrl-row"><span class="ctrl-label">Spread</span><span class="ctrl-val" id="ptMistSpreadVal"></span></div><input type="range" id="ptMistSpread" min="4" max="45" step="1" style="width:100%">
          <button type="button" class="ac-btn full" id="ptMistTry" style="margin-top:4px">💨 Try the mist</button>
        </div>
        <div class="ctrl-row" style="margin-top:6px"><span class="ctrl-label">Plays in a sequence</span></div>
        <div style="display:flex;gap:6px"><input id="ptGroup" class="ac-input" placeholder="e.g. Suitcase (blank = on its own)" style="flex:2;padding:6px 8px" maxlength="30"><input id="ptOrder" class="ac-input" type="number" min="0" max="99" title="Order in the sequence" style="flex:1;padding:6px 8px"></div>
        <div class="hint">Parts with the same sequence name play in order when any of them is clicked (zip → clasps → lid), and close in reverse.</div>
        <button type="button" class="ac-btn full" id="ptPlaySeq" style="margin-top:4px">▶ Play the sequence</button>
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
    // an outline still open (dots placed, not finished): use it
    if (window.FumocaOutline?.points?.() >= 3) window.FumocaOutline.finish();
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

  // How big the whole object is (robust), so a spray carries a believable distance.
  function objectSize() {
    const S = window.S; if (!S?.alive) return 0;
    const st = Math.max(1, Math.floor(S.alive.length / 40000)), xs = [[], [], []];
    for (let i = 0; i < S.alive.length; i += st) if (S.alive[i]) for (let k = 0; k < 3; k++) xs[k].push(S.positions[i * 3 + k]);
    let d = 0; for (let k = 0; k < 3; k++) { xs[k].sort((a, b) => a - b); const e = xs[k][Math.floor(xs[k].length * 0.98)] - xs[k][Math.floor(xs[k].length * 0.02)]; d = Math.max(d, e || 0); }
    return d;
  }
  // Mist leaves the nozzle on the side it sprays from; perfume carries ~2× the bottle.
  function mistFor(part, dirKey) {
    const b = part.box, c = b.min.map((v, i) => (v + b.max[i]) / 2), span = Math.max(...b.max.map((v, i) => v - b.min[i]), 1e-4);
    let dir;
    // same direction as before: keep where it sprays from (only colour / amount / spread change)
    if (part.effect?.type === 'mist' && part.effect._dirKey === dirKey && part.effect.origin && part.effect.dir)
      return { ...part.effect, color: q('#ptMistColor').value, amount: +q('#ptMistAmt').value, spread: +q('#ptMistSpread').value };
    if (dirKey === 'view' && window.camera) {
      dir = [window.camera.position.x - c[0], 0, window.camera.position.z - c[2]];
      const l = Math.hypot(dir[0], dir[2]) || 1; dir = [dir[0] / l, 0, dir[2] / l];
    } else dir = { front: [0, 0, 1], back: [0, 0, -1], left: [-1, 0, 0], right: [1, 0, 0], up: [0, 1, 0] }[dirKey] || part.effect?.dir || [0, 0, 1];
    const half = b.max.map((v, i) => (v - b.min[i]) / 2);
    const origin = c.map((v, i) => v + dir[i] * half[i]);
    return { type: 'mist', origin, dir, color: q('#ptMistColor').value, amount: +q('#ptMistAmt').value, spread: +q('#ptMistSpread').value, reach: Math.max(span * 4, objectSize() * 2), _dirKey: dirKey };
  }
  // The seam of a case: round its outline at the pull's height, starting at the
  // pull and running three sides (a zip-round suitcase), slightly inset.
  function seamPath(part) {
    const S = window.S, lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    const st = Math.max(1, Math.floor(S.alive.length / 60000)), xs = [[], [], []];
    for (let i = 0; i < S.alive.length; i += st) if (S.alive[i] && !S.layerHidden?.[i]) for (let k = 0; k < 3; k++) xs[k].push(S.positions[i * 3 + k]);
    for (let k = 0; k < 3; k++) { xs[k].sort((a, b) => a - b); lo[k] = xs[k][Math.floor(xs[k].length * 0.02)]; hi[k] = xs[k][Math.floor(xs[k].length * 0.98)]; }
    const ext = hi.map((v, i) => v - lo[i]), thin = ext.indexOf(Math.min(...ext));
    const [a, b] = [0, 1, 2].filter(k => k !== thin);
    const pc = part.box.min.map((v, i) => (v + part.box.max[i]) / 2);
    const inset = Math.min(ext[a], ext[b]) * 0.03;
    const A0 = lo[a] + inset, A1 = hi[a] - inset, B0 = lo[b] + inset, B1 = hi[b] - inset;
    const corners = [[A0, B0], [A1, B0], [A1, B1], [A0, B1]];
    const per = 2 * ((A1 - A0) + (B1 - B0));
    // where on the perimeter the pull is
    const along = (pa, pb) => {
      const d = [Math.abs(pb - B0), Math.abs(pa - A1), Math.abs(pb - B1), Math.abs(pa - A0)], side = d.indexOf(Math.min(...d));
      const L = [A1 - A0, B1 - B0, A1 - A0, B1 - B0];
      const off = [Math.max(0, Math.min(L[0], pa - A0)), Math.max(0, Math.min(L[1], pb - B0)), Math.max(0, Math.min(L[2], A1 - pa)), Math.max(0, Math.min(L[3], B1 - pb))][side];
      return L.slice(0, side).reduce((x, y) => x + y, 0) + off;
    };
    const at = (s) => {
      s = ((s % per) + per) % per;
      const L = [A1 - A0, B1 - B0, A1 - A0, B1 - B0];
      for (let k = 0; k < 4; k++) { if (s <= L[k]) { const p = corners[k], q2 = corners[(k + 1) % 4], f = L[k] ? s / L[k] : 0; return [p[0] + (q2[0] - p[0]) * f, p[1] + (q2[1] - p[1]) * f]; } s -= L[k]; }
      return corners[0];
    };
    const s0 = along(pc[a], pc[b]), pts = [];
    for (let k = 0; k <= 48; k++) {
      const [pa, pb] = at(s0 + per * 0.75 * k / 48), p3 = [0, 0, 0];
      p3[a] = pa; p3[b] = pb; p3[thin] = pc[thin];
      pts.push(p3);
    }
    // start exactly at the pull so it doesn't jump
    const d0 = pts[0].map((v, i) => pc[i] - v);
    return pts.map(p => p.map((v, i) => v + d0[i] * Math.max(0, 1 - pts.indexOf(p) / 4)));
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
    q('#ptSound').value = editing.sound || 'none'; q('#ptSpring').checked = !!editing.springBack;
    const sf = editing.soundFile;
    q('#ptSoundRows').style.display = sf ? '' : 'none';
    q('#ptSoundName').textContent = sf ? `🎵 ${sf.name} — replaces the built-in sound` : 'Record it yourself and upload it (.mp3 / .wav / .ogg / .m4a, up to 1.5 MB). It replaces the built-in sound and is saved with the asset.';
    if (sf) { q('#ptSoundOn').value = sf.on || 'open'; q('#ptSoundVol').value = sf.volume ?? 0.9; q('#ptSoundVolVal').textContent = Math.round((sf.volume ?? 0.9) * 100) + '%'; }
    q('#ptGroup').value = editing.group || ''; q('#ptOrder').value = editing.order ?? 0;
    const ef = editing.effect;
    q('#ptEffect').value = ef?.type || 'none';
    q('#ptMistColor').value = ef?.color || '#e8f1ff'; q('#ptMistAmt').value = ef?.amount ?? 0.6; q('#ptMistSpread').value = ef?.spread ?? 16;
    q('#ptMistDir').value = ef?._dirKey || 'view';
    q('#ptPathInfo').textContent = m.type === 'path' ? (m.points?.length >= 2 ? `Path: ${m.points.length} points` : 'No path yet') : '';
    // remember what the hinge controls showed, so only a real change moves the hinge
    editing._shown = { side: q('#ptSide').value, axisKey: q('#ptAxis').value };
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
    q('#ptPathRows').style.display = t === 'path' ? '' : 'none';
    if (t === 'path') { q('#ptAngleRow').style.display = 'none'; q('#ptSide').style.display = 'none'; q('#ptAxis').style.display = 'none'; }
    q('#ptMistRows').style.display = q('#ptEffect').value === 'mist' ? '' : 'none';
    q('#ptMistAmtVal').textContent = Math.round(+q('#ptMistAmt').value * 100) + '%';
    q('#ptMistSpreadVal').textContent = Math.round(+q('#ptMistSpread').value) + '°';
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
    // a measured hinge (from two scans) or one set earlier stays unless the
    // hinge side / axis controls were actually changed
    const hingeChanged = !editing._shown || editing._shown.side !== side || editing._shown.axisKey !== axisKey;
    const h = hingeChanged ? suggestHinge(editing.box, side) : { pivot: editing.motion.pivot, axis: editing.motion.axis };
    editing._shown = { side, axisKey };
    editing.sound = q('#ptSound').value; editing.springBack = q('#ptSpring').checked;
    if (editing.soundFile) { editing.soundFile = { ...editing.soundFile, on: q('#ptSoundOn').value, volume: +q('#ptSoundVol').value }; q('#ptSoundVolVal').textContent = Math.round(+q('#ptSoundVol').value * 100) + '%'; }
    editing.group = q('#ptGroup').value.trim().slice(0, 30); editing.order = Math.max(0, Math.min(99, Math.round(+q('#ptOrder').value || 0)));
    editing.effect = q('#ptEffect').value === 'mist' ? mistFor(editing, q('#ptMistDir').value) : undefined;
    editing.name = q('#ptName').value.trim().slice(0, 60) || 'Part';
    editing.autoplay = q('#ptAuto').value; editing.hold = +q('#ptHold').value;
    const t = q('#ptType').value;
    editing.motion = t === 'pick' && editing.motion.type === 'pick'
      ? { ...editing.motion, angle: +q('#ptAngle').value, lift: +q('#ptLift').value, distance: +q('#ptReach').value,
          stretch: +q('#ptStretch').value, droop: +q('#ptDroop').value, utensil: q('#ptUtensil').value,
          duration: +q('#ptDur').value, ease: q('#ptEase').value }
      : {
        ...editing.motion,
        type: t === 'pick' ? 'hinge' : t, side, axisKey, pivot: h.pivot, axis: !hingeChanged ? h.axis : axisKey === 'auto' ? h.axis : AXES[axisKey],
        angle: +q('#ptAngle').value, distance: +q('#ptDist').value, lift: +q('#ptLift').value,
        duration: +q('#ptDur').value, ease: q('#ptEase').value,
      };
    if (t === 'pick' && editing.motion.type !== 'pick') status('To make food, select the piece and pick a food type above, then “Make part”.');
    parts = normalizeParts(parts.map(p => (p.id === editing.id ? editing : p))).map((p) => {
      const src = p.id === editing.id ? editing : parts.find(x => x.id === p.id);
      return { ...p, motion: { ...p.motion, side: src?.motion?.side, axisKey: src?.motion?.axisKey }, ...(src?.effect ? { effect: { ...p.effect, _dirKey: src.effect._dirKey } } : {}) };
    });
    const shown = editing._shown;
    editing = parts.find(p => p.id === editing.id);
    editing._shown = shown;
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
    // the experience that comes with this kind: sequence, sound, press, mist, zip path
    if (base.group) { part.group = base.group; part.order = base.order ?? 0; }
    if (base.sound) part.sound = base.sound;
    if (base.springBack) part.springBack = true;
    if (base.mist) { part.effect = { type: 'mist' }; part.effect = (() => { const b = sel.box, c = b.min.map((v, i) => (v + b.max[i]) / 2), span = Math.max(...b.max.map((v, i) => v - b.min[i]), 1e-4); let dir = [0, 0, 1]; if (window.camera) { dir = [window.camera.position.x - c[0], 0, window.camera.position.z - c[2]]; const l = Math.hypot(dir[0], dir[2]) || 1; dir = [dir[0] / l, 0, dir[2] / l]; } const half = b.max.map((v, i) => (v - b.min[i]) / 2); return { type: 'mist', origin: c.map((v, i) => v + dir[i] * half[i]), dir, color: '#e8f1ff', amount: 0.6, spread: 16, reach: Math.max(span * 4, objectSize() * 2), _dirKey: 'view' }; })(); }
    if (base.autoPath) part.motion.points = seamPath(part);
    parts = normalizeParts([...parts, part]).map(p => (p.id === part.id ? { ...p, motion: { ...p.motion, side: part.motion.side, axisKey: part.motion.axisKey } } : p));
    changed();
    edit(part.id);
    // Clear the selection so its dots don't sit on top of the part and hide it moving.
    try { const S = window.S; if (S?.selected) { S.selected.fill(0); window.rebuildGeometry?.(); } } catch (_) {}
    status(`${name} made from ${sel.n.toLocaleString()} selected splats. Press ▶ to try it; adjust the hinge side if it swings the wrong way.`);
  });
  const EDIT_IDS = ['ptName', 'ptType', 'ptSide', 'ptAxis', 'ptAngle', 'ptDist', 'ptLift', 'ptDur', 'ptEase', 'ptAuto', 'ptHold', 'ptUtensil', 'ptReach', 'ptStretch', 'ptDroop',
    'ptSound', 'ptSoundOn', 'ptSoundVol', 'ptSpring', 'ptEffect', 'ptMistDir', 'ptMistColor', 'ptMistAmt', 'ptMistSpread', 'ptGroup', 'ptOrder'];
  // zip path
  q('#ptPathDots').addEventListener('click', () => {
    if (!editing) return;
    const S = window.S, dots = (S?.outlinePts || []).map(v => [v.x, v.y, v.z]);
    if (dots.length < 2) { status('Place at least 2 outline dots (⬠ tool, O) along the zip first — don’t finish the outline.'); return; }
    // start the path where the pull is
    const c = editing.box.min.map((v, i) => (v + editing.box.max[i]) / 2);
    const d0 = Math.hypot(...dots[0].map((v, i) => v - c[i])), d1 = Math.hypot(...dots[dots.length - 1].map((v, i) => v - c[i]));
    const pts = d1 < d0 ? dots.reverse() : dots;
    pts.unshift(c);
    updatePathOf(editing.id, pts);
    window.FumocaOutline?.cancel?.();
    status(`Zip path set from ${dots.length} dots. Press ▶ to run it.`);
  });
  q('#ptPathAuto').addEventListener('click', () => {
    if (!editing) return;
    updatePathOf(editing.id, seamPath(editing));
    status('Traced the seam round the case from the zip pull. Press ▶ to run it.');
  });
  function updatePathOf(id, pts) {
    parts = normalizeParts(parts.map(p => (p.id === id ? { ...p, motion: { ...p.motion, type: 'path', points: pts } } : p)))
      .map(p => { const old = parts.find(x => x.id === p.id); return { ...p, motion: { ...p.motion, side: old?.motion?.side, axisKey: old?.motion?.axisKey } }; });
    changed(); edit(id);
  }
  // your own recording
  q('#ptSoundUp').addEventListener('click', () => q('#ptSoundFile').click());
  q('#ptSoundFile').addEventListener('change', async (e) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f || !editing) return;
    if (f.size > MAX_SOUND_BYTES) { status(`“${f.name}” is over 1.5 MB — trim it or export it as .mp3 / .m4a.`); return; }
    const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('read')); r.readAsDataURL(f); }).catch(() => null);
    if (!dataUrl || !/^data:audio\//.test(dataUrl)) { status('That file is not an audio file this browser can read.'); return; }
    const fx = await import('./part-effects.js');
    const ok = await fx.playRecording({ name: f.name, dataUrl, volume: 0.9 });
    if (!ok) { status(`This browser couldn’t play “${f.name}” — try .mp3 or .wav.`); return; }
    setPartField(editing.id, { soundFile: { name: f.name, dataUrl, on: 'open', volume: 0.9 } });
    status(`🎵 ${f.name} added — it plays when this part opens.`);
  });
  q('#ptSoundTry').addEventListener('click', async () => { if (editing?.soundFile) (await import('./part-effects.js')).playRecording(editing.soundFile); });
  q('#ptSoundDel').addEventListener('click', () => { if (!editing) return; setPartField(editing.id, { soundFile: undefined }); status('Recording removed — the built-in sound is used again.'); });
  function setPartField(id, patch) {
    const shown = editing?._shown;
    parts = normalizeParts(parts.map(p => (p.id === id ? { ...p, ...patch } : p)))
      .map(p => { const old = parts.find(x => x.id === p.id); return { ...p, motion: { ...p.motion, side: old?.motion?.side, axisKey: old?.motion?.axisKey }, ...(old?.effect?._dirKey && p.effect ? { effect: { ...p.effect, _dirKey: old.effect._dirKey } } : {}) }; });
    changed(); edit(id); if (editing) editing._shown = shown;
  }
  q('#ptMistTry').addEventListener('click', async () => {
    if (!editing) return;
    readEdit();
    const mesh = sparkMesh(); if (!mesh) { status('Turn Photoreal (Spark) on to see the mist.'); return; }
    const ef = editing.effect || mistFor(editing, q('#ptMistDir').value);
    const fx = await import('./part-effects.js');
    fx.sounds.spray(0.9); fx.sprayMist(THREE, mesh, ef);
  });
  q('#ptPlaySeq').addEventListener('click', () => {
    if (!editing?.group) { status('Give this part a sequence name first (e.g. Suitcase), and the same name to the others.'); return; }
    const a = ensureAnimator(); if (!a) { status('Turn Photoreal (Spark) on to play parts.'); return; }
    a.runSequence(editing.group, 'toggle', { by: 'studio' });
  });
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
    /** Add a part made elsewhere (e.g. found from an open and a closed scan). Returns its id. */
    addPart(part) {
      let name = part.name || 'Part', k = 2;
      while (parts.some(p => p.name === name)) name = `${part.name || 'Part'} ${k++}`;
      const next = normalizeParts([{ ...part, name, id: part.id || 'part_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5) }])[0];
      if (!next) return null;
      parts = [...parts, next]; changed(); renderList();
      return next.id;
    },
  };
  window.FumocaParts = api;
  return api;
}
