import { readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const registryPath = resolve(root, 'gmail-discovered-sources.json');
const reviewedPath = process.argv[2] ? resolve(process.argv[2]) : '';
if (!reviewedPath) throw new Error('Usage: node merge-gmail-sources.mjs <reviewed-gmail-sources.json>');

function host(value) {
  try { return new URL(value.includes('://') ? value : `https://${value}`).hostname.toLowerCase().replace(/^www\./, ''); }
  catch { return ''; }
}
function domain(value) {
  const hostname = host(value);
  if (!hostname) return '';
  if (/\.(myworkdayjobs|personio|softgarden)\.com$/.test(hostname) || /\.jobs\.personio\.de$/.test(hostname) || /\.jobs2web\.com$/.test(hostname)) return hostname;
  const parts = hostname.split('.');
  return parts.slice(/\.(co\.uk|com\.au|co\.nz)$/.test(hostname) ? -3 : -2).join('.');
}
function identity(source) { return domain(source.canonicalDomain || source.url || ''); }

const [current, reviewed] = await Promise.all([
  readFile(registryPath, 'utf8').then(JSON.parse).catch(() => []),
  readFile(reviewedPath, 'utf8').then(JSON.parse)
]);
if (!Array.isArray(reviewed)) throw new Error('Reviewed input must be a JSON array');

const byDomain = new Map(current.map(source => [identity(source), source]).filter(([key]) => key));
let added = 0;
let updated = 0;
for (const source of reviewed) {
  const key = identity(source);
  if (!key || !source.name || !source.url || source.status === 'rejected') continue;
  const previous = byDomain.get(key);
  if (previous) {
    byDomain.set(key, {
      ...previous,
      ...source,
      canonicalDomain:key,
      aliases:[...new Set([...(previous.aliases || []), ...(source.aliases || [])])],
      firstSeenAt:previous.firstSeenAt || source.firstSeenAt,
      lastSeenAt:source.lastSeenAt || new Date().toISOString(),
      evidenceCount:Math.max(Number(previous.evidenceCount || 0), Number(source.evidenceCount || 0)),
      discoveredFrom:'Gmail'
    });
    updated++;
  } else {
    byDomain.set(key, { ...source, canonicalDomain:key, discoveredFrom:'Gmail', firstSeenAt:source.firstSeenAt || new Date().toISOString(), lastSeenAt:source.lastSeenAt || new Date().toISOString() });
    added++;
  }
}
const output = [...byDomain.values()].sort((a, b) => a.name.localeCompare(b.name));
const temporary = `${registryPath}.tmp`;
await writeFile(temporary, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
await rename(temporary, registryPath);
console.log(JSON.stringify({ added, updated, total:output.length, registryPath }, null, 2));
