import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { appendActivityEvent, readActivityEvents } from './activity-log.mjs';

test('activity log keeps concise operational events and normalizes line breaks', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'alex-job-activity-'));
  try {
    const path = join(directory, 'events.jsonl');
    await appendActivityEvent(path, { action:'fast_apply.send', result:'failed', jobId:'job-1', detail:'Gmail denied\npermission' });
    const events = await readActivityEvents(path);
    assert.equal(events.length, 1);
    assert.equal(events[0].action, 'fast_apply.send');
    assert.equal(events[0].detail, 'Gmail denied permission');
  } finally {
    await rm(directory, { recursive:true, force:true });
  }
});