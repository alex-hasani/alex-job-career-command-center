import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGmailDiscoveredJob } from './gmail-job-discovery.mjs';

const base = {
  id:'email_job__message123__role456',
  gmailMessageId:'message123456789',
  originalTimestamp:'2026-10-01T08:00:00Z',
  verifiedAt:'2026-10-01T08:05:00Z',
  openStatus:'open',
  title:'Senior Infrastructure Engineer',
  company:'Example GmbH',
  location:'Stuttgart',
  url:'https://careers.example.com/jobs/role456',
  source:'Gmail job list',
  provider:'Example Careers',
  description:'Operate Windows Server, Linux, VMware, Azure and Active Directory infrastructure.',
  workType:'Full-time'
};

test('normalizes and assesses an exact technical posting from email', () => {
  const job = normalizeGmailDiscoveredJob(base);
  assert.equal(job.emailDiscovered, true);
  assert.equal(job.applicationStatus, 'Not recorded');
  assert.equal(job.verificationStatus, 'open');
  assert.match(job.contentFingerprint, /^[a-f0-9]{64}$/);
  assert.ok(job.interviewFitScore >= 0);
});

test('rejects list pages and nontechnical jobs', () => {
  assert.throws(
    () => normalizeGmailDiscoveredJob({ ...base, url:'https://careers.example.com/jobs/' }),
    /exact posting/
  );
  assert.throws(
    () => normalizeGmailDiscoveredJob({ ...base, title:'Sales Manager' }),
    /not a supported technical role/
  );
});
