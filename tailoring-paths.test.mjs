import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createUserSpaceRouter,reviewProfileResumeDraft } from './user-space.mjs';
import { createApplicationWritingReviewer } from './application-writing-review.mjs';

test('Profile CV drafts use the shared writer and independent reviewer, with source-only evidence',async()=>{
  const calls=[];
  const reviewer=createApplicationWritingReviewer({agent:async request=>{
    calls.push(request);const input=JSON.parse(request.prompt.split('\nINPUT\n')[1]);
    assert.equal(input.evidence.sourceResume,'Example Candidate\nExample City\nContact withheld\nAdministrator\nSupported Linux servers.');
    assert.equal(input.evidence.profile.firstName,'Example');
    return request.outputSchema.properties.documents?{documents:input.currentDocuments}:{approved:true,findings:[]};
  }});
  const result=await reviewProfileResumeDraft('Example Candidate\nExample City\nContact withheld\nAdministrator\nSupported Linux servers.','Linux administration vacancy',{firstName:'Example'},reviewer);
  assert.equal(calls.length,2);assert.equal(result.writingReview.approved,true);
  assert.match(result.atsText,/Supported Linux/);
  await assert.rejects(reviewProfileResumeDraft('Example Candidate\nExample City\nSupported Linux servers.','','',async()=>{throw new Error('Review unavailable');}),/Review unavailable/);
});

test('Only the protected account helper is routed to its canonical reviewed packages',async()=>{
  const workspace=await mkdtemp(join(tmpdir(),'tailoring-account-boundary-'));
  const router=createUserSpaceRouter({root:workspace,workspace});
  try{
    const at='2026-01-01T00:00:00Z';
    for(const id of ['owner','other']){
      router.db.prepare('INSERT INTO users(id,username,display_name,role,password_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id,id,id,'user','fixture',at,at);
      router.db.prepare('INSERT INTO browser_extensions(id,user_id,public_id,token_hash,manifest_key,created_at) VALUES(?,?,?,?,?,?)').run(id,id,`helper_${id}`,createHash('sha256').update('fixture-token').digest('hex'),'fixture',at);
    }
    router.db.prepare('INSERT OR REPLACE INTO user_space_settings(key,value,updated_at) VALUES(?,?,?)').run('global_admin_user_id','owner',at);
    const context=id=>router.extensionContext({headers:{'x-alex-job-extension-id':`helper_${id}`,'x-alex-job-extension-token':'fixture-token'}});
    assert.equal(context('owner').usesCanonicalApplicationEvidence,true);
    assert.equal(context('other').usesCanonicalApplicationEvidence,false);
    assert.equal(context('other').profile.identity.email,'');
  }finally{router.close();await rm(workspace,{recursive:true,force:true});}
});

test('extension retries and both website agents retain the shared reviewed-document path',async()=>{
  const server=await readFile(new URL('./server.mjs',import.meta.url),'utf8');
  assert.match(server,/coverLetters:account\.usesCanonicalApplicationEvidence\?coverLetters:null/);
  assert.match(server,/if\(account&&!account\.usesCanonicalApplicationEvidence\)/);
  assert.match(server,/await agent\.attach\(job\.id,preparedJob,applicationPackage/);
  for(const file of ['./website-apply-agent.mjs','./teaching-tools/website-apply-agent.mjs']){
    const source=await readFile(new URL(file,import.meta.url),'utf8');
    assert.match(source,/applicationPackage\?\.documents\?\.remarks\?\.\[lang\]\?\.body/);
    assert.match(source,/applicationPackage\.currentVersion,notes\)/);
    assert.match(source,/coverLetters\.download\(job,lang,'pdf','cv'/);
    assert.match(source,/reviewedNotes===null\?applicationNote/);
  }
});
