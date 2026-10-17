/**
 * FUMOCA Scene Audio
 * Background music + one-shot SFX for splats / NIF.
 * Metadata shape (on splat.metadata or NIF audio chunk):
 * {
 *   sceneAudio: {
 *     bed: { url, volume: 0.35, loop: true },
 *     mutedDefault: true   // browsers often require user gesture
 *   }
 * }
 */
let bed = null;
let unlocked = false;

function safeMediaUrl(value) {
  try {
    const url = new URL(String(value || ''), window.location.href);
    if (['http:', 'https:'].includes(url.protocol)) return url.href;
    if (url.protocol === 'blob:' && url.origin === window.location.origin) return url.href;
  } catch (_) {}
  return '';
}

export function getSceneAudioConfig(meta = {}) {
  return meta.sceneAudio || meta.audio || null;
}

export function unlockAudio() {
  unlocked = true;
  if (bed && bed.paused) {
    bed.play().catch(() => {});
  }
}

export function stopSceneBed() {
  if (!bed) return;
  try {
    bed.pause();
    bed.currentTime = 0;
  } catch (_) {}
  bed = null;
}

export async function playSceneBed(config, { force = false } = {}) {
  const bedUrl = safeMediaUrl(config?.bed?.url);
  if (!bedUrl) return null;
  stopSceneBed();
  const el = new Audio(bedUrl);
  el.loop = config.bed.loop !== false;
  el.volume = Math.min(1, Math.max(0, config.bed.volume ?? 0.35));
  bed = el;
  if (force || unlocked || !config.mutedDefault) {
    try {
      await el.play();
      unlocked = true;
    } catch {
      // Autoplay blocked — wait for unlockAudio via UI
    }
  }
  return el;
}

export function playOneShot(url, { volume = 1 } = {}) {
  const safeUrl = safeMediaUrl(url);
  if (!safeUrl) return;
  const el = new Audio(safeUrl);
  el.volume = volume;
  el.play().catch(() => {});
  return el;
}

/**
 * Mount a small mute/unmute control; starts bed after first tap if needed.
 */
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

  // Preload bed element without playing if mutedDefault
  playSceneBed({ ...config, mutedDefault: true }).catch(() => {});

  return { btn, unlockAudio, stopSceneBed };
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
