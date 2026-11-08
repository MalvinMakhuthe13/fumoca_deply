import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { chromium } from 'playwright';

const html=`<!doctype html>
<meta name="viewport" content="width=device-width, initial-scale=1">
<div id="ptpPosterComposer">
  <div class="ptp-poster-grid">
    <input data-poster-field="x" value="50"><output data-poster-value="x">50%</output>
    <input data-poster-field="y" value="53"><output data-poster-value="y">53%</output>
    <input data-poster-field="scale" value="100"><output data-poster-value="scale">1.00×</output>
    <input data-poster-field="rotation" value="0"><output data-poster-value="rotation">0°</output>
  </div>
</div>
<script type="module">
  import '/modules/poster-composer.js';
  import '/modules/poster-scene-manager.js';
  window.FumocaPresent={save(){window.__saveCount=(window.__saveCount||0)+1;}};
  window.__ready=true;
</script>`;

const server=http.createServer(async(req,res)=>{
  if(req.url==='/'||req.url==='/scene.html'){res.writeHead(200,{'content-type':'text/html'});res.end(html);return;}
  const match=req.url?.match(/^\/modules\/(poster-composer|poster-scene-manager)\.js$/);
  if(match){const body=await readFile(new URL('../../js/modules/'+match[1]+'.js',import.meta.url));res.writeHead(200,{'content-type':'text/javascript'});res.end(body);return;}
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
  await page.goto(`http://127.0.0.1:${port}/scene.html`);
  await page.waitForFunction(()=>window.__ready&&document.querySelector('[data-fumoca-scene-manager]'));
  const status=page.locator('[data-scene-status]');
  await page.locator('[data-scene-asset-id]').fill('nif-secondary-001');
  await page.locator('[data-scene-label]').fill('Secondary product');
  await page.locator('[data-scene-add="nif"]').click();
  await page.waitForFunction(()=>window.FumocaPoster.getState().composition.subjects.length===2);
  let state=await page.evaluate(()=>window.FumocaPoster.getState());
  const secondary=state.composition.subjects.find(item=>item.id!=='subject_main');
  assert.equal(secondary.label,'Secondary product');
  assert.equal(secondary.source.assetId,'nif-secondary-001');
  assert.equal(state.selectedSubjectId,secondary.id,'New subject becomes selected');
  await page.locator('[data-scene-action="visibility"][data-id="'+secondary.id+'"]').click();
  state=await page.evaluate(()=>window.FumocaPoster.getState());
  assert.equal(state.composition.subjects.find(item=>item.id===secondary.id).visible,false,'Hide action updates visibility');
  await page.locator('[data-scene-action="visibility"][data-id="'+secondary.id+'"]').click();
  await page.locator('[data-scene-action="lock"][data-id="'+secondary.id+'"]').click();
  state=await page.evaluate(()=>window.FumocaPoster.getState());
  assert.equal(state.composition.subjects.find(item=>item.id===secondary.id).locked,true,'Lock action updates lock state');
  await page.locator('[data-scene-action="lock"][data-id="'+secondary.id+'"]').click();
  await page.locator('[data-scene-action="front"][data-id="'+secondary.id+'"]').click();
  state=await page.evaluate(()=>window.FumocaPoster.getState());
  assert.ok(state.composition.subjects.find(item=>item.id===secondary.id).z>1,'Bring-forward action updates depth');
  await page.locator('[data-scene-action="select"][data-id="subject_main"]').click();
  state=await page.evaluate(()=>window.FumocaPoster.getState());
  assert.equal(state.selectedSubjectId,'subject_main','Main subject can be reselected');
  await page.locator('[data-scene-action="remove"][data-id="'+secondary.id+'"]').click();
  state=await page.evaluate(()=>window.FumocaPoster.getState());
  assert.equal(state.composition.subjects.length,1,'Remove action deletes the secondary subject');
  assert.equal(state.composition.subjects[0].id,'subject_main','Primary subject is preserved');
  assert.ok(await page.evaluate(()=>window.__saveCount>=5),'Scene actions persist composition changes');
  assert.deepEqual(errors,[]);
  console.log('Chromium poster scene manager passed: add NIF subject, select, hide/show, lock/unlock, depth ordering, remove and preserve primary subject.');
}finally{
  if(browser)await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
