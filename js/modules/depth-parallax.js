/**
 * FUMOCA Photo → 3D poster: a photo that moves in depth.
 *
 * WebGL1 renderer that displaces the photo by its depth map (1 = near) with a
 * few fixed-point iterations so near objects slide over the background with
 * correct occlusion. Driven by pointer, phone tilt, or an automatic orbit,
 * and recordable to a WebM loop for sharing.
 */

const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() { v_uv = a_pos * 0.5 + 0.5; v_uv.y = 1.0 - v_uv.y; gl_Position = vec4(a_pos, 0.0, 1.0); }`;

const FRAG = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_image;
uniform sampler2D u_depth;
uniform vec2 u_offset;   // camera shift, in UV units at strength 1
uniform float u_focus;   // depth that stays still (0 far … 1 near)
uniform float u_zoom;    // >1 crops in slightly so edges never show
uniform vec2 u_cover;    // aspect-fit scale for the canvas
void main() {
  vec2 base = (v_uv - 0.5) * u_cover / u_zoom + 0.5;
  vec2 uv = base;
  for (int i = 0; i < 8; i++) {
    float d = texture2D(u_depth, uv).r;
    uv = base + u_offset * (d - u_focus);
  }
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) { gl_FragColor = vec4(0.04, 0.05, 0.07, 1.0); return; }
  gl_FragColor = texture2D(u_image, uv);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Shader: ' + gl.getShaderInfoLog(s));
  return s;
}

/** Light blur + dilation of near values so object edges don't tear. */
export function prepareDepthTexture(depth, w, h, radius = 2) {
  const out = new Uint8Array(w * h);
  const tmp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let m = 0;
    for (let dx = -radius; dx <= radius; dx++) {
      const xx = Math.min(w - 1, Math.max(0, x + dx));
      m = Math.max(m, depth[y * w + xx]);
    }
    tmp[y * w + x] = m;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let m = 0;
    for (let dy = -radius; dy <= radius; dy++) {
      const yy = Math.min(h - 1, Math.max(0, y + dy));
      m = Math.max(m, tmp[yy * w + x]);
    }
    out[y * w + x] = Math.round(Math.min(1, Math.max(0, m)) * 255);
  }
  return out;
}

/**
 * @param {HTMLCanvasElement} canvas  output canvas
 * @param {object} src  { image: HTMLCanvasElement|ImageBitmap, depth: Float32Array (1=near), depthWidth, depthHeight }
 */
export function createParallaxPoster(canvas, src, options = {}) {
  const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true, antialias: true });
  if (!gl) throw new Error('WebGL is not available on this device');
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('Shader link failed');
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'a_pos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const tex = (unit, setup) => {
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    setup();
    return t;
  };
  tex(0, () => gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src.image));
  const depthBytes = prepareDepthTexture(src.depth, src.depthWidth, src.depthHeight);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  tex(1, () => gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, src.depthWidth, src.depthHeight, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, depthBytes));
  gl.uniform1i(gl.getUniformLocation(prog, 'u_image'), 0);
  gl.uniform1i(gl.getUniformLocation(prog, 'u_depth'), 1);
  const uOffset = gl.getUniformLocation(prog, 'u_offset');
  const uFocus = gl.getUniformLocation(prog, 'u_focus');
  const uZoom = gl.getUniformLocation(prog, 'u_zoom');
  const uCover = gl.getUniformLocation(prog, 'u_cover');

  const state = {
    strength: options.strength ?? 0.035,
    focus: options.focus ?? 0.5,
    mode: options.mode || 'auto', // 'auto' | 'pointer' | 'tilt'
    target: { x: 0, y: 0 }, current: { x: 0, y: 0 },
    t0: performance.now(), raf: 0, destroyed: false,
  };
  const imgAspect = (src.image.width || src.depthWidth) / (src.image.height || src.depthHeight);

  function draw(now = performance.now()) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = Math.max(2, Math.round(canvas.clientWidth * dpr)), ch = Math.max(2, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    gl.viewport(0, 0, canvas.width, canvas.height);
    if (state.mode === 'auto') {
      const t = (now - state.t0) / 1000;
      state.target.x = Math.cos(t * 1.1) * 0.8;
      state.target.y = Math.sin(t * 1.1) * 0.45;
    }
    state.current.x += (state.target.x - state.current.x) * 0.12;
    state.current.y += (state.target.y - state.current.y) * 0.12;
    const canvasAspect = canvas.width / canvas.height;
    // "contain" fit: the whole photo is visible.
    const cover = canvasAspect > imgAspect ? [canvasAspect / imgAspect, 1] : [1, imgAspect / canvasAspect];
    gl.uniform2f(uCover, cover[0], cover[1]);
    gl.uniform2f(uOffset, state.current.x * state.strength, state.current.y * state.strength);
    gl.uniform1f(uFocus, state.focus);
    gl.uniform1f(uZoom, 1 + state.strength * 1.4);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  function loop(now) { if (state.destroyed) return; draw(now); state.raf = requestAnimationFrame(loop); }
  state.raf = requestAnimationFrame(loop);

  const onPointer = (e) => {
    if (state.mode === 'tilt') return;
    const r = canvas.getBoundingClientRect();
    state.mode = 'pointer';
    state.target.x = ((e.clientX - r.left) / r.width - 0.5) * 2;
    state.target.y = ((e.clientY - r.top) / r.height - 0.5) * 2;
  };
  const onLeave = () => { if (state.mode === 'pointer') { state.mode = 'auto'; state.t0 = performance.now(); } };
  const onTilt = (e) => {
    if (state.mode !== 'tilt' || e.gamma == null) return;
    state.target.x = Math.max(-1, Math.min(1, e.gamma / 25));
    state.target.y = Math.max(-1, Math.min(1, (e.beta - 45) / 25));
  };
  canvas.addEventListener('pointermove', onPointer);
  canvas.addEventListener('pointerleave', onLeave);
  window.addEventListener('deviceorientation', onTilt);

  return {
    set(opts) { Object.assign(state, opts); if (opts.mode === 'auto') state.t0 = performance.now(); },
    get state() { return { strength: state.strength, focus: state.focus, mode: state.mode }; },
    /** Ask for phone tilt (iOS needs a user gesture). */
    async enableTilt() {
      const D = window.DeviceOrientationEvent;
      if (D?.requestPermission) { const r = await D.requestPermission(); if (r !== 'granted') throw new Error('Motion access was not allowed'); }
      state.mode = 'tilt';
    },
    /** Record one full automatic orbit as a WebM loop. */
    async recordLoop(seconds = 5.7) {
      if (!canvas.captureStream || typeof MediaRecorder === 'undefined') throw new Error('Video recording is not supported in this browser');
      const prev = state.mode; state.mode = 'auto'; state.t0 = performance.now();
      const stream = canvas.captureStream(30);
      const type = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find(t => MediaRecorder.isTypeSupported(t)) || '';
      const rec = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 6_000_000 } : undefined);
      const chunks = [];
      rec.ondataavailable = e => e.data.size && chunks.push(e.data);
      const done = new Promise(r => { rec.onstop = r; });
      rec.start();
      await new Promise(r => setTimeout(r, seconds * 1000));
      rec.stop(); await done;
      stream.getTracks().forEach(t => t.stop());
      state.mode = prev;
      return new Blob(chunks, { type: type.split(';')[0] || 'video/webm' });
    },
    snapshot() { draw(); return canvas.toDataURL('image/png'); },
    destroy() {
      state.destroyed = true; cancelAnimationFrame(state.raf);
      canvas.removeEventListener('pointermove', onPointer);
      canvas.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('deviceorientation', onTilt);
    },
  };
}

export default { createParallaxPoster, prepareDepthTexture };
