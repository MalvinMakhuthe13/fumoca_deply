import assert from 'node:assert/strict';
import http from 'node:http';
import { createServer } from 'node:net';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright';
import { NIFWriter, CHUNK, CODEC } from '../../engine-next/format/NIFSpec.js';

const root=resolve(process.cwd());
const geometry=new Uint8Array(5+96*14*4),dv=new DataView(geometry.buffer);
dv.setUint8(0,0);dv.setUint32(1,96,false);
for(let i=0;i<96;i++){const x=(i%12-5.5)*.12,y=(Math.floor(i/12)-3.5)*.12;[x,y,0,-3,-3,-3,1,0,0,0,2,.2,.1,-.1].forEach((v,k)=>dv.setFloat32(5+(i*14+k)*4,v,true));}
const source=new NIFWriter({captureMode:'video',fps:30,vertical:'generic'}).add(CHUNK.KEYFRAME_GEO,geometry,CODEC.RAW).build();
const server=http.createServer(async(req,res)=>{try{const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname),file=resolve(root,'.'+pathname);if(!file.startsWith(root+sep)&&file!==root)throw new Error('invalid path');const info=await stat(file);if(!info.isFile())throw new Error('not a file');const ext=extname(file),type=ext==='.js'||ext==='.mjs'?'text/javascript':ext==='.html'?'text/html':ext==='.css'?'text/css':'application/octet-stream';res.writeHead(200,{'content-type':type});res.end(await readFile(file));}catch{res.writeHead(404);res.end('not found');}});
const probe=createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));server.listen(port,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
let browser;
try{
 browser=await chromium.launch({headless:true,args:['--enable-webgl','--ignore-gpu-blocklist','--use-gl=angle','--use-angle=swiftshader']});
 const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+port+'/engine-next/editor/manual-gaussian-deformation-lab.html');
 await page.locator('#file').setInputFiles({name:'manual-lab-fixture.nif',mimeType:'application/octet-stream',buffer:Buffer.from(source)});
 await page.waitForFunction(()=>document.getElementById('status')?.textContent.includes('splats'));
 await page.waitForFunction(()=>document.getElementById('message')?.textContent.includes('Ready.'));
 await page.locator('#all').click();await page.locator('#gizmoRotate').click();await page.locator('#gizmoScale').click();await page.locator('#gizmoMove').click();
 await page.locator('#angle').fill('30');await page.locator('#fold').click();await page.locator('#time').fill('0.5');await page.locator('#easing').selectOption('ease-in-out');await page.locator('#key').click();await page.locator('#previewPlay').click();await page.waitForTimeout(150);await page.locator('#previewStop').click();
 const firstDownload=page.waitForEvent('download');await page.locator('#exportNif').click();const first=await firstDownload,firstPath=await first.path();assert.ok(firstPath);
 await page.locator('#file').setInputFiles(firstPath);await page.waitForFunction(()=>document.getElementById('message')?.textContent.includes('existing animation tracks reopened'));
 await page.locator('#all').click();await page.locator('#time').fill('0.75');await page.locator('#translate').click();await page.locator('#key').click();
 const secondDownload=page.waitForEvent('download');await page.locator('#exportNif').click();const second=await secondDownload;assert.ok(await second.path());
 assert.deepEqual(errors,[],'manual Gaussian Lab must not emit uncaught browser errors');
 console.log('Manual Gaussian Lab browser acceptance passed: NIF load, selection, deformation, easing, preview, export, reopen, edit and re-export.');
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
