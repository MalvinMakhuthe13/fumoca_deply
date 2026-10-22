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
  attribute vec3  aScaleXYZ;
  attribute vec4  aRotation;
  attribute vec3  aColor;
  attribute float aOpacity;
  attribute float aSelected;
  attribute float aSharpness;
  varying vec3  vColor;
  varying float vOpacity;
  varying float vSelected;
  varying float vDepth;
  varying float vSharpness;
  varying vec3  vCov2D;
  varying float vSpriteSize;
  uniform float uScale;
  uniform float uBrightness;
  uniform float uTransition;
  uniform float uTime;
  uniform float uContrast;
  uniform float uSaturation;
  uniform vec2  uViewport;
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
    float qw=aRotation.x, qx=aRotation.y, qy=aRotation.z, qz=aRotation.w;
    mat3 R = mat3(
      1.0-2.0*(qy*qy+qz*qz), 2.0*(qx*qy+qw*qz), 2.0*(qx*qz-qw*qy),
      2.0*(qx*qy-qw*qz), 1.0-2.0*(qx*qx+qz*qz), 2.0*(qy*qz+qw*qx),
      2.0*(qx*qz+qw*qy), 2.0*(qy*qz-qw*qx), 1.0-2.0*(qx*qx+qy*qy)
    );
    mat3 RV = mat3(viewMatrix * modelMatrix) * R;
    vec3 s = max(aScaleXYZ * uScale, vec3(0.0001));
    mat3 covariance = RV * mat3(s.x*s.x,0.0,0.0, 0.0,s.y*s.y,0.0, 0.0,0.0,s.z*s.z) * transpose(RV);
    float z = max(0.001, -mvPos.z);
    float fx = projectionMatrix[0][0] * uViewport.x * 0.5;
    float fy = projectionMatrix[1][1] * uViewport.y * 0.5;
    vec3 jx = vec3(fx/z, 0.0, fx*mvPos.x/(z*z));
    vec3 jy = vec3(0.0, -fy/z, -fy*mvPos.y/(z*z));
    float cxx = max(dot(jx, covariance * jx), 0.25);
    float cyy = max(dot(jy, covariance * jy), 0.25);
    float cxy = dot(jx, covariance * jy);
    float lambdaMax = 0.5*(cxx+cyy) + sqrt(max(0.0, 0.25*(cxx-cyy)*(cxx-cyy)+cxy*cxy));
    vCov2D = vec3(cxx, cxy, cyy);
    float baseSize = clamp(6.0 * sqrt(lambdaMax), 1.0, 256.0);
    vSpriteSize = baseSize;
    gl_PointSize = mix(2.0, baseSize, uTransition);
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
  varying vec3  vCov2D;
  varying float vSpriteSize;
  uniform float uTransition;
  uniform float uTime;
  uniform float uSharpness;

  void main() {
    vec2 pixelOffset = (gl_PointCoord - 0.5) * vSpriteSize;
    float cxx = vCov2D.x, cxy = vCov2D.y, cyy = vCov2D.z;
    float determinant = max(cxx*cyy-cxy*cxy, 1e-5);
    float mahalanobis = max(0.0, (cyy*pixelOffset.x*pixelOffset.x - 2.0*cxy*pixelOffset.x*pixelOffset.y + cxx*pixelOffset.y*pixelOffset.y) / determinant);
    float gaussFall = exp(-0.5 * mahalanobis);
    float r2 = dot(gl_PointCoord - 0.5, gl_PointCoord - 0.5);

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

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), alpha);
    #include <colorspace_fragment>
  }
`;

const FumocaGaussianRenderer = (() => {
  let _enabled    = false;
  let _transition = 1.0;
  let _animFrame  = null;
  let _startTime  = performance.now();
  let _material   = null;
  let _shNamesRef = null;
  let _shLayout = null;
  const _shBasis = new Float32Array(16);
  const _shOut = new Float32Array(3);

  function _getSHLayout(names) {
    if (_shNamesRef === names && _shLayout) return _shLayout;
    _shNamesRef = names;
    const perChannel = names.length / 3;
    if (!Number.isInteger(perChannel) || perChannel < 1) return null;
    const lookup = new Map(names.map((name, i) => [name, i]));
    const channels = [0,1,2].map(channel => Array.from({ length: perChannel }, (_, k) => {
      const name = k === 0 ? `f_dc_${channel}` : `f_rest_${channel * (perChannel - 1) + k - 1}`;
      return lookup.get(name) ?? -1;
    }));
    _shLayout = { perChannel, channels };
    return _shLayout;
  }

  function _shColor(S, pointIndex, cameraPosition) {
    const names = S.shAttributes;
    const values = S.shCoefficients;
    if (!names?.length || !values) return null;
    if (ArrayBuffer.isView(values) && (pointIndex + 1) * names.length > values.length) return null;
    const layout = _getSHLayout(names);
    if (!layout) return null;
    const x0 = S.positions[pointIndex * 3], y0 = S.positions[pointIndex * 3 + 1], z0 = S.positions[pointIndex * 3 + 2];
    // Graphdeco's SH convention evaluates the ray from camera to Gaussian
    // (position - camera). Reversing it flips odd SH bands and changes the
    // trained view-dependent colors, especially on degree 1 and 3 captures.
    let x = x0 - cameraPosition.x, y = y0 - cameraPosition.y, z = z0 - cameraPosition.z;
    const len = Math.hypot(x, y, z) || 1; x /= len; y /= len; z /= len;
    _shBasis[0]=0.28209479177387814;
    _shBasis[1]=-0.4886025119029199*y; _shBasis[2]=0.4886025119029199*z; _shBasis[3]=-0.4886025119029199*x;
    _shBasis[4]=1.0925484305920792*x*y; _shBasis[5]=-1.0925484305920792*y*z;
    _shBasis[6]=0.31539156525252005*(2*z*z-x*x-y*y); _shBasis[7]=-1.0925484305920792*x*z;
    _shBasis[8]=0.5462742152960396*(x*x-y*y);
    _shBasis[9]=-0.5900435899266435*y*(3*x*x-y*y); _shBasis[10]=2.890611442640554*x*y*z;
    _shBasis[11]=-0.4570457994644658*y*(4*z*z-x*x-y*y);
    _shBasis[12]=0.3731763325901154*z*(2*z*z-3*x*x-3*y*y);
    _shBasis[13]=-0.4570457994644658*x*(4*z*z-x*x-y*y);
    _shBasis[14]=1.445305721320277*z*(x*x-y*y);
    _shBasis[15]=-0.5900435899266435*x*(x*x-3*y*y);
    for (let channel = 0; channel < 3; channel++) {
      let sum = 0;
      const channelLayout = layout.channels[channel];
      for (let k = 0; k < layout.perChannel && k < _shBasis.length; k++) {
        const attr = channelLayout[k];
        if (attr >= 0) {
          const name = names[attr];
          sum += (ArrayBuffer.isView(values) ? values[pointIndex * names.length + attr] : values[name]?.[pointIndex] || 0) * _shBasis[k];
        }
      }
      _shOut[channel] = Math.max(0, Math.min(1, 0.5 + sum));
    }
    return _shOut;
  }

  function buildMaterial(ptScale = 1.0, brightness = 1.0) {
    const T = window.THREE;
    if (!T) { console.warn('[GaussianRenderer] THREE not available'); return null; }
    _material = new T.ShaderMaterial({
      uniforms: {
        uScale:      { value: ptScale },
        uBrightness: { value: brightness },
        uTransition: { value: _transition },
        uTime:       { value: 0 },
        uContrast:   { value: 1.0 },
        uSaturation: { value: 1.0 },
        uSharpness:  { value: 0.72 },   // tighter gaussian sigma
        uViewport:   { value: new T.Vector2(document.getElementById('viewport')?.clientWidth || window.innerWidth, document.getElementById('viewport')?.clientHeight || window.innerHeight) },
      },
      vertexShader:   VERT,
      fragmentShader: FRAG,
      transparent:    true,
      depthWrite:     false,
      depthTest:      true,
      blending:       T.NormalBlending,
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

  function buildGeometry(S, camera = null) {
    const T = window.THREE;
    if (!T || !S?.positions || !S.alive) return null;
    const count = S.alive.length;
    let alive = 0;
    for (let i = 0; i < count; i++) if (S.alive[i] && !S.layerHidden?.[i]) alive++;
    const pos      = new Float32Array(alive * 3);
    const col      = new Float32Array(alive * 3);
    const sourceIndex = new Uint32Array(alive);
    const scaleXYZ = new Float32Array(alive * 3);
    const rotation = new Float32Array(alive * 4);
    const sizes    = new Float32Array(alive);
    const opacities= new Float32Array(alive);
    const selected = new Float32Array(alive);
    let idx = 0;
    for (let i = 0; i < count; i++) {
      if (!S.alive[i] || S.layerHidden?.[i]) continue;
      pos[idx*3]   = S.positions[i*3];
      pos[idx*3+1] = S.positions[i*3+1];
      pos[idx*3+2] = S.positions[i*3+2];
      sourceIndex[idx] = i;
      const pc = S.paintColors;
      let r = pc && pc[i*3]   >= 0 ? pc[i*3]   : S.colors[i*3];
      let g = pc && pc[i*3+1] >= 0 ? pc[i*3+1] : S.colors[i*3+1];
      let b = pc && pc[i*3+2] >= 0 ? pc[i*3+2] : S.colors[i*3+2];
      // Start with the already parsed DC color so large captures render immediately.
      // View-dependent SH color is refined asynchronously after the first frame.
      // Exposure and saturation are now GPU uniforms (realtime, no rebuild needed)
      // CPU-side: apply only white balance and hue shift if present
      if (S.whiteBalance && S.whiteBalance !== 0) {
        const wb = S.whiteBalance / 100;
        r = Math.max(0, Math.min(1, r + wb * 0.06));
        b = Math.max(0, Math.min(1, b - wb * 0.06));
      }
      col[idx*3]   = r;  col[idx*3+1] = g;  col[idx*3+2] = b;
      sizes[idx]    = (S.scale?.[i] || 0.015) * (S.ptScale || 1.0);
      for (let c = 0; c < 3; c++) scaleXYZ[idx*3+c] = S.scaleXYZ?.[i*3+c] || S.scale?.[i] || 0.015;
      for (let c = 0; c < 4; c++) rotation[idx*4+c] = S.rotation?.[i*4+c] ?? (c === 0 ? 1 : 0);
      opacities[idx]= S.opacity?.[i] ?? 1.0;
      selected[idx] = S.selected?.[i] ? 1.0 : 0.0;
      idx++;
    }
    const geo = new T.BufferGeometry();
    // Sharpness: inverse of scale (small tight splats = sharp, big halos = soft)
    const sharpness = new Float32Array(alive);
    let idx2 = 0;
    for (let i = 0; i < count; i++) {
      if (!S.alive[i] || S.layerHidden?.[i]) continue;
      const sc = S.scale?.[i] || 0.015;
      sharpness[idx2] = Math.max(0, Math.min(1, 1.0 - Math.min(sc / 0.08, 1.0)));
      idx2++;
    }
    geo.setAttribute('position',   new T.BufferAttribute(pos,       3));
    geo.setAttribute('aColor',     new T.BufferAttribute(col,       3));
    geo.setAttribute('sourceIndex',new T.BufferAttribute(sourceIndex,1));
    geo.setAttribute('aSize',      new T.BufferAttribute(sizes,     1));
    geo.setAttribute('aScaleXYZ',  new T.BufferAttribute(scaleXYZ,  3));
    geo.setAttribute('aRotation',  new T.BufferAttribute(rotation,  4));
    geo.setAttribute('aOpacity',   new T.BufferAttribute(opacities, 1));
    geo.setAttribute('aSelected',  new T.BufferAttribute(selected,  1));
    geo.setAttribute('aSharpness', new T.BufferAttribute(sharpness, 1));
    return geo;
  }

  let _shUpdateToken = 0;
  function updateViewColors(S, camera) {
    const attr = S?.points?.geometry?.getAttribute('aColor');
    if (!attr || !S.shCoefficients || !camera) return;
    const active = [];
    const mask = new Uint8Array(S.alive.length);
    for (let i = 0; i < S.alive.length; i++) if (S.alive[i] && !S.layerHidden?.[i]) mask[i] = 1;
    if (_currentIndices) for (const i of _currentIndices) if (i < mask.length && mask[i]) active.push(i);
    if (active.length !== attr.count) {
      const seen = new Uint8Array(mask.length); for (const i of active) seen[i] = 1;
      for (let i = 0; i < mask.length; i++) if (mask[i] && !seen[i]) active.push(i);
    }
    const token = ++_shUpdateToken;
    const cameraPosition = camera.position.clone();
    let out = 0;
    const updateChunk = () => {
      if (token !== _shUpdateToken || S.points?.geometry?.getAttribute('aColor') !== attr) return;
      const end = Math.min(active.length, out + 5000);
      for (; out < end; out++) {
        const i = active[out], pc = S.paintColors;
        if (pc && pc[i*3] >= 0) continue;
        const color = _shColor(S, i, cameraPosition);
        if (color) attr.array.set(color, out * 3);
      }
      attr.needsUpdate = true;
      if (out < active.length) requestAnimationFrame(updateChunk);
    };
    requestAnimationFrame(updateChunk);
  }

  // ── Depth sort worker ────────────────────────────────────────────────────
  // Runs off main thread. Accepts positions + eye, returns back-to-front indices.
  const _SORT_SRC = `
    self.onmessage = function(e) {
      const { pos, eye, direction, N } = e.data;
      const ex=eye[0],ey=eye[1],ez=eye[2];
      const depths = new Float32Array(N);
      for(let i=0;i<N;i++){
        const b=i*3, dx=pos[b]-ex, dy=pos[b+1]-ey, dz=pos[b+2]-ez;
        depths[i]=dx*direction[0]+dy*direction[1]+dz*direction[2];
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
  let _lastSortDirection = [0,0,-1];
  let _currentIndices= null;
  const SORT_MOVE_THRESHOLD = 0.015;

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
  let _sortQueued = null; // {positions,N,eye,onSorted,sceneSize,direction} if moved while pending

  function requestDepthSort(positions, N, eye, onSorted, sceneSize=5, direction=[0,0,-1]) {
    if (!positions || N < 2) return;
    const dx=eye[0]-_lastSortEye[0], dy=eye[1]-_lastSortEye[1], dz=eye[2]-_lastSortEye[2];
    const moved = Math.sqrt(dx*dx+dy*dy+dz*dz);
    const facing = direction[0]*_lastSortDirection[0] + direction[1]*_lastSortDirection[1] + direction[2]*_lastSortDirection[2];
    // More sensitive: re-sort on smaller moves / turns so orbit stays solid
    if (moved < sceneSize * SORT_MOVE_THRESHOLD * 0.35 && facing > 0.995 && _currentIndices?.length === N) return;
    if (_sortPending) {
      // Queue latest camera — apply as soon as current sort finishes
      _sortQueued = { positions, N, eye: [...eye], onSorted, sceneSize, direction: [...direction] };
      return;
    }
    _sortPending   = true;
    _lastSortEye   = [...eye];
    _lastSortDirection = [...direction];
    let w;
    try { w = _getSortWorker(); }
    catch (error) { _sortPending = false; console.warn('[GaussianRenderer] Depth sorting unavailable:', error); return; }
    const posCopy = new Float32Array(positions);
    w.onmessage = (e) => {
      _sortPending    = false;
      _currentIndices = e.data.indices;
      try { onSorted(_currentIndices); } catch (err) { console.warn(err); }
      if (_sortQueued) {
        const q = _sortQueued;
        _sortQueued = null;
        requestDepthSort(q.positions, q.N, q.eye, q.onSorted, q.sceneSize, q.direction);
      }
    };
    w.postMessage({ pos: posCopy, eye, direction, N }, [posCopy.buffer]);
  }

  /**
   * buildSortedGeometry — like buildGeometry but uses a sort index for vertex order
   */
  function buildSortedGeometry(S, sortIndices, camera = null) {
    const T = window.THREE;
    if (!T || !S?.positions || !S.alive) return buildGeometry(S);
    const count = S.alive.length;
    const active = [];
    const activeMask = new Uint8Array(count);
    for (let i = 0; i < count; i++) if (S.alive[i] && !S.layerHidden?.[i]) { active.push(i); activeMask[i] = 1; }
    const ordered = [];
    if (sortIndices) for (const i of sortIndices) if (i < count && activeMask[i]) ordered.push(i);
    if (ordered.length !== active.length) {
      const used = new Uint8Array(count); for (const i of ordered) used[i] = 1;
      for (const i of active) if (!used[i]) ordered.push(i);
    }
    const alive = ordered.length;

    const pos=new Float32Array(alive*3), col=new Float32Array(alive*3), sourceIndex=new Uint32Array(alive);
    const scaleXYZ=new Float32Array(alive*3), rotation=new Float32Array(alive*4);
    const sizes=new Float32Array(alive), opacities=new Float32Array(alive);
    const selected=new Float32Array(alive), sharpness=new Float32Array(alive);

    // Apply sort order — sortIndices maps output slot → source Gaussian
    for(let out=0;out<alive;out++){
      const i = ordered[out];
      sourceIndex[out]=i;
      pos[out*3]=S.positions[i*3]; pos[out*3+1]=S.positions[i*3+1]; pos[out*3+2]=S.positions[i*3+2];
      const pc=S.paintColors;
      let r=pc&&pc[i*3]>=0?pc[i*3]:S.colors[i*3];
      let g=pc&&pc[i*3+1]>=0?pc[i*3+1]:S.colors[i*3+1];
      let b=pc&&pc[i*3+2]>=0?pc[i*3+2]:S.colors[i*3+2];
      if(S.whiteBalance){const wb=S.whiteBalance/100;r=Math.max(0,Math.min(1,r+wb*0.06));b=Math.max(0,Math.min(1,b-wb*0.06));}
      col[out*3]=r; col[out*3+1]=g; col[out*3+2]=b;
      sizes[out]=( S.scale?.[i]||0.015)*(S.ptScale||1.0);
      for (let c=0;c<3;c++) scaleXYZ[out*3+c]=S.scaleXYZ?.[i*3+c]||S.scale?.[i]||0.015;
      for (let c=0;c<4;c++) rotation[out*4+c]=S.rotation?.[i*4+c]??(c===0?1:0);
      opacities[out]=S.opacity?.[i]??1.0;
      selected[out]=S.selected?.[i]?1.0:0.0;
      const sc=S.scale?.[i]||0.015;
      sharpness[out]=Math.max(0,Math.min(1,1.0-Math.min(sc/0.08,1.0)));
    }
    const geo=new T.BufferGeometry();
    geo.setAttribute('position',   new T.BufferAttribute(pos,      3));
    geo.setAttribute('aColor',     new T.BufferAttribute(col,      3));
    geo.setAttribute('sourceIndex',new T.BufferAttribute(sourceIndex,1));
    geo.setAttribute('aSize',      new T.BufferAttribute(sizes,    1));
    geo.setAttribute('aScaleXYZ',  new T.BufferAttribute(scaleXYZ, 3));
    geo.setAttribute('aRotation',  new T.BufferAttribute(rotation, 4));
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

  function getSortIndices() { return _currentIndices; }
  function invalidateSort() { _lastSortEye = [Infinity, Infinity, Infinity]; }
  function setViewport(width, height) {
    if (_material?.uniforms?.uViewport) _material.uniforms.uViewport.value.set(Math.max(1, width), Math.max(1, height));
  }

  return { buildMaterial, buildGeometry, buildSortedGeometry, requestDepthSort, getSortIndices, invalidateSort, updateViewColors, setViewport, enable, disable, isEnabled, getTransition, playReveal, playDissolve, socialReveal, setQuality, getQuality };
})();

window.FumocaGaussianRenderer = FumocaGaussianRenderer;
export default FumocaGaussianRenderer;
