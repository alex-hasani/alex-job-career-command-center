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

test('an archived lifecycle cannot be revived by a missing application label', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'alex-job-archived-lifecycle-'));
  const path = join(directory, 'job_search.sqlite');
  const jobDb = openJobDatabase(path);
  try {
    const job = { id:'archived-job', source:'test', title:'Infrastructure Engineer', company:'Example GmbH', location:'Stuttgart', applicationStatus:'Not recorded', lifecycleStatus:'archived' };
    jobDb.importAgentJobs([job]);
    const saved = jobDb.listJobs({ includeInactive:true }).find(item => item.id === job.id);
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
