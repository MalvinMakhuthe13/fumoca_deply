import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { chromium } from 'playwright';

const moduleSource = await readFile(new URL('../../js/modules/poster-editor-overlay.js', import.meta.url), 'utf8');
const fixture = `<!doctype html>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{margin:0;width:100%;height:100%;background:#111}#viewport{position:relative;width:100%;height:100%;overflow:hidden}</style>
<div id="viewport"></div>
<script>
const composition={aspectRatio:.8,subjects:[{id:'subject_main',label:'Main subject',x:.5,y:.5,scale:1,rotation:0,visible:true,locked:false,z:1}],title:{visible:true,text:'A poster headline'}};
window.FumocaPoster={
 getState:()=>({enabled:true,selectedSubjectId:'subject_main',composition}),
 updateSubject(id,patch){const subject=composition.subjects.find(item=>item.id===id);if(subject&&!subject.locked){Object.assign(subject,patch);window.dispatchEvent(new CustomEvent('fumoca:posterChange'));}return true;},
 updateComposition(patch){Object.assign(composition,patch);window.dispatchEvent(new CustomEvent('fumoca:posterChange'));}
};
</script>
<script type="module">
import {mountPosterEditorOverlay} from '/poster-editor-overlay.js';
window.overlay=mountPosterEditorOverlay({host:document.getElementById('viewport')});
</script>`;

const server=http.createServer((req,res)=>{
 if(req.url==='/'||req.url==='/edit.html'){res.writeHead(200,{'content-type':'text/html'});res.end(fixture);return;}
 if(req.url==='/poster-editor-overlay.js'){res.writeHead(200,{'content-type':'text/javascript'});res.end(moduleSource);return;}
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
 await page.goto(`http://127.0.0.1:${port}/edit.html`);
 const move=page.getByRole('button',{name:'Move Main subject'});
 await move.waitFor();
 assert.equal(await page.locator('.fpe-title').count(),0,'overlay must not duplicate the poster viewport headline');
 const drag=async(locator,dx,dy)=>{
   const box=await locator.boundingBox();assert.ok(box,'transform handle should be visible');
   const x=box.x+box.width/2,y=box.y+box.height/2;
   await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+dx,y+dy,{steps:6});await page.mouse.up();
 };
 await drag(move,64,40);
 let state=await page.evaluate(()=>window.FumocaPoster.getState().composition.subjects[0]);
 assert.ok(Math.abs(state.x-.6)<.003,'move should use the poster width as its coordinate space');
 assert.ok(Math.abs(state.y-.55)<.003,'move should use the poster height as its coordinate space');

 await drag(page.getByRole('button',{name:'Drag to resize selected object'}),36,0);
 state=await page.evaluate(()=>window.FumocaPoster.getState().composition.subjects[0]);
 assert.ok(state.scale>1.4,'resize handle should scale the selected subject');

 await drag(page.getByRole('button',{name:'Drag to rotate selected object'}),68,0);
 state=await page.evaluate(()=>window.FumocaPoster.getState().composition.subjects[0]);
 assert.ok(Math.abs(state.rotation)>30,'rotation handle should rotate the selected subject');

 await page.evaluate(()=>window.FumocaPoster.updateSubject('subject_main',{locked:true}));
 assert.equal(await page.getByRole('button',{name:'Move Main subject'}).isDisabled(),true,'locked subject controls should be disabled');
 await page.setViewportSize({width:390,height:844});
 await page.evaluate(()=>window.overlay.refresh());
 const frame=await page.locator('.fpe-frame').boundingBox();
 assert.ok(frame&&Math.abs(frame.width-390)<1,'poster controls should recalculate against a mobile-sized host');
 console.log('Browser test passed: direct subject move, resize, rotate, lock protection, headline de-duplication and mobile frame sizing.');
}finally{
 if(browser)await browser.close();
 await new Promise(resolve=>server.close(resolve));
}
