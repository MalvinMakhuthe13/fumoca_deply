/**
 * Loads Rapier in Studio. Query and dynamic paths stay on the master clock.
 */
const FumocaPhysicsBoot = (() => {
  let started = false;
  async function start() {
    if (started) return { ok: true, already: true };
    if (!window.FumocaPhysics) return { ok: false, reason: 'physics_missing' };
    const r = await window.FumocaPhysics.initRapier();
    started = !!r?.ok;
    console.log('[PhysicsBoot]', r);
    return r;
  }
  return { start };
})();
window.FumocaPhysicsBoot = FumocaPhysicsBoot;
export default FumocaPhysicsBoot;
