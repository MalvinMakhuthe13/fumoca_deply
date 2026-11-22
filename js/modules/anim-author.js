/**
 * FUMOCA Articulation Author
 * Founder tool: load a demo or GLB, set joints, keyframe, scrub, save.
 * Uses the existing master clock. Does not create a second RAF.
 */
const FumocaAuthor = (() => {
  let panel = null;
  let currentObjectId = null;
  let playing = false;
  let raf = null;

  function _recordId() {
    return window._fumocaCurrentRecord?.id || window._fumocaNifId || null;
  }

  function _ensurePanel() {
    if (panel) return panel;
    panel = document.createElement('div');
    panel.id = 'fumocaAuthorPanel';
    panel.style.cssText = 'position:fixed;right:12px;top:72px;width:320px;max-height:70vh;overflow:auto;background:rgba(6,8,14,.96);border:1px solid rgba(156,255,200,.35);border-radius:16px;padding:14px;z-index:60;color:#e8ffe8;font:13px/1.4 system-ui;display:none;';
    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <strong>Articulation</strong>
        <button id="faClose" style="background:none;border:0;color:#9cf;cursor:pointer;">close</button>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;">
        <button id="faDemo">Cooler</button>
        <button id="faCar">Car</button>
        <button id="faHouse">House</button>
        <button id="faBottle">Bottle</button>
        <button id="faPerson">Person</button>
        <button id="faAnimal">Animal</button>
        <button id="faDrop">Drop bottle</button>
        <button id="faPlay">Play</button>
        <button id="faStop">Stop</button>
        <button id="faSave">Save</button>
      </div>
      <label>Time <input id="faTime" type="range" min="0" max="2" step="0.01" value="0" style="width:100%"></label>
      <div id="faStatus" style="font-size:11px;opacity:.8;margin:6px 0;"></div>
      <div id="faComponents"></div>
      <div style="margin-top:10px;border-top:1px solid rgba(255,255,255,.1);padding-top:8px;">
        <div style="font-size:11px;opacity:.7;margin-bottom:4px;">Set joint on selected component</div>
        <select id="faKind"><option>hinge</option><option>prismatic</option><option>lift</option><option>fixed</option></select>
        <button id="faApplyJoint">Apply joint</button>
        <div style="margin-top:6px;">
          <label>Value <input id="faValue" type="number" step="0.01" value="0" style="width:70px"></label>
          <button id="faKf">Keyframe</button>
        </div>
      </div>
    `;
    document.body.appendChild(panel);
    panel.querySelector('#faClose').onclick = () => { panel.style.display = 'none'; };
    panel.querySelector('#faDemo').onclick = () => createDemo();
    panel.querySelector('#faCar').onclick = () => loadScene('car');
    panel.querySelector('#faHouse').onclick = () => loadScene('house');
    panel.querySelector('#faBottle').onclick = () => loadScene('bottle');
    panel.querySelector('#faPerson').onclick = () => addChar('human');
    panel.querySelector('#faAnimal').onclick = () => addChar('animal');
    panel.querySelector('#faDrop').onclick = () => drop();
    panel.querySelector('#faPlay').onclick = () => togglePlay();
    panel.querySelector('#faStop').onclick = () => stop();
    panel.querySelector('#faSave').onclick = () => save();
    panel.querySelector('#faTime').oninput = (e) => scrub(Number(e.target.value));
    panel.querySelector('#faApplyJoint').onclick = () => applyJoint();
    panel.querySelector('#faKf').onclick = () => capture();
    return panel;
  }

  function open() {
    _ensurePanel().style.display = 'block';
    refresh();
  }

  function status(msg) {
    const el = panel?.querySelector('#faStatus');
    if (el) el.textContent = msg;
  }

  function loadScene(kind) {
    const scene = window.scene;
    if (!scene || !window.FumocaScenes) return status('Scenes unavailable');
    const r = kind === 'car' ? window.FumocaScenes.createCar(scene)
      : kind === 'house' ? window.FumocaScenes.createHouse(scene)
      : window.FumocaScenes.createBottle(scene);
    currentObjectId = r.objectId;
    if (r.ok) window.FumocaLive?.bind(r.objectId);
    status(r.ok ? 'Press a part to open it' : 'Scene failed');
    refresh();
  }

  function addChar(kind) {
    const r = window.FumocaLive?.addCharacter(window.scene, kind);
    status(r?.ok ? (kind + ' added') : 'Character unavailable');
  }

  function createDemo() {
    const scene = window.scene;
    if (!scene || !window.FumocaStudioInit?.createDemoCooler) {
      status('Scene or demo unavailable');
      return;
    }
    const r = window.FumocaStudioInit.createDemoCooler(scene);
    currentObjectId = r.objectId;
    status(r.ok ? 'Demo cooler ready' : 'Demo failed');
    refresh();
  }

  function refresh() {
    const box = panel?.querySelector('#faComponents');
    if (!box || !currentObjectId || !window.FumocaObjectAnim) return;
    const obj = window.FumocaObjectAnim.get(currentObjectId);
    if (!obj) { box.innerHTML = ''; return; }
    box.innerHTML = obj.components.map(c =>
      `<label style="display:block;margin:2px 0;"><input type="radio" name="faComp" value="${c.id}"> ${c.name} <span style="opacity:.6">${c.joint?.kind || c.type}</span></label>`
    ).join('');
  }

  function selectedId() {
    return panel?.querySelector('input[name="faComp"]:checked')?.value || null;
  }

  function applyJoint() {
    const id = selectedId();
    if (!id || !currentObjectId) return status('Select a component');
    const kind = panel.querySelector('#faKind').value;
    const r = window.FumocaObjectAnim.defineJoint(currentObjectId, id, {
      kind,
      axis: kind === 'prismatic' || kind === 'lift' ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 },
      limits: kind === 'hinge' ? { min: 0, max: Math.PI / 2 } : { min: 0, max: 0.4 },
    });
    status(r.ok ? `${kind} set` : (r.reason || 'failed'));
    refresh();
  }

  function capture() {
    const id = selectedId();
    if (!id) return status('Select a component');
    const t = Number(panel.querySelector('#faTime').value);
    const v = Number(panel.querySelector('#faValue').value);
    window.FumocaObjectAnim.setJointValue(currentObjectId, id, v);
    window.FumocaObjectAnim.captureKeyframe(currentObjectId, t);
    const obj = window.FumocaObjectAnim.get(currentObjectId);
    window.FumocaMaster.addObject(obj);
    status(`Keyframe at ${t}s`);
  }

  function scrub(t) {
    window.FumocaMaster?.evaluate?.(t);
    status(`t=${t.toFixed(2)}`);
  }

  function togglePlay() {
    if (window.FumocaMaster?.isPlaying?.()) { window.FumocaMaster.pause(); playing = false; return; }
    window.FumocaMaster?.setDuration?.(2);
    window.FumocaMaster?.play?.();
    playing = true;
  }

  function stop() {
    playing = false;
    window.FumocaMaster?.stop?.();
  }

  async function drop() {
    const scene = window.scene;
    const r = await window.FumocaStudioInit?.createDropDemo?.(scene);
    status(r?.ok ? 'Bottle will fall on play' : 'Drop unavailable');
  }

  async function save() {
    const id = _recordId();
    if (!id) return status('Open a NIF first');
    const r = await window.FumocaMaster.persist(id);
    status(r?.ok ? 'Saved' : (r?.error || 'Save failed'));
  }

  return { open, createDemo, scrub, stop };
})();

window.FumocaAuthor = FumocaAuthor;
export default FumocaAuthor;
