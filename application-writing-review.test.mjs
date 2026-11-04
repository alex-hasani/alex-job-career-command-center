import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplicationWritingReviewer, hasCurrentWritingReview, assertWritingReview, WRITING_POLICY } from './application-writing-review.mjs';

const job={id:'fixture:1',title:'Infrastructure Engineer (m/w/d)',company:'Example Employer'};
const posting={text:'Windows and Linux administration, incident response and practical automation.'};
const documents={cv:{en:{body:'Example Candidate\nInfrastructure Engineer\nExample City\nContact withheld\nEXPERIENCE\nAdministrator | Example Employer | 2020-2024\n• Supported Windows and Linux servers.'}},coverLetter:{en:{body:`Dear Hiring Team,\n\nThe ${job.title} role involves the systems I work with. I support Windows and Linux servers and resolve incidents.\n\nKind regards`}},remarks:{en:{body:'I support Windows and Linux infrastructure.'}}};
const evidence={facts:['Supported Windows and Linux servers, 2020-2024.']};
const input=prompt=>JSON.parse(prompt.split('\nINPUT\n')[1]);
export const acceptingAgent=async({prompt,outputSchema})=>outputSchema.properties.documents?{documents:input(prompt).currentDocuments}:{approved:true,findings:[]};

test('writer and independent reviewer run separately before approval',async()=>{
  const calls=[];
  const review=createApplicationWritingReviewer({agent:async request=>{calls.push(request);return acceptingAgent(request);}});
  const result=await review({job,posting,documents,evidence});
  assert.equal(calls.length,2);
  assert.match(calls[0].prompt,/fully tailoring/);
  assert.match(calls[1].prompt,/independent application reviewer/);
  assert.match(calls[1].prompt,/untrusted data/);
  assert.equal(result.review.rounds,1);
  assert.equal(hasCurrentWritingReview(job,result.documents,result.review),true);
  result.documents.cv.en.body+=' Changed';
  assert.equal(hasCurrentWritingReview(job,result.documents,result.review),false);
  assert.throws(()=>assertWritingReview(job,result.documents,result.review),/fresh Codex/);
});
test('review rejection triggers a repair and fresh review, bounded to two rounds',async()=>{
  let reviews=0,calls=0;
  const review=createApplicationWritingReviewer({agent:async request=>{calls++;if(request.outputSchema.properties.documents)return acceptingAgent(request);reviews++;return {approved:reviews===2,findings:reviews===1?['Use plainer wording']:[]};}});
  const result=await review({job,posting,documents,evidence});
  assert.equal(calls,4);assert.equal(result.review.rounds,2);
});
test('rejected, missing or failed review never produces approval',async()=>{
  for(const reply of [{approved:false,findings:['Unsupported claim']},{approved:true,findings:['Still needs work']},{approved:'yes',findings:[]}]){
    const reviewer=createApplicationWritingReviewer({agent:async request=>request.outputSchema.properties.documents?acceptingAgent(request):reply});
    await assert.rejects(reviewer({job,posting,documents,evidence}),/review|invalid/i);
  }
  const reviewer=createApplicationWritingReviewer({agent:async()=>{throw new Error('Offline');}});
  await assert.rejects(reviewer({job,posting,documents,evidence}),/Offline/);
  assert.equal(hasCurrentWritingReview(job,documents,null),false);
});
test('writer cannot change protected history, position name or regeneration scope',async()=>{
  for(const [id,replace] of [['cv.en',s=>s.replace('2020-2024','2010-2024')],['coverLetter.en',s=>s.replace(job.title,'Different Role')],['cv.en',s=>s+' Extra text']]){
    const reviewer=createApplicationWritingReviewer({agent:async request=>{const result=await acceptingAgent(request);if(result.documents)result.documents.find(x=>x.id===id).body=replace(result.documents.find(x=>x.id===id).body);return result;}});
    await assert.rejects(reviewer({job,posting,documents,evidence,rewriteTypes:['coverLetter']}),/protected|position|scope/);
  }
});
test('manual edits receive review only and are never silently rewritten',async()=>{
  let calls=0;
  const reviewer=createApplicationWritingReviewer({agent:async request=>{calls++;assert.equal(request.outputSchema.properties.documents,undefined);return {approved:true,findings:[]};}});
  const result=await reviewer({job,posting,documents,evidence,tailor:false});
  assert.equal(calls,1);assert.deepEqual(result.documents,documents);
  assert.match(WRITING_POLICY.prohibitions,/intentional errors/);
  assert.match(WRITING_POLICY.interest,/dream-company/);
});
