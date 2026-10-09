import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { openJobDatabase } from './job-database.mjs';

const execFileAsync = promisify(execFile);

test('monitor batch commits database state and checkpoint without an Excel mirror', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'alex-job-gmail-batch-'));
  const evidencePath = join(directory, 'gmail-lifecycle-evidence.json');
  const databasePath = join(directory, 'job_search.sqlite');
  const statePath = join(directory, 'cv_command_center_state.json');
  const batchPath = join(directory, 'gmail-monitor-batch.json');
  const scriptPath = join(import.meta.dirname, 'process-gmail-monitor-batch.mjs');
  const checkpointAt = new Date(Date.now() - 60_000).toISOString();
  const event = { id:'email__monitor_transaction_test', status:'Applied', gmailMessageId:'1abc234def567890', originalTimestamp:'2026-10-01T11:20:34+00:00', create:{ company:'Example GmbH', title:'Systems Engineer', location:'Germany', url:'', source:'Application email', provider:'Gmail evidence' }, comment:'Email evidence (Gmail 1abc234def567890): Example GmbH explicitly confirmed receipt of the application.' };
  await writeFile(evidencePath, '[]\n');
  await writeFile(statePath, JSON.stringify({ leads:[] }, null, 2));
  await writeFile(batchPath, JSON.stringify({ reviewedMessages:4, checkpointAt, events:[event], jobs:[] }, null, 2));
  openJobDatabase(databasePath).db.close();
  try {
    const { stdout } = await execFileAsync(process.execPath, [scriptPath, 'run', batchPath, evidencePath, databasePath, statePath, 'http://127.0.0.1:1/api/sync-excel']);
    const result = JSON.parse(stdout);
    assert.equal(result.appended, 1);
    assert.equal(result.reconciled, 1);
    assert.equal(result.processedJobs, 0);
    const jobDb = openJobDatabase(databasePath);
    try {
      const checkpoint = JSON.parse(jobDb.getMetadata('last_gmail_monitor_checkpoint').value);
      assert.equal(checkpoint.at, checkpointAt);
      assert.equal(jobDb.listJobs({ includeInactive:true }).find(job => job.id === event.id).applicationStatus, 'Applied');
    } finally { jobDb.db.close(); }
    await assert.rejects(readFile(join(directory, 'gmail-monitor-batch-journal.json'), 'utf8'), error => error.code === 'ENOENT');
  } finally { await rm(directory, { recursive:true, force:true }); }
});