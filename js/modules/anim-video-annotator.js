/**
 * FUMOCA Video Annotation Foundation (Phase F)
 * Manual frame marking. No automatic pose estimation.
 * Output becomes editable timeline data.
 */
const FumocaVideoAnnotator = (() => {
  let video = null;
  let annotations = [];

  function loadVideo(fileOrUrl) {
    return new Promise((resolve, reject) => {
      const v = document.createElement('video');
      v.playsInline = true;
      v.muted = true;
      if (typeof fileOrUrl === 'string') v.src = fileOrUrl;
      else v.src = URL.createObjectURL(fileOrUrl);
      v.addEventListener('loadedmetadata', () => { video = v; resolve(v); }, { once: true });
      v.addEventListener('error', () => reject(new Error('Video load failed')), { once: true });
    });
  }

  function mark(type, label, data = {}) {
    if (!video) return null;
    const ann = {
      id: 'ann_' + Math.random().toString(36).slice(2, 8),
      time: video.currentTime || 0,
      type,
      label,
      data,
    };
    annotations.push(ann);
    annotations.sort((a, b) => a.time - b.time);
    return ann;
  }

  function scrub(t) {
    if (!video) return;
    video.currentTime = Math.max(0, Math.min(video.duration || t, t));
  }

  function toTimelineEvents() {
    return annotations.map(a => ({
      time: a.time,
      type: a.type,
      label: a.label,
      data: a.data,
    }));
  }

  function clear() { annotations = []; }
  function getAnnotations() { return annotations.slice(); }
  function serialize() { return { annotations: annotations.slice() }; }
  function deserialize(data) { annotations = data?.annotations || []; }

  return {
    loadVideo, mark, scrub, toTimelineEvents,
    clear, getAnnotations, serialize, deserialize,
    getVideo: () => video,
  };
})();

window.FumocaVideoAnnotator = FumocaVideoAnnotator;
export default FumocaVideoAnnotator;
