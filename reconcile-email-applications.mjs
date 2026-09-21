import { openJobDatabase } from './job-database.mjs';
import { resolve } from 'node:path';
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';

const databasePath = resolve(process.argv[2] || '../State/job_search.sqlite');
const statePath = resolve(process.argv[3] || '../State/cv_command_center_state.json');
const db = openJobDatabase(databasePath);

const coreEvidence = [
  {
    id:'tracker__MTc3MTI1NjYwMA', status:'Rejected', changedAt:'2026-08-18T06:11:28.000Z',
    comment:'Email evidence: Medialine Group rejection received 18 Aug 2026 for System Engineer / Consultant Microsoft Technologien (m/w/d).'
  },
  {
    id:'tracker__MTQyODMzMjg', status:'Interviewing', changedAt:'2026-08-21T18:30:18.223Z', appliedAt:'2026-08-18T14:41:44.000Z',
    comment:'First interview with Majori completed. Status updated to Interviewing on 21 Aug 2026 when reported by Alex; the exact interview time was not provided.'
  },
  {
    id:'tracker__YTVhZGQ3MmEwZjk1ZGU2MQ', status:'Applied', changedAt:'2026-08-21T15:58:38.000Z', appliedAt:'2026-08-21T15:58:38.000Z', backfill:true,
    comment:'Email evidence: Südzucker AG confirmed receipt of the application on 21 Aug 2026.'
  },
  {
    id:'email__medialine_initiative_20260818', status:'Rejected', changedAt:'2026-08-18T06:10:51.000Z',
    create:{ company:'Medialine Group', title:'Initiativbewerbung', location:'Germany', url:'', source:'Application email', provider:'Gmail evidence' },
    comment:'Email evidence: Medialine Group rejection received 18 Aug 2026 for the unsolicited application. Exact original application date and posting URL were not stated.'
  },
  {
    id:'email__ntt_data_initiative_20260820', status:'Rejected', changedAt:'2026-08-20T07:01:16.000Z',
    create:{ company:'NTT DATA Business Solutions', title:'Initiativbewerbung', location:'Germany', url:'', source:'Application email', provider:'Gmail evidence' },
    comment:'Email evidence: NTT DATA Business Solutions rejection received 20 Aug 2026 for the unsolicited application. Exact original application date was not stated.'
  },
  {
    id:'email__softgarden_64177733', status:'Applied', changedAt:'2026-08-20T11:23:03.000Z', appliedAt:'2026-08-20T11:23:03.000Z',
    create:{ company:'softgarden e-recruiting GmbH', title:'Senior System Administrator & Onsite Lead (m/w/d)', location:'Berlin', url:'https://softgarden.career.softgarden.de/jobs/64177733/Senior-System-Administrator-Onsite-Lead-m-w-d-/', source:'Application email', provider:'Gmail evidence' },
    comment:'Email evidence: softgarden confirmed receipt of the application on 20 Aug 2026.'
  },
  {
    id:'email__european_dynamics_4456704429', status:'Applied', changedAt:'2026-08-21T12:01:47.000Z', appliedAt:'2026-08-21T12:01:47.000Z',
    create:{ company:'EUROPEAN DYNAMICS', title:'System Administrator', location:'Germany', url:'https://www.linkedin.com/jobs/view/4456704429/', source:'LinkedIn application email', provider:'Gmail evidence' },
    comment:'Email evidence: LinkedIn and Workable confirmed successful submission on 21 Aug 2026.'
  },
  {
    id:'email__all_for_one_unidentified_20260821', status:'Applied', changedAt:'2026-08-21T15:03:55.000Z', appliedAt:'2026-08-21T15:03:55.000Z',
    create:{ company:'All for One Group', title:'Application — position not stated in confirmation', location:'Germany', url:'https://careers.all-for-one.com/de/jobs/', source:'Application email', provider:'Gmail evidence' },
    comment:'Email evidence: All for One Group confirmed receipt on 21 Aug 2026. The confirmation did not identify the position, so no role title was inferred.'
  },
  {
    id:'email__einself_2nd_level_support_20260706', status:'Rejected', changedAt:'2026-07-06T07:23:57.000Z',
    create:{ company:'EinsElf IT GmbH', title:'2nd Level Support Techniker für IT-Systeme (m/w/d)', location:'Germany / not stated', url:'', source:'Workwise application email', provider:'Gmail evidence' },
    comment:'Email evidence: Workwise reported on 6 Jul 2026 that EinsElf IT GmbH rejected the application. The rejection email did not state the original application date or job location.'
  },
  {
    id:'email__solar_log_cloud_applications_admin_20260627', status:'Rejected', changedAt:'2026-06-27T06:17:52.000Z', appliedAt:'2026-06-24T00:00:00.000Z',
    create:{ company:'Solar-Log Deutschland', title:'Cloud Applications Admin', location:'Germany', url:'', source:'LinkedIn application email', provider:'Gmail evidence' },
    comment:'Email evidence: LinkedIn reported on 27 Jun 2026 that Solar-Log Deutschland would not move forward. LinkedIn recorded the application date as 24 Jun 2026.'
  },
  {
    id:'email__robert_half_senior_system_administrator_20260621', status:'Rejected', changedAt:'2026-06-21T12:40:04.000Z', appliedAt:'2026-06-18T00:00:00.000Z',
    create:{ company:'Robert Half', title:'Senior System Administrator (m/w/d) – hoher Remoteanteil', location:'Stuttgart, Baden-Württemberg', url:'', source:'LinkedIn application email', provider:'Gmail evidence' },
    comment:'Email evidence: LinkedIn reported on 21 Jun 2026 that Robert Half would not move forward. LinkedIn recorded the application date as 18 Jun 2026.'
  },
  {
    id:'email__rom_technik_itk_systemtechniker_20260618', status:'Rejected', changedAt:'2026-06-18T09:00:10.000Z',
    create:{ company:'Rud. Otto Meyer Technik GmbH & Co. KG', title:'ITK Systemtechniker (m/w/d)', location:'Germany / not stated', url:'', source:'Employer application email', provider:'Gmail evidence' },
    comment:'Email evidence: ROM Technik confirmed on 18 Jun 2026 that the application would not proceed. The email did not state the original application date or role location.'
  },
  {
    id:'email__duerr_technik_it_fachkraft_20260602', status:'Rejected', changedAt:'2026-06-02T06:23:32.000Z',
    create:{ company:'Dürr Technik GmbH & Co. KG', title:'IT-Fachkraft (m/w/d)', location:'Germany / not stated', url:'', source:'Employer application email', provider:'Gmail evidence' },
    comment:'Email evidence: Dürr Technik confirmed on 2 Jun 2026 that the application would not proceed. The email did not state the original application date or role location.'
  }
];
const reviewedEvidencePath = resolve('./gmail-lifecycle-evidence.json');
const reviewedEvidence = JSON.parse(await readFile(reviewedEvidencePath, 'utf8'));
const incrementalCount = Number.parseInt(process.argv[4] || '', 10);
const incrementalMode = Number.isInteger(incrementalCount) && incrementalCount > 0;
const evidence = incrementalMode
  ? reviewedEvidence.slice(-incrementalCount)
  : [...coreEvidence, ...reviewedEvidence];

const existing = new Map(db.listJobs({ includeInactive:true }).map(job => [job.id, job]));
for (const item of evidence) {
  if (!existing.has(item.id)) {
    // Historical tracker ids can disappear after canonical deduplication.  One
    // stale reference must never block newer, independently verified email
    // evidence from being reconciled.
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

db.setMetadata('last_lifecycle_evidence_reconciliation', JSON.stringify({ at:new Date().toISOString(), evidenceCount:evidence.length, source:'Gmail lifecycle evidence' }));

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
    const comment = [...new Set(notes)].join('\n');
    stateUpdated += 1;
    return {
      ...lead,
      application_status:item.status,
      application_comment:comment,
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
  throw new Error(`SQLite was updated, but Career Command Center state reconciliation failed: ${error.message}`);
}

console.log(JSON.stringify({ mode:incrementalMode ? 'incremental' : 'full', processed:evidence.length, stateUpdated, records:evidence.map(item => ({ id:item.id, status:item.status, changedAt:item.changedAt })) }, null, 2));
