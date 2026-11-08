import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { chromium } from 'playwright';

const fixture = `<!doctype html>
<meta name="viewport" content="width=device-width, initial-scale=1">
<script type="module">
  import { posterMotionSpeed, advancePosterMotionPhase, applyPosterMotionRotation } from '/modules/poster-live-transform.js';
  class Vector3 { constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;} normalize(){return this;} }
  class Quaternion {
    constructor(){this.angle=0;}
    setFromAxisAngle(axis,angle){this.axis=axis;this.angle=angle;return this;}
    multiply(other){this.angle+=other.angle;return this;}
  }
  const levels=['still','gentle','normal','dynamic'];
  const speeds=Object.fromEntries(levels.map(level=>[level,posterMotionSpeed(level)]));
  let phase=0; const phases={};
  for(const level of levels){phase=advancePosterMotionPhase(phase,posterMotionSpeed(level),0.016);phases[level]=phase;}
  const baseAngle=0.42, frameAngles=[], group={quaternion:new Quaternion()};
  for(let frame=0;frame<5;frame++){
    group.quaternion.setFromAxisAngle(new Vector3(0,0,-1),baseAngle);
    applyPosterMotionRotation({Vector3,Quaternion},group,0.75);
    frameAngles.push(group.quaternion.angle);
  }
  window.__motionResult={speeds,phases,frameAngles,stillPhase:advancePosterMotionPhase(1,posterMotionSpeed('still'),0.016),resumedPhase:advancePosterMotionPhase(0,posterMotionSpeed('dynamic'),0.016)};
  window.__motionReady=true;
</script>`;

const server=http.createServer(async(req,res)=>{
  if(req.url==='/'||req.url==='/motion.html'){res.writeHead(200,{'content-type':'text/html'});res.end(fixture);return;}
  if(req.url?.split('?')[0]==='/modules/poster-live-transform.js'){
    const body=await readFile(new URL('../../js/modules/poster-live-transform.js',import.meta.url));
    res.writeHead(200,{'content-type':'text/javascript'});res.end(body);return;
  }
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
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${port}/motion.html`);
  await page.waitForFunction(()=>window.__motionReady===true);
  const result=await page.evaluate(()=>window.__motionResult);
  assert.deepEqual(errors,[]);
  assert.equal(result.speeds.still,0);
  assert.ok(result.speeds.gentle>0&&result.speeds.normal>result.speeds.gentle&&result.speeds.dynamic>result.speeds.normal,'Motion intensity must increase from Gentle to Normal to Dynamic');
  assert.equal(result.stillPhase,0,'Still mode must stop and reset motion');
  assert.ok(result.resumedPhase>0,'Dynamic mode must advance the motion phase');
  assert.ok(result.frameAngles.every(angle=>Math.abs(angle-(0.42+0.75))<1e-9),'Repeated frames must apply the same yaw relative to the fresh base orientation, never accumulate rotation');
  console.log('Chromium poster motion test passed: all four speed levels, Still reset, Dynamic progression and stable non-cumulative yaw.');
}finally{
  if(browser)await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
