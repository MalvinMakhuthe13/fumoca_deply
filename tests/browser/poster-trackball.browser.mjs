import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { chromium } from 'playwright';

const moduleSource = await readFile(new URL('../../js/modules/poster-viewport.js', import.meta.url), 'utf8');
const fixture = `<!doctype html>
<style>html,body{margin:0;width:100%;height:100%}#viewport{position:relative;width:800px;height:1000px;overflow:hidden}</style>
<div id="viewport"><canvas id="spark-canvas"></canvas><div data-poster-asset-id="supporting-image" style="position:absolute;left:20px;top:20px;width:120px;height:100px;pointer-events:auto"></div></div>
<script>
class Vector3 {
 constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z}
 clone(){return new Vector3(this.x,this.y,this.z)}
 set(x,y,z){this.x=x;this.y=y;this.z=z;return this}
 normalize(){const n=Math.hypot(this.x,this.y,this.z)||1;this.x/=n;this.y/=n;this.z/=n;return this}
 sub(v){this.x-=v.x;this.y-=v.y;this.z-=v.z;return this}
 add(v){this.x+=v.x;this.y+=v.y;this.z+=v.z;return this}
 copy(v){this.x=v.x;this.y=v.y;this.z=v.z;return this}
 applyQuaternion(q){this.x+=q.value;this.y+=q.value/2;return this}
}
class Quaternion {
 constructor(value=0){this.value=value}
 clone(){return new Quaternion(this.value)}
 setFromUnitVectors(a,b){this.value=(b.x-a.x)+(b.y-a.y)*2+(b.z-a.z)*3;return this}
 multiply(q){this.value+=q.value;return this}
 premultiply(q){this.value=q.value+this.value;return this}
 invert(){this.value=-this.value;return this}
 normalize(){return this}
}
const camera={position:new Vector3(0,0,5),quaternion:new Quaternion(0),up:new Vector3(0,1,0),zoom:1,updateProjectionMatrix(){},updateMatrixWorld(){}};
const controls={target:new Vector3(0,0,0),enablePan:true,enableZoom:true,autoRotate:false,autoRotateSpeed:1};
window._fumocaCaptureCanvas=document.getElementById('spark-canvas');
window._fumocaViewerCamera=camera;window._fumocaCamera=camera;window._fumocaViewerControls=controls;window.S={mode:'orbit'};
window.FumocaPoster={getState:()=>({enabled:true,composition:{aspectRatio:.8,safeArea:.04,background:{type:'solid',value:'#10131a'},assets:{images:[]},title:{visible:false},motion:{level:'still'},framing:{zoom:1}}}),updateComposition(){}};
window.__camera=camera;
// Intentionally no window.THREE: Spark imports Three.js as an ES module.
</script>
<script type="module" src="/poster-viewport.js"></script>`;

const server=http.createServer((req,res)=>{
 if(req.url==='/'||req.url==='/edit.html'){res.writeHead(200,{'content-type':'text/html'});res.end(fixture);return}
 if(req.url==='/poster-viewport.js'){res.writeHead(200,{'content-type':'text/javascript'});res.end(moduleSource);return}
 res.writeHead(404);res.end('not found')
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
 const page=await browser.newPage({viewport:{width:1000,height:1100}});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://127.0.0.1:'+port+'/edit.html');
 await page.waitForFunction(()=>document.getElementById('viewport')?.dataset.fumocaPosterViewport==='1');
 const before=await page.evaluate(()=>window.__camera.quaternion.value);
 await page.mouse.move(400,500);await page.mouse.down();await page.mouse.move(540,420,{steps:8});await page.mouse.up();
 const afterOrbit=await page.evaluate(()=>window.__camera.quaternion.value);
 assert.notEqual(afterOrbit,before,'poster Orbit mode must rotate the active camera without a window.THREE global');
 await page.evaluate(()=>{window.__camera.quaternion.value=0});
 await page.mouse.move(70,70);await page.mouse.down();await page.mouse.move(180,160,{steps:6});await page.mouse.up();
 const afterImageDrag=await page.evaluate(()=>window.__camera.quaternion.value);
 assert.equal(afterImageDrag,0,'supporting-image dragging must not also rotate the 3D camera');
 assert.deepEqual(errors,[]);
 console.log('Chromium trackball test passed: camera Quaternion is resolved from the active renderer and image drags do not start camera rotation.');
}finally{
 if(browser)await browser.close();
 await new Promise(resolve=>server.close(resolve));
}
