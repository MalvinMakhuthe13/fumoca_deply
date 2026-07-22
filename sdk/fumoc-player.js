/**
 * fumoc-player.js — FUMOC Player v2.0
 * ═══════════════════════════════════════════════════════════════════════════
 * Single-file player for .fumoc files. Zero dependencies.
 *
 * Features:
 *   - Decodes .fumoc v2/v3 (ANS codec + Draco mesh + all optional sections)
 *   - Hybrid splat+mesh rendering: mesh for depth/solidity, splats for colour
 *   - Momentum camera — feels like video, not a 3D viewport
 *   - 1-finger orbit, 2-finger pinch+pan, scroll zoom
 *   - Gyroscope tilt parallax on mobile
 *   - Slow ambient drift when idle — scene is never frozen
 *   - Distance-based blend: close = more mesh, far = more splat
 *   - Tap → Möller-Trumbore ray-mesh hit → fumoc:tap event with world point
 *   - STL export, wireframe toggle, view mode selector
 *   - <fumoc-player src="..."> custom element
 *
 * Usage:
 *   <fumoc-player src="scene.fumoc" style="width:100%;height:500px;"></fumoc-player>
 *   <script src="fumoc-player.js"></script>
 *
 *   const p = FumocPlayer.mount('#container', { src: 'scene.fumoc' });
 *   p.load('other.fumoc');
 *   p.setViewMode('mesh');
 *   p.destroy();
 *
 * Events dispatched on container:
 *   fumoc:ready    — { N, header, hasMesh, tour, hotspots, exportSTL, setViewMode }
 *   fumoc:error    — { message }
 *   fumoc:progress — { pct, label }
 *   fumoc:tap      — { x, y, worldHit:[x,y,z] }  (only when mesh loaded)
 */

(function (global) {
  'use strict';

  const VERSION   = '2.0.0';
  const SPLAT_ROW = 32;
  const ANS_M     = 1 << 12;
  const ANS_L     = 1 << 23;

  // ── ANS DECODER ────────────────────────────────────────────────────────────

  function _deserialiseFreq(bytes) {
    const freq = new Uint32Array(256);
    const dv   = new DataView(bytes.buffer, bytes.byteOffset, 512);
    for (let i = 0; i < 256; i++) freq[i] = dv.getUint16(i * 2, true);
    const cum = new Uint32Array(257);
    for (let s = 0; s < 256; s++) cum[s + 1] = cum[s] + freq[s];
    return { freq, cum };
  }

  function _ansDecode(compressed, freqBytes, outputLen) {
    if (outputLen === 0) return new Uint8Array(0);
    const { freq, cum } = _deserialiseFreq(freqBytes);
    const tbl  = new Uint8Array(ANS_M);
    for (let sym = 0; sym < 256; sym++)
      for (let s = cum[sym]; s < cum[sym + 1]; s++) tbl[s] = sym;
    const out  = new Uint8Array(outputLen);
    let state  = (compressed[0]|(compressed[1]<<8)|(compressed[2]<<16)|(compressed[3]<<24))>>>0;
    let pos    = 4;
    for (let i = 0; i < outputLen; i++) {
      const slot = state % ANS_M;
      const sym  = tbl[slot];
      out[i]     = sym;
      state      = freq[sym] * Math.floor(state / ANS_M) + slot - cum[sym];
      while (state < ANS_L && pos < compressed.length) state = (state << 8) | compressed[pos++];
    }
    return out;
  }

  function _deltaDecode(arr) {
    const out = new arr.constructor(arr.length);
    out[0] = arr[0];
    for (let i = 1; i < arr.length; i++) out[i] = out[i - 1] + arr[i];
    return out;
  }

  function _dequantise(arr, min, max, bits) {
    const levels = (1 << bits) - 1, range = max - min;
    const out    = new Float32Array(arr.length);
    for (let i = 0; i < arr.length; i++) out[i] = min + (arr[i] / levels) * range;
    return out;
  }

  function _decodeChannel(comp, freqBytes, meta) {
    const bps  = meta.bits > 8 ? 2 : 1;
    const raw  = _ansDecode(comp, freqBytes, meta.length * bps);
    let quant;
    if (meta.bits > 8) {
      const dv = new DataView(raw.buffer, raw.byteOffset);
      quant = new Int16Array(meta.length);
      for (let i = 0; i < meta.length; i++) { const zz=dv.getUint16(i*2,true); quant[i]=zz&1?-((zz+1)>>1):zz>>1; }
    } else {
      quant = new Int8Array(meta.length);
      for (let i = 0; i < meta.length; i++) { const zz=raw[i]; quant[i]=zz&1?-((zz+1)>>1):zz>>1; }
    }
    if (meta.delta) quant = _deltaDecode(quant);
    return _dequantise(quant, meta.min, meta.max, meta.bits);
  }

  // ── INFLATE ────────────────────────────────────────────────────────────────

  async function _inflate(data) {
    const ds = new DecompressionStream('deflate');
    const w  = ds.writable.getWriter();
    w.write(data); w.close();
    const chunks = [];
    const r = ds.readable.getReader();
    for (;;) { const { done, value } = await r.read(); if (done) break; chunks.push(value); }
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const out   = new Uint8Array(total);
    let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
  }

  // ── UINT8 DELTA DECODE (for colour channels) ─────────────────────────────
  // Encoder writes: zigzag(delta(uint8)) — we undo zigzag then cumsum.

  // Modular delta decode: out[0]=raw[0], out[i]=(out[i-1]+raw[i])&0xFF
  // Matches encoder: d[0]=val[0], d[i]=(val[i]-val[i-1])&0xFF
  function _decodeUint8Delta(raw, N) {
    const out = new Uint8Array(N);
    out[0] = raw[0];
    for (let i = 1; i < N; i++) out[i] = (out[i-1] + raw[i]) & 0xFF;
    return out;
  }

  // ── ROT3 QUATERNION DECODER ───────────────────────────────────────────────
  // Encoder stored 3 components + implicit-index array.
  // We reconstruct W = sqrt(max(0, 1-x²-y²-z²)), re-insert into the right
  // slot, then quantise all 4 back to uint8 [0,255].

  function _decodeRot3(payload, N) {
    const dv    = new DataView(payload.buffer, payload.byteOffset);
    let off     = 1; // skip 0xFF marker byte
    const SCALE = 127.5;
    const cols  = [];

    // 3 stored component columns, each delta-coded ANS
    for (let c = 0; c < 3; c++) {
      const freq = payload.slice(off, off + 512); off += 512;
      const cLen = dv.getUint32(off, true); off += 4;
      const comp = payload.slice(off, off + cLen); off += cLen;
      const raw  = _ansDecode(comp, freq, N);
      cols.push(_decodeUint8Delta(raw, N));
    }

    // Implicit-component index array
    const freqImp  = payload.slice(off, off + 512); off += 512;
    const cLenImp  = dv.getUint32(off, true); off += 4;
    const compImp  = payload.slice(off, off + cLenImp);
    const implicit = _ansDecode(compImp, freqImp, N);

    const Q0 = new Uint8Array(N), Q1 = new Uint8Array(N);
    const Q2 = new Uint8Array(N), Q3 = new Uint8Array(N);

    for (let i = 0; i < N; i++) {
      const imp = implicit[i]; // which component was dropped (0=w,1=x,2=y,3=z)
      const s0  = (cols[0][i] - SCALE) / SCALE;
      const s1  = (cols[1][i] - SCALE) / SCALE;
      const s2  = (cols[2][i] - SCALE) / SCALE;
      const w   = Math.sqrt(Math.max(0, 1 - s0*s0 - s1*s1 - s2*s2));

      // Re-insert into correct positions
      const q = [0, 0, 0, 0];
      let s = 0;
      for (let j = 0; j < 4; j++) {
        q[j] = (j === imp) ? w : [s0,s1,s2][s++];
      }
      Q0[i] = Math.round(q[0] * SCALE + SCALE) & 0xFF;
      Q1[i] = Math.round(q[1] * SCALE + SCALE) & 0xFF;
      Q2[i] = Math.round(q[2] * SCALE + SCALE) & 0xFF;
      Q3[i] = Math.round(q[3] * SCALE + SCALE) & 0xFF;
    }

    return { ROT_Q0: Q0, ROT_Q1: Q1, ROT_Q2: Q2, ROT_Q3: Q3 };
  }

  // ── SPLT v2 DECODER ────────────────────────────────────────────────────────

  function _decodeSpltV2(data) {
    const dv  = new DataView(data.buffer, data.byteOffset);
    const N   = dv.getUint32(0, true);
    const nCh = dv.getUint32(4, true);
    const dec = new TextDecoder();
    // 11 = ROT3 (new 3-component format). Legacy: 12-14 = ROT_Q1/Q2/Q3.
    const CH  = {1:'POS_X',2:'POS_Y',3:'POS_Z',4:'SCL_X',5:'SCL_Y',6:'SCL_Z',
                 7:'COL_R',8:'COL_G',9:'COL_B',10:'COL_A',
                 11:'ROT3',12:'ROT_Q1',13:'ROT_Q2',14:'ROT_Q3',15:'SORT'};
    const channels = {};
    let off = 8;

    for (let c = 0; c < nCh; c++) {
      const chanId = data[off++];
      const name   = CH[chanId] || ('CH_' + chanId);

      if (name === 'ROT3') {
        // Custom packing: metaLen + metaJSON + payloadLen + payload (no freq table)
        const mLen   = dv.getUint32(off, true); off += 4;
        off += mLen; // skip meta JSON (format/N/scale)
        const pLen   = dv.getUint32(off, true); off += 4;
        const payload= data.slice(off, off + pLen); off += pLen;
        Object.assign(channels, _decodeRot3(payload, N));
        continue;
      }

      // Standard channel: 512-byte freq table + metaLen + meta + compLen + comp
      const freq = data.slice(off, off + 512); off += 512;
      const mLen = dv.getUint32(off, true); off += 4;
      const meta = JSON.parse(dec.decode(data.slice(off, off + mLen))); off += mLen;
      const cLen = dv.getUint32(off, true); off += 4;
      const comp = data.slice(off, off + cLen); off += cLen;

      if (name === 'SORT') {
        const sb = _ansDecode(comp, freq, meta.length * 4);
        channels.SORT = new Uint32Array(sb.buffer, sb.byteOffset, meta.length);
      } else if (name === 'COL_R' || name === 'COL_G' || name === 'COL_B') {
        const raw = _ansDecode(comp, freq, meta.length);
        channels[name] = meta.delta ? _decodeUint8Delta(raw, meta.length) : raw;
      } else if (name.startsWith('COL_') || name.startsWith('ROT_')) {
        channels[name] = _ansDecode(comp, freq, meta.length);
      } else {
        channels[name] = _decodeChannel(comp, freq, meta);
      }
    }

    return { N, channels };
  }

  // ── .nif DECODER (compact, self-contained — mirrors engine-next/format/NIFSpec.js) ──
  // fumoc-player.js is meant to be a single-file, zero-dependency embed asset, so this
  // duplicates (rather than imports) the minimal subset of NIFSpec's binary contract:
  // 256-byte header, then chunks of [type:u16 BE][codec:u8][reserved:u8][size:u32 BE]
  // [crc32:u32 BE][pad:4][data]. Only META (0x0001) and KEYFRAME_GEO (0x0003) are read.
  const NIF_MAGIC = 0x4E494600;
  function _sigmoid(x){ return 1/(1+Math.exp(-x)); }

  function decodeNif(buffer){
    const dv = new DataView(buffer);
    if (dv.byteLength < 256 || dv.getUint32(0,false) !== NIF_MAGIC) throw new Error('Not a .nif file');

    let offset = 256, metaObj = {}, geoChunk = null;
    while (offset + 16 <= dv.byteLength) {
      const type = dv.getUint16(offset, false);
      const size = dv.getUint32(offset+4, false);
      const dataStart = offset + 16;
      if (dataStart + size > dv.byteLength) break; // truncated — stop, keep what we have
      if (type === 0x0001) { // META
        try { metaObj = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, dataStart, size))); } catch(_){}
      } else if (type === 0x0003) { // KEYFRAME_GEO
        geoChunk = { dataStart, size };
      }
      offset = dataStart + size;
    }
    if (!geoChunk) throw new Error('.nif file has no KEYFRAME_GEO chunk');

    const gdv = new DataView(buffer, geoChunk.dataStart, geoChunk.size);
    const flag = gdv.getUint8(0);
    if (flag !== 0x00) throw new Error('Only raw float32 (flag 0x00) .nif geometry is supported by this player build');
    const N = gdv.getUint32(1, false);

    // Copy into an aligned buffer (dataStart+5 isn't guaranteed 4-byte aligned)
    const floatBytes = N * 14 * 4;
    const raw  = new Uint8Array(buffer, geoChunk.dataStart + 5, floatBytes);
    const copy = new ArrayBuffer(floatBytes);
    new Uint8Array(copy).set(raw);
    const geo = new Float32Array(copy);

    // Build a 32-byte-row splat binary this renderer already knows how to read:
    // bytes 0-12 position, 12-24 log-scale (already log-space in NIF — no conversion
    // needed, matches SPLAT_ROW's own convention), 24-27 color u8, 27 opacity u8.
    const splatBinary = new Uint8Array(N * SPLAT_ROW);
    const sdv = new DataView(splatBinary.buffer);
    for (let i=0;i<N;i++){
      const o = i*14, b = i*SPLAT_ROW;
      sdv.setFloat32(b+0,  geo[o+0], true);
      sdv.setFloat32(b+4,  geo[o+1], true);
      sdv.setFloat32(b+8,  geo[o+2], true);
      sdv.setFloat32(b+12, geo[o+3], true);
      sdv.setFloat32(b+16, geo[o+4], true);
      sdv.setFloat32(b+20, geo[o+5], true);
      splatBinary[b+24] = Math.max(0,Math.min(255,Math.round(_sigmoid(geo[o+11])*255)));
      splatBinary[b+25] = Math.max(0,Math.min(255,Math.round(_sigmoid(geo[o+12])*255)));
      splatBinary[b+26] = Math.max(0,Math.min(255,Math.round(_sigmoid(geo[o+13])*255)));
      splatBinary[b+27] = Math.max(0,Math.min(255,Math.round(_sigmoid(geo[o+10])*255)));
    }

    return {
      splatBinary, N,
      header: { title: metaObj.title },
      hotspots: metaObj.hotspots || [],
      tour: metaObj.tourStops || [],
      meshSection: null, meshMeta: null,
    };
  }

  function _isNifBuffer(buffer){
    if (!buffer || buffer.byteLength < 4) return false;
    return new DataView(buffer).getUint32(0,false) === NIF_MAGIC;
  }

    // ── FULL .fumoc DECODER ────────────────────────────────────────────────────

  async function decodeFumoc(buffer, onProgress) {
    const bytes = new Uint8Array(buffer);
    if (String.fromCharCode(bytes[0],bytes[1],bytes[2],bytes[3],bytes[4]) !== 'FUMOC')
      throw new Error('Not a .fumoc file');

    onProgress?.(5, 'Reading header…');
    const dv        = new DataView(buffer);
    const headerLen = dv.getUint32(10, true);
    let header = {};
    try { header = JSON.parse(new TextDecoder().decode(bytes.slice(14, 14+headerLen))); } catch (_) {}

    let off = 14 + headerLen;
    const sections = {};
    while (off + 13 <= bytes.length) {
      const id      = String.fromCharCode(bytes[off],bytes[off+1],bytes[off+2],bytes[off+3]);
      const flags   = bytes[off+4];
      const compLen = dv.getUint32(off+5, true);
      const rawLen  = dv.getUint32(off+9, true);
      sections[id]  = { flags, data: bytes.slice(off+13, off+13+compLen), compLen, rawLen };
      off += 13 + compLen;
    }

    const splt = sections['SPLT'];
    if (!splt) throw new Error('No SPLT section — corrupt file');
    onProgress?.(20, 'Decompressing…');
    let spltData = splt.data;
    if (splt.flags & 0x01) spltData = await _inflate(spltData);

    onProgress?.(40, 'Decoding Gaussians…');
    let N, channels;
    if (spltData.length >= 8) {
      const probe = new DataView(spltData.buffer, spltData.byteOffset, 8);
      const pN = probe.getUint32(0,true), pC = probe.getUint32(4,true);
      if (pN > 0 && pC >= 1 && pC <= 15 && spltData.length > pN*4)
        ({ N, channels } = _decodeSpltV2(spltData));
    }
    if (!N) {
      N = Math.floor(spltData.length / SPLAT_ROW);
      const dv2 = new DataView(spltData.buffer, spltData.byteOffset);
      channels = {
        POS_X:new Float32Array(N),POS_Y:new Float32Array(N),POS_Z:new Float32Array(N),
        SCL_X:new Float32Array(N),SCL_Y:new Float32Array(N),SCL_Z:new Float32Array(N),
        COL_R:new Uint8Array(N),COL_G:new Uint8Array(N),COL_B:new Uint8Array(N),COL_A:new Uint8Array(N),
        ROT_Q0:new Uint8Array(N),ROT_Q1:new Uint8Array(N),ROT_Q2:new Uint8Array(N),ROT_Q3:new Uint8Array(N),
      };
      for (let i=0;i<N;i++) {
        const b=i*SPLAT_ROW;
        channels.POS_X[i]=dv2.getFloat32(b,true);channels.POS_Y[i]=dv2.getFloat32(b+4,true);channels.POS_Z[i]=dv2.getFloat32(b+8,true);
        channels.SCL_X[i]=dv2.getFloat32(b+12,true);channels.SCL_Y[i]=dv2.getFloat32(b+16,true);channels.SCL_Z[i]=dv2.getFloat32(b+20,true);
        channels.COL_R[i]=spltData[b+24];channels.COL_G[i]=spltData[b+25];channels.COL_B[i]=spltData[b+26];channels.COL_A[i]=spltData[b+27];
        channels.ROT_Q0[i]=spltData[b+28];channels.ROT_Q1[i]=spltData[b+29];channels.ROT_Q2[i]=spltData[b+30];channels.ROT_Q3[i]=spltData[b+31];
      }
    }

    onProgress?.(75, 'Assembling '+N.toLocaleString()+' Gaussians…');
    // SORT channel contains pre-computed depth indices (back-to-front).
    // They index into the Morton-ordered arrays, so we just follow them directly.
    const sort  = channels.SORT;
    const out   = new Uint8Array(N * SPLAT_ROW);
    const odv   = new DataView(out.buffer);
    // Rotation default: identity quaternion → w=1, x=y=z=0 → uint8: [255,128,128,128]
    const Q0def = channels.ROT_Q0 ?? null;
    const Q1def = channels.ROT_Q1 ?? null;
    const Q2def = channels.ROT_Q2 ?? null;
    const Q3def = channels.ROT_Q3 ?? null;
    for (let i = 0; i < N; i++) {
      const src = sort ? sort[i] : i;
      const b   = i * SPLAT_ROW;
      odv.setFloat32(b,    channels.POS_X?.[src] ?? 0,  true);
      odv.setFloat32(b+4,  channels.POS_Y?.[src] ?? 0,  true);
      odv.setFloat32(b+8,  channels.POS_Z?.[src] ?? 0,  true);
      odv.setFloat32(b+12, channels.SCL_X?.[src] ?? -5, true);
      odv.setFloat32(b+16, channels.SCL_Y?.[src] ?? -5, true);
      odv.setFloat32(b+20, channels.SCL_Z?.[src] ?? -5, true);
      out[b+24] = channels.COL_R?.[src] ?? 128;
      out[b+25] = channels.COL_G?.[src] ?? 128;
      out[b+26] = channels.COL_B?.[src] ?? 128;
      out[b+27] = channels.COL_A?.[src] ?? 255;
      // Rotations: ROT_Q0=w, ROT_Q1=x, ROT_Q2=y, ROT_Q3=z
      // Both ROT3 (new) and legacy ROT_Q0–Q3 formats produce the same channels.
      out[b+28] = Q0def ? Q0def[src] : 255; // w=1 default
      out[b+29] = Q1def ? Q1def[src] : 128; // x=0 default
      out[b+30] = Q2def ? Q2def[src] : 128; // y=0 default
      out[b+31] = Q3def ? Q3def[src] : 128; // z=0 default
    }

    const _json = async sec => {
      if (!sec) return null;
      let d = sec.data; if (sec.flags&0x01) d = await _inflate(d);
      try { return JSON.parse(new TextDecoder().decode(d)); } catch (_) { return null; }
    };

    let meshSection=null, meshMeta=null;
    if (sections['MESH']) {
      let md = sections['MESH'].data;
      if (sections['MESH'].flags&0x01) md = await _inflate(md);
      try {
        const mLen = new DataView(md.buffer,md.byteOffset,4).getUint32(0,true);
        if (mLen > 0 && mLen < md.length) {
          meshMeta    = JSON.parse(new TextDecoder().decode(md.slice(4,4+mLen)));
          meshSection = md.slice(4+mLen);
        } else { meshSection = md; }
      } catch (_) { meshSection = md; }
    }

    let thumbnail = null;
    if (sections['THUM']) { let t=sections['THUM'].data; if(sections['THUM'].flags&0x01)t=await _inflate(t); thumbnail=t; }

    onProgress?.(95, 'Ready');
    return {
      splatBinary: out, header, thumbnail, N, channels,
      tour:     await _json(sections['TOUR']),
      hotspots: await _json(sections['HOTS']),
      motion:   await _json(sections['MOTN']),
      cameras:  await _json(sections['CAMR']),
      branding: await _json(sections['BRND']),
      meshSection, meshMeta,
    };
  }

  // ── MESH DECODERS ──────────────────────────────────────────────────────────

  function _parseOBJ(text) {
    const V=[],N=[],F=[];
    for (const line of text.split('\n')) {
      const t=line.trim().split(/\s+/);
      if(t[0]==='v') V.push(+t[1],+t[2],+t[3]);
      if(t[0]==='vn')N.push(+t[1],+t[2],+t[3]);
      if(t[0]==='f') F.push(...t.slice(1,4).map(s=>{const[v,,n]=s.split('/').map(Number);return[v-1,n?n-1:-1];}));
    }
    const Nf=F.length,pos=new Float32Array(Nf*3),norm=new Float32Array(Nf*3),col=new Float32Array(Nf*3).fill(0.75);
    for(let i=0;i<Nf;i++){const[vi,ni]=F[i];pos[i*3]=V[vi*3];pos[i*3+1]=V[vi*3+1];pos[i*3+2]=V[vi*3+2];if(ni>=0&&N.length){norm[i*3]=N[ni*3];norm[i*3+1]=N[ni*3+1];norm[i*3+2]=N[ni*3+2];}}
    return{positions:pos,normals:norm,colors:col,count:Nf};
  }

  let _dracoP=null;
  function _loadDraco(){
    if(_dracoP)return _dracoP;
    _dracoP=new Promise((res,rej)=>{
      if(typeof DracoDecoderModule!=='undefined'){DracoDecoderModule({}).then(res).catch(rej);return;}
      const s=document.createElement('script');
      s.src='https://www.gstatic.com/draco/versioned/decoders/1.5.7/draco_decoder.js';
      s.onload=()=>DracoDecoderModule({}).then(res).catch(rej);
      s.onerror=()=>rej(new Error('Draco load failed'));
      document.head.appendChild(s);
    });
    return _dracoP;
  }

  async function _decodeDraco(bytes) {
    const dr=await _loadDraco(),buf=new dr.DecoderBuffer(),dec=new dr.Decoder();
    buf.Init(bytes,bytes.length);
    const gt=dec.GetEncodedGeometryType(buf);
    const mesh=gt===dr.TRIANGULAR_MESH?new dr.Mesh():new dr.PointCloud();
    const st=gt===dr.TRIANGULAR_MESH?dec.DecodeBufferToMesh(buf,mesh):dec.DecodeBufferToPointCloud(buf,mesh);
    if(!st.ok())throw new Error('Draco: '+st.error_msg());
    const nF=mesh.num_faces?mesh.num_faces():0,nV=mesh.num_points();
    const getF=(attr,n)=>{
      if(!attr||attr.ptr===0)return null;
      const a=new dr.DracoFloat32Array(),o=new Float32Array(nV*n);
      dec.GetAttributeFloatForAllPoints(mesh,attr,a);
      for(let i=0;i<o.length;i++)o[i]=a.GetValue(i);
      dr.destroy(a);return o;
    };
    const rP=getF(dec.GetNamedAttribute(mesh,dr.POSITION),3);
    const rN=getF(dec.GetNamedAttribute(mesh,dr.NORMAL),3);
    const rC=getF(dec.GetNamedAttribute(mesh,dr.COLOR),3);
    const count=nF*3,pos=new Float32Array(count*3),norm=new Float32Array(count*3),col=new Float32Array(count*3);
    const fi=new dr.DracoInt32Array();
    for(let f=0;f<nF;f++){
      dec.GetFaceFromMesh(mesh,f,fi);
      for(let c=0;c<3;c++){
        const vi=fi.GetValue(c),o=(f*3+c)*3;
        if(rP){pos[o]=rP[vi*3];pos[o+1]=rP[vi*3+1];pos[o+2]=rP[vi*3+2];}
        if(rN){norm[o]=rN[vi*3];norm[o+1]=rN[vi*3+1];norm[o+2]=rN[vi*3+2];}
        if(rC){col[o]=rC[vi*3];col[o+1]=rC[vi*3+1];col[o+2]=rC[vi*3+2];}
        else{col[o]=col[o+1]=col[o+2]=0.75;}
      }
    }
    dr.destroy(fi);dr.destroy(mesh);dr.destroy(dec);dr.destroy(buf);
    if(!rN){for(let f=0;f<nF;f++){const b=f*9;const nx=(pos[b+4]-pos[b+1])*(pos[b+8]-pos[b+2])-(pos[b+5]-pos[b+2])*(pos[b+7]-pos[b+1]);const ny=(pos[b+5]-pos[b+2])*(pos[b+6]-pos[b+0])-(pos[b+3]-pos[b+0])*(pos[b+8]-pos[b+2]);const nz=(pos[b+3]-pos[b+0])*(pos[b+7]-pos[b+1])-(pos[b+4]-pos[b+1])*(pos[b+6]-pos[b+0]);const nl=Math.sqrt(nx*nx+ny*ny+nz*nz)||1;norm[b]=norm[b+3]=norm[b+6]=nx/nl;norm[b+1]=norm[b+4]=norm[b+7]=ny/nl;norm[b+2]=norm[b+5]=norm[b+8]=nz/nl;}}
    return{positions:pos,normals:norm,colors:col,count};
  }

  // ── STL EXPORT ────────────────────────────────────────────────────────────

  function _exportSTL(mesh, name) {
    const{positions:P,normals:Nv,count:C}=mesh;
    const buf=new ArrayBuffer(84+C*50),dv=new DataView(buf);
    new Uint8Array(buf,0,80).set(new TextEncoder().encode('FUMOCA mesh — fumoca.co.za'.padEnd(80).slice(0,80)));
    dv.setUint32(80,C/3,true);let off=84;
    for(let f=0;f<C/3;f++){const b=f*9;dv.setFloat32(off,Nv[b],true);off+=4;dv.setFloat32(off,Nv[b+1],true);off+=4;dv.setFloat32(off,Nv[b+2],true);off+=4;for(let v=0;v<3;v++){dv.setFloat32(off,P[b+v*3],true);off+=4;dv.setFloat32(off,P[b+v*3+1],true);off+=4;dv.setFloat32(off,P[b+v*3+2],true);off+=4;}dv.setUint16(off,0,true);off+=2;}
    const a=Object.assign(document.createElement('a'),{href:URL.createObjectURL(new Blob([buf],{type:'application/octet-stream'})),download:(name||'fumoca-mesh')+'.stl'});
    a.click();setTimeout(()=>URL.revokeObjectURL(a.href),5000);
  }

  // ── MATH ──────────────────────────────────────────────────────────────────

  const _sub  =(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
  const _dot  =(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  const _cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const _norm =v=>{const l=Math.sqrt(_dot(v,v))||1;return[v[0]/l,v[1]/l,v[2]/l];};
  const _len  =v=>Math.sqrt(_dot(v,v));
  const _len2 =(a,b)=>{const d=_sub(a,b);return _len(d);};

  function _perspective(fov,asp,n,f){const t=1/Math.tan(fov*.5),d=n-f;return new Float32Array([t/asp,0,0,0,0,t,0,0,0,0,(f+n)/d,-1,0,0,2*f*n/d,0]);}
  function _lookAt(e,t,u){const f=_norm(_sub(t,e)),r=_norm(_cross(f,u)),uu=_cross(r,f);return new Float32Array([r[0],uu[0],-f[0],0,r[1],uu[1],-f[1],0,r[2],uu[2],-f[2],0,-_dot(r,e),-_dot(uu,e),_dot(f,e),1]);}
  function _mul(a,b){const o=new Float32Array(16);for(let i=0;i<4;i++)for(let j=0;j<4;j++){let s=0;for(let k=0;k<4;k++)s+=a[i+k*4]*b[k+j*4];o[i+j*4]=s;}return o;}
  function _normMat(mv){return new Float32Array([mv[0],mv[1],mv[2],mv[4],mv[5],mv[6],mv[8],mv[9],mv[10]]);}

  function _mat4Inv(m){
    const inv=new Float32Array(16);
    inv[0]= m[5]*m[10]*m[15]-m[5]*m[11]*m[14]-m[9]*m[6]*m[15]+m[9]*m[7]*m[14]+m[13]*m[6]*m[11]-m[13]*m[7]*m[10];
    inv[4]=-m[4]*m[10]*m[15]+m[4]*m[11]*m[14]+m[8]*m[6]*m[15]-m[8]*m[7]*m[14]-m[12]*m[6]*m[11]+m[12]*m[7]*m[10];
    inv[8]= m[4]*m[9]*m[15]-m[4]*m[11]*m[13]-m[8]*m[5]*m[15]+m[8]*m[7]*m[13]+m[12]*m[5]*m[11]-m[12]*m[7]*m[9];
    inv[12]=-m[4]*m[9]*m[14]+m[4]*m[10]*m[13]+m[8]*m[5]*m[14]-m[8]*m[6]*m[13]-m[12]*m[5]*m[10]+m[12]*m[6]*m[9];
    inv[1]=-m[1]*m[10]*m[15]+m[1]*m[11]*m[14]+m[9]*m[2]*m[15]-m[9]*m[3]*m[14]-m[13]*m[2]*m[11]+m[13]*m[3]*m[10];
    inv[5]= m[0]*m[10]*m[15]-m[0]*m[11]*m[14]-m[8]*m[2]*m[15]+m[8]*m[3]*m[14]+m[12]*m[2]*m[11]-m[12]*m[3]*m[10];
    inv[9]=-m[0]*m[9]*m[15]+m[0]*m[11]*m[13]+m[8]*m[1]*m[15]-m[8]*m[3]*m[13]-m[12]*m[1]*m[11]+m[12]*m[3]*m[9];
    inv[13]=m[0]*m[9]*m[14]-m[0]*m[10]*m[13]-m[8]*m[1]*m[14]+m[8]*m[2]*m[13]+m[12]*m[1]*m[10]-m[12]*m[2]*m[9];
    inv[2]= m[1]*m[6]*m[15]-m[1]*m[7]*m[14]-m[5]*m[2]*m[15]+m[5]*m[3]*m[14]+m[13]*m[2]*m[7]-m[13]*m[3]*m[6];
    inv[6]=-m[0]*m[6]*m[15]+m[0]*m[7]*m[14]+m[4]*m[2]*m[15]-m[4]*m[3]*m[14]-m[12]*m[2]*m[7]+m[12]*m[3]*m[6];
    inv[10]=m[0]*m[5]*m[15]-m[0]*m[7]*m[13]-m[4]*m[1]*m[15]+m[4]*m[3]*m[13]+m[12]*m[1]*m[7]-m[12]*m[3]*m[5];
    inv[14]=-m[0]*m[5]*m[14]+m[0]*m[6]*m[13]+m[4]*m[1]*m[14]-m[4]*m[2]*m[13]-m[12]*m[1]*m[6]+m[12]*m[2]*m[5];
    inv[3]=-m[1]*m[6]*m[11]+m[1]*m[7]*m[10]+m[5]*m[2]*m[11]-m[5]*m[3]*m[10]-m[9]*m[2]*m[7]+m[9]*m[3]*m[6];
    inv[7]= m[0]*m[6]*m[11]-m[0]*m[7]*m[10]-m[4]*m[2]*m[11]+m[4]*m[3]*m[10]+m[8]*m[2]*m[7]-m[8]*m[3]*m[6];
    inv[11]=-m[0]*m[5]*m[11]+m[0]*m[7]*m[9]+m[4]*m[1]*m[11]-m[4]*m[3]*m[9]-m[8]*m[1]*m[7]+m[8]*m[3]*m[5];
    inv[15]=m[0]*m[5]*m[10]-m[0]*m[6]*m[9]-m[4]*m[1]*m[10]+m[4]*m[2]*m[9]+m[8]*m[1]*m[6]-m[8]*m[2]*m[5];
    const det=m[0]*inv[0]+m[1]*inv[4]+m[2]*inv[8]+m[3]*inv[12];
    if(Math.abs(det)<1e-12)return null;
    const d=1/det;for(let i=0;i<16;i++)inv[i]*=d;return inv;
  }

  function _mv4(m,v){return[m[0]*v[0]+m[4]*v[1]+m[8]*v[2]+m[12]*v[3],m[1]*v[0]+m[5]*v[1]+m[9]*v[2]+m[13]*v[3],m[2]*v[0]+m[6]*v[1]+m[10]*v[2]+m[14]*v[3],m[3]*v[0]+m[7]*v[1]+m[11]*v[2]+m[15]*v[3]];}

  function _rayTri(ro,rd,v0,v1,v2){
    const e1=_sub(v1,v0),e2=_sub(v2,v0),h=_cross(rd,e2),a=_dot(e1,h);
    if(Math.abs(a)<1e-8)return null;
    const f=1/a,s=_sub(ro,v0),u=f*_dot(s,h);
    if(u<0||u>1)return null;
    const q=_cross(s,e1),v=f*_dot(rd,q);
    if(v<0||u+v>1)return null;
    const t=f*_dot(e2,q);return t>1e-4?t:null;
  }

  // ── SORT WORKER ───────────────────────────────────────────────────────────

  const _SORT_SRC=`self.onmessage=function(e){const{positions:P,eye:E,N}=e.data;const ex=E[0],ey=E[1],ez=E[2];const D=new Float32Array(N);for(let i=0;i<N;i++){const b=i*3,dx=P[b]-ex,dy=P[b+1]-ey,dz=P[b+2]-ez;D[i]=dx*dx+dy*dy+dz*dz;}const idx=new Uint32Array(N);for(let i=0;i<N;i++)idx[i]=i;const keys=new Uint32Array(N);const dB=new Uint32Array(D.buffer);for(let i=0;i<N;i++){const v=dB[i];keys[i]=~(v&0x80000000?v:v|0x80000000);}const B=16,M=(1<<B)-1,c0=new Int32Array(1<<B),c1=new Int32Array(1<<B);for(let i=0;i<N;i++){c0[keys[i]&M]++;c1[(keys[i]>>>B)&M]++;}let s0=0,s1=0;for(let i=0;i<(1<<B);i++){const t0=c0[i];c0[i]=s0;s0+=t0;const t1=c1[i];c1[i]=s1;s1+=t1;}const tmp=new Uint32Array(N);for(let i=0;i<N;i++){const k=keys[i]&M;tmp[c0[k]++]=idx[i];}for(let i=0;i<N;i++){const k=(keys[tmp[i]]>>>B)&M;idx[c1[k]++]=tmp[i];}self.postMessage({indices:idx},[idx.buffer]);};`;

  // ── SHADERS ───────────────────────────────────────────────────────────────

  const SPLAT_VERT=`precision highp float;attribute vec3 aPos;attribute float aSize;attribute vec3 aColor;attribute float aOpacity;uniform mat4 uMVP;uniform float uScale;uniform float uSplatAlpha;varying vec3 vColor;varying float vOpacity;void main(){vec4 clip=uMVP*vec4(aPos,1.0);vColor=aColor;vOpacity=aOpacity*uSplatAlpha;float sz=aSize*uScale*(700.0/max(0.1,clip.w));gl_PointSize=clamp(sz,1.0,120.0);gl_Position=clip;}`;
  const SPLAT_FRAG=`precision highp float;varying vec3 vColor;varying float vOpacity;void main(){vec2 uv=gl_PointCoord-0.5;float r2=dot(uv,uv);float a=exp(-r2/0.05)*vOpacity;if(a<0.004)discard;gl_FragColor=vec4(pow(max(vColor,0.0),vec3(1.0/2.2)),a);}`;

  const MESH_VERT=`precision highp float;attribute vec3 aPos;attribute vec3 aNorm;attribute vec3 aCol;uniform mat4 uMVP;uniform mat4 uMV;uniform mat3 uNormMat;varying vec3 vCol;varying vec3 vN;varying vec3 vVP;void main(){vec4 vp=uMV*vec4(aPos,1.0);vVP=vp.xyz;vN=normalize(uNormMat*aNorm);vCol=aCol;gl_Position=uMVP*vec4(aPos,1.0);}`;
  const MESH_FRAG=`precision highp float;varying vec3 vCol;varying vec3 vN;varying vec3 vVP;uniform float uAlpha;uniform float uWire;void main(){vec3 N=normalize(vN),V=normalize(-vVP);vec3 L1=normalize(vec3(0.5,1.0,0.7)),L2=normalize(vec3(-0.4,-0.6,-0.5)),H1=normalize(L1+V);float d1=max(dot(N,L1),0.0)*0.60,d2=max(dot(N,L2),0.0)*0.18,amb=0.28,sp=pow(max(dot(N,H1),0.0),64.0)*0.22;vec3 col=vCol*(d1+d2+amb)+vec3(sp);col=pow(max(col,0.0),vec3(1.0/2.2));if(uWire>0.5)col=mix(col,vec3(0.6,1.0,0.2),0.45);gl_FragColor=vec4(col,uAlpha);}`;

  // ── GL HELPERS ────────────────────────────────────────────────────────────

  function _compile(gl,type,src){const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error('Shader: '+gl.getShaderInfoLog(s));return s;}
  function _link(gl,vs,fs){const p=gl.createProgram();gl.attachShader(p,_compile(gl,gl.VERTEX_SHADER,vs));gl.attachShader(p,_compile(gl,gl.FRAGMENT_SHADER,fs));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error('Link: '+gl.getProgramInfoLog(p));return p;}

  // ── RENDERER ──────────────────────────────────────────────────────────────

  class FumocRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      const opts  = { antialias:true, alpha:true, premultipliedAlpha:false };
      this.gl     = canvas.getContext('webgl',opts)||canvas.getContext('experimental-webgl',opts);
      if (!this.gl) throw new Error('WebGL not supported');

      this.splatProg = _link(this.gl, SPLAT_VERT, SPLAT_FRAG);
      this.meshProg  = _link(this.gl, MESH_VERT,  MESH_FRAG);
      this._initSplatAttribs();
      this._initMeshAttribs();

      this.N=0; this.meshData=null; this.meshLoaded=false;
      this.wireframe=false; this.viewMode='auto';
      this.blendFar=1; this.blendNear=0.15;

      // Camera
      this.eye=[0,0,5]; this.target=[0,0,0]; this.up=[0,1,0];
      this.fov=Math.PI/3; this._theta=Math.PI/4; this._phi=Math.PI/4; this._radius=5;

      // Momentum
      this._vTheta=0; this._vPhi=0; this._vZoom=0;

      // Drift
      this._driftTime=0; this._driftSpeed=0.00015; this._lastActive=0; this._driftDelay=3000;

      // Input
      this._dragging=false; this._lastX=0; this._lastY=0; this._lastT=0;
      this._pinchDist=0; this._pinchMidX=0; this._pinchMidY=0; this._lossCount=0;

      // Sort
      this._sortWorker=null; this._sortPending=false;
      this._lastSortEye=[Infinity,Infinity,Infinity]; this._sortThreshold=0.02;

      this._raf=null;
      this._bindEvents();
      this._loop();
    }

    _initSplatAttribs(){
      const gl=this.gl,p=this.splatProg;
      this.s_aPos    =gl.getAttribLocation(p,'aPos');
      this.s_aSize   =gl.getAttribLocation(p,'aSize');
      this.s_aColor  =gl.getAttribLocation(p,'aColor');
      this.s_aOpacity=gl.getAttribLocation(p,'aOpacity');
      this.s_uMVP    =gl.getUniformLocation(p,'uMVP');
      this.s_uScale  =gl.getUniformLocation(p,'uScale');
      this.s_uAlpha  =gl.getUniformLocation(p,'uSplatAlpha');
      this.sBufPos   =gl.createBuffer(); this.sBufSize=gl.createBuffer();
      this.sBufCol   =gl.createBuffer(); this.sBufOp  =gl.createBuffer();
    }

    _initMeshAttribs(){
      const gl=this.gl,p=this.meshProg;
      this.m_aPos  =gl.getAttribLocation(p,'aPos');
      this.m_aNorm =gl.getAttribLocation(p,'aNorm');
      this.m_aCol  =gl.getAttribLocation(p,'aCol');
      this.m_uMVP  =gl.getUniformLocation(p,'uMVP');
      this.m_uMV   =gl.getUniformLocation(p,'uMV');
      this.m_uNorm =gl.getUniformLocation(p,'uNormMat');
      this.m_uAlpha=gl.getUniformLocation(p,'uAlpha');
      this.m_uWire =gl.getUniformLocation(p,'uWire');
      this.mBufPos =gl.createBuffer(); this.mBufNorm=gl.createBuffer(); this.mBufCol=gl.createBuffer();
    }

    loadSplat(splatBin, N) {
      const gl=this.gl,dv=new DataView(splatBin.buffer,splatBin.byteOffset);
      const pos=new Float32Array(N*3),sz=new Float32Array(N),col=new Float32Array(N*3),op=new Float32Array(N);
      for(let i=0;i<N;i++){
        const b=i*SPLAT_ROW;
        pos[i*3]=dv.getFloat32(b,true);pos[i*3+1]=dv.getFloat32(b+4,true);pos[i*3+2]=dv.getFloat32(b+8,true);
        sz[i]=(Math.exp(dv.getFloat32(b+12,true))+Math.exp(dv.getFloat32(b+16,true))+Math.exp(dv.getFloat32(b+20,true)))/3;
        col[i*3]=splatBin[b+24]/255;col[i*3+1]=splatBin[b+25]/255;col[i*3+2]=splatBin[b+26]/255;
        op[i]=splatBin[b+27]/255;
      }
      this.N=N; this._rawPos=pos; this._rawSizes=sz; this._rawColors=col; this._rawOpacity=op;
      this._sortedIdx=new Uint32Array(N); for(let i=0;i<N;i++)this._sortedIdx[i]=i;
      this._rebuildSortedBuffers();
      this._fitCamera();
      this._requestSort();
    }

    _rebuildSortedBuffers(){
      const gl=this.gl,N=this.N,idx=this._sortedIdx;
      const pos=new Float32Array(N*3),sz=new Float32Array(N),col=new Float32Array(N*3),op=new Float32Array(N);
      for(let i=0;i<N;i++){
        const s=idx[i];
        pos[i*3]=this._rawPos[s*3];pos[i*3+1]=this._rawPos[s*3+1];pos[i*3+2]=this._rawPos[s*3+2];
        sz[i]=this._rawSizes[s];
        col[i*3]=this._rawColors[s*3];col[i*3+1]=this._rawColors[s*3+1];col[i*3+2]=this._rawColors[s*3+2];
        op[i]=this._rawOpacity[s];
      }
      const up=(buf,d)=>{gl.bindBuffer(gl.ARRAY_BUFFER,buf);gl.bufferData(gl.ARRAY_BUFFER,d,gl.DYNAMIC_DRAW);};
      up(this.sBufPos,pos);up(this.sBufSize,sz);up(this.sBufCol,col);up(this.sBufOp,op);
    }

    _requestSort(){
      if(!this.N||!this._rawPos)return;
      if(_len2(this.eye,this._lastSortEye)<this._radius*this._sortThreshold)return;
      if(this._sortPending)return;
      this._sortPending=true; this._lastSortEye=[...this.eye];
      if(!this._sortWorker)this._sortWorker=new Worker(URL.createObjectURL(new Blob([_SORT_SRC],{type:'application/javascript'})));
      const copy=new Float32Array(this._rawPos);
      this._sortWorker.onmessage=e=>{this._sortedIdx=e.data.indices;this._sortPending=false;this._rebuildSortedBuffers();};
      this._sortWorker.postMessage({positions:copy,eye:[...this.eye],N:this.N},[copy.buffer]);
    }

    loadMesh(meshData){
      const gl=this.gl;
      this.meshData=meshData; this.meshLoaded=true;
      const up=(buf,d)=>{gl.bindBuffer(gl.ARRAY_BUFFER,buf);gl.bufferData(gl.ARRAY_BUFFER,d,gl.STATIC_DRAW);};
      up(this.mBufPos,meshData.positions);up(this.mBufNorm,meshData.normals);up(this.mBufCol,meshData.colors);
    }

    exportSTL(name){if(this.meshData)_exportSTL(this.meshData,name);}

    _fitCamera(){
      if(!this._rawPos)return;
      let xMin=Infinity,yMin=Infinity,zMin=Infinity,xMax=-Infinity,yMax=-Infinity,zMax=-Infinity;
      const stride=Math.max(1,Math.floor(this.N/5000));
      for(let i=0;i<this.N;i+=stride){const b=i*3,x=this._rawPos[b],y=this._rawPos[b+1],z=this._rawPos[b+2];if(!isFinite(x))continue;if(x<xMin)xMin=x;if(x>xMax)xMax=x;if(y<yMin)yMin=y;if(y>yMax)yMax=y;if(z<zMin)zMin=z;if(z>zMax)zMax=z;}
      const size=Math.max(xMax-xMin,yMax-yMin,zMax-zMin)||5;
      this._radius=size*1.6; this.target=[(xMin+xMax)/2,(yMin+yMax)/2,(zMin+zMax)/2];
      this.blendFar=size*0.5; this.blendNear=size*0.05;
      this._updateEye();
    }

    _updateEye(){
      const r=this._radius;
      this.eye=[this.target[0]+r*Math.sin(this._phi)*Math.sin(this._theta),this.target[1]+r*Math.cos(this._phi),this.target[2]+r*Math.sin(this._phi)*Math.cos(this._theta)];
      this._requestSort();
    }

    _blendFactor(){
      if(this.viewMode==='splat')return 0;
      if(this.viewMode==='mesh')return 1;
      if(!this.meshLoaded)return 0;
      if(this.viewMode==='hybrid')return 0.5;
      const d=_len(_sub(this.eye,this.target));
      if(d>=this.blendFar)return 0; if(d<=this.blendNear)return 1;
      return 1-(d-this.blendNear)/(this.blendFar-this.blendNear);
    }

    _markActive(){this._lastActive=performance.now();}

    _bindEvents(){
      const c=this.canvas;
      c.addEventListener('mousedown',e=>{this._dragging=true;this._lastX=e.clientX;this._lastY=e.clientY;this._lastT=performance.now();this._vTheta=0;this._vPhi=0;this._markActive();});
      c.addEventListener('mouseup',()=>this._dragging=false);
      c.addEventListener('mouseleave',()=>this._dragging=false);
      c.addEventListener('mousemove',e=>{
        if(!this._dragging)return;
        const now=performance.now(),dt=Math.max(1,now-this._lastT);
        const dx=e.clientX-this._lastX,dy=e.clientY-this._lastY;
        this._vTheta=-dx*0.007/dt*16; this._vPhi=dy*0.007/dt*16;
        this._theta+=-dx*0.007; this._phi=Math.max(0.05,Math.min(Math.PI-0.05,this._phi+dy*0.007));
        this._lastX=e.clientX;this._lastY=e.clientY;this._lastT=now;
        this._updateEye();this._markActive();
      });
      c.addEventListener('wheel',e=>{e.preventDefault();this._vZoom=e.deltaY*0.001;this._radius=Math.max(0.01,this._radius*(1+e.deltaY*0.001));this._updateEye();this._markActive();},{passive:false});

      c.addEventListener('touchstart',e=>{
        if(e.touches.length===1){this._dragging=true;this._lastX=e.touches[0].clientX;this._lastY=e.touches[0].clientY;this._lastT=performance.now();this._vTheta=0;this._vPhi=0;}
        if(e.touches.length===2){const t0=e.touches[0],t1=e.touches[1];this._pinchDist=_len([t0.clientX-t1.clientX,t0.clientY-t1.clientY,0]);this._pinchMidX=(t0.clientX+t1.clientX)*.5;this._pinchMidY=(t0.clientY+t1.clientY)*.5;}
        this._markActive();
      });
      c.addEventListener('touchend',e=>{if(e.touches.length===0)this._dragging=false;});
      c.addEventListener('touchmove',e=>{
        e.preventDefault();
        if(e.touches.length===1&&this._dragging){
          const now=performance.now(),dt=Math.max(1,now-this._lastT);
          const dx=e.touches[0].clientX-this._lastX,dy=e.touches[0].clientY-this._lastY;
          this._vTheta=-dx*0.007/dt*16;this._vPhi=dy*0.007/dt*16;
          this._theta+=-dx*0.007;this._phi=Math.max(0.05,Math.min(Math.PI-0.05,this._phi+dy*0.007));
          this._lastX=e.touches[0].clientX;this._lastY=e.touches[0].clientY;this._lastT=now;
          this._updateEye();this._markActive();
        }
        if(e.touches.length===2){
          const t0=e.touches[0],t1=e.touches[1];
          const d=_len([t0.clientX-t1.clientX,t0.clientY-t1.clientY,0]);
          this._radius=Math.max(0.01,this._radius*(this._pinchDist/(d||1)));
          this._pinchDist=d;
          const midX=(t0.clientX+t1.clientX)*.5,midY=(t0.clientY+t1.clientY)*.5;
          const pmx=midX-this._pinchMidX,pmy=midY-this._pinchMidY;
          this._pinchMidX=midX;this._pinchMidY=midY;
          const ps=this._radius*0.002;
          const fx=this.target[0]-this.eye[0],fy=this.target[1]-this.eye[1],fz=this.target[2]-this.eye[2];
          const fl=Math.sqrt(fx*fx+fy*fy+fz*fz)||1,fxn=fx/fl,fyn=fy/fl,fzn=fz/fl;
          let rx=fyn*this.up[2]-fzn*this.up[1],ry=fzn*this.up[0]-fxn*this.up[2],rz=fxn*this.up[1]-fyn*this.up[0];
          const rl=Math.sqrt(rx*rx+ry*ry+rz*rz)||1;rx/=rl;ry/=rl;rz/=rl;
          const ucx=ry*fzn-rz*fyn,ucy=rz*fxn-rx*fzn,ucz=rx*fyn-ry*fxn;
          this.target[0]-=rx*pmx*ps-ucx*pmy*ps;this.target[1]-=ry*pmx*ps-ucy*pmy*ps;this.target[2]-=rz*pmx*ps-ucz*pmy*ps;
          this._updateEye();this._markActive();
        }
      },{passive:false});

      // Tap → surface raycast
      c.addEventListener('click',e=>{
        if(!this.meshLoaded)return;
        const rect=c.getBoundingClientRect();
        const nx=((e.clientX-rect.left)/rect.width)*2-1;
        const ny=-((e.clientY-rect.top)/rect.height)*2+1;
        const hit=this._raycast(nx,ny);
        if(hit)c.dispatchEvent(new CustomEvent('fumoc:tap',{bubbles:true,detail:{x:e.clientX,y:e.clientY,worldHit:hit}}));
      });

      // Gyro tilt — subtle parallax
      if(typeof DeviceOrientationEvent!=='undefined'){
        c.addEventListener('touchstart',()=>{if(typeof DeviceOrientationEvent.requestPermission==='function')DeviceOrientationEvent.requestPermission().catch(()=>{});},{once:true});
        window.addEventListener('deviceorientation',e=>{
          if(this._dragging)return;
          this._theta+=(e.gamma||0)*0.00015;
          this._phi=Math.max(0.05,Math.min(Math.PI-0.05,this._phi+(e.beta||0)*0.00010));
          this._updateEye();
        },{passive:true});
      }

      c.addEventListener('webglcontextlost',e=>{e.preventDefault();this._lossCount++;if(this._lossCount>=3){cancelAnimationFrame(this._raf);this._raf=null;}});
      c.addEventListener('webglcontextrestored',()=>{if(this._lossCount<3){this.splatProg=_link(this.gl,SPLAT_VERT,SPLAT_FRAG);this.meshProg=_link(this.gl,MESH_VERT,MESH_FRAG);this._initSplatAttribs();this._initMeshAttribs();this._loop();}});
    }

    _raycast(ndcX,ndcY){
      const W=this.canvas.width,H=this.canvas.height;
      const inv=_mat4Inv(_mul(_perspective(this.fov,W/H,0.01,2000),_lookAt(this.eye,this.target,this.up)));
      if(!inv)return null;
      const n4=_mv4(inv,[ndcX,ndcY,-1,1]),f4=_mv4(inv,[ndcX,ndcY,1,1]);
      const ro=[n4[0]/n4[3],n4[1]/n4[3],n4[2]/n4[3]];
      const rd=_norm(_sub([f4[0]/f4[3],f4[1]/f4[3],f4[2]/f4[3]],ro));
      const P=this.meshData.positions;
      let bestT=Infinity,bestHit=null;
      for(let f=0;f<this.meshData.count/3;f++){
        const b=f*9;
        const t=_rayTri(ro,rd,[P[b],P[b+1],P[b+2]],[P[b+3],P[b+4],P[b+5]],[P[b+6],P[b+7],P[b+8]]);
        if(t!==null&&t<bestT){bestT=t;bestHit=[ro[0]+rd[0]*t,ro[1]+rd[1]*t,ro[2]+rd[2]*t];}
      }
      return bestHit;
    }

    _loop(){
      let last=performance.now();
      const draw=now=>{this._raf=requestAnimationFrame(draw);const dt=Math.min(now-last,50);last=now;this._physics(dt);this._draw();};
      requestAnimationFrame(draw);
    }

    _physics(dt){
      if(this._dragging)return;
      const idle=performance.now()-this._lastActive;
      const decay=Math.pow(0.88,dt/16);
      this._vTheta*=decay;this._vPhi*=decay;this._vZoom*=decay;
      let moved=false;
      if(Math.abs(this._vTheta)>1e-5){this._theta+=this._vTheta*dt/16;moved=true;}
      if(Math.abs(this._vPhi)>1e-5){this._phi=Math.max(0.05,Math.min(Math.PI-0.05,this._phi+this._vPhi*dt/16));moved=true;}
      if(Math.abs(this._vZoom)>1e-5){this._radius=Math.max(0.01,this._radius*(1+this._vZoom*dt/16));moved=true;}
      if(idle>this._driftDelay&&this.N>0){
        this._driftTime+=dt;
        const da=this._driftSpeed*dt;
        this._theta+=Math.sin(this._driftTime*0.0004)*da;
        this._phi=Math.max(0.05,Math.min(Math.PI-0.05,this._phi+Math.cos(this._driftTime*0.00025)*da*0.4));
        moved=true;
      }
      if(moved)this._updateEye();
    }

    _draw(){
      const gl=this.gl,c=this.canvas;
      const W=c.clientWidth*devicePixelRatio|0,H=c.clientHeight*devicePixelRatio|0;
      if(c.width!==W||c.height!==H){c.width=W;c.height=H;}
      gl.viewport(0,0,W,H);
      gl.clearColor(0.02,0.03,0.05,1);
      gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
      if(!this.N)return;

      const proj=_perspective(this.fov,W/H,0.01,2000);
      const view=_lookAt(this.eye,this.target,this.up);
      const mvp=_mul(proj,view);
      const _b=(buf,attr,sz)=>{gl.bindBuffer(gl.ARRAY_BUFFER,buf);gl.enableVertexAttribArray(attr);gl.vertexAttribPointer(attr,sz,gl.FLOAT,false,0,0);};

      const blend=this._blendFactor();
      const splatAlpha=this.meshLoaded?Math.max(0.3,1-blend*0.7):1;
      const meshAlpha =this.meshLoaded?blend*0.85:0;

      if(this.meshLoaded){
        // Pass 1: Depth pre-pass (mesh writes depth, no colour)
        gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LESS);gl.depthMask(true);gl.colorMask(false,false,false,false);
        gl.useProgram(this.meshProg);
        gl.uniformMatrix4fv(this.m_uMVP,false,mvp);gl.uniformMatrix4fv(this.m_uMV,false,view);gl.uniformMatrix3fv(this.m_uNorm,false,_normMat(view));
        gl.uniform1f(this.m_uAlpha,1);gl.uniform1f(this.m_uWire,0);
        _b(this.mBufPos,this.m_aPos,3);_b(this.mBufNorm,this.m_aNorm,3);_b(this.mBufCol,this.m_aCol,3);
        gl.drawArrays(gl.TRIANGLES,0,this.meshData.count);
        gl.colorMask(true,true,true,true);

        // Pass 2: Splats depth-tested against mesh — Porter-Duff over
        gl.depthMask(false);gl.depthFunc(gl.LEQUAL);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(this.splatProg);
        gl.uniformMatrix4fv(this.s_uMVP,false,mvp);gl.uniform1f(this.s_uScale,1);gl.uniform1f(this.s_uAlpha,splatAlpha);
        _b(this.sBufPos,this.s_aPos,3);_b(this.sBufSize,this.s_aSize,1);_b(this.sBufCol,this.s_aColor,3);_b(this.sBufOp,this.s_aOpacity,1);
        gl.drawArrays(gl.POINTS,0,this.N);

        // Pass 3: Mesh surface Phong overlay
        gl.depthMask(true);gl.depthFunc(gl.LEQUAL);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(this.meshProg);
        gl.uniform1f(this.m_uAlpha,this.wireframe?0.65:meshAlpha);gl.uniform1f(this.m_uWire,this.wireframe?1:0);
        _b(this.mBufPos,this.m_aPos,3);_b(this.mBufNorm,this.m_aNorm,3);_b(this.mBufCol,this.m_aCol,3);
        gl.drawArrays(gl.TRIANGLES,0,this.meshData.count);

        gl.disable(gl.DEPTH_TEST);gl.disable(gl.BLEND);gl.depthFunc(gl.LESS);
      } else {
        // Splat only — Porter-Duff over, back-to-front
        gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.depthMask(false);
        gl.useProgram(this.splatProg);
        gl.uniformMatrix4fv(this.s_uMVP,false,mvp);gl.uniform1f(this.s_uScale,1);gl.uniform1f(this.s_uAlpha,1);
        _b(this.sBufPos,this.s_aPos,3);_b(this.sBufSize,this.s_aSize,1);_b(this.sBufCol,this.s_aColor,3);_b(this.sBufOp,this.s_aOpacity,1);
        gl.drawArrays(gl.POINTS,0,this.N);
        gl.depthMask(true);gl.disable(gl.BLEND);
      }
    }

    destroy(){
      if(this._raf)cancelAnimationFrame(this._raf);
      if(this._sortWorker){this._sortWorker.terminate();this._sortWorker=null;}
      const gl=this.gl;
      [this.sBufPos,this.sBufSize,this.sBufCol,this.sBufOp,this.mBufPos,this.mBufNorm,this.mBufCol]
        .forEach(b=>{try{gl.deleteBuffer(b);}catch(_){}});
      try{gl.deleteProgram(this.splatProg);}catch(_){}
      try{gl.deleteProgram(this.meshProg);}catch(_){}
    }
  }

  // ── PLAYER INSTANCE ───────────────────────────────────────────────────────

  class FumocPlayerInstance {
    constructor(container, opts={}) {
      this.container=typeof container==='string'?document.querySelector(container):container;
      if(!this.container)throw new Error('fumoc-player: container not found');
      this.opts=opts; this._renderer=null;
      this._build();
      if(opts.src)this.load(opts.src);
    }

    _build(){
      const el=this.container;
      Object.assign(el.style,{position:'relative',background:'#030508',overflow:'hidden'});
      this._canvas=document.createElement('canvas');
      Object.assign(this._canvas.style,{width:'100%',height:'100%',display:'block',touchAction:'none'});
      el.appendChild(this._canvas);

      this._overlay=document.createElement('div');
      Object.assign(this._overlay.style,{position:'absolute',inset:'0',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',color:'#fff',fontFamily:'system-ui,sans-serif',pointerEvents:'none',background:'rgba(3,5,8,0.92)',transition:'opacity .5s'});
      el.appendChild(this._overlay);

      this._controls=document.createElement('div');
      Object.assign(this._controls.style,{position:'absolute',bottom:'14px',left:'50%',transform:'translateX(-50%)',display:'none',gap:'6px',flexDirection:'row',alignItems:'center',background:'rgba(3,5,8,0.72)',border:'1px solid rgba(255,255,255,0.08)',borderRadius:'99px',padding:'5px 10px',backdropFilter:'blur(10px)'});
      el.appendChild(this._controls);

      const badge=document.createElement('div');
      Object.assign(badge.style,{position:'absolute',bottom:'14px',right:'14px',fontSize:'10px',color:'rgba(200,255,0,0.4)',fontFamily:'monospace',pointerEvents:'none',letterSpacing:'.1em'});
      badge.textContent='.fumoc';
      el.appendChild(badge);

      this._setStatus('Set src or drop a .fumoc file',null);
    }

    _buildControls(hasMesh,title){
      const ctrl=this._controls;
      ctrl.innerHTML='';ctrl.style.display='flex';
      const mkBtn=(label,active,cb)=>{
        const b=document.createElement('button');
        b.textContent=label;
        Object.assign(b.style,{background:active?'rgba(200,255,0,.15)':'transparent',border:active?'1px solid rgba(200,255,0,.4)':'1px solid transparent',borderRadius:'99px',color:active?'#c8ff00':'rgba(255,255,255,.5)',fontSize:'11px',padding:'3px 11px',cursor:'pointer',fontFamily:'inherit',transition:'all .15s'});
        b.addEventListener('click',()=>{ctrl.querySelectorAll('button').forEach(x=>{x.style.background='transparent';x.style.border='1px solid transparent';x.style.color='rgba(255,255,255,.5)';});b.style.background='rgba(200,255,0,.15)';b.style.border='1px solid rgba(200,255,0,.4)';b.style.color='#c8ff00';cb();});
        return b;
      };
      if(hasMesh){
        ctrl.appendChild(mkBtn('Auto',true,()=>{this._renderer.viewMode='auto';}));
        ctrl.appendChild(mkBtn('Splat',false,()=>{this._renderer.viewMode='splat';}));
        ctrl.appendChild(mkBtn('Mesh',false,()=>{this._renderer.viewMode='mesh';}));
        const wire=document.createElement('button');
        wire.textContent='⌗';wire.title='Wireframe';
        Object.assign(wire.style,{background:'transparent',border:'1px solid transparent',borderRadius:'99px',color:'rgba(255,255,255,.3)',fontSize:'14px',padding:'2px 8px',cursor:'pointer'});
        wire.addEventListener('click',()=>{if(!this._renderer)return;this._renderer.wireframe=!this._renderer.wireframe;wire.style.color=this._renderer.wireframe?'#c8ff00':'rgba(255,255,255,.3)';});
        ctrl.appendChild(wire);
        const stl=document.createElement('button');
        stl.textContent='⬇ STL';
        Object.assign(stl.style,{background:'rgba(255,255,255,.05)',border:'1px solid rgba(255,255,255,.08)',borderRadius:'99px',color:'rgba(255,255,255,.4)',fontSize:'11px',padding:'3px 10px',cursor:'pointer'});
        stl.addEventListener('click',()=>this._renderer?.exportSTL(title||'fumoca-mesh'));
        ctrl.appendChild(stl);
      } else {
        ctrl.appendChild(mkBtn('Splat',true,()=>{}));
      }
    }

    _setStatus(msg,pct){
      this._overlay.style.opacity='1';
      this._overlay.innerHTML=`<div style="font-size:13px;color:rgba(255,255,255,.45);text-align:center;padding:24px;max-width:260px;line-height:1.5">${msg}</div>${pct!=null?`<div style="width:160px;height:3px;background:rgba(255,255,255,.07);border-radius:99px;margin-top:14px;overflow:hidden"><div style="height:100%;width:${pct}%;background:#c8ff00;transition:width .3s ease;border-radius:99px"></div></div>`:''}`;
    }

    _hideOverlay(){this._overlay.style.opacity='0';this._overlay.style.pointerEvents='none';}

    async load(src){
      this._setStatus('Loading…',2);
      this.container.dispatchEvent(new CustomEvent('fumoc:progress',{bubbles:true,detail:{pct:2,label:'Loading…'}}));
      try{
        let buffer;
        if(src instanceof ArrayBuffer)buffer=src;
        else if(src instanceof File||src instanceof Blob)buffer=await src.arrayBuffer();
        else{const r=await fetch(src);if(!r.ok)throw new Error('HTTP '+r.status);buffer=await r.arrayBuffer();}

        const result = _isNifBuffer(buffer)
          ? decodeNif(buffer)
          : await decodeFumoc(buffer,(pct,label)=>{
              this._setStatus(label,pct);
              this.container.dispatchEvent(new CustomEvent('fumoc:progress',{bubbles:true,detail:{pct,label}}));
            });

        if(this._renderer)this._renderer.destroy();
        this._renderer=new FumocRenderer(this._canvas);

        // Bubble tap events from canvas to container
        this._canvas.addEventListener('fumoc:tap',e=>this.container.dispatchEvent(new CustomEvent('fumoc:tap',{bubbles:true,detail:e.detail})));

        this._renderer.loadSplat(result.splatBinary,result.N);

        let hasMesh=false;
        if(result.meshSection){
          this._setStatus('Decoding mesh…',92);
          try{
            const meta=result.meshMeta||{};
            const meshData=(meta.format==='obj_deflate'||meta.format==='obj')
              ?_parseOBJ(new TextDecoder().decode(result.meshSection))
              :await _decodeDraco(result.meshSection);
            this._renderer.loadMesh(meshData);
            window._fumocaRendererMeshData=meshData;
            hasMesh=true;
          }catch(e){console.warn('[fumoc-player] Mesh decode failed:',e);}
        }

        // Expose renderer for platform tools (export UI, social recorder, etc.)
        window._fumocaRenderer=this._renderer;

        this._hideOverlay();
        this._buildControls(hasMesh,result.header?.title);

        this.container.dispatchEvent(new CustomEvent('fumoc:ready',{bubbles:true,detail:{
          N:result.N, header:result.header, hasMesh,
          tour:result.tour, hotspots:result.hotspots,
          motion:result.motion, cameras:result.cameras, branding:result.branding,
          thumbnail:result.thumbnail,
          exportSTL:hasMesh?fn=>this._renderer.exportSTL(fn):null,
          setViewMode:m=>{if(this._renderer)this._renderer.viewMode=m;},
        }}));

      }catch(err){
        this._setStatus('⚠ '+err.message,null);
        this.container.dispatchEvent(new CustomEvent('fumoc:error',{bubbles:true,detail:{message:err.message}}));
        console.error('[fumoc-player]',err);
      }
    }

    setViewMode(m){if(this._renderer)this._renderer.viewMode=m;}
    setWireframe(on){if(this._renderer)this._renderer.wireframe=on;}
    exportSTL(name){this._renderer?.exportSTL(name);}
    destroy(){if(this._renderer)this._renderer.destroy();this.container.innerHTML='';}
  }

  // ── CUSTOM ELEMENT ────────────────────────────────────────────────────────

  if(typeof customElements!=='undefined'&&!customElements.get('fumoc-player')){
    class FumocPlayerElement extends HTMLElement{
      connectedCallback(){this._p=new FumocPlayerInstance(this,{src:this.getAttribute('src')||''});}
      disconnectedCallback(){this._p?.destroy();}
      static get observedAttributes(){return['src'];}
      attributeChangedCallback(n,_,v){if(n==='src'&&v&&this._p)this._p.load(v);}
    }
    customElements.define('fumoc-player',FumocPlayerElement);
  }

  // ── PUBLIC API ────────────────────────────────────────────────────────────

  const FumocPlayer={version:VERSION,mount:(c,o)=>new FumocPlayerInstance(c,o),decode:decodeFumoc};
  global.FumocPlayer=FumocPlayer;
  if(typeof module!=='undefined'&&module.exports)module.exports=FumocPlayer;

})(typeof globalThis!=='undefined'?globalThis:typeof window!=='undefined'?window:this);
