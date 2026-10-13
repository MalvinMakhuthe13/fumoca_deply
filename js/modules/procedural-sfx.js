/**
 * Procedural SFX when no MP3 URLs are set — good enough for dealer demos.
 * Web Audio API: click, door, engine start, engine idle loop.
 */
let ctx = null;

function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function envGain(g, t0, attack, hold, release) {
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(1, t0 + attack);
  g.gain.setValueAtTime(1, t0 + attack + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + hold + release);
}

export function sfxClick() {
  const c = ac();
  const t = c.currentTime;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = 'square';
  o.frequency.setValueAtTime(800, t);
  o.frequency.exponentialRampToValueAtTime(400, t + 0.05);
  g.gain.setValueAtTime(0.15, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
  o.connect(g);
  g.connect(c.destination);
  o.start(t);
  o.stop(t + 0.09);
}

export function sfxDoor() {
  const c = ac();
  const t = c.currentTime;
  // soft thud + latch
  const buf = c.createBuffer(1, c.sampleRate * 0.35, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) {
    const n = Math.random() * 2 - 1;
    const e = Math.exp(-i / (c.sampleRate * 0.08));
    d[i] = n * e * (i < c.sampleRate * 0.02 ? 1 : 0.4);
  }
  const src = c.createBufferSource();
  src.buffer = buf;
  const g = c.createGain();
  g.gain.value = 0.35;
  const f = c.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 600;
  src.connect(f);
  f.connect(g);
  g.connect(c.destination);
  src.start(t);

  const o = c.createOscillator();
  const g2 = c.createGain();
  o.frequency.setValueAtTime(180, t + 0.05);
  o.frequency.exponentialRampToValueAtTime(90, t + 0.2);
  g2.gain.setValueAtTime(0.12, t + 0.05);
  g2.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
  o.connect(g2);
  g2.connect(c.destination);
  o.start(t + 0.05);
  o.stop(t + 0.26);
}

export function sfxEngineStart() {
  const c = ac();
  const t = c.currentTime;
  const o = c.createOscillator();
  const o2 = c.createOscillator();
  const g = c.createGain();
  o.type = 'sawtooth';
  o2.type = 'square';
  o.frequency.setValueAtTime(40, t);
  o.frequency.exponentialRampToValueAtTime(110, t + 0.8);
  o2.frequency.setValueAtTime(55, t);
  o2.frequency.exponentialRampToValueAtTime(90, t + 0.8);
  g.gain.setValueAtTime(0.001, t);
  g.gain.exponentialRampToValueAtTime(0.2, t + 0.15);
  g.gain.exponentialRampToValueAtTime(0.12, t + 0.9);
  const f = c.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(200, t);
  f.frequency.exponentialRampToValueAtTime(800, t + 0.7);
  o.connect(f);
  o2.connect(f);
  f.connect(g);
  g.connect(c.destination);
  o.start(t);
  o2.start(t);
  o.stop(t + 1.0);
  o2.stop(t + 1.0);
}

let idleNodes = null;

export function sfxEngineIdleStart() {
  sfxEngineIdleStop();
  const c = ac();
  const o = c.createOscillator();
  const o2 = c.createOscillator();
  const g = c.createGain();
  o.type = 'sawtooth';
  o2.type = 'triangle';
  o.frequency.value = 48;
  o2.frequency.value = 72;
  g.gain.value = 0.06;
  const f = c.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 280;
  o.connect(f);
  o2.connect(f);
  f.connect(g);
  g.connect(c.destination);
  o.start();
  o2.start();
  idleNodes = { o, o2, g, c };
}

export function sfxEngineIdleStop() {
  if (!idleNodes) return;
  try {
    idleNodes.o.stop();
    idleNodes.o2.stop();
  } catch (_) {}
  idleNodes = null;
}

export function playStateSound(key, value, urls = {}) {
  if (key === 'lights') {
    if (urls.click) new Audio(urls.click).play().catch(() => {});
    else sfxClick();
    return;
  }
  if ((key === 'door_fl' || key === 'door_fr') && value === 'open') {
    if (urls.door) new Audio(urls.door).play().catch(() => {});
    else sfxDoor();
    return;
  }
  if (key === 'engine' && value === 'on') {
    if (urls.engineStart) new Audio(urls.engineStart).play().catch(() => {});
    else sfxEngineStart();
    setTimeout(() => {
      if (urls.engineLoop) {
        const a = new Audio(urls.engineLoop);
        a.loop = true;
        a.volume = 0.4;
        a.play().catch(() => {});
        window._fumocaEngineLoop = a;
      } else {
        sfxEngineIdleStart();
      }
    }, 700);
    return;
  }
  if (key === 'engine' && value === 'off') {
    sfxEngineIdleStop();
    if (window._fumocaEngineLoop) {
      try {
        window._fumocaEngineLoop.pause();
      } catch (_) {}
      window._fumocaEngineLoop = null;
    }
    sfxClick();
  }
  if (key === 'ivi') sfxClick();
}

if (typeof window !== 'undefined') {
  window.FUMOCA_ProceduralSFX = {
    sfxClick,
    sfxDoor,
    sfxEngineStart,
    sfxEngineIdleStart,
    sfxEngineIdleStop,
    playStateSound,
  };
}
