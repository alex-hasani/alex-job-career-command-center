import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { gmailJobKey, importGmailDiscoveredJobs, normalizeGmailDiscoveredJob } from './gmail-job-discovery.mjs';

const allowedStatuses = new Set(['Applied', 'Interviewing', 'Offer', 'Rejected', 'Withdrawn', 'Case Closed']);

function fail(message) {
  throw new Error(`Gmail monitor batch rejected: ${message}`);
}

function iso(value, label) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) fail(`${label} must be a valid timestamp`);
  return date.toISOString();
}

function text(value, label, maximum = 500) {
  const normalized = String(value || '').trim();
  if (!normalized) fail(`${label} is required`);
  if (normalized.length > maximum) fail(`${label} is too long`);
  return normalized;
}

function normalizeEvent(raw, index) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(`events[${index}] must be an object`);
  const gmailMessageId = text(raw.gmailMessageId, `events[${index}].gmailMessageId`, 200);
  if (!/^[A-Za-z0-9_-]{8,}$/.test(gmailMessageId)) fail(`events[${index}].gmailMessageId is invalid`);
  const originalTimestamp = iso(raw.originalTimestamp, `events[${index}].originalTimestamp`);
  const status = text(raw.status, `events[${index}].status`, 50);
  if (!allowedStatuses.has(status)) fail(`events[${index}].status is unsupported`);
  const item = {
    id:text(raw.id, `events[${index}].id`, 300),
    status,
    gmailMessageId,
    originalTimestamp,
    changedAt:originalTimestamp,
    comment:text(raw.comment, `events[${index}].comment`, 1500)
  };
  if (!/^Email evidence(?: \(Gmail [^)]+\))?:/i.test(item.comment)) {
    fail(`events[${index}].comment must be a concise Email evidence summary`);
  }
  if (raw.appliedAt !== undefined && raw.appliedAt !== null && raw.appliedAt !== '') item.appliedAt = iso(raw.appliedAt, `events[${index}].appliedAt`);
  else if (status === 'Applied') item.appliedAt = originalTimestamp;
  if (raw.backfill === true) item.backfill = true;
  if (raw.create !== undefined) {
    if (!raw.create || typeof raw.create !== 'object' || Array.isArray(raw.create)) fail(`events[${index}].create must be an object`);
    item.create = {
      company:text(raw.create.company, `events[${index}].create.company`, 300),
      title:text(raw.create.title, `events[${index}].create.title`, 500),
      location:text(raw.create.location, `events[${index}].create.location`, 300),
      url:String(raw.create.url || '').trim(),
      source:text(raw.create.source, `events[${index}].create.source`, 200),
      provider:text(raw.create.provider, `events[${index}].create.provider`, 200)
    };
    if (item.create.url && !/^https?:\/\//i.test(item.create.url)) fail(`events[${index}].create.url must be empty or HTTP(S)`);
  }
  return item;
}

function eventKey(item) {
  return `${item.gmailMessageId}\u0000${item.originalTimestamp}\u0000${item.status}`;
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function atomicJson(path, value) {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, path);
}

async function loadBatch(path) {
  const raw = JSON.parse(await readFile(path, 'utf8'));
  const reviewedMessages = Number(raw.reviewedMessages);
  if (!Number.isInteger(reviewedMessages) || reviewedMessages < 0) fail('reviewedMessages must be a non-negative integer');
  const checkpointAt = iso(raw.checkpointAt, 'checkpointAt');
  if (new Date(checkpointAt).getTime() > Date.now() + 60_000) fail('checkpointAt cannot be in the future');
  if (!Array.isArray(raw.events || []) || (raw.events || []).length > 20) fail('events must be an array with at most 20 items');
  const events = (raw.events || []).map(normalizeEvent);
  const keys = events.map(eventKey);
  if (new Set(keys).size !== keys.length) fail('events contain a duplicate Gmail message/timestamp/status key');
  if (!Array.isArray(raw.jobs || []) || (raw.jobs || []).length > 12) fail('jobs must be an array with at most 12 items');
  const jobs = (raw.jobs || []).map(normalizeGmailDiscoveredJob);
  const jobKeys = jobs.map(gmailJobKey);
  if (new Set(jobKeys).size !== jobKeys.length) fail('jobs contain a duplicate Gmail message/exact URL key');
  return { version:2, reviewedMessages, checkpointAt, events, jobs };
}

function runJson(scriptPath, args, options = {}) {
  const output = execFileSync(process.execPath, [scriptPath, ...args], { encoding:'utf8', ...options });
  return JSON.parse(output);
}

async function execute(journalPath, evidencePath, databasePath, statePath, syncUrl) {
  const journal = JSON.parse(await readFile(journalPath, 'utf8'));
  let stage = journal.stage;

  if (stage === 'prepared') {
    const evidenceText = await readFile(evidencePath, 'utf8');
    const evidence = JSON.parse(evidenceText);
    if (!Array.isArray(evidence)) fail('lifecycle evidence file must contain an array');
    if (evidence.length < journal.preEvidenceCount) fail('lifecycle evidence was truncated while a batch was pending');
    const existingKeys = new Set(evidence.map(item => item?.gmailMessageId && item?.originalTimestamp && item?.status ? eventKey({ ...item, originalTimestamp:iso(item.originalTimestamp, 'existing originalTimestamp') }) : '').filter(Boolean));
    const missing = journal.batch.events.filter(item => !existingKeys.has(eventKey(item)));
    const tail = evidence.slice(journal.preEvidenceCount);
    const batchKeys = new Set(journal.batch.events.map(eventKey));
    if (digest(evidenceText) !== journal.preEvidenceDigest && tail.some(item => !batchKeys.has(eventKey({ ...item, originalTimestamp:iso(item.originalTimestamp, 'tail originalTimestamp') })))) {
      fail('lifecycle evidence changed independently while a batch was pending');
    }
    if (missing.length) await atomicJson(evidencePath, [...evidence, ...missing]);
    const updatedText = await readFile(evidencePath, 'utf8');
    const updated = JSON.parse(updatedText);
    const reconcileCount = updated.slice(journal.preEvidenceCount).filter(item => batchKeys.has(eventKey({ ...item, originalTimestamp:iso(item.originalTimestamp, 'appended originalTimestamp') }))).length;
    // Count from the pre-transaction boundary so a crash after the atomic
    // evidence write, but before the journal update, resumes with the same N.
    journal.appendedCount = reconcileCount;
    journal.reconcileCount = reconcileCount;
    journal.postEvidenceCount = updated.length;
    journal.postEvidenceDigest = digest(updatedText);
    journal.stage = stage = 'evidence_appended';
    await atomicJson(journalPath, journal);
  }

  if (stage === 'evidence_appended') {
    if (journal.reconcileCount > 0) {
      const currentEvidence = await readFile(evidencePath, 'utf8');
      const currentRecords = JSON.parse(currentEvidence);
      if (currentRecords.length !== journal.postEvidenceCount || digest(currentEvidence) !== journal.postEvidenceDigest) {
        fail('lifecycle evidence changed after append and before reconciliation');
      }
      journal.reconciliation = runJson(join(import.meta.dirname, 'reconcile-email-applications.mjs'), [databasePath, statePath, String(journal.reconcileCount)], { cwd:dirname(evidencePath) });
    }
    journal.stage = stage = 'reconciled';
    await atomicJson(journalPath, journal);
  }

  if (stage === 'reconciled') {
    journal.jobImport = importGmailDiscoveredJobs(databasePath, journal.batch.jobs || []);
    journal.stage = stage = 'jobs_imported';
    await atomicJson(journalPath, journal);
  }

  if (stage === 'jobs_imported') {
    if (journal.reconcileCount > 0) {
      const response = await fetch(syncUrl, { method:'POST', headers:{ accept:'application/json' } });
      if (!response.ok) throw new Error(`Excel sync returned HTTP ${response.status}`);
      const result = await response.json();
      if (result?.ok !== true) throw new Error('Excel sync did not confirm success');
    }
    journal.stage = stage = 'synced';
    await atomicJson(journalPath, journal);
  }

  if (stage === 'synced') {
    journal.checkpoint = runJson(join(import.meta.dirname, 'record-gmail-monitor-checkpoint.mjs'), [databasePath, 'REVIEWED_MESSAGES', String(journal.batch.reviewedMessages), String(journal.appendedCount), 'CHECKPOINT_AT', journal.batch.checkpointAt]);
    journal.stage = stage = 'checkpointed';
    await atomicJson(journalPath, journal);
  }

  if (stage !== 'checkpointed') fail(`unknown journal stage ${stage}`);
  const result = {
    ok:true,
    resumed:Boolean(journal.resumed),
    reviewedMessages:journal.batch.reviewedMessages,
    appended:journal.appendedCount,
    reconciled:journal.reconcileCount,
    processedJobs:journal.jobImport?.processed || 0,
    addedJobs:journal.jobImport?.added || 0,
    updatedJobs:journal.jobImport?.updated || 0,
    checkpointAt:journal.batch.checkpointAt
  };
  await rm(journalPath, { force:true });
  return result;
}

const command = process.argv[2];
const batchPath = resolve(process.argv[3] || '../State/gmail-monitor-batch.json');
const evidencePath = resolve(process.argv[4] || './gmail-lifecycle-evidence.json');
const databasePath = resolve(process.argv[5] || '../State/job_search.sqlite');
const statePath = resolve(process.argv[6] || '../State/cv_command_center_state.json');
const syncUrl = process.argv[7] || 'http://127.0.0.1:8787/api/sync-excel';
const journalPath = join(dirname(databasePath), 'gmail-monitor-batch-journal.json');

if (basename(evidencePath) !== 'gmail-lifecycle-evidence.json') fail('evidence path must name gmail-lifecycle-evidence.json');

if (command === 'recover') {
  try {
    const journal = JSON.parse(await readFile(journalPath, 'utf8'));
    journal.resumed = true;
    await atomicJson(journalPath, journal);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      console.log(JSON.stringify({ ok:true, pending:false }));
      process.exit(0);
    }
    throw error;
  }
  console.log(JSON.stringify(await execute(journalPath, evidencePath, databasePath, statePath, syncUrl)));
  process.exit(0);
}

if (command !== 'run') fail('command must be run or recover');
try {
  await readFile(journalPath, 'utf8');
  fail('a pending batch must be recovered before starting another batch');
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}
const batch = await loadBatch(batchPath);
const evidenceText = await readFile(evidencePath, 'utf8');
const evidence = JSON.parse(evidenceText);
if (!Array.isArray(evidence)) fail('lifecycle evidence file must contain an array');
await atomicJson(journalPath, {
  version:2,
  stage:'prepared',
  createdAt:new Date().toISOString(),
  preEvidenceCount:evidence.length,
  preEvidenceDigest:digest(evidenceText),
  batch
});
console.log(JSON.stringify(await execute(journalPath, evidencePath, databasePath, statePath, syncUrl)));
