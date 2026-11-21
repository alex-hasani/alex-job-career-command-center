import { readFileSync } from 'node:fs';

function postingKey(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    const path = url.pathname.replace(/%28/gi, '(').replace(/%29/gi, ')').replace(/\/$/, '');
    return path ? url.origin + path + url.search : '';
  } catch { return ''; }
}

export function compileVerifiedPostingAliases(groups) {
  if (!Array.isArray(groups)) throw new Error('Expected a list of verified posting URL groups');
  const aliases = new Map();
  for (const [group, urls] of groups.entries()) {
    if (!Array.isArray(urls) || urls.length < 2) throw new Error('Expected two or more URLs per group');
    for (const [priority, url] of urls.entries()) {
      const key = postingKey(url);
      if (!key || aliases.has(key)) throw new Error('Invalid or overlapping verified posting alias');
      aliases.set(key, { group, priority });
    }
  }
  return aliases;
}

export function loadVerifiedPostingAliases(path, onError) {
  try { return compileVerifiedPostingAliases(JSON.parse(readFileSync(path, 'utf8'))); }
  catch (error) {
    if (error.code !== 'ENOENT') onError(error);
    return new Map();
  }
}

function tracked(job) {
  return (job.applicationStatus && job.applicationStatus !== 'Not recorded') ||
    job.applicationComment || job.applicationStatusChangedAt || job.appliedAt ||
    job.applicationHistory?.length || job.applicationPackage;
}

// Keep every tracked record if both URLs have independent application activity.
// For untouched copies, prefer availability, then the configured URL order.
export function groupVerifiedPostingAliases(jobs, aliases) {
  if (!aliases.size) return jobs;
  const memberships = jobs.map(job => aliases.get(postingKey(job.url)));
  const representatives = new Map();
  for (const [index, membership] of memberships.entries()) {
    if (!membership) continue;
    const job = jobs[index];
    const rank = tracked(job) ? 2 : job.active !== false ? 1 : 0;
    const current = representatives.get(membership.group);
    if (!current || rank > current.rank || (rank === current.rank && membership.priority < current.priority)) {
      representatives.set(membership.group, { index, rank, priority:membership.priority });
    }
  }
  return jobs.filter((job, index) => {
    const membership = memberships[index];
    return !membership || tracked(job) || representatives.get(membership.group).index === index;
  });
}
