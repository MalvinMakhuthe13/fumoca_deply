/**
 * Studio "Inside" tab: link a second scan of the same object — a car's
 * cabin, a house's rooms, a fridge / wardrobe / cupboard with its doors open —
 * line it up, blend it, attach opened doors' inner panels to their parts, and
 * have the inside fade in as the doors open.
 */
import * as THREE from 'three';
import {
  similarityFromPairs, refineAlignment, estimateSpacing, transformSplats, findDoubles, colourMatch, applyColourMatch,
  findPartOpening, attachToPart, robustBounds, looseSplats, boxIndices, maskToRanges, normalizeLinks, rangesToIndices,
  InsideReveal, pickSplat, pairError, applyT, snapPointToPlane, composeT,
} from './scan-link.js';
import { findMovingParts } from './scan-states.js';
import { cellsFromIndices } from './part-animator.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const css = 'width:100%;padding:6px 8px;border-radius:6px;border:1px solid rgba(255,255,255,.12);background:rgba(0,0,0,.3);color:inherit;font-size:12px';
const wait = () => new Promise(r => setTimeout(r, 30));

export function mountLinkPanel(container, { onStatus } = {}) {
  if (!container) return null;
  container.innerHTML = `
    <div class="section">
      <div class="sec-head"><span class="sec-label">Inside &amp; open-door scans</span><span class="sec-badge">NEW</span></div>
      <div class="sec-body" style="padding:10px">
        <div class="hint">Scan the object twice: closed (this scan), then with doors open or from inside. Link the second scan here and the inside shows when a door opens — cars, houses, fridges, wardrobes, cupboards.</div>
        <button type="button" class="ac-btn lime full" id="lnAdd" style="margin-top:6px">＋ Add the second scan</button>
        <select id="lnLayer" style="${css};margin-top:6px"></select>
        <select id="lnKind" style="${css};margin-top:6px">
          <option value="inside">It's the inside (cabin, rooms, inside the fridge)</option>
          <option value="open">It's the object with doors / lids open</option>
        </select>
      </div>
    </div>
    <div class="section">
      <div class="sec-head"><span class="sec-label">① Line it up</span></div>
      <div class="sec-body" style="padding:10px">
        <div class="hint">Click a spot on this scan, then the same spot on the second scan. 4 pairs spread over the object work best (badge, mirror base, wheel centre, door handle; window corners in a house).</div>
        <button type="button" class="ac-btn full" id="lnPick" style="margin-top:6px">🎯 Pick matching points</button>
        <div id="lnPairs" style="margin-top:6px;font-size:11px"></div>
        <label style="display:flex;gap:6px;align-items:center;font-size:11px;margin-top:6px"><input type="checkbox" id="lnScale" checked> The scans may be different sizes</label>
        <button type="button" class="ac-btn lime full" id="lnAlign" style="margin-top:6px">Line up</button>
        <button type="button" class="ac-btn full" id="lnSnap" style="margin-top:6px">Snap tighter</button>
      </div>
    </div>
    <div class="section">
      <div class="sec-head"><span class="sec-label">Compare the two states</span></div>
      <div class="sec-body" style="padding:10px">
        <div class="hint">Overlay the scans to judge the fit: slide between this scan and the second, or show both with the second see-through.</div>
        <div class="ctrl-row" style="margin-top:6px"><span class="ctrl-label">This scan ⟷ second</span><span class="ctrl-val" id="lnMixVal">off</span></div>
        <input type="range" id="lnMix" min="0" max="100" value="50" style="width:100%">
        <label style="display:flex;gap:6px;align-items:center;font-size:11px;margin-top:4px"><input type="checkbox" id="lnTint" checked> Tint the second scan orange</label>
        <div style="display:flex;gap:6px;margin-top:6px">
          <button type="button" class="ac-btn lime" id="lnCompare" style="flex:1">Compare</button>
          <button type="button" class="ac-btn" id="lnFlip" style="flex:1" title="Jump between this scan and the second">⇄ Flip</button>
          <button type="button" class="ac-btn" id="lnCompareOff" style="flex:1">Done</button>
        </div>
      </div>
    </div>
    <div class="section">
      <div class="sec-head"><span class="sec-label">Fine-tune by hand</span></div>
      <div class="sec-body" style="padding:10px">
        <div class="hint">Where the points don't quite line up, nudge the second scan. Moves follow your view (left / right as you see it). Hold a button to keep going. Compare above while you nudge.</div>
        <select id="lnStep" style="${css};margin-top:6px">
          <option value="fine">Fine steps</option>
          <option value="normal" selected>Normal steps</option>
          <option value="coarse">Big steps</option>
        </select>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px;margin-top:6px" id="lnNudge">
          <button type="button" class="ac-btn" data-n="up">↑ Up</button>
          <button type="button" class="ac-btn" data-n="fwd">⤒ Away</button>
          <button type="button" class="ac-btn" data-n="yawL">⟲ Turn</button>
          <button type="button" class="ac-btn" data-n="left">← Left</button>
          <button type="button" class="ac-btn" data-n="right">Right →</button>
          <button type="button" class="ac-btn" data-n="yawR">Turn ⟳</button>
          <button type="button" class="ac-btn" data-n="down">↓ Down</button>
          <button type="button" class="ac-btn" data-n="back">⤓ Closer</button>
          <button type="button" class="ac-btn" data-n="tiltF">Tilt ⤵</button>
          <button type="button" class="ac-btn" data-n="rollL">↶ Roll</button>
          <button type="button" class="ac-btn" data-n="rollR">Roll ↷</button>
          <button type="button" class="ac-btn" data-n="tiltB">Tilt ⤴</button>
          <button type="button" class="ac-btn" data-n="smaller">− Smaller</button>
          <button type="button" class="ac-btn" data-n="bigger">＋ Bigger</button>
          <button type="button" class="ac-btn" id="lnSelectLink" title="Select the second scan, then use the Move / Rotate tools">Select it</button>
        </div>
        <div class="hint" id="lnNudgeInfo" style="margin-top:4px"></div>
      </div>
    </div>
    <div class="section">
      <div class="sec-head"><span class="sec-label">Find what moved</span><span class="sec-badge">AUTO</span></div>
      <div class="sec-body" style="padding:10px">
        <div class="hint">For an open-state scan (doors / lids / drawers open): once lined up, Fumoca compares the two states, finds each part that moved and exactly how — hinge, angle, slide or twist — makes it a part, joins the open scan's panel to it and keeps the inside it revealed. Works on any object.</div>
        <button type="button" class="ac-btn lime full" id="lnFindMoved" style="margin-top:6px">🔍 Find what moved</button>
      </div>
    </div>
    <div class="section">
      <div class="sec-head"><span class="sec-label">② Blend</span></div>
      <div class="sec-body" style="padding:10px;display:grid;gap:6px">
        <button type="button" class="ac-btn full" id="lnColour">Match colours</button>
        <button type="button" class="ac-btn full" id="lnDoubles">Remove doubles (surfaces both scans saw)</button>
      </div>
    </div>
    <div class="section">
      <div class="sec-head"><span class="sec-label">③ Doors &amp; lids</span></div>
      <div class="sec-body" style="padding:10px">
        <div class="hint">In the second scan, select an opened door (inside and out), pick its part, and attach. Fumoca finds how far it was open, puts it back closed, drops the outer skin this scan already has and keeps the inner panel — so it shows when the door swings.</div>
        <select id="lnPart" style="${css};margin-top:6px"></select>
        <button type="button" class="ac-btn full" id="lnAttach" style="margin-top:6px">Attach selection to this part</button>
      </div>
    </div>
    <div class="section">
      <div class="sec-head"><span class="sec-label">④ Show the inside</span></div>
      <div class="sec-body" style="padding:10px">
        <select id="lnReveal" style="${css}">
          <option value="opened">Only when a door opens (fades in)</option>
          <option value="always">Always</option>
        </select>
        <div id="lnWith" style="margin-top:6px;font-size:11px"></div>
        <button type="button" class="ac-btn full" id="lnClean" style="margin-top:6px">Clean loose splats around the openings</button>
        <label style="display:flex;gap:6px;align-items:center;font-size:11px;margin-top:6px"><input type="checkbox" id="lnPreview"> Preview the reveal here (then open a part)</label>
      </div>
    </div>
    <div class="hint" id="lnStatus" role="status" style="margin:8px 10px"></div>`;

  const q = (s) => container.querySelector(s);
  const status = (m) => { q('#lnStatus').textContent = m; onStatus?.(m); };
  const S = () => window.S;
  const hooks = () => window.FumocaStudioHooks || {};

  // links in Studio: { id, name, kind, reveal, revealWith, mask (S-index), layerId }
  let links = [], active = null, pairs = [], picking = false, pickSide = 'base', reveal = null, markers = null;

  const layers = () => (S()?.layers || []);
  const cur = () => links.find(l => l.id === active) || null;
  const maskOf = (l) => {
    const n = S()?.alive?.length || 0;
    if (!l) return new Uint8Array(n);
    if (l.mask.length !== n) { const m = new Uint8Array(n); m.set(l.mask.subarray(0, Math.min(n, l.mask.length))); l.mask = m; }
    return l.mask;
  };
  const indicesOf = (on) => { const s = S(), out = []; const m = maskOf(cur()); for (let i = 0; i < s.alive.length; i++) if (s.alive[i] && !!m[i] === on) out.push(i); return out; };
  const changed = () => window.dispatchEvent(new CustomEvent('fumoca:linksChange'));
  const unit = (d) => { const mult = +document.getElementById('measureMultiplier')?.value || 0; const u = document.getElementById('measureUnit')?.value; return mult && u && u !== 'units' ? `${(d * mult).toPrecision(3)} ${u}` : `${d.toPrecision(3)} units`; };

  function linkFromLayer(layerId) {
    const L = layers().find(x => x.id === layerId);
    if (!L) return null;
    let l = links.find(x => x.layerId === layerId);
    if (!l) {
      l = { id: 'link' + Date.now().toString(36), name: L.name || 'Second scan', kind: q('#lnKind').value, reveal: 'opened', revealWith: [], layerId, mask: Uint8Array.from(L.mask) };
      links.push(l);
    }
    active = l.id; pairs = []; renderAll(); changed();
    return l;
  }

  function renderAll() {
    const ls = layers();
    const opts = ['<option value="">Choose the second scan…</option>']
      .concat(links.filter(l => !l.layerId).map(l => `<option value="link:${esc(l.id)}" ${l.id === active ? 'selected' : ''}>${esc(l.name)} (saved)</option>`))
      .concat(ls.slice(1).map(L => { const l = links.find(x => x.layerId === L.id); return `<option value="${esc(L.id)}" ${l && l.id === active ? 'selected' : ''}>${esc(L.name || L.id)}</option>`; }));
    q('#lnLayer').innerHTML = opts.join('');
    const l = cur();
    if (l) { q('#lnKind').value = l.kind; q('#lnReveal').value = l.reveal; }
    const parts = window.FumocaParts?.list?.() || [];
    q('#lnPart').innerHTML = parts.length ? parts.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('') : '<option value="">Make the doors in the Parts tab first</option>';
    q('#lnWith').innerHTML = !l ? '' : parts.length
      ? '<div style="opacity:.7;margin-bottom:4px">Fade in when these open:</div>' + parts.map(p => `<label style="display:flex;gap:6px;align-items:center"><input type="checkbox" data-with="${esc(p.id)}" ${l.revealWith.includes(p.id) ? 'checked' : ''}> ${esc(p.name)}</label>`).join('')
      : '<div style="opacity:.7">Make the doors / lids in the Parts tab, then tick them here.</div>';
    q('#lnWith').querySelectorAll('[data-with]').forEach(el => el.addEventListener('change', () => {
      const id = el.dataset.with;
      l.revealWith = el.checked ? [...new Set([...l.revealWith, id])] : l.revealWith.filter(x => x !== id);
      changed(); restartPreview();
    }));
    renderPairs();
  }

  function renderPairs() {
    const rows = pairs.map((p, i) => `<div style="display:flex;gap:6px;align-items:center;margin-bottom:3px">
      <span style="color:#c8ff00;font-weight:800">${i + 1}</span><span style="flex:1;opacity:.8">${p.base ? 'this scan ✓' : '—'} · ${p.link ? 'second ✓' : 'click the same spot on the second scan'}</span>
      <button type="button" class="ac-btn" data-del="${i}" style="padding:2px 6px">✕</button></div>`).join('');
    q('#lnPairs').innerHTML = rows || '<div style="opacity:.6">No pairs yet.</div>';
    q('#lnPairs').querySelectorAll('[data-del]').forEach(el => el.addEventListener('click', () => { pairs.splice(+el.dataset.del, 1); renderPairs(); drawMarkers(); }));
    q('#lnPick').textContent = picking ? `⏹ Stop picking (next: ${pickSide === 'base' ? 'this scan' : 'second scan'})` : '🎯 Pick matching points';
  }

  function drawMarkers() {
    const scene = window.scene || window._fumocaScene;
    if (!scene) return;
    if (!markers) {
      markers = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ size: 11, sizeAttenuation: false, vertexColors: true, depthTest: false, transparent: true }));
      markers.name = 'fumoca-link-markers'; markers.renderOrder = 50; scene.add(markers);
    }
    const P = [], C = [];
    for (const p of pairs) {
      if (p.base) { P.push(...p.base); C.push(0.78, 1, 0); }
      if (p.link) { P.push(...p.link); C.push(1, 0.55, 0.1); }
    }
    markers.geometry.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    markers.geometry.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
    markers.geometry.computeBoundingSphere();
    markers.visible = P.length > 0;
  }

  // picking: a click (not a drag) on the viewport while picking
  let down = null;
  const canvas = () => window.renderer?.domElement;
  function onDown(e) { if (picking) down = { x: e.clientX, y: e.clientY }; }
  function onUp(e) {
    if (!picking || !down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y); down = null;
    if (moved > 5) return;
    const s = S(), l = cur(), el = canvas();
    if (!s?.positions || !l || !el) return;
    const r = el.getBoundingClientRect(), m = maskOf(l), want = pickSide === 'link';
    const hit = pickSplat(s.positions, s.alive.length, (i) => s.alive[i] && !s.layerHidden?.[i] && !!m[i] === want, window.camera, e.clientX - r.left, e.clientY - r.top, r.width, r.height);
    if (!hit) { status(`Nothing of the ${want ? 'second' : 'first'} scan under the cursor — zoom in and click on its surface.`); return; }
    e.stopPropagation();
    if (!want) pairs.push({ base: hit.point, link: null });
    else { const open = pairs.find(p => !p.link) || pairs[pairs.length - 1]; if (open) open.link = hit.point; }
    pickSide = want ? 'base' : 'link';
    renderPairs(); drawMarkers();
    const done = pairs.filter(p => p.base && p.link).length;
    status(want ? `Pair ${done} set. ${done >= 3 ? 'Add one more, or press “Line up”.' : 'Next: a spot on this scan.'}` : 'Now click the same spot on the second scan.');
  }
  function setPicking(on) {
    picking = on;
    const el = canvas();
    if (el && on && !el._lkBound) { el.addEventListener('pointerdown', onDown, true); el.addEventListener('pointerup', onUp, true); el._lkBound = true; }
    if (on) { hooks().setMode?.('orbit'); pickSide = pairs.length && !pairs[pairs.length - 1].link ? 'link' : 'base'; status('Click a spot on this scan.'); }
    renderPairs();
  }

  async function busy(label, fn) {
    status(label + '…'); await wait();
    // guidance ("choose the second scan first") is shown, not logged as an error
    try { await fn(); } catch (e) { if (!(e instanceof Error) || e.stack?.includes('similarityFromPairs') || !/first|select|make|pick|could not|not enough|barely/i.test(e.message)) console.warn('[Inside]', e); status(e.message || String(e)); }
  }

  async function commit(label) {
    status(label + ' — redrawing…'); await wait();
    await hooks().commit?.();
    restartPreview();
    changed();
  }

  // ── actions ──
  q('#lnAdd').addEventListener('click', () => {
    if (!S()?.alive) { status('Open the first scan (closed) first.'); return; }
    document.getElementById('addSplatInput')?.click();
  });
  window.addEventListener('fumoca:splatAdded', () => {
    const L = layers()[layers().length - 1];
    if (L && layers().length > 1) { linkFromLayer(L.id); status(`“${L.name}” linked. Now pick matching points to line it up.`); }
  });
  q('#lnLayer').addEventListener('change', () => {
    const v = q('#lnLayer').value;
    if (v.startsWith('link:')) { active = v.slice(5); pairs = []; renderAll(); return; }
    if (v) linkFromLayer(v);
  });
  q('#lnKind').addEventListener('change', () => { const l = cur(); if (l) { l.kind = q('#lnKind').value; changed(); } });
  q('#lnReveal').addEventListener('change', () => { const l = cur(); if (l) { l.reveal = q('#lnReveal').value; changed(); restartPreview(); } });
  q('#lnPick').addEventListener('click', () => { if (!cur()) { status('Choose the second scan first.'); return; } setPicking(!picking); });

  q('#lnAlign').addEventListener('click', () => busy('Lining up', async () => {
    const l = cur(); if (!l) throw new Error('Choose the second scan first.');
    const done = pairs.filter(p => p.base && p.link);
    if (done.length < 3) throw new Error('Pick at least 3 matching pairs first.');
    const T0 = similarityFromPairs(done.map(p => p.link), done.map(p => p.base), { scale: q('#lnScale').checked });
    const pickErr = pairError(T0, done.map(p => p.link), done.map(p => p.base));
    const s = S(), base = indicesOf(false), link = indicesOf(true);
    const sp = estimateSpacing(s.positions, base);
    status('Matched the points — snapping onto the surfaces both scans saw…'); await wait();
    const fit = refineAlignment(s.positions, base, link, T0, { spacing: sp, scale: q('#lnScale').checked });
    let T = fit.overlap > 0.03 && fit.rms < Math.max(pickErr, sp * 4) ? fit.T : T0;
    hooks().pushHistory?.('Line up second scan');
    transformSplats(s, link, T);
    if (T === fit.T) {   // then tighten on the surfaces (point-to-plane)
      const tight = snapFit(s, base, link, sp);
      if (tight.overlap > 0.05 && tight.rms <= fit.rms * 1.2) { transformSplats(s, link, tight.T); T = composeT(tight.T, T); fit.rms = tight.rms; }
    }
    for (const p of pairs) if (p.link) p.link = applyT(T, p.link);
    l.spacing = sp; drawMarkers(); setPicking(false);
    await commit('Lined up');
    status(T === fit.T
      ? `Lined up. Surfaces sit within about ${unit(fit.rms)} (${Math.round(fit.overlap * 100)} % of the second scan overlaps this one).`
      : `Lined up from your points (within about ${unit(pickErr)}). The scans share little surface, so snapping was skipped.`);
  }));

  q('#lnSnap').addEventListener('click', () => busy('Snapping', async () => {
    const l = cur(); if (!l) throw new Error('Choose the second scan first.');
    const s = S(), base = indicesOf(false), link = indicesOf(true);
    const sp = l.spacing || estimateSpacing(s.positions, base);
    const fit = snapFit(s, base, link, sp);
    if (fit.overlap < 0.03) throw new Error('The scans barely touch — line them up from matching points first.');
    hooks().pushHistory?.('Snap second scan');
    transformSplats(s, link, fit.T);
    await commit('Snapped');
    status(`Snapped — surfaces within about ${unit(fit.rms)}.`);
  }));

  q('#lnColour').addEventListener('click', () => busy('Matching colours', async () => {
    const l = cur(); if (!l) throw new Error('Choose the second scan first.');
    const s = S(), base = indicesOf(false), link = indicesOf(true);
    const sp = l.spacing || estimateSpacing(s.positions, base);
    const m = colourMatch(s.positions, s.colors, base, link, sp * 2.5);
    if (!m) throw new Error('Not enough shared surface to compare colours — line the scans up first.');
    hooks().pushHistory?.('Match colours');
    applyColourMatch(s, link, m);
    await commit('Colours matched');
    status(`Colours matched on ${m.samples.toLocaleString()} shared spots.`);
  }));

  q('#lnDoubles').addEventListener('click', () => busy('Finding doubles', async () => {
    const l = cur(); if (!l) throw new Error('Choose the second scan first.');
    const s = S(), base = indicesOf(false), link = indicesOf(true);
    const sp = l.spacing || estimateSpacing(s.positions, base);
    const dbl = findDoubles(s.positions, base, link, sp * 2.5);
    hooks().pushHistory?.('Remove doubles');
    for (const i of dbl) s.alive[i] = 0;
    await commit('Doubles removed');
    status(`Removed ${dbl.length.toLocaleString()} splats this scan already had.`);
  }));

  q('#lnAttach').addEventListener('click', () => busy('Attaching', async () => {
    const l = cur(); if (!l) throw new Error('Choose the second scan first.');
    const P = window.FumocaParts, id = q('#lnPart').value, part = id && P?.get?.(id);
    if (!part) throw new Error('Make the door in the Parts tab first, then pick it here.');
    const s = S(), m = maskOf(l);
    const open = []; for (let i = 0; i < s.alive.length; i++) if (s.alive[i] && s.selected?.[i] && m[i]) open.push(i);
    if (open.length < 50) throw new Error('Select the opened door in the second scan first.');
    const closed = boxIndices(s, part.box).filter(i => !m[i]);
    if (closed.length < 50) throw new Error('This part has no splats of the first scan — check its box in the Parts tab.');
    const sp = l.spacing || estimateSpacing(s.positions, indicesOf(false));
    const found = findPartOpening(s.positions, part, closed, open, sp * 2);
    if (found.score < 0.2) throw new Error('Could not match the selection to this part — check the part and that the scans are lined up.');
    hooks().pushHistory?.('Attach door panel');
    const res = attachToPart(s, part, closed, open, found.t, sp * 2);
    for (const i of res.attached) m[i] = 0;   // rides with the door, not faded with the inside
    const b = robustBounds(s.positions, res.attached.length > 30 ? [...res.attached, ...closed] : closed);
    P.updatePart(id, { box: { min: b.min.map((v, k) => Math.min(v, part.box.min[k])), max: b.max.map((v, k) => Math.max(v, part.box.max[k])) } });
    if (!l.revealWith.includes(id)) l.revealWith.push(id);
    await commit('Attached');
    const deg = part.motion.type === 'slide' ? `${(found.t * part.motion.distance).toPrecision(3)} units` : `${Math.round(found.t * part.motion.angle)}°`;
    status(`It was open ${deg}. Attached ${res.attached.length.toLocaleString()} splats of the inner panel to “${part.name}”, removed ${res.removed.length.toLocaleString()} doubles of the outer skin.`);
  }));

  q('#lnClean').addEventListener('click', () => busy('Cleaning', async () => {
    const l = cur(); if (!l) throw new Error('Choose the second scan first.');
    const P = window.FumocaParts, ids = l.revealWith.length ? l.revealWith : (P?.list?.() || []).map(p => p.id);
    if (!ids.length) throw new Error('Make the doors in the Parts tab first.');
    const s = S(), sp = l.spacing || estimateSpacing(s.positions, indicesOf(false));
    const gone = new Set();
    for (const id of ids) { const part = P.get(id); if (!part) continue; for (const i of looseSplats(s, boxIndices(s, part.box, 0.25), sp)) gone.add(i); }
    hooks().pushHistory?.('Clean openings');
    for (const i of gone) s.alive[i] = 0;
    await commit('Cleaned');
    status(`Removed ${gone.size.toLocaleString()} loose, foggy splats around the openings.`);
  }));

  // Snap: surfaces both scans saw pulled tight. Starts wide (a few % of the
  // object) so a rough hand / point alignment still converges.
  function snapFit(s, base, link, sp) {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let k = 0; k < link.length; k += Math.max(1, Math.floor(link.length / 5000))) { const i = link[k]; for (let j = 0; j < 3; j++) { const v = s.positions[i * 3 + j]; if (v < lo[j]) lo[j] = v; if (v > hi[j]) hi[j] = v; } }
    const diag = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1;
    // point-to-plane: corrects turns and shifts even on smooth, plain panels
    return snapPointToPlane(s.positions, base, link, { R: [1, 0, 0, 0, 1, 0, 0, 0, 1], s: 1, t: [0, 0, 0], q: [1, 0, 0, 0] },
      { spacing: sp, startRadius: Math.min(diag * 0.03, sp * 40) });
  }

  // ── compare the two states (overlay in the live Spark mesh) ──
  let overlay = null;   // { colors: Float32Array (mesh order), mix }
  const sparkMesh = () => (window.FumocaSparkGaussian?.isEnabled?.() ? window.FumocaSparkGaussian.getMesh?.() : null);
  function writeOverlay(mix) {
    const mesh = sparkMesh(), map = window.FumocaSparkGaussian?.getIndexMap?.(), s = S(), l = cur();
    if (!mesh || !map || !s?.alive || !l) return false;
    const splats = mesh.packedSplats; if (!splats?.setSplat) return false;
    const n = splats.numSplats;
    const C = new Float32Array(n * 3), Sc = new Float32Array(n * 3), Q = new Float32Array(n * 4), Pp = new Float32Array(n * 3);
    splats.forEachSplat((i, c, sc, q, a, col) => { if (i >= n) return; Pp[i * 3] = c.x; Pp[i * 3 + 1] = c.y; Pp[i * 3 + 2] = c.z; Sc[i * 3] = sc.x; Sc[i * 3 + 1] = sc.y; Sc[i * 3 + 2] = sc.z; Q[i * 4] = q.x; Q[i * 4 + 1] = q.y; Q[i * 4 + 2] = q.z; Q[i * 4 + 3] = q.w; C[i * 3] = col.r; C[i * 3 + 1] = col.g; C[i * 3 + 2] = col.b; });
    if (!overlay || overlay.n !== n) overlay = { colors: C, n };
    const m = maskOf(l), tint = q('#lnTint').checked, c = new THREE.Vector3(), sc = new THREE.Vector3(), qq = new THREE.Quaternion(), col = new THREE.Color();
    // 0 → only this scan, 1 → only the second, middle → both (second see-through)
    const aBase = mix == null ? 1 : Math.min(1, 2 * (1 - mix)), aLink = mix == null ? 1 : Math.min(1, 2 * mix) * (mix > 0 && mix < 1 ? 0.6 : 1);
    for (let i = 0; i < s.alive.length; i++) {
      const k = map[i]; if (k < 0 || k >= n || !s.alive[i]) continue;
      const isLink = !!m[i], a = (isLink ? aLink : aBase) * (s.opacity?.[i] ?? 1);
      let r = overlay.colors[k * 3], g = overlay.colors[k * 3 + 1], b = overlay.colors[k * 3 + 2];
      if (mix != null && isLink && tint) { r = r * 0.55 + 1 * 0.45; g = g * 0.55 + 0.5 * 0.45; b = b * 0.55 + 0.1 * 0.45; }
      c.set(Pp[k * 3], Pp[k * 3 + 1], Pp[k * 3 + 2]); sc.set(Sc[k * 3], Sc[k * 3 + 1], Sc[k * 3 + 2]); qq.set(Q[k * 4], Q[k * 4 + 1], Q[k * 4 + 2], Q[k * 4 + 3]); col.setRGB(r, g, b);
      splats.setSplat(k, c, sc, qq, a, col);
    }
    splats.needsUpdate = true; mesh.updateVersion?.();
    return true;
  }
  let mixOn = false;
  function setMix(v) {
    q('#lnMix').value = Math.round(v * 100);
    q('#lnMixVal').textContent = v <= 0.01 ? 'this scan' : v >= 0.99 ? 'second scan' : `both · ${Math.round(v * 100)}%`;
    if (!writeOverlay(v)) { status('Turn Photoreal (Spark) on and choose the second scan to compare.'); return false; }
    mixOn = true; return true;
  }
  function compareOff() {
    if (!mixOn) return;
    writeOverlay(null); overlay = null; mixOn = false;
    q('#lnMixVal').textContent = 'off';
    window.FumocaSparkGaussian?.refreshEditorState?.(S());
  }
  // a selection's dots would sit on top of the scans being compared
  const clearSel = () => { const s = S(); if (s?.selected?.some?.(v => v)) { s.selected.fill(0); window.rebuildGeometry?.(); } };
  q('#lnCompare').addEventListener('click', () => { if (!cur()) { status('Choose the second scan first.'); return; } clearSel(); if (setMix(+q('#lnMix').value / 100)) status('Comparing — slide to fade between the scans, or Flip.'); });
  q('#lnMix').addEventListener('input', () => { if (cur()) setMix(+q('#lnMix').value / 100); });
  q('#lnTint').addEventListener('change', () => { if (mixOn) setMix(+q('#lnMix').value / 100); });
  q('#lnFlip').addEventListener('click', () => { if (!cur()) { status('Choose the second scan first.'); return; } const v = +q('#lnMix').value / 100; setMix(v < 0.5 ? 1 : 0); });
  q('#lnCompareOff').addEventListener('click', () => { compareOff(); status('Back to the normal view.'); });
  // a nudge or edit rewrites the mesh: lay the overlay back on top
  window.addEventListener('fumoca:sparkInPlaceUpdate', () => { if (mixOn) requestAnimationFrame(() => setMix(+q('#lnMix').value / 100)); });

  // ── fine-tune by hand ──
  let nudgeHistory = 0, commitTimer = 0, linkSize = 0;
  const STEPS = { fine: [0.001, 0.2, 0.002], normal: [0.005, 1, 0.01], coarse: [0.02, 5, 0.04] };   // move (× size), turn (°), resize
  function linkFrame(link) {
    const s = S(), c = [0, 0, 0];
    const st = Math.max(1, Math.floor(link.length / 20000));
    let n = 0, lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let k = 0; k < link.length; k += st) { const i = link[k]; n++; for (let j = 0; j < 3; j++) { const v = s.positions[i * 3 + j]; c[j] += v; if (v < lo[j]) lo[j] = v; if (v > hi[j]) hi[j] = v; } }
    return { c: c.map(v => v / Math.max(1, n)), size: Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1 };
  }
  function nudge(kind) {
    const l = cur(); if (!l) { status('Choose the second scan first.'); return; }
    const s = S(), link = indicesOf(true);
    if (link.length < 10) { status('The second scan has no splats to move.'); return; }
    if (!nudgeHistory) hooks().pushHistory?.('Fine-tune second scan');
    nudgeHistory = Date.now();
    const f = linkFrame(link); linkSize = f.size;
    const [mv, turn, grow] = STEPS[q('#lnStep').value] || STEPS.normal;
    const cam = window.camera; cam?.updateMatrixWorld?.();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion), up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion), fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const d = mv * f.size;
    const T = { R: [1, 0, 0, 0, 1, 0, 0, 0, 1], s: 1, t: [0, 0, 0], q: [1, 0, 0, 0] };
    const moveBy = (v, k) => { T.t = [v.x * k, v.y * k, v.z * k]; };
    const turnAbout = (axis, deg) => {
      const m = new THREE.Matrix4().makeRotationAxis(axis.clone().normalize(), deg * Math.PI / 180), e = m.elements;   // column-major
      T.R = [e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]];
      const qq = new THREE.Quaternion().setFromRotationMatrix(m); T.q = [qq.w, qq.x, qq.y, qq.z];
      const c = f.c, Rc = [T.R[0] * c[0] + T.R[1] * c[1] + T.R[2] * c[2], T.R[3] * c[0] + T.R[4] * c[1] + T.R[5] * c[2], T.R[6] * c[0] + T.R[7] * c[1] + T.R[8] * c[2]];
      T.t = [c[0] - Rc[0], c[1] - Rc[1], c[2] - Rc[2]];
    };
    const worldUp = new THREE.Vector3(0, 1, 0);
    switch (kind) {
      case 'left': moveBy(right, -d); break; case 'right': moveBy(right, d); break;
      case 'up': moveBy(up, d); break; case 'down': moveBy(up, -d); break;
      case 'fwd': moveBy(fwd, d); break; case 'back': moveBy(fwd, -d); break;
      case 'yawL': turnAbout(worldUp, turn); break; case 'yawR': turnAbout(worldUp, -turn); break;
      case 'tiltF': turnAbout(right, -turn); break; case 'tiltB': turnAbout(right, turn); break;
      case 'rollL': turnAbout(fwd, -turn); break; case 'rollR': turnAbout(fwd, turn); break;
      case 'smaller': case 'bigger': {
        const k = kind === 'bigger' ? 1 + grow : 1 / (1 + grow), c = f.c;
        T.s = k; T.t = [c[0] * (1 - k), c[1] * (1 - k), c[2] * (1 - k)]; break;
      }
      default: return;
    }
    transformSplats(s, link, T);
    for (const p of pairs) if (p.link) p.link = applyT(T, p.link);
    drawMarkers();
    q('#lnNudgeInfo').textContent = `Step: ${unit(d)} · ${turn}° · ${(grow * 100).toFixed(1)} %`;
    clearTimeout(commitTimer);
    window.rebuildGeometry?.();
    commitTimer = setTimeout(() => { nudgeHistory = 0; changed(); }, 900);
  }
  // hold to repeat
  q('#lnNudge').querySelectorAll('[data-n]').forEach(btn => {
    let timer = 0, rep = 0;
    const stop = () => { clearTimeout(timer); clearInterval(rep); timer = rep = 0; };
    btn.addEventListener('pointerdown', (e) => { e.preventDefault(); nudge(btn.dataset.n); timer = setTimeout(() => { rep = setInterval(() => nudge(btn.dataset.n), 70); }, 350); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => btn.addEventListener(ev, stop));
    btn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); nudge(btn.dataset.n); } });
  });
  q('#lnSelectLink').addEventListener('click', () => {
    const l = cur(); if (!l) { status('Choose the second scan first.'); return; }
    const s = S(), m = maskOf(l);
    for (let i = 0; i < s.alive.length; i++) s.selected[i] = s.alive[i] && m[i] ? 1 : 0;
    window.rebuildGeometry?.();
    hooks().setMode?.('move');
    status('The second scan is selected — drag it with Move, or switch to Rotate. Undo puts it back.');
  });

  // ── find what moved between the two states ──
  q('#lnFindMoved').addEventListener('click', () => busy('Comparing the two states', async () => {
    const l = cur(); if (!l) throw new Error('Choose the second scan first.');
    const P = window.FumocaParts; if (!P?.addPart) throw new Error('Open the Parts tab once so it is ready, then try again.');
    compareOff();
    const s = S(), base = indicesOf(false), link = indicesOf(true);
    if (base.length < 200 || link.length < 200) throw new Error('Both scans need splats — line the second scan up first.');
    const sp = l.spacing || estimateSpacing(s.positions, base);
    // tighten the line-up first: the comparison needs the still parts to sit on each other
    status('Tightening the line-up…'); await wait();
    const fit = snapFit(s, base, link, sp);
    if (fit.overlap > 0.3) { hooks().pushHistory?.('Tighten line-up'); transformSplats(s, link, fit.T); }
    status('Comparing the two states — finding what moved…'); await wait();
    const res = findMovingParts(s.positions, base, link, { spacing: sp });
    if (!res.parts.length) throw new Error('Could not find a part that moved — check the scans are lined up (Compare), and that the second scan shows the object open.');
    hooks().pushHistory?.('Find what moved');
    const m = maskOf(l), made = [];
    for (const f of res.parts) {
      const box = robustBounds(s.positions, f.closedIdx);
      const motion = { ...f.motion, duration: f.motion.type === 'hinge' ? 1.3 : 1.0, ease: f.motion.type === 'hinge' ? 'spring' : 'ease-in-out' };
      if (motion.type === 'slide') { motion.distance = f.motion.distance; motion.angle = 0; }
      const id = P.addPart({ name: f.kind, box, cells: cellsFromIndices(s.positions, f.closedIdx), motion });
      if (!id) continue;
      const part = P.get(id);
      // the open scan's copy: back to closed, its outer skin dropped, inner panel kept
      const att = f.openIdx.length > 30 ? attachToPart(s, part, f.closedIdx, f.openIdx, 1, sp * 2) : { attached: [], removed: [] };
      for (const i of att.attached) m[i] = 0;   // rides with the part, not faded with the inside
      if (att.attached.length) P.updatePart(id, { cells: cellsFromIndices(s.positions, [...f.closedIdx, ...att.attached]) });
      if (!l.revealWith.includes(id)) l.revealWith.push(id);
      made.push({ name: part.name, motion: f.motion, panel: att.attached.length });
    }
    // surfaces both states saw (the body): keep this scan's, drop the second's copy
    const dbl = findDoubles(s.positions, base, res.diff.linkShared, sp * 2.5);
    for (const i of dbl) s.alive[i] = 0;
    l.kind = 'open'; q('#lnKind').value = 'open';
    s.selected?.fill?.(0);
    await commit('Parts made');
    renderAll();
    const says = made.map(p => `${p.name}: ${p.motion.type === 'slide' ? `slides ${unit(p.motion.distance)}` : p.motion.type === 'twist' ? `turns ${Math.round(p.motion.angle)}° and rises ${unit(p.motion.lift)}` : `swings ${Math.round(p.motion.angle)}°`}${p.panel ? ` (+${p.panel.toLocaleString()} inner-panel splats)` : ''}`).join(' · ');
    status(`Found ${made.length} moving part${made.length === 1 ? '' : 's'} — ${says}. Removed ${dbl.length.toLocaleString()} doubled body splats; the inside it revealed (${res.inside.length.toLocaleString()} splats) fades in as it opens. Try them in the Parts tab.`);
  }));

  // ── reveal preview in Studio ──
  function restartPreview() {
    reveal?.dispose?.(); reveal = null;
    if (!q('#lnPreview').checked) return;
    const mesh = window.FumocaSparkGaussian?.isEnabled?.() ? window.FumocaSparkGaussian.getMesh?.() : null;
    const animator = window.FumocaParts?.animator;
    if (!mesh || !animator) { status('Turn Spark on and make a part to preview the reveal.'); return; }
    try { reveal = new InsideReveal(THREE, mesh, animator, getLinks()); status('Preview on — open a linked part (Parts tab ▶) to see the inside fade in.'); }
    catch (e) { status(e.message); }
  }
  q('#lnPreview').addEventListener('change', restartPreview);
  window.addEventListener('fumoca:splatsEdited', () => setTimeout(restartPreview, 900));

  // ── saving ──
  function getLinks() {
    const s = S();
    if (!s?.alive) return [];
    return normalizeLinks(links.map(l => ({ id: l.id, name: l.name, kind: l.kind, reveal: l.reveal, revealWith: l.revealWith, ranges: maskToRanges(maskOf(l), s.alive) })));
  }

  window.addEventListener('fumoca:fileLoaded', () => {
    reveal?.dispose?.(); reveal = null; pairs = []; setPicking(false); drawMarkers();
    const saved = normalizeLinks(window._fumocaCurrentRecord?.meta?.present?.links);
    const n = S()?.alive?.length || 0;
    links = saved.map(l => { const m = new Uint8Array(n); for (const i of rangesToIndices(l.ranges, n)) m[i] = 1; return { ...l, mask: m, layerId: null }; });
    active = links[0]?.id || null;
    renderAll();
  });
  window.addEventListener('fumoca:partsChange', () => renderAll());
  container.closest('.panel-body')?.addEventListener?.('click', () => {}, { passive: true });

  renderAll();
  const api = { getLinks, get links() { return links; }, get pairs() { return pairs; }, linkFromLayer, get reveal() { return reveal; } };
  window.FumocaLinks = api;
  return api;
}
