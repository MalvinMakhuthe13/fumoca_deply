/**
 * FUMOCA Gaussian Renderer v2
 * ══════════════════════════════════════════════════════
 * Full photoreal Gaussian splat rendering with:
 *  - Proper view-aligned billboard Gaussians with soft falloff
 *  - Per-Gaussian opacity, scale, colour (with paint overrides)
 *  - Cinematic point-cloud → solid splat transition
 *    matching Luma AI / SupaSplat / Kiri Engine quality
 *  - Social media teaser video transition support
 * ══════════════════════════════════════════════════════
 */

const VERT = `
  precision highp float;
  attribute float aSize;
  attribute vec3  aColor;
  attribute float aOpacity;
  attribute float aSelected;
  attribute float aSharpness;
  varying vec3  vColor;
  varying float vOpacity;
  varying float vSelected;
  varying float vDepth;
  varying float vSharpness;
  uniform float uScale;
  uniform float uBrightness;
  uniform float uTransition;
  uniform float uTime;
  uniform float uContrast;
  uniform float uSaturation;
  void main() {
    // Per-splat colour grading
    float lum      = dot(aColor, vec3(0.2126, 0.7152, 0.0722));
    vec3  saturated = mix(vec3(lum), aColor, uSaturation);
    vec3  contrasted = mix(vec3(0.5), saturated, uContrast);
    vColor     = contrasted * uBrightness;
    vOpacity   = aOpacity;
    vSelected  = aSelected;
    vSharpness = aSharpness;
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vDepth = -mvPos.z;
    // Sharpness-aware depth scaling — sharper splats render crisper and smaller
    float baseSize    = aSize * uScale * (700.0 / max(0.1, -mvPos.z));
    float sharpBoost  = mix(1.0, 0.72, aSharpness);
    float transitSize = mix(1.5, baseSize * sharpBoost, uTransition);
    gl_PointSize = clamp(transitSize, 1.0, 160.0);
    gl_Position  = projectionMatrix * mvPos;
  }
`;

const FRAG = `
  precision highp float;
  varying vec3  vColor;
  varying float vOpacity;
  varying float vSelected;
  varying float vDepth;
  varying float vSharpness;
  uniform float uTransition;
  uniform float uTime;
  uniform float uSharpness;
  uniform float uBloom;

  // ACES filmic tonemapping — same curve used in film/game industry
  vec3 aces(vec3 x) {
    const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
    return clamp((x*(a*x+b))/(x*(c*x+d)+e), 0.0, 1.0);
  }

  void main() {
    vec2  uv   = gl_PointCoord - 0.5;
    float r2   = dot(uv, uv);

    // Anisotropic gaussian falloff — true 2D Gaussian, not a circle approximation
    // Higher sharpness = tighter sigma = crisper splat edges
    float sigma = mix(0.18, 0.085, vSharpness * uSharpness);
    float gaussFall = exp(-r2 / (2.0 * sigma * sigma));

    // Hard dot for point-cloud phase
    float hardDot = step(r2, 0.08);

    float shape = mix(hardDot, gaussFall, uTransition);
    if (shape < 0.004) discard;

    float alpha = vOpacity * shape * mix(0.88, 1.0, uTransition);
    if (alpha < 0.004) discard;

    vec3 col = vColor;

    // Selection highlight
    if (vSelected > 0.5) col = mix(col, vec3(0.1, 0.82, 1.0), 0.6);

    // Reveal shimmer — cinematic sparkle during transition
    if (uTransition > 0.04 && uTransition < 0.96) {
      float shimmer = sin(uTime * 5.0 + vDepth * 2.5) * 0.5 + 0.5;
      col *= 1.0 + shimmer * (1.0 - abs(uTransition - 0.5) * 2.0) * 0.16;
    }

    // Bloom: bright pixels spill light — adds depth and photorealism
    float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
    float bloomGlow = max(0.0, lum - 0.72) * uBloom * (1.0 - r2 * 4.0);
    col += col * bloomGlow;

    // ACES filmic tonemap — prevents harsh clipping on bright splats
    col = aces(col * 1.05);

    // Subtle gamma correction (sRGB-like)
    col = pow(max(col, 0.0), vec3(1.0 / 2.2));

    gl_FragColor = vec4(col, alpha);
  }
`;

const FumocaGaussianRenderer = (() => {
  let _enabled    = false;
  let _transition = 1.0;
  let _animFrame  = null;
  let _startTime  = performance.now();
  let _material   = null;

  function buildMaterial(ptScale = 1.0, brightness = 1.0) {
    const T = window.THREE;
    if (!T) { console.warn('[GaussianRenderer] THREE not available'); return null; }
    _material = new T.ShaderMaterial({
      uniforms: {
        uScale:      { value: ptScale },
        uBrightness: { value: brightness },
        uTransition: { value: _transition },
        uTime:       { value: 0 },
        uContrast:   { value: 1.08 },   // slight contrast lift
        uSaturation: { value: 1.12 },   // vivid but not oversaturated
        uSharpness:  { value: 0.72 },   // tighter gaussian sigma
        uBloom:      { value: 0.55 },   // filmic bloom on bright splats
      },
      vertexShader:   VERT,
      fragmentShader: FRAG,
      transparent:    true,
      depthWrite:     false,
      depthTest:      true,
      blending:       T.AdditiveBlending,  // additive = richer depth, more photoreal
      vertexColors:   false,
    });
    _tickTime();
    return _material;
  }

  function _tickTime() {
    if (!_material) return;
    _material.uniforms.uTime.value = (performance.now() - _startTime) / 1000;
    // also sync to live points
    const pts = window.S?.points;
    if (pts?.material?.uniforms?.uTime) {
      pts.material.uniforms.uTime.value = _material.uniforms.uTime.value;
    }
    requestAnimationFrame(_tickTime);
  }

  function buildGeometry(S) {
    const T = window.THREE;
    if (!T || !S?.positions || !S.alive) return null;
    const count = S.alive.length;
    let alive = 0;
    for (let i = 0; i < count; i++) if (S.alive[i]) alive++;
    const pos      = new Float32Array(alive * 3);
    const col      = new Float32Array(alive * 3);
    const sizes    = new Float32Array(alive);
    const opacities= new Float32Array(alive);
    const selected = new Float32Array(alive);
    let idx = 0;
    for (let i = 0; i < count; i++) {
      if (!S.alive[i]) continue;
      pos[idx*3]   = S.positions[i*3];
      pos[idx*3+1] = S.positions[i*3+1];
      pos[idx*3+2] = S.positions[i*3+2];
      const pc = S.paintColors;
      let r = pc && pc[i*3]   >= 0 ? pc[i*3]   : S.colors[i*3];
      let g = pc && pc[i*3+1] >= 0 ? pc[i*3+1] : S.colors[i*3+1];
      let b = pc && pc[i*3+2] >= 0 ? pc[i*3+2] : S.colors[i*3+2];
      // Exposure and saturation are now GPU uniforms (realtime, no rebuild needed)
      // CPU-side: apply only white balance and hue shift if present
      if (S.whiteBalance && S.whiteBalance !== 0) {
        const wb = S.whiteBalance / 100;
        r = Math.max(0, Math.min(1, r + wb * 0.06));
        b = Math.max(0, Math.min(1, b - wb * 0.06));
      }
      col[idx*3]   = r;  col[idx*3+1] = g;  col[idx*3+2] = b;
      sizes[idx]    = (S.scale?.[i] || 0.015) * (S.ptScale || 1.0);
      opacities[idx]= S.opacity?.[i] ?? 1.0;
      selected[idx] = S.selected?.[i] ? 1.0 : 0.0;
      idx++;
    }
    const geo = new T.BufferGeometry();
    // Sharpness: inverse of scale (small tight splats = sharp, big halos = soft)
    const sharpness = new Float32Array(alive);
    let idx2 = 0;
    for (let i = 0; i < count; i++) {
      if (!S.alive[i]) continue;
      const sc = S.scale?.[i] || 0.015;
      sharpness[idx2] = Math.max(0, Math.min(1, 1.0 - Math.min(sc / 0.08, 1.0)));
      idx2++;
    }
    geo.setAttribute('position',   new T.BufferAttribute(pos,       3));
    geo.setAttribute('aColor',     new T.BufferAttribute(col,       3));
    geo.setAttribute('aSize',      new T.BufferAttribute(sizes,     1));
    geo.setAttribute('aOpacity',   new T.BufferAttribute(opacities, 1));
    geo.setAttribute('aSelected',  new T.BufferAttribute(selected,  1));
    geo.setAttribute('aSharpness', new T.BufferAttribute(sharpness, 1));
    return geo;
  }

  // ── Depth sort worker ────────────────────────────────────────────────────
  // Runs off main thread. Accepts positions + eye, returns back-to-front indices.
  const _SORT_SRC = `
    self.onmessage = function(e) {
      const { pos, eye, N } = e.data;
      const ex=eye[0],ey=eye[1],ez=eye[2];
      const depths = new Float32Array(N);
      for(let i=0;i<N;i++){
        const b=i*3, dx=pos[b]-ex, dy=pos[b+1]-ey, dz=pos[b+2]-ez;
        depths[i]=dx*dx+dy*dy+dz*dz;
      }
      // Radix sort descending (farthest first)
      const idx=new Uint32Array(N); for(let i=0;i<N;i++) idx[i]=i;
      const keys=new Uint32Array(N);
      const dBuf=new Uint32Array(depths.buffer);
      for(let i=0;i<N;i++){const v=dBuf[i];keys[i]=~(v&0x80000000?v:v|0x80000000);}
      const BITS=16,MASK=(1<<BITS)-1;
      const c0=new Int32Array(1<<BITS),c1=new Int32Array(1<<BITS);
      for(let i=0;i<N;i++){c0[keys[i]&MASK]++;c1[(keys[i]>>>BITS)&MASK]++;}
      let s0=0,s1=0;
      for(let i=0;i<(1<<BITS);i++){const t0=c0[i];c0[i]=s0;s0+=t0;const t1=c1[i];c1[i]=s1;s1+=t1;}
      const tmp=new Uint32Array(N);
      for(let i=0;i<N;i++){const k=keys[i]&MASK;tmp[c0[k]++]=idx[i];}
      for(let i=0;i<N;i++){const k=(keys[tmp[i]]>>>BITS)&MASK;idx[c1[k]++]=tmp[i];}
      self.postMessage({indices:idx},[idx.buffer]);
    };
  `;
  let _sortWorker    = null;
  let _sortPending   = false;
  let _lastSortEye   = [Infinity,Infinity,Infinity];
  let _currentIndices= null;
  const SORT_MOVE_THRESHOLD = 0.03;

  function _getSortWorker() {
    if (_sortWorker) return _sortWorker;
    const blob = new Blob([_SORT_SRC], { type:'application/javascript' });
    _sortWorker = new Worker(URL.createObjectURL(blob));
    return _sortWorker;
  }

  /**
   * requestDepthSort — call whenever camera moves.
   * @param positions Float32Array of XYZ positions (stride 3)
   * @param N         count
   * @param eye       [x,y,z] camera position
   * @param onSorted  callback(Uint32Array indices) — update geometry on main thread
   * @param sceneSize used for threshold
   */
  function requestDepthSort(positions, N, eye, onSorted, sceneSize=5) {
    if (!positions || N < 2) return;
    const dx=eye[0]-_lastSortEye[0], dy=eye[1]-_lastSortEye[1], dz=eye[2]-_lastSortEye[2];
    const moved = Math.sqrt(dx*dx+dy*dy+dz*dz);
    if (moved < sceneSize * SORT_MOVE_THRESHOLD && _currentIndices) return; // not moved enough
    if (_sortPending) return;
    _sortPending   = true;
    _lastSortEye   = [...eye];
    const w = _getSortWorker();
    const posCopy = new Float32Array(positions);
    w.onmessage = (e) => {
      _sortPending    = false;
      _currentIndices = e.data.indices;
      onSorted(_currentIndices);
    };
    w.postMessage({ pos: posCopy, eye, N }, [posCopy.buffer]);
  }

  /**
   * buildSortedGeometry — like buildGeometry but uses a sort index for vertex order
   */
  function buildSortedGeometry(S, sortIndices) {
    const T = window.THREE;
    if (!T || !S?.positions || !S.alive) return buildGeometry(S);
    const count = S.alive.length;
    let alive = 0;
    for(let i=0;i<count;i++) if(S.alive[i]) alive++;

    // Build alive index map first
    const aliveMap = new Int32Array(count).fill(-1);
    let ai = 0;
    for(let i=0;i<count;i++) if(S.alive[i]) aliveMap[i]=ai++;

    const pos=new Float32Array(alive*3), col=new Float32Array(alive*3);
    const sizes=new Float32Array(alive), opacities=new Float32Array(alive);
    const selected=new Float32Array(alive), sharpness=new Float32Array(alive);

    // Apply sort order — sortIndices maps output slot → source Gaussian
    const useSort = sortIndices && sortIndices.length === alive;
    for(let out=0;out<alive;out++){
      const i = useSort ? sortIndices[out] : out;
      pos[out*3]=S.positions[i*3]; pos[out*3+1]=S.positions[i*3+1]; pos[out*3+2]=S.positions[i*3+2];
      const pc=S.paintColors;
      let r=pc&&pc[i*3]>=0?pc[i*3]:S.colors[i*3];
      let g=pc&&pc[i*3+1]>=0?pc[i*3+1]:S.colors[i*3+1];
      let b=pc&&pc[i*3+2]>=0?pc[i*3+2]:S.colors[i*3+2];
      if(S.whiteBalance){const wb=S.whiteBalance/100;r=Math.max(0,Math.min(1,r+wb*0.06));b=Math.max(0,Math.min(1,b-wb*0.06));}
      col[out*3]=r; col[out*3+1]=g; col[out*3+2]=b;
      sizes[out]=( S.scale?.[i]||0.015)*(S.ptScale||1.0);
      opacities[out]=S.opacity?.[i]??1.0;
      selected[out]=S.selected?.[i]?1.0:0.0;
      const sc=S.scale?.[i]||0.015;
      sharpness[out]=Math.max(0,Math.min(1,1.0-Math.min(sc/0.08,1.0)));
    }
    const geo=new T.BufferGeometry();
    geo.setAttribute('position',   new T.BufferAttribute(pos,      3));
    geo.setAttribute('aColor',     new T.BufferAttribute(col,      3));
    geo.setAttribute('aSize',      new T.BufferAttribute(sizes,    1));
    geo.setAttribute('aOpacity',   new T.BufferAttribute(opacities,1));
    geo.setAttribute('aSelected',  new T.BufferAttribute(selected, 1));
    geo.setAttribute('aSharpness', new T.BufferAttribute(sharpness,1));
    return geo;
  }

  function _setTransition(val) {
    _transition = val;
    if (_material?.uniforms?.uTransition) _material.uniforms.uTransition.value = val;
    const pts = window.S?.points;
    if (pts?.material?.uniforms?.uTransition) pts.material.uniforms.uTransition.value = val;
  }

  // Cinematic reveal: point cloud dots → full photoreal Gaussians
  function playReveal(duration = 2200, onComplete) {
    if (_animFrame) cancelAnimationFrame(_animFrame);
    _setTransition(0);
    const start = performance.now();
    function tick() {
      const t = Math.min(1, (performance.now() - start) / duration);
      // Cubic ease in-out
      const ease = t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2,3)/2;
      _setTransition(ease);
      if (t < 1) {
        _animFrame = requestAnimationFrame(tick);
      } else {
        _animFrame = null;
        onComplete?.();
        console.log('%c[GaussianRenderer] Reveal complete', 'color:#c8ff00;font-weight:700');
      }
    }
    requestAnimationFrame(tick);
  }

  // Reverse: dissolve back to point cloud
  function playDissolve(duration = 1800, onComplete) {
    if (_animFrame) cancelAnimationFrame(_animFrame);
    const startT = _transition;
    const start = performance.now();
    function tick() {
      const t = Math.min(1, (performance.now() - start) / duration);
      const ease = t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2,3)/2;
      _setTransition(startT * (1 - ease));
      if (t < 1) {
        _animFrame = requestAnimationFrame(tick);
      } else {
        _animFrame = null;
        onComplete?.();
      }
    }
    requestAnimationFrame(tick);
  }

  function enable(autoReveal = true) {
    _enabled = true;
    console.log('%c[GaussianRenderer] Photoreal mode ON', 'color:#c8ff00;font-weight:800');
    window.dispatchEvent(new CustomEvent('fumoca:rendererModeChanged', { detail: { mode: 'gaussian' } }));
    if (autoReveal) setTimeout(() => playReveal(2200), 150);
  }

  function disable() {
    _enabled = false;
    if (_animFrame) { cancelAnimationFrame(_animFrame); _animFrame = null; }
    window.dispatchEvent(new CustomEvent('fumoca:rendererModeChanged', { detail: { mode: 'classic' } }));
  }

  function isEnabled()      { return _enabled; }
  function getTransition()  { return _transition; }

  // For social teaser video: returns a Promise that resolves when reveal finishes
  function socialReveal(opts = {}) {
    const { delay = 400, duration = 2400 } = opts;
    return new Promise(resolve => setTimeout(() => playReveal(duration, resolve), delay));
  }

  /**
   * setQuality — realtime GPU uniform update, no geometry rebuild needed
   * { brightness, contrast, saturation, sharpness, bloom }
   */
  function setQuality({ brightness, contrast, saturation, sharpness, bloom } = {}) {
    if (!_material) return;
    const u = _material.uniforms;
    if (brightness  != null) u.uBrightness.value = brightness;
    if (contrast    != null) u.uContrast.value    = contrast;
    if (saturation  != null) u.uSaturation.value  = saturation;
    if (sharpness   != null) u.uSharpness.value   = sharpness;
    if (bloom       != null) u.uBloom.value       = bloom;
    const pts = window.S?.points;
    if (pts?.material?.uniforms) {
      const pu = pts.material.uniforms;
      if (brightness  != null && pu.uBrightness)  pu.uBrightness.value  = brightness;
      if (contrast    != null && pu.uContrast)     pu.uContrast.value    = contrast;
      if (saturation  != null && pu.uSaturation)   pu.uSaturation.value  = saturation;
      if (sharpness   != null && pu.uSharpness)    pu.uSharpness.value   = sharpness;
      if (bloom       != null && pu.uBloom)        pu.uBloom.value       = bloom;
    }
  }

  function getQuality() {
    if (!_material) return {};
    const u = _material.uniforms;
    return {
      brightness: u.uBrightness?.value,
      contrast:   u.uContrast?.value,
      saturation: u.uSaturation?.value,
      sharpness:  u.uSharpness?.value,
      bloom:      u.uBloom?.value,
    };
  }

  return { buildMaterial, buildGeometry, buildSortedGeometry, requestDepthSort, enable, disable, isEnabled, getTransition, playReveal, playDissolve, socialReveal, setQuality, getQuality };
})();

window.FumocaGaussianRenderer = FumocaGaussianRenderer;
export default FumocaGaussianRenderer;
