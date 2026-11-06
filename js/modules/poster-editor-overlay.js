/**
 * FUMOCA Poster Editor Overlay
 * Studio-only direct manipulation controls over the real 3D viewport.
 */
const STYLE_ID = 'fumocaPosterEditorOverlayStyles';
const ROOT_ID = 'fumocaPosterEditorOverlay';
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

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
    #${ROOT_ID} .fpe-select{width:28px;height:28px;transform:translate(-50%,-50%);background:rgba(8,10,14,.72);border:1px solid rgba(212,255,0,.8);color:#d4ff00;font:700 11px/1 system-ui,sans-serif}
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
  const refresh = () => {
    const state = api.getState(), composition = state?.composition || {};
    root.hidden = !state?.enabled;
    if (!state?.enabled) return;
    const bounds = host.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const poster = calculatePosterEditorFrame(bounds.width, bounds.height, composition.aspectRatio || 4 / 5);
    rect = poster;
    Object.assign(frame.style, { left: poster.left+'px', top: poster.top+'px', width: poster.width+'px', height: poster.height+'px' });
    // The poster viewport already renders the live headline; do not paint a second copy here.
    const subjects = composition.subjects || [];
    pickLayer.replaceChildren();
    const hostRect = host.getBoundingClientRect();
    const projectedTargets = window.FumocaPosterPicking?.getTargets?.() || [];
    for (const candidate of subjects) {
      if (!candidate.visible || candidate.id === state.selectedSubjectId) continue;
      const projected = projectedTargets.find(target => target.id === candidate.id);
      const pick = document.createElement('button');
      pick.type = 'button'; pick.className = 'fpe-control fpe-select';
      pick.textContent = String(candidate.label || '3D').trim().slice(0, 2).toUpperCase();
      pick.setAttribute('aria-label', 'Select ' + (candidate.label || '3D object'));
      pick.title = 'Select ' + (candidate.label || '3D object');
      pick.style.left = (projected ? projected.x - hostRect.left : poster.left + clamp(Number(candidate.x ?? .5),0,1)*poster.width) + 'px';
      pick.style.top = (projected ? projected.y - hostRect.top : poster.top + clamp(Number(candidate.y ?? .53),0,1)*poster.height) + 'px';
      pick.addEventListener('click', () => { api.selectSubject?.(candidate.id); refresh(); });
      pickLayer.appendChild(pick);
    }
    const subject = selectedSubject(), x=clamp(Number(subject.x??.5),0,1), y=clamp(Number(subject.y??.53),0,1);
    const px=poster.left+x*poster.width, py=poster.top+y*poster.height;
    moveHandle.style.left=px+'px'; moveHandle.style.top=py+'px';
    const radians=(Number(subject.rotation)||0)*Math.PI/180, radius=clamp(42*(Number(subject.scale)||1),34,100);
    scaleHandle.style.left=(px+Math.cos(radians)*radius)+'px'; scaleHandle.style.top=(py+Math.sin(radians)*radius)+'px';
    rotateHandle.style.left=(px+Math.cos(radians-Math.PI/2)*(radius+26))+'px'; rotateHandle.style.top=(py+Math.sin(radians-Math.PI/2)*(radius+26))+'px';
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
    if(g.mode==='move') patchSelected({x:clamp(g.origin.x+(p.x-g.start.x)/rect.width,0,1),y:clamp(g.origin.y+(p.y-g.start.y)/rect.height,0,1)});
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
    if (root.contains(event.target) || event.button !== 0) { pickPointer = null; return; }
    pickPointer = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
  };
  const onPickPointerUp = event => {
    if (!pickPointer || pickPointer.pointerId !== event.pointerId) return;
    const start = pickPointer; pickPointer = null;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 7) return;
    const picked = window.FumocaPosterPicking?.pick?.(event.clientX, event.clientY);
    if (picked?.id) { api.selectSubject?.(picked.id); refresh(); }
  };
  host.addEventListener('pointerdown',onPickPointerDown,true);
  host.addEventListener('pointerup',onPickPointerUp,true);
  const onChange=()=>refresh();window.addEventListener('fumoca:posterChange',onChange);window.addEventListener('resize',onChange);
  const observer=typeof ResizeObserver!=='undefined'?new ResizeObserver(refresh):null;observer?.observe(host);refresh();
  return {root,refresh,destroy(){observer?.disconnect();host.removeEventListener('pointerdown',onPickPointerDown,true);host.removeEventListener('pointerup',onPickPointerUp,true);window.removeEventListener('fumoca:posterChange',onChange);window.removeEventListener('resize',onChange);for(const {handle,down} of bindings){handle.removeEventListener('pointerdown',down);handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',stop);handle.removeEventListener('pointercancel',stop);}moveHandle.removeEventListener('keydown',keyMove);root.remove();}};
}
