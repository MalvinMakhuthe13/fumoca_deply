import r2 from '../r2Client.js';
/**
 * FUMOCA Mobile Asset Builder v61
 * ═══════════════════════════════════════════════════════════════════
 * Converts any published splat into a lightweight mobile-interactive
 * asset that can be added to a phone home screen as a PWA widget.
 *
 * The mobile asset is NOT the full splat — it is a compressed,
 * state-driven interactive experience with:
 *   - A set of predefined visual states (rotate angles, paint colours)
 *   - Touch/swipe gestures for rotation and variant cycling
 *   - Sound trigger buttons (engine rev, door click, etc.)
 *   - "Open in Fumoca" deep link to full viewer
 *   - Fits in < 2 MB for instant home-screen loading
 *
 * Architecture:
 *   1. Builder runs in studio → generates interaction_rules + states
 *   2. Saves to mobile_assets table with asset_url
 *   3. PWA manifest + service worker serve it as installable widget
 *   4. Embed page (mobile-widget.html) renders the widget
 * ═══════════════════════════════════════════════════════════════════
 */

const FumocaMobileAsset = (() => {

  // ── Default interaction rules by asset type ───────────────────────
  const DEFAULT_RULES = {
    car: {
      gestures:   ['swipe_rotate', 'tap_variant', 'hold_sound'],
      auto_rotate: true,
      rotate_speed: 0.4,
      sounds:     ['engine_idle', 'engine_rev', 'door_open'],
      variants:   ['paint_color'],
    },
    place: {
      gestures:   ['swipe_pan', 'tap_hotspot', 'pinch_zoom'],
      auto_rotate: false,
      sounds:     ['ambient'],
      variants:   [],
    },
    product: {
      gestures:   ['swipe_rotate', 'tap_variant'],
      auto_rotate: true,
      rotate_speed: 0.3,
      sounds:     [],
      variants:   ['color', 'size'],
    },
    general: {
      gestures:   ['swipe_rotate'],
      auto_rotate: true,
      rotate_speed: 0.3,
      sounds:     [],
      variants:   [],
    },
  };

  // ── Build mobile asset config from studio ─────────────────────────
  function buildConfig(splatRecord, overrides = {}) {
    const assetType = splatRecord?.asset_type || 'general';
    const base = DEFAULT_RULES[assetType] || DEFAULT_RULES.general;

    return {
      splat_id:          splatRecord?.id,
      splat_title:       splatRecord?.title || 'Untitled',
      thumbnail_url:     splatRecord?.thumbnail_url || '',
      preview_url:       splatRecord?.teaser_video_url || splatRecord?.splat_url || '',
      asset_type:        assetType,
      interaction_rules: { ...base, ...overrides },
      states:            _buildStates(splatRecord, assetType),
      deep_link:         `fumoca://viewer?splatId=${splatRecord?.id}`,
      web_link:          `${location.origin}/viewer.html?splatId=${splatRecord?.id}`,
      created_at:        new Date().toISOString(),
    };
  }

  function _buildStates(record, assetType) {
    const states = [
      { id: 'default', label: 'Default View', angle: 0,   zoom: 1 },
      { id: 'front',   label: 'Front',        angle: 0,   zoom: 1.1 },
      { id: 'side',    label: 'Side',         angle: 90,  zoom: 1.05 },
      { id: 'rear',    label: 'Rear',         angle: 180, zoom: 1.1 },
      { id: 'top',     label: 'Top',          angle: 45,  zoom: 0.9, pitch: 35 },
    ];

    if (assetType === 'car') {
      states.push(
        { id: 'interior',  label: 'Interior',  angle: 270, zoom: 1.8,  note: 'interior' },
        { id: 'wheel_fl',  label: 'Wheel',     angle: 315, zoom: 2.2,  note: 'wheel_fl' },
      );
    }

    return states;
  }

  // ── Save to Supabase mobile_assets table ──────────────────────────
  async function saveAsset(splatRecord, overrides = {}) {
    const sb = window._fumocaSupabase;
    if (!sb || !splatRecord?.id) return null;

    const config = buildConfig(splatRecord, overrides);

    // Generate the widget HTML and upload it
    const widgetHtml = _generateWidgetHTML(config, splatRecord);
    const blob       = new Blob([widgetHtml], { type: 'text/html' });
    const path       = `${splatRecord.id}/widget.html`;

    let assetUrl = null;
    try {
      const { publicUrl: _assetPub } = await r2.from('splat-files').upload(path, blob, { contentType: 'text/html' });
      assetUrl = _assetPub;
    } catch (e) {
      console.warn('[MobileAsset] Widget upload failed:', e);
    }

    // Save record to mobile_assets table
    const { data: row } = await sb.from('mobile_assets').upsert({
      splat_id:          splatRecord.id,
      asset_url:         assetUrl,
      format:            'fumoca-widget',
      interaction_rules: config.interaction_rules,
      states:            config.states,
    }, { onConflict: 'splat_id' }).select().single();

    // Also update splat record
    await sb.from('splats').update({
      mobile_asset_url:  assetUrl,
      mobile_asset_meta: config,
    }).eq('id', splatRecord.id);

    console.log('%c[MobileAsset] Widget saved →', 'color:#c8ff00', assetUrl);
    window.dispatchEvent(new CustomEvent('fumoca:mobileAssetReady', { detail: { url: assetUrl, config } }));
    return { url: assetUrl, config, row };
  }

  // ── Generate self-contained widget HTML ──────────────────────────
  function _generateWidgetHTML(config, record) {
    const thumb   = record.thumbnail_url || '';
    const title   = record.title || 'Fumoca Experience';
    const webLink = config.web_link || '#';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<meta name="theme-color" content="#05070b">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title>${title}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  body{background:#05070b;color:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
       height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;
       overflow:hidden;touch-action:none;}
  #preview{width:100%;max-width:420px;aspect-ratio:1;position:relative;overflow:hidden;
           border-radius:20px;border:1px solid rgba(200,255,0,.2);}
  #previewImg{width:100%;height:100%;object-fit:cover;display:block;
              transform:rotate(var(--angle,0deg)) scale(var(--zoom,1));transition:transform 0.3s ease;}
  #controls{display:flex;gap:12px;padding:16px 0;justify-content:center;flex-wrap:wrap;}
  .ctrl-btn{background:rgba(200,255,0,.12);border:1px solid rgba(200,255,0,.3);
            color:#c8ff00;padding:10px 18px;border-radius:999px;font-size:13px;font-weight:700;
            cursor:pointer;transition:background .15s;}
  .ctrl-btn:active{background:rgba(200,255,0,.25);}
  #title{font-size:15px;font-weight:700;color:#fff;text-align:center;padding:8px 16px 0;}
  #openBtn{margin-top:8px;background:#c8ff00;color:#000;border:none;padding:12px 28px;
           border-radius:999px;font-size:14px;font-weight:800;cursor:pointer;text-decoration:none;
           display:inline-block;}
  #stateLabel{font-size:11px;color:rgba(255,255,255,.45);text-align:center;margin-top:4px;}
</style>
</head>
<body>
<div id="preview">
  <img id="previewImg" src="${thumb}" alt="${title}">
</div>
<div id="title">${title}</div>
<div id="stateLabel">Swipe to rotate · Tap to explore</div>
<div id="controls">
  ${config.interaction_rules.variants?.includes('paint_color') ? `
    <button class="ctrl-btn" onclick="cyclePaint()">🎨 Colour</button>` : ''}
  ${config.interaction_rules.sounds?.length ? `
    <button class="ctrl-btn" onclick="triggerSound()">🔊 Sound</button>` : ''}
  <a href="${webLink}" class="ctrl-btn" id="openBtn">✦ Open in Fumoca</a>
</div>
<script>
const img=document.getElementById('previewImg');
const states=${JSON.stringify(config.states)};
let stateIdx=0,angle=0,startX=0,isDrag=false;
const paints=['original','red','blue','black','white','gold','silver'];
let paintIdx=0;
function applyState(s){
  angle=s.angle||0;
  document.documentElement.style.setProperty('--angle',angle+'deg');
  document.documentElement.style.setProperty('--zoom',s.zoom||1);
  document.getElementById('stateLabel').textContent=s.label||'';
}
// Swipe to rotate
document.getElementById('preview').addEventListener('touchstart',e=>{startX=e.touches[0].clientX;isDrag=true;},{passive:true});
document.getElementById('preview').addEventListener('touchmove',e=>{
  if(!isDrag)return;
  const dx=(e.touches[0].clientX-startX)*0.4;
  document.documentElement.style.setProperty('--angle',(angle+dx)+'deg');
},{passive:true});
document.getElementById('preview').addEventListener('touchend',e=>{
  const dx=(e.changedTouches[0].clientX-startX)*0.4;
  angle=(angle+dx)%360;
  stateIdx=(stateIdx+1)%states.length;
  applyState(states[stateIdx]);
  isDrag=false;
});
function cyclePaint(){
  paintIdx=(paintIdx+1)%paints.length;
  const hues={original:'0',red:'0',blue:'200',black:'0',white:'0',gold:'38',silver:'200'};
  const sats={original:'1',red:'1.4',blue:'1.3',black:'0.2',white:'0.05',gold:'1.5',silver:'0.15'};
  const bris={original:'1',red:'1.05',blue:'1.02',black:'0.25',white:'2.2',gold:'1.1',silver:'1.55'};
  const p=paints[paintIdx];
  img.style.filter='hue-rotate('+hues[p]+'deg) saturate('+sats[p]+') brightness('+bris[p]+')';
}
function triggerSound(){
  const ctx=new(window.AudioContext||window.webkitAudioContext)();
  const osc=ctx.createOscillator();const g=ctx.createGain();
  osc.connect(g);g.connect(ctx.destination);
  osc.type='sawtooth';osc.frequency.setValueAtTime(80,ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(220,ctx.currentTime+0.3);
  g.gain.setValueAtTime(0.3,ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.6);
  osc.start();osc.stop(ctx.currentTime+0.6);
}
${config.interaction_rules.auto_rotate ? `
setInterval(()=>{angle=(angle+${config.interaction_rules.rotate_speed||0.4})%360;
  document.documentElement.style.setProperty('--angle',angle+'deg');},16);` : ''}
</script>
</body>
</html>`;
  }

  // ── Generate PWA manifest for the widget ──────────────────────────
  function generateManifest(splatRecord) {
    return JSON.stringify({
      name: splatRecord?.title || 'Fumoca Experience',
      short_name: 'Fumoca',
      start_url: `/viewer.html?splatId=${splatRecord?.id}`,
      display: 'standalone',
      background_color: '#05070b',
      theme_color: '#c8ff00',
      icons: [
        { src: splatRecord?.thumbnail_url || '/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: splatRecord?.thumbnail_url || '/icon-512.png', sizes: '512x512', type: 'image/png' },
      ],
    }, null, 2);
  }

  // ── Public API ────────────────────────────────────────────────────
  return {
    buildConfig,
    saveAsset,
    generateManifest,
  };

})();

window.FumocaMobileAsset = FumocaMobileAsset;
export default FumocaMobileAsset;
