import { openJobDatabase } from './job-database.mjs';
import { resolve } from 'node:path';
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';

const databasePath = resolve(process.argv[2] || '../State/job_search.sqlite');
const statePath = resolve(process.argv[3] || '../State/cv_command_center_state.json');
const evidencePath = resolve(process.argv[4] || './gmail-lifecycle-evidence.json');
const incrementalCount = Number.parseInt(process.argv[5] || '', 10);
const incrementalMode = Number.isInteger(incrementalCount) && incrementalCount > 0;
const db = openJobDatabase(databasePath);

// The public repository never contains mailbox evidence. A local operator may
// supply a private evidence file at runtime; .gitignore prevents it being
// committed. Missing evidence is treated as an empty reconciliation.
let evidence = [];
try {
  const parsed = JSON.parse(await readFile(evidencePath, 'utf8'));
  evidence = Array.isArray(parsed) ? parsed : [];
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
if (incrementalMode) evidence = evidence.slice(-incrementalCount);

const existing = new Map(db.listJobs({ includeInactive:true }).map(job => [job.id, job]));
for (const item of evidence) {
  if (!item?.id || !item?.status || !item?.changedAt) continue;
  if (!existing.has(item.id)) {
    if (!item.create) {
      console.warn(`Skipping missing historical job ${item.id}`);
      continue;
    }
    db.importAgentJobs([{ id:item.id, origin:'agent', ...item.create, applicationStatus:'Not recorded', applicationComment:'', lifecycleStatus:'to_apply', updatedAt:item.changedAt }]);
    const inserted = db.listJobs({ includeInactive:true }).find(job => job.id === item.id);
    if (inserted) existing.set(item.id, inserted);
  }
  const current = existing.get(item.id);
  const eventAlreadyRecorded = (current?.applicationHistory || []).some(event =>
    event.newStatus === item.status && Date.parse(event.changedAt) === Date.parse(item.changedAt)
  );
  const notes = [current?.applicationComment, item.comment]
    .filter(Boolean)
    .flatMap(value => String(value).split(/\r?\n/))
    .map(value => value.trim())
    .filter(Boolean);
  const comment = [...new Set(notes)].join('\n');
  const reconciled = db.updateApplication(item.id, {
    applicationStatus:item.status,
    applicationComment:comment,
    lifecycleStatus:['Rejected','Withdrawn','Case Closed'].includes(item.status) ? 'archived' : 'applied',
    applicationStatusChangedAt:item.changedAt,
    appliedAt:item.appliedAt !== undefined ? item.appliedAt : current?.appliedAt,
    changeSource:'system',
    recordEvent:Boolean(item.backfill && !eventAlreadyRecorded),
    previousStatusOverride:item.backfill ? '' : undefined,
    suppressEvent:eventAlreadyRecorded
  });
  if (reconciled) existing.set(item.id, reconciled);
}

db.setMetadata('last_email_reconciliation', JSON.stringify({ at:new Date().toISOString(), evidenceCount:evidence.length, source:'Local private evidence file' }));

let stateUpdated = 0;
try {
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  const byId = new Map(evidence.map(item => [item.id, item]));
  const updatedAt = new Date().toISOString();
  state.leads = (state.leads || []).map(lead => {
    const item = byId.get(lead.id);
    if (!item) return lead;
    const notes = [lead.application_comment, item.comment]
      .filter(Boolean)
      .flatMap(value => String(value).split(/\r?\n/))
      .map(value => value.trim())
      .filter(Boolean);
    stateUpdated += 1;
    return {
      ...lead,
      application_status:item.status,
      application_comment:[...new Set(notes)].join('\n'),
      application_status_changed_at:item.changedAt,
      applied_at:item.appliedAt !== undefined ? item.appliedAt : (lead.applied_at || null),
      status:['Rejected','Withdrawn','Case Closed'].includes(item.status) ? 'archived' : 'applied',
      updated_at:updatedAt
    };
  });
  const stateLeadIds = new Set(state.leads.map(lead => lead.id));
  for (const item of evidence) {
    if (!item.create || stateLeadIds.has(item.id)) continue;
    state.leads.push({
      id:item.id,
      title:item.create.title,
      organization:item.create.company,
      location:item.create.location,
      job_url:item.create.url || '',
      source:item.create.source,
      provider:item.create.provider,
      status:['Rejected','Withdrawn','Case Closed'].includes(item.status) ? 'archived' : 'applied',
      application_status:item.status,
      application_comment:item.comment || '',
      application_status_changed_at:item.changedAt,
      applied_at:item.appliedAt || null,
      created_at:item.changedAt,
      updated_at:updatedAt
    });
    stateLeadIds.add(item.id);
    stateUpdated += 1;
  }
  state.updated_at = updatedAt;
  const backupDir = resolve(statePath, '..', '..', 'Backups');
  await mkdir(backupDir, { recursive:true });
  const stamp = updatedAt.replace(/[:.]/g, '-');
  await copyFile(statePath, resolve(backupDir, `cv_command_center_state-before-email-reconcile-${stamp}.json`));
  const temporaryPath = `${statePath}.email-reconcile-tmp`;
  await writeFile(temporaryPath, JSON.stringify(state, null, 2), 'utf8');
  await rename(temporaryPath, statePath);
} catch (error) {
  if (error.code !== 'ENOENT') throw new Error(`SQLite was updated, but local state reconciliation failed: ${error.message}`);
}

console.log(JSON.stringify({ mode:incrementalMode ? 'incremental' : 'full', processed:evidence.length, stateUpdated }, null, 2));
