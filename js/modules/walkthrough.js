/**
 * FUMOCA Walkthrough — outside → inside (property & vehicle)
 *
 * Beats flat “one room” viewers by linking multiple spatial captures:
 *   exterior → front door → living room → kitchen → …
 *   exterior car → open door → interior cabin → boot
 *
 * Data model (splat.metadata.walkthrough or NIF interaction graph):
 * {
 *   spaces: [
 *     { id: 'ext', label: 'Exterior', splatId: '...', kind: 'exterior' },
 *     { id: 'living', label: 'Living room', splatId: '...', kind: 'room' },
 *     { id: 'cabin', label: 'Cabin', splatId: '...', kind: 'interior' }
 *   ],
 *   portals: [
 *     {
 *       id: 'p1',
 *       from: 'ext',
 *       to: 'living',
 *       label: 'Enter home',
 *       // hotspot position in FROM space (percent or world later)
 *       x: 50, y: 55,
 *       // optional: camera pose after enter
 *       enterPose: null
 *     }
 *   ],
 *   start: 'ext'
 * }
 *
 * Transition: fade → load target splat (nested_splat / navigation) → fade in.
 * Uses existing hotspot-actions nested_splat + portal overlay patterns.
 */

const DEFAULT_FADE_MS = 480;

let graph = null;
let currentSpaceId = null;
let transitioning = false;

export function loadWalkthroughGraph(meta = {}) {
  graph = meta.walkthrough || meta.spacesGraph || null;
  if (!graph?.spaces?.length) {
    currentSpaceId = null;
    return null;
  }
  currentSpaceId = graph.start || graph.spaces[0].id;
  return graph;
}

export function getCurrentSpace() {
  if (!graph) return null;
  return graph.spaces.find((s) => s.id === currentSpaceId) || null;
}

export function listSpaces() {
  return graph?.spaces || [];
}

export function portalsFromHere() {
  if (!graph || !currentSpaceId) return [];
  return (graph.portals || []).filter((p) => p.from === currentSpaceId);
}

export function portalsToHere() {
  if (!graph || !currentSpaceId) return [];
  return (graph.portals || []).filter((p) => p.to === currentSpaceId);
}

function ensureFade() {
  let el = document.getElementById('fumocaWalkFade');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'fumocaWalkFade';
  el.style.cssText = `
    position:fixed;inset:0;z-index:100;pointer-events:none;
    background:#05070b;opacity:0;transition:opacity ${DEFAULT_FADE_MS}ms ease;
  `;
  document.body.appendChild(el);
  return el;
}

async function fadeOut() {
  const el = ensureFade();
  el.style.pointerEvents = 'auto';
  el.style.opacity = '1';
  await new Promise((r) => setTimeout(r, DEFAULT_FADE_MS));
}

async function fadeIn() {
  const el = ensureFade();
  el.style.opacity = '0';
  await new Promise((r) => setTimeout(r, DEFAULT_FADE_MS));
  el.style.pointerEvents = 'none';
}

/**
 * Navigate to a space by id. Calls onNavigate({ space, splatId }) so the
 * host viewer can swap the loaded splat / NIF.
 */
export async function enterSpace(spaceId, { onNavigate, onStatus } = {}) {
  if (!graph || transitioning) return false;
  const space = graph.spaces.find((s) => s.id === spaceId);
  if (!space) {
    onStatus?.('Space not found');
    return false;
  }
  if (space.id === currentSpaceId && !onNavigate) return true;

  transitioning = true;
  onStatus?.(`Entering ${space.label}…`);
  await fadeOut();

  currentSpaceId = space.id;
  document.dispatchEvent(
    new CustomEvent('fumoca:walkthrough:enter', {
      detail: { space, graph },
    })
  );

  try {
    if (typeof onNavigate === 'function') {
      await onNavigate({ space, splatId: space.splatId, nifUrl: space.nifUrl });
    } else if (space.splatId) {
      // Default: reload viewer with new splatId (same page)
      const url = new URL(location.href);
      url.searchParams.set('splatId', space.splatId);
      url.searchParams.set('space', space.id);
      if (space.kind) url.searchParams.set('spaceKind', space.kind);
      location.href = url.toString();
      return true;
    }
  } finally {
    await fadeIn();
    transitioning = false;
    onStatus?.(`You’re in ${space.label}`);
  }
  return true;
}

export async function traversePortal(portalId, opts = {}) {
  if (!graph) return false;
  const portal = graph.portals.find((p) => p.id === portalId);
  if (!portal) return false;
  if (portal.from !== currentSpaceId) {
    // Allow jump if already mid-tour
  }
  return enterSpace(portal.to, opts);
}

/**
 * Build hotspot list for the current space from portals (Enter / Exit).
 */
export function hotspotsForCurrentSpace() {
  return portalsFromHere().map((p) => {
    const dest = graph.spaces.find((s) => s.id === p.to);
    return {
      id: `portal_${p.id}`,
      title: p.label || `Go to ${dest?.label || p.to}`,
      x: p.x ?? 50,
      y: p.y ?? 50,
      actions: [
        {
          id: `go_${p.id}`,
          label: p.label || 'Enter',
          icon: dest?.kind === 'exterior' ? '🚪' : '➡️',
          action: {
            type: 'walkthrough',
            portalId: p.id,
            to: p.to,
          },
        },
      ],
    };
  });
}

/**
 * Property template: exterior + rooms
 */
export function propertyWalkthroughTemplate({ exteriorSplatId, rooms = [] }) {
  const spaces = [
    { id: 'ext', label: 'Exterior', splatId: exteriorSplatId, kind: 'exterior' },
    ...rooms.map((r, i) => ({
      id: r.id || `room_${i}`,
      label: r.label || `Room ${i + 1}`,
      splatId: r.splatId,
      kind: 'room',
    })),
  ];
  const portals = rooms.map((r, i) => ({
    id: `p_ext_${i}`,
    from: 'ext',
    to: r.id || `room_${i}`,
    label: r.enterLabel || `Enter ${r.label || 'room'}`,
    x: r.x ?? 40 + i * 15,
    y: r.y ?? 55,
  }));
  // Return paths
  rooms.forEach((r, i) => {
    portals.push({
      id: `p_back_${i}`,
      from: r.id || `room_${i}`,
      to: 'ext',
      label: 'Back to exterior',
      x: 50,
      y: 80,
    });
  });
  return { start: 'ext', spaces, portals };
}

/**
 * Vehicle template: exterior ↔ cabin (± boot)
 */
export function vehicleWalkthroughTemplate({
  exteriorSplatId,
  cabinSplatId,
  bootSplatId,
} = {}) {
  const spaces = [
    { id: 'car_ext', label: 'Exterior', splatId: exteriorSplatId, kind: 'exterior' },
  ];
  const portals = [];
  if (cabinSplatId) {
    spaces.push({ id: 'cabin', label: 'Interior', splatId: cabinSplatId, kind: 'interior' });
    portals.push(
      {
        id: 'p_in',
        from: 'car_ext',
        to: 'cabin',
        label: 'Step inside',
        x: 35,
        y: 55,
      },
      {
        id: 'p_out',
        from: 'cabin',
        to: 'car_ext',
        label: 'Exit vehicle',
        x: 50,
        y: 75,
      }
    );
  }
  if (bootSplatId) {
    spaces.push({ id: 'boot', label: 'Boot', splatId: bootSplatId, kind: 'interior' });
    portals.push(
      {
        id: 'p_boot',
        from: 'car_ext',
        to: 'boot',
        label: 'Open boot',
        x: 70,
        y: 60,
      },
      {
        id: 'p_boot_out',
        from: 'boot',
        to: 'car_ext',
        label: 'Close boot',
        x: 50,
        y: 75,
      }
    );
  }
  return { start: 'car_ext', spaces, portals };
}

/**
 * Mini map / space switcher UI
 */
export function mountWalkthroughUI(container, { onNavigate, onStatus } = {}) {
  if (!container || !graph) return;

  function render() {
    const spaces = listSpaces();
    const here = getCurrentSpace();
    container.innerHTML = `
      <div class="section">
        <div class="sec-head"><span class="sec-label">Walkthrough</span><span class="sec-badge">SPACES</span></div>
        <div class="sec-body">
          <div class="hint">Move outside → inside like Matterport, with Gaussian quality and openable objects.</div>
          <div style="font-size:12px;color:rgba(255,255,255,.5);margin-bottom:8px">
            Now: <strong style="color:#c8ff00">${here?.label || '—'}</strong>
          </div>
          <div id="wtSpaceList" style="display:flex;flex-direction:column;gap:6px"></div>
        </div>
      </div>`;
    const list = container.querySelector('#wtSpaceList');
    spaces.forEach((s) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ac-btn full' + (s.id === currentSpaceId ? ' lime' : '');
      btn.textContent =
        (s.kind === 'exterior' ? '🏠 ' : s.kind === 'interior' ? '🪑 ' : '➡️ ') + s.label;
      btn.addEventListener('click', () =>
        enterSpace(s.id, { onNavigate, onStatus }).then(() => render())
      );
      list.appendChild(btn);
    });
  }

  render();
  document.addEventListener('fumoca:walkthrough:enter', () => render());
  return { render, enterSpace, traversePortal };
}

/** Handle action type walkthrough from hotspot-actions */
export async function handleWalkthroughAction(action, opts) {
  if (action.portalId) return traversePortal(action.portalId, opts);
  if (action.to) return enterSpace(action.to, opts);
  return false;
}

if (typeof window !== 'undefined') {
  window.FUMOCA_Walkthrough = {
    loadWalkthroughGraph,
    getCurrentSpace,
    listSpaces,
    portalsFromHere,
    enterSpace,
    traversePortal,
    hotspotsForCurrentSpace,
    propertyWalkthroughTemplate,
    vehicleWalkthroughTemplate,
    mountWalkthroughUI,
    handleWalkthroughAction,
  };
}
