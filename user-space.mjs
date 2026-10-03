import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scrypt = promisify(scryptCallback);
const PASSWORD_N = 2 ** 15;
const PASSWORD_R = 8;
const PASSWORD_P = 3;
const PASSWORD_KEY_BYTES = 64;
const MAX_RESUME_BYTES = 8 * 1024 * 1024;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const COOKIE_HTTP = 'alex_job_session';
const COOKIE_HTTPS = '__Host-alex_job_session';
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const ALLOWED_EXTENSIONS = new Set(['.pdf', '.txt']);
const nowIso = () => new Date().toISOString();
const sha256 = value => createHash('sha256').update(value).digest('hex');

function httpError(status, message, code='') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function normalizedUsername(value) {
  const username = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(username)) {
    throw httpError(400, 'Username must be 3-64 characters and use letters, numbers, dot, dash, or underscore.', 'INVALID_USERNAME');
  }
  return username;
}

function validatePassword(password) {
  const value = String(password || '');
  if (value.length < 12 || value.length > 128) throw httpError(400, 'Password must contain 12-128 characters.', 'WEAK_PASSWORD');
  return value;
}

export async function hashPassword(password) {
  const value = validatePassword(password);
  const salt = randomBytes(16);
  const derived = await scrypt(value, salt, PASSWORD_KEY_BYTES, { N:PASSWORD_N, r:PASSWORD_R, p:PASSWORD_P, maxmem:96 * 1024 * 1024 });
  return `scrypt$1$${PASSWORD_N}$${PASSWORD_R}$${PASSWORD_P}$${salt.toString('base64')}$${Buffer.from(derived).toString('base64')}`;
}

export async function verifyPassword(password, encoded) {
  try {
    const [algorithm, version, n, r, p, salt64, hash64] = String(encoded || '').split('$');
    if (algorithm !== 'scrypt' || version !== '1') return false;
    const expected = Buffer.from(hash64, 'base64');
    const actual = Buffer.from(await scrypt(String(password || ''), Buffer.from(salt64, 'base64'), expected.length, {
      N:Number(n), r:Number(r), p:Number(p), maxmem:96 * 1024 * 1024,
    }));
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch { return false; }
}

function parseCookies(header='') {
  return Object.fromEntries(String(header).split(';').map(part => part.trim()).filter(Boolean).map(part => {
    const index = part.indexOf('=');
    return index < 0 ? [part, ''] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
  }));
}

function isSecureRequest(req) {
  return Boolean(req.socket.encrypted) || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

function sessionCookie(req, token, maxAgeSeconds=Math.floor(SESSION_TTL_MS / 1000)) {
  const secure = isSecureRequest(req);
  const name = secure ? COOKIE_HTTPS : COOKIE_HTTP;
  return `${name}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
}

function clearCookies() {
  return [
    `${COOKIE_HTTP}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict`,
    `${COOKIE_HTTPS}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict; Secure`,
  ];
}

function securityHeaders(extra={}) {
  return {
    'cache-control':'no-store',
    'content-security-policy':"default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    'referrer-policy':'no-referrer',
    'x-content-type-options':'nosniff',
    'x-frame-options':'DENY',
    'permissions-policy':'camera=(), microphone=(), geolocation=()',
    ...extra,
  };
}

function sendJson(res, status, payload, headers={}) {
  res.writeHead(status, securityHeaders({ 'content-type':'application/json; charset=utf-8', ...headers }));
  res.end(JSON.stringify(payload));
}

function readJson(req, limit=100_000) {
  return readBuffer(req, limit).then(buffer => {
    try { return JSON.parse(buffer.toString('utf8') || '{}'); }
    catch { throw httpError(400, 'Invalid JSON request.', 'INVALID_JSON'); }
  });
}

function readBuffer(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    req.on('data', chunk => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        settled = true;
        reject(httpError(413, `Upload exceeds the ${Math.floor(limit / 1024 / 1024)} MB limit.`, 'UPLOAD_TOO_LARGE'));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => { if (!settled) resolve(Buffer.concat(chunks)); });
    req.on('error', error => { if (!settled) reject(error); });
  });
}

function decodeFileName(value) {
  try { return decodeURIComponent(String(value || '')); }
  catch { return String(value || ''); }
}

async function extractPdfText(buffer) {
  const dedicatedModule = join(dirname(fileURLToPath(import.meta.url)), 'user-space-deps', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs');
  const moduleSpecifier = existsSync(dedicatedModule) ? pathToFileURL(dedicatedModule).href : 'pdfjs-dist/legacy/build/pdf.mjs';
  const { getDocument } = await import(moduleSpecifier);
  const document = await getDocument({ data:new Uint8Array(buffer), useSystemFonts:true }).promise;
  const pages = [];
  for (let number = 1; number <= document.numPages; number += 1) {
    const page = await document.getPage(number);
    const content = await page.getTextContent();
    pages.push(content.items.map(item => String(item.str || '')).join(' '));
  }
  return pages.join('\n');
}

async function extractResumeText(buffer, extension) {
  const raw = extension === '.txt' ? buffer.toString('utf8') : await extractPdfText(buffer);
  return raw.replace(/\u0000/g, '').replace(/[ \t]+/g, ' ').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

const STOP_WORDS = new Set('a an and are as at be by for from in into is it of on or the to with und der die das den dem des ein eine einer einem einen im in zu von mit für als auf bei sich ist sind wird werden sowie oder your you our wir sie'.split(' '));
function tokens(value) {
  return [...new Set(String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/[a-z0-9+#.]{2,}/g) || [])]
    .filter(token => !STOP_WORDS.has(token) && !/^\d+$/.test(token));
}

function cleanResumeLines(text) {
  const seen = new Set();
  return String(text || '').split('\n').map(line => line.replace(/^[\s•●▪◦*-]+/, '').replace(/\s+/g, ' ').trim()).filter(line => {
    if (!line) return false;
    const key = line.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function refineResumeEvidence(resumeText, jobDescription='') {
  const lines = cleanResumeLines(resumeText);
  if (lines.length < 3) throw httpError(422, 'The uploaded resume does not contain enough extractable text. Upload a text-based PDF or TXT file.', 'RESUME_TEXT_REQUIRED');
  const resumeTokens = new Set(tokens(lines.join(' ')));
  const jobTokens = tokens(jobDescription);
  const matchedKeywords = jobTokens.filter(token => resumeTokens.has(token)).slice(0, 80);
  const missingKeywords = jobTokens.filter(token => !resumeTokens.has(token)).slice(0, 80);
  const weighted = lines.map((line, sourceIndex) => {
    const lineTokens = tokens(line);
    const overlap = lineTokens.filter(token => matchedKeywords.includes(token));
    return { sourceIndex, text:line, score:overlap.length, matchedKeywords:overlap };
  });
  const priorityEvidence = weighted.filter(item => item.score > 0).sort((left, right) => right.score - left.score || left.sourceIndex - right.sourceIndex).slice(0, 18);
  const mode = String(jobDescription || '').trim() ? 'job-tailored' : 'ats-base';
  return {
    mode,
    atsText:lines.join('\n'),
    priorityEvidence,
    matchedKeywords,
    missingKeywords,
    evidenceLineCount:lines.length,
    sourceOnly:true,
    inventedContent:false,
    guidance:missingKeywords.length
      ? 'Missing job-description terms are shown for review only and were not added to the resume.'
      : 'No unsupported job-description terms were added.',
  };
}

export function openUserSpaceDatabase(path) {
  mkdirSync(dirname(path), { recursive:true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = DELETE;
    PRAGMA synchronous = FULL;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      disabled_at TEXT
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      csrf_token TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, expires_at);
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      original_name TEXT NOT NULL,
      stored_path TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      extracted_text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(user_id, kind, sha256)
    );
    CREATE INDEX IF NOT EXISTS idx_documents_user ON documents(user_id, kind, created_at DESC);
    CREATE TABLE IF NOT EXISTS resume_drafts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      source_document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      mode TEXT NOT NULL,
      job_description_hash TEXT,
      result_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_resume_drafts_user ON resume_drafts(user_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS security_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      event_type TEXT NOT NULL,
      occurred_at TEXT NOT NULL
    );
  `);
  return db;
}

function publicUser(row) {
  return row ? { id:row.id, username:row.username, displayName:row.display_name, createdAt:row.created_at } : null;
}

function publicDocument(row) {
  return row ? { id:row.id, kind:row.kind, originalName:row.original_name, mimeType:row.mime_type, byteSize:row.byte_size, sha256:row.sha256, createdAt:row.created_at, extractedCharacters:String(row.extracted_text || '').length } : null;
}

export function createUserSpaceRouter({ root, workspace, databasePath=join(workspace, 'State', 'user-space.sqlite'), storageRoot=join(workspace, 'State', 'user-space-files') }) {
  const db = openUserSpaceDatabase(databasePath);
  const attempts = new Map();
  const dummyPasswordHash = hashPassword('constant-time-placeholder-password-2026');
  const staticFiles = new Map([
    ['/', ['user-space.html', 'text/html; charset=utf-8']],
    ['/user-space', ['user-space.html', 'text/html; charset=utf-8']],
    ['/user-space/', ['user-space.html', 'text/html; charset=utf-8']],
    ['/dashboard', ['index.html', 'text/html; charset=utf-8']],
    ['/index.html', ['index.html', 'text/html; charset=utf-8']],
    ['/user-space.js', ['user-space.js', 'text/javascript; charset=utf-8']],
    ['/user-space.css', ['user-space.css', 'text/css; charset=utf-8']],
  ]);

  function recordSecurity(userId, type) {
    db.prepare('INSERT INTO security_events(user_id,event_type,occurred_at) VALUES(?,?,?)').run(userId || null, type, nowIso());
  }

  function checkRate(req, key) {
    const remote = String(req.socket.remoteAddress || 'unknown').replace(/^::ffff:/, '');
    const id = `${remote}:${key}`;
    const now = Date.now();
    const recent = (attempts.get(id) || []).filter(at => now - at < 15 * 60 * 1000);
    if (recent.length >= 5) throw httpError(429, 'Too many attempts. Wait 15 minutes before trying again.', 'RATE_LIMITED');
    recent.push(now);
    attempts.set(id, recent);
    return () => attempts.delete(id);
  }

  function assertSameOrigin(req) {
    if (!MUTATING.has(String(req.method || '').toUpperCase())) return;
    const origin = String(req.headers.origin || '');
    const expected = `${isSecureRequest(req) ? 'https' : 'http'}://${req.headers.host}`;
    if (!origin || origin !== expected) throw httpError(403, 'Request origin was not accepted.', 'ORIGIN_REJECTED');
  }

  function rawSession(req) {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[COOKIE_HTTPS] || cookies[COOKIE_HTTP] || '';
    if (!token) return null;
    const tokenHash = sha256(token);
    const row = db.prepare(`SELECT s.*,u.username,u.display_name,u.created_at AS user_created_at,u.disabled_at
      FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?`).get(tokenHash);
    if (!row || row.disabled_at || Date.parse(row.expires_at) <= Date.now()) {
      if (row) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash);
      return null;
    }
    return { tokenHash, row, user:{ id:row.user_id, username:row.username, display_name:row.display_name, created_at:row.user_created_at } };
  }

  function requireSession(req, { csrf=false }={}) {
    const session = rawSession(req);
    if (!session) throw httpError(401, 'Sign in to continue.', 'AUTH_REQUIRED');
    if (csrf && String(req.headers['x-csrf-token'] || '') !== session.row.csrf_token) throw httpError(403, 'The security token is missing or expired. Reload the account page.', 'CSRF_REJECTED');
    db.prepare('UPDATE sessions SET last_seen_at=? WHERE token_hash=?').run(nowIso(), session.tokenHash);
    return session;
  }

  function createSession(userId, req) {
    const token = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(24).toString('base64url');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
    db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(now.toISOString());
    db.prepare('INSERT INTO sessions(token_hash,user_id,csrf_token,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?,?)')
      .run(sha256(token), userId, csrfToken, now.toISOString(), expiresAt, now.toISOString());
    return { token, csrfToken, expiresAt, cookie:sessionCookie(req, token) };
  }

  async function register(req, res) {
    const clearAttempt = checkRate(req, 'register');
    const input = await readJson(req);
    const username = normalizedUsername(input.username);
    const displayName = String(input.displayName || '').replace(/\s+/g, ' ').trim().slice(0, 100);
    if (displayName.length < 2) throw httpError(400, 'Display name is required.', 'INVALID_DISPLAY_NAME');
    const existing = db.prepare('SELECT id FROM users WHERE username=?').get(username);
    if (existing) throw httpError(409, 'That username is unavailable.', 'USERNAME_UNAVAILABLE');
    const passwordHash = await hashPassword(input.password);
    const user = { id:randomUUID(), username, display_name:displayName, created_at:nowIso() };
    db.prepare('INSERT INTO users(id,username,display_name,password_hash,created_at,updated_at) VALUES(?,?,?,?,?,?)')
      .run(user.id, user.username, user.display_name, passwordHash, user.created_at, user.created_at);
    recordSecurity(user.id, 'account_created');
    const session = createSession(user.id, req);
    clearAttempt();
    sendJson(res, 201, { ok:true, user:publicUser(user), csrfToken:session.csrfToken, expiresAt:session.expiresAt }, { 'set-cookie':session.cookie });
  }

  async function login(req, res) {
    const clearAttempt = checkRate(req, 'login');
    const input = await readJson(req);
    let username = '';
    try { username = normalizedUsername(input.username); } catch {}
    const user = username ? db.prepare('SELECT * FROM users WHERE username=? AND disabled_at IS NULL').get(username) : null;
    const valid = user ? await verifyPassword(input.password, user.password_hash) : await verifyPassword(input.password, await dummyPasswordHash);
    if (!user || !valid) {
      recordSecurity(user?.id, 'login_failed');
      throw httpError(401, 'Username or password is incorrect.', 'INVALID_CREDENTIALS');
    }
    const session = createSession(user.id, req);
    recordSecurity(user.id, 'login_succeeded');
    clearAttempt();
    sendJson(res, 200, { ok:true, user:publicUser(user), csrfToken:session.csrfToken, expiresAt:session.expiresAt }, { 'set-cookie':session.cookie });
  }

  async function uploadResume(req, res) {
    const session = requireSession(req, { csrf:true });
    const originalName = basename(decodeFileName(req.headers['x-file-name'] || 'resume.pdf')).slice(0, 180);
    const extension = extname(originalName).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(extension)) throw httpError(415, 'Upload a text-based PDF or TXT resume.', 'UNSUPPORTED_RESUME');
    const buffer = await readBuffer(req, MAX_RESUME_BYTES);
    if (!buffer.length) throw httpError(400, 'The resume file is empty.', 'EMPTY_RESUME');
    const digest = sha256(buffer);
    const duplicate = db.prepare('SELECT * FROM documents WHERE user_id=? AND kind=? AND sha256=?').get(session.row.user_id, 'initial_resume', digest);
    if (duplicate) return sendJson(res, 200, { ok:true, duplicate:true, document:publicDocument(duplicate) });
    const extractedText = await extractResumeText(buffer, extension);
    if (cleanResumeLines(extractedText).length < 3) throw httpError(422, 'No usable text was found. Upload a text-based PDF or TXT resume; scanned images require OCR first.', 'RESUME_TEXT_REQUIRED');
    const id = randomUUID();
    const userDirectory = join(storageRoot, session.row.user_id, 'resumes');
    await mkdir(userDirectory, { recursive:true });
    const storedPath = join(userDirectory, `${id}${extension}`);
    await writeFile(storedPath, buffer, { flag:'wx' });
    const row = { id, user_id:session.row.user_id, kind:'initial_resume', original_name:originalName, stored_path:storedPath, mime_type:extension === '.pdf' ? 'application/pdf' : 'text/plain', byte_size:buffer.length, sha256:digest, extracted_text:extractedText, created_at:nowIso() };
    db.prepare(`INSERT INTO documents(id,user_id,kind,original_name,stored_path,mime_type,byte_size,sha256,extracted_text,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(row.id,row.user_id,row.kind,row.original_name,row.stored_path,row.mime_type,row.byte_size,row.sha256,row.extracted_text,row.created_at);
    recordSecurity(session.row.user_id, 'resume_uploaded');
    sendJson(res, 201, { ok:true, document:publicDocument(row) });
  }

  function latestResume(userId) {
    return db.prepare("SELECT * FROM documents WHERE user_id=? AND kind='initial_resume' ORDER BY created_at DESC LIMIT 1").get(userId);
  }

  async function refine(req, res) {
    const session = requireSession(req, { csrf:true });
    const input = await readJson(req, 250_000);
    const source = latestResume(session.row.user_id);
    if (!source) throw httpError(409, 'Upload the initial resume first.', 'RESUME_REQUIRED');
    const jobDescription = String(input.jobDescription || '').trim().slice(0, 200_000);
    const result = refineResumeEvidence(source.extracted_text, jobDescription);
    const draft = { id:randomUUID(), user_id:session.row.user_id, source_document_id:source.id, mode:result.mode, job_description_hash:jobDescription ? sha256(jobDescription) : null, result_json:JSON.stringify(result), created_at:nowIso() };
    db.prepare('INSERT INTO resume_drafts(id,user_id,source_document_id,mode,job_description_hash,result_json,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(draft.id,draft.user_id,draft.source_document_id,draft.mode,draft.job_description_hash,draft.result_json,draft.created_at);
    sendJson(res, 201, { ok:true, draft:{ id:draft.id, mode:draft.mode, createdAt:draft.created_at, sourceDocumentId:source.id, ...result } });
  }

  async function handle(req, res, url) {
    const staticEntry = staticFiles.get(url.pathname);
    if (staticEntry && req.method === 'GET') {
      if ((url.pathname === '/dashboard' || url.pathname === '/index.html') && !rawSession(req)) {
        res.writeHead(302, securityHeaders({ location:'/' }));
        res.end();
        return true;
      }
      const [name, contentType] = staticEntry;
      const content = await readFile(join(root, name));
      res.writeHead(200, securityHeaders({ 'content-type':contentType }));
      res.end(content);
      return true;
    }
    if (!url.pathname.startsWith('/api/user-space/')) return false;
    try {
      assertSameOrigin(req);
      if (url.pathname === '/api/user-space/register' && req.method === 'POST') await register(req, res);
      else if (url.pathname === '/api/user-space/login' && req.method === 'POST') await login(req, res);
      else if (url.pathname === '/api/user-space/logout' && req.method === 'POST') {
        const session = requireSession(req, { csrf:true });
        db.prepare('DELETE FROM sessions WHERE token_hash=?').run(session.tokenHash);
        recordSecurity(session.row.user_id, 'logout');
        sendJson(res, 200, { ok:true }, { 'set-cookie':clearCookies() });
      } else if (url.pathname === '/api/user-space/session' && req.method === 'GET') {
        const session = rawSession(req);
        if (!session) sendJson(res, 200, { authenticated:false });
        else sendJson(res, 200, { authenticated:true, user:publicUser(session.user), csrfToken:session.row.csrf_token, expiresAt:session.row.expires_at, resume:publicDocument(latestResume(session.row.user_id)) });
      } else if (url.pathname === '/api/user-space/resume' && req.method === 'POST') await uploadResume(req, res);
      else if (url.pathname === '/api/user-space/refine' && req.method === 'POST') await refine(req, res);
      else throw httpError(404, 'User-space endpoint not found.', 'NOT_FOUND');
    } catch (error) {
      sendJson(res, Number(error.status) || 500, { error:Number(error.status) >= 500 ? 'The user-space request could not be completed.' : error.message, code:error.code || '' });
    }
    return true;
  }

  return { handle, db, close:() => db.close() };
}
