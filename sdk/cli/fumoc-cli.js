#!/usr/bin/env node
/**
 * fumoc CLI — convert .ply/.splat to .fumoc from the command line
 *
 * Install:  npm i -g fumoc   (coming soon)
 * Or run:   npx fumoc convert scene.ply
 *           npx fumoc convert scene.splat --mesh-tris 4096 --title "My Scene"
 *           npx fumoc info scene.fumoc
 *           npx fumoc upload scene.fumoc
 */
'use strict';

const fs    = require('fs');
const path  = require('path');
const https = require('https');
const zlib  = require('zlib');

const VERSION = '1.0.0';
const FUMOCA_CONVERT_URL = 'https://fumoca.pages.dev/convert';

// ── CLI argument parser ───────────────────────────────────────────────────────
const args    = process.argv.slice(2);
const cmd     = args[0];
const posArgs = args.filter(a => !a.startsWith('--'));
const flags   = {};
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) {
    const key = args[i].slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    flags[key] = args[i+1] && !args[i+1].startsWith('--') ? args[++i] : true;
  }
}

function usage() {
  console.log(`
fumoc CLI v${VERSION} — The .fumoc format converter

Usage:
  fumoc convert <file.ply|file.splat>  [options]
  fumoc info    <file.fumoc>
  fumoc upload  <file.fumoc>           [options]

Commands:
  convert   Convert a .ply or .splat file to .fumoc format
  info      Print metadata from a .fumoc file header
  upload    Upload a .fumoc file to FUMOCA and get a shareable link

Convert options:
  --out <path>          Output path (default: same name, .fumoc extension)
  --title <name>        Scene title (default: filename)
  --mesh-tris <n>       Target mesh triangles: 4096 | 8192 | 20000 (default: 8192)
  --no-mesh             Skip mesh reconstruction (splat-only output)
  --sort                Pre-compute depth sort index (default: true)

Upload options:
  --token <jwt>         Supabase auth token (or set FUMOCA_TOKEN env var)

Examples:
  fumoc convert scene.ply
  fumoc convert luma_export.splat --title "My Room" --mesh-tris 4096
  fumoc convert scan.ply --out compressed/scene.fumoc
  fumoc info scene.fumoc
  fumoc upload scene.fumoc --token eyJ...
`);
  process.exit(0);
}

// ── Main dispatch ─────────────────────────────────────────────────────────────
if (!cmd || cmd === '--help' || cmd === '-h') usage();

switch (cmd) {
  case 'convert': cmdConvert(); break;
  case 'info':    cmdInfo();    break;
  case 'upload':  cmdUpload();  break;
  default:
    console.error(`Unknown command: ${cmd}`);
    usage();
}

// ── convert ───────────────────────────────────────────────────────────────────
async function cmdConvert() {
  const inFile = posArgs[1];
  if (!inFile) { console.error('Usage: fumoc convert <file.ply|file.splat>'); process.exit(1); }
  if (!fs.existsSync(inFile)) { console.error(`File not found: ${inFile}`); process.exit(1); }

  const ext     = path.extname(inFile).toLowerCase();
  const outFile = flags.out || inFile.replace(/\.(ply|splat)$/i, '.fumoc');
  const title   = flags.title || path.basename(inFile, ext);
  const meshTris= parseInt(flags.meshTris || 8192);
  const noMesh  = flags.noMesh === true || flags.noMesh === 'true';

  console.log(`\n╔══════════════════════════════════════════╗`);
  console.log(`║  fumoc convert                           ║`);
  console.log(`╚══════════════════════════════════════════╝`);
  console.log(`  Input:  ${inFile} (${(fs.statSync(inFile).size/1048576).toFixed(1)} MB)`);
  console.log(`  Output: ${outFile}`);
  console.log(`  Title:  ${title}`);
  console.log(`  Mesh:   ${noMesh ? 'disabled' : meshTris + ' triangles'}`);
  console.log('');

  // Check if Python encoder is available (preferred — full Poisson mesh)
  const hasPython = await _checkPython();

  if (hasPython) {
    await _convertViaPython(inFile, outFile, title, meshTris, noMesh);
  } else {
    // JS fallback — splat-only encode (no mesh reconstruction without Python/open3d)
    console.log('ℹ Python not found — encoding splat-only (no mesh). Install Python + open3d for full mesh support.');
    await _convertJS(inFile, outFile, title);
  }
}

function _checkPython() {
  return new Promise(resolve => {
    const { exec } = require('child_process');
    exec('python3 -c "import open3d" 2>&1', (err) => resolve(!err));
  });
}

function _convertViaPython(inFile, outFile, title, meshTris, noMesh) {
  return new Promise((resolve, reject) => {
    const { spawn } = require('child_process');
    const script = `
import sys
sys.path.insert(0, '${path.dirname(__filename)}/..')
from fumoc_encoder import encode_ply_to_fumoc
from pathlib import Path
encode_ply_to_fumoc(
    ply_path         = Path(${JSON.stringify(inFile)}),
    out_path         = Path(${JSON.stringify(outFile)}),
    title            = ${JSON.stringify(title)},
    build_mesh       = ${noMesh ? 'False' : 'True'},
    mesh_target_tris = ${meshTris},
    precompute_sort  = True,
)
`;
    const py = spawn('python3', ['-c', script], { stdio: 'inherit' });
    py.on('exit', code => {
      if (code === 0) {
        const sizeMB = (fs.statSync(outFile).size / 1048576).toFixed(2);
        console.log(`\n✓ Done: ${outFile} (${sizeMB} MB)`);
        console.log(`  View: fumoca.pages.dev/open?url=<hosted-url>`);
        console.log(`  Or open it locally with: fumoc upload ${outFile}\n`);
        resolve();
      } else {
        reject(new Error(`Python encoder exited with code ${code}`));
      }
    });
  });
}

async function _convertJS(inFile, outFile, title) {
  // Pure JS splat-only encoder (subset of fumoc-player.js decode logic, inverted)
  const raw   = fs.readFileSync(inFile);
  const bytes = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);

  let gaussians;
  const ext = path.extname(inFile).toLowerCase();

  if (ext === '.splat') {
    gaussians = _parseSplatBinary(bytes);
  } else if (ext === '.ply') {
    gaussians = _parsePLY(bytes);
  } else {
    console.error('Unsupported format: ' + ext);
    process.exit(1);
  }

  const N = gaussians.N;
  console.log(`  Parsed: ${N.toLocaleString()} Gaussians`);

  process.stdout.write('  Encoding channels (ANS)… ');
  const spltPayload = _encodeSplt(gaussians);
  console.log('done');

  const header = {
    fumoc: 3, title, N,
    has_mesh: false, has_audio: false, has_video: false,
    created: new Date().toISOString(),
    app: 'fumoc-cli/' + VERSION,
  };
  const headerJson = Buffer.from(JSON.stringify(header));
  const magic      = Buffer.from('FUMOC3');
  const version    = Buffer.from([0, 0]);
  const fileFlags  = Buffer.alloc(2); fileFlags.writeUInt16LE(0);
  const headerLen  = Buffer.alloc(4); headerLen.writeUInt32LE(headerJson.length);

  // SPLT section
  const spltId    = Buffer.from('SPLT');
  const spltFlags = Buffer.from([0x02]); // v2 codec, no deflate
  const spltComp  = Buffer.alloc(4); spltComp.writeUInt32LE(spltPayload.length);
  const spltRaw   = Buffer.alloc(4); spltRaw.writeUInt32LE(spltPayload.length);

  const out = Buffer.concat([
    magic, version, fileFlags, headerLen, headerJson,
    spltId, spltFlags, spltComp, spltRaw, spltPayload,
  ]);

  fs.writeFileSync(outFile, out);
  const sizeMB = (out.length / 1048576).toFixed(2);
  console.log(`\n✓ Done: ${outFile} (${sizeMB} MB, splat-only)`);
  console.log(`  For solid mesh support, install Python: pip install open3d DracoPy`);
  console.log(`  Then re-run: fumoc convert ${inFile}\n`);
}

// ── info ──────────────────────────────────────────────────────────────────────
function cmdInfo() {
  const inFile = posArgs[1];
  if (!inFile || !fs.existsSync(inFile)) { console.error('File not found: ' + inFile); process.exit(1); }

  const buf   = fs.readFileSync(inFile);
  const magic = buf.slice(0, 6).toString('ascii');
  if (!magic.startsWith('FUMOC')) { console.error('Not a .fumoc file'); process.exit(1); }

  const minor     = buf[6], patch = buf[7];
  const fileFlags = buf.readUInt16LE(8);
  const headerLen = buf.readUInt32LE(10);
  let   header    = {};
  try { header = JSON.parse(buf.slice(14, 14 + headerLen).toString('utf8')); } catch (_) {}

  // Scan sections
  const sections = [];
  let off = 14 + headerLen;
  while (off + 13 <= buf.length) {
    const id      = buf.slice(off, off+4).toString('ascii');
    const flags   = buf[off+4];
    const compLen = buf.readUInt32LE(off+5);
    const rawLen  = buf.readUInt32LE(off+9);
    sections.push({ id, flags, compLen, rawLen });
    off += 13 + compLen;
  }

  console.log(`\n╔══════════════════════════════════════════╗`);
  console.log(`║  .fumoc file info                        ║`);
  console.log(`╚══════════════════════════════════════════╝`);
  console.log(`  File:    ${inFile}`);
  console.log(`  Size:    ${(buf.length/1048576).toFixed(2)} MB`);
  console.log(`  Magic:   ${magic}  v${minor}.${patch}`);
  console.log(`  Flags:   0x${fileFlags.toString(16).padStart(4,'0')}  [${
    [fileFlags&1?'VIDEO':'', fileFlags&2?'MESH':'', fileFlags&4?'AUDIO':''].filter(Boolean).join(', ')||'splat-only'
  }]`);
  console.log('');
  console.log('  Header:');
  for (const [k, v] of Object.entries(header)) {
    if (typeof v === 'object') continue;
    console.log(`    ${k.padEnd(16)} ${v}`);
  }
  if (header.bounds) {
    const b = header.bounds;
    console.log(`    ${'bounds'.padEnd(16)} min[${b.min?.map(x=>x.toFixed(2)).join(', ')}] max[${b.max?.map(x=>x.toFixed(2)).join(', ')}]`);
  }
  console.log('');
  console.log('  Sections:');
  for (const s of sections) {
    const ratio = s.rawLen > 0 ? (s.compLen/s.rawLen*100).toFixed(1)+'%' : '—';
    console.log(`    ${s.id}  ${(s.compLen/1024).toFixed(1).padStart(8)} KB  (flags: 0x${s.flags.toString(16).padStart(2,'0')})`);
  }
  console.log('');
}

// ── upload ────────────────────────────────────────────────────────────────────
async function cmdUpload() {
  const inFile = posArgs[1];
  if (!inFile || !fs.existsSync(inFile)) { console.error('File not found: ' + inFile); process.exit(1); }
  const token = flags.token || process.env.FUMOCA_TOKEN;
  if (!token) {
    console.error('Auth token required. Get yours at fumoca.pages.dev/settings');
    console.error('Then: fumoc upload scene.fumoc --token eyJ...');
    console.error('Or:   export FUMOCA_TOKEN=eyJ... && fumoc upload scene.fumoc');
    process.exit(1);
  }
  console.log(`Uploading ${inFile} to FUMOCA…`);
  // POST to Supabase storage via REST
  const { createClient } = (() => {
    try { return require('@supabase/supabase-js'); }
    catch(_) { console.error('Install supabase-js: npm i @supabase/supabase-js'); process.exit(1); }
  })();
  const SB_URL  = 'https://sjxkgdaaknflnviwjbej.supabase.co';
  const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNqeGtnZGFha25mbG52aXdqYmVqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzODcyNTYsImV4cCI6MjA5MDk2MzI1Nn0.Ycak6EMEvRnRVVkbpVwbAnEBpIgy1Kqz9qWtqK6AL8w';
  const sb = createClient(SB_URL, SB_ANON, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const uid  = Date.now();
  const dest = `cli-uploads/${uid}/${path.basename(inFile)}`;
  const data = fs.readFileSync(inFile);
  const { error } = await sb.storage.from('splat-files').upload(dest, data, { contentType: 'application/fumoc' });
  if (error) { console.error('Upload failed:', error.message); process.exit(1); }
  const { data: urlData } = sb.storage.from('splat-files').getPublicUrl(dest);
  const shareUrl = `https://fumoca.pages.dev/open?url=${encodeURIComponent(urlData.publicUrl)}`;
  console.log(`\n✓ Uploaded!`);
  console.log(`  Direct:  ${urlData.publicUrl}`);
  console.log(`  Share:   ${shareUrl}`);
  console.log(`  Embed:   <fumoc-player src="${urlData.publicUrl}"></fumoc-player>\n`);
}

// ── Minimal JS-only PLY parser ────────────────────────────────────────────────
function _parsePLY(bytes) {
  const dec    = new TextDecoder();
  let   hdrEnd = 0;
  // Find end_header
  for (let i = 0; i < Math.min(bytes.length, 16384); i++) {
    if (bytes[i]===101&&bytes[i+1]===110&&bytes[i+2]===100) { // 'end'
      const line = dec.decode(bytes.slice(i, i+12));
      if (line.startsWith('end_header')) { hdrEnd = i + line.indexOf('\n') + 1; break; }
    }
  }
  const header = dec.decode(bytes.slice(0, hdrEnd));
  let N = 0;
  const props = [];
  for (const line of header.split('\n')) {
    const t = line.trim().split(/\s+/);
    if (t[0]==='element'&&t[1]==='vertex') N=parseInt(t[2]);
    if (t[0]==='property') props.push({ type:t[1], name:t[2] });
  }
  const sizeMap = { float:4, float32:4, double:8, uchar:1, uint8:1, int:4, int32:4 };
  const stride  = props.reduce((s,p)=>s+(sizeMap[p.type]||4),0);
  const view    = new DataView(bytes.buffer, bytes.byteOffset+hdrEnd);
  const get     = { float:   (dv,o)=>dv.getFloat32(o,true),
                    float32: (dv,o)=>dv.getFloat32(o,true),
                    uchar:   (dv,o)=>dv.getUint8(o),
                    uint8:   (dv,o)=>dv.getUint8(o),
                    int:     (dv,o)=>dv.getInt32(o,true) };
  const arrays  = {};
  for (const p of props) arrays[p.name] = new Float32Array(N);
  for (let i=0;i<N;i++) {
    let off = i*stride;
    for (const p of props) {
      const sz = sizeMap[p.type]||4;
      arrays[p.name][i] = (get[p.type]||get.float)(view, off);
      off += sz;
    }
  }
  // Map PLY names to encoder names
  const g = { N };
  g.x=arrays.x||arrays.px||new Float32Array(N);
  g.y=arrays.y||arrays.py||new Float32Array(N);
  g.z=arrays.z||arrays.pz||new Float32Array(N);
  g.f_dc_0=arrays.f_dc_0||new Float32Array(N);
  g.f_dc_1=arrays.f_dc_1||new Float32Array(N);
  g.f_dc_2=arrays.f_dc_2||new Float32Array(N);
  g.opacity=arrays.opacity||new Float32Array(N).fill(1);
  g.scale_0=arrays.scale_0||new Float32Array(N).fill(-4);
  g.scale_1=arrays.scale_1||new Float32Array(N).fill(-4);
  g.scale_2=arrays.scale_2||new Float32Array(N).fill(-4);
  g.rot_0=arrays.rot_0||new Float32Array(N).fill(1);
  g.rot_1=arrays.rot_1||new Float32Array(N);
  g.rot_2=arrays.rot_2||new Float32Array(N);
  g.rot_3=arrays.rot_3||new Float32Array(N);
  return g;
}

function _parseSplatBinary(bytes) {
  const N   = Math.floor(bytes.length/32);
  const dv  = new DataView(bytes.buffer, bytes.byteOffset);
  const g   = { N,
    x:new Float32Array(N),y:new Float32Array(N),z:new Float32Array(N),
    scale_0:new Float32Array(N),scale_1:new Float32Array(N),scale_2:new Float32Array(N),
    f_dc_0:new Float32Array(N),f_dc_1:new Float32Array(N),f_dc_2:new Float32Array(N),
    opacity:new Float32Array(N),
    rot_0:new Float32Array(N),rot_1:new Float32Array(N),rot_2:new Float32Array(N),rot_3:new Float32Array(N),
  };
  for(let i=0;i<N;i++){
    const b=i*32;
    g.x[i]=dv.getFloat32(b,true);g.y[i]=dv.getFloat32(b+4,true);g.z[i]=dv.getFloat32(b+8,true);
    g.scale_0[i]=dv.getFloat32(b+12,true);g.scale_1[i]=dv.getFloat32(b+16,true);g.scale_2[i]=dv.getFloat32(b+20,true);
    const r=bytes[b+24]/255,gg2=bytes[b+25]/255,bl=bytes[b+26]/255,al=bytes[b+27]/255;
    g.f_dc_0[i]=(r-0.5)/0.28209479;g.f_dc_1[i]=(gg2-0.5)/0.28209479;g.f_dc_2[i]=(bl-0.5)/0.28209479;
    const ac=Math.max(1e-6,Math.min(1-1e-6,al));
    g.opacity[i]=Math.log(ac/(1-ac));
    g.rot_0[i]=bytes[b+28]/255*2-1;g.rot_1[i]=bytes[b+29]/255*2-1;
    g.rot_2[i]=bytes[b+30]/255*2-1;g.rot_3[i]=bytes[b+31]/255*2-1;
  }
  return g;
}

// ── Minimal ANS encoder (JS port of Python encoder) ───────────────────────────
const ANS_M=4096,ANS_L=1<<23;
function _buildFreq(data){
  const cnt=new Uint32Array(256);
  for(let i=0;i<data.length;i++)cnt[data[i]]++;
  const total=data.length||1;
  const freq=new Uint32Array(256);
  let sum=0;
  for(let i=0;i<256;i++){freq[i]=Math.max(1,Math.round(cnt[i]/total*ANS_M));sum+=freq[i];}
  const diff=ANS_M-sum;
  if(diff>0){let mx=0;for(let i=1;i<256;i++)if(cnt[i]>cnt[mx])mx=i;freq[mx]+=diff;}
  else if(diff<0){let d=-diff;for(let i=0;d>0;i=(i+1)%256){if(freq[i]>1){freq[i]--;d--;}}}
  return freq;
}
function _ansEncode(data,freq){
  const cum=new Uint32Array(257);for(let i=0;i<256;i++)cum[i+1]=cum[i]+freq[i];
  let state=ANS_L; const out=[];
  for(let k=data.length-1;k>=0;k--){
    const sym=data[k],f=freq[sym]||1;
    const upper=Math.floor(ANS_L/ANS_M)*f<<8;
    while(state>=upper){out.push(state&0xFF);state>>=8;}
    state=Math.floor(state/f)*ANS_M+cum[sym]+(state%f);
  }
  const hdr=Buffer.alloc(4);hdr.writeUInt32LE(state>>>0);
  return Buffer.concat([hdr,Buffer.from(out.reverse())]);
}
function _serialiseFreq(freq){const b=Buffer.alloc(512);for(let i=0;i<256;i++)b.writeUInt16LE(freq[i],i*2);return b;}
function _quantise(arr,bits){
  const mn=arr.reduce((a,b)=>Math.min(a,b),Infinity);
  const mx=arr.reduce((a,b)=>Math.max(a,b),-Infinity);
  const lvl=(1<<bits)-1,rng=mx-mn||1;
  const q=new Uint16Array(arr.length);
  for(let i=0;i<arr.length;i++)q[i]=Math.round((arr[i]-mn)/rng*lvl);
  return{q,mn,mx};
}
function _delta(q){const o=new Int32Array(q.length);o[0]=q[0];for(let i=1;i<q.length;i++)o[i]=q[i]-q[i-1];return o;}
function _zigzag(a){const o=new Uint32Array(a.length);for(let i=0;i<a.length;i++){const v=a[i];o[i]=(v<<1)^(v>>31);}return o;}
function _encodeFloatChan(vals,bits=16){
  const {q,mn,mx}=_quantise(vals,bits);
  const d=_delta(q);const zz=_zigzag(d);
  const flat=bits>8
    ?new Uint8Array(zz.length*2).map((_,i)=>i%2===0?zz[i>>1]&0xFF:(zz[i>>1]>>8)&0xFF)
    :new Uint8Array(zz.map(v=>v&0xFF));
  const freq=_buildFreq(flat);
  const comp=_ansEncode(flat,freq);
  const meta=JSON.stringify({min:mn,max:mx,bits,delta:true,length:vals.length,order:0});
  return{freq,comp,meta};
}
function _encodeUint8Chan(vals){
  const u8=Uint8Array.from(vals.map(v=>Math.round(Math.max(0,Math.min(255,v)))));
  const freq=_buildFreq(u8);const comp=_ansEncode(u8,freq);
  const meta=JSON.stringify({min:0,max:255,bits:8,delta:false,length:vals.length,order:0});
  return{freq,comp,meta};
}
function _makeChanBlock(chanId,{freq,comp,meta}){
  const freqB=_serialiseFreq(freq);
  const metaB=Buffer.from(meta);
  const h=Buffer.alloc(1+4+4);h[0]=chanId;h.writeUInt32LE(metaB.length,1);h.writeUInt32LE(comp.length,5);
  return Buffer.concat([h.slice(0,1),freqB,h.slice(1,5),metaB,h.slice(5),comp]);
}
const CHANIDS={POS_X:1,POS_Y:2,POS_Z:3,SCL_X:4,SCL_Y:5,SCL_Z:6,COL_R:7,COL_G:8,COL_B:9,COL_A:10,ROT_Q0:11,ROT_Q1:12,ROT_Q2:13,ROT_Q3:14};
function _sh2rgb(v){return v.map(x=>Math.max(0,Math.min(255,(x*0.28209479+0.5)*255)));}
function _sigmoid(v){return v.map(x=>1/(1+Math.exp(-x))*255);}
function _encodeSplt(g){
  const N=g.N;
  const channels=[];
  channels.push(_makeChanBlock(CHANIDS.POS_X,_encodeFloatChan(g.x,16)));
  channels.push(_makeChanBlock(CHANIDS.POS_Y,_encodeFloatChan(g.y,16)));
  channels.push(_makeChanBlock(CHANIDS.POS_Z,_encodeFloatChan(g.z,16)));
  channels.push(_makeChanBlock(CHANIDS.SCL_X,_encodeFloatChan(g.scale_0,8)));
  channels.push(_makeChanBlock(CHANIDS.SCL_Y,_encodeFloatChan(g.scale_1,8)));
  channels.push(_makeChanBlock(CHANIDS.SCL_Z,_encodeFloatChan(g.scale_2,8)));
  channels.push(_makeChanBlock(CHANIDS.COL_R,_encodeUint8Chan(_sh2rgb(Array.from(g.f_dc_0)))));
  channels.push(_makeChanBlock(CHANIDS.COL_G,_encodeUint8Chan(_sh2rgb(Array.from(g.f_dc_1)))));
  channels.push(_makeChanBlock(CHANIDS.COL_B,_encodeUint8Chan(_sh2rgb(Array.from(g.f_dc_2)))));
  channels.push(_makeChanBlock(CHANIDS.COL_A,_encodeUint8Chan(_sigmoid(Array.from(g.opacity)))));
  channels.push(_makeChanBlock(CHANIDS.ROT_Q0,_encodeUint8Chan(Array.from(g.rot_0).map(v=>(v+1)*0.5*255))));
  channels.push(_makeChanBlock(CHANIDS.ROT_Q1,_encodeUint8Chan(Array.from(g.rot_1).map(v=>(v+1)*0.5*255))));
  channels.push(_makeChanBlock(CHANIDS.ROT_Q2,_encodeUint8Chan(Array.from(g.rot_2).map(v=>(v+1)*0.5*255))));
  channels.push(_makeChanBlock(CHANIDS.ROT_Q3,_encodeUint8Chan(Array.from(g.rot_3).map(v=>(v+1)*0.5*255))));
  const hdr=Buffer.alloc(8);hdr.writeUInt32LE(N,0);hdr.writeUInt32LE(channels.length,4);
  return Buffer.concat([hdr,...channels]);
}
