import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const nowIso = () => new Date().toISOString();
const normal = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function canonicalUrl(value) {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|ref$|referrer|source$|campaign|tracking|trk$|gh_src)/i.test(key)) url.searchParams.delete(key);
    }
    url.hash = '';
    return url.toString().replace(/\/$/, '').toLowerCase();
  } catch { return ''; }
}

export function canonicalJobKey(job) {
  const url = canonicalUrl(job.url);
  const identity = [normal(job.company), normal(job.title), normal(job.location).replace(/\b(remote|hybrid|germany|deutschland)\b/g, '').trim()].join('|');
  return identity.replace(/\|+$/g, '') || url || normal(job.id);
}

function parsePayload(value) {
  try { return JSON.parse(value || '{}'); } catch { return {}; }
}

export function openJobDatabase(path) {
  mkdirSync(dirname(path), { recursive:true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 30000;
    -- The live database sits in OneDrive. WAL keeps -wal and -shm files open
    -- for the lifetime of the server, so OneDrive continually retries them.
    -- DELETE uses a short-lived rollback journal and releases it after commit.
    PRAGMA journal_mode = DELETE;
    PRAGMA synchronous = NORMAL;
    PRAGMA temp_store = MEMORY;
    PRAGMA cache_size = -8192;
    CREATE TABLE IF NOT EXISTS jobs (
      record_key TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      canonical_key TEXT NOT NULL,
      canonical_url TEXT,
      origin TEXT NOT NULL,
      source TEXT,
      provider TEXT,
      title TEXT,
      company TEXT,
      location TEXT,
      application_status TEXT,
      application_comment TEXT,
      lifecycle_status TEXT,
      status_changed_at TEXT,
      applied_at TEXT,
      availability_status TEXT NOT NULL DEFAULT 'active',
      active INTEGER NOT NULL DEFAULT 1,
      missing_count INTEGER NOT NULL DEFAULT 0,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      refresh_id TEXT,
      sources_json TEXT NOT NULL DEFAULT '[]',
      payload_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_job_id ON jobs(job_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_canonical ON jobs(canonical_key);
    CREATE INDEX IF NOT EXISTS idx_jobs_active ON jobs(active, origin);
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(application_status);
    CREATE INDEX IF NOT EXISTS idx_jobs_location_active ON jobs(location, active);
    CREATE INDEX IF NOT EXISTS idx_jobs_updated ON jobs(updated_at DESC);
    CREATE TABLE IF NOT EXISTS application_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      previous_status TEXT,
      new_status TEXT NOT NULL,
      changed_at TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'user'
    );
    CREATE INDEX IF NOT EXISTS idx_application_events_job ON application_events(job_id, changed_at DESC);
    CREATE TABLE IF NOT EXISTS application_packages (
      job_id TEXT PRIMARY KEY,
      package_key TEXT NOT NULL,
      language TEXT NOT NULL,
      document_path TEXT NOT NULL,
      exact_posting_url TEXT NOT NULL,
      jd_source TEXT NOT NULL,
      evidence_ids_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS saved_searches (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      criteria_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS provider_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      refresh_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      status TEXT NOT NULL,
      result_count INTEGER NOT NULL DEFAULT 0,
      latency_ms INTEGER,
      message TEXT,
      checked_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_provider_latest ON provider_runs(provider, checked_at DESC);
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  const jobColumns = new Set(db.prepare('PRAGMA table_info(jobs)').all().map(column => column.name));
  if (!jobColumns.has('status_changed_at')) db.exec('ALTER TABLE jobs ADD COLUMN status_changed_at TEXT');
  if (!jobColumns.has('applied_at')) db.exec('ALTER TABLE jobs ADD COLUMN applied_at TEXT');

  function migrateStatusLabel(oldStatus, newStatus) {
    const rows = db.prepare('SELECT record_key,payload_json FROM jobs WHERE application_status=? OR payload_json LIKE ?').all(oldStatus, `%${oldStatus}%`);
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const row of rows) {
        const payload = parsePayload(row.payload_json);
        if (payload.applicationStatus === oldStatus) payload.applicationStatus = newStatus;
        db.prepare('UPDATE jobs SET application_status=CASE WHEN application_status=? THEN ? ELSE application_status END,payload_json=? WHERE record_key=?').run(oldStatus, newStatus, JSON.stringify(payload), row.record_key);
      }
      db.prepare('UPDATE application_events SET previous_status=? WHERE previous_status=?').run(newStatus, oldStatus);
      db.prepare('UPDATE application_events SET new_status=? WHERE new_status=?').run(newStatus, oldStatus);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return rows.length;
  }

  function repairApplicationStateFromEvents() {
    const rows = db.prepare(`SELECT j.record_key,j.job_id,j.application_status,j.lifecycle_status,j.status_changed_at,j.applied_at,j.payload_json,
      e.new_status,e.changed_at
      FROM jobs j
      JOIN application_events e ON e.id=(SELECT e2.id FROM application_events e2 WHERE e2.job_id=j.job_id ORDER BY e2.changed_at DESC,e2.id DESC LIMIT 1)
      WHERE COALESCE(j.application_status,'')<>COALESCE(e.new_status,'')`).all();
    if (!rows.length) return 0;
    const update = db.prepare('UPDATE jobs SET application_status=?,lifecycle_status=?,status_changed_at=?,applied_at=?,updated_at=?,payload_json=? WHERE record_key=?');
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const row of rows) {
        const status = row.new_status || 'Not recorded';
        const lifecycle = ['Applied','Interviewing','Offer'].includes(status) ? 'applied'
          : ['Rejected','Withdrawn','Case Closed'].includes(status) ? 'archived' : 'to_apply';
        const changedAt = row.changed_at || row.status_changed_at || nowIso();
        const appliedAt = status === 'Applied' ? (row.applied_at || changedAt) : row.applied_at;
        const payload = { ...parsePayload(row.payload_json), applicationStatus:status, lifecycleStatus:lifecycle, applicationStatusChangedAt:changedAt, appliedAt };
        update.run(status, lifecycle, changedAt, appliedAt, nowIso(), JSON.stringify(payload), row.record_key);
      }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return rows.length;
  }

  function enrichPayloads(transform) {
    const rows = db.prepare('SELECT record_key,payload_json FROM jobs').all();
    db.exec('BEGIN IMMEDIATE');
    try {
      const update = db.prepare('UPDATE jobs SET payload_json=? WHERE record_key=?');
      for (const row of rows) update.run(JSON.stringify(transform(parsePayload(row.payload_json))), row.record_key);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return rows.length;
  }

  const selectRecord = db.prepare('SELECT * FROM jobs WHERE record_key = ?');
  const insertJob = db.prepare(`INSERT INTO jobs (
    record_key,job_id,canonical_key,canonical_url,origin,source,provider,title,company,location,
    application_status,application_comment,lifecycle_status,status_changed_at,applied_at,availability_status,active,missing_count,
    first_seen,last_seen,updated_at,refresh_id,sources_json,payload_json
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const updateJob = db.prepare(`UPDATE jobs SET
    job_id=?,canonical_key=?,canonical_url=?,origin=?,source=?,provider=?,title=?,company=?,location=?,
    application_status=?,application_comment=?,lifecycle_status=?,status_changed_at=?,applied_at=?,availability_status=?,active=?,missing_count=?,
    last_seen=?,updated_at=?,refresh_id=?,sources_json=?,payload_json=? WHERE record_key=?`);

  function writeJob(job, { refreshId='', preserveApplication=true } = {}) {
    const origin = job.origin === 'agent' ? 'agent' : 'live';
    const canonicalKey = canonicalJobKey(job);
    const recordKey = origin === 'agent' ? `agent:${job.id}` : `live:${canonicalKey}`;
    const existing = selectRecord.get(recordKey);
    const timestamp = job.updatedAt || job.updated_at || nowIso();
    const sourceSet = new Set([...(existing ? JSON.parse(existing.sources_json || '[]') : []), job.source].filter(Boolean));
    let applicationStatus = job.applicationStatus || 'Not recorded';
    let applicationComment = job.applicationComment || '';
    let lifecycleStatus = job.lifecycleStatus || (origin === 'agent' ? 'to_apply' : 'discovery');
    let statusChangedAt = job.applicationStatusChangedAt || job.statusChangedAt || null;
    let appliedAt = job.appliedAt || null;
    // Application tracking is user-owned state. A newly fetched posting can have a
    // newer source timestamp, but it must never reset status, notes, or lifecycle
    // dates while refreshing the posting details.
    if (existing && preserveApplication) {
      applicationStatus = existing.application_status;
      applicationComment = existing.application_comment;
      lifecycleStatus = existing.lifecycle_status;
      statusChangedAt = existing.status_changed_at;
      appliedAt = existing.applied_at;
    } else if (existing) {
      statusChangedAt ||= existing.status_changed_at;
      appliedAt ||= existing.applied_at;
    }
    const existingPayload = parsePayload(existing?.payload_json);
    const payload = { ...existingPayload, ...job, applicationStatus, applicationComment, lifecycleStatus, applicationStatusChangedAt:statusChangedAt, appliedAt };
    const existingJd = String(existingPayload.description || existingPayload.jdSnapshot || '');
    const incomingJd = String(job.description || job.jdSnapshot || '');
    if (existingPayload.jdFetched && existingJd.length > incomingJd.length) {
      payload.description = existingPayload.description || existingPayload.jdSnapshot;
      payload.jdSnapshot = existingPayload.jdSnapshot || existingPayload.description;
      payload.jdFetched = true;
      payload.jdSource = existingPayload.jdSource;
      payload.jdRetrievedAt = existingPayload.jdRetrievedAt;
    }
    const core = [
      job.id || recordKey, canonicalKey, canonicalUrl(job.url), origin, job.source || '', job.provider || '', job.title || '', job.company || '', job.location || '',
      applicationStatus, applicationComment, lifecycleStatus, statusChangedAt, appliedAt, 'active', 1, 0
    ];
    const seenAt = nowIso();
    if (existing) updateJob.run(...core, seenAt, timestamp, refreshId, JSON.stringify([...sourceSet]), JSON.stringify(payload), recordKey);
    else insertJob.run(recordKey, ...core, timestamp, seenAt, timestamp, refreshId, JSON.stringify([...sourceSet]), JSON.stringify(payload));
  }

  function importAgentJobs(jobs) {
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const job of jobs) writeJob(job, { preserveApplication:true });
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }

  function saveRefresh(jobs, providerResults, refreshId) {
    const successful = providerResults.filter(item => item.status === 'ok').map(item => item.source);
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const job of jobs.filter(item => item.origin !== 'agent')) writeJob(job, { refreshId, preserveApplication:true });
      for (const provider of successful) {
        db.prepare(`UPDATE jobs SET missing_count=missing_count+1,
          active=CASE WHEN missing_count+1>=2 THEN 0 ELSE active END,
          availability_status=CASE WHEN missing_count+1>=2 THEN 'unavailable' ELSE 'stale' END,
          lifecycle_status=CASE WHEN missing_count+1>=2 THEN 'archived' ELSE lifecycle_status END,
          updated_at=? WHERE origin='live' AND source=? AND COALESCE(refresh_id,'')<>?`).run(nowIso(), provider, refreshId);
      }
      const insertRun = db.prepare('INSERT INTO provider_runs(refresh_id,provider,status,result_count,latency_ms,message,checked_at) VALUES(?,?,?,?,?,?,?)');
      for (const result of providerResults) insertRun.run(refreshId, result.source, result.status, result.jobs?.length || 0, result.latencyMs ?? null, result.message || '', result.checkedAt || nowIso());
      db.prepare(`INSERT INTO metadata(key,value,updated_at) VALUES('last_refresh',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`).run(refreshId, nowIso());
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }

  function listJobs({ includeInactive=true } = {}) {
    const rows = db.prepare(`SELECT * FROM jobs ${includeInactive ? '' : 'WHERE active=1'} ORDER BY CASE origin WHEN 'agent' THEN 0 ELSE 1 END, updated_at DESC`).all();
    const eventsByJob = new Map();
    for (const event of db.prepare('SELECT job_id AS jobId,previous_status AS previousStatus,new_status AS newStatus,changed_at AS changedAt,source FROM application_events ORDER BY changed_at DESC,id DESC').all()) {
      if (!eventsByJob.has(event.jobId)) eventsByJob.set(event.jobId, []);
      eventsByJob.get(event.jobId).push(event);
    }
    const grouped = new Map();
    const packagesByJob = new Map(db.prepare('SELECT job_id AS jobId,package_key AS packageKey,language,document_path AS documentPath,exact_posting_url AS exactPostingUrl,jd_source AS jdSource,evidence_ids_json AS evidenceIdsJson,created_at AS createdAt,updated_at AS updatedAt FROM application_packages').all().map(row => [row.jobId, { ...row, evidenceIds:JSON.parse(row.evidenceIdsJson || '[]') }]));
    for (const row of rows) {
      const rowSources = JSON.parse(row.sources_json || '[]');
      if (grouped.has(row.canonical_key)) {
        const existing = grouped.get(row.canonical_key);
        existing.sources = [...new Set([...(existing.sources || []), ...rowSources])];
        continue;
      }
      const payload = parsePayload(row.payload_json);
      grouped.set(row.canonical_key, {
        ...payload,
        id:row.job_id,
        source:row.source || payload.source,
        sources:rowSources,
        applicationStatus:row.application_status,
        applicationComment:row.application_comment,
        applicationStatusChangedAt:row.status_changed_at,
        appliedAt:row.applied_at,
        applicationHistory:eventsByJob.get(row.job_id) || [],
        lifecycleStatus:row.lifecycle_status,
        availabilityStatus:row.availability_status,
        active:Boolean(row.active),
        canonicalKey:row.canonical_key,
        lastSeenAt:row.last_seen,
        applicationPackage:packagesByJob.get(row.job_id) || null
      });
    }
    return [...grouped.values()];
  }

  function updateApplication(jobId, changes) {
    const row = db.prepare("SELECT * FROM jobs WHERE job_id=? ORDER BY CASE origin WHEN 'agent' THEN 0 ELSE 1 END LIMIT 1").get(jobId);
    if (!row) throw new Error('Job was not found in SQLite');
    const nextStatus = changes.applicationStatus ?? row.application_status;
    const statusChanged = nextStatus !== row.application_status;
    const recordEvent = statusChanged || Boolean(changes.recordEvent);
    const changedAt = recordEvent
      ? (changes.applicationStatusChangedAt || row.status_changed_at || nowIso())
      : (changes.applicationStatusChangedAt ?? row.status_changed_at);
    const appliedAt = changes.appliedAt !== undefined
      ? changes.appliedAt
      : row.applied_at || (statusChanged && ['Applied','Interviewing','Offer'].includes(nextStatus) ? changedAt : null);
    const payload = { ...parsePayload(row.payload_json), ...changes, applicationStatus:nextStatus, applicationStatusChangedAt:changedAt, appliedAt };
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(`UPDATE jobs SET application_status=?,application_comment=?,lifecycle_status=?,status_changed_at=?,applied_at=?,updated_at=?,payload_json=? WHERE record_key=?`).run(
      nextStatus,
      changes.applicationComment ?? row.application_comment,
      changes.lifecycleStatus ?? row.lifecycle_status,
      changedAt, appliedAt, nowIso(), JSON.stringify(payload), row.record_key
      );
      if (recordEvent && !changes.suppressEvent) db.prepare('INSERT INTO application_events(job_id,previous_status,new_status,changed_at,source) VALUES(?,?,?,?,?)').run(
        row.job_id, changes.previousStatusOverride ?? (statusChanged ? (row.application_status || '') : ''), nextStatus, changedAt, changes.changeSource || 'user'
      );
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return listJobs().find(job => job.id === jobId);
  }

  function upsertApplicationPackage(jobId, applicationPackage) {
    const existing = db.prepare('SELECT created_at AS createdAt FROM application_packages WHERE job_id=?').get(jobId);
    const timestamp = applicationPackage.updatedAt || nowIso();
    db.prepare(`INSERT INTO application_packages(job_id,package_key,language,document_path,exact_posting_url,jd_source,evidence_ids_json,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?)
      ON CONFLICT(job_id) DO UPDATE SET package_key=excluded.package_key,language=excluded.language,document_path=excluded.document_path,exact_posting_url=excluded.exact_posting_url,jd_source=excluded.jd_source,evidence_ids_json=excluded.evidence_ids_json,updated_at=excluded.updated_at`).run(
      jobId,
      applicationPackage.packageKey,
      applicationPackage.letter.language,
      applicationPackage.document.path || `Applications/${applicationPackage.packageKey}/${applicationPackage.document.fileName}`,
      applicationPackage.job.exactPostingUrl,
      applicationPackage.posting.source,
      JSON.stringify(applicationPackage.letter.evidenceIds || []),
      existing?.createdAt || applicationPackage.createdAt || timestamp,
      timestamp
    );
    return packagesByJobId(jobId);
  }

  function packagesByJobId(jobId) {
    const row = db.prepare('SELECT job_id AS jobId,package_key AS packageKey,language,document_path AS documentPath,exact_posting_url AS exactPostingUrl,jd_source AS jdSource,evidence_ids_json AS evidenceIdsJson,created_at AS createdAt,updated_at AS updatedAt FROM application_packages WHERE job_id=?').get(jobId);
    return row ? { ...row, evidenceIds:JSON.parse(row.evidenceIdsJson || '[]') } : null;
  }

  function latestProviderRuns() {
    return db.prepare(`SELECT p.provider AS source,p.status,p.result_count AS count,p.latency_ms AS latencyMs,p.message,p.checked_at AS checkedAt
      FROM provider_runs p JOIN (SELECT provider,MAX(id) id FROM provider_runs GROUP BY provider) latest ON latest.id=p.id
      ORDER BY CASE p.status WHEN 'ok' THEN 0 WHEN 'needs_key' THEN 2 ELSE 3 END,p.provider`).all();
  }

  function listSavedSearches() {
    return db.prepare('SELECT id,name,criteria_json AS criteriaJson,created_at AS createdAt,updated_at AS updatedAt FROM saved_searches ORDER BY name').all()
      .map(row => ({ ...row, criteria:parsePayload(row.criteriaJson) }));
  }

  function saveSearch({ id, name, criteria }) {
    const cleanName = String(name).trim();
    const existing = db.prepare('SELECT id FROM saved_searches WHERE name=?').get(cleanName);
    const key = id || existing?.id || randomUUID();
    const timestamp = nowIso();
    db.prepare(`INSERT INTO saved_searches(id,name,criteria_json,created_at,updated_at) VALUES(?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,criteria_json=excluded.criteria_json,updated_at=excluded.updated_at`).run(key, cleanName, JSON.stringify(criteria || {}), timestamp, timestamp);
    return listSavedSearches().find(item => item.id === key);
  }

  function deleteSearch(id) { return db.prepare('DELETE FROM saved_searches WHERE id=?').run(id).changes > 0; }
  function setMetadata(key, value) { db.prepare('INSERT INTO metadata(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').run(key, String(value), nowIso()); }
  function getMetadata(key) { return db.prepare('SELECT value,updated_at AS updatedAt FROM metadata WHERE key=?').get(key) || null; }
  function stats() {
    const total = db.prepare('SELECT COUNT(*) count FROM jobs').get().count;
    const active = db.prepare('SELECT COUNT(*) count FROM jobs WHERE active=1').get().count;
    const byStatus = db.prepare('SELECT application_status status,COUNT(*) count FROM jobs GROUP BY application_status ORDER BY count DESC').all();
    const applicationPackages = db.prepare('SELECT COUNT(*) count FROM application_packages').get().count;
    const funnel = Object.fromEntries(byStatus.map(row => [row.status || 'Not recorded', row.count]));
    const applications = ['Applied','Interviewing','Offer','Rejected'].reduce((sum, status) => sum + (funnel[status] || 0), 0);
    const interviews = (funnel.Interviewing || 0) + (funnel.Offer || 0);
    const offers = funnel.Offer || 0;
    const conversion = {
      applications,
      interviews,
      offers,
      applicationToInterview:applications ? Math.round(interviews / applications * 100) : null,
      interviewToOffer:interviews ? Math.round(offers / interviews * 100) : null,
      note:'Directional funnel from current application statuses; historical stage transitions remain in application_events.'
    };
    return { total, active, archived:total-active, applicationPackages, byStatus, conversion, database:'SQLite' };
  }

  return { db, importAgentJobs, saveRefresh, listJobs, updateApplication, upsertApplicationPackage, packagesByJobId, latestProviderRuns, listSavedSearches, saveSearch, deleteSearch, setMetadata, getMetadata, stats, migrateStatusLabel, repairApplicationStateFromEvents, enrichPayloads };
}
