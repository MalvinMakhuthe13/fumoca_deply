/**
 * FUMOCA Shared Timeline (Phase D)
 * One clock for camera, skeleton, and object tracks.
 */
const FumocaTimeline = (() => {
  const tracks = {
    camera: [],
    skeletons: [],
    objects: [],
    interactions: [],
    anchors: [],
  };

  let currentTime = 0;
  let duration = 10;
  let playing = false;
  let raf = null;
  let lastTs = 0;

  function setDuration(d) { duration = Math.max(0.1, Number(d) || 10); }
  function getTime() { return currentTime; }
  function scrub(t) { currentTime = Math.max(0, Math.min(duration, Number(t) || 0)); _evaluate(); }

  function _evaluate() {
    for (const sk of tracks.skeletons) {
      window.FumocaSkeleton?.evaluate?.(sk.id, currentTime);
    }
    for (const obj of tracks.objects) {
      window.FumocaObjectAnim?.evaluate?.(obj.id, currentTime);
    }
    window.dispatchEvent(new CustomEvent('fumoca:timelineTick', { detail: { time: currentTime } }));
  }

  function play() {
    if (playing) return;
    playing = true;
    lastTs = performance.now();
    const step = (ts) => {
      if (!playing) return;
      const dt = (ts - lastTs) / 1000;
      lastTs = ts;
      currentTime = (currentTime + dt) % duration;
      _evaluate();
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }

  function pause() { playing = false; if (raf) cancelAnimationFrame(raf); }
  function stop() { pause(); currentTime = 0; _evaluate(); }
  function restart() { currentTime = 0; play(); }

  function addSkeletonTrack(id, name) { tracks.skeletons.push({ id, name }); }
  function addObjectTrack(id, name) { tracks.objects.push({ id, name }); }
  function addInteraction(event) { tracks.interactions.push(event); tracks.interactions.sort((a,b) => a.time - b.time); }
  function addAnchor(anchor) { tracks.anchors.push(anchor); }

  function serialize() {
    return {
      version: 1,
      duration,
      currentTime,
      skeletons: tracks.skeletons,
      objects: tracks.objects,
      interactions: tracks.interactions,
      anchors: tracks.anchors,
      skeletonData: tracks.skeletons.map(s => window.FumocaSkeleton?.serialize?.(s.id)).filter(Boolean),
      objectData: tracks.objects.map(o => window.FumocaObjectAnim?.serialize?.(o.id)).filter(Boolean),
    };
  }

  async function persist(recordId) {
    if (!recordId || !window._fumocaSupabase) return false;
    const payload = serialize();
    const { error } = await window._fumocaSupabase.from('nif_files')
      .update({ meta: { ...(window._fumocaCurrentRecord?.meta || {}), anim_timeline: payload } })
      .eq('id', recordId);
    return !error;
  }

  async function load(recordId) {
    if (!recordId || !window._fumocaSupabase) return null;
    const { data } = await window._fumocaSupabase.from('nif_files').select('meta').eq('id', recordId).maybeSingle();
    const tl = data?.meta?.anim_timeline;
    if (!tl) return null;
    duration = tl.duration || 10;
    tracks.skeletons = tl.skeletons || [];
    tracks.objects = tl.objects || [];
    tracks.interactions = tl.interactions || [];
    tracks.anchors = tl.anchors || [];
    (tl.skeletonData || []).forEach(d => window.FumocaSkeleton?.deserialize?.(d));
    (tl.objectData || []).forEach(d => window.FumocaObjectAnim?.deserialize?.(d));
    return tl;
  }

  return {
    setDuration, getTime, scrub, play, pause, stop, restart,
    addSkeletonTrack, addObjectTrack, addInteraction, addAnchor,
    serialize, persist, load,
    getTracks: () => ({ ...tracks }),
    isPlaying: () => playing,
  };
})();

window.FumocaTimeline = FumocaTimeline;
export default FumocaTimeline;
