/**
 * FUMOCA Poster Editor Overlay
 * Studio-only direct manipulation layer over the real editor viewport.
 * It never creates a substitute render: the existing 3D viewport remains visible.
 */
const STYLE_ID = 'fumocaPosterEditorOverlayStyles';
const ROOT_ID = 'fumocaPosterEditorOverlay';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function calculatePosterEditorFrame(width, height, aspect) {
  const safeAspect = Number(aspect) > 0 ? Number(aspect) : 4 / 5;
  let w = width;
  let h = w / safeAspect;
  if (h > height) {
    h = height;
    w = h * safeAspect;
  }
  return { left: (width - w) / 2, top: (height - h) / 2, width: w, height: h };
}

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${ROOT_ID}{position:absolute;inset:0;z-index:30;pointer-events:none;overflow:hidden}
    #${ROOT_ID} .fpe-frame{position:absolute;border:1px solid rgba(200,255,0,.72);box-shadow:0 0 0 9999px rgba(0,0,0,.16);pointer-events:none}
    #${ROOT_ID} .fpe-frame:before{content:"POSTER SAFE FRAME";position:absolute;left:8px;top:7px;padding:3px 6px;border-radius:4px;background:rgba(8,10,14,.82);color:#d9ff67;font:700 8px/1.2 system-ui,sans-serif;letter-spacing:.12em}
    #${ROOT_ID} .fpe-subject{position:absolute;width:34px;height:34px;transform:translate(-50%,-50%);border:2px solid #d4ff00;border-radius:50%;background:rgba(8,10,14,.55);box-shadow:0 0 0 5px rgba(212,255,0,.14),0 0 22px rgba(212,255,0,.28);pointer-events:auto;touch-action:none;cursor:grab}
    #${ROOT_ID} .fpe-subject:before,#${ROOT_ID} .fpe-subject:after{content:"";position:absolute;background:#d4ff00;left:50%;top:50%;transform:translate(-50%,-50%)}
    #${ROOT_ID} .fpe-subject:before{width:48px;height:1px}
    #${ROOT_ID} .fpe-subject:after{width:1px;height:48px}
    #${ROOT_ID} .fpe-subject:active{cursor:grabbing}
    #${ROOT_ID} .fpe-title{position:absolute;z-index:2;pointer-events:none;line-height:1.12;text-shadow:0 2px 18px rgba(0,0,0,.5);overflow-wrap:anywhere;white-space:pre-wrap}
    #${ROOT_ID} .fpe-hint{position:absolute;right:8px;bottom:8px;padding:5px 8px;border:1px solid rgba(255,255,255,.14);border-radius:6px;background:rgba(8,10,14,.82);color:rgba(255,255,255,.72);font:10px/1.3 system-ui,sans-serif}
    #${ROOT_ID}[hidden]{display:none}
  `;
  document.head.appendChild(style);
}

/**
 * Mounts an editor-only drag handle over the actual Studio viewport.
 * @returns {{refresh:Function,destroy:Function}|null}
 */
export function mountPosterEditorOverlay(options = {}) {
  const host = options.host || document.getElementById('viewport');
  const api = options.api || window.FumocaPoster;
  if (!host || !api?.getState || !api?.updateComposition) return null;
  ensureStyles();

  let root = host.querySelector('#' + ROOT_ID);
  if (!root) {
    root = document.createElement('div');
    root.id = ROOT_ID;
    root.innerHTML = '<div class="fpe-frame"></div><div class="fpe-title" aria-hidden="true"></div><div class="fpe-subject" role="slider" aria-label="Drag to position 3D subject" aria-valuemin="0" aria-valuemax="100" tabindex="0"></div><div class="fpe-hint">Drag the ring to position the real 3D subject</div>';
    host.appendChild(root);
  }
  const frame = root.querySelector('.fpe-frame');
  const titleNode = root.querySelector('.fpe-title');
  const handle = root.querySelector('.fpe-subject');
  let rect = null;
  let dragging = false;
  let pointerId = null;

  const refresh = () => {
    const state = api.getState();
    const composition = state?.composition || {};
    const enabled = !!state?.enabled;
    root.hidden = !enabled;
    if (!enabled) return;
    const bounds = host.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const poster = calculatePosterEditorFrame(bounds.width, bounds.height, composition.aspectRatio || state?.aspectRatio || 4 / 5);
    rect = poster;
    Object.assign(frame.style, {
      left: poster.left + 'px', top: poster.top + 'px',
      width: poster.width + 'px', height: poster.height + 'px',
    });
    const heading = composition.title || {};
    const headingText = String(heading.text || '').trim().slice(0, 160);
    if (heading.visible !== false && headingText) {
      const safeArea = clamp(Number(composition.safeArea) || 0, 0, 0.2);
      const inset = poster.width * safeArea;
      Object.assign(titleNode.style, {
        display: 'block',
        left: (poster.left + inset) + 'px',
        top: (poster.top + inset) + 'px',
        width: Math.max(0, poster.width - inset * 2) + 'px',
        textAlign: ['left', 'center', 'right'].includes(heading.align) ? heading.align : 'center',
        fontFamily: ['system-ui, sans-serif', 'Arial, sans-serif', 'Georgia, serif', 'Impact, sans-serif', 'monospace'].includes(heading.fontFamily) ? heading.fontFamily : 'system-ui, sans-serif',
        fontSize: clamp(Number(heading.fontSize) || 42, 12, 120) + 'px',
        fontWeight: String(clamp(Number(heading.weight) || 750, 400, 900)),
        color: /^#[0-9a-f]{6}$/i.test(String(heading.color || '')) ? heading.color : '#ffffff',
      });
      titleNode.textContent = headingText;
    } else {
      titleNode.style.display = 'none';
      titleNode.textContent = '';
    }
    const object = composition.object || {};
    const x = clamp(Number(object.x ?? .5), 0, 1);
    const y = clamp(Number(object.y ?? .53), 0, 1);
    handle.style.left = (poster.left + x * poster.width) + 'px';
    handle.style.top = (poster.top + y * poster.height) + 'px';
    handle.setAttribute('aria-valuenow', String(Math.round(x * 100)));
    handle.setAttribute('aria-valuetext', `X ${Math.round(x * 100)}%, Y ${Math.round(y * 100)}%`);
  };

  const move = (event) => {
    if (!dragging || !rect || (pointerId !== null && event.pointerId !== pointerId)) return;
    const bounds = host.getBoundingClientRect();
    const x = clamp((event.clientX - bounds.left - rect.left) / rect.width, 0, 1);
    const y = clamp((event.clientY - bounds.top - rect.top) / rect.height, 0, 1);
    api.updateComposition({ object: { x, y } });
    refresh();
    options.onChange?.({ x, y });
  };
  const stop = (event) => {
    if (!dragging || (pointerId !== null && event.pointerId !== pointerId)) return;
    dragging = false;
    pointerId = null;
    try { handle.releasePointerCapture(event.pointerId); } catch (_) {}
    options.onCommit?.();
  };
  const start = (event) => {
    if (root.hidden || event.button !== 0) return;
    dragging = true;
    pointerId = event.pointerId;
    try { handle.setPointerCapture(pointerId); } catch (_) {}
    event.preventDefault();
    move(event);
  };
  const keyMove = (event) => {
    const state = api.getState();
    const object = state?.composition?.object || {};
    const step = event.shiftKey ? .02 : .005;
    let x = Number(object.x ?? .5);
    let y = Number(object.y ?? .53);
    if (event.key === 'ArrowLeft') x -= step;
    else if (event.key === 'ArrowRight') x += step;
    else if (event.key === 'ArrowUp') y -= step;
    else if (event.key === 'ArrowDown') y += step;
    else return;
    event.preventDefault();
    api.updateComposition({ object: { x: clamp(x, 0, 1), y: clamp(y, 0, 1) } });
    refresh();
    options.onCommit?.();
  };

  handle.addEventListener('pointerdown', start);
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', stop);
  handle.addEventListener('pointercancel', stop);
  handle.addEventListener('keydown', keyMove);
  const onChange = () => refresh();
  window.addEventListener('fumoca:posterChange', onChange);
  window.addEventListener('resize', onChange);
  const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(refresh) : null;
  observer?.observe(host);
  refresh();

  return {
    refresh,
    destroy() {
      observer?.disconnect();
      window.removeEventListener('fumoca:posterChange', onChange);
      window.removeEventListener('resize', onChange);
      handle.removeEventListener('pointerdown', start);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', stop);
      handle.removeEventListener('pointercancel', stop);
      handle.removeEventListener('keydown', keyMove);
      root.remove();
    },
  };
}
