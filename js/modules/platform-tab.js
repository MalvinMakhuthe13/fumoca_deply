/**
 * FUMOCA Platform Tab — injected into Studio editor
 * Shares the existing Three.js scene. Platform + splat move together.
 */
(function () {
  if (window.__fumocaPlatformInjected) return;
  window.__fumocaPlatformInjected = true;

  function inject() {
    const tabs = document.getElementById("leftTabs");
    const panel = document.getElementById("panelLeft");
    if (!tabs || !panel) return setTimeout(inject, 200);

    if (!document.querySelector("[data-tab=\"platform\"]")) {
      const tab = document.createElement("div");
      tab.className = "ptab";
      tab.dataset.tab = "platform";
      tab.textContent = "Platform";
      tabs.appendChild(tab);
    }

    if (!document.getElementById("tab-platform")) {
      const body = document.createElement("div");
      body.className = "panel-body";
      body.id = "tab-platform";
      body.style.display = "none";
      body.innerHTML = `
        <div class="section">
          <div class="sec-head"><span class="sec-label">Presentation Base</span></div>
          <div style="display:flex;gap:6px;margin:8px 0">
            <button class="chip" data-shape="circle" style="flex:1;padding:6px;border-radius:8px;background:rgba(212,255,0,.12);border:1px solid rgba(212,255,0,.4)">Circle</button>
            <button class="chip" data-shape="square" style="flex:1;padding:6px;border-radius:8px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12)">Square</button>
            <button class="chip" data-shape="rect" style="flex:1;padding:6px;border-radius:8px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12)">Rect</button>
          </div>
          <label style="font-size:11px;color:rgba(255,255,255,.5)">Width <span id="platWidthVal">600</span> mm</label>
          <input type="range" id="platWidth" min="200" max="1200" value="600" style="width:100%">
          <label style="font-size:11px;color:rgba(255,255,255,.5)">Height <span id="platHeightVal">80</span> mm</label>
          <input type="range" id="platHeight" min="20" max="200" value="80" style="width:100%">
          <div style="margin-top:10px;font-size:11px;color:rgba(255,255,255,.5)">Material</div>
          <div style="display:flex;gap:8px;margin:6px 0">
            <div class="mat-swatch" data-mat="wood" style="width:28px;height:28px;border-radius:50%;background:#8B4513;cursor:pointer;border:2px solid #d4ff00"></div>
            <div class="mat-swatch" data-mat="black" style="width:28px;height:28px;border-radius:50%;background:#111;cursor:pointer"></div>
            <div class="mat-swatch" data-mat="white" style="width:28px;height:28px;border-radius:50%;background:#eee;cursor:pointer"></div>
            <div class="mat-swatch" data-mat="metal" style="width:28px;height:28px;border-radius:50%;background:#aaa;cursor:pointer"></div>
          </div>
          <button id="platApplyBtn" class="tb-btn lime" style="width:100%;margin-top:8px;height:36px">Apply Platform</button>
          <button id="platFlipBtn" class="tb-btn" style="width:100%;margin-top:6px;height:36px">Flip to Underside</button>
          <div style="margin-top:12px;font-size:11px;color:rgba(255,255,255,.45)">Logo on underside</div>
          <input type="file" id="platLogoInput" accept="image/*" style="width:100%;margin-top:4px;color:#fff;font-size:12px">
          <button id="platClearLogo" class="tb-btn" style="width:100%;margin-top:6px;height:32px">Clear Logo</button>
        </div>
      `;
      panel.appendChild(body);
    }

    document.querySelectorAll("#leftTabs .ptab").forEach((tab) => {
      tab.addEventListener("click", () => {
        const id = tab.dataset.tab;
        document.querySelectorAll("#leftTabs .ptab").forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        document.querySelectorAll("#panelLeft .panel-body").forEach((b) => {
          b.style.display = b.id === "tab-" + id ? "block" : "none";
        });
      });
    });

    let platformMesh = null;
    let logoTexture = null;
    const state = { shape: "circle", width: 0.6, height: 0.08, material: "wood" };

    function getScene() {
      return window.scene || (typeof scene !== "undefined" ? scene : null);
    }

    function makeMat(type) {
      const T = window.THREE || (typeof THREE !== "undefined" ? THREE : null);
      if (!T) return null;
      if (type === "wood") return new T.MeshStandardMaterial({ color: 0x8B4513, roughness: 0.7 });
      if (type === "black") return new T.MeshStandardMaterial({ color: 0x111111, roughness: 0.4 });
      if (type === "white") return new T.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.5 });
      if (type === "metal") return new T.MeshStandardMaterial({ color: 0xaaaaaa, roughness: 0.2, metalness: 0.8 });
      return new T.MeshStandardMaterial({ color: 0x888888 });
    }

    function rebuild() {
      const T = window.THREE || (typeof THREE !== "undefined" ? THREE : null);
      const sc = getScene();
      if (!T || !sc) {
        console.warn("Platform: scene or THREE not ready");
        return;
      }
      if (platformMesh) {
        sc.remove(platformMesh);
        platformMesh.geometry.dispose();
        if (Array.isArray(platformMesh.material)) platformMesh.material.forEach(m => m.dispose());
        else platformMesh.material.dispose();
      }
      const w = state.width, h = state.height;
      let geo;
      if (state.shape === "circle") geo = new T.CylinderGeometry(w / 2, w / 2, h, 48);
      else if (state.shape === "square") geo = new T.BoxGeometry(w, h, w);
      else geo = new T.BoxGeometry(w, h, w * 0.65);

      const mat = makeMat(state.material);
      const under = new T.MeshStandardMaterial({
        color: 0x111111,
        map: logoTexture || null,
        emissive: logoTexture ? 0x222222 : 0,
        emissiveMap: logoTexture || null,
        emissiveIntensity: logoTexture ? 0.5 : 0,
      });
      platformMesh = new T.Mesh(geo, state.shape === "circle" ? [mat, mat, under] : [mat, mat, mat, mat, mat, under]);
      platformMesh.position.y = h / 2;
      platformMesh.name = "fumoca-platform";
      sc.add(platformMesh);
    }

    document.querySelectorAll("#tab-platform .chip").forEach((btn) => {
      btn.onclick = () => {
        document.querySelectorAll("#tab-platform .chip").forEach((b) => {
          b.style.background = "rgba(255,255,255,.06)";
          b.style.borderColor = "rgba(255,255,255,.12)";
        });
        btn.style.background = "rgba(212,255,0,.12)";
        btn.style.borderColor = "rgba(212,255,0,.4)";
        state.shape = btn.dataset.shape;
        rebuild();
      };
    });
    document.querySelectorAll("#tab-platform .mat-swatch").forEach((sw) => {
      sw.onclick = () => {
        document.querySelectorAll("#tab-platform .mat-swatch").forEach((s) => (s.style.border = "none"));
        sw.style.border = "2px solid #d4ff00";
        state.material = sw.dataset.mat;
        rebuild();
      };
    });
    const wEl = document.getElementById("platWidth");
    const hEl = document.getElementById("platHeight");
    if (wEl) wEl.oninput = (e) => { state.width = e.target.value / 1000; document.getElementById("platWidthVal").textContent = e.target.value; rebuild(); };
    if (hEl) hEl.oninput = (e) => { state.height = e.target.value / 1000; document.getElementById("platHeightVal").textContent = e.target.value; rebuild(); };
    const apply = document.getElementById("platApplyBtn");
    if (apply) apply.onclick = rebuild;
    const flip = document.getElementById("platFlipBtn");
    if (flip) flip.onclick = () => {
      if (!platformMesh) return;
      platformMesh.rotation.x = platformMesh.rotation.x === 0 ? Math.PI : 0;
    };
    const logoIn = document.getElementById("platLogoInput");
    if (logoIn) logoIn.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
          const T = window.THREE || (typeof THREE !== "undefined" ? THREE : null);
          if (!T) return;
          logoTexture = new T.Texture(img);
          logoTexture.needsUpdate = true;
          rebuild();
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    };
    const clear = document.getElementById("platClearLogo");
    if (clear) clear.onclick = () => { logoTexture = null; rebuild(); };

    console.log("[FUMOCA] Platform tab injected into Studio");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", inject);
  else inject();
})();
