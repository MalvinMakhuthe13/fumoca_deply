/**
 * FUMOCA Cinematic Reveal v1
 * ══════════════════════════════════════════════════════════════════════════
 * Wraps the viewer's point-material with reveal-stage uniforms and runs a
 * staged dots → dense → full-splat animation timed to the client's embed.
 *
 * Unlike gaussian-renderer.js (which builds its own geometry), this module
 * ATTACHES to whatever Points material the viewer already built. It does not
 * replace the shader — it injects three uniforms and appends a small block
 * to the vertex and fragment shaders via onBeforeCompile. This means it
 * works with the existing PLY loader and does not risk breaking any
 * already-published splats.
 *
 * Configuration is read from URL params so each embed can tune its own
 * reveal without redeploying:
 *   ?reveal=on|off            default: on
 *   ?reveal_duration=NNNN     milliseconds, default 4200
 *   ?reveal_video=URL         optional source video to morph from
 *   ?reveal_chime=on|off      optional audio cue at resolve
 *
 * The module emits these CustomEvents on window for downstream hooks:
 *   fumoca:reveal:start       when reveal begins
 *   fumoca:reveal:stage       { stage: 'sparse'|'densify'|'resolve', t }
 *   fumoca:reveal:complete    when reveal finishes
 * ══════════════════════════════════════════════════════════════════════════
 */

const STORAGE_KEY_PREFIX = 'fumoca:reveal:seen:';

/**
 * Read reveal configuration from the current URL query string plus optional
 * overrides. Returns a frozen config object with sensible defaults.
 */
export function readRevealConfig(overrides = {}) {
  const params = new URLSearchParams(window.location.search);
  const splatId = params.get('splatId') || params.get('id') || '';
  const revealParam = (params.get('reveal') || 'on').toLowerCase();
  const enabled = revealParam !== 'off' && revealParam !== '0' && revealParam !== 'false';
  let duration = parseInt(params.get('reveal_duration') || '4200', 10);
  // Clamp to a sane range — too short feels buggy, too long feels broken.
  if (!Number.isFinite(duration)) duration = 4200;
  duration = Math.max(1500, Math.min(12000, duration));
  const videoUrl = params.get('reveal_video') || '';
  const chime = (params.get('reveal_chime') || 'off').toLowerCase() === 'on';

  // Respect user accessibility preference — never force motion on someone
  // who has asked their OS not to animate things.
  const reducedMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  return Object.freeze({
    enabled: enabled && !reducedMotion,
    duration,
    videoUrl,
    chime,
    splatId,
    reducedMotion,
    ...overrides,
  });
}

/**
 * Check whether this visitor has seen this splat before. We store a short
 * marker in localStorage keyed by splat id. Return-visitors skip the
 * video-morph stage and go straight to a faster splat-only reveal.
 */
export function isReturnVisitor(splatId) {
  if (!splatId) return false;
  try {
    return !!localStorage.getItem(STORAGE_KEY_PREFIX + splatId);
  } catch (_) {
    // localStorage can throw in private mode or with strict cookie settings.
    // Treat any failure as "first visit" — the worst outcome is the reveal
    // plays again, which is not a bug.
    return false;
  }
}

function markSeen(splatId) {
  if (!splatId) return;
  try {
    localStorage.setItem(STORAGE_KEY_PREFIX + splatId, String(Date.now()));
  } catch (_) {
    // Same reasoning — silently ignore storage failures.
  }
}

/**
 * Attach reveal uniforms to an existing ShaderMaterial. Uses onBeforeCompile
 * so we do not replace the caller's shader code — we inject snippets.
 *
 * For materials that were authored with hand-written vertex/fragment source
 * (which is the viewer's case), we patch the uniforms object directly and
 * rewrite the shader strings before the material is first used.
 */
export function attachRevealToMaterial(material) {
  if (!material) return null;

  const uniforms = material.uniforms || (material.uniforms = {});
  uniforms.uReveal      = uniforms.uReveal      || { value: 0.0 };
  uniforms.uRevealStage = uniforms.uRevealStage || { value: 0.0 };
  uniforms.uRevealTime  = uniforms.uRevealTime  || { value: 0.0 };

  // Patch the material's vertex and fragment source if we can see them.
  // The viewer builds its shader inline as strings, so material.vertexShader
  // and material.fragmentShader are readable and writable up until the first
  // render. After that, replacing them requires material.needsUpdate = true.
  if (typeof material.vertexShader === 'string' && !material.__fumocaRevealPatched) {
    material.vertexShader = injectVertex(material.vertexShader);
    material.fragmentShader = injectFragment(material.fragmentShader);
    material.__fumocaRevealPatched = true;
    material.needsUpdate = true;
  }

  return {
    material,
    setReveal(v) {
      uniforms.uReveal.value = Math.max(0, Math.min(1, v));
    },
    setStage(s) {
      uniforms.uRevealStage.value = s;
    },
  };
}

/**
 * Inject reveal logic into the viewer's existing vertex shader. We look for
 * the final gl_PointSize assignment and wrap it with a stage-aware size.
 * If we cannot find the expected hook, we fall back to leaving the shader
 * untouched and the reveal still runs (just without the per-point size
 * modulation). Better no reveal than a broken shader.
 */
function injectVertex(src) {
  // Ensure the uniforms are declared. Adding them twice is a compile error.
  if (!/uniform\s+float\s+uReveal\b/.test(src)) {
    src = src.replace(
      /void\s+main\s*\(/,
      'uniform float uReveal;\nuniform float uRevealStage;\nuniform float uRevealTime;\nvoid main('
    );
  }

  // Modulate gl_PointSize. The viewer's shader ends with a clamp(...) assigned
  // to gl_PointSize; we multiply by a reveal factor that grows from 0.25 to 1.
  // Use a regex that matches any `gl_PointSize = ...;` line.
  src = src.replace(
    /gl_PointSize\s*=\s*([^;]+);/,
    (match, expr) => {
      return `
      float _fumocaRevealSize = mix(0.25, 1.0, smoothstep(0.0, 1.0, uReveal));
      gl_PointSize = (${expr}) * _fumocaRevealSize;
      `;
    }
  );

  return src;
}

/**
 * Inject reveal logic into the fragment shader. During the early stage we
 * render as hard dots; as reveal progresses the falloff softens and the
 * alpha grows so splats resolve from pinpoints into gaussian discs.
 */
function injectFragment(src) {
  if (!/uniform\s+float\s+uReveal\b/.test(src)) {
    src = src.replace(
      /void\s+main\s*\(/,
      'uniform float uReveal;\nuniform float uRevealStage;\nuniform float uRevealTime;\nvoid main('
    );
  }

  // Before the final gl_FragColor assignment, we mix between a hard dot
  // (sparse-cloud look) and the existing gaussian alpha (full-splat look).
  // We do this by multiplying the fragment alpha and lifting brightness
  // during the densify stage so it pulses into view.
  src = src.replace(
    /gl_FragColor\s*=\s*vec4\(([^;]+)\);/,
    (match, inside) => {
      return `
      vec4 _fumocaFinal = vec4(${inside});
      float _fr = clamp(uReveal, 0.0, 1.0);
      // Sparse stage: sharpen (tighter center), lower alpha.
      // Full stage: original gaussian falloff, full alpha.
      float _alphaMix = mix(0.35, 1.0, smoothstep(0.0, 1.0, _fr));
      _fumocaFinal.a *= _alphaMix;
      // Subtle shimmer during the transition (peaks near reveal=0.55)
      float _shimmer = smoothstep(0.0, 0.5, _fr) * (1.0 - smoothstep(0.5, 1.0, _fr));
      _fumocaFinal.rgb += _shimmer * 0.08;
      gl_FragColor = _fumocaFinal;
      `;
    }
  );

  return src;
}

/**
 * Cubic ease in-out — same curve the existing renderer uses, so the two
 * code paths feel consistent.
 */
function easeInOutCubic(t) {
  return t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2;
}

/**
 * Run the reveal animation. Takes the handle returned by
 * attachRevealToMaterial and a config object. Returns a Promise that
 * resolves when the reveal completes.
 *
 * The animation runs in three stages of equal duration:
 *   0.00–0.33  sparse     — tiny dots, minimal alpha, hint at structure
 *   0.33–0.66  densify    — dots grow, alpha rises, shimmer peaks
 *   0.66–1.00  resolve    — settle into full gaussian splats
 */
export function playReveal(handle, config = {}) {
  const duration = config.duration || 4200;
  if (!handle) {
    return Promise.resolve();
  }

  return new Promise(resolve => {
    const start = performance.now();
    let lastStage = -1;
    window.dispatchEvent(new CustomEvent('fumoca:reveal:start', { detail: { duration } }));

    function tick() {
      const now = performance.now();
      const t = Math.min(1, (now - start) / duration);
      const eased = easeInOutCubic(t);
      handle.setReveal(eased);

      // Emit stage transitions for downstream hooks (audio, UI copy, etc).
      const stageIdx = t < 0.33 ? 0 : t < 0.66 ? 1 : 2;
      if (stageIdx !== lastStage) {
        lastStage = stageIdx;
        const stageName = ['sparse', 'densify', 'resolve'][stageIdx];
        handle.setStage(stageIdx);
        window.dispatchEvent(new CustomEvent('fumoca:reveal:stage', {
          detail: { stage: stageName, t }
        }));
      }

      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        handle.setReveal(1);
        window.dispatchEvent(new CustomEvent('fumoca:reveal:complete', {}));
        // v79 — also notify a parent window if we're in an iframe (e.g.
        // the showroom.html wrapper). postMessage is a no-op if the page
        // is not embedded, so this is safe to always do.
        try {
          if (window.parent && window.parent !== window) {
            window.parent.postMessage({ type: 'fumoca:reveal:complete' }, '*');
          }
        } catch (_) {
          // Cross-origin parent, message blocked — not fatal.
        }
        resolve();
      }
    }
    requestAnimationFrame(tick);
  });
}

/**
 * Play a short audio chime at the moment of resolve. Uses WebAudio so we do
 * not ship an audio asset. A major-third arpeggio — C5 → E5 → G5 — keeps
 * it distinctive without being cloying.
 *
 * Browsers block audio before a user gesture, so this function silently
 * no-ops if the AudioContext cannot start. That is intentional: an autoplay
 * refusal is not an error the client should see.
 */
export function playChime() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    // If the context starts suspended (pre-gesture), bail quietly rather
    // than queueing up sound for later — it would fire at the wrong time.
    if (ctx.state === 'suspended') {
      ctx.close();
      return;
    }
    const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
    const now = ctx.currentTime;
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + i * 0.08);
      gain.gain.linearRampToValueAtTime(0.12, now + i * 0.08 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0005, now + i * 0.08 + 0.5);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.08);
      osc.stop(now + i * 0.08 + 0.55);
    });
    // Close the context shortly after the last note finishes to free
    // the audio hardware — otherwise mobile browsers warn about "audio
    // context not closed" after repeated reveals.
    setTimeout(() => ctx.close().catch(() => {}), 1200);
  } catch (_) {
    // WebAudio failures are never worth interrupting the visual reveal for.
  }
}

/**
 * Orchestrate the full reveal sequence. This is the single entry point the
 * viewer calls after the PLY has loaded and the Points mesh has been added
 * to the scene.
 *
 * For first-time visitors with a reveal_video, we fade the video up, run
 * the splat reveal underneath, and cross-fade the video out at the end.
 * For return visitors, we skip the video and run a faster splat-only reveal.
 */
export async function runRevealSequence({ material, videoEl, config, splatId }) {
  config = config || readRevealConfig();
  if (!config.enabled) {
    // Snap to fully resolved — no animation.
    if (material?.uniforms?.uReveal) material.uniforms.uReveal.value = 1;
    return { skipped: true, reason: 'reveal_disabled' };
  }

  const handle = attachRevealToMaterial(material);
  if (!handle) {
    return { skipped: true, reason: 'no_material' };
  }

  // Set starting state immediately so the user never sees a flash of full splats.
  handle.setReveal(0);

  const returning = isReturnVisitor(splatId || config.splatId);
  // Return visitors get a 60% faster reveal — they don't need the full pitch.
  const effectiveDuration = returning ? Math.max(1200, config.duration * 0.4) : config.duration;

  // Video-morph path: fade video up first, then begin splat reveal, then fade
  // video out as splats resolve. Only first-time visitors get this.
  const useVideo = !returning && videoEl && (config.videoUrl || videoEl.src);
  if (useVideo) {
    await fadeVideoIn(videoEl, config.videoUrl);
  }

  // Fire the chime slightly before resolve so it peaks with the visual.
  if (config.chime) {
    setTimeout(() => playChime(), Math.max(0, effectiveDuration * 0.7));
  }

  // Run the splat reveal. If we also have a video, start fading it out at
  // the 50% mark so it is gone by the time splats resolve.
  if (useVideo) {
    setTimeout(() => fadeVideoOut(videoEl), effectiveDuration * 0.5);
  }

  await playReveal(handle, { duration: effectiveDuration });
  markSeen(splatId || config.splatId);
  return { skipped: false, returning, duration: effectiveDuration };
}

/**
 * Fade an <video> element in, ensuring it is playing, muted (autoplay
 * requirement on mobile), and visible above the canvas. If no src is
 * provided and the element already has one, we just use that.
 */
function fadeVideoIn(videoEl, srcOverride) {
  return new Promise(resolve => {
    if (!videoEl) return resolve();
    if (srcOverride && videoEl.src !== srcOverride) videoEl.src = srcOverride;
    videoEl.muted = true;
    videoEl.playsInline = true;
    videoEl.setAttribute('playsinline', '');
    videoEl.loop = false;
    videoEl.style.transition = 'opacity 420ms ease-out';
    videoEl.style.opacity = '0';
    videoEl.style.display = 'block';
    // Force a reflow so the opacity transition takes effect. Without this,
    // setting display:block and opacity:0 in the same tick often races.
    void videoEl.offsetWidth;
    videoEl.style.opacity = '1';

    // Play. If play() rejects (autoplay policy), we still resolve and the
    // reveal continues — the video just will not play, which is preferable
    // to stalling the whole sequence.
    const playPromise = videoEl.play?.();
    if (playPromise?.catch) playPromise.catch(() => {});

    // Wait for the fade-in to finish, or a safety timeout, whichever is first.
    // The timeout matters because transitionend does not always fire on
    // detached or throttled elements.
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    videoEl.addEventListener('transitionend', finish, { once: true });
    setTimeout(finish, 500);
  });
}

function fadeVideoOut(videoEl) {
  if (!videoEl) return;
  videoEl.style.transition = 'opacity 700ms ease-in';
  videoEl.style.opacity = '0';
  setTimeout(() => {
    videoEl.pause?.();
    videoEl.style.display = 'none';
  }, 750);
}

// Expose on window for non-module consumers (edit.html, embed frames, etc).
window.FumocaCinematicReveal = {
  readRevealConfig,
  isReturnVisitor,
  attachRevealToMaterial,
  playReveal,
  playChime,
  runRevealSequence,
};

export default {
  readRevealConfig,
  isReturnVisitor,
  attachRevealToMaterial,
  playReveal,
  playChime,
  runRevealSequence,
};
