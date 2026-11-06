import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { chromium } from 'playwright';

const fixture = `<!doctype html>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body,#stageHost{margin:0;width:100%;height:100%;background:#111}</style>
<div id="stageHost"></div>
<script type="module">
  import '/modules/poster-composer.js';
  window._fumocaCurrentRecord = {
    id:'nif-browser-fixture',
    meta:{present:{
      poster:{
        enabled:true,
        preset:'editorial',
        composition:{
          aspectRatio:0.75,
          background:{type:'image',value:'https://assets.example.test/poster-bg.webp',fit:'cover',position:'center'},
          subjects:[
            {id:'subject_main',label:'Main subject',source:{type:'current'},x:0.62,y:0.5,scale:1.1,rotation:8,z:1,visible:true},
            {id:'subject_second',label:'Second product',source:{type:'nif',assetId:'nif-secondary'},x:0.28,y:0.66,scale:0.7,rotation:-12,z:2,visible:true}
          ],
          assets:{images:[
            {id:'brand-mark',name:'Brand mark',src:'https://assets.example.test/logo.webp',x:0.12,y:0.12,width:0.2,sizeMode:'fixed',fixedWidthPx:144,visible:true}
          ]}
        }
      }
    }}
  };
  const viewer = await import('/modules/present-viewer.js');
  viewer.initPresentViewer();
  window.__restoreReady = true;
</script>`;

const server = http.createServer(async (req,res) => {
  if (req.url === '/' || req.url === '/viewer.html') {
    res.writeHead(200, {'content-type':'text/html'}); res.end(fixture); return;
  }
  if (req.url?.split('?')[0] === '/modules/present-nav.js') {
    res.writeHead(200, {'content-type':'text/javascript'});
    res.end('export function initPresentNav(){}; export function setNavStops(){};'); return;
  }
  const modules = {
    '/modules/poster-composer.js':'js/modules/poster-composer.js',
    '/modules/present-viewer.js':'js/modules/present-viewer.js',
    '/modules/present-magazine-text.js':'js/modules/present-magazine-text.js'
  };
  const file = modules[req.url?.split('?')[0]];
  if (file) {
    try { const body=await readFile(new URL('../../'+file, import.meta.url)); res.writeHead(200, {'content-type':'text/javascript'}); res.end(body); }
    catch(e) { res.writeHead(500); res.end(String(e)); }
    return;
  }
  res.writeHead(404); res.end('not found');
});
const portServer=createServer();
await new Promise(resolve=>portServer.listen(0,'127.0.0.1',resolve));
const port=portServer.address().port;
await new Promise(resolve=>portServer.close(resolve));
server.listen(port,'127.0.0.1');
await new Promise(resolve=>server.once('listening',resolve));

let browser;
try {
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:900,height:900}});
  const pageErrors=[];
  page.on('pageerror',error=>pageErrors.push(error.message));
  await page.goto(`http://127.0.0.1:${port}/viewer.html`);
  await page.waitForFunction(()=>window.__restoreReady && window.FumocaPresentViewer && window.FumocaPoster);
  await page.waitForFunction(()=>window.FumocaPoster.getState().enabled === true);
  const restored=await page.evaluate(()=>window.FumocaPoster.getState());
  assert.deepEqual(pageErrors,[]);
  assert.equal(restored.preset,'editorial');
  assert.equal(restored.composition.background.type,'image');
  assert.equal(restored.composition.background.value,'https://assets.example.test/poster-bg.webp');
  assert.equal(restored.composition.assets.images[0].id,'brand-mark');
  assert.equal(restored.composition.assets.images[0].fixedWidthPx,144);
  assert.equal(restored.composition.subjects.length,2);
  assert.equal(restored.composition.subjects[1].source.assetId,'nif-secondary');
  assert.equal(restored.composition.subjects[1].rotation,-12);
  console.log('Browser test passed: public viewer restores poster background, fixed-size supporting image and multiple independently transformed subjects from saved NIF metadata.');
} finally {
  if(browser) await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
