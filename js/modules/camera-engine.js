import * as THREE from 'three';

function getCamera() { return window._fumocaViewerCamera || window._fumocaViewer?.camera || null; }
function getControls() { return window._fumocaViewerControls || window._fumocaViewer?.controls || null; }

function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
function easeOutExpo(t) { return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t); }
function smoothstep(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a || 1))); return t * t * (3 - 2 * t); }

function animateCamera({ endTarget, zoom = 1.12, duration = 1100, cinematic = true, overshoot = 0.018, verticalLift = 0.04 }) {
  const cam = getCamera();
  const controls = getControls();
  if (!cam || !controls || !controls.target) return false;
  const startPos = cam.position.clone();
  const startTarget = controls.target.clone();
  const lookDir = startPos.clone().sub(startTarget).normalize();
  const side = new THREE.Vector3().crossVectors(lookDir, cam.up.clone().normalize()).normalize();
  const currentDist = Math.max(0.35, startPos.distanceTo(startTarget));
  const nextDist = Math.max(0.3, currentDist / Math.max(1.02, zoom));
  const endPos = endTarget.clone().add(lookDir.clone().multiplyScalar(nextDist));
  const travel = Math.max(0.001, startTarget.distanceTo(endTarget));
  const arc = cinematic ? Math.min(Math.max(travel * 0.14, 0.04), currentDist * 0.12) : 0;
  const vertical = cam.up.clone().normalize().multiplyScalar(cinematic ? Math.min(Math.max(travel * verticalLift, 0.02), currentDist * 0.08) : 0);
  const sideArc = side.clone().multiplyScalar(arc);
  const midTarget = startTarget.clone().lerp(endTarget, 0.5).add(sideArc).add(vertical.clone().multiplyScalar(0.55));
  const midPos = startPos.clone().lerp(endPos, 0.5).add(sideArc.clone().multiplyScalar(1.25)).add(vertical);
  const overshootTarget = endTarget.clone().add(endTarget.clone().sub(startTarget).multiplyScalar(cinematic ? overshoot : 0));
  const t0 = performance.now();
  const tick = (now) => {
    const p = Math.min(1, (now - t0) / duration);
    const pathT = easeInOutCubic(p);
    const omt = 1 - pathT;
    const settleBlend = cinematic ? smoothstep(0.78, 1, p) : 1;
    const settleEase = easeOutExpo(settleBlend);
    const rawPos = startPos.clone().multiplyScalar(omt * omt).add(midPos.clone().multiplyScalar(2 * omt * pathT)).add(endPos.clone().multiplyScalar(pathT * pathT));
    const rawTgt = startTarget.clone().multiplyScalar(omt * omt).add(midTarget.clone().multiplyScalar(2 * omt * pathT)).add(overshootTarget.clone().multiplyScalar(pathT * pathT));
    const pos = rawPos.lerp(endPos, cinematic ? settleEase * 0.18 : 0);
    const tgt = rawTgt.lerp(endTarget, settleEase);
    cam.position.copy(pos);
    controls.target.copy(tgt);
    controls.update?.();
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return true;
}

function flyToHotspot(h) {
  if (![h?.wx, h?.wy, h?.wz].every(v => Number.isFinite(v))) return false;
  return animateCamera({
    endTarget: new THREE.Vector3(h.wx, h.wy, h.wz),
    zoom: Math.max(1, Math.min(2.5, Number(h.zoom) || 1.12)),
    duration: h.type === 'tour' ? 1380 : 1080,
    overshoot: h.type === 'tour' ? 0.026 : 0.018,
    verticalLift: h.type === 'tour' ? 0.065 : 0.045,
  });
}

function focusCurrentTarget(opts = {}) {
  const controls = getControls();
  if (!controls?.target) return false;
  return animateCamera({
    endTarget: controls.target.clone(),
    zoom: Math.max(1, Math.min(2.5, Number(opts.zoom) || 1.1)),
    duration: Number(opts.duration) || 980,
    overshoot: Number.isFinite(Number(opts.overshoot)) ? Number(opts.overshoot) : 0.014,
    verticalLift: Number.isFinite(Number(opts.verticalLift)) ? Number(opts.verticalLift) : 0.032,
  });
}

window._fumocaCameraEngine = { flyToHotspot, focusCurrentTarget, animateCamera };
