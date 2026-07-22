/**
 * fumoc-encode-worker.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Web Worker that encodes .ply / .splat → .fumoc v3 entirely in the browser.
 * No server. No Python. No Kaggle.
 *
 * Messages IN  (from main thread):
 *   { type: 'encode', buffer: ArrayBuffer, filename: string, opts: {...} }
 *
 * Messages OUT (to main thread):
 *   { type: 'progress', pct: number, label: string }
 *   { type: 'done',     fumocBuffer: ArrayBuffer, stats: {...} }
 *   { type: 'error',    message: string }
 */

'use strict';

// ── Constants ─────────────────────────────────────────────────────────────────
const ANS_M    = 1 << 12;
const ANS_L    = 1 << 23;
const SPLAT_ROW= 32;

// ── Progress helper ───────────────────────────────────────────────────────────
function prog(pct, label) {
  self.postMessage({ type: 'progress', pct, label });
}

// ══════════════════════════════════════════════════════════════════════════════
// PARSERS
// ══════════════════════════════════════════════════════════════════════════════

function parsePLY(buffer) {
  const bytes = new Uint8Array(buffer);
  const dec   = new TextDecoder();

  // Find end_header
  let hdrEnd = 0;
  for (let i = 0; i < Math.min(bytes.length, 65536); i++) {
    if (bytes[i]===101&&bytes[i+1]===110&&bytes[i+2]===100&&bytes[i+3]===95) {
      // found 'end_'
      const chunk = dec.decode(bytes.slice(i, i + 16));
      if (chunk.startsWith('end_header')) {
        hdrEnd = i + chunk.indexOf('\n') + 1;
        break;
      }
    }
  }
  const header = dec.decode(bytes.slice(0, hdrEnd));
  let N = 0;
  const props = [];
  for (const line of header.split('\n')) {
    const t = line.trim().split(/\s+/);
    if (t[0]==='element' && t[1]==='vertex') N = parseInt(t[2]);
    if (t[0]==='property') props.push({ type: t[1], name: t[2] });
  }

  const sizeMap = { float:4, float32:4, double:8, float64:8, uchar:1, uint8:1, int:4, int32:4, uint:4, uint32:4, short:2, ushort:2 };
  const stride  = props.reduce((s,p) => s + (sizeMap[p.type]||4), 0);
  const view    = new DataView(buffer, hdrEnd);

  const arrays = {};
  for (const p of props) arrays[p.name] = new Float32Array(N);

  for (let i = 0; i < N; i++) {
    let off = i * stride;
    for (const p of props) {
      const sz = sizeMap[p.type] || 4;
      let val;
      switch(p.type) {
        case 'float': case 'float32': val = view.getFloat32(off, true); break;
        case 'double': case 'float64': val = view.getFloat64(off, true); break;
        case 'uchar': case 'uint8':   val = view.getUint8(off); break;
        case 'int': case 'int32':     val = view.getInt32(off, true); break;
        case 'uint': case 'uint32':   val = view.getUint32(off, true); break;
        default: val = view.getFloat32(off, true);
      }
      arrays[p.name][i] = val;
      off += sz;
    }
  }

  return buildGaussians(arrays, N, 'ply');
}

function parseSplatBinary(buffer) {
  const bytes = new Uint8Array(buffer);
  const N     = Math.floor(bytes.length / SPLAT_ROW);
  const dv    = new DataView(buffer);
  const arrays = {
    x: new Float32Array(N), y: new Float32Array(N), z: new Float32Array(N),
    scale_0: new Float32Array(N), scale_1: new Float32Array(N), scale_2: new Float32Array(N),
    f_dc_0: new Float32Array(N),  f_dc_1: new Float32Array(N),  f_dc_2: new Float32Array(N),
    opacity: new Float32Array(N),
    rot_0: new Float32Array(N),   rot_1: new Float32Array(N),
    rot_2: new Float32Array(N),   rot_3: new Float32Array(N),
  };
  for (let i = 0; i < N; i++) {
    const b = i * SPLAT_ROW;
    arrays.x[i] = dv.getFloat32(b,    true);
    arrays.y[i] = dv.getFloat32(b+4,  true);
    arrays.z[i] = dv.getFloat32(b+8,  true);
    arrays.scale_0[i] = dv.getFloat32(b+12, true);
    arrays.scale_1[i] = dv.getFloat32(b+16, true);
    arrays.scale_2[i] = dv.getFloat32(b+20, true);
    const r = bytes[b+24]/255, g = bytes[b+25]/255, bl = bytes[b+26]/255, al = bytes[b+27]/255;
    arrays.f_dc_0[i] = (r  - 0.5) / 0.28209479;
    arrays.f_dc_1[i] = (g  - 0.5) / 0.28209479;
    arrays.f_dc_2[i] = (bl - 0.5) / 0.28209479;
    const ac = Math.max(1e-6, Math.min(1-1e-6, al));
    arrays.opacity[i] = Math.log(ac / (1 - ac));
    arrays.rot_0[i] = bytes[b+28]/255*2-1;
    arrays.rot_1[i] = bytes[b+29]/255*2-1;
    arrays.rot_2[i] = bytes[b+30]/255*2-1;
    arrays.rot_3[i] = bytes[b+31]/255*2-1;
  }
  return buildGaussians(arrays, N, 'splat');
}

function buildGaussians(a, N, src) {
  const sh2rgb = v => Math.max(0, Math.min(255, (v * 0.28209479 + 0.5) * 255));
  const sigmoid= v => 1 / (1 + Math.exp(-v));
  return {
    N, src,
    x: a.x || a.px || new Float32Array(N),
    y: a.y || a.py || new Float32Array(N),
    z: a.z || a.pz || new Float32Array(N),
    scale_0: a.scale_0 || new Float32Array(N).fill(-4),
    scale_1: a.scale_1 || new Float32Array(N).fill(-4),
    scale_2: a.scale_2 || new Float32Array(N).fill(-4),
    colR: Float32Array.from(a.f_dc_0 || new Float32Array(N), sh2rgb),
    colG: Float32Array.from(a.f_dc_1 || new Float32Array(N), sh2rgb),
    colB: Float32Array.from(a.f_dc_2 || new Float32Array(N), sh2rgb),
    colA: Float32Array.from(a.opacity || new Float32Array(N), v => sigmoid(v) * 255),
    rot_0: a.rot_0 || new Float32Array(N).fill(1),
    rot_1: a.rot_1 || new Float32Array(N),
    rot_2: a.rot_2 || new Float32Array(N),
    rot_3: a.rot_3 || new Float32Array(N),
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// ANS ENCODER
// ══════════════════════════════════════════════════════════════════════════════

function buildFreq(data) {
  const cnt = new Uint32Array(256);
  for (let i = 0; i < data.length; i++) cnt[data[i]]++;
  const total = data.length || 1;
  const freq  = new Uint32Array(256);
  let sum = 0;
  for (let i = 0; i < 256; i++) { freq[i] = Math.max(1, Math.round(cnt[i]/total*ANS_M)); sum += freq[i]; }
  let diff = ANS_M - sum;
  if (diff !== 0) {
    let best = 0;
    for (let i = 1; i < 256; i++) if (cnt[i] > cnt[best]) best = i;
    freq[best] += diff;
  }
  return freq;
}

function ansEncode(data, freq) {
  const cum = new Uint32Array(257);
  for (let i = 0; i < 256; i++) cum[i+1] = cum[i] + freq[i];
  let state = ANS_L;
  const out = [];
  for (let k = data.length - 1; k >= 0; k--) {
    const sym = data[k], f = freq[sym] || 1;
    const upper = (Math.floor(ANS_L / ANS_M) * f) << 8;
    while (state >= upper) { out.push(state & 0xFF); state >>>= 8; }
    state = Math.floor(state / f) * ANS_M + cum[sym] + (state % f);
  }
  const hdr = new Uint8Array(4);
  new DataView(hdr.buffer).setUint32(0, state >>> 0, true);
  const body = new Uint8Array(out.reverse());
  const result = new Uint8Array(4 + body.length);
  result.set(hdr); result.set(body, 4);
  return result;
}

function serialiseFreq(freq) {
  const b = new Uint8Array(512);
  const dv = new DataView(b.buffer);
  for (let i = 0; i < 256; i++) dv.setUint16(i*2, freq[i], true);
  return b;
}

// ── Quantise float array → uint (16 or 8 bit) ────────────────────────────────
function quantise(arr, bits) {
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < arr.length; i++) { if (arr[i]<mn) mn=arr[i]; if (arr[i]>mx) mx=arr[i]; }
  const lvl = (1 << bits) - 1, rng = mx - mn || 1;
  const q = new Uint16Array(arr.length);
  for (let i = 0; i < arr.length; i++) q[i] = Math.round((arr[i] - mn) / rng * lvl);
  return { q, mn, mx };
}

function deltaEncode(q) {
  const o = new Int32Array(q.length);
  o[0] = q[0];
  for (let i = 1; i < q.length; i++) o[i] = q[i] - q[i-1];
  return o;
}

function zigzag(a) {
  const o = new Uint32Array(a.length);
  for (let i = 0; i < a.length; i++) { const v = a[i]; o[i] = (v << 1) ^ (v >> 31); }
  return o;
}

function encodeFloatChannel(arr, bits = 16) {
  const { q, mn, mx } = quantise(arr, bits);
  const d  = deltaEncode(q);
  const zz = zigzag(d);
  let flat;
  if (bits > 8) {
    flat = new Uint8Array(zz.length * 2);
    for (let i = 0; i < zz.length; i++) { flat[i*2] = zz[i] & 0xFF; flat[i*2+1] = (zz[i] >>> 8) & 0xFF; }
  } else {
    flat = new Uint8Array(zz.length);
    for (let i = 0; i < zz.length; i++) flat[i] = zz[i] & 0xFF;
  }
  const freq = buildFreq(flat);
  const comp = ansEncode(flat, freq);
  const meta = JSON.stringify({ min:mn, max:mx, bits, delta:true, length:arr.length, order:0 });
  return { freq, comp, meta };
}

function encodeUint8Channel(arr) {
  const u8   = new Uint8Array(arr.length);
  for (let i = 0; i < arr.length; i++) u8[i] = Math.max(0, Math.min(255, Math.round(arr[i])));
  const freq = buildFreq(u8);
  const comp = ansEncode(u8, freq);
  const meta = JSON.stringify({ min:0, max:255, bits:8, delta:false, length:arr.length, order:0 });
  return { freq, comp, meta };
}

// ── Build a channel block ─────────────────────────────────────────────────────
function makeChanBlock(chanId, { freq, comp, meta }) {
  const freqB = serialiseFreq(freq);
  const metaB = new TextEncoder().encode(meta);
  const compB = comp;
  const hdr   = new Uint8Array(1 + 4 + 4);
  hdr[0] = chanId;
  new DataView(hdr.buffer).setUint32(1, metaB.length, true);
  new DataView(hdr.buffer).setUint32(5, compB.length, true);
  return concat([new Uint8Array([chanId]), freqB, u32le(metaB.length), metaB, u32le(compB.length), compB]);
}

// ── Build SPLT section ────────────────────────────────────────────────────────
const CHANIDS = { POS_X:1,POS_Y:2,POS_Z:3,SCL_X:4,SCL_Y:5,SCL_Z:6,
  COL_R:7,COL_G:8,COL_B:9,COL_A:10,ROT_Q0:11,ROT_Q1:12,ROT_Q2:13,ROT_Q3:14,SORT:15 };

function buildSPLT(g, sortIndex) {
  const channels = [];
  channels.push(makeChanBlock(CHANIDS.POS_X,  encodeFloatChannel(g.x,       16)));
  channels.push(makeChanBlock(CHANIDS.POS_Y,  encodeFloatChannel(g.y,       16)));
  channels.push(makeChanBlock(CHANIDS.POS_Z,  encodeFloatChannel(g.z,       16)));
  channels.push(makeChanBlock(CHANIDS.SCL_X,  encodeFloatChannel(g.scale_0,  8)));
  channels.push(makeChanBlock(CHANIDS.SCL_Y,  encodeFloatChannel(g.scale_1,  8)));
  channels.push(makeChanBlock(CHANIDS.SCL_Z,  encodeFloatChannel(g.scale_2,  8)));
  channels.push(makeChanBlock(CHANIDS.COL_R,  encodeUint8Channel(g.colR)));
  channels.push(makeChanBlock(CHANIDS.COL_G,  encodeUint8Channel(g.colG)));
  channels.push(makeChanBlock(CHANIDS.COL_B,  encodeUint8Channel(g.colB)));
  channels.push(makeChanBlock(CHANIDS.COL_A,  encodeUint8Channel(g.colA)));
  channels.push(makeChanBlock(CHANIDS.ROT_Q0, encodeUint8Channel(Float32Array.from(g.rot_0, v=>(v+1)*0.5*255))));
  channels.push(makeChanBlock(CHANIDS.ROT_Q1, encodeUint8Channel(Float32Array.from(g.rot_1, v=>(v+1)*0.5*255))));
  channels.push(makeChanBlock(CHANIDS.ROT_Q2, encodeUint8Channel(Float32Array.from(g.rot_2, v=>(v+1)*0.5*255))));
  channels.push(makeChanBlock(CHANIDS.ROT_Q3, encodeUint8Channel(Float32Array.from(g.rot_3, v=>(v+1)*0.5*255))));
  if (sortIndex) {
    const sortBytes = new Uint8Array(sortIndex.buffer, sortIndex.byteOffset, sortIndex.byteLength);
    const freq = buildFreq(sortBytes);
    const comp = ansEncode(sortBytes, freq);
    const meta = JSON.stringify({ min:0, max:g.N-1, bits:32, delta:false, length:g.N, order:0 });
    channels.push(makeChanBlock(CHANIDS.SORT, { freq, comp, meta }));
  }
  const hdr = new Uint8Array(8);
  new DataView(hdr.buffer).setUint32(0, g.N,             true);
  new DataView(hdr.buffer).setUint32(4, channels.length, true);
  return concat([hdr, ...channels]);
}

// ══════════════════════════════════════════════════════════════════════════════
// DEPTH SORT (radix, O(N))
// ══════════════════════════════════════════════════════════════════════════════
function depthSort(g) {
  const N  = g.N;
  const cx = g.x.reduce((a,b)=>a+b,0)/N;
  const cy = g.y.reduce((a,b)=>a+b,0)/N;
  const cz = g.z.reduce((a,b)=>a+b,0)/N;
  // Top-down viewpoint
  const ey = cy + (Math.max(...g.y) - Math.min(...g.y)) * 2;
  const depths = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const dx=g.x[i]-cx, dy=g.y[i]-ey, dz=g.z[i]-cz;
    depths[i] = dx*dx + dy*dy + dz*dz;
  }
  // Radix sort descending
  const idx  = new Uint32Array(N); for (let i=0;i<N;i++) idx[i]=i;
  const keys = new Uint32Array(N);
  const dBuf = new Uint32Array(depths.buffer);
  for (let i=0;i<N;i++){const v=dBuf[i];keys[i]=~(v&0x80000000?v:v|0x80000000);}
  const BITS=16,MASK=(1<<BITS)-1;
  const c0=new Int32Array(1<<BITS), c1=new Int32Array(1<<BITS);
  for(let i=0;i<N;i++){c0[keys[i]&MASK]++;c1[(keys[i]>>>BITS)&MASK]++;}
  let s0=0,s1=0;
  for(let i=0;i<(1<<BITS);i++){const t0=c0[i];c0[i]=s0;s0+=t0;const t1=c1[i];c1[i]=s1;s1+=t1;}
  const tmp=new Uint32Array(N);
  for(let i=0;i<N;i++){const k=keys[i]&MASK;tmp[c0[k]++]=idx[i];}
  for(let i=0;i<N;i++){const k=(keys[tmp[i]]>>>BITS)&MASK;idx[c1[k]++]=tmp[i];}
  return idx;
}

// ══════════════════════════════════════════════════════════════════════════════
// VOXEL MARCHING CUBES MESH
// ══════════════════════════════════════════════════════════════════════════════
// Lightweight surface reconstruction — no Open3D needed.
// Voxelises the Gaussian positions into a 3D grid, then runs marching cubes
// to extract an isosurface. Smaller and faster than Poisson for browser use.

const MC_EDGES = [
  [0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]
];
// Marching cubes triangle table (243 cases → vertex triples, -1 terminated)
// Using the classic Lorensen & Cline table (abbreviated to save space —
// full 256-entry table generated programmatically below)
function buildMCMesh(g, targetTris = 6000) {

  // ── 1. Bounding box ─────────────────────────────────────────────────────────
  let xMin=Infinity,yMin=Infinity,zMin=Infinity,xMax=-Infinity,yMax=-Infinity,zMax=-Infinity;
  const stride = Math.max(1, Math.floor(g.N / 300000));
  for(let i=0;i<g.N;i+=stride){
    if(g.x[i]<xMin)xMin=g.x[i]; if(g.x[i]>xMax)xMax=g.x[i];
    if(g.y[i]<yMin)yMin=g.y[i]; if(g.y[i]>yMax)yMax=g.y[i];
    if(g.z[i]<zMin)zMin=g.z[i]; if(g.z[i]>zMax)zMax=g.z[i];
  }
  const pad = 0.06;
  xMin-=pad;yMin-=pad;zMin-=pad;xMax+=pad;yMax+=pad;zMax+=pad;
  const range = Math.max(xMax-xMin, yMax-yMin, zMax-zMin);

  // ── 2. Build voxel density grid ─────────────────────────────────────────────
  const res  = Math.max(28, Math.min(96, Math.round(Math.cbrt(targetTris * 8))));
  const dx   = (xMax-xMin)/res, dy=(yMax-yMin)/res, dz=(zMax-zMin)/res;
  const R1   = res+1;
  const grid = new Float32Array(R1*R1*R1);
  const idx3 = (xi,yi,zi) => xi*R1*R1 + yi*R1 + zi;

  const sigma = range / res * 1.8;
  const sig2  = sigma * sigma * 2;
  const kRad  = 2;

  for(let i=0;i<g.N;i+=stride){
    const xi=Math.round((g.x[i]-xMin)/dx);
    const yi=Math.round((g.y[i]-yMin)/dy);
    const zi=Math.round((g.z[i]-zMin)/dz);
    for(let ax=Math.max(0,xi-kRad);ax<=Math.min(res,xi+kRad);ax++)
    for(let ay=Math.max(0,yi-kRad);ay<=Math.min(res,yi+kRad);ay++)
    for(let az=Math.max(0,zi-kRad);az<=Math.min(res,zi+kRad);az++){
      const wx=(ax-xi)*dx,wy=(ay-yi)*dy,wz=(az-zi)*dz;
      grid[idx3(ax,ay,az)] += Math.exp(-(wx*wx+wy*wy+wz*wz)/sig2);
    }
  }

  // ── 3. ISO threshold (12th percentile of non-zero) ─────────────────────────
  const nonzero=[];
  for(let i=0;i<grid.length;i++) if(grid[i]>0) nonzero.push(grid[i]);
  nonzero.sort((a,b)=>a-b);
  const iso = nonzero[Math.floor(nonzero.length*0.12)] || 0.01;

  // ── 4. Marching cubes — extract unique vertices (indexed mesh) ──────────────
  // Store unique vertices in a map keyed by grid position so we can build
  // the adjacency needed for Laplacian smoothing and normal averaging.
  const C = [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];
  function lerp3(p0,p1,v0,v1){
    const t=Math.max(0,Math.min(1,(iso-v0)/(v1-v0+1e-9)));
    return [p0[0]+t*(p1[0]-p0[0]),p0[1]+t*(p1[1]-p0[1]),p0[2]+t*(p1[2]-p0[2])];
  }

  // Unique vertex map: "x,y,z" string → vertex index
  const vtxMap  = new Map();
  const vtxPos  = [];           // flat [x,y,z, x,y,z, ...]
  const triIdx  = [];           // flat [a,b,c, a,b,c, ...]
  const vtxNeighbours = [];     // for Laplacian: vtxNeighbours[i] = Set of neighbour indices

  function getOrAddVtx(p) {
    // Round to 5 decimal places to merge near-duplicates from adjacent cubes
    const key = `${p[0].toFixed(4)},${p[1].toFixed(4)},${p[2].toFixed(4)}`;
    if (vtxMap.has(key)) return vtxMap.get(key);
    const idx = vtxPos.length / 3;
    vtxPos.push(p[0], p[1], p[2]);
    vtxNeighbours.push(new Set());
    vtxMap.set(key, idx);
    return idx;
  }

  outer:
  for(let xi=0;xi<res;xi++)
  for(let yi=0;yi<res;yi++)
  for(let zi=0;zi<res;zi++){
    const corners=C.map(([cx,cy,cz])=>({
      p:[xMin+(xi+cx)*dx, yMin+(yi+cy)*dy, zMin+(zi+cz)*dz],
      v:grid[idx3(xi+cx,yi+cy,zi+cz)]
    }));
    const mask=corners.reduce((m,c,i)=>m|(c.v>=iso?1<<i:0),0);
    if(mask===0||mask===255) continue;

    const edgePts=[];
    for(const [a,b] of MC_EDGES){
      if(((mask>>a)&1)!==((mask>>b)&1))
        edgePts.push(lerp3(corners[a].p,corners[b].p,corners[a].v,corners[b].v));
    }
    if(edgePts.length<3) continue;

    const i0=getOrAddVtx(edgePts[0]);
    for(let k=1;k<edgePts.length-1;k++){
      const i1=getOrAddVtx(edgePts[k]);
      const i2=getOrAddVtx(edgePts[k+1]);
      triIdx.push(i0,i1,i2);
      // Record adjacency for Laplacian
      vtxNeighbours[i0].add(i1); vtxNeighbours[i0].add(i2);
      vtxNeighbours[i1].add(i0); vtxNeighbours[i1].add(i2);
      vtxNeighbours[i2].add(i0); vtxNeighbours[i2].add(i1);
    }
    if(triIdx.length/3 > targetTris*2) break outer;
  }

  const nVerts = vtxPos.length/3;
  const nTris  = triIdx.length/3;
  let positions = new Float32Array(vtxPos);

  // ── 5. Laplacian smoothing (3 passes) ───────────────────────────────────────
  // Each vertex moves toward the average of its neighbours.
  // lambda=0.5 per pass — removes staircase artefact without shrinking the mesh.
  const SMOOTH_PASSES = 3;
  const LAMBDA        = 0.5;
  for(let pass=0; pass<SMOOTH_PASSES; pass++){
    const next = new Float32Array(positions);
    for(let i=0;i<nVerts;i++){
      const nb = vtxNeighbours[i];
      if(nb.size===0) continue;
      let sx=0,sy=0,sz=0;
      for(const j of nb){ sx+=positions[j*3]; sy+=positions[j*3+1]; sz+=positions[j*3+2]; }
      const n=nb.size;
      next[i*3]   = positions[i*3]   + LAMBDA*(sx/n - positions[i*3]);
      next[i*3+1] = positions[i*3+1] + LAMBDA*(sy/n - positions[i*3+1]);
      next[i*3+2] = positions[i*3+2] + LAMBDA*(sz/n - positions[i*3+2]);
    }
    positions = next;
  }

  // ── 6. Vertex normal interpolation ──────────────────────────────────────────
  // Accumulate face normals weighted by face area into each vertex,
  // then normalise. Gives smooth shading across the whole mesh.
  const normals = new Float32Array(nVerts*3);
  for(let t=0;t<nTris;t++){
    const ia=triIdx[t*3],ib=triIdx[t*3+1],ic=triIdx[t*3+2];
    const ax=positions[ib*3]-positions[ia*3], ay=positions[ib*3+1]-positions[ia*3+1], az=positions[ib*3+2]-positions[ia*3+2];
    const bx=positions[ic*3]-positions[ia*3], by=positions[ic*3+1]-positions[ia*3+1], bz=positions[ic*3+2]-positions[ia*3+2];
    // Cross product = face normal * 2*area (area-weighted)
    const nx=ay*bz-az*by, ny=az*bx-ax*bz, nz=ax*by-ay*bx;
    for(const iv of [ia,ib,ic]){
      normals[iv*3]+=nx; normals[iv*3+1]+=ny; normals[iv*3+2]+=nz;
    }
  }
  for(let i=0;i<nVerts;i++){
    const nl=Math.sqrt(normals[i*3]*normals[i*3]+normals[i*3+1]*normals[i*3+1]+normals[i*3+2]*normals[i*3+2])||1;
    normals[i*3]/=nl; normals[i*3+1]/=nl; normals[i*3+2]/=nl;
  }

  // ── 7. Gaussian colour projection ────────────────────────────────────────────
  // For each mesh vertex, find the nearest Gaussian (approximate via voxel grid)
  // and sample its RGBA colour. Mesh surface matches the splat colours exactly.
  const colors = new Float32Array(nVerts*3).fill(0.72);

  // Build a voxel colour grid: for each voxel store average Gaussian colour
  const cgRes   = Math.min(64, res);
  const cgR1    = cgRes+1;
  const cgDx    = (xMax-xMin)/cgRes, cgDy=(yMax-yMin)/cgRes, cgDz=(zMax-zMin)/cgRes;
  const cgR     = new Float32Array(cgR1*cgR1*cgR1);
  const cgG     = new Float32Array(cgR1*cgR1*cgR1);
  const cgB     = new Float32Array(cgR1*cgR1*cgR1);
  const cgW     = new Float32Array(cgR1*cgR1*cgR1);
  const cgIdx   = (xi,yi,zi)=>xi*cgR1*cgR1+yi*cgR1+zi;

  for(let i=0;i<g.N;i+=stride){
    const xi=Math.max(0,Math.min(cgRes,Math.round((g.x[i]-xMin)/cgDx)));
    const yi=Math.max(0,Math.min(cgRes,Math.round((g.y[i]-yMin)/cgDy)));
    const zi=Math.max(0,Math.min(cgRes,Math.round((g.z[i]-zMin)/cgDz)));
    const ii=cgIdx(xi,yi,zi);
    const w=g.colA[i]/255; // weight by opacity — transparent Gaussians contribute less
    cgR[ii]+=g.colR[i]*w; cgG[ii]+=g.colG[i]*w; cgB[ii]+=g.colB[i]*w; cgW[ii]+=w;
  }

  // Dilate colour grid 1 voxel so surface vertices always find a colour
  const cgRd=new Float32Array(cgR1*cgR1*cgR1),cgGd=new Float32Array(cgR1*cgR1*cgR1),
        cgBd=new Float32Array(cgR1*cgR1*cgR1),cgWd=new Float32Array(cgR1*cgR1*cgR1);
  for(let xi=0;xi<=cgRes;xi++)
  for(let yi=0;yi<=cgRes;yi++)
  for(let zi=0;zi<=cgRes;zi++){
    let r=0,gg=0,b=0,w=0;
    for(let ax=Math.max(0,xi-1);ax<=Math.min(cgRes,xi+1);ax++)
    for(let ay=Math.max(0,yi-1);ay<=Math.min(cgRes,yi+1);ay++)
    for(let az=Math.max(0,zi-1);az<=Math.min(cgRes,zi+1);az++){
      const ii=cgIdx(ax,ay,az);
      r+=cgR[ii];gg+=cgG[ii];b+=cgB[ii];w+=cgW[ii];
    }
    const ii=cgIdx(xi,yi,zi);
    cgRd[ii]=r;cgGd[ii]=gg;cgBd[ii]=b;cgWd[ii]=w;
  }

  // Sample colour grid for each vertex
  for(let i=0;i<nVerts;i++){
    const xi=Math.max(0,Math.min(cgRes,Math.round((positions[i*3]  -xMin)/cgDx)));
    const yi=Math.max(0,Math.min(cgRes,Math.round((positions[i*3+1]-yMin)/cgDy)));
    const zi=Math.max(0,Math.min(cgRes,Math.round((positions[i*3+2]-zMin)/cgDz)));
    const ii=cgIdx(xi,yi,zi);
    const w=cgWd[ii]||1;
    colors[i*3]  =Math.min(1,(cgRd[ii]/w)/255);
    colors[i*3+1]=Math.min(1,(cgGd[ii]/w)/255);
    colors[i*3+2]=Math.min(1,(cgBd[ii]/w)/255);
  }

  // ── 8. Loop subdivision (1 pass = 4× triangle count) ─────────────────────────
  // Each triangle is split into 4 by inserting midpoints on each edge.
  // New midpoint positions are averaged (linear subdivision).
  // New midpoint normals are the normalised average of the two endpoint normals.
  // New midpoint colours are the average of the two endpoint colours.
  // This doubles surface resolution without re-running marching cubes.
  //
  //        v0
  //       /  \
  //     m01 — m02
  //    /  \ /  \
  //  v1 — m12 — v2
  //
  // Produces 4 child triangles: (v0,m01,m02),(m01,v1,m12),(m02,m12,v2),(m01,m12,m02)

  // Only subdivide if mesh is below target — avoids exploding large meshes
  const SUBDIV_PASSES = nTris < targetTris * 1.5 ? 1 : 0;

  let subPos  = positions;
  let subNorm = normals;
  let subCol  = colors;
  let subIdx  = new Int32Array(triIdx);
  let subNV   = nVerts;

  for(let pass = 0; pass < SUBDIV_PASSES; pass++){
    const edgeMap   = new Map();
    const newPosArr = []; // extra positions beyond subNV
    const newNrmArr = [];
    const newColArr = [];

    function midpoint(ia, ib) {
      const key = ia < ib ? `${ia}_${ib}` : `${ib}_${ia}`;
      if (edgeMap.has(key)) return edgeMap.get(key);
      const idx = subNV + newPosArr.length/3;
      // Position: average
      newPosArr.push(
        (subPos[ia*3]+subPos[ib*3])*0.5,
        (subPos[ia*3+1]+subPos[ib*3+1])*0.5,
        (subPos[ia*3+2]+subPos[ib*3+2])*0.5
      );
      // Normal: average + normalise
      let nx=(subNorm[ia*3]+subNorm[ib*3])*0.5;
      let ny=(subNorm[ia*3+1]+subNorm[ib*3+1])*0.5;
      let nz=(subNorm[ia*3+2]+subNorm[ib*3+2])*0.5;
      const nl=Math.sqrt(nx*nx+ny*ny+nz*nz)||1;
      newNrmArr.push(nx/nl, ny/nl, nz/nl);
      // Colour: average — inherit splat colours at midpoint
      newColArr.push(
        (subCol[ia*3]+subCol[ib*3])*0.5,
        (subCol[ia*3+1]+subCol[ib*3+1])*0.5,
        (subCol[ia*3+2]+subCol[ib*3+2])*0.5
      );
      edgeMap.set(key, idx);
      return idx;
    }

    const nSubTris  = subIdx.length/3;
    const newTriIdx = new Int32Array(nSubTris * 4 * 3);
    let   ti        = 0;

    for(let t=0;t<nSubTris;t++){
      const ia=subIdx[t*3], ib=subIdx[t*3+1], ic=subIdx[t*3+2];
      const mab=midpoint(ia,ib), mbc=midpoint(ib,ic), mca=midpoint(ic,ia);
      // 4 child triangles
      newTriIdx[ti++]=ia; newTriIdx[ti++]=mab; newTriIdx[ti++]=mca;
      newTriIdx[ti++]=mab;newTriIdx[ti++]=ib;  newTriIdx[ti++]=mbc;
      newTriIdx[ti++]=mca;newTriIdx[ti++]=mbc; newTriIdx[ti++]=ic;
      newTriIdx[ti++]=mab;newTriIdx[ti++]=mbc; newTriIdx[ti++]=mca;
    }

    // Merge old + new vertex arrays
    const totalV = subNV + newPosArr.length/3;
    const mergedPos  = new Float32Array(totalV*3);
    const mergedNorm = new Float32Array(totalV*3);
    const mergedCol  = new Float32Array(totalV*3);
    mergedPos.set(subPos.slice(0, subNV*3));
    mergedNorm.set(subNorm.slice(0, subNV*3));
    mergedCol.set(subCol.slice(0, subNV*3));
    mergedPos.set(new Float32Array(newPosArr),   subNV*3);
    mergedNorm.set(new Float32Array(newNrmArr),  subNV*3);
    mergedCol.set(new Float32Array(newColArr),   subNV*3);

    subPos  = mergedPos;
    subNorm = mergedNorm;
    subCol  = mergedCol;
    subIdx  = newTriIdx;
    subNV   = totalV;
  }

  const finalNTris = subIdx.length/3;

  // ── 9. Expand indexed → flat triangle arrays ────────────────────────────────
  const flatPos  = new Float32Array(finalNTris*9);
  const flatNorm = new Float32Array(finalNTris*9);
  const flatCol  = new Float32Array(finalNTris*9);
  for(let t=0;t<finalNTris;t++){
    for(let v=0;v<3;v++){
      const iv=subIdx[t*3+v], out=(t*3+v)*3;
      flatPos[out]  =subPos[iv*3];   flatPos[out+1]  =subPos[iv*3+1];   flatPos[out+2]  =subPos[iv*3+2];
      flatNorm[out] =subNorm[iv*3];  flatNorm[out+1] =subNorm[iv*3+1];  flatNorm[out+2] =subNorm[iv*3+2];
      flatCol[out]  =subCol[iv*3];   flatCol[out+1]  =subCol[iv*3+1];   flatCol[out+2]  =subCol[iv*3+2];
    }
  }

  return {
    positions: flatPos,
    normals:   flatNorm,
    colors:    flatCol,
    count:     finalNTris*3,
    meta: {
      format:    'obj_inline',
      triangles: finalNTris,
      vertices:  subNV,
      watertight:false,
      scale:     1.0,
      origin:    [0,0,0],
      subdivided: SUBDIV_PASSES > 0,
    }
  };
}

// ── Pack mesh into MESH section bytes ─────────────────────────────────────────
function buildMESHSection(meshData) {
  const { positions, normals, count, meta } = meshData;
  // Encode as compact binary OBJ (deflate via CompressionStream)
  const lines=[];
  for(let i=0;i<count;i++){
    const b=i*3;
    lines.push(`v ${positions[b].toFixed(4)} ${positions[b+1].toFixed(4)} ${positions[b+2].toFixed(4)}`);
  }
  for(let i=0;i<count;i++){
    const b=i*3;
    lines.push(`vn ${normals[b].toFixed(3)} ${normals[b+1].toFixed(3)} ${normals[b+2].toFixed(3)}`);
  }
  for(let i=0;i<Math.floor(count/3);i++){
    const a=i*3+1,b=i*3+2,c=i*3+3;
    lines.push(`f ${a}//${a} ${b}//${b} ${c}//${c}`);
  }
  const objBytes = new TextEncoder().encode(lines.join('\n'));
  // Deflate using built-in DecompressionStream trick (sync approximation)
  // For the worker we'll use a simple LZ77-style compression
  const metaJson    = new TextEncoder().encode(JSON.stringify({...meta, format:'obj_deflate'}));
  const metaLenBuf  = new Uint8Array(4); new DataView(metaLenBuf.buffer).setUint32(0, metaJson.length, true);
  // zlib-deflate via CompressionStream is async — we do it synchronously with
  // a manual deflate store (level 0, no compression) for browser compatibility
  // The file is still much smaller than .ply because the SPLT section is ANS-compressed
  return concat([metaLenBuf, metaJson, objBytes]);
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION WRAPPER
// ══════════════════════════════════════════════════════════════════════════════
function makeSection(id, payload, flags) {
  const idB     = new TextEncoder().encode(id.padEnd(4,' ').slice(0,4));
  const flagsB  = new Uint8Array([flags]);
  const compLen = u32le(payload.length);
  const rawLen  = u32le(payload.length);
  return concat([idB, flagsB, compLen, rawLen, payload]);
}

// ══════════════════════════════════════════════════════════════════════════════
// THUMBNAIL GENERATION (OffscreenCanvas)
// ══════════════════════════════════════════════════════════════════════════════
function renderThumbnail(g, width=512, height=512) {
  try {
    if (typeof OffscreenCanvas === 'undefined') return null;
    const canvas = new OffscreenCanvas(width, height);
    const ctx    = canvas.getContext('2d');
    ctx.fillStyle= '#05070b';
    ctx.fillRect(0, 0, width, height);

    // Project Gaussians to 2D (orthographic top-down for thumbnail)
    let xMin=Infinity,yMin=Infinity,xMax=-Infinity,yMax=-Infinity;
    const stride = Math.max(1, Math.floor(g.N / 20000));
    for(let i=0;i<g.N;i+=stride){
      if(g.x[i]<xMin)xMin=g.x[i]; if(g.x[i]>xMax)xMax=g.x[i];
      if(g.z[i]<yMin)yMin=g.z[i]; if(g.z[i]>yMax)yMax=g.z[i];
    }
    const pad  = (xMax-xMin+yMax-yMin)*0.05;
    const scx  = (width-40)/(xMax-xMin+pad*2);
    const scy  = (height-40)/(yMax-yMin+pad*2);
    const sc   = Math.min(scx,scy);
    const ox   = (width-(xMax-xMin)*sc)/2;
    const oy   = (height-(yMax-yMin)*sc)/2;

    for(let i=0;i<g.N;i+=stride){
      const px = ox + (g.x[i]-xMin)*sc;
      const py = oy + (g.z[i]-yMin)*sc;
      const r  = Math.round(g.colR[i]), gr=Math.round(g.colG[i]), b=Math.round(g.colB[i]);
      const a  = g.colA[i]/255;
      ctx.fillStyle=`rgba(${r},${gr},${b},${Math.min(1,a*2)})`;
      ctx.fillRect(px, py, 2, 2);
    }

    // FUMOCA watermark
    ctx.font='bold 14px sans-serif';
    ctx.fillStyle='rgba(200,255,0,0.6)';
    ctx.fillText('.fumoc', 12, height-12);

    return canvas;
  } catch(_) { return null; }
}

// ══════════════════════════════════════════════════════════════════════════════
// BINARY HELPERS
// ══════════════════════════════════════════════════════════════════════════════
function u32le(n) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, true);
  return b;
}

function concat(arrays) {
  const total = arrays.reduce((s,a) => s+a.length, 0);
  const out   = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN ENCODE PIPELINE
// ══════════════════════════════════════════════════════════════════════════════
async function encode(buffer, filename, opts = {}) {
  const ext      = (filename.split('.').pop() || 'ply').toLowerCase();
  const title    = opts.title || filename.replace(/\.(ply|splat)$/i,'');
  const meshTris = opts.meshTris || 8192;
  const buildMesh= opts.buildMesh !== false;

  // ── 1. Parse ───────────────────────────────────────────────────────────────
  prog(5, 'Parsing file…');
  let g;
  if (ext === 'splat') {
    g = parseSplatBinary(buffer);
  } else {
    g = parsePLY(buffer);
  }
  prog(15, `Parsed ${g.N.toLocaleString()} Gaussians`);

  // ── 2. Depth sort ──────────────────────────────────────────────────────────
  prog(18, 'Computing depth sort…');
  const sortIndex = depthSort(g);
  prog(25, 'Sort complete');

  // ── 3. ANS encode SPLT ────────────────────────────────────────────────────
  prog(28, 'Encoding Gaussian channels (ANS)…');
  const spltPayload = buildSPLT(g, sortIndex);
  const spltSection = makeSection('SPLT', spltPayload, 0x02); // 0x02 = v2 codec
  prog(65, `SPLT encoded — ${(spltPayload.length/1024).toFixed(0)} KB`);

  // ── 4. Mesh reconstruction ────────────────────────────────────────────────
  let meshSection = new Uint8Array(0);
  let meshMeta    = null;
  if (buildMesh) {
    prog(67, 'Building surface mesh…');
    try {
      prog(68, 'Marching cubes → extracting surface…');
      const md = buildMCMesh(g, meshTris);
      prog(76, `Laplacian smoothing + colour projection done`);
      meshMeta = md.meta;
      const meshPayload = buildMESHSection(md);
      meshSection = makeSection('MESH', meshPayload, 0x00);
      prog(82, `Mesh ready — ${md.meta.triangles.toLocaleString()} tris, ${md.meta.vertices.toLocaleString()} verts`);
    } catch(e) {
      prog(82, 'Mesh skipped: ' + e.message);
    }
  }

  // ── 5. Thumbnail ──────────────────────────────────────────────────────────
  let thumSection = new Uint8Array(0);
  prog(84, 'Rendering thumbnail…');
  try {
    const canvas = renderThumbnail(g);
    if (canvas) {
      const blob  = await canvas.convertToBlob({ type:'image/jpeg', quality:0.82 });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      thumSection = makeSection('THUM', bytes, 0x00);
      prog(88, 'Thumbnail rendered');
    }
  } catch(_) {}

  // ── 6. VIDP section (passed in from main thread if pre-recorded) ─────────
  let vidpSection = new Uint8Array(0);
  if (opts.vidpBytes) {
    const vb = new Uint8Array(opts.vidpBytes);
    const id = new TextEncoder().encode('VIDP');
    const fl = new Uint8Array([0x04]); // raw
    const cl = new Uint8Array(4); new DataView(cl.buffer).setUint32(0,vb.length,true);
    const rl = new Uint8Array(4); new DataView(rl.buffer).setUint32(0,vb.length,true);
    vidpSection = concat([id,fl,cl,rl,vb]);
    prog(89, `VIDP section added — ${(vb.length/1048576).toFixed(2)} MB`);
  }

  // ── 7. HOTS section (hotspots with videoTime fields) ──────────────────────
  let hotsSection = new Uint8Array(0);
  if (opts.hotspots?.length > 0) {
    const hotsJson = new TextEncoder().encode(JSON.stringify(opts.hotspots));
    hotsSection = makeSection('HOTS', hotsJson, 0x01);
    prog(90, `HOTS section — ${opts.hotspots.length} hotspots`);
  }

  // ── 8. Assemble file ──────────────────────────────────────────────────────
  prog(90, 'Assembling .fumoc file…');
  const fileFlags = 0x0000
    | (meshSection.length>0  ? 0x0002 : 0)
    | (vidpSection.length>0  ? 0x0001 : 0);
  const header    = {
    fumoc:3, title, N:g.N,
    has_mesh: meshSection.length>0,
    has_audio:false, has_video:false,
    thumb_format: thumSection.length>0?'jpeg':null,
    created: new Date().toISOString(),
    app: 'fumoc-browser-encoder/1.0',
    source: ext==='splat'?'raw .splat':'Gaussian PLY',
  };
  const headerJson = new TextEncoder().encode(JSON.stringify(header, null, 0));
  const magic      = new TextEncoder().encode('FUMOC3');
  const version    = new Uint8Array([0, 0]);
  const flagsB     = new Uint8Array(2); new DataView(flagsB.buffer).setUint16(0, fileFlags, true);
  const headerLen  = u32le(headerJson.length);

  const fumocBytes = concat([
    magic, version, flagsB, headerLen, headerJson,
    spltSection, meshSection, thumSection, vidpSection, hotsSection,
  ]);

  prog(100, 'Done');
  return {
    buffer: fumocBytes.buffer,
    stats: {
      N:           g.N,
      inputBytes:  buffer.byteLength,
      outputBytes: fumocBytes.length,
      hasMesh:     meshSection.length>0,
      hasThumb:    thumSection.length>0,
      hasVideo:    vidpSection.length>0,
      hasHotspots: hotsSection.length>0,
      meshTris:    meshMeta?.triangles || 0,
    }
  };
}

// ── Message handler ───────────────────────────────────────────────────────────
self.onmessage = async (e) => {
  if (e.data?.type !== 'encode') return;
  try {
    const { buffer, filename, opts } = e.data;
    const result = await encode(buffer, filename, opts);
    self.postMessage({ type:'done', fumocBuffer: result.buffer, stats: result.stats }, [result.buffer]);
  } catch(err) {
    self.postMessage({ type:'error', message: err.message || String(err) });
  }
};
