import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTeachingFastApplyManager } from './teaching-fast-apply-manager.mjs';

test('Teaching Fast Apply keeps its own journal, allows Undo and marks only a confirmed delivery', async()=>{
  const workspace=await mkdtemp(join(tmpdir(),'alex-teaching-send-'));
  const job={id:'teaching:one',title:'English Teacher',company:'School',url:'https://example.org/job'};
  const pkg={currentVersion:1,quality:{applicationReady:true},posting:{text:'Apply by email to jobs@example.org.'}};
  const delivered=[];
  const sender={status:async()=>({configured:true,connected:true,email:'teaching@example.org'}),preview:async()=>({recipient:'jobs@example.org'}),validateRecipient:value=>value,verifyConnection:async()=>({email:'teaching@example.org'}),send:async()=>({messageId:'gmail-1',sentAt:new Date().toISOString(),to:'jobs@example.org'}),authorizationUrl:async()=>'',callback:async()=>({})};
  const applications={read:async()=>pkg};
  let manager;
  try{
    manager=createTeachingFastApplyManager({workspace,applications,getJob:id=>id===job.id?job:null,onDelivered:async(id,sent)=>delivered.push({id,sent}),sendService:sender,waitMs:100});
    await manager.ready;
    const input={to:'jobs@example.org',subject:'Teaching application',body:'Please find my reviewed teaching CV and letter attached.',language:'en',confirmed:true};
    const queued=await manager.queue(job,input);
    assert.equal(queued.status,'queued');
    assert.equal((await manager.undo(job.id)).status,'cancelled');
    assert.equal(delivered.length,0);
    await manager.queue(job,input);
    await new Promise(resolve=>setTimeout(resolve,180));
    assert.equal((await manager.pending(job.id)).status,'sent');
    assert.equal(delivered.length,1);
    await assert.rejects(manager.queue(job,input),/already queued, sent/);
    manager.close();
    manager=createTeachingFastApplyManager({workspace,applications,getJob:id=>id===job.id?job:null,onDelivered:async()=>{},sendService:sender,waitMs:100});
    await manager.ready;
    assert.equal((await manager.pending(job.id)).status,'sent');
  }finally{manager?.close();await rm(workspace,{recursive:true,force:true});}
});
