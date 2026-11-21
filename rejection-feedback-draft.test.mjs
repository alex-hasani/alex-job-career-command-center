import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { buildRejectionFeedbackDraft } from './rejection-feedback-draft.js';

test('English and German feedback drafts request the reason politely and acknowledge the recipient owes no reply',async()=>{
  const job={title:'English Teacher',applicationStatus:'Rejected'};
  const en=buildRejectionFeedbackDraft({job,greetingName:'Jordan',signature:'Candidate'});
  assert.match(en,/Hello Jordan/);
  assert.match(en,/what influenced the decision/);
  assert.match(en,/not obliged to provide individual feedback/);
  assert.match(en,/help me see where I can improve/);
  assert.match(en,/Best regards,\nCandidate$/);
  const de=buildRejectionFeedbackDraft({job,language:'de'});
  assert.match(de,/was für Ihre Entscheidung ausschlaggebend war/);
  assert.match(de,/nicht verpflichtet sind/);
  assert.match(de,/woran ich arbeiten kann/);
  assert.throws(()=>buildRejectionFeedbackDraft({job:{...job,applicationStatus:'Applied'}}),/rejected applications/);
  const [it,teaching,source]=await Promise.all(['index.html','teaching.js','rejection-feedback-draft.js'].map(file=>readFile(new URL(file,import.meta.url),'utf8')));
  assert.match(it,/applicationStatus === "Rejected"[^\n]+Draft feedback reply/);
  assert.match(teaching,/applicationStatus==='Rejected'[\s\S]+Draft feedback reply/);
  assert.doesNotMatch(source,/\bfetch\(|mailto:|\.submit\(/);
});
