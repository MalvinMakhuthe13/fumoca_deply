
const dockId = 'fumocaPlatformDock';

function ensureDock() {
  let dock = document.getElementById(dockId);
  if (dock) return dock;
  dock = document.createElement('div');
  dock.id = dockId;
  dock.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:12;display:grid;gap:8px;max-width:min(360px,calc(100vw - 32px));';
  document.body.appendChild(dock);
  return dock;
}

function makeCard(title, body, actions = '') {
  const card = document.createElement('div');
  card.style.cssText = 'background:rgba(7,10,16,.82);border:1px solid rgba(255,255,255,.1);backdrop-filter:blur(18px);border-radius:18px;padding:12px 14px;color:#fff;box-shadow:0 16px 42px rgba(0,0,0,.32);';
  card.innerHTML = `<div style="font-family:var(--font-display);letter-spacing:.05em;color:var(--neon);font-size:20px;line-height:1;">${title}</div><div style="margin-top:6px;font-size:12px;line-height:1.5;color:rgba(255,255,255,.72);">${body}</div>${actions ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">${actions}</div>` : ''}`;
  return card;
}

function button(label, id, kind='ghost') {
  const styles = {
    ghost:'background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);color:#fff;',
    neon:'background:var(--neon);border:1px solid var(--neon);color:#05070b;',
    acid:'background:rgba(0,255,200,.1);border:1px solid rgba(0,255,200,.28);color:var(--acid2);',
    warn:'background:rgba(255,184,0,.1);border:1px solid rgba(255,184,0,.28);color:var(--warn);',
  };
  return `<button id="${id}" style="padding:9px 12px;border-radius:12px;font-weight:700;cursor:pointer;${styles[kind]}">${label}</button>`;
}

function isEmbed() {
  return new URLSearchParams(location.search).get('embed') === '1';
}

function applyEmbedMode() {
  if (!isEmbed()) return;
  document.body.classList.add('fumoca-embed-mode');
  const topbar = document.getElementById('topbar');
  const hint = document.getElementById('hint');
  if (topbar) topbar.style.paddingRight = '12px';
  ['backBtn','editModeBtn','deleteUploadBtn','saveVariantBtn','hotspotBtn','copyLinkBtn'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = id === 'copyLinkBtn' ? 'none' : 'none';
  });
  if (hint) hint.textContent = 'Embedded Fumoca viewer';
}

function updateDock() {
  const dock = ensureDock();
  dock.innerHTML = '';

  const perms = window._fumocaPermissions || {};
  const variants = window._fumocaLoadVariants?.() || [];
  const queue = window._fumocaCurrentRecord?.metadata?.processing_requests || [];

  // ─────────────────────────────────────────────────────────────
  // Clean viewer:
  // CORE + PRO OPS are hidden inside the compact admin menu.
  // The viewer itself stays unobstructed, especially on mobile.
  // ─────────────────────────────────────────────────────────────

  const menuButton = document.createElement('button');
  menuButton.id = 'fumocaAdminMenuBtn';
  menuButton.type = 'button';
  menuButton.setAttribute('aria-label', 'Open FUMOCA controls');
  menuButton.setAttribute('aria-expanded', 'false');
  menuButton.innerHTML = '☰';
  menuButton.style.cssText = `
    position: fixed;
    top: 14px;
    right: 14px;
    z-index: 10001;
    width: 46px;
    height: 46px;
    border-radius: 50%;
    border: 1px solid rgba(255,255,255,.14);
    background: rgba(7,10,16,.78);
    color: #fff;
    backdrop-filter: blur(18px);
    -webkit-backdrop-filter: blur(18px);
    box-shadow: 0 10px 30px rgba(0,0,0,.30);
    font-size: 21px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  `;

  const panel = document.createElement('aside');
  panel.id = 'fumocaAdminDrawer';
  panel.setAttribute('aria-label', 'FUMOCA controls');
  panel.style.cssText = `
    position: fixed;
    top: 12px;
    right: 12px;
    bottom: 12px;
    width: min(390px, calc(100vw - 24px));
    z-index: 10000;
    overflow-y: auto;
    padding: 58px 12px 16px;
    box-sizing: border-box;
    background: rgba(5,7,11,.94);
    border: 1px solid rgba(255,255,255,.10);
    border-radius: 20px;
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    box-shadow: 0 24px 70px rgba(0,0,0,.55);
    transform: translateX(calc(100% + 30px));
    opacity: 0;
    pointer-events: none;
    transition: transform .22s ease, opacity .18s ease;
  `;

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.setAttribute('aria-label', 'Close FUMOCA controls');
  closeButton.innerHTML = '×';
  closeButton.style.cssText = `
    position: absolute;
    top: 12px;
    right: 12px;
    width: 38px;
    height: 38px;
    border-radius: 12px;
    border: 1px solid rgba(255,255,255,.12);
    background: rgba(255,255,255,.06);
    color: #fff;
    font-size: 24px;
    line-height: 1;
    cursor: pointer;
  `;

  const heading = document.createElement('div');
  heading.innerHTML = `
    <div style="
      font-family:var(--font-display);
      letter-spacing:.05em;
      color:var(--neon);
      font-size:20px;
      line-height:1;
      font-weight:800;
    ">FUMOCA</div>
    <div style="
      margin-top:5px;
      font-size:11px;
      color:rgba(255,255,255,.52);
      letter-spacing:.08em;
      text-transform:uppercase;
    ">Owner / Admin controls</div>
  `;

  panel.appendChild(closeButton);
  panel.appendChild(heading);

  // CORE
  const platformCard = makeCard(
    'FUMOCA CORE',
    `Access: <strong>${perms.canManage ? 'Owner/Admin' : 'Viewer'}</strong> · Variants: <strong>${variants.length}</strong> · Queue: <strong>${queue.length}</strong><br>Embed, tours, variants, nested splat overlays, sponsor-ready hotspots, CTAs, print/mesh prep hooks, API bridges and AI-ready cleanup are active in this bundle.`,
    [
      button('Save variant', 'fpSaveVariant', perms.canManage ? 'neon' : 'ghost'),
      button('Copy embed', 'fpCopyEmbed', 'ghost'),
      button('Start tour', 'fpStartTour', 'acid'),
      button('Stop tour', 'fpStopTour', 'ghost'),
      button('API map', 'fpApiMap', 'warn'),
      button('Close nested', 'fpCloseNested', 'ghost'),
    ].join('')
  );

  panel.appendChild(platformCard);

  // PRO OPS
  if (perms.canManage) {
    const opsCard = makeCard(
      'PRO OPS',
      'Queue mesh prep, queue print prep, and apply AI-ready cleanup presets without exposing admin controls to normal viewers.',
      [
        button('Auto clean', 'fpAutoClean', 'acid'),
        button('Mesh prep', 'fpMeshPrep', 'warn'),
        button('Print prep', 'fpPrintPrep', 'warn'),
        button('Load last look', 'fpLoadLook', 'ghost'),
      ].join('')
    );

    panel.appendChild(opsCard);
  }

  const setOpen = (open) => {
    panel.style.transform = open
      ? 'translateX(0)'
      : 'translateX(calc(100% + 30px))';
    panel.style.opacity = open ? '1' : '0';
    panel.style.pointerEvents = open ? 'auto' : 'none';

    menuButton.style.opacity = open ? '0' : '1';
    menuButton.style.pointerEvents = open ? 'none' : 'auto';
    menuButton.setAttribute('aria-expanded', String(open));
  };

  menuButton.addEventListener('click', () => {
    setOpen(true);
  });

  closeButton.addEventListener('click', () => {
    setOpen(false);
  });

  // Close when clicking outside the drawer.
  document.addEventListener('pointerdown', (event) => {
    if (
      panel.style.pointerEvents === 'auto' &&
      !panel.contains(event.target) &&
      event.target !== menuButton
    ) {
      setOpen(false);
    }
  });

  dock.appendChild(menuButton);
  dock.appendChild(panel);

  // ─────────────────────────────────────────────────────────────
  // Existing functionality preserved below.
  // ─────────────────────────────────────────────────────────────

  document.getElementById('fpSaveVariant')?.addEventListener('click', async () => {
    if (!perms.canManage) return;
    await window._fumocaSaveVariant?.();
    updateDock();
  });

  document.getElementById('fpCopyEmbed')?.addEventListener('click', async () => {
    const embedUrl = window._fumocaCreateEmbedUrl?.() || location.href;
    const code = `<iframe src="${embedUrl}" style="width:100%;height:100%;border:0;" allowfullscreen loading="lazy"></iframe>`;
    try {
      await navigator.clipboard.writeText(code);
    } catch (_) {}
  });

  document.getElementById('fpStartTour')?.addEventListener('click', () => {
    window._fumocaTour?.start?.();
  });

  document.getElementById('fpStopTour')?.addEventListener('click', () => {
    window._fumocaTour?.stop?.();
  });

  document.getElementById('fpApiMap')?.addEventListener('click', () => {
    alert(JSON.stringify(window._fumocaApi || {}, null, 2));
  });

  document.getElementById('fpCloseNested')?.addEventListener('click', () => {
    document.getElementById('nestedSplatClose')?.click();
  });

  document.getElementById('fpAutoClean')?.addEventListener('click', () => {
    const mode = (
      window._fumocaCurrentRecord?.category ||
      window._fumocaCurrentRecord?.metadata?.scene_mode ||
      'product'
    ).toString().toLowerCase();

    const mapped =
      mode.includes('car')
        ? 'car'
        : mode.includes('estate') || mode.includes('room')
          ? 'real_estate'
          : mode.includes('person')
            ? 'person'
            : 'product';

    window._fumocaApplyAutoCleanPreset?.(mapped);
  });

  document.getElementById('fpMeshPrep')?.addEventListener('click', () => {
    window._fumocaQueuePipeline?.('mesh_cleanup');
  });

  document.getElementById('fpPrintPrep')?.addEventListener('click', () => {
    window._fumocaQueuePipeline?.('print_prep');
  });

  document.getElementById('fpLoadLook')?.addEventListener('click', () => {
    document.getElementById('loadLookBtn')?.click();
  });
}
function init() {
  applyEmbedMode();
  updateDock();
  window.addEventListener('fumoca:permissionsUpdated', updateDock);
  window.addEventListener('fumoca:variantsUpdated', updateDock);
  window.addEventListener('fumoca:pipelineQueued', updateDock);
  window.addEventListener('fumoca:recordLoaded', updateDock);
  window.addEventListener('fumoca:sessionReady', updateDock);
}

init();

