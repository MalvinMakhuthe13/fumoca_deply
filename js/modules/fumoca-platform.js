
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
  dock.appendChild(platformCard);

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
    dock.appendChild(opsCard);
  }

  document.getElementById('fpSaveVariant')?.addEventListener('click', async () => {
    if (!perms.canManage) return;
    await window._fumocaSaveVariant?.();
    updateDock();
  });
  document.getElementById('fpCopyEmbed')?.addEventListener('click', async () => {
    const embedUrl = window._fumocaCreateEmbedUrl?.() || location.href;
    const code = `<iframe src="${embedUrl}" style="width:100%;height:100%;border:0;" allowfullscreen loading="lazy"></iframe>`;
    try { await navigator.clipboard.writeText(code); } catch (_) {}
  });
  document.getElementById('fpStartTour')?.addEventListener('click', () => window._fumocaTour?.start?.());
  document.getElementById('fpStopTour')?.addEventListener('click', () => window._fumocaTour?.stop?.());
  document.getElementById('fpApiMap')?.addEventListener('click', () => {
    alert(JSON.stringify(window._fumocaApi || {}, null, 2));
  });
  document.getElementById('fpCloseNested')?.addEventListener('click', () => document.getElementById('nestedSplatClose')?.click());
  document.getElementById('fpAutoClean')?.addEventListener('click', () => {
    const mode = (window._fumocaCurrentRecord?.category || window._fumocaCurrentRecord?.metadata?.scene_mode || 'product').toString().toLowerCase();
    const mapped = mode.includes('car') ? 'car' : mode.includes('estate') || mode.includes('room') ? 'real_estate' : mode.includes('person') ? 'person' : 'product';
    window._fumocaApplyAutoCleanPreset?.(mapped);
  });
  document.getElementById('fpMeshPrep')?.addEventListener('click', () => window._fumocaQueuePipeline?.('mesh_cleanup'));
  document.getElementById('fpPrintPrep')?.addEventListener('click', () => window._fumocaQueuePipeline?.('print_prep'));
  document.getElementById('fpLoadLook')?.addEventListener('click', () => document.getElementById('loadLookBtn')?.click());
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
