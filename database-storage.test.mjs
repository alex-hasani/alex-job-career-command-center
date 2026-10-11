import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openJobDatabase } from './job-database.mjs';

test('OneDrive-safe database mode does not leave WAL or SHM files open', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'alex-job-sqlite-'));
  const path = join(directory, 'job_search.sqlite');
  const jobDb = openJobDatabase(path);

  try {
    assert.equal(jobDb.db.prepare('PRAGMA journal_mode').get().journal_mode, 'delete');
    assert.equal(jobDb.db.prepare('PRAGMA busy_timeout').get().timeout, 30000);
    jobDb.setMetadata('storage-test', 'ok');
  } finally {
    jobDb.db.close();
  }

  await assert.rejects(access(`${path}-wal`));
  await assert.rejects(access(`${path}-shm`));
  await rm(directory, { recursive:true, force:true });
});
test('indexed single-job lookup and application update avoid a full database listing', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'alex-job-lookup-'));
  const path = join(directory, 'job_search.sqlite');
  const jobDb = openJobDatabase(path);
  try {
    jobDb.importAgentJobs([{ id:'job-1', origin:'agent', source:'test', title:'Systems Engineer', company:'Example GmbH', location:'Stuttgart', url:'https://example.org/jobs/1' }]);
    assert.equal(jobDb.getJob('job-1').title, 'Systems Engineer');
    assert.equal(jobDb.getJob('missing-job'), null);
    const updated = jobDb.updateApplication('job-1', { url:'https://example.org/jobs/1/apply' });
    assert.equal(updated.url, 'https://example.org/jobs/1/apply');
    const noted = jobDb.updateApplication('job-1', { applicationComment:'Follow up after the interview.' });
    assert.equal(noted.applicationComment, 'Follow up after the interview.');
    jobDb.importAgentJobs([{ id:'job-1', origin:'agent', source:'test', title:'Systems Engineer', company:'Example GmbH', location:'Stuttgart', url:'https://example.org/jobs/1/apply' }]);
    assert.equal(jobDb.getJob('job-1').applicationComment, 'Follow up after the interview.');
  } finally {
    jobDb.db.close();
    await rm(directory, { recursive:true, force:true });
  }
});
test('a refreshed location variant cannot revive a case-closed posting', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'alex-job-closed-refresh-'));
  const path = join(directory, 'job_search.sqlite');
  const jobDb = openJobDatabase(path);
  const baseJob = {
    id:'Schwarz Digits:https://schwarz-digits.de/jobsearch/hr/it-system-engineer-systemarchitekt-m-w-d-ai-infrastructure-data-center-GT2884',
    source:'Schwarz Digits',
    title:'IT System Engineer / Systemarchitekt (m/w/d) - AI Infrastructure & Data Center',
    company:'Schwarz Digits',
    location:'Heilbronn',
    url:'https://schwarz-digits.de/jobsearch/hr/it-system-engineer-systemarchitekt-m-w-d-ai-infrastructure-data-center-GT2884'
  };
  try {
    jobDb.saveRefresh([baseJob], [], 'refresh-1');
    jobDb.updateApplication(baseJob.id, { applicationStatus:'Case Closed' });
    jobDb.saveRefresh([{ ...baseJob, location:'Bad Friedrichshall' }], [], 'refresh-2');

    const copies = jobDb.db.prepare('SELECT application_status,lifecycle_status,availability_status,active FROM jobs WHERE job_id=?').all(baseJob.id);
    assert.equal(copies.length, 1);
    assert.ok(copies.every(row => row.application_status === 'Case Closed'));
    assert.ok(copies.every(row => row.lifecycle_status === 'archived'));
    assert.ok(copies.every(row => row.availability_status === 'unavailable'));
    assert.ok(copies.every(row => row.active === 0));
    assert.equal(jobDb.listJobs({ includeInactive:false }).some(job => job.id === baseJob.id), false);
  } finally {
    jobDb.db.close();
    await rm(directory, { recursive:true, force:true });
  }
});
test('exact job IDs and canonical posting URLs cannot create duplicate records', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'alex-job-dedup-write-'));
  const path = join(directory, 'job_search.sqlite');
  const jobDb = openJobDatabase(path);
  try {
    const first = { id:'provider:job-42', source:'test', title:'Cloud Engineer', company:'Example GmbH', location:'Stuttgart', url:'https://example.org/jobs/42?utm_source=first' };
    jobDb.saveRefresh([first], [], 'refresh-1');
    jobDb.saveRefresh([{ ...first, location:'Berlin' }], [], 'refresh-2');
    jobDb.saveRefresh([{ ...first, id:'alternate-provider-id', location:'Remote', url:'https://example.org/jobs/42?utm_source=second' }], [], 'refresh-3');
    const rows = jobDb.db.prepare('SELECT job_id,canonical_url FROM jobs').all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].job_id, first.id);
    assert.equal(rows[0].canonical_url, 'https://example.org/jobs/42');
  } finally {
    jobDb.db.close();
    await rm(directory, { recursive:true, force:true });
  }
});
test('legacy exact-identity duplicates merge without losing application state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'alex-job-dedup-migration-'));
  const path = join(directory, 'job_search.sqlite');
  const jobDb = openJobDatabase(path);
  try {
    const job = { id:'legacy-job', source:'test', title:'Azure Engineer', company:'Example GmbH', location:'Stuttgart', url:'https://example.org/jobs/legacy' };
    jobDb.saveRefresh([job], [], 'refresh-1');
    jobDb.updateApplication(job.id, { applicationStatus:'Applied', applicationComment:'Keep this note.', applicationStatusChangedAt:'2026-08-01T10:00:00.000Z' });
    jobDb.db.exec('DROP INDEX uq_jobs_job_id; DROP INDEX uq_jobs_canonical_url;');
    jobDb.db.exec(`INSERT INTO jobs SELECT 'legacy-copy',job_id,canonical_key || ':copy',canonical_url,origin,source,provider,title,company,'Berlin',
      application_status,application_comment,lifecycle_status,status_changed_at,applied_at,availability_status,active,missing_count,
      first_seen,last_seen,updated_at,refresh_id,sources_json,payload_json FROM jobs WHERE record_key<>'legacy-copy' LIMIT 1`);
    assert.equal(jobDb.db.prepare('SELECT COUNT(*) count FROM jobs').get().count, 2);
    const result = jobDb.deduplicateJobs();
    assert.deepEqual(result, { groups:1, removed:1, remaining:1 });
    const saved = jobDb.getJob(job.id);
    assert.equal(saved.applicationStatus, 'Applied');
    assert.equal(saved.applicationComment, 'Keep this note.');
    assert.equal(jobDb.db.prepare('SELECT COUNT(*) count FROM jobs').get().count, 1);
  } finally {
    jobDb.db.close();
    await rm(directory, { recursive:true, force:true });
  }
});
test('same-company application imports within two hours merge but later applications remain separate', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'alex-job-dedup-content-'));
  const path = join(directory, 'job_search.sqlite');
  const jobDb = openJobDatabase(path);
  try {
    const first = { id:'board-a', source:'board-a', title:'Example GmbH: Cloud Engineer (m/w/d)', company:'Example GmbH', location:'Stuttgart', url:'https://board-a.example/jobs/1' };
    const duplicate = { id:'board-b', source:'board-b', title:'Cloud Engineer (m/w/d)', company:'Example', location:'Stuttgart', url:'https://board-b.example/jobs/9' };
    const later = { id:'board-c', source:'board-c', title:'Cloud Engineer (m/w/d)', company:'Example GmbH', location:'Stuttgart', url:'https://board-c.example/jobs/20' };
    jobDb.saveRefresh([first, duplicate, later], [], 'refresh-1');
    jobDb.updateApplication(first.id, { applicationStatus:'Applied', applicationStatusChangedAt:'2026-09-01T10:00:00.000Z' });
    jobDb.updateApplication(duplicate.id, { applicationStatus:'Applied', applicationStatusChangedAt:'2026-09-01T11:00:00.000Z' });
    jobDb.updateApplication(later.id, { applicationStatus:'Applied', applicationStatusChangedAt:'2026-09-01T14:30:00.000Z' });
    const result = jobDb.deduplicateJobs();
    assert.equal(result.groups, 1);
    assert.equal(result.removed, 1);
    assert.equal(jobDb.db.prepare('SELECT COUNT(*) count FROM jobs').get().count, 2);
  } finally {
    jobDb.db.close();
    await rm(directory, { recursive:true, force:true });
  }
});
test('a live discovery copy merges into the tracked application without crossing cities', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'alex-job-dedup-tracked-copy-'));
  const path = join(directory, 'job_search.sqlite');
  const jobDb = openJobDatabase(path);
  try {
    const tracked = { id:'tracked', source:'tracker', title:'Cloud Engineer (m/w/d)', company:'Example GmbH', location:'Stuttgart', url:'https://employer.example/jobs/1' };
    const liveCopy = { id:'live-copy', source:'board', title:'Example GmbH: Cloud Engineer (m/w/d)', company:'Example', location:'Stuttgart, Baden-Württemberg, Deutschland', url:'https://board.example/jobs/9' };
    const otherCity = { id:'other-city', source:'board', title:'Cloud Engineer (m/w/d)', company:'Example GmbH', location:'Berlin', url:'https://board.example/jobs/20' };
    jobDb.saveRefresh([tracked, liveCopy, otherCity], [], 'refresh-1');
    jobDb.updateApplication(tracked.id, { applicationStatus:'Rejected', applicationStatusChangedAt:'2026-09-10T10:00:00.000Z' });
    const result = jobDb.deduplicateJobs();
    assert.equal(result.groups, 1);
    assert.equal(result.removed, 1);
    assert.equal(jobDb.db.prepare('SELECT COUNT(*) count FROM jobs').get().count, 2);
    const saved = jobDb.getJob(tracked.id);
    assert.equal(saved.applicationStatus, 'Rejected');
    assert.equal(saved.active, false);
    assert.ok(jobDb.db.prepare("SELECT 1 FROM jobs WHERE location='Berlin'").get());
  } finally {
    jobDb.db.close();
    await rm(directory, { recursive:true, force:true });
  }
});
test('an archived lifecycle cannot be revived by a missing application label', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'alex-job-archived-lifecycle-'));
  const path = join(directory, 'job_search.sqlite');
  const jobDb = openJobDatabase(path);
  try {
    const job = { id:'archived-job', source:'test', title:'Infrastructure Engineer', company:'Example GmbH', location:'Stuttgart', applicationStatus:'Not recorded', lifecycleStatus:'archived' };
    jobDb.importAgentJobs([job]);
    const saved = jobDb.getJob(job.id);
    assert.equal(saved.applicationStatus, 'Not recorded');
    assert.equal(saved.lifecycleStatus, 'archived');
    assert.equal(saved.active, false);
    assert.equal(saved.availabilityStatus, 'unavailable');
    assert.equal(jobDb.listJobs({ includeInactive:false }).some(item => item.id === job.id), false);
  } finally {
    jobDb.db.close();
    await rm(directory, { recursive:true, force:true });
  }
});
