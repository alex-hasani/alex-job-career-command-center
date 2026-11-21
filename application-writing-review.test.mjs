import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplicationWritingReviewer, hasCurrentWritingReview, assertWritingReview, WRITING_POLICY } from './application-writing-review.mjs';

const job={id:'fixture:1',title:'Infrastructure Engineer (m/w/d)',company:'Example Employer'};
const posting={text:'Windows and Linux administration, incident response and practical automation.'};
const documents={cv:{en:{body:'Example Candidate\nInfrastructure Engineer\nExample City\nContact withheld\nEXPERIENCE\nAdministrator | Example Employer | 2020-2024\n• Supported Windows and Linux servers.'}},coverLetter:{en:{body:`Dear Hiring Team,\n\nThe ${job.title} role involves the systems I work with. I support Windows and Linux servers and resolve incidents.\n\nKind regards`}},remarks:{en:{body:'I support Windows and Linux infrastructure.'}}};
const evidence={facts:['Supported Windows and Linux servers, 2020-2024.']};
const positionSlot='[[EXACT_ADVERTISED_POSITION]]';
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
  for(const [id,replace] of [['cv.en',s=>s.replace('2020-2024','2010-2024')],['coverLetter.en',s=>s.replace(positionSlot,'Different Role')],['cv.en',s=>s+' Extra text']]){
    const reviewer=createApplicationWritingReviewer({agent:async request=>{const result=await acceptingAgent(request);if(result.documents)result.documents.find(x=>x.id===id).body=replace(result.documents.find(x=>x.id===id).body);return result;}});
    await assert.rejects(reviewer({job,posting,documents,evidence,rewriteTypes:['coverLetter']}),/protected|position|scope/);
  }
});
test('a rejected rewrite gets one clean repair before independent review',async()=>{
  for(const [id,mutate,finding] of [
    ['cv.en',body=>body.replace('2020-2024','2010-2024'),/protected CV detail/],
    ['coverLetter.en',body=>body.replace(positionSlot,'Different Role'),/exact advertised position name/]
  ]){
    let writes=0,reviews=0;
    const reviewer=createApplicationWritingReviewer({agent:async request=>{
      if(!request.outputSchema.properties.documents){
        reviews++;
        assert.deepEqual(input(request.prompt).documents,input(request.prompt).originalDocuments);
        return {approved:true,findings:[]};
      }
      const {documents:draft}=await acceptingAgent(request);
      if(++writes===1){
        const item=draft.find(item=>item.id===id);
        item.body=mutate(item.body);
      }else{
        assert.match(request.prompt,finding);
        assert.deepEqual(draft.map(item=>({...item,body:item.body.replace(positionSlot,()=>job.title)})),input(request.prompt).originalDocuments);
      }
      return {documents:draft};
    }});
    const result=await reviewer({job,posting,documents,evidence});
    assert.equal(writes,2);
    assert.equal(reviews,1);
    assert.equal(hasCurrentWritingReview(job,result.documents,result.review),true);
  }
});
test('the app inserts the exact title in both languages before review, never the placeholder',async()=>{
  const advertised={...job,title:'Senior Cloud Operations Engineer (m/f/d)'};
  const bilingual=structuredClone(documents);
  bilingual.coverLetter.en.body=bilingual.coverLetter.en.body.replace(job.title,advertised.title);
  bilingual.coverLetter.de={body:`Sehr geehrtes Team,\n\nFür die Position ${advertised.title} bringe ich Erfahrung im Windows- und Linux-Betrieb mit.`};
  const reviewer=createApplicationWritingReviewer({agent:async request=>{
    const data=input(request.prompt);
    if(request.outputSchema.properties.documents){
      for(const doc of data.currentDocuments.filter(doc=>doc.id.startsWith('coverLetter.'))){
        assert.ok(doc.body.includes(positionSlot));
        assert.ok(!doc.body.includes(advertised.title));
      }
      return {documents:data.currentDocuments};
    }
    for(const doc of data.documents.filter(doc=>doc.id.startsWith('coverLetter.'))){
      assert.ok(doc.body.includes(advertised.title));
      assert.ok(!doc.body.includes(positionSlot));
    }
    return {approved:true,findings:[]};
  }});
  const result=await reviewer({job:advertised,posting,documents:bilingual,evidence});
  assert.deepEqual(result.documents,bilingual);
});
test('manual edits receive review only and are never silently rewritten',async()=>{
  let calls=0;
  const reviewer=createApplicationWritingReviewer({agent:async request=>{calls++;assert.equal(request.outputSchema.properties.documents,undefined);return {approved:true,findings:[]};}});
  const result=await reviewer({job,posting,documents,evidence,tailor:false});
  assert.equal(calls,1);assert.deepEqual(result.documents,documents);
  assert.match(WRITING_POLICY.prohibitions,/intentional errors/);
  assert.match(WRITING_POLICY.interest,/dream-company/);
});
