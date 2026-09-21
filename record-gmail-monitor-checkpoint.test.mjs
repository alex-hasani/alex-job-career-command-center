import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openJobDatabase } from './job-database.mjs';

test('monitor checkpoint is isolated from email reconciliation metadata', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'alex-job-gmail-checkpoint-'));
  const databasePath = join(directory, 'job_search.sqlite');
  const expected = { at:'2026-09-10T08:00:00.000Z', reviewedMessages:3, genuineChanges:1 };
  const jobDb = openJobDatabase(databasePath);

  try {
    jobDb.setMetadata('last_email_reconciliation', JSON.stringify({ at:'2026-09-10T09:00:00.000Z', source:'Gmail lifecycle evidence' }));
    jobDb.setMetadata('last_gmail_monitor_checkpoint', JSON.stringify(expected));
  } finally {
    jobDb.db.close();
  }

  try {
    const output = execFileSync(process.execPath, [join(import.meta.dirname, 'record-gmail-monitor-checkpoint.mjs'), 'read', databasePath], { encoding:'utf8' });
    const result = JSON.parse(output);
    assert.deepEqual({ at:result.checkpoint.at, reviewedMessages:result.checkpoint.reviewedMessages, genuineChanges:result.checkpoint.genuineChanges }, expected);

    execFileSync(process.execPath, [join(import.meta.dirname, 'record-gmail-monitor-checkpoint.mjs'), databasePath, 'REVIEWED_MESSAGES', '4', '2'], { encoding:'utf8' });
    const verifyDb = openJobDatabase(databasePath);
    try {
      const checkpoint = JSON.parse(verifyDb.getMetadata('last_gmail_monitor_checkpoint').value);
      assert.equal(checkpoint.reviewedMessages, 4);
      assert.equal(checkpoint.genuineChanges, 2);
      assert.equal(JSON.parse(verifyDb.getMetadata('last_email_reconciliation').value).source, 'Gmail lifecycle evidence');
    } finally {
      verifyDb.db.close();
    }
  } finally {
    await rm(directory, { recursive:true, force:true });
  }
});