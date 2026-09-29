import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { createFastApplyService, fastApplyInternals } from './fast-apply-service.mjs';
import { extractGoogleResultUrls, isCompleteJobDescription } from './cover-letter-generator.mjs';
import { fieldKindForHint, websiteApplyInternals } from './website-apply-agent.mjs';

test('recipient discovery keeps application contacts and rejects delivery/privacy addresses', () => {
  const found = fastApplyInternals.candidates(
    { recruiterContact:'Recruiter: jobs@example.org; noreply@example.org' },
    'Apply via hiring@example.org. Privacy: datenschutz@example.org'
  );
  assert.deepEqual(found, [
    { email:'hiring@example.org', source:'verified job description' },
    { email:'jobs@example.org', source:'saved recruiter contact' }
  ]);
  assert.throws(() => fastApplyInternals.validRecipient('noreply@example.org'), /recruiter or application email/i);
});

test('job-description recipient overrides a conflicting saved contact', () => {
  const posting = 'Bewerbungen bitte an applications@example.org';
  const found = fastApplyInternals.candidates({ recruiterContact:'previous-contact@example.org' }, posting);
  assert.equal(found[0].email, 'applications@example.org');
  assert.deepEqual(fastApplyInternals.postingRecipients(posting), ['applications@example.org']);
});
test('German challenge and qualification sections count as a complete advert', () => {
  const text=`IT-Systemadministrator Microsoft 365. Die Herausforderungen dieses IT-Jobs. ${'Betreuung und Administration von Microsoft Systemen und Mitarbeit an Infrastruktur-Projekten. '.repeat(18)} Deine Qualifikation für diesen IT-Job. Erfahrung und Kenntnisse in Microsoft 365, Intune, Active Directory und Entra ID.`;
  assert.equal(isCompleteJobDescription(text),true);
});
test('website agent recognises common ATS fields and keeps continuation separate from submission', () => {
  assert.equal(fieldKindForHint('Vorname / First name'),'firstName');
  assert.equal(fieldKindForHint('Gehaltsvorstellung'),'salary');
  assert.equal(fieldKindForHint('Straße'),'street');
  assert.equal(fieldKindForHint('PLZ'),'postalCode');
  assert.equal(fieldKindForHint('Deine Anmerkungen'),'notes');
  assert.equal(fieldKindForHint('Legal first name'),'legalFirstName');
  assert.equal(fieldKindForHint('Anrede'),'salutation');
  assert.equal(fieldKindForHint('Staatsangehörigkeit'),'nationality');
  assert.equal(fieldKindForHint('Geburtsdatum'),'birthDate');
  assert.equal(fieldKindForHint('Höchster Abschluss'),'highestQualification');
  assert.equal(fieldKindForHint('Führerschein'),'drivingLicence');
  assert.equal(fieldKindForHint('Umzugsbereitschaft'),'relocation');
  assert.equal(fieldKindForHint('Reisebereitschaft'),'businessTravel');
  assert.equal(fieldKindForHint('Visa sponsorship required'),'sponsorshipRequired');
  assert.equal(fieldKindForHint('Aufenthaltstitel'),'residencePermit');
  assert.equal(websiteApplyInternals().fileKindForHint('Lebenslauf hochladen'),'cv');
  assert.equal(websiteApplyInternals().fileKindForHint('Weitere Dokumente'),'cv');
  assert.equal(websiteApplyInternals().fileKindForHint('Anschreiben'),'letter');
  const uploaded=new Set(['cv']);
  assert.equal(websiteApplyInternals().nextUploadKind('Weitere Dokumente',uploaded),'');
  assert.equal(websiteApplyInternals().nextUploadKind('Anschreiben',uploaded),'letter');
  assert.match(websiteApplyInternals().applicationNote({title:'Modern Workplace Administrator',company:'Example GmbH',description:'Microsoft 365 Intune Entra ID'},'de','Sample Candidate','In drei Monaten.'),/Microsoft 365, Intune, Entra ID/);
  assert.match('Continue',websiteApplyInternals().ADVANCE);
  assert.doesNotMatch('Continue',websiteApplyInternals().FINAL);
  assert.ok(websiteApplyInternals().applicationCandidateScore({text:'Jetzt bewerben',href:'https://ats.example/apply/123'})>100);
  assert.equal(websiteApplyInternals().applicationCandidateScore({text:'Datenschutz',href:'https://example.org/privacy'}),-100);
  assert.equal(websiteApplyInternals().isLegalConsentHint('Ich stimme der Datenschutzerklärung zu'),true);
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
    bcc:'candidate-copy@example.org',
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
  assert.match(decoded, /Bcc: candidate-copy@example\.org/);
});

test('Fast Apply rejects non-PDF attachments before Gmail delivery', () => {
  assert.throws(
    () => fastApplyInternals.pdfAttachment({ fileName:'CV.docx', contentType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }, Buffer.from('PK\x03\x04')),
    /valid PDF files/i
  );
});

test('Google result extraction keeps external posting URLs and removes Google links', () => {
  const html = '<a href="/url?q=https%3A%2F%2Fcareers.example.org%2Fjobs%2F123&sa=U">Role</a><a href="https://www.google.com/preferences">Settings</a>';
  assert.deepEqual(extractGoogleResultUrls(html).map(url => url.href), ['https://careers.example.org/jobs/123']);
});

test('preview is editable, lists both PDFs and never requires Gmail to be connected', async () => {
  const service = createFastApplyService({ root:'X:/missing-fast-apply-config', workspace:'X:/missing-fast-apply-state', coverLetters:{}, senderEmail:'candidate@example.org', senderName:'Verified Candidate' });
  const pkg = { quality:{ applicationReady:true }, posting:{ text:'Aufgaben Anforderungen und Erfahrung Betrieb Systeme. Bewerbung an jobs@example.org' }, documents:{ cv:{ de:{ document:{ fileName:'CV_DE.docx' } } }, coverLetter:{ de:{ document:{ fileName:'Letter_DE.docx' } } } } };
  const preview = await service.preview({ title:'System Engineer', company:'Example GmbH', recruiterContact:'jobs@example.org' },pkg,'de');
  assert.equal(preview.gmail.connected,false);
  assert.equal(preview.recipient,'jobs@example.org');
  assert.deepEqual(preview.attachments.map(item => item.fileName),['CV_DE.pdf','Letter_DE.pdf']);
  assert.match(preview.body,/Verified Candidate$/);
});

test('Gmail permission failures provide a precise reconnect action', () => {
  assert.match(
    fastApplyInternals.gmailFailureMessage(403, 'insufficientPermissions'),
    /Gmail send permission is missing/i
  );
});

test('server retains successful Fast Apply delivery per job and blocks a duplicate send', async () => {
  const source = await readFile(new URL('./server.mjs', import.meta.url), 'utf8');
  assert.match(source, /fast_apply_sent:/);
  assert.match(source, /FAST_APPLY_ALREADY_SENT/);
  assert.match(source, /FAST_APPLY_UNDO_WINDOW_MS/);
  assert.match(source, /FAST_APPLY_DAILY_LIMIT = 10/);
  assert.match(source, /FAST_APPLY_BCC/);
  assert.match(source, /api\/fast-apply\/undo/);
  assert.match(source, /api\/website-apply\/start/);
  assert.match(source, /api\/website-apply\/submit/);
  assert.match(source, /createWebsiteApplyAgent/);
  assert.match(source, /websiteApply\.start\(job,null/);
  assert.match(source, /websiteApply\.posting\(job\.id\)/);
  assert.match(source, /website-apply-browser-jd/);
  assert.match(source, /hasActiveFastApplySend/);
  assert.match(source, /deferring restart until the active Fast Apply delivery finishes/);
});
