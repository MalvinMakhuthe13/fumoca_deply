/**
 * FUMOCA Poster Editor Overlay
 * Studio-only direct manipulation controls over the real 3D viewport.
 */
const STYLE_ID = 'fumocaPosterEditorOverlayStyles';
const ROOT_ID = 'fumocaPosterEditorOverlay';
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const clampToFrame = (value, start, size, inset = 16) =>
  clamp(value, start + Math.min(inset, size / 2), start + size - Math.min(inset, size / 2));

export function calculatePosterEditorFrame(width, height, aspect) {
  const safeAspect = Number(aspect) > 0 ? Number(aspect) : 4 / 5;
  let w = width, h = w / safeAspect;
  if (h > height) { h = height; w = h * safeAspect; }
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
    #${ROOT_ID} .fpe-control{position:absolute;pointer-events:auto;touch-action:none;display:grid;place-items:center;color:#10130a;background:#d4ff00;border:2px solid #fff;border-radius:50%;box-shadow:0 2px 14px #0009;cursor:grab}
    #${ROOT_ID} .fpe-subject{width:34px;height:34px;transform:translate(-50%,-50%);background:rgba(8,10,14,.8);border:2px solid #d4ff00;color:#d4ff00}
    #${ROOT_ID} .fpe-select{min-width:28px;min-height:28px;transform:translate(-50%,-50%);border-radius:10px;background:rgba(212,255,0,.035);border:1px solid rgba(212,255,0,.0);color:transparent;font:700 11px/1 system-ui,sans-serif;opacity:.0;transition:opacity .12s,border-color .12s,background .12s}
    #${ROOT_ID} .fpe-select:hover,#${ROOT_ID} .fpe-select.is-hovered{opacity:1;border:2px solid #d4ff00;background:rgba(212,255,0,.09);color:#d4ff00;box-shadow:0 0 0 1px #080a0e,0 0 22px rgba(212,255,0,.25);cursor:grab}
    #${ROOT_ID} .fpe-select.is-selected{opacity:1;border:2px solid #d4ff00;background:rgba(212,255,0,.07);color:#d4ff00}
    #${ROOT_ID} .fpe-subject:before,#${ROOT_ID} .fpe-subject:after{content:"";position:absolute;background:#d4ff00;left:50%;top:50%;transform:translate(-50%,-50%)}
    #${ROOT_ID} .fpe-subject:before{width:48px;height:1px}#${ROOT_ID} .fpe-subject:after{width:1px;height:48px}
    #${ROOT_ID} .fpe-scale{width:22px;height:22px;transform:translate(-50%,-50%);font:700 15px/1 system-ui}
    #${ROOT_ID} .fpe-rotate{width:22px;height:22px;transform:translate(-50%,-50%);font:700 15px/1 system-ui}
    #${ROOT_ID} .fpe-control:active{cursor:grabbing}
    #${ROOT_ID} .fpe-hint{position:absolute;right:8px;bottom:8px;padding:5px 8px;border:1px solid rgba(255,255,255,.14);border-radius:6px;background:rgba(8,10,14,.88);color:rgba(255,255,255,.82);font:10px/1.4 system-ui,sans-serif}
    #${ROOT_ID}[hidden]{display:none}
  `;
  document.head.appendChild(style);
}

/** Mounts direct move, resize and rotate controls over the live Studio viewport. */
export function mountPosterEditorOverlay(options = {}) {
  const host = options.host || document.getElementById('viewport');
  const api = options.api || window.FumocaPoster;
  if (!host || !api?.getState || !api?.updateComposition) return null;
  ensureStyles();
  let root = host.querySelector('#' + ROOT_ID);
  if (!root) {
    root = document.createElement('div');
    root.id = ROOT_ID;
    root.innerHTML = '<div class="fpe-frame"></div><div class="fpe-pick-layer" aria-label="3D object selection"></div><button type="button" class="fpe-control fpe-subject" aria-label="Drag selected 3D object"></button><button type="button" class="fpe-control fpe-scale" aria-label="Drag to resize selected object">↗</button><button type="button" class="fpe-control fpe-rotate" aria-label="Drag to rotate selected object">↻</button><div class="fpe-hint">Select an object on the poster · Drag centre to move · ↗ resize · ↻ rotate</div>';
    host.appendChild(root);
  }
  const frame = root.querySelector('.fpe-frame');
  const pickLayer = root.querySelector('.fpe-pick-layer');
  const moveHandle = root.querySelector('.fpe-subject');
  const scaleHandle = root.querySelector('.fpe-scale');
  const rotateHandle = root.querySelector('.fpe-rotate');
  let rect = null, gesture = null;

  const selectedSubject = () => {
    const state = api.getState();
    return (state.composition?.subjects || []).find(item => item.id === state.selectedSubjectId) ||
      (state.composition?.subjects || []).find(item => item.id === 'subject_main') ||
      { id: 'subject_main', ...state.composition.object };
  };
  const patchSelected = patch => {
    const subject = selectedSubject();
    if (subject.locked) return;
    if (typeof api.updateSubject === 'function') api.updateSubject(subject.id, patch);
    else api.updateComposition({ object: patch });
  };
  const pickPosterSubject = (clientX, clientY) => {
    const precise = window.FumocaPosterPicking?.pick?.(clientX, clientY);
    if (precise?.id) return precise;
    // Fallback to each subject's saved poster anchor when the renderer has not
    // published screen-space bounds yet (e.g. during a viewer remount).
    if (!rect?.width || !rect?.height) return null;
    const bounds = host.getBoundingClientRect();
    const radius = Math.max(48, Math.min(rect.width, rect.height) * 0.24);
    return (api.getState().composition?.subjects || [])
      .filter(item => item.visible !== false)
      .map(item => ({
        id: item.id,
        distance: Math.hypot(
          clientX - (bounds.left + rect.left + Number(item.x ?? .5) * rect.width),
          clientY - (bounds.top + rect.top + Number(item.y ?? .53) * rect.height)
        ),
      }))
      .filter(item => item.distance <= radius)
      .sort((a,b) => a.distance - b.distance)[0] || null;
  };
  const refresh = () => {
    const state = api.getState(), composition = state?.composition || {};
    root.hidden = !state?.enabled;
    if (!state?.enabled) return;
    const bounds = host.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    // Prefer the real poster canvas bounds so the frame matches the adapting layer.
    const canvas = host.querySelector('[data-fumoca-poster-canvas]');
    let poster;
    if (canvas) {
      const c = canvas.getBoundingClientRect();
      poster = { left: c.left - bounds.left, top: c.top - bounds.top, width: c.width, height: c.height };
    } else {
      poster = calculatePosterEditorFrame(bounds.width, bounds.height, composition.aspectRatio || 4 / 5);
    }
    rect = poster;
    Object.assign(frame.style, { left: poster.left+'px', top: poster.top+'px', width: poster.width+'px', height: poster.height+'px' });
    // The poster viewport already renders the live headline; do not paint a second copy here.
    const subjects = composition.subjects || [];
    if (!pickPointer) pickLayer.replaceChildren();
    const hostRect = host.getBoundingClientRect();
    const projectedTargets = window.FumocaPosterPicking?.getTargets?.() || [];
    for (const candidate of subjects) {
      if (pickPointer || !candidate.visible) continue;
      const projected = projectedTargets.find(target => target.id === candidate.id);
      const pick = document.createElement('button');
      pick.type = 'button'; pick.className = 'fpe-control fpe-select';
      pick.textContent = String(candidate.label || '3D').trim().slice(0, 2).toUpperCase();
      pick.setAttribute('aria-label', 'Select ' + (candidate.label || '3D object'));
      pick.title = 'Select ' + (candidate.label || '3D object');
      pick.style.left = clampToFrame(projected ? projected.x - hostRect.left : poster.left + clamp(Number(candidate.x ?? .5),0,1)*poster.width, poster.left, poster.width) + 'px';
      pick.style.top = clampToFrame(projected ? projected.y - hostRect.top : poster.top + clamp(Number(candidate.y ?? .53),0,1)*poster.height, poster.top, poster.height) + 'px';
      if (projected?.width && projected?.height) {
        pick.style.width = Math.min(projected.width, poster.width * .92) + 'px';
        pick.style.height = Math.min(projected.height, poster.height * .92) + 'px';
        pick.style.maxWidth = poster.width * .92 + 'px';
        pick.style.maxHeight = poster.height * .92 + 'px';
      }
      if (candidate.id === state.selectedSubjectId) pick.classList.add('is-selected');
      pick.addEventListener('click', () => { api.selectSubject?.(candidate.id); refresh(); });
      pickLayer.appendChild(pick);
    }
    const subject = selectedSubject();
    // The subject anchor may sit anywhere on the poster, including its edges.
    // The renderer clips the 3D image to the poster frame, so edge cropping is intentional.
    const x=clamp(Number(subject.x??.5),0,1);
    const y=clamp(Number(subject.y??.53),0,1);
    const px=clampToFrame(poster.left+x*poster.width, poster.left, poster.width, 22);
    const py=clampToFrame(poster.top+y*poster.height, poster.top, poster.height, 22);
    moveHandle.style.left=px+'px'; moveHandle.style.top=py+'px';
    const radians=(Number(subject.rotation)||0)*Math.PI/180, radius=clamp(42*(Number(subject.scale)||1),34,100);
    scaleHandle.style.left=clampToFrame(px+Math.cos(radians)*radius, poster.left, poster.width, 14)+'px';
    scaleHandle.style.top=clampToFrame(py+Math.sin(radians)*radius, poster.top, poster.height, 14)+'px';
    rotateHandle.style.left=clampToFrame(px+Math.cos(radians-Math.PI/2)*(radius+26), poster.left, poster.width, 14)+'px';
    rotateHandle.style.top=clampToFrame(py+Math.sin(radians-Math.PI/2)*(radius+26), poster.top, poster.height, 14)+'px';
    for (const handle of [moveHandle,scaleHandle,rotateHandle]) handle.disabled=!!subject.locked;
    moveHandle.title=subject.label+(subject.locked?' · Locked':' · Move');
    moveHandle.setAttribute('aria-label','Move '+subject.label);
  };
  const point = event => {
    const bounds=host.getBoundingClientRect();
    return {x:event.clientX-bounds.left,y:event.clientY-bounds.top};
  };
  const start = mode => event => {
    if (root.hidden || event.button!==0) return;
    const subject=selectedSubject(); if(subject.locked) return;
    const p=point(event);
    gesture={mode,pointerId:event.pointerId,start:p,origin:{x:Number(subject.x??.5),y:Number(subject.y??.53),scale:Number(subject.scale??1),rotation:Number(subject.rotation)||0},center:{x:rect.left+Number(subject.x??.5)*rect.width,y:rect.top+Number(subject.y??.53)*rect.height}};
    event.currentTarget.setPointerCapture?.(event.pointerId); event.preventDefault();
  };
  const move = event => {
    if(!gesture || event.pointerId!==gesture.pointerId || !rect) return;
    const p=point(event), g=gesture;
    if(g.mode==='move') {
      patchSelected({
        x:clamp(g.origin.x+(p.x-g.start.x)/rect.width,0,1),
        y:clamp(g.origin.y+(p.y-g.start.y)/rect.height,0,1),
      });
    }
    else {
      const a=Math.atan2(p.y-g.center.y,p.x-g.center.x)*180/Math.PI;
      const startA=Math.atan2(g.start.y-g.center.y,g.start.x-g.center.x)*180/Math.PI;
      if(g.mode==='scale') {
        const startD=Math.max(12,Math.hypot(g.start.x-g.center.x,g.start.y-g.center.y));
        const nextD=Math.hypot(p.x-g.center.x,p.y-g.center.y);
        patchSelected({scale:clamp(g.origin.scale*(nextD/startD),.1,4)});
      } else patchSelected({rotation:clamp(g.origin.rotation+(a-startA),-360,360)});
    }
    refresh(); options.onChange?.(selectedSubject());
  };
  const stop = event => {
    if(!gesture || event.pointerId!==gesture.pointerId) return;
    gesture=null; options.onCommit?.();
  };
  const keyMove = event => {
    const subject=selectedSubject(); if(subject.locked) return;
    const step=event.shiftKey?.02:.005; let {x,y}=subject;
    if(event.key==='ArrowLeft')x-=step;else if(event.key==='ArrowRight')x+=step;else if(event.key==='ArrowUp')y-=step;else if(event.key==='ArrowDown')y+=step;else return;
    event.preventDefault();patchSelected({x:clamp(x,0,1),y:clamp(y,0,1)});refresh();options.onCommit?.();
  };
  const bindings=[[moveHandle,'move'],[scaleHandle,'scale'],[rotateHandle,'rotate']].map(([handle,mode])=>({handle,down:start(mode)}));
  for(const {handle,down} of bindings){handle.addEventListener('pointerdown',down);handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',stop);handle.addEventListener('pointercancel',stop);}
  moveHandle.addEventListener('keydown',keyMove);
  let pickPointer = null;
  const onPickPointerDown = event => {
    const pickButton = event.target?.closest?.('.fpe-select');
    if ((root.contains(event.target) && !pickButton) || event.button !== 0 || event.altKey) { pickPointer = null; return; }
    const state = api.getState();
    if (!state?.enabled) return;
    const studioMode = window.S?.mode || window._fumocaStudioMode || 'orbit';
    // Do not require the event target to be a CANVAS: background/image layers,
    // transparent overlays and renderer remounts can place another element
    // above the WebGL canvas. The host capture listener already scopes input
    // to this viewport; additionally keep the gesture inside the poster frame.
    if (!rect?.width || !rect?.height) return;
    const bounds = host.getBoundingClientRect();
    const localX = event.clientX - bounds.left;
    const localY = event.clientY - bounds.top;
    if (localX < rect.left || localX > rect.left + rect.width ||
        localY < rect.top || localY > rect.top + rect.height) return;
    const picked = window.FumocaPosterPicking?.pick?.(event.clientX, event.clientY) || pickPosterSubject(event.clientX, event.clientY);
    const subjects = state.composition?.subjects || [];
    const subject = subjects.find(item => item.id === (pickButton?.dataset?.id || picked?.id)) ||
      subjects.find(item => item.id === state.selectedSubjectId) ||
      subjects.find(item => item.id === 'subject_main');
    if (!subject) return;
    if (studioMode !== 'move' || subject.locked) {
      api.selectSubject?.(subject.id);
      refresh();
      return;
    }
    pickPointer = {
      id: subject.id, x: event.clientX, y: event.clientY,
      pointerId: event.pointerId, moved: false,
      origin: { x: Number(subject.x ?? .5), y: Number(subject.y ?? .53) },
    };
    try { event.target.setPointerCapture?.(event.pointerId); } catch (_) {}
    api.selectSubject?.(subject.id);
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const onPickPointerMove = event => {
    if (!pickPointer || pickPointer.pointerId !== event.pointerId) return;
    const dx = event.clientX - pickPointer.x, dy = event.clientY - pickPointer.y;
    if (!pickPointer.moved && Math.hypot(dx, dy) < 5) return;
    pickPointer.moved = true;
    const subject = (api.getState().composition?.subjects || []).find(item => item.id === pickPointer.id);
    if (!subject || subject.locked || !rect?.width || !rect?.height) return;
    api.selectSubject?.(pickPointer.id);
    api.updateSubject?.(pickPointer.id, {
      x: clamp(pickPointer.origin.x + dx / rect.width, 0, 1),
      y: clamp(pickPointer.origin.y + dy / rect.height, 0, 1),
    });
    refresh();
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const onPickPointerUp = event => {
    if (!pickPointer || pickPointer.pointerId !== event.pointerId) return;
    const start = pickPointer; pickPointer = null;
    if (start.moved || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 7) {
      options.onCommit?.();
      refresh();
      return;
    }
    api.selectSubject?.(start.id);
    refresh();
  };
  const onPickPointerCancel = event => {
    if (pickPointer?.pointerId === event.pointerId) pickPointer = null;
  };
  host.addEventListener('pointerdown',onPickPointerDown,true);
  host.addEventListener('pointermove',onPickPointerMove,true);
  host.addEventListener('pointerup',onPickPointerUp,true);
  host.addEventListener('pointercancel',onPickPointerCancel,true);
  const onChange=()=>refresh();window.addEventListener('fumoca:posterChange',onChange);window.addEventListener('resize',onChange);
  const observer=typeof ResizeObserver!=='undefined'?new ResizeObserver(refresh):null;observer?.observe(host);refresh();
  return {root,refresh,destroy(){observer?.disconnect();host.removeEventListener('pointerdown',onPickPointerDown,true);host.removeEventListener('pointermove',onPickPointerMove,true);host.removeEventListener('pointerup',onPickPointerUp,true);host.removeEventListener('pointercancel',onPickPointerCancel,true);window.removeEventListener('fumoca:posterChange',onChange);window.removeEventListener('resize',onChange);for(const {handle,down} of bindings){handle.removeEventListener('pointerdown',down);handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',stop);handle.removeEventListener('pointercancel',stop);}moveHandle.removeEventListener('keydown',keyMove);root.remove();}};
}
