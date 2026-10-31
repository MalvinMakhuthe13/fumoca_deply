/**
 * Presentation platform inside the Studio editor.
 * The loaded splat and the base live in one group: orbit/zoom stay on the
 * camera, flip rotates both, and the splat sits on the top face.
 */
(function () {
  if (window.__fumocaPlatformReady) return;
  window.__fumocaPlatformReady = true;

  const state = {
    shape: "circle",
    fit: 130,
    thickness: 14,
    material: "wood",
    angle: 0,
  };

  let root = null;
  let platformMesh = null;
  let ring = null;
  let logoTexture = null;

  const THREE = () => window.THREE;
  const scene = () => window.scene || window._fumocaScene || null;

  function $(id) { return document.getElementById(id); }

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
    tab.title = "Presentation platform";

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
          <div style="font-size:11px;color:rgba(255,255,255,.55);line-height:1.45;margin-bottom:8px">
            The splat and the base are one object. Orbit and zoom stay connected. Flip shows the logo on the underside.
          </div>
          <div id="platShapeRow" style="display:flex;gap:6px;margin:8px 0">
            <button type="button" data-shape="circle" class="plat-shape" style="flex:1;padding:7px;border-radius:8px;cursor:pointer;background:rgba(212,255,0,.14);border:1px solid rgba(212,255,0,.45);color:#fff">Circle</button>
            <button type="button" data-shape="square" class="plat-shape" style="flex:1;padding:7px;border-radius:8px;cursor:pointer;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:#fff">Square</button>
            <button type="button" data-shape="rect" class="plat-shape" style="flex:1;padding:7px;border-radius:8px;cursor:pointer;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:#fff">Rect</button>
          </div>
          <label style="font-size:11px;color:rgba(255,255,255,.55)">Size <span id="platFitVal">130</span>% of object</label>
          <input type="range" id="platFit" min="80" max="220" value="130" style="width:100%">
          <label style="font-size:11px;color:rgba(255,255,255,.55)">Thickness <span id="platThickVal">14</span>%</label>
          <input type="range" id="platThick" min="4" max="40" value="14" style="width:100%">
          <div style="margin-top:10px;font-size:11px;color:rgba(255,255,255,.55)">Material</div>
          <div id="platMatRow" style="display:flex;gap:8px;margin:6px 0">
            <div data-mat="wood" style="width:28px;height:28px;border-radius:50%;background:#8B4513;cursor:pointer;border:2px solid #d4ff00"></div>
            <div data-mat="black" style="width:28px;height:28px;border-radius:50%;background:#111;cursor:pointer;border:2px solid transparent"></div>
            <div data-mat="white" style="width:28px;height:28px;border-radius:50%;background:#eee;cursor:pointer;border:2px solid transparent"></div>
            <div data-mat="metal" style="width:28px;height:28px;border-radius:50%;background:#aaa;cursor:pointer;border:2px solid transparent"></div>
            <div data-mat="glass" style="width:28px;height:28px;border-radius:50%;background:#7fd7e8;cursor:pointer;border:2px solid transparent"></div>
          </div>
          <div style="margin-top:8px;font-size:11px;color:rgba(255,255,255,.55)">Logo on underside</div>
          <input type="file" id="platLogoInput" accept="image/*" style="width:100%;margin-top:4px;color:#fff;font-size:12px">
          <button type="button" id="platClearLogo" style="width:100%;margin-top:6px;height:32px;border-radius:8px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:#fff;cursor:pointer">Remove logo</button>
          <label style="font-size:11px;color:rgba(255,255,255,.55);display:block;margin-top:10px">Flip <span id="platAngleVal">0</span>°</label>
          <input type="range" id="platAngle" min="0" max="360" value="0" style="width:100%">
          <button type="button" id="platApplyBtn" style="width:100%;margin-top:10px;height:36px;border-radius:8px;border:1px solid rgba(212,255,0,.45);background:rgba(212,255,0,.16);color:#d4ff00;font-weight:700;cursor:pointer">Seat on platform</button>
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
    btn.addEventListener("click", openTab);
    const view = bar.querySelector(".tool-group");
    if (view) view.appendChild(btn);
    else bar.appendChild(btn);
  }

  function openTab() {
    const tab = document.querySelector('#leftTabs [data-tab="platform"]');
    if (tab) tab.click();
  }

  function status(msg) {
    const el = $("platStatus");
    if (el) el.textContent = msg;
  }

  function woodMap() {
    const T = THREE();
    const c = document.createElement("canvas");
    c.width = 512; c.height = 512;
    const ctx = c.getContext("2d");
    const g = ctx.createLinearGradient(0, 0, 512, 0);
    g.addColorStop(0, "#3a2414");
    g.addColorStop(0.35, "#8a5a32");
    g.addColorStop(0.5, "#c4a574");
    g.addColorStop(0.7, "#6b4226");
    g.addColorStop(1, "#2a180e");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 70; i++) {
      ctx.strokeStyle = "rgba(0,0,0," + (0.04 + Math.random() * 0.12) + ")";
      ctx.lineWidth = 0.6 + Math.random() * 2;
      ctx.beginPath();
      ctx.moveTo(0, Math.random() * 512);
      ctx.bezierCurveTo(160, Math.random() * 512, 320, Math.random() * 512, 512, Math.random() * 512);
      ctx.stroke();
    }
    const tex = new T.CanvasTexture(c);
    tex.wrapS = tex.wrapT = T.RepeatWrapping;
    tex.colorSpace = T.SRGBColorSpace;
    return tex;
  }

  function topMaterial() {
    const T = THREE();
    if (state.material === "wood") return new T.MeshStandardMaterial({ color: 0x8b4513, roughness: 0.62, metalness: 0.04, map: woodMap() });
    if (state.material === "black") return new T.MeshStandardMaterial({ color: 0x111111, roughness: 0.35, metalness: 0.2 });
    if (state.material === "white") return new T.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.45, metalness: 0.04 });
    if (state.material === "metal") return new T.MeshStandardMaterial({ color: 0xb7b7b7, roughness: 0.18, metalness: 0.86 });
    return new T.MeshPhysicalMaterial({ color: 0xb7e7f2, roughness: 0.05, metalness: 0.05, transmission: 0.86, thickness: 0.4, transparent: true });
  }

  function undersideMaterial() {
    const T = THREE();
    return new T.MeshStandardMaterial({
      color: 0x070707,
      roughness: 0.42,
      metalness: 0.25,
      map: logoTexture || null,
      emissive: logoTexture ? 0xffe7a0 : 0x222222,
      emissiveMap: logoTexture || null,
      emissiveIntensity: logoTexture ? 1.1 : 0.2,
    });
  }

  function splatObjects() {
    const sc = scene();
    const found = [];
    const names = { "fumoca-spark-splat": 1, "fumoca-spark-selection-overlay": 1 };
    if (sc) sc.traverse((obj) => { if (names[obj.name]) found.push(obj); });
    const pts = window.S && window.S.points;
    if (pts && found.indexOf(pts) === -1) found.push(pts);
    return found.filter((obj) => obj !== platformMesh && obj !== ring && obj !== root);
  }

  function sparkMesh() {
    const sc = scene();
    return sc ? sc.getObjectByName("fumoca-spark-splat") : null;
  }

  function visualObjects() {
    const mesh = sparkMesh();
    if (mesh && window.FumocaSparkGaussian?.isEnabled?.()) return [mesh];
    const pts = window.S && window.S.points;
    return pts ? [pts] : [];
  }

  function hideSelectionOverlay(hidden) {
    const sc = scene();
    const overlay = sc && sc.getObjectByName("fumoca-spark-selection-overlay");
    if (overlay) overlay.visible = !hidden;
  }

  function worldBounds() {
    const T = THREE();
    if (!T) return null;
    const mesh = sparkMesh();
    if (mesh && mesh.getBoundingBox && mesh.initialized && window.FumocaSparkGaussian?.isEnabled?.()) {
      try {
        mesh.updateWorldMatrix(true, true);
        const local = mesh.getBoundingBox(true);
        if (local && isFinite(local.min.x) && local.min.x < local.max.x) {
          return local.clone().applyMatrix4(mesh.matrixWorld);
        }
      } catch (_) {}
    }
    const S = window.S;
    const obj = (window.S && window.S.points) || null;
    if (!S?.positions || !S?.alive) return null;
    if (obj) obj.updateWorldMatrix(true, true);
    const v = new T.Vector3();
    const xs = [], ys = [], zs = [];
    const n = S.alive.length;
    const step = n > 60000 ? Math.ceil(n / 60000) : 1;
    for (let i = 0; i < n; i += step) {
      if (!S.alive[i]) continue;
      v.set(S.positions[i * 3], S.positions[i * 3 + 1], S.positions[i * 3 + 2]);
      if (obj) v.applyMatrix4(obj.matrixWorld);
      if (!isFinite(v.x) || !isFinite(v.y) || !isFinite(v.z)) continue;
      xs.push(v.x); ys.push(v.y); zs.push(v.z);
    }
    if (xs.length < 20) return null;
    const at = (arr, p) => {
      const s = arr.slice().sort((a, b) => a - b);
      return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
    };
    return new T.Box3(
      new T.Vector3(at(xs, 0.08), at(ys, 0.06), at(zs, 0.08)),
      new T.Vector3(at(xs, 0.92), at(ys, 0.98), at(zs, 0.92))
    );
  }

  function releaseToScene() {
    const sc = scene();
    if (!root || !sc) return;
    splatObjects().forEach((obj) => {
      if (obj.parent === root) sc.attach(obj);
    });
    root.position.set(0, 0, 0);
    root.rotation.set(0, 0, 0);
    root.updateMatrixWorld(true);
  }

  function ensureRoot() {
    const T = THREE();
    const sc = scene();
    if (!T || !sc) return null;
    if (!root) {
      root = new T.Group();
      root.name = "fumoca-presentation-root";
      sc.add(root);
    }
    return root;
  }

  function attachSplat() {
    const g = ensureRoot();
    if (!g) return;
    splatObjects().forEach((obj) => {
      if (obj.parent !== g) g.attach(obj);
    });
  }

  function seatOnPlatform() {
    const T = THREE();
    const g = ensureRoot();
    const sc = scene();
    if (!T || !g || !sc) return false;
    releaseToScene();
    const box = worldBounds();
    if (!box) return false;
    const center = box.getCenter(new T.Vector3());
    const size = box.getSize(new T.Vector3());
    const footprint = Math.max(size.x, size.z, 1e-4);
    const width = footprint * (state.fit / 100);
    const depth = state.shape === "rect" ? width * 0.66 : width;
    const height = Math.max(width * (state.thickness / 100), footprint * 0.015);

    g.position.set(center.x, box.min.y, center.z);
    g.rotation.set(0, 0, 0);
    g.updateMatrixWorld(true);
    visualObjects().forEach((obj) => g.attach(obj));
    hideSelectionOverlay(true);

    if (platformMesh) {
      g.remove(platformMesh);
      platformMesh.geometry.dispose();
      const mats = Array.isArray(platformMesh.material) ? platformMesh.material : [platformMesh.material];
      mats.forEach((m) => m.dispose());
    }
    if (ring) {
      g.remove(ring);
      ring.geometry.dispose();
      ring.material.dispose();
      ring = null;
    }

    const wood = topMaterial();
    const side = new T.MeshStandardMaterial({ color: 0x141414, roughness: 0.45, metalness: 0.35 });
    const under = undersideMaterial();
    let geo;
    if (state.shape === "circle") {
      geo = new T.CylinderGeometry(width / 2, width / 2, height, 80);
      platformMesh = new T.Mesh(geo, [side, wood, under]);
    } else {
      geo = new T.BoxGeometry(width, height, state.shape === "square" ? width : depth);
      platformMesh = new T.Mesh(geo, [side, side, wood, under, side, side]);
    }
    platformMesh.name = "fumoca-platform-mesh";
    platformMesh.position.set(0, -height / 2, 0);
    platformMesh.castShadow = true;
    platformMesh.receiveShadow = true;
    g.add(platformMesh);

    if (logoTexture && under.map) {
      const scale = 0.72;
      under.map.center.set(0.5, 0.5);
      under.map.repeat.set(scale, scale);
      under.map.needsUpdate = true;
    }

    const radius = (state.shape === "circle" ? width : Math.max(width, depth)) * 0.5;
    ring = new T.Mesh(
      new T.TorusGeometry(radius * 0.96, Math.max(height * 0.08, radius * 0.012), 12, 80),
      new T.MeshBasicMaterial({ color: 0xffe7a0, transparent: true, opacity: 0.85, depthWrite: false })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -height + Math.max(height * 0.08, radius * 0.01);
    g.add(ring);
    applyAngle();
    return true;
  }

  function applyAngle() {
    if (!root) return;
    const T = THREE();
    root.rotation.x = T.MathUtils.degToRad(state.angle);
  }

  function rebuild() {
    if (!THREE() || !scene()) {
      status("Editor scene is not ready yet.");
      return;
    }
    const seated = seatOnPlatform();
    status(seated
      ? "Seated under the splat. Drag to orbit, scroll to zoom, flip to see the logo."
      : "Load a splat first, then seat it.");
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
        rebuild({ seat: true });
      });
    });
    document.querySelectorAll("#platMatRow [data-mat]").forEach((sw) => {
      sw.addEventListener("click", () => {
        state.material = sw.dataset.mat;
        document.querySelectorAll("#platMatRow [data-mat]").forEach((s) => {
          s.style.borderColor = s === sw ? "#d4ff00" : "transparent";
        });
        rebuild({ seat: true });
      });
    });
    $("platFit").addEventListener("input", (e) => {
      state.fit = Number(e.target.value);
      $("platFitVal").textContent = String(state.fit);
      rebuild({ seat: true });
    });
    $("platThick").addEventListener("input", (e) => {
      state.thickness = Number(e.target.value);
      $("platThickVal").textContent = String(state.thickness);
      rebuild({ seat: true });
    });
    $("platAngle").addEventListener("input", (e) => {
      state.angle = Number(e.target.value);
      $("platAngleVal").textContent = String(Math.round(state.angle));
      if (!root) rebuild({ seat: true });
      else applyAngle();
    });
    $("platApplyBtn").addEventListener("click", () => rebuild({ seat: true }));
    $("platLogoInput").addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const T = THREE();
          if (!T) return;
          logoTexture = new T.Texture(img);
          logoTexture.colorSpace = T.SRGBColorSpace;
          logoTexture.needsUpdate = true;
          rebuild({ seat: false });
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
    $("platClearLogo").addEventListener("click", () => {
      logoTexture = null;
      const input = $("platLogoInput");
      if (input) input.value = "";
      rebuild({ seat: false });
    });
    $("platRemoveBtn").addEventListener("click", () => {
      const sc = scene();
      if (root && sc) {
        splatObjects().forEach((obj) => sc.attach(obj));
        sc.remove(root);
      }
      root = null;
      platformMesh = null;
      ring = null;
      hideSelectionOverlay(false);
      state.angle = 0;
      const angle = $("platAngle");
      if (angle) angle.value = "0";
      const label = $("platAngleVal");
      if (label) label.textContent = "0";
      status("Platform removed. The splat stays where you left it.");
    });
  }

  function wrapSpark() {
    const spark = window.FumocaSparkGaussian;
    if (!spark || spark.__platWrapped || typeof spark.loadFromBytes !== "function") return false;
    const orig = spark.loadFromBytes.bind(spark);
    spark.loadFromBytes = async function () {
      const mesh = await orig.apply(spark, arguments);
      if (root) {
        attachSplat();
        const h = platformMesh ? platformMesh.position.y * 2 : 0.08;
        seatOnPlatform();
        applyAngle();
      }
      return mesh;
    };
    spark.__platWrapped = true;
    return true;
  }

  function boot() {
    if (!ensureTab()) return setTimeout(boot, 200);
    ensureToolbarButton();
    wire();
    const tryWrap = () => { if (!wrapSpark()) setTimeout(tryWrap, 400); };
    tryWrap();
    console.log("[FUMOCA] Platform tab ready");
  }

  window.FumocaPresentation = {
    host() { return root; },
    apply() { rebuild({ seat: true }); },
    attachSplat,
    sitFlat() { return seatOnPlatform(); },
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
