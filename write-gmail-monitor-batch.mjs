import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

function fail(message) { throw new Error(`Gmail monitor batch writer rejected: ${message}`); }

function validateBatch(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('payload must be one JSON object');
  const allowed = ['reviewedMessages', 'checkpointAt', 'events', 'jobs'];
  if (Object.keys(raw).some(key => !allowed.includes(key))) fail('payload contains an unsupported field');
  if (!Number.isInteger(raw.reviewedMessages) || raw.reviewedMessages < 0) fail('reviewedMessages must be a non-negative integer');
  const checkpoint = new Date(raw.checkpointAt);
  if (!raw.checkpointAt || Number.isNaN(checkpoint.getTime())) fail('checkpointAt must be a valid timestamp');
  if (checkpoint.getTime() > Date.now() + 60_000) fail('checkpointAt cannot be in the future');
  if (!Array.isArray(raw.events) || raw.events.length > 20) fail('events must be an array with at most 20 items');
  if (!Array.isArray(raw.jobs) || raw.jobs.length > 12) fail('jobs must be an array with at most 12 items');
  return { reviewedMessages:raw.reviewedMessages, checkpointAt:checkpoint.toISOString(), events:raw.events, jobs:raw.jobs };
}

async function atomicWrite(path, value) {
  const directory = dirname(path);
  await mkdir(directory, { recursive:true });
  const temporary = resolve(directory, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(value)}\n`, { encoding:'utf8', flag:'wx' });
    await rename(temporary, path);
  } finally { await rm(temporary, { force:true }); }
}

const [outputPath, encodedPayload, ...extra] = process.argv.slice(2);
if (!outputPath || !encodedPayload || extra.length) fail('usage: node write-gmail-monitor-batch.mjs OUTPUT_PATH BASE64URL_JSON');
let parsed;
try { parsed = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')); }
catch { fail('payload must be valid base64url-encoded JSON'); }
const batch = validateBatch(parsed);
await atomicWrite(resolve(outputPath), batch);
console.log(JSON.stringify({ ok:true, reviewedMessages:batch.reviewedMessages, events:batch.events.length, jobs:batch.jobs.length, checkpointAt:batch.checkpointAt }));
