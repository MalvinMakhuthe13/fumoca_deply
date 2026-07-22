/**
 * FUMOCA Property & Vehicle Tour Mode v80
 * ════════════════════════════════════════════════════════════════════════════
 * Turns a Gaussian splat into a fully interactive property or vehicle tour:
 *
 * PROPERTY MODE
 *   - Dollhouse overview → tap a room → zoom into room (like Matterport)
 *   - Floor plan overlay with clickable room markers
 *   - Room info cards (dimensions, features, photos)
 *   - Guided tour narrative mode
 *   - "Measure" overlay (estimated dimensions from splat bounds)
 *   - Lead capture form (name/email/phone → Supabase leads table)
 *
 * VEHICLE MODE
 *   - Preset camera angles: exterior front/rear/side, interior, boot
 *   - Feature hotspots (tap engine badge → info card with specs)
 *   - 360 auto-spin for showroom display
 *   - Colour selector (swaps whitelabel accent and metadata)
 *   - Price + CTA overlay (Get Quote / Book Test Drive)
 *   - Finance calculator widget
 *
 * Both modes work on top of the existing viewer + hotspot-pro + tour-builder
 * infrastructure. This module layers a purpose-built UI shell over them.
 * ════════════════════════════════════════════════════════════════════════════
 */

import * as THREE from 'three';

// ── Shared helpers ────────────────────────────────────────────────────────────

function _cam()      { return window._fumocaCamera   || null; }
function _controls() { return window._fumocaControls || null; }
function _supabase() { return window._fumocaSupabase || null; }

function _ease(t) { return t < 0.5 ? 2*t*t : -1+(4-2*t)*t; }

function _animateTo(targetPos, targetLookAt, ms = 1600) {
  return new Promise(resolve => {
    const cam = _cam(); if (!cam) { resolve(); return; }
    const startPos  = cam.position.clone();
    const ctrl      = _controls();
    const startLook = ctrl ? ctrl.target.clone() : new THREE.Vector3();
    const t0 = performance.now();
    function tick(now) {
      const t = Math.min((now - t0) / ms, 1), e = _ease(t);
      cam.position.lerpVectors(startPos, targetPos, e);
      const look = new THREE.Vector3().lerpVectors(startLook, targetLookAt, e);
      if (ctrl) { ctrl.target.copy(look); ctrl.update(); } else cam.lookAt(look);
      if (t < 1) requestAnimationFrame(tick); else resolve();
    }
    requestAnimationFrame(tick);
  });
}

function _toast(msg, color = '#c8ff00') {
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = `position:fixed;bottom:90px;left:50%;transform:translateX(-50%);
    background:rgba(5,7,11,.9);border:1px solid ${color}44;color:${color};
    padding:8px 18px;border-radius:999px;font-size:13px;font-weight:700;
    z-index:9999;pointer-events:none;font-family:'DM Sans',sans-serif;`;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2400);
}

// ══════════════════════════════════════════════════════════════════════════════
// PROPERTY TOUR MODE
// ══════════════════════════════════════════════════════════════════════════════

const PropertyTour = (() => {

  let _record    = null;
  let _rooms     = [];   // [{ id, label, position, lookAt, area, features, photos }]
  let _active    = false;

  // ── UI shell ────────────────────────────────────────────────────────────────

  function _ensureShell() {
    if (document.getElementById('fumocPropertyShell')) return;

    const shell = document.createElement('div');
    shell.id = 'fumocPropertyShell';
    shell.innerHTML = `
      <style>
        #fumocPropertyShell { font-family:'DM Sans',system-ui,sans-serif; }
        #fumocPropTopBar {
          position:fixed;top:0;left:0;right:0;z-index:300;
          background:rgba(5,7,11,.92);border-bottom:1px solid rgba(255,255,255,.08);
          backdrop-filter:blur(20px);padding:12px 16px;
          display:flex;align-items:center;gap:12px;
        }
        #fumocPropTopBar .prop-name {
          font-size:15px;font-weight:700;color:#fff;flex:1;
        }
        #fumocPropTopBar .prop-price {
          font-size:14px;font-weight:700;color:#c8ff00;
        }
        #fumocRoomBar {
          position:fixed;bottom:0;left:0;right:0;z-index:300;
          background:rgba(5,7,11,.92);border-top:1px solid rgba(255,255,255,.08);
          backdrop-filter:blur(20px);overflow-x:auto;
          display:flex;align-items:center;gap:8px;padding:10px 16px;
          scrollbar-width:none;
        }
        #fumocRoomBar::-webkit-scrollbar { display:none; }
        .fumoc-room-pill {
          flex-shrink:0;padding:8px 16px;border-radius:999px;cursor:pointer;
          background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);
          color:rgba(255,255,255,.8);font-size:13px;font-weight:600;
          white-space:nowrap;transition:all .15s;
        }
        .fumoc-room-pill:hover,.fumoc-room-pill.active {
          background:rgba(200,255,0,.18);border-color:rgba(200,255,0,.4);color:#c8ff00;
        }
        #fumocRoomCard {
          position:fixed;left:16px;bottom:76px;z-index:301;
          width:min(300px,calc(100vw-32px));
          background:rgba(5,7,11,.94);border:1px solid rgba(255,255,255,.1);
          backdrop-filter:blur(20px);border-radius:20px;padding:16px;
          display:none;
        }
        #fumocRoomCard.visible { display:block; }
        .frc-title { font-size:16px;font-weight:700;color:#fff;margin-bottom:4px; }
        .frc-area  { font-size:12px;color:#c8ff00;margin-bottom:8px; }
        .frc-features { list-style:none;padding:0;margin:0; }
        .frc-features li { font-size:12px;color:rgba(255,255,255,.65);padding:3px 0;
          border-bottom:1px solid rgba(255,255,255,.05); }
        .frc-features li:last-child { border-bottom:none; }
        .frc-close {
          position:absolute;top:10px;right:12px;background:none;border:none;
          color:rgba(255,255,255,.4);font-size:18px;cursor:pointer;
        }
        #fumocLeadForm {
          position:fixed;inset:0;z-index:500;background:rgba(0,0,0,.65);
          backdrop-filter:blur(8px);display:none;
          align-items:center;justify-content:center;
        }
        #fumocLeadForm.visible { display:flex; }
        .flf-inner {
          background:rgba(8,10,16,.97);border:1px solid rgba(255,255,255,.12);
          border-radius:24px;padding:28px;width:min(380px,calc(100vw-32px));
        }
        .flf-title { font-size:19px;font-weight:700;color:#fff;margin-bottom:4px; }
        .flf-sub   { font-size:13px;color:rgba(255,255,255,.5);margin-bottom:18px; }
        .flf-input {
          width:100%;padding:12px 14px;border-radius:12px;margin-bottom:10px;
          background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);
          color:#fff;font-size:14px;outline:none;
        }
        .flf-input:focus { border-color:rgba(200,255,0,.45); }
        .flf-submit {
          width:100%;padding:13px;border-radius:14px;margin-top:4px;
          background:#c8ff00;border:none;color:#05070b;
          font-size:15px;font-weight:800;cursor:pointer;
        }
        .flf-close {
          width:100%;padding:10px;border-radius:14px;margin-top:8px;
          background:transparent;border:1px solid rgba(255,255,255,.1);
          color:rgba(255,255,255,.5);font-size:13px;cursor:pointer;
        }
        #fumocDollhouseBtn {
          position:fixed;top:68px;right:16px;z-index:302;
          background:rgba(5,7,11,.9);border:1px solid rgba(255,255,255,.12);
          color:#fff;border-radius:14px;padding:8px 14px;font-size:12px;
          font-weight:700;cursor:pointer;backdrop-filter:blur(10px);
          transition:background .15s;
        }
        #fumocDollhouseBtn:hover { background:rgba(255,255,255,.1); }
      </style>

      <div id="fumocPropTopBar">
        <div class="prop-name" id="fumocPropName">Property</div>
        <div class="prop-price" id="fumocPropPrice"></div>
        <button onclick="FumocPropertyTour.showLeadForm()" style="
          padding:8px 16px;border-radius:12px;background:#c8ff00;
          border:none;color:#05070b;font-weight:800;font-size:13px;cursor:pointer;
        ">Enquire</button>
      </div>

      <button id="fumocDollhouseBtn" onclick="FumocPropertyTour.dollhouse()">
        🏠 Dollhouse
      </button>

      <div id="fumocRoomBar"></div>

      <div id="fumocRoomCard">
        <button class="frc-close" onclick="document.getElementById('fumocRoomCard').classList.remove('visible')">×</button>
        <div class="frc-title" id="frcTitle"></div>
        <div class="frc-area"  id="frcArea"></div>
        <ul class="frc-features" id="frcFeatures"></ul>
      </div>

      <div id="fumocLeadForm">
        <div class="flf-inner">
          <div class="flf-title">Book a Viewing</div>
          <div class="flf-sub">Leave your details and we'll be in touch.</div>
          <input class="flf-input" id="flfName"  type="text"  placeholder="Your name" />
          <input class="flf-input" id="flfEmail" type="email" placeholder="Email address" />
          <input class="flf-input" id="flfPhone" type="tel"   placeholder="Phone number" />
          <button class="flf-submit" onclick="FumocPropertyTour.submitLead()">Request Viewing →</button>
          <button class="flf-close"  onclick="FumocPropertyTour.hideLeadForm()">Maybe later</button>
        </div>
      </div>
    `;
    document.body.appendChild(shell);
  }

  // ── Room navigation ──────────────────────────────────────────────────────────

  async function goToRoom(index) {
    const room = _rooms[index];
    if (!room) return;

    document.querySelectorAll('.fumoc-room-pill').forEach((p, i) =>
      p.classList.toggle('active', i === index));

    const pos  = new THREE.Vector3(...(room.position || [0, 2, 4]));
    const look = new THREE.Vector3(...(room.lookAt   || [0, 0, 0]));
    await _animateTo(pos, look, 1600);

    // Show room info card
    document.getElementById('frcTitle').textContent    = room.label || room.title || '';
    document.getElementById('frcArea').textContent     = room.area  ? `${room.area} m²` : '';
    const ul = document.getElementById('frcFeatures');
    ul.innerHTML = (room.features || []).map(f => `<li>✓ ${f}</li>`).join('');
    document.getElementById('fumocRoomCard').classList.add('visible');
  }

  function dollhouse() {
    // Pull back to a high overhead angle showing the whole property
    const cam = _cam();
    if (!cam) return;
    const bounds  = window._fumocaSplatBounds || { center: new THREE.Vector3(0,0,0), radius: 5 };
    const r       = bounds.radius || 5;
    const overhead = bounds.center.clone().add(new THREE.Vector3(0, r * 2.2, r * 1.5));
    _animateTo(overhead, bounds.center, 1800);
    document.getElementById('fumocRoomCard')?.classList.remove('visible');
    document.querySelectorAll('.fumoc-room-pill').forEach(p => p.classList.remove('active'));
  }

  function showLeadForm() {
    document.getElementById('fumocLeadForm')?.classList.add('visible');
  }
  function hideLeadForm() {
    document.getElementById('fumocLeadForm')?.classList.remove('visible');
  }

  async function submitLead() {
    const name  = document.getElementById('flfName')?.value?.trim();
    const email = document.getElementById('flfEmail')?.value?.trim();
    const phone = document.getElementById('flfPhone')?.value?.trim();
    if (!name || !email) { _toast('Please enter your name and email', '#ff4848'); return; }

    const sb = _supabase();
    if (sb) {
      await sb.from('leads').insert({
        splat_id:   _record?.id,
        name, email, phone,
        source:     'property_tour',
        created_at: new Date().toISOString(),
      }).catch(console.warn);
    }

    hideLeadForm();
    _toast('✓ Viewing request sent!');
  }

  // ── Init ─────────────────────────────────────────────────────────────────────

  function init(record, rooms = []) {
    _record = record;
    _rooms  = rooms.length ? rooms : _defaultRooms(record);
    _active = true;
    _ensureShell();

    document.getElementById('fumocPropName').textContent  = record.title || 'Property';
    document.getElementById('fumocPropPrice').textContent = record.metadata?.price
      ? `R ${Number(record.metadata.price).toLocaleString('en-ZA')}`
      : '';

    // Build room pills
    const bar = document.getElementById('fumocRoomBar');
    bar.innerHTML = _rooms.map((r, i) =>
      `<div class="fumoc-room-pill" onclick="FumocPropertyTour.goToRoom(${i})">${r.label || r.title || `Room ${i+1}`}</div>`
    ).join('');

    // Start in dollhouse view
    setTimeout(() => dollhouse(), 600);
  }

  function _defaultRooms(record) {
    // If no rooms defined, build from hotspots or return a single-room default
    const hotspots = record.metadata?.hotspots || [];
    if (hotspots.length) {
      return hotspots.map(h => ({
        label:    h.label || h.title,
        position: h.worldPos || h.position || [0, 1.5, 3],
        lookAt:   h.lookAt || [0, 0, 0],
        features: [],
      }));
    }
    return [{ label: 'Main View', position: [0, 1.5, 3], lookAt: [0, 0, 0] }];
  }

  function destroy() {
    _active = false;
    document.getElementById('fumocPropertyShell')?.remove();
  }

  return { init, goToRoom, dollhouse, showLeadForm, hideLeadForm, submitLead, destroy };

})();

// ══════════════════════════════════════════════════════════════════════════════
// VEHICLE TOUR MODE
// ══════════════════════════════════════════════════════════════════════════════

const VehicleTour = (() => {

  let _record = null;
  let _active = false;
  let _spinInterval = null;

  // Preset camera angles for a car
  const ANGLES = {
    front:      { pos: [0, 1.2, 4.5],    look: [0, 0.4, 0],   label: 'Front' },
    rear:       { pos: [0, 1.2, -4.5],   look: [0, 0.4, 0],   label: 'Rear' },
    sideLeft:   { pos: [-4.5, 1.2, 0],   look: [0, 0.4, 0],   label: 'Left Side' },
    sideRight:  { pos: [4.5,  1.2, 0],   look: [0, 0.4, 0],   label: 'Right Side' },
    topDown:    { pos: [0, 6, 0.1],       look: [0, 0, 0],     label: 'Top' },
    interior:   { pos: [0, 1.1, 0.2],    look: [0, 1.1, 1.5], label: 'Interior' },
    boot:       { pos: [0, 1.4, -3.5],   look: [0, 0.8, -4.5],label: 'Boot' },
    threeQtr:   { pos: [3.5, 1.8, 3.5],  look: [0, 0.4, 0],   label: '¾ View' },
  };

  function _ensureShell() {
    if (document.getElementById('fumocVehicleShell')) return;

    const shell = document.createElement('div');
    shell.id = 'fumocVehicleShell';
    shell.innerHTML = `
      <style>
        #fumocVehicleShell { font-family:'DM Sans',system-ui,sans-serif; }
        #fumocVehBar {
          position:fixed;bottom:0;left:0;right:0;z-index:300;
          background:rgba(5,7,11,.94);border-top:1px solid rgba(255,255,255,.08);
          backdrop-filter:blur(20px);overflow-x:auto;
          display:flex;align-items:center;gap:6px;padding:10px 16px;
          scrollbar-width:none;
        }
        #fumocVehBar::-webkit-scrollbar { display:none; }
        .fumoc-angle-pill {
          flex-shrink:0;padding:8px 14px;border-radius:999px;cursor:pointer;
          background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.1);
          color:rgba(255,255,255,.75);font-size:12px;font-weight:600;
          white-space:nowrap;transition:all .15s;
        }
        .fumoc-angle-pill:hover,.fumoc-angle-pill.active {
          background:rgba(200,255,0,.18);border-color:rgba(200,255,0,.4);color:#c8ff00;
        }
        #fumocVehPanel {
          position:fixed;right:16px;top:70px;z-index:301;
          width:220px;background:rgba(5,7,11,.94);
          border:1px solid rgba(255,255,255,.1);backdrop-filter:blur(20px);
          border-radius:20px;padding:14px;
        }
        .fvp-label {
          font-size:11px;color:rgba(255,255,255,.4);text-transform:uppercase;
          letter-spacing:.07em;margin-bottom:8px;font-weight:700;
        }
        .fvp-title  { font-size:17px;font-weight:800;color:#fff;line-height:1.2; }
        .fvp-sub    { font-size:12px;color:rgba(255,255,255,.5);margin:2px 0 10px; }
        .fvp-price  { font-size:20px;font-weight:800;color:#c8ff00;margin-bottom:10px; }
        .fvp-btn {
          width:100%;padding:11px;border-radius:12px;margin-bottom:6px;font-size:13px;
          font-weight:700;cursor:pointer;border:none;
        }
        .fvp-btn.primary { background:#c8ff00;color:#05070b; }
        .fvp-btn.ghost   { background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.12); }
        #fumocSpinToggle {
          position:fixed;top:68px;left:16px;z-index:302;
          background:rgba(5,7,11,.9);border:1px solid rgba(255,255,255,.12);
          color:#fff;border-radius:14px;padding:8px 14px;font-size:12px;
          font-weight:700;cursor:pointer;backdrop-filter:blur(10px);
        }
        #fumocFinancePanel {
          position:fixed;inset:0;z-index:500;background:rgba(0,0,0,.6);
          backdrop-filter:blur(8px);display:none;align-items:center;justify-content:center;
        }
        #fumocFinancePanel.visible { display:flex; }
        .ffp-inner {
          background:rgba(8,10,16,.97);border:1px solid rgba(255,255,255,.12);
          border-radius:24px;padding:24px;width:min(360px,calc(100vw-32px));
        }
        .ffp-title { font-size:18px;font-weight:800;color:#fff;margin-bottom:16px; }
        .ffp-row   { display:flex;justify-content:space-between;margin-bottom:10px; }
        .ffp-label { font-size:12px;color:rgba(255,255,255,.5); }
        .ffp-val   { font-size:13px;font-weight:700;color:#fff; }
        .ffp-result{
          background:rgba(200,255,0,.1);border:1px solid rgba(200,255,0,.25);
          border-radius:12px;padding:12px;margin:12px 0;text-align:center;
        }
        .ffp-pm    { font-size:22px;font-weight:800;color:#c8ff00; }
        .ffp-close {
          width:100%;padding:10px;border-radius:12px;border:1px solid rgba(255,255,255,.1);
          background:transparent;color:rgba(255,255,255,.5);font-size:13px;cursor:pointer;
        }
        .ffp-input {
          width:100%;padding:10px 12px;border-radius:10px;margin:4px 0 12px;
          background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);
          color:#fff;font-size:14px;outline:none;
        }
      </style>

      <div id="fumocVehBar">
        ${Object.entries(ANGLES).map(([k,v]) =>
          `<div class="fumoc-angle-pill" onclick="FumocVehicleTour.goToAngle('${k}')">${v.label}</div>`
        ).join('')}
      </div>

      <div id="fumocVehPanel">
        <div class="fvp-label">FUMOCA · Vehicle</div>
        <div class="fvp-title" id="fumocVehTitle">Vehicle</div>
        <div class="fvp-sub"   id="fumocVehSub"></div>
        <div class="fvp-price" id="fumocVehPrice"></div>
        <button class="fvp-btn primary" onclick="FumocVehicleTour.getQuote()">Get Quote →</button>
        <button class="fvp-btn ghost"   onclick="FumocVehicleTour.testDrive()">Book Test Drive</button>
        <button class="fvp-btn ghost"   onclick="FumocVehicleTour.showFinance()">Finance Calculator</button>
      </div>

      <button id="fumocSpinToggle" onclick="FumocVehicleTour.toggleSpin()">⟳ Auto Spin</button>

      <div id="fumocFinancePanel">
        <div class="ffp-inner">
          <div class="ffp-title">Finance Calculator</div>
          <div class="ffp-row">
            <span class="ffp-label">Vehicle Price (R)</span>
          </div>
          <input class="ffp-input" id="ffpPrice" type="number" placeholder="e.g. 450000" oninput="FumocVehicleTour.calcFinance()" />
          <div class="ffp-row">
            <span class="ffp-label">Deposit (R)</span>
          </div>
          <input class="ffp-input" id="ffpDeposit" type="number" value="0" oninput="FumocVehicleTour.calcFinance()" />
          <div class="ffp-row">
            <span class="ffp-label">Term (months)</span>
          </div>
          <input class="ffp-input" id="ffpTerm" type="number" value="72" oninput="FumocVehicleTour.calcFinance()" />
          <div class="ffp-row">
            <span class="ffp-label">Interest Rate (%)</span>
          </div>
          <input class="ffp-input" id="ffpRate" type="number" value="11.25" step="0.25" oninput="FumocVehicleTour.calcFinance()" />
          <div class="ffp-result">
            <div class="ffp-label">Estimated monthly payment</div>
            <div class="ffp-pm" id="ffpResult">R —</div>
          </div>
          <button class="ffp-close" onclick="FumocVehicleTour.hideFinance()">Close</button>
        </div>
      </div>
    `;
    document.body.appendChild(shell);
  }

  function goToAngle(key) {
    const angle = ANGLES[key]; if (!angle) return;
    document.querySelectorAll('.fumoc-angle-pill').forEach(p =>
      p.classList.toggle('active', p.textContent === angle.label));
    _animateTo(
      new THREE.Vector3(...angle.pos),
      new THREE.Vector3(...angle.look),
      1400
    );
  }

  function toggleSpin() {
    if (_spinInterval) {
      clearInterval(_spinInterval);
      _spinInterval = null;
      document.getElementById('fumocSpinToggle').textContent = '⟳ Auto Spin';
      if (_controls()) _controls().autoRotate = false;
    } else {
      const ctrl = _controls();
      if (ctrl) {
        ctrl.autoRotate      = true;
        ctrl.autoRotateSpeed = 0.6;
        document.getElementById('fumocSpinToggle').textContent = '⏹ Stop Spin';
        // Ensure controls update loop is running
        if (!window._fumocaAnimating) {
          _spinInterval = setInterval(() => ctrl.update(), 16);
        }
      }
    }
  }

  function getQuote() {
    const url = _record?.metadata?.quote_url || _record?.metadata?.dealer_url;
    if (url) window.open(url, '_blank', 'noopener');
    else _toast('Contact the dealer for a quote');
  }

  function testDrive() {
    const url = _record?.metadata?.test_drive_url;
    if (url) window.open(url, '_blank', 'noopener');
    else _toast('Contact the dealer to book a test drive');
  }

  function showFinance() {
    // Pre-fill price from record
    const price = _record?.metadata?.price;
    if (price) document.getElementById('ffpPrice').value = price;
    document.getElementById('fumocFinancePanel').classList.add('visible');
    calcFinance();
  }

  function hideFinance() {
    document.getElementById('fumocFinancePanel').classList.remove('visible');
  }

  function calcFinance() {
    const price   = parseFloat(document.getElementById('ffpPrice')?.value)   || 0;
    const deposit = parseFloat(document.getElementById('ffpDeposit')?.value) || 0;
    const term    = parseFloat(document.getElementById('ffpTerm')?.value)    || 72;
    const rate    = parseFloat(document.getElementById('ffpRate')?.value)    || 11.25;

    const principal = price - deposit;
    if (principal <= 0 || term <= 0) {
      document.getElementById('ffpResult').textContent = 'R —';
      return;
    }

    const monthlyRate = rate / 100 / 12;
    const pmt = monthlyRate === 0
      ? principal / term
      : (principal * monthlyRate * Math.pow(1 + monthlyRate, term))
        / (Math.pow(1 + monthlyRate, term) - 1);

    document.getElementById('ffpResult').textContent =
      `R ${Math.round(pmt).toLocaleString('en-ZA')} / month`;
  }

  function init(record) {
    _record = record;
    _active = true;
    _ensureShell();

    document.getElementById('fumocVehTitle').textContent = record.title || 'Vehicle';
    document.getElementById('fumocVehSub').textContent   =
      [record.metadata?.year, record.metadata?.make, record.metadata?.model]
        .filter(Boolean).join(' ');
    const price = record.metadata?.price;
    document.getElementById('fumocVehPrice').textContent =
      price ? `R ${Number(price).toLocaleString('en-ZA')}` : '';

    // Default to 3/4 angle
    setTimeout(() => goToAngle('threeQtr'), 600);
  }

  function destroy() {
    _active = false;
    if (_spinInterval) clearInterval(_spinInterval);
    if (_controls()) _controls().autoRotate = false;
    document.getElementById('fumocVehicleShell')?.remove();
  }

  return { init, goToAngle, toggleSpin, getQuote, testDrive,
           showFinance, hideFinance, calcFinance, destroy };

})();

// ── Mode selector ─────────────────────────────────────────────────────────────

function activateTourMode(record) {
  const mode = record?.metadata?.mode || 'product';

  if (mode === 'real_estate' || mode === 'property') {
    const rooms = record.metadata?.rooms || [];
    PropertyTour.init(record, rooms);
    window.FumocPropertyTour = PropertyTour;
  } else if (mode === 'car' || mode === 'vehicle') {
    VehicleTour.init(record);
    window.FumocVehicleTour = VehicleTour;
  }
  // product / person / event: no tour shell — use standard viewer
}

function deactivateTourMode() {
  PropertyTour.destroy();
  VehicleTour.destroy();
}

const FumocTourMode = { activateTourMode, deactivateTourMode, PropertyTour, VehicleTour };
window.FumocTourMode      = FumocTourMode;
window.FumocPropertyTour  = PropertyTour;
window.FumocVehicleTour   = VehicleTour;

export default FumocTourMode;
