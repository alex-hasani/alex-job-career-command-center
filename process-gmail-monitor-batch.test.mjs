import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { openJobDatabase } from './job-database.mjs';

const execFileAsync = promisify(execFile);

async function listen(server) {
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', error => error ? reject(error) : resolve()));
  return `http://127.0.0.1:${server.address().port}/api/sync-excel`;
}

test('monitor batch appends once, recovers after sync failure, and advances checkpoint', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'alex-job-gmail-batch-'));
  const evidencePath = join(directory, 'gmail-lifecycle-evidence.json');
  const databasePath = join(directory, 'job_search.sqlite');
  const statePath = join(directory, 'cv_command_center_state.json');
  const batchPath = join(directory, 'gmail-monitor-batch.json');
  const scriptPath = join(import.meta.dirname, 'process-gmail-monitor-batch.mjs');
  const checkpointAt = new Date(Date.now() - 60_000).toISOString();
  const event = {
    id:'email__monitor_transaction_test',
    status:'Applied',
    gmailMessageId:'1abc234def567890',
    originalTimestamp:'2026-10-01T11:20:34+00:00',
    create:{ company:'Example GmbH', title:'Systems Engineer', location:'Germany', url:'', source:'Application email', provider:'Gmail evidence' },
    comment:'Email evidence (Gmail 1abc234def567890): Example GmbH explicitly confirmed receipt of the application.'
  };
  const discoveredJob = {
    id:'email_job__1abc234def567890__systems_engineer',
    gmailMessageId:'1abc234def567890',
    originalTimestamp:'2026-10-01T11:20:34+00:00',
    verifiedAt:'2026-10-01T11:30:00+00:00',
    openStatus:'open',
    title:'Senior Systems Engineer',
    company:'Example Infrastructure GmbH',
    location:'Stuttgart',
    url:'https://careers.example.com/jobs/12345-senior-systems-engineer',
    source:'Gmail job list',
    provider:'Example Careers',
    description:'Operate Windows Server, Linux, VMware, Azure and Active Directory infrastructure. Troubleshoot incidents and automate administration with PowerShell.',
    workType:'Full-time',
    remote:false
  };
  await writeFile(evidencePath, '[]\n');
  await writeFile(statePath, JSON.stringify({ leads:[] }, null, 2));
  await writeFile(batchPath, JSON.stringify({ reviewedMessages:4, checkpointAt, events:[event], jobs:[discoveredJob] }, null, 2));
  openJobDatabase(databasePath).db.close();

  try {
    await assert.rejects(execFileAsync(process.execPath, [scriptPath, 'run', batchPath, evidencePath, databasePath, statePath, 'http://127.0.0.1:1/api/sync-excel']), /fetch failed|Excel sync/);
    assert.equal(JSON.parse(await readFile(evidencePath, 'utf8')).length, 1);
    assert.equal(JSON.parse(await readFile(join(directory, 'gmail-monitor-batch-journal.json'), 'utf8')).stage, 'jobs_imported');

    let syncCalls = 0;
    const server = createServer((req, res) => {
      syncCalls += 1;
      assert.equal(req.method, 'POST');
      res.writeHead(200, { 'content-type':'application/json' });
      res.end(JSON.stringify({ ok:true }));
    });
    const syncUrl = await listen(server);
    try {
      const { stdout } = await execFileAsync(process.execPath, [scriptPath, 'recover', batchPath, evidencePath, databasePath, statePath, syncUrl]);
      const result = JSON.parse(stdout);
      assert.equal(result.resumed, true);
      assert.equal(result.appended, 1);
      assert.equal(result.processedJobs, 1);
      assert.equal(result.addedJobs, 1);
      assert.equal(syncCalls, 1);
    } finally {
      server.close();
    }

    assert.equal(JSON.parse(await readFile(evidencePath, 'utf8')).length, 1);
    const jobDb = openJobDatabase(databasePath);
    try {
      const checkpoint = JSON.parse(jobDb.getMetadata('last_gmail_monitor_checkpoint').value);
      assert.equal(checkpoint.at, checkpointAt);
      assert.equal(checkpoint.reviewedMessages, 4);
      assert.equal(checkpoint.genuineChanges, 1);
      assert.equal(jobDb.listJobs({ includeInactive:true }).find(job => job.id === event.id).applicationStatus, 'Applied');
      const imported = jobDb.listJobs({ includeInactive:true }).find(job => job.id === discoveredJob.id);
      assert.equal(imported.applicationStatus, 'Not recorded');
      assert.equal(imported.emailDiscovered, true);
      assert.ok(imported.interviewFitScore >= 0);
    } finally {
      jobDb.db.close();
    }
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    assert.equal(state.leads.find(lead => lead.id === event.id).application_status, 'Applied');
    await assert.rejects(readFile(join(directory, 'gmail-monitor-batch-journal.json'), 'utf8'), error => error.code === 'ENOENT');
  } finally {
    await rm(directory, { recursive:true, force:true });
  }
});
