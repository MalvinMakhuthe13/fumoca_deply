/**
 * Presentation rig for the Studio editor.
 * The Gaussian, the editor points, and the selection overlay stay in one holder.
 * Sliders edit the base only. Spin and tilt rotate the whole rig.
 */
(function () {
  if (window.__fumocaPlatformReady) return;
  window.__fumocaPlatformReady = true;

  const state = {
    shape: "circle",
    fit: 130,
    thickness: 12,
    edge: 16,
    material: "wood",
    spin: 0,
    tilt: 0,
    drop: 0,
    logoScale: 62,
    logoRot: 0,
    logoShift: 0,
  };

  let root = null;
  let holder = null;
  let bodyMesh = null;
  let topMesh = null;
  let ring = null;
  let lip = null;
  let logoMesh = null;
  let logoTexture = null;
  let woodTexture = null;
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
            One rig. The photo, the points, and the base spin together. Turn it off before editing points.
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
          <button type="button" id="platApplyBtn" style="width:100%;margin-top:10px;height:36px;border-radius:8px;border:1px solid rgba(212,255,0,.45);background:rgba(212,255,0,.16);color:#d4ff00;font-weight:700;cursor:pointer">Seat on platform</button>
          <button type="button" id="platBottomBtn" style="width:100%;margin-top:6px;height:32px;border-radius:8px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:#fff;cursor:pointer">Show underside</button>
          <button type="button" id="platRemoveBtn" style="width:100%;margin-top:6px;height:32px;border-radius:8px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:#fff;cursor:pointer">Remove platform</button>
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

  function woodMap() {
    if (woodTexture) return woodTexture;
    const T = THREE();
    const c = document.createElement("canvas");
    c.width = 512; c.height = 512;
    const ctx = c.getContext("2d");
    let n = 42;
    const rand = () => {
      n = (n * 16807) % 2147483647;
      return (n & 0xffff) / 0xffff;
    };
    const g = ctx.createLinearGradient(0, 0, 512, 80);
    g.addColorStop(0, "#4a2e18");
    g.addColorStop(0.45, "#8d5a30");
    g.addColorStop(0.55, "#c4a574");
    g.addColorStop(1, "#3a2412");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 46; i++) {
      ctx.strokeStyle = "rgba(30,16,8," + (0.08 + rand() * 0.18) + ")";
      ctx.lineWidth = 0.6 + rand() * 1.6;
      const y = rand() * 512;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(140, y + (rand() - 0.5) * 24, 320, y + (rand() - 0.5) * 24, 512, y);
      ctx.stroke();
    }
    woodTexture = new T.CanvasTexture(c);
    woodTexture.wrapS = woodTexture.wrapT = T.RepeatWrapping;
    woodTexture.colorSpace = T.SRGBColorSpace;
    return woodTexture;
  }

  function topMaterial() {
    const T = THREE();
    if (state.material === "wood") return new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.04, map: woodMap() });
    if (state.material === "black") return new T.MeshStandardMaterial({ color: 0x161616, roughness: 0.4, metalness: 0.25 });
    if (state.material === "white") return new T.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.42, metalness: 0.02 });
    return new T.MeshStandardMaterial({ color: 0xb7b7b7, roughness: 0.16, metalness: 0.88 });
  }

  function sideMaterial() {
    const T = THREE();
    return new T.MeshStandardMaterial({ color: 0x101010, roughness: 0.42, metalness: 0.45 });
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

  function percentileBox(T, xs, ys, zs) {
    if (xs.length < 20) return null;
    const at = (arr, p) => {
      const s = arr.slice().sort((a, b) => a - b);
      return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
    };
    return new T.Box3(
      new T.Vector3(at(xs, 0.12), at(ys, 0.08), at(zs, 0.12)),
      new T.Vector3(at(xs, 0.88), at(ys, 0.98), at(zs, 0.88))
    );
  }

  function localBounds() {
    const T = THREE();
    if (!T) return null;
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
      const box = percentileBox(T, xs, ys, zs);
      if (box) return box;
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
    return percentileBox(T, xs, ys, zs);
  }

  function disposeMesh(mesh) {
    if (!mesh) return;
    mesh.parent?.remove(mesh);
    mesh.geometry?.dispose?.();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach((m) => m && m.dispose && m.dispose());
  }

  function metrics() {
    const width = Math.max(footprint * (state.fit / 100), 1e-4);
    const depth = state.shape === "rect" ? width * 0.66 : width;
    const height = Math.max(width * (state.thickness / 100), footprint * 0.012);
    const edge = Math.min(height * 0.48, width * (state.edge / 100) * 0.5);
    return { width, depth, height, edge };
  }

  function makeBase() {
    const T = THREE();
    const sc = getScene();
    if (!T || !root || !sc) return;
    disposeMesh(bodyMesh); bodyMesh = null;
    disposeMesh(topMesh); topMesh = null;
    disposeMesh(ring); ring = null;
    const { width, depth, height } = metrics();
    const side = sideMaterial();
    const top = topMaterial();
    const capH = Math.max(height * 0.1, footprint * 0.004);
    const bodyH = Math.max(height - capH, height * 0.55);
    if (state.shape === "circle") {
      const r = width / 2;
      bodyMesh = new T.Mesh(new T.CylinderGeometry(r, r, bodyH, 80), side);
    } else {
      bodyMesh = new T.Mesh(new T.BoxGeometry(width, bodyH, state.shape === "square" ? width : depth), side);
    }
    bodyMesh.name = "fumoca-platform-mesh";
    bodyMesh.position.y = -capH - bodyH / 2;
    root.add(bodyMesh);
    const inset = width * (state.edge / 100) * 0.12;
    const topW = Math.max(width - inset * 2, width * 0.72);
    const topD = Math.max(depth - inset * 2, depth * 0.72);
    if (state.shape === "circle") {
      topMesh = new T.Mesh(new T.CylinderGeometry(topW / 2, width / 2, capH, 80), top);
    } else {
      topMesh = new T.Mesh(new T.BoxGeometry(topW, capH, state.shape === "square" ? topW : topD), top);
    }
    topMesh.name = "fumoca-platform-top";
    topMesh.position.y = -capH / 2;
    root.add(topMesh);

    const radius = (state.shape === "circle" ? width : Math.max(width, depth)) * 0.5;
    ring = new T.Mesh(
      new T.TorusGeometry(radius * 1.02, Math.max(height * 0.045, radius * 0.012), 16, 96),
      new T.MeshBasicMaterial({ color: 0xfff4cc, toneMapped: false })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -height + Math.max(height * 0.22, radius * 0.02);
    root.add(ring);
    makeLogo();
  }

  function makeLogo() {
    const T = THREE();
    if (!T || !root) return;
    disposeMesh(logoMesh); logoMesh = null;
    if (!logoTexture) return;
    const { width, depth, height } = metrics();
    const span = Math.min(width, state.shape === "rect" ? depth : width) * (state.logoScale / 100);
    logoMesh = new T.Mesh(
      new T.PlaneGeometry(span, span),
      new T.MeshBasicMaterial({ map: logoTexture, transparent: true, depthWrite: false, side: T.DoubleSide })
    );
    logoMesh.name = "fumoca-platform-logo";
    logoMesh.rotation.x = Math.PI / 2;
    logoMesh.rotation.z = T.MathUtils.degToRad(state.logoRot);
    logoMesh.position.set(0, -height - Math.max(footprint * 0.002, 0.001), (state.logoShift / 100) * width * 0.5);
    logoMesh.renderOrder = 3;
    root.add(logoMesh);
  }

  function applyPose() {
    if (!root || !pivot || !holder) return;
    const T = THREE();
    root.position.set(pivot.x, pivot.y, pivot.z);
    root.rotation.order = "YXZ";
    root.rotation.set(T.MathUtils.degToRad(state.tilt), T.MathUtils.degToRad(state.spin), 0);
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
    const box = localBounds();
    if (!box) return false;
    const size = box.getSize(new T.Vector3());
    const center = box.getCenter(new T.Vector3());
    footprint = Math.max(size.x, size.z, 1e-4);
    seatCenter = center.clone();
    seatMinY = box.min.y;
    pivot = new T.Vector3(center.x, seatMinY - footprint * (state.drop / 100), center.z);
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
    applyPose();
    makeBase();
    adoptVisuals();
    if (!follow) follow = requestAnimationFrame(watch);
    return true;
  }

  function watch() {
    follow = requestAnimationFrame(watch);
    if (!active) return;
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
    disposeMesh(bodyMesh); bodyMesh = null;
    disposeMesh(topMesh); topMesh = null;
    disposeMesh(ring); ring = null;
    disposeMesh(lip); lip = null;
    disposeMesh(logoMesh); logoMesh = null;
    if (root) root.parent?.remove(root);
    root = null;
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
  }

  function bindRange(id, key, labelId, suffix, onInput) {
    const el = $(id);
    if (!el) return;
    el.addEventListener("input", () => {
      state[key] = Number(el.value);
      const label = $(labelId);
      if (label) label.textContent = String(Math.round(state[key])) + (suffix || "");
      onInput();
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
      });
    });
    document.querySelectorAll("#platMatRow [data-mat]").forEach((sw) => {
      sw.addEventListener("click", () => {
        state.material = sw.dataset.mat;
        document.querySelectorAll("#platMatRow [data-mat]").forEach((s) => {
          s.style.borderColor = s === sw ? "#d4ff00" : "transparent";
        });
        if (active) updateBase();
      });
    });
    bindRange("platFit", "fit", "platFitVal", "", () => active && updateBase(false));
    bindRange("platThick", "thickness", "platThickVal", "", () => active && updateBase(false));
    bindRange("platEdge", "edge", "platEdgeVal", "", () => active && updateBase(false));
    bindRange("platDrop", "drop", "platDropVal", "", () => active && updateBase(true));
    bindRange("platSpin", "spin", "platSpinVal", "", () => { if (!active) seat(); else applyPose(); });
    bindRange("platTilt", "tilt", "platTiltVal", "", () => { if (!active) seat(); else applyPose(); });
    bindRange("platLogoScale", "logoScale", "platLogoScaleVal", "", () => active && makeLogo());
    bindRange("platLogoRot", "logoRot", "platLogoRotVal", "", () => active && makeLogo());
    bindRange("platLogoShift", "logoShift", "platLogoShiftVal", "", () => active && makeLogo());
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
    });
    $("platRemoveBtn").addEventListener("click", removePlatform);
    $("platLogoBtn").addEventListener("click", () => $("platLogoInput").click());
    $("platLogoInput").addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const T = THREE();
          if (!T) return;
          if (logoTexture) logoTexture.dispose();
          logoTexture = new T.Texture(img);
          logoTexture.colorSpace = T.SRGBColorSpace;
          logoTexture.needsUpdate = true;
          const preview = $("platLogoPreview");
          if (preview) {
            preview.src = reader.result;
            preview.style.display = "block";
          }
          if (!active) seat();
          else makeLogo();
          status("Logo is on the underside. Press Show underside.");
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
    $("platClearLogo").addEventListener("click", () => {
      if (logoTexture) logoTexture.dispose();
      logoTexture = null;
      const input = $("platLogoInput");
      if (input) input.value = "";
      const preview = $("platLogoPreview");
      if (preview) { preview.removeAttribute("src"); preview.style.display = "none"; }
      disposeMesh(logoMesh); logoMesh = null;
      status("Logo removed.");
    });
  }

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
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
