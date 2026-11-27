/**
 * Presentation rig for the Studio editor.
 * The Gaussian, the editor points, and the selection overlay stay in one holder.
 * Sliders edit the base only. Spin and tilt rotate the whole rig.
 */
import { buildPlatform, normalizePlatformConfig, DEFAULT_PLATFORM, loadLogoTexture, logoFileToDataUrl, seatFromPoints } from './platform-build.js';

(function () {
  if (window.__fumocaPlatformReady) return;
  window.__fumocaPlatformReady = true;

  const state = { ...DEFAULT_PLATFORM };
  let baseGroup = null;
  let turntableAngle = 0;
  let lastFrame = 0;
  let changeTimer = 0;
  let root = null;
  let holder = null;
  let pivot = null;
  let seatCenter = null;
  let seatMinY = 0;
  let footprint = 1;
  let active = false;
  let follow = 0;

  const THREE = () => window.THREE;
  const getScene = () => window.scene || window._fumocaScene || null;
  const $ = (id) => document.getElementById(id);

  function ensureTab() {
    const tabs = $("leftTabs");
    const panel = $("panelLeft");
    if (!tabs || !panel) return false;
    let tab = tabs.querySelector('[data-tab="platform"]');
    if (!tab) {
      tab = document.createElement("div");
      tab.className = "ptab";
      tab.dataset.tab = "platform";
      tab.textContent = "Platform";
      tabs.appendChild(tab);
    }
    tabs.insertBefore(tab, tabs.firstChild);
    let body = $("tab-platform");
    if (!body) {
      body = document.createElement("div");
      body.className = "panel-body";
      body.id = "tab-platform";
      body.style.display = "none";
      panel.appendChild(body);
    }
    body.innerHTML = `
      <div class="section">
        <div class="sec-head"><span class="sec-label">Presentation base</span></div>
        <div class="sec-body" style="padding:10px">
          <div style="font-size:11px;line-height:1.45;color:rgba(255,255,255,.55);margin-bottom:8px">
            One rig: the splat and the base spin together. Turntable keeps it rotating in the published viewer. Saved with Present → Save.
          </div>
          <div id="platShapeRow" style="display:flex;gap:6px;margin:8px 0">
            <button type="button" data-shape="circle" class="plat-shape" style="flex:1;padding:7px;border-radius:8px;cursor:pointer;color:#fff;background:rgba(212,255,0,.14);border:1px solid rgba(212,255,0,.45)">Circle</button>
            <button type="button" data-shape="square" class="plat-shape" style="flex:1;padding:7px;border-radius:8px;cursor:pointer;color:#fff;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12)">Square</button>
            <button type="button" data-shape="rect" class="plat-shape" style="flex:1;padding:7px;border-radius:8px;cursor:pointer;color:#fff;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12)">Rect</button>
          </div>
          <label style="font-size:11px;color:rgba(255,255,255,.55)">Size <span id="platFitVal">130</span>%</label>
          <input type="range" id="platFit" min="80" max="220" value="130" style="width:100%">
          <label style="font-size:11px;color:rgba(255,255,255,.55)">Thickness <span id="platThickVal">12</span>%</label>
          <input type="range" id="platThick" min="4" max="40" value="12" style="width:100%">
          <label style="font-size:11px;color:rgba(255,255,255,.55)">Edge <span id="platEdgeVal">16</span>%</label>
          <input type="range" id="platEdge" min="0" max="40" value="16" style="width:100%">
          <label style="font-size:11px;color:rgba(255,255,255,.55)">Drop <span id="platDropVal">0</span>%</label>
          <input type="range" id="platDrop" min="-25" max="25" value="0" style="width:100%">
          <div style="margin-top:10px;font-size:11px;color:rgba(255,255,255,.55)">Material</div>
          <div id="platMatRow" style="display:flex;gap:8px;margin:6px 0">
            <div data-mat="wood" title="Wood" style="width:28px;height:28px;border-radius:50%;background:#8B4513;cursor:pointer;border:2px solid #d4ff00"></div>
            <div data-mat="black" title="Black" style="width:28px;height:28px;border-radius:50%;background:#111;cursor:pointer;border:2px solid transparent"></div>
            <div data-mat="white" title="White" style="width:28px;height:28px;border-radius:50%;background:#eee;cursor:pointer;border:2px solid transparent"></div>
            <div data-mat="metal" title="Metal" style="width:28px;height:28px;border-radius:50%;background:#aaa;cursor:pointer;border:2px solid transparent"></div>
          </div>
          <div style="margin-top:10px;font-size:11px;color:rgba(255,255,255,.55)">Logo on underside</div>
          <div style="display:flex;gap:8px;align-items:center;margin-top:6px">
            <img id="platLogoPreview" alt="" style="width:54px;height:54px;object-fit:contain;border-radius:8px;background:#111;border:1px solid rgba(255,255,255,.12);display:none">
            <div style="flex:1">
              <button type="button" id="platLogoBtn" style="width:100%;height:32px;border-radius:8px;border:1px solid rgba(212,255,0,.4);background:rgba(212,255,0,.12);color:#d4ff00;cursor:pointer">Upload logo</button>
              <button type="button" id="platClearLogo" style="width:100%;height:28px;margin-top:4px;border-radius:8px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:#fff;cursor:pointer">Remove logo</button>
            </div>
          </div>
          <input type="file" id="platLogoInput" accept="image/*" style="display:none">
          <label style="font-size:11px;color:rgba(255,255,255,.55)">Logo size <span id="platLogoScaleVal">62</span>%</label>
          <input type="range" id="platLogoScale" min="20" max="100" value="62" style="width:100%">
          <label style="font-size:11px;color:rgba(255,255,255,.55)">Logo rotation <span id="platLogoRotVal">0</span>°</label>
          <input type="range" id="platLogoRot" min="0" max="360" value="0" style="width:100%">
          <label style="font-size:11px;color:rgba(255,255,255,.55)">Logo shift <span id="platLogoShiftVal">0</span>%</label>
          <input type="range" id="platLogoShift" min="-40" max="40" value="0" style="width:100%">
          <label style="font-size:11px;color:rgba(255,255,255,.55);display:block;margin-top:8px">Spin <span id="platSpinVal">0</span>°</label>
          <input type="range" id="platSpin" min="0" max="360" value="0" style="width:100%">
          <label style="font-size:11px;color:rgba(255,255,255,.55)">Tilt <span id="platTiltVal">0</span>°</label>
          <input type="range" id="platTilt" min="0" max="180" value="0" style="width:100%">
          <label style="font-size:11px;color:rgba(255,255,255,.55)">Turntable <span id="platTurntableVal">0</span>°/s</label>
          <input type="range" id="platTurntable" min="-60" max="60" value="0" style="width:100%">
          <button type="button" id="platFlatBtn" class="ac-btn full" style="width:100%;margin-top:10px" title="Finds what it stands on (or uses the selected base) and sets it flat on the grid">① Sit flat on the grid</button>
          <button type="button" id="platApplyBtn" class="ac-btn lime full" style="width:100%;margin-top:6px">② Seat on platform</button>
          <button type="button" id="platBottomBtn" class="ac-btn full" style="width:100%;margin-top:6px">Show underside</button>
          <button type="button" id="platRemoveBtn" class="ac-btn full" style="width:100%;margin-top:6px">Remove platform</button>
          <div id="platStatus" style="margin-top:8px;font-size:11px;color:rgba(255,255,255,.45)">Load a splat, then seat it.</div>
        </div>
      </div>`;
    return true;
  }

  function ensureToolbarButton() {
    const bar = $("toolbar");
    if (!bar || $("openPlatformTab")) return;
    const btn = document.createElement("button");
    btn.id = "openPlatformTab";
    btn.className = "tool-btn";
    btn.title = "Presentation platform";
    btn.textContent = "▣";
    btn.style.color = "#d4ff00";
    btn.addEventListener("click", () => document.querySelector('#leftTabs [data-tab="platform"]')?.click());
    (bar.querySelector(".tool-group") || bar).appendChild(btn);
  }

  function status(msg) {
    const el = $("platStatus");
    if (el) el.textContent = msg;
  }

  function sparkMesh() {
    const sc = getScene();
    let found = null;
    sc?.traverse((obj) => { if (obj.name === "fumoca-spark-splat") found = obj; });
    return found;
  }

  function visuals() {
    const list = [];
    const mesh = sparkMesh();
    if (mesh) list.push(mesh);
    const pts = window.S && window.S.points;
    if (pts) list.push(pts);
    return list;
  }

  function selectionOverlay() {
    const sc = getScene();
    let found = null;
    sc?.traverse((obj) => { if (obj.name === "fumoca-spark-selection-overlay") found = obj; });
    return found;
  }

  function localSeat() {
    const mesh = sparkMesh();
    const splats = mesh && (mesh.splats || mesh.packedSplats);
    if (splats?.forEachSplat && window.FumocaSparkGaussian?.isEnabled?.()) {
      const xs = [], ys = [], zs = [];
      try {
        splats.forEachSplat((index, center) => {
          if ((index & 7) !== 0 || !center || !isFinite(center.x)) return;
          xs.push(center.x); ys.push(center.y); zs.push(center.z);
        });
      } catch (_) {}
      const seatInfo = seatFromPoints(xs, ys, zs);
      if (seatInfo) return seatInfo;
    }
    const S = window.S;
    if (!S?.positions || !S?.alive) return null;
    const xs = [], ys = [], zs = [];
    const n = S.alive.length;
    const step = n > 60000 ? Math.ceil(n / 60000) : 1;
    for (let i = 0; i < n; i += step) {
      if (!S.alive[i]) continue;
      const x = S.positions[i * 3], y = S.positions[i * 3 + 1], z = S.positions[i * 3 + 2];
      if (!isFinite(x) || !isFinite(y) || !isFinite(z)) continue;
      xs.push(x); ys.push(y); zs.push(z);
    }
    return seatFromPoints(xs, ys, zs);
  }

  function disposeMesh(mesh) {
    if (!mesh) return;
    mesh.parent?.remove(mesh);
    mesh.geometry?.dispose?.();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach((m) => m && m.dispose && m.dispose());
  }

  let logoTexture = null;
  let logoLoadedFor = null;
  async function ensureLogoTexture() {
    const T = THREE();
    if (!T) return null;
    if (logoLoadedFor === state.logoSrc) return logoTexture;
    logoTexture?.dispose?.();
    logoTexture = state.logoSrc ? await loadLogoTexture(T, state.logoSrc) : null;
    logoLoadedFor = state.logoSrc;
    return logoTexture;
  }

  function makeBase() {
    const T = THREE();
    if (!T || !root) return;
    if (!baseGroup) { baseGroup = new T.Group(); baseGroup.name = 'fumoca-platform-base'; root.add(baseGroup); }
    buildPlatform(T, baseGroup, state, footprint, logoTexture);
    ensureLogoTexture().then((tex) => { if (tex && active && baseGroup) buildPlatform(T, baseGroup, state, footprint, tex); });
  }
  const makeLogo = () => makeBase();

  function changed() {
    clearTimeout(changeTimer);
    changeTimer = setTimeout(() => {
      window.dispatchEvent(new CustomEvent('fumoca:platformChange', { detail: getConfig() }));
    }, 250);
  }

  function getConfig() {
    return normalizePlatformConfig({ ...state, enabled: active });
  }

  function applyPose() {
    if (!root || !pivot || !holder) return;
    const T = THREE();
    root.position.set(pivot.x, pivot.y, pivot.z);
    root.rotation.order = "YXZ";
    root.rotation.set(T.MathUtils.degToRad(state.tilt), T.MathUtils.degToRad(state.spin + turntableAngle), 0);
    holder.position.set(-pivot.x, -pivot.y, -pivot.z);
    holder.rotation.set(0, 0, 0);
    holder.scale.set(1, 1, 1);
  }

  function park(obj) {
    if (!holder || !obj || obj === holder || obj === root) return;
    if (obj.parent === holder && obj.position.lengthSq() < 1e-12) return;
    const kept = obj.quaternion.clone();
    if (obj.parent !== holder) holder.add(obj);
    obj.position.set(0, 0, 0);
    obj.quaternion.copy(kept);
    obj.scale.set(1, 1, 1);
  }

  function adoptVisuals() {
    if (!active || !holder) return;
    visuals().forEach(park);
  }

  function releaseVisuals() {
    const sc = getScene();
    if (!holder || !sc) return;
    [...holder.children].forEach((obj) => {
      sc.add(obj);
      obj.position.set(0, 0, 0);
      obj.quaternion.identity();
      obj.scale.set(1, 1, 1);
      obj.visible = true;
    });
    const overlay = selectionOverlay();
    if (overlay) overlay.visible = true;
  }

  function seat() {
    const T = THREE();
    const sc = getScene();
    if (!T || !sc) return false;
    if (active) releaseVisuals();
    const seatInfo = localSeat();
    if (!seatInfo) return false;
    footprint = seatInfo.footprint;
    seatCenter = new T.Vector3(...seatInfo.center);
    // After “Sit flat” the base is exactly y = 0. The top sits a hair below the
    // splats so the two never fight for the same pixels (that was the flicker).
    seatMinY = (window.S?._sitFlat ? Math.min(0, seatInfo.minY) : seatInfo.minY) - footprint * 0.003;
    pivot = new T.Vector3(seatCenter.x, seatMinY - footprint * (state.drop / 100), seatCenter.z);
    if (!root) {
      root = new T.Group();
      root.name = "fumoca-presentation-root";
      sc.add(root);
    }
    if (!holder) {
      holder = new T.Group();
      holder.name = "fumoca-presentation-splats";
      root.add(holder);
    }
    active = true;
    // The editor grid would cut through the platform and flicker against it.
    if (window._fumocaOrientationGrid) window._fumocaOrientationGrid.visible = false;
    applyPose();
    makeBase();
    adoptVisuals();
    if (!follow) follow = requestAnimationFrame(watch);
    changed();
    return true;
  }

  function watch(now) {
    follow = requestAnimationFrame(watch);
    const dt = lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 0;
    lastFrame = now;
    if (!active) return;
    if (state.turntable) { turntableAngle = (turntableAngle + state.turntable * dt) % 360; applyPose(); }
    adoptVisuals();
    const overlay = selectionOverlay();
    if (overlay) overlay.visible = false;
  }

  function updateBase(movePivot) {
    if (!active || !seatCenter) return;
    if (movePivot) {
      pivot.set(seatCenter.x, seatMinY - footprint * (state.drop / 100), seatCenter.z);
      applyPose();
    }
    makeBase();
  }

  function removePlatform() {
    releaseVisuals();
    if (window._fumocaOrientationGrid) window._fumocaOrientationGrid.visible = true;
    if (baseGroup) { [...baseGroup.children].forEach(disposeMesh); baseGroup = null; }
    if (root) root.parent?.remove(root);
    root = null;
    turntableAngle = 0;
    holder = null;
    pivot = null;
    seatCenter = null;
    active = false;
    state.spin = 0;
    state.tilt = 0;
    const spin = $("platSpin");
    const tilt = $("platTilt");
    if (spin) spin.value = "0";
    if (tilt) tilt.value = "0";
    const sv = $("platSpinVal");
    const tv = $("platTiltVal");
    if (sv) sv.textContent = "0";
    if (tv) tv.textContent = "0";
    status("Platform removed. The splat is back in the editor.");
    changed();
  }

  function bindRange(id, key, labelId, suffix, onInput) {
    const el = $(id);
    if (!el) return;
    el.addEventListener("input", () => {
      state[key] = Number(el.value);
      const label = $(labelId);
      if (label) label.textContent = String(Math.round(state[key])) + (suffix || "");
      onInput();
      changed();
    });
  }

  function wire() {
    document.querySelectorAll("#platShapeRow .plat-shape").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.shape = btn.dataset.shape;
        document.querySelectorAll("#platShapeRow .plat-shape").forEach((b) => {
          const on = b === btn;
          b.style.background = on ? "rgba(212,255,0,.14)" : "rgba(255,255,255,.06)";
          b.style.borderColor = on ? "rgba(212,255,0,.45)" : "rgba(255,255,255,.12)";
        });
        if (active) updateBase();
        changed();
      });
    });
    document.querySelectorAll("#platMatRow [data-mat]").forEach((sw) => {
      sw.addEventListener("click", () => {
        state.material = sw.dataset.mat;
        document.querySelectorAll("#platMatRow [data-mat]").forEach((s) => {
          s.style.borderColor = s === sw ? "#d4ff00" : "transparent";
        });
        if (active) updateBase();
        changed();
      });
    });
    bindRange("platTurntable", "turntable", "platTurntableVal", "", () => { if (!active && state.turntable) seat(); });
    bindRange("platFit", "fit", "platFitVal", "", () => active && updateBase(false));
    bindRange("platThick", "thickness", "platThickVal", "", () => active && updateBase(false));
    bindRange("platEdge", "edge", "platEdgeVal", "", () => active && updateBase(false));
    bindRange("platDrop", "drop", "platDropVal", "", () => active && updateBase(true));
    bindRange("platSpin", "spin", "platSpinVal", "", () => { if (!active) seat(); else applyPose(); });
    bindRange("platTilt", "tilt", "platTiltVal", "", () => { if (!active) seat(); else applyPose(); });
    bindRange("platLogoScale", "logoScale", "platLogoScaleVal", "", () => active && makeLogo());
    bindRange("platLogoRot", "logoRot", "platLogoRotVal", "", () => active && makeLogo());
    bindRange("platLogoShift", "logoShift", "platLogoShiftVal", "", () => active && makeLogo());
    $("platFlatBtn")?.addEventListener("click", async () => {
      const wasActive = active;
      if (wasActive) removePlatform();
      const res = await window.FumocaSitFlat?.();
      if (!res) { status("Could not find a flat base — select what it stands on (sole, table, wheels) and press ① again."); return; }
      if (wasActive) seat();
      status(`Sitting flat (turned ${res.angleDeg.toFixed(1)}°). Now press ② to seat it on the platform.`);
    });
    $("platApplyBtn").addEventListener("click", () => {
      status(seat() ? "Seated. Spin turns it. Tilt shows the underside." : "Load a splat first, then seat it.");
    });
    $("platBottomBtn").addEventListener("click", () => {
      state.tilt = state.tilt > 90 ? 0 : 180;
      const tilt = $("platTilt");
      if (tilt) tilt.value = String(state.tilt);
      const tv = $("platTiltVal");
      if (tv) tv.textContent = String(state.tilt);
      if (!active) seat();
      else applyPose();
      status(state.tilt ? "Underside. The logo sits on the black face." : "Back to the top.");
      changed();
    });
    $("platRemoveBtn").addEventListener("click", removePlatform);
    $("platLogoBtn").addEventListener("click", () => $("platLogoInput").click());
    $("platLogoInput").addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        state.logoSrc = await logoFileToDataUrl(file);
        const preview = $("platLogoPreview");
        if (preview) { preview.src = state.logoSrc; preview.style.display = "block"; }
        if (!active) seat(); else makeLogo();
        changed();
        status("Logo is on the underside. Press Show underside.");
      } catch (err) {
        status("Could not read that image: " + (err.message || err));
      }
    });
    $("platClearLogo").addEventListener("click", () => {
      state.logoSrc = null;
      const input = $("platLogoInput");
      if (input) input.value = "";
      const preview = $("platLogoPreview");
      if (preview) { preview.removeAttribute("src"); preview.style.display = "none"; }
      if (active) makeBase();
      changed();
      status("Logo removed.");
    });
  }

  function syncControls() {
    const set = (id, v, labelId) => { const el = $(id); if (el) el.value = String(v); const l = labelId && $(labelId); if (l) l.textContent = String(Math.round(v)); };
    set("platFit", state.fit, "platFitVal"); set("platThick", state.thickness, "platThickVal");
    set("platEdge", state.edge, "platEdgeVal"); set("platDrop", state.drop, "platDropVal");
    set("platSpin", state.spin, "platSpinVal"); set("platTilt", state.tilt, "platTiltVal");
    set("platLogoScale", state.logoScale, "platLogoScaleVal"); set("platLogoRot", state.logoRot, "platLogoRotVal");
    set("platLogoShift", state.logoShift, "platLogoShiftVal"); set("platTurntable", state.turntable, "platTurntableVal");
    document.querySelectorAll("#platShapeRow .plat-shape").forEach((b) => {
      const on = b.dataset.shape === state.shape;
      b.style.background = on ? "rgba(212,255,0,.14)" : "rgba(255,255,255,.06)";
      b.style.borderColor = on ? "rgba(212,255,0,.45)" : "rgba(255,255,255,.12)";
    });
    document.querySelectorAll("#platMatRow [data-mat]").forEach((sw) => { sw.style.borderColor = sw.dataset.mat === state.material ? "#d4ff00" : "transparent"; });
    const preview = $("platLogoPreview");
    if (preview) { if (state.logoSrc) { preview.src = state.logoSrc; preview.style.display = "block"; } else { preview.removeAttribute("src"); preview.style.display = "none"; } }
  }

  /** Apply a saved config (e.g. from the NIF's present metadata). */
  function setConfig(cfg) {
    const next = normalizePlatformConfig(cfg);
    Object.assign(state, next);
    syncControls();
    if (next.enabled) { if (!seat()) status("Saved platform will appear once the splat has loaded."); else status("Saved platform restored."); }
    else if (active) removePlatform();
  }

  // Restore the platform saved with this NIF once its splat is in the scene.
  window.addEventListener("fumoca:fileLoaded", () => {
    const saved = window._fumocaCurrentRecord?.meta?.present?.platform;
    if (saved?.enabled) setTimeout(() => setConfig(saved), 600);
  });

  function boot() {
    if (!ensureTab()) return setTimeout(boot, 200);
    ensureToolbarButton();
    wire();
    console.log("[FUMOCA] Platform rig ready");
  }

  window.FumocaPresentation = {
    host() { return null; },
    adoptVisuals,
    apply() { return seat(); },
    remove: removePlatform,
    getConfig,
    setConfig,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
