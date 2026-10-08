import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const scriptPath = join(import.meta.dirname, 'write-gmail-monitor-batch.mjs');

test('writes a validated monitor batch atomically from base64url JSON', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gmail-batch-writer-'));
  const outputPath = join(directory, 'batch.json');
  const payload = { reviewedMessages:3, checkpointAt:new Date(Date.now() - 60_000).toISOString(), events:[], jobs:[] };
  try {
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const { stdout } = await execFileAsync(process.execPath, [scriptPath, outputPath, encoded]);
    assert.equal(JSON.parse(stdout).ok, true);
    assert.deepEqual(JSON.parse(await readFile(outputPath, 'utf8')), payload);
  } finally { await rm(directory, { recursive:true, force:true }); }
});

test('rejects unsupported fields without writing output', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gmail-batch-writer-invalid-'));
  const outputPath = join(directory, 'batch.json');
  const encoded = Buffer.from(JSON.stringify({ reviewedMessages:0, checkpointAt:new Date().toISOString(), events:[], jobs:[], unsafe:true })).toString('base64url');
  try {
    await assert.rejects(execFileAsync(process.execPath, [scriptPath, outputPath, encoded]), /unsupported field/);
    await assert.rejects(readFile(outputPath, 'utf8'), error => error.code === 'ENOENT');
  } finally { await rm(directory, { recursive:true, force:true }); }
});
