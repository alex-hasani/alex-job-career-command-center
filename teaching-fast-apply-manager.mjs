import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { teachingPaths } from './teaching-space.mjs';
import { createFastApplyService } from './teaching-tools/fast-apply-service.mjs';

const WAIT_MS=15_000;
const MAX_PER_DAY=10;
const berlinDay=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

export function createTeachingFastApplyManager({workspace,applications,getJob,onDelivered,senderName='Demo Candidate',sendService=null,waitMs=WAIT_MS}) {
  const paths=teachingPaths(workspace);
  const journal=join(paths.state,'fast-apply-journal.json');
  const sender=sendService||createFastApplyService({root:join(import.meta.dirname),workspace,coverLetters:applications,senderEmail:'',senderName});
  const entries=new Map(),timers=new Map();
  let serial=Promise.resolve();
  function save() {
    serial=serial.catch(()=>{}).then(async()=>{
      await mkdir(paths.state,{recursive:true});
      const temp=`${journal}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(temp,JSON.stringify([...entries.values()],null,2),'utf8');
      await rename(temp,journal);
    });
    return serial;
  }
  function display(entry) {
    if(!entry)return null;
    const {jobId,status,queuedAt,dueAt,sentAt,to,subject,language,delivery,error}=entry;
    return {jobId,status,queuedAt,dueAt,sentAt,to,subject,language,delivery,error};
  }
  function countToday() {return [...entries.values()].filter(entry=>entry.status==='sent'&&entry.sentAt&&new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(entry.sentAt))===berlinDay()).length;}
  async function deliver(jobId) {
    await ready;
    const entry=entries.get(jobId);
    if(!entry||entry.status!=='queued')return;
    const job=getJob(jobId),pkg=job&&await applications.read(job);
    if(!job||!pkg||pkg.currentVersion!==entry.packageVersion){entry.status='cancelled';entry.error='The Teaching job or documents changed before delivery';await save();return;}
    entry.status='sending';await save();
    try {
      const sent=await sender.send(job,pkg,{...entry.input,confirmed:true});
      entry.status='sent';entry.sentAt=sent.sentAt;entry.delivery=sent;delete entry.input;
      await save();
      try {await onDelivered(jobId,sent);} catch(error) {entry.error=`Sent, but Teaching status needs reconciliation: ${error.message}`;await save();}
    } catch(error) {
      // Once a Gmail send begins, a lost response cannot prove non-delivery.
      // Never retry automatically or claim a definite failure.
      entry.status='uncertain';entry.error=`Delivery could not be confirmed: ${error.message}`;
      delete entry.input;await save();
    }
  }
  function schedule(entry) {
    clearTimeout(timers.get(entry.jobId));
    const timer=setTimeout(()=>{timers.delete(entry.jobId);deliver(entry.jobId).catch(()=>{});},Math.max(0,Date.parse(entry.dueAt)-Date.now()));
    timers.set(entry.jobId,timer);
  }
  const ready=(async()=>{
    let loaded=[];
    try{loaded=JSON.parse(await readFile(journal,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
    if(!Array.isArray(loaded))throw new Error('Teaching Fast Apply journal is invalid');
    for(const entry of loaded){if(entry?.jobId)entries.set(entry.jobId,entry);}
    let changed=false;
    for(const entry of entries.values()){
      if(entry.status==='sending'){entry.status='uncertain';entry.error='App restarted during Gmail delivery. Check Sent mail before any retry.';changed=true;}
      if(entry.status==='queued')schedule(entry);
      if(entry.status==='sent'&&entry.delivery)try{await onDelivered(entry.jobId,entry.delivery);}catch{}
    }
    if(changed)await save();
  })();
  async function preview(job,language='',recipient='') {
    await ready;
    const pkg=await applications.read(job);
    if(!pkg)throw new Error('Prepare and review the Teaching documents first');
    return {preview:await sender.preview(job,pkg,language,recipient),pending:display(entries.get(job.id)),remaining:Math.max(0,MAX_PER_DAY-countToday())};
  }
  async function queue(job,input) {
    await ready;
    if(input.confirmed!==true)throw new Error('Final send confirmation is required');
    const prior=entries.get(job.id);
    if(prior&&['queued','sending','sent','uncertain'].includes(prior.status))throw new Error('This Teaching application is already queued, sent, or needs a delivery check');
    if(countToday()>=MAX_PER_DAY)throw new Error('Teaching Gmail daily send limit reached');
    const pkg=await applications.read(job);
    if(!pkg?.quality?.applicationReady)throw new Error('Prepare the Teaching documents first');
    sender.validateRecipient(input.to);
    await sender.verifyConnection();
    const entry={jobId:job.id,status:'queued',queuedAt:new Date().toISOString(),dueAt:new Date(Date.now()+waitMs).toISOString(),to:String(input.to).toLowerCase(),subject:String(input.subject||''),language:input.language||'en',packageVersion:pkg.currentVersion,input:{to:String(input.to),subject:String(input.subject),body:String(input.body),language:input.language||'en'}};
    entries.set(job.id,entry);await save();schedule(entry);
    return display(entry);
  }
  async function undo(jobId) {
    await ready;
    const entry=entries.get(jobId);
    if(!entry||entry.status!=='queued')throw new Error('The 15-second Undo window has ended');
    clearTimeout(timers.get(jobId));timers.delete(jobId);
    entry.status='cancelled';delete entry.input;await save();return display(entry);
  }
  return {ready,status:async()=>{await ready;return {gmail:await sender.status(),remaining:Math.max(0,MAX_PER_DAY-countToday())};},preview,queue,undo,pending:async id=>{await ready;return display(entries.get(id));},close:()=>{for(const timer of timers.values())clearTimeout(timer);timers.clear();}};
}
