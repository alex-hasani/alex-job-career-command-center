import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openJobDatabase } from './job-database.mjs';
import { teachingPaths } from './teaching-space.mjs';

const statuses = new Set(['Applied', 'Interviewing', 'Offer', 'Rejected', 'Withdrawn', 'Case Closed']);
const checkpointKey = 'teaching_gmail_monitor_checkpoint';
const eventSource = id => `gmail:teaching:${id}`;
const key = event => `${event.gmailMessageId}\u0000${event.originalTimestamp}\u0000${event.status}`;
const digest = value => createHash('sha256').update(value).digest('hex');

function fail(message) { throw new Error(`Teaching Gmail monitor: ${message}`); }
function required(value, label, max=500) {
  const result=String(value || '').trim();
  if (!result || result.length>max) fail(`${label} is missing or too long`);
  return result;
}
function timestamp(value, label) {
  const date=new Date(value);
  if (!value || Number.isNaN(date.getTime())) fail(`${label} must be a timestamp`);
  return date.toISOString();
}
function exactUrl(value) {
  let url;
  try { url=new URL(value); } catch { fail('job URL must be an exact HTTPS posting'); }
  if (url.protocol!=='https:' || url.username || url.password || !url.pathname || url.pathname==='/' ||
      /\b(?:login|signin|search|suche|tracker|redirect|click)\b/i.test(url.pathname) ||
      /\/(?:jobs?|stellenangebote|karriere|careers?)\/?$/i.test(url.pathname)) fail('job URL must be an exact HTTPS posting');
  url.hash='';
  return url.href;
}
export function validateTeachingBatch(raw) {
  if (!raw || typeof raw!=='object' || Array.isArray(raw)) fail('batch must be an object');
  if (Object.keys(raw).some(name=>!['reviewedMessages','checkpointAt','events','jobs'].includes(name))) fail('unsupported batch field');
  if (!Number.isInteger(raw.reviewedMessages) || raw.reviewedMessages<0) fail('reviewedMessages must be non-negative');
  const checkpointAt=timestamp(raw.checkpointAt,'checkpointAt');
  if (Date.parse(checkpointAt)>Date.now()+60_000) fail('checkpointAt is in the future');
  if (!Array.isArray(raw.events) || raw.events.length>20) fail('events must have at most 20 items');
  if (!Array.isArray(raw.jobs) || raw.jobs.length>12) fail('jobs must have at most 12 items');
  const events=raw.events.map((event,index)=>{
    const gmailMessageId=required(event?.gmailMessageId,`events[${index}].gmailMessageId`,200);
    if (!/^[A-Za-z0-9_-]{8,}$/.test(gmailMessageId)) fail('invalid Gmail message ID');
    const status=required(event.status,`events[${index}].status`,50);
    if (!statuses.has(status)) fail('unsupported explicit lifecycle status');
    const comment=required(event.comment,`events[${index}].comment`,1500);
    if (!/^Email evidence(?: \(Gmail [^)]+\))?:/i.test(comment)) fail('event comment must describe email evidence');
    return {jobId:required(event.jobId,`events[${index}].jobId`,500),gmailMessageId,
      originalTimestamp:timestamp(event.originalTimestamp,`events[${index}].originalTimestamp`),status,comment};
  });
  if (new Set(events.map(key)).size!==events.length) fail('duplicate lifecycle event');
  const jobs=raw.jobs.map((job,index)=>{
    const gmailMessageId=required(job?.gmailMessageId,`jobs[${index}].gmailMessageId`,200);
    if (!/^[A-Za-z0-9_-]{8,}$/.test(gmailMessageId)) fail('invalid Gmail message ID');
    const verifiedAt=timestamp(job.verifiedAt,`jobs[${index}].verifiedAt`);
    if (job.openStatus!=='open' || Date.now()-Date.parse(verifiedAt)>24*60*60*1000) fail('posting must be recently verified open');
    const url=exactUrl(job.url);
    const title=required(job.title,`jobs[${index}].title`);
    if (!/\b(?:english|esl|efl|elt|teacher|teaching|tutor|trainer|instructor|educator|englisch|sprachtrainer|dozent|lehrkraft|instructional|education)\b/i.test(title)) fail('job is not in Teaching scope');
    return {id:`teaching:${url}`,origin:'live',url,title,company:required(job.company,`jobs[${index}].company`,300),
      location:required(job.location,`jobs[${index}].location`,300),source:required(job.source,`jobs[${index}].source`,200),
      provider:required(job.provider,`jobs[${index}].provider`,200),description:String(job.description||'').slice(0,12000),
      verifiedAt,jdFetched:true,jdSource:url,checkedAt:verifiedAt,posted:job.posted||'',
      gmailDiscovery:{messageId:gmailMessageId,originalTimestamp:timestamp(job.originalTimestamp,`jobs[${index}].originalTimestamp`)}};
  });
  if (new Set(jobs.map(job=>job.url)).size!==jobs.length) fail('duplicate exact posting URL');
  return {reviewedMessages:raw.reviewedMessages,checkpointAt,events,jobs};
}

async function atomicJson(path,value) {
  await mkdir(resolve(path,'..'),{recursive:true});
  const temporary=`${path}.${process.pid}.${randomUUID()}.tmp`;
  try { await writeFile(temporary,`${JSON.stringify(value,null,2)}\n`,{encoding:'utf8',flag:'wx'}); await rename(temporary,path); }
  finally { await rm(temporary,{force:true}); }
}
const readJson = async(path,fallback) => JSON.parse(await readFile(path,'utf8').catch(error=>{
  if(error.code==='ENOENT' && fallback!==undefined) return JSON.stringify(fallback);
  throw error;
}));
function locationsMatch(a,b) { return !a || !b || a.toLowerCase()===b.toLowerCase(); }

async function execute(paths,journal) {
  const db=openJobDatabase(paths.database);
  try {
    if (journal.stage==='prepared') {
      const evidence=await readJson(paths.evidence,[]);
      if (!Array.isArray(evidence)) fail('evidence file is invalid');
      const existing=new Set(evidence.map(key));
      const missing=journal.batch.events.filter(event=>!existing.has(key(event)));
      if(missing.length) await atomicJson(paths.evidence,[...evidence,...missing]);
      journal.stage='evidence_appended';
      await atomicJson(paths.journal,journal);
    }
    if (journal.stage==='evidence_appended') {
      for(const event of journal.batch.events) {
        const source=eventSource(event.gmailMessageId);
        if(db.db.prepare('SELECT 1 FROM application_events WHERE source=? LIMIT 1').get(source)) continue;
        const job=db.getJob(event.jobId);
        if(!job) fail(`lifecycle job ${event.jobId} is not in Teaching DB`);
        const previousAt=Date.parse(job.applicationStatusChangedAt || job.statusChangedAt || job.appliedAt || '');
        if(Number.isFinite(previousAt) && previousAt>Date.parse(event.originalTimestamp)) continue;
        db.updateApplication(event.jobId,{applicationStatus:event.status,applicationStatusChangedAt:event.originalTimestamp,
          appliedAt:event.status==='Applied' ? event.originalTimestamp : undefined,
          applicationComment:event.comment,recordEvent:true,changeSource:source});
        journal.applied=(journal.applied||0)+1;
      }
      journal.stage='events_applied';
      await atomicJson(paths.journal,journal);
    }
    if (journal.stage==='events_applied') {
      const before=db.stats().total;
      const jobs=journal.batch.jobs.filter(job=>{
        const found=db.db.prepare('SELECT location FROM jobs WHERE canonical_url=? LIMIT 1').get(job.url);
        return !found || locationsMatch(found.location,job.location);
      });
      if(jobs.length) db.importAgentJobs(jobs);
      journal.addedJobs=Math.max(0,db.stats().total-before);
      journal.updatedJobs=Math.max(0,jobs.length-journal.addedJobs);
      journal.stage='jobs_imported';
      await atomicJson(paths.journal,journal);
    }
    if(journal.stage==='jobs_imported') {
      const old=db.getMetadata(checkpointKey);
      const previous=old ? JSON.parse(old.value) : null;
      if(!previous || Date.parse(journal.batch.checkpointAt)>=Date.parse(previous.at))
        db.setMetadata(checkpointKey,JSON.stringify({at:journal.batch.checkpointAt,reviewedMessages:journal.batch.reviewedMessages,
          evidenceCount:journal.batch.events.length,jobCount:journal.batch.jobs.length,source:'Teaching Gmail status monitor'}));
      journal.stage='checkpointed';
      await atomicJson(paths.journal,journal);
    }
    if(journal.stage!=='checkpointed') fail(`unknown journal stage ${journal.stage}`);
    const result={ok:true,resumed:Boolean(journal.resumed),reviewedMessages:journal.batch.reviewedMessages,
      lifecycleEvents:journal.batch.events.length,addedJobs:journal.addedJobs||0,updatedJobs:journal.updatedJobs||0,
      checkpointAt:journal.batch.checkpointAt};
    await rm(paths.journal,{force:true});
    return result;
  } finally { db.db.close(); }
}

export async function teachingMonitor(command,workspace,encodedPayload='') {
  const base=teachingPaths(workspace);
  const paths={database:base.database,batch:join(base.state,'teaching-gmail-monitor-batch.json'),
    journal:join(base.state,'teaching-gmail-monitor-journal.json'),evidence:join(base.state,'teaching-gmail-lifecycle-evidence.json')};
  if(command==='read') {
    const db=openJobDatabase(paths.database);
    try { const row=db.getMetadata(checkpointKey); return {checkpoint:row?JSON.parse(row.value):null}; }
    finally {db.db.close();}
  }
  if(command==='write') {
    if(!encodedPayload) fail('write needs BASE64URL_JSON');
    let batch;
    try {batch=validateTeachingBatch(JSON.parse(Buffer.from(encodedPayload,'base64url').toString('utf8')));}
    catch(error) { fail(error.message); }
    if(await readFile(paths.journal,'utf8').then(()=>true,error=>error.code==='ENOENT'?false:Promise.reject(error))) fail('recover pending journal before writing');
    await atomicJson(paths.batch,batch);
    return {ok:true,events:batch.events.length,jobs:batch.jobs.length};
  }
  if(command==='recover') {
    const journal=await readJson(paths.journal,null);
    if(!journal) return {ok:true,pending:false};
    journal.resumed=true;
    await atomicJson(paths.journal,journal);
    return execute(paths,journal);
  }
  if(command!=='run') fail('command must be read, write, recover, or run');
  if(await readFile(paths.journal,'utf8').then(()=>true,error=>error.code==='ENOENT'?false:Promise.reject(error))) fail('recover pending journal before run');
  const batch=validateTeachingBatch(await readJson(paths.batch));
  const evidenceText=await readFile(paths.evidence,'utf8').catch(error=>error.code==='ENOENT'?'[]':Promise.reject(error));
  const journal={version:1,stage:'prepared',createdAt:new Date().toISOString(),evidenceDigest:digest(evidenceText),batch};
  await atomicJson(paths.journal,journal);
  return execute(paths,journal);
}

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const [command,workspace,encodedPayload]=process.argv.slice(2);
  try { console.log(JSON.stringify(await teachingMonitor(command,workspace,encodedPayload))); }
  catch(error) { console.error(error.message); process.exitCode=1; }
}
