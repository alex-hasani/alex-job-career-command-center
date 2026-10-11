import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const nowIso = () => new Date().toISOString();
export const APPLIED_AUTO_REJECT_DAYS = 42;
const APPLICATION_DUPLICATE_WINDOW_MS = 2 * 60 * 60 * 1000;
const normal = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const TERMINAL_APPLICATION_STATUSES = new Set(['Applied', 'Interviewing', 'Offer', 'Rejected', 'Withdrawn', 'Case Closed']);

function lifecycleForApplicationStatus(status, fallback='to_apply') {
  if (['Applied', 'Interviewing', 'Offer'].includes(status)) return 'applied';
  if (['Rejected', 'Withdrawn', 'Case Closed'].includes(status)) return 'archived';
  return fallback;
}
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
  return url || (job.id ? `id:${normal(job.id)}` : '') || identity.replace(/\|+$/g, '');
}
function parsePayload(value) {
  try { return JSON.parse(value || '{}'); } catch { return {}; }
}
function applicationContentKey(row) {
  const company = normal(row.company).replace(/\b(gmbh|ag|se|kg|ug|mbh|inc|ltd|llc)\b$/g, '').trim();
  let title = normal(row.title);
  for (const prefix of [normal(row.company), company].sort((left,right) => right.length - left.length)) {
    if (prefix && title.startsWith(`${prefix} `)) {
      title = title.slice(prefix.length).trim();
      break;
    }
  }
  title = title.replace(/^(gmbh|ag|se|kg|ug|mbh|inc|ltd|llc)\b\s*/g, '')
    .replace(/\b(m w d|w m d|m f d|d m w|all genders|gn|mwd|m)$/g, '').trim();
  return company && title && !/position not stated/.test(title) ? `${company}|${title}` : '';
}
function normalizedLocationTokens(value) {
  const ignored = new Set([
    'baden', 'wurttemberg', 'deutschland', 'germany', 'german', 'remote', 'hybrid',
    'not', 'stated', 'email', 'multiple', 'sites', 'region', 'area'
  ]);
  return new Set(normal(value).split(' ').filter(token => token.length > 2 && !ignored.has(token)));
}
function locationsCompatible(left, right) {
  const leftTokens = normalizedLocationTokens(left.location);
  const rightTokens = normalizedLocationTokens(right.location);
  if (!leftTokens.size || !rightTokens.size) return true;
  return [...leftTokens].some(token => rightTokens.has(token));
}
export function openJobDatabase(path) {
  mkdirSync(dirname(path), { recursive:true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA foreign_keys = ON;
    -- Keep user saves reliable when OneDrive, reconciliation, or another local
    -- process briefly holds a write lock. Wait instead of losing the update.
    PRAGMA busy_timeout = 30000;
    -- The live database can sit in OneDrive. WAL keeps -wal and -shm files open
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
    const rows = db.prepare(`SELECT j.record_key,j.job_id,j.application_status,j.lifecycle_status,j.status_changed_at,j.applied_at,j.availability_status,j.active,j.payload_json,
      e.new_status,e.changed_at
      FROM jobs j
      JOIN application_events e ON e.id=(SELECT e2.id FROM application_events e2 WHERE e2.job_id=j.job_id ORDER BY e2.changed_at DESC,e2.id DESC LIMIT 1)
      WHERE COALESCE(j.application_status,'')<>COALESCE(e.new_status,'')
         OR (e.new_status IN ('Applied','Interviewing','Offer','Rejected','Withdrawn','Case Closed')
             AND (j.active<>0 OR COALESCE(j.availability_status,'')<>'unavailable'))`).all();
    const archivedRows = db.prepare(`SELECT record_key,availability_status,active,payload_json FROM jobs
      WHERE lifecycle_status='archived' AND (active<>0 OR COALESCE(availability_status,'')<>'unavailable')`).all();
    const repairedKeys = new Set(rows.map(row => row.record_key));
    const archivedOnlyRows = archivedRows.filter(row => !repairedKeys.has(row.record_key));
    if (!rows.length && !archivedOnlyRows.length) return 0;
    const update = db.prepare('UPDATE jobs SET application_status=?,lifecycle_status=?,status_changed_at=?,applied_at=?,availability_status=?,active=?,updated_at=?,payload_json=? WHERE record_key=?');
    const archive = db.prepare('UPDATE jobs SET availability_status=?,active=0,updated_at=?,payload_json=? WHERE record_key=?');
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const row of rows) {
        const status = row.new_status || 'Not recorded';
        const lifecycle = lifecycleForApplicationStatus(status);
        const changedAt = row.changed_at || row.status_changed_at || nowIso();
        const appliedAt = status === 'Applied' ? (row.applied_at || changedAt) : row.applied_at;
        const terminal = TERMINAL_APPLICATION_STATUSES.has(status);
        const payload = { ...parsePayload(row.payload_json), applicationStatus:status, lifecycleStatus:lifecycle, applicationStatusChangedAt:changedAt, appliedAt };
        update.run(status, lifecycle, changedAt, appliedAt, terminal ? 'unavailable' : row.availability_status, terminal ? 0 : row.active, nowIso(), JSON.stringify(payload), row.record_key);
      }
      for (const row of archivedOnlyRows) {
        const payload = { ...parsePayload(row.payload_json), lifecycleStatus:'archived', availabilityStatus:'unavailable', active:false };
        archive.run('unavailable', nowIso(), JSON.stringify(payload), row.record_key);
      }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return rows.length + archivedOnlyRows.length;
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
  const selectIdentityRecords = db.prepare(`SELECT * FROM jobs
    WHERE job_id=? OR (?<>'' AND canonical_url=?)
    ORDER BY CASE WHEN application_status<>'Not recorded' THEN 0 ELSE 1 END,
      COALESCE(status_changed_at,updated_at) DESC`);
  const selectLatestApplicationEvent = db.prepare(`SELECT new_status AS newStatus,changed_at AS changedAt
    FROM application_events WHERE job_id=? ORDER BY changed_at DESC,id DESC LIMIT 1`);
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
    const jobUrl = canonicalUrl(job.url);
    const proposedRecordKey = origin === 'agent' ? `agent:${job.id}` : `live:${canonicalKey}`;
    const identityRecords = selectIdentityRecords.all(job.id || proposedRecordKey, jobUrl, jobUrl);
    const existing = selectRecord.get(proposedRecordKey) || identityRecords[0];
    const recordKey = existing?.record_key || proposedRecordKey;
    const persistedJobId = existing?.job_id || job.id || recordKey;
    const applicationSource = identityRecords.find(row =>
      row.application_status !== 'Not recorded' || row.application_comment || row.status_changed_at
    ) || existing;
    const latestEvent = job.id ? selectLatestApplicationEvent.get(job.id) : null;
    const timestamp = job.updatedAt || job.updated_at || nowIso();
    const sourceSet = new Set([...(existing ? JSON.parse(existing.sources_json || '[]') : []), ...(applicationSource ? JSON.parse(applicationSource.sources_json || '[]') : []), job.source].filter(Boolean));
    let applicationStatus = job.applicationStatus || 'Not recorded';
    let applicationComment = job.applicationComment || '';
    let lifecycleStatus = job.lifecycleStatus || (origin === 'agent' ? 'to_apply' : 'discovery');
    let statusChangedAt = job.applicationStatusChangedAt || job.statusChangedAt || null;
    let appliedAt = job.appliedAt || null;
    // Application tracking is user-owned state. A newly fetched posting can have a
    // newer source timestamp, but it must never reset status, notes, or lifecycle
    // dates while refreshing the posting details.
    if (preserveApplication && (latestEvent || applicationSource)) {
      applicationStatus = latestEvent?.newStatus || applicationSource.application_status;
      applicationComment = applicationSource?.application_comment || '';
      lifecycleStatus = lifecycleForApplicationStatus(applicationStatus, applicationSource?.lifecycle_status || lifecycleStatus);
      statusChangedAt = latestEvent?.changedAt || applicationSource?.status_changed_at || statusChangedAt;
      appliedAt = applicationSource?.applied_at || appliedAt;
    } else if (existing) {
      statusChangedAt ||= existing.status_changed_at;
      appliedAt ||= existing.applied_at;
    }
    const existingPayload = parsePayload(existing?.payload_json || applicationSource?.payload_json);
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
    const inactive = TERMINAL_APPLICATION_STATUSES.has(applicationStatus) || lifecycleStatus === 'archived';
    const core = [
      persistedJobId, canonicalKey, jobUrl, existing?.origin || origin, job.source || existing?.source || '', job.provider || existing?.provider || '', job.title || existing?.title || '', job.company || existing?.company || '', job.location || existing?.location || '',
      applicationStatus, applicationComment, lifecycleStatus, statusChangedAt, appliedAt,
      inactive ? 'unavailable' : 'active',
      inactive ? 0 : 1, 0
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
    deduplicateJobs();
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
    deduplicateJobs();
  }

  function deduplicateJobs() {
    const rows = db.prepare('SELECT * FROM jobs ORDER BY updated_at DESC').all();
    const parent = new Map(rows.map(row => [row.record_key, row.record_key]));
    const find = key => {
      let root = key;
      while (parent.get(root) !== root) root = parent.get(root);
      while (parent.get(key) !== key) {
        const next = parent.get(key);
        parent.set(key, root);
        key = next;
      }
      return root;
    };
    const union = (left, right) => {
      const leftRoot = find(left);
      const rightRoot = find(right);
      if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
    };
    const firstByJobId = new Map();
    const firstByUrl = new Map();
    const byContentIdentity = new Map();
    for (const row of rows) {
      if (row.job_id) {
        if (firstByJobId.has(row.job_id)) union(row.record_key, firstByJobId.get(row.job_id));
        else firstByJobId.set(row.job_id, row.record_key);
      }
      if (row.canonical_url) {
        if (firstByUrl.has(row.canonical_url)) union(row.record_key, firstByUrl.get(row.canonical_url));
        else firstByUrl.set(row.canonical_url, row.record_key);
      }
      const contentKey = applicationContentKey(row);
      if (contentKey) {
        const candidates = byContentIdentity.get(contentKey) || [];
        const rowTracked = row.application_status && row.application_status !== 'Not recorded';
        const rowTime = Date.parse(row.applied_at || row.status_changed_at || '');
        for (const candidate of candidates) {
          if (!locationsCompatible(row, candidate.row)) continue;
          const oneTrackedCopy = rowTracked !== candidate.tracked;
          const sameApplicationWindow = rowTracked && candidate.tracked && Number.isFinite(rowTime) &&
            Number.isFinite(candidate.applicationTime) &&
            Math.abs(rowTime - candidate.applicationTime) <= APPLICATION_DUPLICATE_WINDOW_MS;
          if (oneTrackedCopy || sameApplicationWindow) union(row.record_key, candidate.row.record_key);
        }
        candidates.push({ row, tracked:rowTracked, applicationTime:rowTime });
        byContentIdentity.set(contentKey, candidates);
      }
    }
    const components = new Map();
    for (const row of rows) {
      const rootKey = find(row.record_key);
      if (!components.has(rootKey)) components.set(rootKey, []);
      components.get(rootKey).push(row);
    }
    const duplicateGroups = [...components.values()].filter(items => items.length > 1);
    if (!duplicateGroups.length) {
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_jobs_job_id ON jobs(job_id);
        CREATE UNIQUE INDEX IF NOT EXISTS uq_jobs_canonical_url ON jobs(canonical_url) WHERE canonical_url IS NOT NULL AND canonical_url<>'';`);
      return { groups:0, removed:0, remaining:rows.length };
    }

    const deleteJob = db.prepare('DELETE FROM jobs WHERE record_key=?');
    const updateMerged = db.prepare(`UPDATE jobs SET job_id=?,canonical_key=?,canonical_url=?,origin=?,source=?,provider=?,title=?,company=?,location=?,
      application_status=?,application_comment=?,lifecycle_status=?,status_changed_at=?,applied_at=?,availability_status=?,active=?,missing_count=?,
      first_seen=?,last_seen=?,updated_at=?,refresh_id=?,sources_json=?,payload_json=? WHERE record_key=?`);
    const deletePackage = db.prepare('DELETE FROM application_packages WHERE job_id=?');
    const insertPackage = db.prepare(`INSERT INTO application_packages(job_id,package_key,language,document_path,exact_posting_url,jd_source,evidence_ids_json,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?)`);
    let removed = 0;
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const group of duplicateGroups) {
        const score = row => {
          const meaningfulStatus = row.application_status && row.application_status !== 'Not recorded' ? 1 : 0;
          const payload = parsePayload(row.payload_json);
          const detailLength = String(payload.description || payload.jdSnapshot || '').length;
          return meaningfulStatus * 1e15 + Boolean(row.application_comment) * 1e14 + (row.origin === 'agent' ? 1e13 : 0) + Boolean(row.canonical_url) * 1e12 + detailLength * 1e6 + (Date.parse(row.updated_at) || 0);
        };
        group.sort((left, right) => score(right) - score(left));
        const survivor = group[0];
        const duplicateRows = group.slice(1);
        const jobIds = [...new Set(group.map(row => row.job_id).filter(Boolean))];
        const placeholders = jobIds.map(() => '?').join(',');
        const events = placeholders ? db.prepare(`SELECT * FROM application_events WHERE job_id IN (${placeholders}) ORDER BY changed_at DESC,id DESC`).all(...jobIds) : [];
        const latestEvent = events[0];
        const statusRows = group.filter(row => row.application_status && row.application_status !== 'Not recorded')
          .sort((left, right) => (Date.parse(right.status_changed_at || right.updated_at) || 0) - (Date.parse(left.status_changed_at || left.updated_at) || 0));
        const applicationRow = statusRows[0] || survivor;
        const applicationStatus = latestEvent?.new_status || applicationRow.application_status || 'Not recorded';
        const statusChangedAt = latestEvent?.changed_at || applicationRow.status_changed_at || null;
        const appliedDates = group.map(row => row.applied_at).filter(Boolean).sort();
        const appliedAt = appliedDates[0] || null;
        const applicationComment = group.map(row => row.application_comment || '').sort((left,right) => right.length - left.length)[0] || '';
        const lifecycleStatus = lifecycleForApplicationStatus(applicationStatus, group.some(row => row.lifecycle_status === 'archived') ? 'archived' : survivor.lifecycle_status);
        const inactive = TERMINAL_APPLICATION_STATUSES.has(applicationStatus) || lifecycleStatus === 'archived';
        const mergedPayload = {};
        for (const row of [...group].reverse()) Object.assign(mergedPayload, parsePayload(row.payload_json));
        const descriptions = group.map(row => parsePayload(row.payload_json)).map(payload => payload.description || payload.jdSnapshot || '').sort((left,right) => right.length - left.length);
        if (descriptions[0]) {
          mergedPayload.description = descriptions[0];
          mergedPayload.jdSnapshot ||= descriptions[0];
        }
        Object.assign(mergedPayload, {
          applicationStatus,
          applicationComment,
          lifecycleStatus,
          applicationStatusChangedAt:statusChangedAt,
          appliedAt,
          availabilityStatus:inactive ? 'unavailable' : survivor.availability_status,
          active:!inactive
        });
        const sources = [...new Set(group.flatMap(row => {
          try { return JSON.parse(row.sources_json || '[]'); } catch { return []; }
        }).concat(group.map(row => row.source)).filter(Boolean))];
        const canonicalUrlValue = survivor.canonical_url || group.find(row => row.canonical_url)?.canonical_url || '';
        const canonicalKey = canonicalUrlValue || `id:${normal(survivor.job_id)}` || survivor.canonical_key;
        const firstSeen = group.map(row => row.first_seen).filter(Boolean).sort()[0] || survivor.first_seen;
        const lastSeen = group.map(row => row.last_seen).filter(Boolean).sort().at(-1) || survivor.last_seen;
        const updatedAt = group.map(row => row.updated_at).filter(Boolean).sort().at(-1) || survivor.updated_at;

        const packages = placeholders ? db.prepare(`SELECT * FROM application_packages WHERE job_id IN (${placeholders}) ORDER BY updated_at DESC`).all(...jobIds) : [];
        for (const jobId of jobIds) deletePackage.run(jobId);
        if (packages[0]) {
          const item = packages[0];
          insertPackage.run(survivor.job_id, item.package_key, item.language, item.document_path, item.exact_posting_url, item.jd_source, item.evidence_ids_json, item.created_at, item.updated_at);
        }
        if (placeholders) db.prepare(`UPDATE application_events SET job_id=? WHERE job_id IN (${placeholders})`).run(survivor.job_id, ...jobIds);
        for (const row of duplicateRows) {
          deleteJob.run(row.record_key);
          removed += 1;
        }
        updateMerged.run(
          survivor.job_id, canonicalKey, canonicalUrlValue, survivor.origin, survivor.source, survivor.provider,
          survivor.title, survivor.company, survivor.location, applicationStatus, applicationComment, lifecycleStatus,
          statusChangedAt, appliedAt, inactive ? 'unavailable' : survivor.availability_status, inactive ? 0 : survivor.active,
          Math.min(...group.map(row => Number(row.missing_count) || 0)), firstSeen, lastSeen, updatedAt,
          survivor.refresh_id, JSON.stringify(sources), JSON.stringify(mergedPayload), survivor.record_key
        );
      }
      db.exec(`DELETE FROM application_events WHERE id NOT IN (
        SELECT MIN(id) FROM application_events GROUP BY job_id,COALESCE(previous_status,''),new_status,changed_at,source
      );
      CREATE UNIQUE INDEX IF NOT EXISTS uq_jobs_job_id ON jobs(job_id);
      CREATE UNIQUE INDEX IF NOT EXISTS uq_jobs_canonical_url ON jobs(canonical_url) WHERE canonical_url IS NOT NULL AND canonical_url<>'';`);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return { groups:duplicateGroups.length, removed, remaining:rows.length - removed };
  }

  function expireStaleAppliedApplications({ asOf = new Date(), maxAgeDays = APPLIED_AUTO_REJECT_DAYS } = {}) {
    const asOfDate = asOf instanceof Date ? asOf : new Date(asOf);
    if (!Number.isFinite(asOfDate.getTime())) throw new Error('Invalid application ageing timestamp');
    const days = Number(maxAgeDays);
    if (!Number.isFinite(days) || days <= 0) throw new Error('Application ageing days must be positive');
    const cutoff = new Date(asOfDate.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
    const due = db.prepare(`SELECT job_id AS jobId,MIN(COALESCE(applied_at,status_changed_at)) AS appliedAt
      FROM jobs
      WHERE application_status='Applied'
        AND COALESCE(applied_at,status_changed_at) IS NOT NULL
        AND julianday(COALESCE(applied_at,status_changed_at)) < julianday(?)
      GROUP BY job_id
      ORDER BY appliedAt`).all(cutoff);
    for (const row of due) {
      updateApplication(row.jobId, {
        applicationStatus:'Rejected',
        lifecycleStatus:'archived',
        applicationStatusChangedAt:asOfDate.toISOString(),
        changeSource:'system:auto-reject-after-6-weeks',
        autoRejectedAfterDays:days
      });
    }
    return { changed:due.length, cutoff, jobIds:due.map(row => row.jobId) };
  }

  function listJobs({ includeInactive=true } = {}) {
    expireStaleAppliedApplications();
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

  function listJobState() {
    return db.prepare(`SELECT job_id AS jobId,application_status AS applicationStatus,
      application_comment AS applicationComment,status_changed_at AS applicationStatusChangedAt,
      applied_at AS appliedAt,lifecycle_status AS lifecycleStatus,
      availability_status AS availabilityStatus,active,last_seen AS lastSeenAt
      FROM jobs`).all();
  }

  function getJob(jobId) {
    const row = db.prepare("SELECT * FROM jobs WHERE job_id=? ORDER BY CASE origin WHEN 'agent' THEN 0 ELSE 1 END, updated_at DESC LIMIT 1").get(jobId);
    if (!row) return null;
    const payload = parsePayload(row.payload_json);
    const applicationHistory = db.prepare('SELECT job_id AS jobId,previous_status AS previousStatus,new_status AS newStatus,changed_at AS changedAt,source FROM application_events WHERE job_id=? ORDER BY changed_at DESC,id DESC').all(row.job_id);
    const packageRow = db.prepare('SELECT job_id AS jobId,package_key AS packageKey,language,document_path AS documentPath,exact_posting_url AS exactPostingUrl,jd_source AS jdSource,evidence_ids_json AS evidenceIdsJson,created_at AS createdAt,updated_at AS updatedAt FROM application_packages WHERE job_id=?').get(row.job_id);
    return {
      ...payload,
      id:row.job_id,
      source:row.source || payload.source,
      sources:JSON.parse(row.sources_json || '[]'),
      applicationStatus:row.application_status,
      applicationComment:row.application_comment,
      applicationStatusChangedAt:row.status_changed_at,
      appliedAt:row.applied_at,
      applicationHistory,
      lifecycleStatus:row.lifecycle_status,
      availabilityStatus:row.availability_status,
      active:Boolean(row.active),
      canonicalKey:row.canonical_key,
      lastSeenAt:row.last_seen,
      applicationPackage:packageRow ? { ...packageRow, evidenceIds:JSON.parse(packageRow.evidenceIdsJson || '[]') } : null
    };
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
    const nextLifecycle = changes.lifecycleStatus ?? lifecycleForApplicationStatus(nextStatus, row.lifecycle_status);
    const identityRows = selectIdentityRecords.all(row.job_id, row.canonical_url || '', row.canonical_url || '');
    const updateIdentity = db.prepare(`UPDATE jobs SET application_status=?,application_comment=?,lifecycle_status=?,status_changed_at=?,applied_at=?,
      availability_status=?,active=?,updated_at=?,payload_json=? WHERE record_key=?`);
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const identityRow of identityRows) {
        const terminal = TERMINAL_APPLICATION_STATUSES.has(nextStatus);
        const payload = { ...parsePayload(identityRow.payload_json), ...changes, applicationStatus:nextStatus, applicationComment:changes.applicationComment ?? row.application_comment, lifecycleStatus:nextLifecycle, applicationStatusChangedAt:changedAt, appliedAt };
        updateIdentity.run(
          nextStatus,
          changes.applicationComment ?? row.application_comment,
          nextLifecycle,
          changedAt, appliedAt,
          terminal ? 'unavailable' : identityRow.availability_status,
          terminal ? 0 : identityRow.active,
          nowIso(), JSON.stringify(payload), identityRow.record_key
        );
      }
      if (recordEvent && !changes.suppressEvent) db.prepare('INSERT INTO application_events(job_id,previous_status,new_status,changed_at,source) VALUES(?,?,?,?,?)').run(
        row.job_id, changes.previousStatusOverride ?? (statusChanged ? (row.application_status || '') : ''), nextStatus, changedAt, changes.changeSource || 'user'
      );
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return getJob(jobId);
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

  return { db, importAgentJobs, saveRefresh, listJobs, listJobState, getJob, updateApplication, expireStaleAppliedApplications, deduplicateJobs, upsertApplicationPackage, packagesByJobId, latestProviderRuns, listSavedSearches, saveSearch, deleteSearch, setMetadata, getMetadata, stats, migrateStatusLabel, repairApplicationStateFromEvents, enrichPayloads };
}
