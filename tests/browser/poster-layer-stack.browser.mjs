import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { chromium } from 'playwright';

const fixture = `<!doctype html>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/css/present-magazine.css">
<style>
  html,body{margin:0;width:100%;height:100%;background:#111}
  #stageHost{position:absolute;left:0;top:0;width:100%;height:100%;overflow:hidden}
  #stage{position:absolute;inset:0;width:100%;height:100%;z-index:1}
</style>
<div id="stageHost"><canvas id="stage"></canvas></div>
<script type="module">
  import '/modules/poster-composer.js';
  import '/modules/poster-viewport.js';
  import {initPosterAssets} from '/modules/poster-assets.js';
  import {initMagazineText,addText} from '/modules/present-magazine-text.js';
  window.FumocaPoster.setPreset('editorial');
  window.FumocaPoster.updateComposition({
    background:{type:'image',value:'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="8" height="8"%3E%3Crect width="8" height="8" fill="%23223344"/%3E%3C/svg%3E',fit:'cover',position:'center'},
    title:{visible:true,text:'POSTER HEADLINE',fontSize:42,color:'#ffffff'},
    assets:{images:[{id:'logo',name:'Brand logo',src:'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="60"%3E%3Crect width="100" height="60" fill="%23c8ff00"/%3E%3C/svg%3E',x:.82,y:.12,width:.2,z:2,visible:true}]}
  });
  initPosterAssets({editable:false});
  initMagazineText({editable:false});
  addText({id:'editorial-headline',text:'EDITORIAL TITLE',style:'cover',mode:'locked',sx:50,sy:30,fontSize:48,color:'#ffffff'});
  window.__layersReady=true;
</script>`;

const files = {
  '/modules/poster-composer.js':'js/modules/poster-composer.js',
  '/modules/poster-viewport.js':'js/modules/poster-viewport.js',
  '/modules/poster-assets.js':'js/modules/poster-assets.js',
  '/modules/present-magazine-text.js':'js/modules/present-magazine-text.js',
  '/css/present-magazine.css':'css/present-magazine.css'
};
const server=http.createServer(async(req,res)=>{
  if(req.url==='/'||req.url==='/viewer.html'){res.writeHead(200,{'content-type':'text/html'});res.end(fixture);return;}
  const file=files[req.url?.split('?')[0]];
  if(file){try{const body=await readFile(new URL('../../'+file,import.meta.url));res.writeHead(200,{'content-type':file.endsWith('.css')?'text/css':'text/javascript'});res.end(body);}catch(e){res.writeHead(500);res.end(String(e));}return;}
  res.writeHead(404);res.end('not found');
});
const portServer=createServer();
await new Promise(resolve=>portServer.listen(0,'127.0.0.1',resolve));
const port=portServer.address().port;
await new Promise(resolve=>portServer.close(resolve));
server.listen(port,'127.0.0.1');
await new Promise(resolve=>server.once('listening',resolve));

let browser;
try{
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1000,height:800}});
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/viewer.html`);
  await page.waitForFunction(()=>window.__layersReady&&document.querySelector('[data-fumoca-poster-background]')&&document.querySelector('[data-fumoca-poster-assets]')&&document.querySelector('#magazineTextLayer .mt-item'));
  await page.waitForFunction(()=>document.querySelector('#stageHost').dataset.fumocaPosterViewport==='1');
  const result=await page.evaluate(()=>{
    const host=document.querySelector('#stageHost');
    const rect=host.getBoundingClientRect();
    const z=selector=>getComputedStyle(document.querySelector(selector)).zIndex;
    return {
      poster:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},
      backgroundZ:z('[data-fumoca-poster-background]'),
      sceneZ:z('#stage'),
      titleZ:z('[data-fumoca-poster-title]'),
      assetsZ:z('[data-fumoca-poster-assets]'),
      magazineZ:z('#magazineTextLayer'),
      backgroundVisible:getComputedStyle(document.querySelector('[data-fumoca-poster-background]')).display!=='none',
      logoRect:(()=>{const r=document.querySelector('[data-poster-asset-id="logo"]').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})(),
      headlineText:document.querySelector('#magazineTextLayer .mt-item').textContent
    };
  });
  assert.deepEqual(errors,[]);
  assert.ok(Math.abs(result.poster.width-640)<1,'editorial poster should be contain-fitted to 4:5');
  assert.ok(Math.abs(result.poster.x-180)<1,'poster should remain centred in wide viewer host');
  assert.equal(result.backgroundVisible,true);
  assert.equal(result.backgroundZ,'0');
  assert.equal(result.sceneZ,'1');
  assert.equal(result.titleZ,'3');
  assert.equal(result.assetsZ,'8');
  assert.equal(result.magazineZ,'18');
  assert.ok(result.backgroundZ<result.sceneZ&&result.sceneZ<result.titleZ&&result.titleZ<result.assetsZ&&result.assetsZ<result.magazineZ,'visual layers must stack background → 3D scene → viewport title → supporting images → magazine typography');
  assert.equal(result.logoRect.width,128,'supporting logo should size against the 640px poster canvas');
  assert.equal(result.headlineText,'EDITORIAL TITLE');
  console.log('Browser test passed: real poster viewport, background, supporting image and magazine modules preserve poster framing and expected visual stacking.');
}finally{
  if(browser)await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
