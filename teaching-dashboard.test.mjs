import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTeachingDashboard, verifiedTeachingPosting } from './teaching-dashboard.mjs';
import { filterTeachingJobs, teachingFilterIds } from './teaching-filter-logic.js';

const page='https://school.example/jobs/english-teacher';
const posting={
  '@context':'https://schema.org','@type':'JobPosting',title:'English Teacher',
  hiringOrganization:{name:'Example Language School'},
  jobLocation:{address:{addressLocality:'Stuttgart',addressCountry:'DE'}},
  url:page,datePosted:'2026-10-22',description:'Teach English to young learners and prepare lesson plans.',employmentType:'Full-time'
};
const html=job=>`<html><script type="application/ld+json">${JSON.stringify(job)}</script></html>`;

test('Teaching import accepts only exact, open, suitable posting pages',()=>{
  assert.equal(verifiedTeachingPosting(html(posting),page,'Example School')?.title,'English Teacher');
  assert.equal(verifiedTeachingPosting(`<script id="posting" type="application/ld+json">${JSON.stringify({...posting,'@type':['JobPosting']})}</script>`,page,'Example School')?.title,'English Teacher');
  assert.equal(verifiedTeachingPosting(html(posting),'https://school.example/jobs/search','Example School'),null);
  assert.equal(verifiedTeachingPosting(html({...posting,url:'https://school.example/jobs/other'}),page,'Example School'),null);
  assert.equal(verifiedTeachingPosting(html({...posting,validThrough:'2020-01-01'}),page,'Example School'),null);
  assert.equal(verifiedTeachingPosting(html({...posting,description:'German C1 required.'}),page,'Example School'),null);
  assert.equal(verifiedTeachingPosting(html({...posting,title:'IT Administrator'}),page,'Example School'),null);
  assert.equal(verifiedTeachingPosting('Sign in to continue '+html(posting),page,'Example School'),null);
  assert.equal(verifiedTeachingPosting(html({...posting,jobLocation:{address:{addressLocality:'London',addressCountry:'UK'}}}),page,'Example School'),null);
});

test('Teaching refresh, saved searches and applications stay in Teaching SQLite only',async()=>{
  const workspace=await mkdtemp(join(tmpdir(),'alex-job-teaching-dashboard-'));
  const configDir=join(workspace,'Teaching_Job_Search');
  await mkdir(configDir,{recursive:true});await mkdir(join(workspace,'Documents','Teaching'),{recursive:true});
  await mkdir(join(workspace,'State'),{recursive:true});
  await writeFile(join(workspace,'State','job_search.sqlite'),'IT-DB-SENTINEL');
  await writeFile(join(configDir,'teaching-search-config.json'),JSON.stringify({targetRegion:'Stuttgart',keywords:['English teacher'],officialSources:[{name:'Example School',url:'https://school.example/careers'}]}));
  const calls=[];
  const fetchImpl=async url=>{
    calls.push(url);
    const body=url===page?html(posting):'<html><a href="/jobs/english-teacher">English Teacher</a></html>';
    return {ok:true,headers:{get:name=>name==='content-type'?'text/html':' '},text:async()=>body};
  };
  const dashboard=createTeachingDashboard({workspace,fetchImpl});
  try{
    const result=await dashboard.refresh({query:'English teacher',location:'Stuttgart'});
    assert.equal(result.verified,1);
    assert.equal(result.jobs.length,1);
    assert.equal(result.jobs[0].company,'Example Language School');
    assert.ok(calls.includes(page));
    const saved=dashboard.saveSearch('English in Stuttgart',{query:'English teacher'});
    assert.equal(saved.name,'English in Stuttgart');
    assert.equal((await dashboard.overview()).activeSavedSearchId,saved.id);
    assert.equal(dashboard.setActiveSearch(''),'');
    assert.equal((await dashboard.overview()).activeSavedSearchId,'');
    assert.equal(dashboard.overview instanceof Function,true);
    const updated=dashboard.updateStatus(result.jobs[0].id,'Applied','Sent through employer portal');
    assert.equal(updated.applicationStatus,'Applied');
    const noted=dashboard.updateStatus(result.jobs[0].id,'Applied','Confirmed note');
    assert.equal(noted.applicationStatusChangedAt,updated.applicationStatusChangedAt);
    assert.equal(noted.applicationComment,'Confirmed note');
    assert.equal((await dashboard.overview()).savedSearches.length,1);
    const firstRun=dashboard.startRefresh({query:'English teacher',location:'Stuttgart'});
    const concurrent=dashboard.startRefresh({query:'English teacher',location:'Stuttgart'});
    assert.equal(firstRun.id,concurrent.id);
    await new Promise(resolve=>setTimeout(resolve,30));
    assert.equal(dashboard.getRefresh(firstRun.id).status,'completed');
    assert.equal(dashboard.getRefresh(firstRun.id).result.jobs[0].applicationStatus,'Applied');
    assert.equal(dashboard.deleteSearch(saved.id),true);
    assert.equal(existsSync(dashboard.databasePath),true);
    assert.equal(await readFile(join(workspace,'State','job_search.sqlite'),'utf8'),'IT-DB-SENTINEL');
    assert.equal(existsSync(join(workspace,'State','cv_command_center_state.json')),false);
  }finally{dashboard.close();await rm(workspace,{recursive:true,force:true});}
});

test('Teaching dashboard keeps the IT dashboard structure without IT API calls',async()=>{
  const markup=await readFile(new URL('./teaching.html',import.meta.url),'utf8');
  const script=await readFile(new URL('./teaching.js',import.meta.url),'utf8');
  for(const id of ['filters','refresh','count','sources','search','listView','boardView','jobs','sites','documents'])assert.match(markup,new RegExp(`id="${id}"`));
  for(const id of teachingFilterIds)assert.match(markup,new RegExp(`id="${id}"`));
  for(const id of ['queue','refreshProgress','outcomeSummary','copy','weightGrid'])assert.match(markup,new RegExp(`id="${id}"`));
  assert.match(script,/refresh\('automatic'\)/);
  assert.match(script,/teaching-saved-searches\/active/);
  assert.match(script,/\/api\/user-space\/teaching-overview/);
  assert.match(script,/\/api\/user-space\/teaching-refresh/);
  assert.doesNotMatch(script,/fetch\([`'"]\/api\/(?:jobs|refresh|application-status|saved-searches)/);
});

test('Teaching criteria use the IT Boolean, strict-city, remote, salary and status rules',()=>{
  const jobs=[
    {id:'1',title:'English Teacher',description:'ESL classroom teaching',company:'School',location:'Stuttgart, DE',source:'School',rawLanguage:'English accepted',workType:'Full-time',salaryMin:35000,posted:'2026-10-22',remote:false,applicationStatus:'Preparing',active:true,interviewFitScore:80,recommendation:'APPLY',opportunityQualityScore:75,url:'https://school.example/job'},
    {id:'2',title:'English Tutor',description:'Online ESL lessons',company:'Academy',location:'Remote Germany',source:'Academy',rawLanguage:'English accepted',workType:'Part-time',posted:'2026-10-22',remote:true,applicationStatus:'Not recorded',active:true,interviewFitScore:73,recommendation:'APPLY',opportunityQualityScore:70,url:'https://academy.example/job'}
  ];
  const criteria={query:'English AND NOT manager',location:'Stuttgart',match:'70',stream:'live'};
  assert.deepEqual(filterTeachingJobs(jobs,criteria,['Stuttgart','Berlin'],Date.parse('2026-10-23')).map(job=>job.id),['1']);
  assert.deepEqual(filterTeachingJobs(jobs,{...criteria,includeRemoteAnywhere:true},['Stuttgart','Berlin'],Date.parse('2026-10-23')).map(job=>job.id),['1','2']);
  assert.deepEqual(filterTeachingJobs(jobs,{...criteria,salary:'40000'},['Stuttgart'],Date.parse('2026-10-23')),[]);
  assert.deepEqual(filterTeachingJobs(jobs,{location:'Germany',applicationStatus:'Preparing'},[],Date.parse('2026-10-23')).map(job=>job.id),['1']);
});
