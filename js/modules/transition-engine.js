export function morphVideoToSplat({ shell, video, poster, synth, statusEl, mode = 'standard' } = {}) {
  if (!shell) return;
  shell.classList.remove('is-transitioning', 'video-ready', 'event-mode');
  void shell.offsetWidth;
  shell.classList.add('is-transitioning');
  if (mode === 'event') shell.classList.add('event-mode');
  if (video?.src) shell.classList.add('video-ready');
  if (statusEl) statusEl.textContent = mode === 'event' ? 'Building interactive moment…' : 'Resolving teaser…';
  if (poster) {
    poster.classList.remove('hidden');
    poster.style.filter = 'blur(10px) saturate(1.08)';
  }
  if (synth) synth.style.opacity = '';
  const revealAt = mode === 'event' ? 1100 : 1320;
  setTimeout(() => {
    if (poster) {
      poster.style.filter = '';
      poster.classList.add('hidden');
    }
    if (video?.src) {
      video.classList.add('ready');
      try { video.currentTime = 0; video.play?.().catch?.(() => {}); } catch (_) {}
    }
    if (synth) synth.style.opacity = '.12';
    if (statusEl) statusEl.textContent = mode === 'event' ? 'Interactive event teaser ready' : 'Live teaser ready';
    window.dispatchEvent(new CustomEvent('fumoca:transitionResolved', { detail: { mode } }));
  }, revealAt);
  setTimeout(() => shell.classList.remove('is-transitioning'), mode === 'event' ? 3900 : 3600);
}

window.FumocaTransitionEngine = { morphVideoToSplat };
