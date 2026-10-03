import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGmailReconciliationPrompt, gmailReconciliationCheckpoint } from './gmail-reconciliation-prompt.mjs';

test('builds a bounded checkpoint-aware Gmail reconciliation prompt', () => {
  const metadata = { value:JSON.stringify({ at:'2026-10-03T10:00:00.000Z' }) };
  const prompt = buildGmailReconciliationPrompt({
    days:7,
    primaryAccount:'configured primary account',
    forwardedAccount:'configured forwarding account',
    checkpointMetadata:metadata
  });

  assert.match(prompt, /exactly one metadata-only Gmail search/i);
  assert.match(prompt, /limit 100 and do not paginate/i);
  assert.match(prompt, /Batch-read exact content once/i);
  assert.match(prompt, /maximum 20/i);
  assert.match(prompt, /one incremental SQLite\/Career Command Center reconciliation and one Excel sync/i);
  assert.match(prompt, /browse only unknown beneficial domains/i);
  assert.match(prompt, /Never send email or apply/i);
  assert.match(prompt, /2026-10-03T10:00:00\.000Z/);
  assert.equal(gmailReconciliationCheckpoint(metadata), '2026-10-03T10:00:00.000Z');
  assert.ok(prompt.split(/\s+/).length < 230, 'prompt should stay compact');
});

test('falls back to the requested window without a checkpoint', () => {
  const prompt = buildGmailReconciliationPrompt({
    days:7,
    primaryAccount:'configured primary account',
    forwardedAccount:'configured forwarding account'
  });
  assert.match(prompt, /No checkpoint exists; use the last 7 days/i);
  assert.equal(gmailReconciliationCheckpoint(null), null);
});
