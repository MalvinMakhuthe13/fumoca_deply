import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { chromium } from 'playwright';

const moduleSource = await readFile(new URL('../../js/modules/poster-editor-overlay.js', import.meta.url), 'utf8');
const fixture = `<!doctype html>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{margin:0;width:100%;height:100%;background:#111}#viewport{position:relative;width:100%;height:100%;overflow:hidden}</style>
<div id="viewport"><canvas id="live-splat" style="width:100%;height:100%"></canvas></div>
<script>
window._fumocaStudioMode='move';
let selectedSubjectId='subject_main';
const composition={aspectRatio:.8,subjects:[{id:'subject_main',label:'Main subject',x:.5,y:.5,scale:1,rotation:0,visible:true,locked:false,z:1},{id:'subject_second',label:'Side product',x:.78,y:.62,scale:1,rotation:0,visible:true,locked:false,z:2}],title:{visible:true,text:'A poster headline'}};
window.FumocaPoster={
 getState:()=>({enabled:true,selectedSubjectId,composition}),
 updateSubject(id,patch){const subject=composition.subjects.find(item=>item.id===id);if(subject&&!subject.locked){Object.assign(subject,patch);window.dispatchEvent(new CustomEvent('fumoca:posterChange'));}return true;},
 selectSubject(id){selectedSubjectId=id;window.dispatchEvent(new CustomEvent('fumoca:posterChange'));},
 updateComposition(patch){Object.assign(composition,patch);window.dispatchEvent(new CustomEvent('fumoca:posterChange'));}
};
window.FumocaPosterPicking={pick(x,y){return x<350?{id:'subject_second'}:null;},getTargets(){return [];}};
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
 await page.evaluate(()=>{
   const canvas=document.getElementById('live-splat');
   canvas.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:11,clientX:300,clientY:300}));
   canvas.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,button:0,pointerId:11,clientX:300,clientY:300}));
 });
 assert.equal(await page.evaluate(()=>window.FumocaPoster.getState().selectedSubjectId),'subject_second','tapping the live splat canvas should select the projected 3D subject');
 await page.evaluate(()=>window.FumocaPoster.selectSubject('subject_main'));
 const beforeCanvasDrag=await page.evaluate(()=>({...window.FumocaPoster.getState().composition.subjects[1]}));
 await page.evaluate(()=>{
   const canvas=document.getElementById('live-splat');
   canvas.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:12,clientX:300,clientY:300}));
   canvas.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,button:0,pointerId:12,clientX:360,clientY:340}));
   canvas.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,button:0,pointerId:12,clientX:360,clientY:340}));
 });
 const afterCanvasDrag=await page.evaluate(()=>window.FumocaPoster.getState().composition.subjects[1]);
 assert.ok(afterCanvasDrag.x>beforeCanvasDrag.x && afterCanvasDrag.y>beforeCanvasDrag.y,
   'Dragging directly on a Gaussian must move the selected splat in poster coordinates');
 assert.equal(await page.evaluate(()=>window.FumocaPoster.getState().selectedSubjectId),'subject_second',
   'Dragging a splat keeps that object selected and must not orbit the camera');
 const beforePan=await page.evaluate(()=>({...window.FumocaPoster.getState().composition.subjects[0]}));
 const panPassedThrough=await page.evaluate(()=>{
   window._fumocaStudioMode='pan';
   let received=false;
   const canvas=document.getElementById('live-splat');
   canvas.addEventListener('pointerdown',()=>{received=true;},{once:true});
   canvas.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:13,clientX:500,clientY:400}));
   canvas.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,button:0,pointerId:13,clientX:500,clientY:400}));
   return received;
 });
 assert.equal(panPassedThrough,true,'Pan mode must pass pointer input through to the camera navigation handler');
 assert.deepEqual(await page.evaluate(()=>window.FumocaPoster.getState().composition.subjects[0]),beforePan,
   'Pan mode must not accidentally reposition the poster subject');
 await page.evaluate(()=>{window._fumocaStudioMode='move';});
 const sidePick=page.getByRole('button',{name:'Select Side product'});
 await sidePick.click();
 assert.equal(await page.evaluate(()=>window.FumocaPoster.getState().selectedSubjectId),'subject_second','clicking a visible poster subject should select that 3D object');
 assert.ok(await page.getByRole('button',{name:'Move Side product'}).count(),'transform controls should follow the directly selected object');
 await page.evaluate(()=>window.FumocaPoster.selectSubject('subject_main'));
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

 // Verify real pointer dragging can place the selected Gaussian at the poster edges.
 await page.evaluate(()=>window.FumocaPoster.updateSubject('subject_main',{x:.5,y:.5,scale:1,rotation:0}));
 await page.evaluate(()=>window.overlay.refresh());
 await drag(move,-470,-370);
 state=await page.evaluate(()=>window.FumocaPoster.getState().composition.subjects[0]);
 assert.ok(state.x<=.03 && state.y<=.03,'dragging toward the upper-left poster edge must not be pulled back toward the centre');
 await drag(move,940,740);
 state=await page.evaluate(()=>window.FumocaPoster.getState().composition.subjects[0]);
 assert.ok(state.x>=.97 && state.y>=.97,'dragging toward the lower-right poster edge must remain reachable');
 await page.evaluate(()=>window.FumocaPoster.updateSubject('subject_main',{x:0,y:0}));
 state=await page.evaluate(()=>window.FumocaPoster.getState().composition.subjects[0]);
 assert.equal(state.x,0,'the model must preserve an exact left-edge anchor');
 assert.equal(state.y,0,'the model must preserve an exact top-edge anchor');
 await page.evaluate(()=>window.FumocaPoster.updateSubject('subject_main',{x:1,y:1}));
 state=await page.evaluate(()=>window.FumocaPoster.getState().composition.subjects[0]);
 assert.equal(state.x,1,'the model must preserve an exact right-edge anchor');
 assert.equal(state.y,1,'the model must preserve an exact bottom-edge anchor');

 // Each additional subject must have independent move, scale and rotation state.
 await page.evaluate(()=>{
   window.FumocaPoster.updateSubject('subject_main',{x:.4,y:.4,scale:1.2,rotation:15});
   window.FumocaPoster.updateSubject('subject_second',{x:.7,y:.6,scale:.8,rotation:-10});
   window.FumocaPoster.selectSubject('subject_second');
   window.overlay.refresh();
 });
 const mainBefore=await page.evaluate(()=>({...window.FumocaPoster.getState().composition.subjects[0]}));
 await drag(page.getByRole('button',{name:'Move Side product'}),48,32);
 let sideState=await page.evaluate(()=>window.FumocaPoster.getState().composition.subjects[1]);
 assert.ok(Math.abs(sideState.x-.76)<.003,'secondary subject move must use its own poster position');
 assert.ok(Math.abs(sideState.y-.65)<.003,'secondary subject vertical move must be independent');
 await drag(page.getByRole('button',{name:'Drag to resize selected object'}),24,0);
 sideState=await page.evaluate(()=>window.FumocaPoster.getState().composition.subjects[1]);
 assert.ok(sideState.scale>1,'secondary subject scale must update independently');
 await drag(page.getByRole('button',{name:'Drag to rotate selected object'}),52,0);
 sideState=await page.evaluate(()=>window.FumocaPoster.getState().composition.subjects[1]);
 assert.ok(Math.abs(sideState.rotation)>20,'secondary subject rotation must update independently');
 await page.evaluate(()=>{window.FumocaPoster.selectSubject('subject_main');window.overlay.refresh();});
 const mainAfter=await page.evaluate(()=>window.FumocaPoster.getState().composition.subjects[0]);
 assert.deepEqual(mainAfter,mainBefore,'transforming the secondary subject must not change the main subject');
 assert.equal(await page.getByRole('button',{name:'Move Main subject'}).count(),1,'transform handles must return to the main subject after selection changes');

 await page.evaluate(()=>window.FumocaPoster.updateSubject('subject_main',{locked:true}));
 assert.equal(await page.getByRole('button',{name:'Move Main subject'}).isDisabled(),true,'locked subject controls should be disabled');
 await page.setViewportSize({width:390,height:844});
 await page.evaluate(()=>window.overlay.refresh());
 const frame=await page.locator('.fpe-frame').boundingBox();
 assert.ok(frame&&Math.abs(frame.width-390)<1,'poster controls should recalculate against a mobile-sized host');
 console.log('Browser test passed: direct subject selection, move, resize, rotate, lock protection, headline de-duplication and mobile frame sizing.');
}finally{
 if(browser)await browser.close();
 await new Promise(resolve=>server.close(resolve));
}
