/**
 * FUMOCA Master Timeline Evaluator
 * Single deterministic evaluate(time).
 * Quaternion-canonical. Explicit component attachment. Robust loop wrap.
 * Scale preserved on attach/release.
 */
const FumocaMaster = (() => {
  const T = {
    duration: 10, time: 0, playing: false, speed: 1,
    loopStart: 0, loopEnd: null, raf: null, lastTs: 0,
    revision: 0,
    tracks: { camera: [], skeletons: new Map(), objects: new Map(), lights: new Map(), interactions: [], anchors: [], annotations: [] },
    bindings: { camera: null, skeletons: new Map(), objects: new Map(), lights: new Map() },
    attachmentState: new Map(),
  };

  function setCameraBinding(cam, controls) { T.bindings.camera = { cam, controls }; }
  function setSkeletonBinding(skelId, boneMap) { T.bindings.skeletons.set(skelId, { bones: boneMap }); }
  function setObjectBinding(objId, componentMap) { T.bindings.objects.set(objId, { components: componentMap }); }
  function addLight(light) { if (light?.id) T.tracks.lights.set(light.id, light); }
  function setLightBinding(lightId, threeLight) { T.bindings.lights.set(lightId, threeLight); }
  function setCameraTrack(states) {
    T.tracks.camera = Array.isArray(states) ? states.slice().sort((a,b) => (a.time_offset||0)-(b.time_offset||0)) : [];
  }
  function addSkeleton(skel) { if (skel?.id) T.tracks.skeletons.set(skel.id, skel); }
  function addObject(obj) {
    if (obj?.id) {
      T.tracks.objects.set(obj.id, obj);
      if (window.FumocaPhysics?.registerHierarchy && obj.components) {
        window.FumocaPhysics.registerHierarchy(obj.id, obj.components);
      }
    }
  }
  function setInteractions(events) { T.tracks.interactions = Array.isArray(events) ? events.slice().sort((a,b)=>a.time-b.time) : []; }
  function setAnchors(anchors) { T.tracks.anchors = Array.isArray(anchors) ? anchors.slice() : []; }
  function setAnnotations(anns) { T.tracks.annotations = Array.isArray(anns) ? anns.slice() : []; }
  function setDuration(d) { T.duration = Math.max(0.1, Number(d)||10); }
  function setSpeed(s) { T.speed = Math.max(0.01, Number(s)||1); }
  function setLoopRange(start, end) { T.loopStart = Math.max(0, Number(start)||0); T.loopEnd = end==null ? null : Math.max(T.loopStart, Number(end)); }

  function _lerp(a,b,t){ return a+(b-a)*t; }
  function _lerpVec(a,b,t){ if(!a||!b) return a||b||{x:0,y:0,z:0}; return {x:_lerp(a.x,b.x,t), y:_lerp(a.y,b.y,t), z:_lerp(a.z,b.z,t)}; }
  function _isQuat(r){ return r && typeof r.w === 'number'; }
  function _eulerToQuat(e){
    const rx=(e.x||0)*Math.PI/180, ry=(e.y||0)*Math.PI/180, rz=(e.z||0)*Math.PI/180;
    const cx=Math.cos(rx/2), sx=Math.sin(rx/2), cy=Math.cos(ry/2), sy=Math.sin(ry/2), cz=Math.cos(rz/2), sz=Math.sin(rz/2);
    return { x:sx*cy*cz-cx*sy*sz, y:cx*sy*cz+sx*cy*sz, z:cx*cy*sz-sx*sy*cz, w:cx*cy*cz+sx*sy*sz };
  }
  function _toQuat(r){ return _isQuat(r) ? r : _eulerToQuat(r || {x:0,y:0,z:0}); }
  function _normalizeQuat(q){
    const len = Math.hypot(q.x, q.y, q.z, q.w) || 1;
    return { x: q.x/len, y: q.y/len, z: q.z/len, w: q.w/len };
  }
  function _slerpQuat(q1, q2, t){
    if(!q1||!q2) return q1||q2||{x:0,y:0,z:0,w:1};
    let a = _normalizeQuat(q1), b = _normalizeQuat(q2);
    let dot = a.x*b.x + a.y*b.y + a.z*b.z + a.w*b.w;
    if (dot < 0) { b = { x:-b.x, y:-b.y, z:-b.z, w:-b.w }; dot = -dot; }
    if (dot > 0.9995) {
      return _normalizeQuat({ x:_lerp(a.x,b.x,t), y:_lerp(a.y,b.y,t), z:_lerp(a.z,b.z,t), w:_lerp(a.w,b.w,t) });
    }
    const theta = Math.acos(Math.max(-1, Math.min(1, dot)));
    const s = Math.sin(theta);
    const wa = Math.sin((1-t)*theta) / s;
    const wb = Math.sin(t*theta) / s;
    return _normalizeQuat({ x: a.x*wa + b.x*wb, y: a.y*wa + b.y*wb, z: a.z*wa + b.z*wb, w: a.w*wa + b.w*wb });
  }
  function _poseFromState(st){
    const va=st?.viewport_anchor||{};
    if(va.pose && va.pose.version>=1 && va.pose.position) return va.pose;
    return null;
  }
  function _segment(states, time, duration){
    if(!states.length) return null;
    if(states.length===1) return {a:states[0], b:states[0], t:0};
    const d=Math.max(0.001, duration);
    const lt=((time%d)+d)%d;
    for(let i=0;i<states.length-1;i++){
      const t1=states[i].time_offset||0, t2=states[i+1].time_offset||0;
      if(t2<=t1) continue;
      if(lt>=t1 && lt<=t2) return {a:states[i], b:states[i+1], t:(lt-t1)/(t2-t1)};
    }
    const last=states[states.length-1], first=states[0];
    const t1=last.time_offset||0, gap=Math.max(0.001, d-t1);
    return {a:last, b:first, t:Math.max(0,Math.min(1,(lt-t1)/gap)), wrap:true};
  }

  function wrapTime(time){
    const start = T.loopStart;
    const end = T.loopEnd != null ? T.loopEnd : T.duration;
    const len = Math.max(0.001, end - start);
    let t = time - start;
    t = ((t % len) + len) % len;
    return start + t;
  }

  function evaluateCamera(time){
    const seg=_segment(T.tracks.camera, time, T.duration);
    if(!seg) return null;
    const p1=_poseFromState(seg.a), p2=_poseFromState(seg.b);
    if(!p1||!p2) return {legacy:true, cssOnly:true};
    const t=0.5-0.5*Math.cos(Math.max(0,Math.min(1,seg.t))*Math.PI);
    return {
      position:_lerpVec(p1.position,p2.position,t),
      target:_lerpVec(p1.target,p2.target,t),
      quaternion:_slerpQuat(p1.quaternion,p2.quaternion,t),
      fov:_lerp(p1.fov||60,p2.fov||60,t),
      zoom:_lerp(p1.zoom||1,p2.zoom||1,t),
      t, wrap:!!seg.wrap,
    };
  }

  function evaluateSkeleton(skelId, time){
    const sk=T.tracks.skeletons.get(skelId);
    if(!sk||!sk.poses?.length) return {};
    const poses=sk.poses.slice().sort((a,b)=>a.time-b.time);
    let a=poses[0], b=poses[poses.length-1];
    for(let i=0;i<poses.length-1;i++){ if(time>=poses[i].time && time<=poses[i+1].time){ a=poses[i]; b=poses[i+1]; break; } }
    const span=Math.max(0.001,b.time-a.time), t=Math.max(0,Math.min(1,(time-a.time)/span));
    const out={};
    for(const bone of (sk.bones||[])){
      const pa=a.bones.find(x=>x.id===bone.id)||bone, pb=b.bones.find(x=>x.id===bone.id)||pa;
      const qa=_toQuat(pa.quat || pa.rot);
      const qb=_toQuat(pb.quat || pb.rot);
      out[bone.id]={ quat:_slerpQuat(qa,qb,t), pos:_lerpVec(pa.pos,pb.pos,t) };
    }
    return out;
  }

  function evaluateObject(objId, time){
    const obj=T.tracks.objects.get(objId);
    if(!obj||!obj.tracks?.length) return {};
    const tracks=obj.tracks.slice().sort((a,b)=>a.time-b.time);
    let a=tracks[0], b=tracks[tracks.length-1];
    for(let i=0;i<tracks.length-1;i++){ if(time>=tracks[i].time && time<=tracks[i+1].time){ a=tracks[i]; b=tracks[i+1]; break; } }
    const span=Math.max(0.001,b.time-a.time), t=Math.max(0,Math.min(1,(time-a.time)/span));
    const out={};
    for(const c of (obj.components||[])){
      const pa=a.components.find(x=>x.id===c.id)||c, pb=b.components.find(x=>x.id===c.id)||pa;
      out[c.id]={ rot:_lerpVec(pa.rot,pb.rot,t), pos:_lerpVec(pa.pos,pb.pos,t), state:t<0.5?pa.state:pb.state, type:c.type, pivot:c.pivot||null, axis:c.axis||null };
    }
    return out;
  }

  function evaluateInteractions(time){
    const state={};
    for(const e of T.tracks.interactions){
      if(e.time>time) break;
      const key = e.target?.objectId || e.target;
      if(!key) continue;
      if(e.type==='grasp'||e.type==='attach'){
        state[key]={
          attached:true,
          targetComponent: e.target?.componentId || null,
          parent: e.parent || null,
          offset: e.offset || {x:0,y:0,z:0},
          orientation: e.orientation || null,
        };
      } else if(e.type==='release'||e.type==='detach'){
        state[key]={ attached:false, targetComponent: e.target?.componentId || null };
      }
    }
    return state;
  }

  function applyCamera(pose){
    const b=T.bindings.camera; if(!b?.cam||!pose||pose.cssOnly) return;
    const cam=b.cam, ctrls=b.controls;
    const wasEnabled=ctrls?.enabled;
    if(ctrls) ctrls.enabled=false;
    if(pose.position) cam.position.set(pose.position.x, pose.position.y, pose.position.z);
    if(ctrls?.target && pose.target) ctrls.target.set(pose.target.x, pose.target.y, pose.target.z);
    if(pose.quaternion) cam.quaternion.set(pose.quaternion.x, pose.quaternion.y, pose.quaternion.z, pose.quaternion.w);
    if(Number.isFinite(pose.fov)) cam.fov=pose.fov;
    if(Number.isFinite(pose.zoom)) cam.zoom=pose.zoom;
    cam.updateProjectionMatrix?.();
    if(ctrls) ctrls.enabled=wasEnabled!==false;
  }

  function applySkeleton(skelId, evaluated){
    const binding=T.bindings.skeletons.get(skelId); if(!binding?.bones) return;
    for(const [boneId, xf] of Object.entries(evaluated)){
      const node=binding.bones.get(boneId); if(!node) continue;
      if(xf.quat && node.quaternion) node.quaternion.set(xf.quat.x, xf.quat.y, xf.quat.z, xf.quat.w);
      if(xf.pos && node.position) node.position.set(xf.pos.x, xf.pos.y, xf.pos.z);
    }
  }

  function applyObject(objId, evaluated){
    const binding=T.bindings.objects.get(objId); if(!binding?.components) return;
    for(const [compId, xf] of Object.entries(evaluated)){
      const node=binding.components.get(compId); if(!node) continue;
      if(window.FumocaPhysics?.isSimulationOwned && window.FumocaPhysics.isSimulationOwned(objId, compId)) continue;
      if(xf.type==='hinge' && xf.axis && node.rotation){
        const ang=(xf.rot?.x||0)*Math.PI/180;
        node.rotation.set(0,0,0);
        if(xf.axis==='x') node.rotation.x=ang; else if(xf.axis==='y') node.rotation.y=ang; else node.rotation.z=ang;
      } else if(xf.rot && node.rotation){
        node.rotation.set((xf.rot.x||0)*Math.PI/180, (xf.rot.y||0)*Math.PI/180, (xf.rot.z||0)*Math.PI/180);
      }
      if(xf.pos && node.position) node.position.set(xf.pos.x, xf.pos.y, xf.pos.z);
    }
  }

  function _resolveNode(ref){
    if(!ref) return null;
    if(ref.skeletonId && ref.boneId){
      return T.bindings.skeletons.get(ref.skeletonId)?.bones?.get(ref.boneId) || null;
    }
    if(ref.objectId && ref.componentId){
      return T.bindings.objects.get(ref.objectId)?.components?.get(ref.componentId) || null;
    }
    return null;
  }

  function applyAttachments(ixState){
    for(const [targetId, desired] of Object.entries(ixState)){
      const objBind = T.bindings.objects.get(targetId);
      if(!objBind) continue;
      const compId = desired.targetComponent;
      const child = compId ? objBind.components.get(compId) : null;
      if(!child) continue;
      const current = T.attachmentState.get(targetId + ':' + compId);

      if(desired.attached){
        const parent = _resolveNode(desired.parent);
        if(!parent) continue;
        if(!current?.attached){
          T.attachmentState.set(targetId + ':' + compId, {
            attached: true,
            originalParent: child.parent || null,
            originalPos: child.position ? {x:child.position.x, y:child.position.y, z:child.position.z} : {x:0,y:0,z:0},
            originalQuat: child.quaternion ? {x:child.quaternion.x, y:child.quaternion.y, z:child.quaternion.z, w:child.quaternion.w} : {x:0,y:0,z:0,w:1},
            originalScale: child.scale ? {x:child.scale.x, y:child.scale.y, z:child.scale.z} : {x:1,y:1,z:1},
          });
        }
        if(child.parent !== parent){
          if(typeof parent.attach==='function') parent.attach(child);
          else if(typeof parent.add==='function') parent.add(child);
        }
        if(desired.offset && child.position) child.position.set(desired.offset.x, desired.offset.y, desired.offset.z);
        if(desired.orientation && child.quaternion) child.quaternion.set(desired.orientation.x, desired.orientation.y, desired.orientation.z, desired.orientation.w);
      } else if(current?.attached){
        const orig = current.originalParent;
        if(orig){
          if(typeof orig.attach==='function') orig.attach(child);
          else if(typeof orig.add==='function') orig.add(child);
        } else if(child.parent && typeof child.parent.remove==='function'){
          child.parent.remove(child);
        }
        if(child.position && current.originalPos) child.position.set(current.originalPos.x, current.originalPos.y, current.originalPos.z);
        if(child.quaternion && current.originalQuat) child.quaternion.set(current.originalQuat.x, current.originalQuat.y, current.originalQuat.z, current.originalQuat.w);
        if(child.scale && current.originalScale) child.scale.set(current.originalScale.x, current.originalScale.y, current.originalScale.z);
        T.attachmentState.delete(targetId + ':' + compId);
      }
    }
    for(const [key, current] of Array.from(T.attachmentState.entries())){
      const [targetId, compId] = key.split(':');
      const desired = ixState[targetId];
      if(!desired || !desired.attached || desired.targetComponent !== compId){
        const objBind = T.bindings.objects.get(targetId);
        const child = objBind?.components?.get(compId);
        if(child && current.attached){
          const orig = current.originalParent;
          if(orig){
            if(typeof orig.attach==='function') orig.attach(child);
            else if(typeof orig.add==='function') orig.add(child);
          }
          if(child.position && current.originalPos) child.position.set(current.originalPos.x, current.originalPos.y, current.originalPos.z);
          if(child.quaternion && current.originalQuat) child.quaternion.set(current.originalQuat.x, current.originalQuat.y, current.originalQuat.z, current.originalQuat.w);
          if(child.scale && current.originalScale) child.scale.set(current.originalScale.x, current.originalScale.y, current.originalScale.z);
        }
        T.attachmentState.delete(key);
      }
    }
  }

  function resolveAnchor(anchor){
    if(!anchor) return null;
    if(anchor.mode==='world') return anchor.offset||{x:0,y:0,z:0};
    const binding=anchor.objectId?T.bindings.objects.get(anchor.objectId):null;
    const node=binding?.components?.get?.(anchor.componentId);
    if(node && typeof node.getWorldPosition==='function' && typeof THREE!=='undefined'){
      const wp=new THREE.Vector3(); node.getWorldPosition(wp);
      const off=anchor.offset||{x:0,y:0,z:0};
      return {x:wp.x+off.x, y:wp.y+off.y, z:wp.z+off.z};
    }
    return anchor.offset||null;
  }

  function _evalLight(light, time){
    const tracks=light.tracks.slice().sort((a,b)=>a.time-b.time);
    let a=tracks[0], b=tracks[tracks.length-1];
    for(let i=0;i<tracks.length-1;i++){ if(time>=tracks[i].time && time<=tracks[i+1].time){ a=tracks[i]; b=tracks[i+1]; break; } }
    const span=Math.max(0.001,b.time-a.time), t=Math.max(0,Math.min(1,(time-a.time)/span));
    return {
      ...light,
      position:_lerpVec(a.position,b.position,t),
      color:{ r:_lerp(a.color.r,b.color.r,t), g:_lerp(a.color.g,b.color.g,t), b:_lerp(a.color.b,b.color.b,t) },
      intensity:_lerp(a.intensity,b.intensity,t),
      enabled: t<0.5 ? a.enabled : b.enabled,
      shadow: t<0.5 ? a.shadow : b.shadow,
    };
  }
  function _applyLight(node, ev){
    if(!node) return;
    if(Number.isFinite(ev.intensity) && node.intensity!==undefined) node.intensity=ev.intensity;
    if(ev.color && node.color) node.color.setRGB(ev.color.r, ev.color.g, ev.color.b);
    if(ev.position && node.position) node.position.set(ev.position.x, ev.position.y, ev.position.z);
    if(typeof ev.enabled==='boolean') node.visible=ev.enabled;
  }
  function evaluate(time){
    const t=Math.max(0, Number(time)||0); T.time=t;
    const camPose=evaluateCamera(t);
    if(camPose && !camPose.cssOnly) applyCamera(camPose);
    const skelOut={};
    for(const [id] of T.tracks.skeletons){ skelOut[id]=evaluateSkeleton(id,t); applySkeleton(id, skelOut[id]); }
    const objOut={};
    for(const [id] of T.tracks.objects){ objOut[id]=evaluateObject(id,t); applyObject(id, objOut[id]); }
    const lightOut={};
    for(const [id, light] of T.tracks.lights){
      const ev = light.tracks?.length ? _evalLight(light, t) : light;
      lightOut[id]=ev;
      const node=T.bindings.lights.get(id);
      if(node) _applyLight(node, ev);
    }
    const ix=evaluateInteractions(t);
    applyAttachments(ix);
    const anchors=T.tracks.anchors.map(a=>({...a, world:resolveAnchor(a)}));
    let physics=null;
    if(window.FumocaPhysics){
      window.FumocaPhysics.syncFromEvaluation({objects:objOut, skeletons:skelOut});
      physics=window.FumocaPhysics.queryOverlaps();
    }
    return {time:t, camera:camPose, skeletons:skelOut, objects:objOut, lights:lightOut, interactions:ix, anchors, physics};
  }

  function scrub(time){ return evaluate(time); }
  function play(){
    if(T.playing) return; T.playing=true; T.lastTs=performance.now();
    const step=(ts)=>{
      if(!T.playing) return;
      const dt=((ts-T.lastTs)/1000)*T.speed; T.lastTs=ts;
      evaluate(wrapTime(T.time + dt));
      if(window.FumocaPhysics?.step) window.FumocaPhysics.step(dt);
      if(window.FumocaPhysics?.applyDynamicPoses) window.FumocaPhysics.applyDynamicPoses();
      T.raf=requestAnimationFrame(step);
    };
    T.raf=requestAnimationFrame(step);
  }
  function pause(){ T.playing=false; if(T.raf) cancelAnimationFrame(T.raf); }
  function resume(){ if(!T.playing) play(); }
  function reset(){
    pause();
    T.time = T.loopStart;
    if(window.FumocaPhysics?.reset) window.FumocaPhysics.reset();
    evaluate(T.time);
    if(window.FumocaPhysics?.applyDynamicPoses) window.FumocaPhysics.applyDynamicPoses();
    return { ok: true, time: T.time };
  }
  function stop(){ pause(); evaluate(0); }
  function restart(){ pause(); T.time=T.loopStart; play(); }
  function stepFrames(n, fps=30){ evaluate(wrapTime(T.time + (n/fps)*T.speed)); }

  function serialize(){
    return {
      version:1, revision:T.revision, duration:T.duration, loopStart:T.loopStart, loopEnd:T.loopEnd,
      camera:T.tracks.camera,
      skeletons:Array.from(T.tracks.skeletons.values()),
      objects:Array.from(T.tracks.objects.values()),
      lights:Array.from(T.tracks.lights.values()), interactions:T.tracks.interactions,
      anchors:T.tracks.anchors,
      annotations:T.tracks.annotations,
    };
  }

  async function persist(recordId){
    if(!recordId||!window._fumocaSupabase) return { ok:false, error:'No record or supabase' };
    const payload=serialize();
    payload.revision = (T.revision || 0) + 1;
    const {data:row, error:readErr}=await window._fumocaSupabase.from('nif_files').select('meta').eq('id', recordId).maybeSingle();
    if(readErr) return { ok:false, error:readErr.message || String(readErr) };
    const previous=row?.meta && typeof row.meta==='object' ? row.meta : {};
    const existingRev=previous.anim_timeline?.revision || 0;
    if(existingRev > T.revision) return { ok:false, error:`Revision conflict: remote ${existingRev} > local ${T.revision}` };
    const meta={...previous, anim_timeline:payload, has_4d:true};
    const {error:writeErr}=await window._fumocaSupabase.from('nif_files').update({meta}).eq('id', recordId);
    if(writeErr) return { ok:false, error:writeErr.message || String(writeErr) };
    T.revision = payload.revision;
    return { ok:true, revision:T.revision };
  }

  async function load(recordId){
    if(!recordId||!window._fumocaSupabase) return null;
    const {data, error}=await window._fumocaSupabase.from('nif_files').select('meta').eq('id', recordId).maybeSingle();
    if(error){ console.error('[Master] load error:', error); return null; }
    const tl=data?.meta?.anim_timeline;
    if(!tl||tl.version!==1) return null;
    T.duration=tl.duration||10; T.loopStart=tl.loopStart||0; T.loopEnd=tl.loopEnd??null;
    T.revision=tl.revision||0;
    setCameraTrack(tl.camera||[]);
    T.tracks.skeletons.clear(); (tl.skeletons||[]).forEach(addSkeleton);
    T.tracks.objects.clear(); (tl.objects||[]).forEach(addObject);
    T.tracks.lights.clear(); (tl.lights||[]).forEach(addLight); setInteractions(tl.interactions||[]); setAnchors(tl.anchors||[]); setAnnotations(tl.annotations||[]);
    return tl;
  }

  function dispose(){
    pause();
    T.tracks.skeletons.clear(); T.tracks.objects.clear(); T.tracks.lights.clear();
    T.bindings.skeletons.clear(); T.bindings.objects.clear(); T.bindings.lights.clear();
    T.attachmentState.clear();
  }

  return {
    setCameraBinding, setSkeletonBinding, setObjectBinding,
    setCameraTrack, addSkeleton, addObject, addLight, setLightBinding, setInteractions, setAnchors, setAnnotations,
    setDuration, setSpeed, setLoopRange,
    evaluate, scrub, play, pause, resume, stop, restart, reset, stepFrames, wrapTime,
    serialize, persist, load, dispose,
    getTime:()=>T.time, isPlaying:()=>T.playing, getRevision:()=>T.revision,
  };
})();

window.FumocaMaster = FumocaMaster;
export default FumocaMaster;
