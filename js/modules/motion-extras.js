/**
 * Free moves and shoe laces together, for Studio and the published viewer:
 * one place to list them, play them from a hotspot, and autoplay them.
 */
import { FreeMover, normalizeClips } from './free-move.js';
import { LaceRig, normalizeLaces, startT } from './shoe-laces.js';
import './part-effects.js';   // sounds (built-in or your own recording)

export class MotionExtras {
  constructor(THREE, mesh, { freeMoves = [], laces = [] } = {}) {
    this.THREE = THREE; this.mesh = mesh;
    this.mover = null; this.laces = new Map();
    this.setFreeMoves(freeMoves);
    this.setLaces(laces);
  }

  setFreeMoves(list) {
    const clips = normalizeClips(list);
    if (!clips.length && !this.mover) return;
    if (!this.mover) this.mover = new FreeMover(this.THREE, this.mesh, clips);
    else this.mover.setClips(clips);
  }

  setLaces(list) {
    const next = normalizeLaces(list), keep = new Set(next.map(l => l.id));
    for (const [id, rig] of this.laces) if (!keep.has(id)) { rig.dispose(); this.laces.delete(id); }
    for (const l of next) {
      const rig = this.laces.get(l.id);
      if (rig) rig.set(l); else this.laces.set(l.id, new LaceRig(this.THREE, this.mesh, l));
    }
  }

  list() {
    return [...(this.mover?.list() || []), ...[...this.laces.values()].map(r => ({ id: r.lace.id, name: r.lace.name, kind: 'laces' }))];
  }
  has(id) { return !!(this.mover?.has(id) || this.laces.has(id)); }
  run(id, to = 'toggle', opts = {}) {
    if (this.laces.has(id)) return this.laces.get(id).run(to, opts);
    if (this.mover?.has(id)) return this.mover.run(id, to, opts);
    return Promise.resolve(false);
  }

  /** Clips and laces set to play on their own. A visitor's click takes over. Returns stop(). */
  startAutoplay() {
    let stopped = false; const timers = [], taken = new Set();
    const onMove = (e) => { if (e.detail?.by === 'visitor') taken.add(e.detail.id); };
    globalThis.addEventListener?.('fumoca:partMove', onMove);
    const later = (s, fn) => timers.push(setTimeout(() => { if (!stopped && !taken.has(fn.id)) fn(); }, s * 1000));
    for (const c of this.mover?.clips?.values?.() || []) if (c.autoplay) { const f = () => this.mover.run(c.id, 'open'); f.id = c.id; later(c.delay + 0.6, f); }
    for (const r of this.laces.values()) if (r.lace.autoplay) { const f = () => r.run('open'); f.id = r.lace.id; later(r.lace.delay + 0.6, f); }
    return () => { stopped = true; timers.forEach(clearTimeout); globalThis.removeEventListener?.('fumoca:partMove', onMove); };
  }

  dispose() { this.mover?.dispose(); for (const r of this.laces.values()) r.dispose(); this.laces.clear(); }
}

/** Published viewer: free moves and laces saved in Studio. */
export async function restoreExtrasOnViewer(THREE, mesh, data) {
  const freeMoves = normalizeClips(data?.freeMoves), laces = normalizeLaces(data?.laces);
  if (!mesh || (!freeMoves.length && !laces.length)) return null;
  if (mesh.initialized) await mesh.initialized;
  const x = new MotionExtras(THREE, mesh, { freeMoves, laces });
  x.stopAutoplay = x.startAutoplay();
  return x;
}
export { startT };
