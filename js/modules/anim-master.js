/**
 * FUMOCA Master Timeline Evaluator (integration pass)
 * Single deterministic evaluate(time). No competing RAF.
 */
const FumocaMaster = (() => {
  const T = {
    duration: 10, time: 0, playing: false, speed: 1,
    loopStart: 0, loopEnd: null, raf: null, lastTs: 0,
    tracks: { camera: [], skeletons: new Map(), objects: new Map(), interactions: [], anchors: [], annotations: [] },
    bindings: { camera: null, skeletons: new Map(), objects: new Map() },
  };

  function setCameraBinding(cam, controls) { T.bindings.camera = { cam, controls }; }
  function setSkeletonBinding(skelId, boneMap) { T.bindings.skeletons.set(skelId, { bones: boneMap }); }
  function setObjectBinding(objId, componentMap) { T.bindings.objects.set(objId, { components: componentMap }); }
  function setCameraTrack(states) {
    T.tracks.camera = Array.isArray(states) ? states.slice().sort((a,b) => (a.time_offset||0)-(b.time_offset||0)) : [];
  }
  function addSkeleton(skel) { if (skel?.id) T.tracks.skeletons.set(skel.id, skel); }
  function addObject(obj) { if (obj?.id) T.tracks.objects.set(obj.id, obj); }
  function setInteractions(events) { T.tracks.interactions = Array.isArray(events) ? events.slice().sort((a,b)=>a.time-b.time) : []; }
  function setAnchors(anchors) { T.tracks.anchors = Array.isArray(anchors) ? anchors.slice() : []; }
  function setAnnotations(anns) { T.tracks.annotations = Array.isArray(anns) ? anns.slice() : []; }
  function setDuration(d) { T.duration = Math.max(0.1, Number(d)||10); }
  function setSpeed(s) { T.speed = Math.max(0.01, Number(s)||1); }
  function setLoopRange(start, end) { T.loopStart = Math.max(0, Number(start)||0); T.loopEnd = end==null ? null : Math.max(T.loopStart, Number(end)); }

  function _lerp(a,b,t){ return a+(b-a)*t; }
  function _lerpVec(a,b,t){ if(!a||!b) return a||b||{x:0,y:0,z:0}; return {x:_lerp(a.x,b.x,t), y:_lerp(a.y,b.y,t), z:_lerp(a.z,b.z,t)}; }
  function _slerpQuat(q1,q2,t){
    if(!q1||!q2) return q1||q2||{x:0,y:0,z:0,w:1};
    if(typeof THREE!=='undefined' && THREE.Quaternion){
      const a=new THREE.Quaternion(q1.x,q1.y,q1.z,q1.w), b=new THREE.Quaternion(q2.x,q2.y,q2.z,q2.w), o=new THREE.Quaternion();
      o.slerpQuaternions(a,b,t); return {x:o.x,y:o.y,z:o.z,w:o.w};
    }
    let x=_lerp(q1.x,q2.x,t), y=_lerp(q1.y,q2.y,t), z=_lerp(q1.z,q2.z,t), w=_lerp(q1.w,q2.w,t);
    const len=Math.hypot(x,y,z,w)||1; return {x:x/len,y:y/len,z:z/len,w:w/len};
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
      out[bone.id]={ rot:_slerpQuat(pa.rot,pb.rot,t), pos:_lerpVec(pa.pos,pb.pos,t) };
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
      if(e.type==='grasp'||e.type==='attach') state[e.target]={attached:true, to:e.params?.to||null, bone:e.params?.bone||null, offset:e.params?.offset||{x:0,y:0,z:0}};
      else if(e.type==='release'||e.type==='detach') state[e.target]={attached:false};
    }
    return state;
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

  function applyCamera(pose){
    const b=T.bindings.camera; if(!b?.cam||!pose||pose.cssOnly) return;
    const cam=b.cam, ctrls=b.controls;
    if(pose.position) cam.position.set(pose.position.x, pose.position.y, pose.position.z);
    if(ctrls?.target && pose.target) ctrls.target.set(pose.target.x, pose.target.y, pose.target.z);
    if(ctrls?.update) ctrls.update();
    if(pose.quaternion) cam.quaternion.set(pose.quaternion.x, pose.quaternion.y, pose.quaternion.z, pose.quaternion.w);
    if(Number.isFinite(pose.fov)) cam.fov=pose.fov;
    if(Number.isFinite(pose.zoom)) cam.zoom=pose.zoom;
    cam.updateProjectionMatrix?.();
  }

  function applySkeleton(skelId, evaluated){
    const binding=T.bindings.skeletons.get(skelId); if(!binding?.bones) return;
    for(const [boneId, xf] of Object.entries(evaluated)){
      const node=binding.bones.get(boneId); if(!node) continue;
      if(xf.rot && node.quaternion) node.quaternion.set(xf.rot.x, xf.rot.y, xf.rot.z, xf.rot.w);
      if(xf.pos && node.position) node.position.set(xf.pos.x, xf.pos.y, xf.pos.z);
    }
  }

  function applyObject(objId, evaluated){
    const binding=T.bindings.objects.get(objId); if(!binding?.components) return;
    for(const [compId, xf] of Object.entries(evaluated)){
      const node=binding.components.get(compId); if(!node) continue;
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

  function evaluate(time){
    const t=Math.max(0, Number(time)||0); T.time=t;
    const camPose=evaluateCamera(t);
    if(camPose && !camPose.cssOnly) applyCamera(camPose);
    const skelOut={};
    for(const [id] of T.tracks.skeletons){ skelOut[id]=evaluateSkeleton(id,t); applySkeleton(id, skelOut[id]); }
    const objOut={};
    for(const [id] of T.tracks.objects){ objOut[id]=evaluateObject(id,t); applyObject(id, objOut[id]); }
    const ix=evaluateInteractions(t);
    for(const [target, st] of Object.entries(ix)){
      if(st.attached && st.to){
        const objBind=T.bindings.objects.get(target);
        const parentBind=T.bindings.skeletons.get(st.to)||T.bindings.objects.get(st.to);
        const child=objBind?.components?.values?.().next?.().value;
        const parent=parentBind?.bones?.get?.(st.bone)||parentBind?.components?.values?.().next?.().value;
        if(child && parent && child.parent!==parent){
          if(typeof parent.attach==='function') parent.attach(child);
          else if(typeof parent.add==='function') parent.add(child);
          if(st.offset && child.position) child.position.set(st.offset.x, st.offset.y, st.offset.z);
        }
      }
    }
    const anchors=T.tracks.anchors.map(a=>({...a, world:resolveAnchor(a)}));
    return {time:t, camera:camPose, skeletons:skelOut, objects:objOut, interactions:ix, anchors};
  }

  function scrub(time){ return evaluate(time); }
  function play(){
    if(T.playing) return; T.playing=true; T.lastTs=performance.now();
    const step=(ts)=>{
      if(!T.playing) return;
      const dt=((ts-T.lastTs)/1000)*T.speed; T.lastTs=ts;
      let next=T.time+dt;
      const end=T.loopEnd!=null?T.loopEnd:T.duration;
      if(next>=end) next=T.loopStart+(next-end);
      evaluate(next);
      T.raf=requestAnimationFrame(step);
    };
    T.raf=requestAnimationFrame(step);
  }
  function pause(){ T.playing=false; if(T.raf) cancelAnimationFrame(T.raf); }
  function resume(){ if(!T.playing) play(); }
  function stop(){ pause(); evaluate(0); }
  function restart(){ T.time=T.loopStart; play(); }
  function stepFrames(n, fps=30){ evaluate(T.time+(n/fps)*T.speed); }

  function serialize(){
    return {
      version:1, duration:T.duration, loopStart:T.loopStart, loopEnd:T.loopEnd,
      camera:T.tracks.camera,
      skeletons:Array.from(T.tracks.skeletons.values()),
      objects:Array.from(T.tracks.objects.values()),
      interactions:T.tracks.interactions,
      anchors:T.tracks.anchors,
      annotations:T.tracks.annotations,
    };
  }

  async function persist(recordId){
    if(!recordId||!window._fumocaSupabase) return false;
    const payload=serialize();
    const {data:row}=await window._fumocaSupabase.from('nif_files').select('meta').eq('id', recordId).maybeSingle();
    const previous=row?.meta && typeof row.meta==='object' ? row.meta : {};
    const meta={...previous, anim_timeline:payload, has_4d:true};
    const {error}=await window._fumocaSupabase.from('nif_files').update({meta}).eq('id', recordId);
    return !error;
  }

  async function load(recordId){
    if(!recordId||!window._fumocaSupabase) return null;
    const {data}=await window._fumocaSupabase.from('nif_files').select('meta').eq('id', recordId).maybeSingle();
    const tl=data?.meta?.anim_timeline;
    if(!tl||tl.version!==1) return null;
    T.duration=tl.duration||10; T.loopStart=tl.loopStart||0; T.loopEnd=tl.loopEnd??null;
    setCameraTrack(tl.camera||[]);
    T.tracks.skeletons.clear(); (tl.skeletons||[]).forEach(addSkeleton);
    T.tracks.objects.clear(); (tl.objects||[]).forEach(addObject);
    setInteractions(tl.interactions||[]); setAnchors(tl.anchors||[]); setAnnotations(tl.annotations||[]);
    return tl;
  }

  function dispose(){
    pause();
    T.tracks.skeletons.clear(); T.tracks.objects.clear();
    T.bindings.skeletons.clear(); T.bindings.objects.clear();
  }

  return {
    setCameraBinding, setSkeletonBinding, setObjectBinding,
    setCameraTrack, addSkeleton, addObject, setInteractions, setAnchors, setAnnotations,
    setDuration, setSpeed, setLoopRange,
    evaluate, scrub, play, pause, resume, stop, restart, stepFrames,
    serialize, persist, load, dispose,
    getTime:()=>T.time, isPlaying:()=>T.playing,
  };
})();

window.FumocaMaster = FumocaMaster;
export default FumocaMaster;
