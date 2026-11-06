import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { chromium } from 'playwright';

const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==';
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
    background:{type:'image',value:'${pixel}',fit:'cover',position:'center'},
    title:{visible:true,text:'POSTER HEADLINE',fontSize:42,color:'#ffffff'},
    assets:{images:[{id:'logo',name:'Brand logo',src:'${pixel}',x:.82,y:.12,width:.2,z:2,visible:true}]}
  });
  window.FumocaPoster.setEnabled(true);
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
  for (const viewport of [{width:1000,height:800},{width:768,height:1024},{width:390,height:844}]) {
    const page=await browser.newPage({viewport});
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${port}/viewer.html`);
    await page.waitForFunction(()=>window.__layersReady&&document.querySelector('[data-fumoca-poster-background]')&&document.querySelector('[data-fumoca-poster-assets]')&&document.querySelector('#magazineTextLayer .mt-item'));
    await page.waitForFunction(()=>document.querySelector('#stageHost').dataset.fumocaPosterViewport==='1');
    const result=await page.evaluate(()=>{
      const host=document.querySelector('#stageHost');
      const rect=host.getBoundingClientRect();
      const z=selector=>getComputedStyle(document.querySelector(selector)).zIndex;
      const logo=document.querySelector('[data-poster-asset-id="logo"]');
      const logoRect=logo.getBoundingClientRect();
      return {
        poster:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},
        backgroundZ:z('[data-fumoca-poster-background]'),
        sceneZ:z('#stage'),
        titleZ:z('[data-fumoca-poster-title]'),
        assetsZ:z('[data-fumoca-poster-assets]'),
        magazineZ:z('#magazineTextLayer'),
        backgroundVisible:getComputedStyle(document.querySelector('[data-fumoca-poster-background]')).display!=='none',
        backgroundImageLoaded:document.querySelector('[data-fumoca-poster-background-image]').complete,
        logoRect:{x:logoRect.x,y:logoRect.y,width:logoRect.width},
        headlineText:document.querySelector('#magazineTextLayer .mt-item').textContent
      };
    });
    assert.deepEqual(errors,[],`browser errors at ${viewport.width}x${viewport.height}`);
    const expectedWidth=Math.min(viewport.width,viewport.height*0.75);
    const expectedHeight=expectedWidth/0.75;
    assert.ok(Math.abs(result.poster.width-expectedWidth)<1,`poster width should contain-fit at ${viewport.width}x${viewport.height}`);
    assert.ok(Math.abs(result.poster.height-expectedHeight)<1,`poster height should contain-fit at ${viewport.width}x${viewport.height}`);
    assert.ok(Math.abs(result.poster.x-(viewport.width-expectedWidth)/2)<1,'poster should remain horizontally centred');
    assert.equal(result.backgroundVisible,true);
    assert.equal(result.backgroundImageLoaded,true);
    assert.equal(result.backgroundZ,'0');
    assert.equal(result.sceneZ,'1');
    assert.equal(result.titleZ,'3');
    assert.equal(result.assetsZ,'8');
    assert.equal(result.magazineZ,'18');
    assert.ok(Number(result.backgroundZ)<Number(result.sceneZ)&&Number(result.sceneZ)<Number(result.titleZ)&&Number(result.titleZ)<Number(result.assetsZ)&&Number(result.assetsZ)<Number(result.magazineZ),'visual layers must stack background → 3D scene → viewport title → supporting images → magazine typography');
    assert.ok(Math.abs(result.logoRect.width-expectedWidth*0.2)<1,'supporting logo should size against the poster canvas');
    assert.equal(result.headlineText,'EDITORIAL TITLE');
    await page.close();
  }
  console.log('Browser test passed at desktop, tablet and mobile sizes: poster framing, background, supporting image and editorial layer stacking are preserved.');
}finally{
  if(browser)await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
