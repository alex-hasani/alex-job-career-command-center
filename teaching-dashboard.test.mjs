import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTeachingDashboard, verifiedTeachingPosting } from './teaching-dashboard.mjs';

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
    assert.equal(dashboard.overview instanceof Function,true);
    const updated=dashboard.updateStatus(result.jobs[0].id,'Applied','Sent through employer portal');
    assert.equal(updated.applicationStatus,'Applied');
    const noted=dashboard.updateStatus(result.jobs[0].id,'Applied','Confirmed note');
    assert.equal(noted.applicationStatusChangedAt,updated.applicationStatusChangedAt);
    assert.equal(noted.applicationComment,'Confirmed note');
    assert.equal((await dashboard.overview()).savedSearches.length,1);
    assert.equal(dashboard.deleteSearch(saved.id),true);
    assert.equal(existsSync(dashboard.databasePath),true);
    assert.equal(existsSync(join(workspace,'State','job_search.sqlite')),false);
    assert.equal(existsSync(join(workspace,'State','cv_command_center_state.json')),false);
  }finally{dashboard.close();await rm(workspace,{recursive:true,force:true});}
});

test('Teaching dashboard keeps the IT dashboard structure without IT API calls',async()=>{
  const markup=await readFile(new URL('./teaching.html',import.meta.url),'utf8');
  const script=await readFile(new URL('./teaching.js',import.meta.url),'utf8');
  for(const id of ['filters','refresh','count','sources','search','listView','boardView','jobs','sites','documents'])assert.match(markup,new RegExp(`id="${id}"`));
  assert.match(script,/\/api\/user-space\/teaching-overview/);
  assert.match(script,/\/api\/user-space\/teaching-refresh/);
  assert.doesNotMatch(script,/fetch\([`'"]\/api\/(?:jobs|refresh|application-status|saved-searches)/);
});
