import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openJobDatabase } from './job-database.mjs';
import { teachingPaths } from './teaching-space.mjs';
import { teachingMonitor, validateTeachingBatch } from './teaching-gmail-monitor.mjs';

const eventAt='2026-10-20T09:00:00.000Z';
const batch={reviewedMessages:1,checkpointAt:'2026-10-20T10:00:00.000Z',events:[],jobs:[]};

test('Teaching Gmail batch rejects unverified jobs and non-Teaching roles',()=>{
  assert.throws(()=>validateTeachingBatch({...batch,jobs:[{gmailMessageId:'abcdefgh',url:'https://school.example/jobs/1',title:'English Teacher',company:'School',location:'Stuttgart',source:'School',provider:'School',verifiedAt:eventAt,originalTimestamp:eventAt,openStatus:'closed'}]}),/verified open/);
  assert.throws(()=>validateTeachingBatch({...batch,jobs:[{gmailMessageId:'abcdefgh',url:'https://school.example/jobs/1',title:'System Administrator',company:'School',location:'Stuttgart',source:'School',provider:'School',verifiedAt:new Date().toISOString(),originalTimestamp:eventAt,openStatus:'open'}]}),/Teaching scope/);
});

test('Teaching monitor keeps checkpoint and evidence isolated and recovery idempotent',async()=>{
  const workspace=await mkdtemp(join(tmpdir(),'teaching-gmail-'));
  try {
    const dbPath=teachingPaths(workspace).database;
    const db=openJobDatabase(dbPath);
    db.importAgentJobs([{id:'teaching:one',origin:'live',title:'English Teacher',company:'School',location:'Stuttgart',url:'https://school.example/jobs/1',source:'School',provider:'School',description:'English teaching',verifiedAt:eventAt}]);
    db.db.close();
    const input={...batch,events:[{jobId:'teaching:one',status:'Interviewing',gmailMessageId:'message12345',originalTimestamp:eventAt,comment:'Email evidence (Gmail JobMail): interview invitation from School.'}]};
    const payload=Buffer.from(JSON.stringify(input)).toString('base64url');
    assert.equal((await teachingMonitor('recover',workspace)).pending,false);
    assert.equal((await teachingMonitor('read',workspace)).checkpoint,null);
    await teachingMonitor('write',workspace,payload);
    const result=await teachingMonitor('run',workspace);
    assert.equal(result.lifecycleEvents,1);
    assert.equal((await teachingMonitor('read',workspace)).checkpoint.at,input.checkpointAt);
    const evidence=JSON.parse(await readFile(join(teachingPaths(workspace).state,'teaching-gmail-lifecycle-evidence.json'),'utf8'));
    assert.equal(evidence.length,1);
    const after=openJobDatabase(dbPath);
    assert.equal(after.getJob('teaching:one').applicationStatus,'Interviewing');
    assert.equal(after.db.prepare("SELECT COUNT(*) AS n FROM application_events WHERE source='gmail:teaching:message12345'").get().n,1);
    after.db.close();
    assert.equal((await teachingMonitor('recover',workspace)).pending,false);
  } finally {await rm(workspace,{recursive:true,force:true});}
});
