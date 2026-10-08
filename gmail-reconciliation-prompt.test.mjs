import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGmailReconciliationPrompt, gmailReconciliationCheckpoint } from './gmail-reconciliation-prompt.mjs';

test('builds a bounded checkpoint-aware Gmail reconciliation prompt', () => {
  const metadata = { value:JSON.stringify({ at:'2026-10-03T10:00:00.000Z' }) };
  const prompt = buildGmailReconciliationPrompt({
    days:7,
    primaryAccount:'primary@example.com',
    forwardedAccount:'jobs@example.com',
    checkpointMetadata:metadata
  });

  assert.match(prompt, /one logical metadata-only search/i);
  assert.match(prompt, /at most 5 pages/i);
  assert.match(prompt, /CHECKPOINT_AT/i);
  assert.match(prompt, /Batch-read plausible messages once/i);
  assert.match(prompt, /job-alert\/digest terms/i);
  assert.match(prompt, /at most 12 experience-aligned technical positions/i);
  assert.match(prompt, /exact posting URL/i);
  assert.match(prompt, /maximum 20/i);
  assert.match(prompt, /one incremental reconciliation and one Excel sync/i);
  assert.match(prompt, /Not recorded\/discovery/i);
  assert.match(prompt, /browse only unknown beneficial domains/i);
  assert.match(prompt, /Never send email or apply/i);
  assert.match(prompt, /2026-10-03T10:00:00\.000Z/);
  assert.equal(gmailReconciliationCheckpoint(metadata), '2026-10-03T10:00:00.000Z');
  assert.ok(prompt.split(/\s+/).length < 230, 'prompt should stay compact');
});

test('falls back to the requested window without a checkpoint', () => {
  const prompt = buildGmailReconciliationPrompt({
    days:7,
    primaryAccount:'primary@example.com',
    forwardedAccount:'jobs@example.com'
  });
  assert.match(prompt, /No checkpoint exists; use the last 7 days/i);
  assert.equal(gmailReconciliationCheckpoint(null), null);
});
