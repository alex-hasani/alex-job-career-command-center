import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createFastApplyService, fastApplyInternals } from './fast-apply-service.mjs';
import { extractGoogleResultUrls } from './cover-letter-generator.mjs';

test('recipient discovery keeps application contacts and rejects delivery/privacy addresses', () => {
  const found = fastApplyInternals.candidates(
    { recruiterContact:'Recruiter: jobs@example.org; noreply@example.org' },
    'Apply via hiring@example.org. Privacy: datenschutz@example.org'
  );
  assert.deepEqual(found, [
    { email:'jobs@example.org', source:'saved recruiter contact' },
    { email:'hiring@example.org', source:'verified job description' }
  ]);
  assert.throws(() => fastApplyInternals.validRecipient('noreply@example.org'), /recruiter or application email/i);
});

test('email copy uses the supplied canonical sender name and selected language', () => {
  const job = { title:'Infrastructure Engineer', company:'Example GmbH' };
  assert.match(fastApplyInternals.copy(job,'de','Verified Candidate').body, /Verified Candidate$/);
  assert.match(fastApplyInternals.copy(job,'en','Verified Candidate').subject, /^Application for/);
});

test('MIME payload contains both reviewed PDF attachments', () => {
  const raw = fastApplyInternals.mime({
    from:'candidate@example.org',
    to:'jobs@example.org',
    subject:'Application',
    body:'Reviewed message',
    files:[
      { fileName:'CV.pdf', contentType:'application/pdf', bytes:Buffer.from('%PDF-cv') },
      { fileName:'Cover-Letter.pdf', contentType:'application/pdf', bytes:Buffer.from('%PDF-letter') }
    ]
  });
  const decoded = Buffer.from(raw.replace(/-/g,'+').replace(/_/g,'/'),'base64').toString('utf8');
  assert.match(decoded, /filename="CV\.pdf"/);
  assert.match(decoded, /filename="Cover-Letter\.pdf"/);
});

test('Google result extraction keeps external posting URLs and removes Google links', () => {
  const html = '<a href="/url?q=https%3A%2F%2Fcareers.example.org%2Fjobs%2F123&sa=U">Role</a><a href="https://www.google.com/preferences">Settings</a>';
  assert.deepEqual(extractGoogleResultUrls(html).map(url => url.href), ['https://careers.example.org/jobs/123']);
});

test('preview is editable, lists both PDFs and never requires Gmail to be connected', async () => {
  const service = createFastApplyService({ root:'X:/missing-fast-apply-config', workspace:'X:/missing-fast-apply-state', coverLetters:{}, senderEmail:'candidate@example.org', senderName:'Verified Candidate' });
  const pkg = { quality:{ applicationReady:true }, posting:{ text:'Aufgaben Anforderungen und Erfahrung Betrieb Systeme' }, documents:{ cv:{ de:{ document:{ fileName:'CV_DE.docx' } } }, coverLetter:{ de:{ document:{ fileName:'Letter_DE.docx' } } } } };
  const preview = await service.preview({ title:'System Engineer', company:'Example GmbH', recruiterContact:'jobs@example.org' },pkg,'de');
  assert.equal(preview.gmail.connected,false);
  assert.equal(preview.recipient,'jobs@example.org');
  assert.deepEqual(preview.attachments.map(item => item.fileName),['CV_DE.pdf','Letter_DE.pdf']);
  assert.match(preview.body,/Verified Candidate$/);
});
