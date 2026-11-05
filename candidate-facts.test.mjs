import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {applyCurrentCandidateFacts,readCurrentCandidateFacts} from './candidate-facts.mjs';
import {createApplicationWritingReviewer} from './application-writing-review.mjs';

const facts={german:{level:'B1',courseCompleted:true,source:'user_confirmed'}};
test('confirmed completion removes stale IT and Teaching qualifiers without upgrading German',()=>{
  for(const source of ['Deutsch: B1 (Kurs nahezu abgeschlossen); B2 geplant.','German: B1 (course nearly completed); B2 planned.','Deutsch: B1-Kurs fast abgeschlossen, B2 geplant.','German: B1 course nearly completed, B2 planned.','My German level is B1; the B1 course is nearly complete, and B2 is planned.']){
    const updated=applyCurrentCandidateFacts(source,facts);
    assert.match(updated,/B1/);assert.doesNotMatch(updated,/nearly|fast abgeschlossen|nahezu|certificate|zertifikat/i);
  }
  assert.equal(applyCurrentCandidateFacts('German: B1 course nearly completed.',{}),'German: B1 course nearly completed.');
});
test('writer and reviewer receive the current correction and normalized draft',async()=>{
  const workspace=await mkdtemp(join(tmpdir(),'candidate-fact-test-'));
  try{
    await mkdir(join(workspace,'Config'));
    await writeFile(join(workspace,'Config','candidate-facts.json'),JSON.stringify(facts));
    assert.deepEqual(await readCurrentCandidateFacts(workspace),facts);
    let calls=0;
    const reviewer=createApplicationWritingReviewer({workspace,agent:async({prompt,outputSchema})=>{
      calls++;const input=JSON.parse(prompt.split('\nINPUT\n')[1]);
      assert.deepEqual(input.currentUserConfirmedFacts,facts);
      assert.doesNotMatch(input.originalDocuments[0].body,/nearly completed/);
      return outputSchema.properties.documents?{documents:input.currentDocuments}:{approved:true,findings:[]};
    }});
    const result=await reviewer({job:{id:'fixture',title:'Role',company:'Example'},posting:{text:'Role description'},documents:{cv:{en:{body:'Example Candidate\nRole\nLocation\nContact\nGerman: B1 course nearly completed, B2 planned.'}}},evidence:{oldSource:'German: B1 course nearly completed.'}});
    assert.equal(calls,2);assert.match(result.documents.cv.en.body,/German: B1, B2 planned/);
  }finally{await rm(workspace,{recursive:true,force:true});}
});
