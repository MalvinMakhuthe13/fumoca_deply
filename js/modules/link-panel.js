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
  InsideReveal, pickSplat, pairError, applyT,
} from './scan-link.js';

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
    const T = fit.overlap > 0.03 && fit.rms < Math.max(pickErr, sp * 4) ? fit.T : T0;
    hooks().pushHistory?.('Line up second scan');
    transformSplats(s, link, T);
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
    const fit = refineAlignment(s.positions, base, link, { R: [1, 0, 0, 0, 1, 0, 0, 0, 1], s: 1, t: [0, 0, 0], q: [1, 0, 0, 0] }, { spacing: sp, scale: q('#lnScale').checked });
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
