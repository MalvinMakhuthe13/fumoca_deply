import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { chromium } from 'playwright';

const source = await readFile(new URL('../../js/modules/present-magazine-text.js', import.meta.url), 'utf8');
const fixture = `<!doctype html>
<style>html,body{margin:0;width:100%;height:100%}#viewport{position:relative;width:1000px;height:800px}#poster{position:absolute;inset:0;z-index:9;pointer-events:none}#assetOverlay{position:absolute;inset:0;z-index:8;pointer-events:none}#assetHit{position:absolute;inset:0;width:100%;height:100%;pointer-events:auto;opacity:0}</style>
<div id="viewport"><div id="poster" data-fumoca-poster-canvas></div><div id="assetOverlay"><button id="assetHit" type="button"></button></div></div>
<script type="module">
import {initMagazineText,addText,exportAll} from '/present-magazine-text.js';
initMagazineText({editable:true});
addText({text:'Additional copy',style:'deck',mode:'locked',sx:50,sy:30,fontSize:30,align:'left'});
window.__getText=()=>exportAll()[0];
window.__textReady=true;
</script>`;
const server=http.createServer((req,res)=>{
 if(req.url==='/'||req.url==='/edit.html'){res.writeHead(200,{'content-type':'text/html'});res.end(fixture);return;}
 if(req.url==='/present-magazine-text.js'){res.writeHead(200,{'content-type':'text/javascript'});res.end(source);return;}
 res.writeHead(404);res.end('not found');
});
const socket=createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
server.listen(port,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
let browser;
try{
 browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:1100,height:900}});
 await page.goto('http://127.0.0.1:'+port+'/edit.html');
 await page.waitForFunction(()=>window.__textReady&&document.querySelector('.mt-item'));
 const before=await page.evaluate(()=>window.__getText());
 const box=await page.locator('.mt-item').boundingBox();
 assert.ok(box,'additional text must render as an editable poster layer');
 assert.equal(await page.locator('.mt-item').evaluate(el=>getComputedStyle(el).pointerEvents),'auto','text layers must remain pointer-interactive in Studio');
 const hit=await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.closest?.('.mt-item')?.classList.contains('mt-item')||false,{x:box.x+box.width*.8,y:box.y+box.height*.5});
 assert.equal(hit,true,'editable text must receive pointer input above the supporting-image hit surface');
 await page.mouse.move(box.x+box.width*.8,box.y+box.height*.5);
 await page.mouse.down();
 await page.mouse.move(box.x+box.width*.8+100,box.y+box.height*.5+80,{steps:6});
 await page.mouse.up();
 const after=await page.evaluate(()=>window.__getText());
 assert.ok(Math.abs(after.sx-before.sx-10)<.2,'dragging text by 10% of poster width must move its anchor by 10%, without snapping it to the pointer');
 assert.ok(Math.abs(after.sy-before.sy-10)<.2,'dragging text by 10% of poster height must move its anchor by 10%, without snapping it to the pointer');
 assert.equal(after.mode,'locked','free-positioned editorial copy remains locked to the poster rather than the 3D world');
 console.log('Chromium text-layer test passed: additional copy is freely positioned without grab-point snapping.');
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
