import { createHash } from 'node:crypto';
import { openJobDatabase } from './job-database.mjs';
import { isTechnicalRole } from './job-role-scope.mjs';
import { assessAgainstResume } from './resume-assessment.mjs';

function fail(message) {
  throw new Error(`Gmail job discovery rejected: ${message}`);
}

function text(value, label, maximum = 500) {
  const normalized = String(value || '').trim();
  if (!normalized) fail(`${label} is required`);
  if (normalized.length > maximum) fail(`${label} is too long`);
  return normalized;
}

function optionalText(value, label, maximum = 12_000) {
  const normalized = String(value || '').trim();
  if (normalized.length > maximum) fail(`${label} is too long`);
  return normalized;
}

function iso(value, label) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) fail(`${label} must be a valid timestamp`);
  return date.toISOString();
}

function amount(value, label) {
  if (value === undefined || value === null || value === '') return 0;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 10_000_000) fail(`${label} must be a valid non-negative amount`);
  return number;
}

function exactUrl(value, label) {
  let url;
  try { url = new URL(text(value, label, 2_000)); } catch { fail(`${label} must be a valid URL`); }
  if (!['http:','https:'].includes(url.protocol)) fail(`${label} must use HTTP(S)`);
  if (url.pathname === '/' || /\/(?:jobs?|stellenangebote|karriere|careers?)\/?$/i.test(url.pathname)) {
    fail(`${label} must identify one exact posting, not a search or careers home page`);
  }
  return url.toString();
}

export function gmailJobKey(job) {
  return `${job.gmailMessageId}\u0000${job.url}`;
}

export function normalizeGmailDiscoveredJob(raw, index = 0) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(`jobs[${index}] must be an object`);
  const gmailMessageId = text(raw.gmailMessageId, `jobs[${index}].gmailMessageId`, 200);
  if (!/^[A-Za-z0-9_-]{8,}$/.test(gmailMessageId)) fail(`jobs[${index}].gmailMessageId is invalid`);
  const originalTimestamp = iso(raw.originalTimestamp, `jobs[${index}].originalTimestamp`);
  const verifiedAt = iso(raw.verifiedAt, `jobs[${index}].verifiedAt`);
  if (raw.openStatus !== 'open') fail(`jobs[${index}].openStatus must be open`);
  const url = exactUrl(raw.url, `jobs[${index}].url`);
  const title = text(raw.title, `jobs[${index}].title`, 500);
  const company = text(raw.company, `jobs[${index}].company`, 300);
  const location = text(raw.location, `jobs[${index}].location`, 300);
  const description = optionalText(raw.description, `jobs[${index}].description`);
  const source = text(raw.source, `jobs[${index}].source`, 200);
  const provider = text(raw.provider, `jobs[${index}].provider`, 200);
  const salaryMin = amount(raw.salaryMin, `jobs[${index}].salaryMin`);
  const salaryMax = amount(raw.salaryMax, `jobs[${index}].salaryMax`);
  if (salaryMin && salaryMax && salaryMin > salaryMax) fail(`jobs[${index}] salary range is reversed`);
  const fingerprint = createHash('sha256').update([company,title,location,description].join('\n').toLowerCase()).digest('hex');
  const job = {
    id:text(raw.id, `jobs[${index}].id`, 500),
    origin:'live',
    source,
    provider,
    title,
    company,
    location,
    description,
    jdSnapshot:description,
    jdFetched:Boolean(description),
    jdSource:url,
    jdRetrievedAt:verifiedAt,
    url,
    sourceJobId:optionalText(raw.sourceJobId, `jobs[${index}].sourceJobId`, 300),
    foundAt:originalTimestamp,
    posted:raw.posted ? iso(raw.posted, `jobs[${index}].posted`) : '',
    checkedAt:verifiedAt,
    verifiedAt,
    verified:true,
    verificationStatus:'open',
    contentFingerprint:fingerprint,
    remote:raw.remote === true,
    workType:optionalText(raw.workType, `jobs[${index}].workType`, 100),
    salaryMin,
    salaryMax,
    salaryText:optionalText(raw.salaryText, `jobs[${index}].salaryText`, 300),
    salaryBasis:optionalText(raw.salaryBasis, `jobs[${index}].salaryBasis`, 300),
    applicationStatus:'Not recorded',
    lifecycleStatus:'discovery',
    discoveryScore:55,
    emailDiscovered:true,
    gmailDiscovery:{ messageId:gmailMessageId, originalTimestamp }
  };
  if (!isTechnicalRole(job)) fail(`jobs[${index}] is not a supported technical role`);
  return assessAgainstResume(job);
}

export function importGmailDiscoveredJobs(databasePath, jobs = []) {
  const jobDb = openJobDatabase(databasePath);
  try {
    const before = jobDb.stats().total;
    jobDb.importAgentJobs(jobs);
    const added = Math.max(0, jobDb.stats().total - before);
    return { processed:jobs.length, added, updated:Math.max(0, jobs.length - added) };
  } finally {
    jobDb.db.close();
  }
}

