import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashPassword, verifyPassword, openUserSpaceDatabase, refineResumeEvidence } from './user-space.mjs';

test('passwords use salted scrypt hashes and verify without storing plaintext', async () => {
  const password = 'Correct horse battery staple 2026';
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  assert.match(first, /^scrypt\$1\$/);
  assert.notEqual(first, second);
  assert.equal(first.includes(password), false);
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword('wrong password value', first), false);
});

test('user-space database separates credentials, sessions, documents, and drafts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'alex-job-user-space-'));
  const db = openUserSpaceDatabase(join(directory, 'users.sqlite'));
  try {
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
    for (const name of ['users','sessions','documents','resume_drafts','security_events']) assert.equal(tables.has(name), true);
    const userColumns = new Set(db.prepare('PRAGMA table_info(users)').all().map(row => row.name));
    assert.equal(userColumns.has('password'), false);
    assert.equal(userColumns.has('password_hash'), true);
  } finally { db.close(); await rm(directory, { recursive:true, force:true }); }
});

test('ATS refinement prioritizes only source evidence and keeps missing terms review-only', () => {
  const source = ['Alex Example','Cloud Engineer','Azure administration','Windows Server operations','English C1'].join('\n');
  const result = refineResumeEvidence(source, 'Azure Kubernetes Terraform engineer');
  assert.equal(result.inventedContent, false);
  assert.equal(result.sourceOnly, true);
  assert.equal(result.priorityEvidence.some(item => item.text === 'Azure administration'), true);
  assert.equal(result.priorityEvidence.every(item => source.includes(item.text)), true);
  assert.equal(result.missingKeywords.includes('kubernetes'), true);
  assert.equal(result.atsText.toLowerCase().includes('kubernetes'), false);
  assert.equal(result.atsText.toLowerCase().includes('terraform'), false);
});
