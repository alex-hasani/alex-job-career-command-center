import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';

const executablePath=process.env.ALEX_JOB_TEST_CHROMIUM||chromium.executablePath();
for(const directory of ['chrome-helper-extension','teaching-chrome-helper-extension']){
  test(`${directory} transfers the exact PDF in Chromium and stops at final review`,
    {skip:!existsSync(executablePath),timeout:45_000},async t=>{
      const folder=await mkdtemp(join(tmpdir(),'alex-job-extension-'));
      const extension=join(folder,'extension');
      await cp(new URL(`./${directory}/`,import.meta.url),extension,{recursive:true});
      const pending=[], inflight=new Map();
      let context, submitRequests=0, statusChecks=0, retryRequests=0;
      const server=createServer(async (req,res)=>{
        const reply=(status,body,type='text/html; charset=utf-8')=>res.writeHead(status,{'content-type':type}).end(body);
        if(req.url==='/api/browser-helper/status'&&req.method==='GET'){
          return reply(200,JSON.stringify({connected:++statusChecks>1}),'application/json');
        }
        if(req.url==='/api/browser-helper/retry-current'&&req.method==='POST'){
          retryRequests++;
          return reply(statusChecks>1?202:503,JSON.stringify({session:{status:'scanning_advert'}}),'application/json');
        }
        if(req.url==='/api/browser-helper/next'&&req.method==='GET'){
          const teaching=req.headers['x-alex-job-track']==='teaching';
          if(teaching!==directory.startsWith('teaching'))return reply(403,'Wrong track');
          if(pending.length)return reply(200,JSON.stringify(pending.shift()),'application/json');
          return setTimeout(()=>reply(204),50);
        }
        if(req.url==='/api/browser-helper/result'&&req.method==='POST'){
          const chunks=[];
          for await(const chunk of req)chunks.push(chunk);
          const {id,result,error}=JSON.parse(Buffer.concat(chunks).toString());
          inflight.get(id)?.(result,error);
          return reply(200,'{}','application/json');
        }
        if(req.url==='/advert')return reply(200,'<iframe src="/entry"></iframe>');
        if(req.url==='/entry')return reply(200,'<a href="/form">Auf diese Stelle bewerben</a>');
        if(req.url==='/form')return reply(200,`<input type="file" aria-label="alex-fixture-cv" accept="application/pdf">
          <button type="button" onclick="document.querySelector('input').hidden=true; this.hidden=true; document.querySelector('form').hidden=false">Weiter</button>
          <form action="/submitted" method="post" hidden><button>Auf diese Stelle bewerben – Bewerbung absenden</button></form>`);
        if(req.url==='/submitted'){submitRequests++;return reply(200,'Fictional submission received');}
        return reply(404,'Not found');
      });
      t.after(async()=>{
        await context?.close();
        server.closeAllConnections();
        await new Promise(resolve=>server.close(resolve));
        await rm(folder,{recursive:true,force:true});
      });
      await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
      const origin=`http://127.0.0.1:${server.address().port}`;
      await writeFile(join(extension,'profile-config.js'),`export const helperConfig=${JSON.stringify({serverOrigin:origin})};`);
      // The public helper is deliberately localhost-only. Point the disposable
      // copy at the fixture port, never the running dashboard's port.
      const offscreenPath=join(extension,'offscreen.js');
      const offscreen=await readFile(offscreenPath,'utf8');
      assert.match(offscreen,/const base='http:\/\/127\.0\.0\.1:8787'/);
      await writeFile(offscreenPath,offscreen.replace("const base='http://127.0.0.1:8787'",`const base=${JSON.stringify(origin)}`));
      const workerPath=join(extension,'service-worker.js');
      const workerSource=await readFile(workerPath,'utf8');
      await writeFile(workerPath,workerSource.replaceAll('http://127.0.0.1:8787',origin));
      context=await chromium.launchPersistentContext(join(folder,'browser'),{executablePath,channel:'chromium',headless:true,
        args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
      const run=(type,payload={})=>new Promise((resolve,reject)=>{
        const id=randomUUID();
        const timer=setTimeout(()=>{inflight.delete(id);reject(Error(`Helper did not complete ${type}`));},8_000);
        inflight.set(id,(result,error)=>{
          clearTimeout(timer);inflight.delete(id);
          if(error||result?.__error)reject(Error(error||result.__error));else resolve(result);
        });
        pending.push({id,type,payload});
      });
      assert.deepEqual(await run('ping'),{ok:true,version:directory.startsWith('teaching')?'1.2.3':'1.2.6'});
      const {id:tabId}=await run('newPage',{url:origin+'/advert'});
      if(!directory.startsWith('teaching')){
        const worker=context.serviceWorkers()[0];
        const popup=await context.newPage();
        await popup.goto(new URL('/popup.html',worker.url()).href);
        const result=await popup.evaluate(payload=>chrome.runtime.sendMessage({type:'alex-job-retry-current',payload}),{tabId,url:origin+'/advert'});
        assert.equal(result.ok,true,result.error);
        assert.equal(statusChecks,2);
        assert.equal(retryRequests,1);
        await popup.close();
      }
      const opened=await run('clickApplication',{tabId});
      assert.ok(opened.ok&&opened.frameId>0);
      const pdf=await PDFDocument.create();
      pdf.addPage().drawText('Fictional helper attachment');
      const bytes=Buffer.from(await pdf.save());
      const name='Fixture CV.pdf';
      const fixturePath=join(folder,name);
      await writeFile(fixturePath,bytes);
      const upload=await run('upload',{tabId,label:'alex-fixture-cv',kinds:['cv'],filePaths:[fixturePath]});
      assert.equal(upload.ok,true);
      const observed=await run('evaluateFrames',{tabId,code:`async()=>{
        const file=document.querySelector('input[type=file]')?.files?.[0];
        return file?Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))):null;
      }`});
      assert.equal(Buffer.from(observed.frames.find(entry=>entry.result)?.result||[]).toString('hex'),createHash('sha256').update(bytes).digest('hex'));
      assert.equal((await run('clickAdvance',{tabId})).ok,true);
      assert.deepEqual(await run('clickAdvance',{tabId}),{ok:false});
      assert.deepEqual(await run('clickApplication',{tabId}),{ok:false});
      assert.equal(submitRequests,0);
    });
}
