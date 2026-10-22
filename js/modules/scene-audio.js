/**
 * FUMOCA Scene Audio
 * Background music for splats / NIF (viewer + Studio preview).
 *
 * meta.sceneAudio = {
 *   bed: {
 *     url, volume: 0.35, loop: true,
 *     trimStart: 0,   // seconds
 *     trimEnd: null   // seconds or null = full track
 *   },
 *   mutedDefault: true
 * }
 *
 * Also accepts legacy ambient_audio_url / ambient_audio_volume / ambient_audio_loop
 * on the record root.
 */
let bed = null;
let unlocked = false;
let trimTimer = null;

export function getSceneAudioConfig(meta = {}, record = {}) {
  if (meta?.sceneAudio?.bed?.url) return meta.sceneAudio;
  if (meta?.audio?.bed?.url) return meta.audio;
  if (record?.ambient_audio_url) {
    return {
      bed: {
        url: record.ambient_audio_url,
        volume: record.ambient_audio_volume ?? 0.35,
        loop: record.ambient_audio_loop !== false,
        trimStart: record.ambient_audio_trim_start ?? 0,
        trimEnd: record.ambient_audio_trim_end ?? null,
      },
      mutedDefault: true,
    };
  }
  return null;
}

export function unlockAudio() {
  unlocked = true;
  if (bed && bed.paused) bed.play().catch(() => {});
}

function _clearTrimTimer() {
  if (trimTimer) {
    clearInterval(trimTimer);
    trimTimer = null;
  }
}

export function stopSceneBed() {
  _clearTrimTimer();
  if (!bed) return;
  try {
    bed.pause();
    bed.currentTime = 0;
  } catch (_) {}
  bed = null;
}

function _applyTrimLoop(el, trimStart, trimEnd) {
  _clearTrimTimer();
  const start = Math.max(0, Number(trimStart) || 0);
  const end = trimEnd != null && Number(trimEnd) > start ? Number(trimEnd) : null;
  try {
    if (el.currentTime < start) el.currentTime = start;
  } catch (_) {}
  if (end == null && el.loop) return;
  trimTimer = setInterval(() => {
    if (!bed || bed !== el) {
      _clearTrimTimer();
      return;
    }
    try {
      if (end != null && el.currentTime >= end) {
        if (el.loop) el.currentTime = start;
        else {
          el.pause();
          _clearTrimTimer();
        }
      }
    } catch (_) {}
  }, 200);
}

export async function playSceneBed(config, { force = false } = {}) {
  if (!config?.bed?.url) return null;
  stopSceneBed();
  const el = new Audio(config.bed.url);
  const start = Math.max(0, Number(config.bed.trimStart) || 0);
  const end = config.bed.trimEnd != null ? Number(config.bed.trimEnd) : null;
  el.loop = config.bed.loop !== false && end == null;
  el.volume = Math.min(1, Math.max(0, config.bed.volume ?? 0.35));
  el.preload = 'auto';
  bed = el;
  el.addEventListener('loadedmetadata', () => {
    try {
      el.currentTime = start;
    } catch (_) {}
  });
  if (force || unlocked || !config.mutedDefault) {
    try {
      await el.play();
      unlocked = true;
      _applyTrimLoop(el, start, end);
    } catch {
      // Autoplay blocked
    }
  }
  return el;
}

export function playOneShot(url, { volume = 1 } = {}) {
  if (!url) return;
  const el = new Audio(url);
  el.volume = volume;
  el.play().catch(() => {});
  return el;
}

export function mountSceneAudioUI(container, config, { onStatus } = {}) {
  if (!container || !config?.bed?.url) return null;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Sound');
  btn.textContent = '🔇';
  btn.style.cssText =
    'position:absolute;bottom:80px;right:14px;z-index:25;width:44px;height:44px;border-radius:50%;border:1px solid rgba(255,255,255,.15);background:rgba(5,7,11,.75);color:#fff;font-size:18px;cursor:pointer;backdrop-filter:blur(8px)';
  container.appendChild(btn);
  let muted = true;
  btn.addEventListener('click', async () => {
    unlockAudio();
    if (muted) {
      muted = false;
      btn.textContent = '🔊';
      await playSceneBed(config, { force: true });
      onStatus?.('Music on');
    } else {
      muted = true;
      btn.textContent = '🔇';
      stopSceneBed();
      onStatus?.('Music off');
    }
  });
  playSceneBed(config, { force: false }).catch(() => {});
  return btn;
}

if (typeof window !== 'undefined') {
  window.FUMOCA_SceneAudio = {
    getSceneAudioConfig,
    playSceneBed,
    playOneShot,
    stopSceneBed,
    unlockAudio,
    mountSceneAudioUI,
  };
}
