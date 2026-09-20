import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';

const root = resolve(process.cwd());
const ignoredDirectories = new Set(['.git', 'node_modules', 'runtime', 'tmp', 'coverage']);
const forbiddenDirectoryNames = new Set(['state', 'applications', 'backups', 'logs', 'evidence_bank', 'job_postings']);
const forbiddenExtensions = new Set(['.sqlite', '.sqlite3', '.db', '.xlsx', '.xls', '.docx', '.pdf', '.pem', '.key', '.p12', '.pfx']);
const forbiddenBasenames = new Set(['job-sources.config.json', 'gmail-lifecycle-evidence.json', 'source-health.json']);
const textExtensions = new Set(['', '.md', '.txt', '.json', '.js', '.mjs', '.cjs', '.html', '.css', '.svg', '.webmanifest', '.yml', '.yaml', '.toml', '.ps1', '.sh']);
const findings = [];

function walk(directory) {
  return readdirSync(directory, { withFileTypes:true }).flatMap(entry => {
    if (ignoredDirectories.has(entry.name)) return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function repositoryFiles() {
  if (!existsSync(join(root, '.git'))) return walk(root);
  const output = execFileSync('git', ['ls-files', '-z'], { cwd:root, encoding:'utf8' });
  return output.split('\0').filter(Boolean).map(path => join(root, path));
}

function add(path, reason) {
  findings.push(`${relative(root, path) || '.'}: ${reason}`);
}

function scanText(path, text, scope='working tree') {
  const emails = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  for (const email of emails) {
    if (!/@example\.(?:com|org|net)$/i.test(email) && !/@users\.noreply\.github\.com$/i.test(email)) add(path, `${scope} contains a non-example email address`);
  }
  const rules = [
    [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i, 'contains a private key'],
    [/\bgh[oprsu]_[A-Za-z0-9_]{30,}\b/, 'contains a GitHub token'],
    [/\bAKIA[0-9A-Z]{16}\b/, 'contains an AWS access key'],
    [/\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*["'][^"'\s]{12,}["']/i, 'contains a likely credential'],
    [/C:\\Users\\(?!Public(?:\\|$)|Example(?:\\|$))[^\\\s"']+/i, 'contains a local Windows user path'],
    [/\+(?:\d[\s()./-]*){10,15}(?!\d)/, 'contains a likely telephone number']
  ];
  for (const [pattern, reason] of rules) {
    const match = text.match(pattern);
    if (!match) continue;
    if (reason.includes('telephone') && /^\+?49[\s0()./-]*0(?:[\s0()./-]*0){8,}$/.test(match[0].replace(/\s/g,''))) continue;
    add(path, `${scope} ${reason}`);
  }
}

for (const path of repositoryFiles()) {
  if (!existsSync(path) || !statSync(path).isFile()) continue;
  const normalized = relative(root, path).split(sep).map(value => value.toLowerCase());
  if (normalized.some(part => forbiddenDirectoryNames.has(part))) add(path, 'private runtime directory is tracked');
  if (forbiddenExtensions.has(extname(path).toLowerCase())) add(path, 'private or generated binary file is tracked');
  if (forbiddenBasenames.has(normalized.at(-1))) add(path, 'private local evidence or configuration file is tracked');
  if (textExtensions.has(extname(path).toLowerCase())) scanText(path, readFileSync(path, 'utf8'));
}

const discoveredSourcesPath = join(root, 'gmail-discovered-sources.json');
if (existsSync(discoveredSourcesPath)) {
  try {
    const sources = JSON.parse(readFileSync(discoveredSourcesPath, 'utf8'));
    if (!Array.isArray(sources) || sources.length) add(discoveredSourcesPath, 'mailbox-derived source evidence must be empty in the public mirror');
  } catch {
    add(discoveredSourcesPath, 'must be valid JSON');
  }
}

let hasHistory = false;
if (existsSync(join(root, '.git'))) {
  try {
    execFileSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd:root, stdio:'ignore' });
    hasHistory = true;
  } catch {}
}
if (hasHistory) {
  const authors = execFileSync('git', ['log', '--all', '--format=%ae'], { cwd:root, encoding:'utf8' }).split(/\r?\n/).filter(Boolean);
  for (const email of new Set(authors)) {
    if (!/@users\.noreply\.github\.com$/i.test(email)) findings.push(`Git history: author email is not a GitHub noreply address`);
  }
  const history = execFileSync('git', ['log', '--all', '-p', '--no-ext-diff', '--pretty=format:'], { cwd:root, encoding:'utf8', maxBuffer:50 * 1024 * 1024 });
  scanText(join(root, '.git-history'), history, 'Git history');
}

if (findings.length) {
  console.error('Public release audit failed:\n' + [...new Set(findings)].map(value => `- ${value}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log('Public release audit passed: no blocked private data, credentials, runtime artifacts, or unsafe author emails detected.');
}
