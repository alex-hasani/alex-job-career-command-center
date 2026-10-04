import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { buildStoredZip, createUserSpaceRouter, hashPassword, verifyPassword, openUserSpaceDatabase, profileFromCanonical, refineResumeEvidence } from './user-space.mjs';

test('passwords use salted scrypt hashes and verify without storing plaintext', async () => {
  const password = 'Correct horse battery staple 2026';
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  assert.match(first, /^scrypt\$1\$/);
  assert.notEqual(first, second);
  assert.equal(first.includes(password), false);
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword('wrong password value', first), false);
});

test('user-space database separates credentials, sessions, documents, and drafts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'alex-job-user-space-'));
  const db = openUserSpaceDatabase(join(directory, 'users.sqlite'));
  try {
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
    for (const name of ['users','sessions','documents','resume_drafts','application_profiles','browser_extensions','security_events','user_space_settings']) assert.equal(tables.has(name), true);
    const userColumns = new Set(db.prepare('PRAGMA table_info(users)').all().map(row => row.name));
    assert.equal(userColumns.has('password'), false);
    assert.equal(userColumns.has('password_hash'), true);
    assert.equal(userColumns.has('role'), true);
  } finally { db.close(); await rm(directory, { recursive:true, force:true }); }
});

test('Alex is promoted to protected global admin and rollout revokes existing sessions', async () => {
  const directory=await mkdtemp(join(tmpdir(),'alex-job-global-admin-')),path=join(directory,'users.sqlite');
  let db=openUserSpaceDatabase(path);
  const createdAt='2026-10-03T00:00:00.000Z';
  db.prepare('INSERT INTO users(id,username,display_name,role,password_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('alex-id','alex','Alex','user','test-hash',createdAt,createdAt);
  db.prepare('INSERT INTO sessions(token_hash,user_id,csrf_token,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?,?)').run('token-hash','alex-id','csrf',createdAt,'2099-01-01T00:00:00.000Z',createdAt);
  db.prepare("DELETE FROM user_space_settings WHERE key='global_admin_rollout_2026_10_03'").run();
  db.close();
  db=openUserSpaceDatabase(path);
  try {
    assert.equal(db.prepare("SELECT role FROM users WHERE username='alex'").get().role,'global_admin');
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM sessions').get().count,0);
  } finally {db.close();await rm(directory,{recursive:true,force:true});}
});

test('personal Chrome helper exports are valid distinct ZIP bundles', () => {
  const first=buildStoredZip([{name:'manifest.json',data:'{"name":"First"}'},{name:'profile-config.js',data:'export const helperConfig={publicId:"one"};'}]);
  const second=buildStoredZip([{name:'manifest.json',data:'{"name":"Second"}'},{name:'profile-config.js',data:'export const helperConfig={publicId:"two"};'}]);
  assert.equal(first.readUInt32LE(0),0x04034b50);
  assert.equal(first.readUInt32LE(first.length-22),0x06054b50);
  assert.notDeepEqual(first,second);
  assert.match(first.toString('utf8'),/profile-config\.js/);
});

test('ATS refinement prioritizes only source evidence and keeps missing terms review-only', () => {
  const source = ['Alex Example','Cloud Engineer','Azure administration','Windows Server operations','English C1'].join('\n');
  const result = refineResumeEvidence(source, 'Azure Kubernetes Terraform engineer');
  assert.equal(result.inventedContent, false);
  assert.equal(result.sourceOnly, true);
  assert.equal(result.priorityEvidence.some(item => item.text === 'Azure administration'), true);
  assert.equal(result.priorityEvidence.every(item => source.includes(item.text)), true);
  assert.equal(result.missingKeywords.includes('kubernetes'), true);
  assert.equal(result.atsText.toLowerCase().includes('kubernetes'), false);
  assert.equal(result.atsText.toLowerCase().includes('terraform'), false);
});

test('landing copy states the career outcome and preserves the evidence-only promise', async () => {
  const html = await readFile(new URL('./user-space.html', import.meta.url), 'utf8');
  assert.match(html, /Turn your real experience into interview-ready applications\./);
  assert.match(html, /using only your verified skills, experience, and achievements\./);
  assert.match(html, /href="\/dashboard"/);
  assert.match(html, /Global administration/);
  assert.match(html, /Account and security/);
  assert.match(html, /name="birthDate"/);
  assert.match(html, /data-dialog="helperDialog"/);
  assert.match(html, /id="helperDialog" class="workspace-dialog workspace-dialog-wide"/);
  assert.match(html, /data-dialog="documentsDialog"/);
  assert.match(html, /id="documentLibrary"/);
  assert.match(html, /data-dialog="skillsDialog"/);
  assert.match(html, /id="skillsLibrary"/);
});

test('protected Alex assets are copied into private storage once and source files stay unchanged', async () => {
  const directory=await mkdtemp(join(tmpdir(),'alex-job-protected-assets-')),databasePath=join(directory,'users.sqlite'),storageRoot=join(directory,'storage');
  const resumePath=join(directory,'Alex_Hasani_CV_DE.txt'),letterPath=join(directory,'Alex_Hasani_Anschreiben_DE.txt'),configPath=join(directory,'admin-documents.json');
  const resume='Alex Hasani\nInfrastructure Engineer\nWindows Server and Azure\n',letter='Application letter source evidence\n';
  await writeFile(resumePath,resume);await writeFile(letterPath,letter);
  await writeFile(configPath,JSON.stringify({documents:[{kind:'resume_de',label:'Alex_Hasani_CV_DE.txt',path:resumePath},{kind:'cover_letter_de',label:'Alex_Hasani_Anschreiben_DE.txt',path:letterPath}]}));
  let db=openUserSpaceDatabase(databasePath),createdAt='2026-10-04T00:00:00.000Z';
  db.prepare('INSERT INTO users(id,username,display_name,role,password_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('alex-id','alex','Alex','global_admin','hash',createdAt,createdAt);
  db.prepare("INSERT OR REPLACE INTO user_space_settings(key,value,updated_at) VALUES('global_admin_user_id','alex-id',?)").run(createdAt);db.close();
  const profile={identity:{email:'alex@example.com',phone:'+49 123',workAuthorisation:{de:'Ja',en:'Yes'}},applicationForm:{firstName:'Alex',legalFirstName:'Mohsen',lastName:'Hasani'},skills:[{id:'cloud',label:{de:'Cloud',en:'Cloud'},items:['Azure']}],familiarities:[{id:'terraform',de:'Terraform Grundlagen',en:'Terraform foundations',restriction:{en:'No production claim.'}}]};
  const router=createUserSpaceRouter({root:directory,workspace:directory,databasePath,storageRoot,protectedAdminDocumentsPath:configPath,protectedAdminProfile:profile});
  try {
    const result=await router.ready;assert.equal(result.error,'');assert.equal(result.imported,2);
    const documents=router.db.prepare('SELECT kind,original_name,stored_path FROM documents ORDER BY kind').all();
    assert.deepEqual(documents.map(row=>row.kind),['cover_letter_de','resume_de']);
    assert.equal(documents.every(row=>row.stored_path.startsWith(storageRoot)),true);
    assert.equal(await readFile(resumePath,'utf8'),resume);assert.equal(await readFile(letterPath,'utf8'),letter);
  } finally {router.close();await rm(directory,{recursive:true,force:true});}
});

test('document and skill panels render account assets and mobile admin actions stack', async () => {
  const client=await readFile(new URL('./user-space.js',import.meta.url),'utf8'),css=await readFile(new URL('./user-space.css',import.meta.url),'utf8');
  assert.match(client,/function renderDocuments/);assert.match(client,/function renderSkills/);assert.match(client,/document\.downloadUrl/);
  assert.match(css,/\.admin-user \.account-actions\{grid-template-columns:1fr\}/);
});

test('mobile shell uses stable short controls and updates do not force open pages home', async () => {
  const html=await readFile(new URL('./index.html',import.meta.url),'utf8');
  const worker=await readFile(new URL('./service-worker.js',import.meta.url),'utf8');
  assert.match(html,/id="readyToSendButton"[^>]*>Queue<\/button>/);
  assert.doesNotMatch(html,/id="installApp"/);
  assert.doesNotMatch(html,/beforeinstallprompt/);
  assert.doesNotMatch(worker,/client\.navigate\(/);
});

test('password changes require confirmation and system messages use the top dialog layer', async () => {
  const html=await readFile(new URL('./user-space.html',import.meta.url),'utf8');
  const client=await readFile(new URL('./user-space.js',import.meta.url),'utf8');
  const server=await readFile(new URL('./user-space.mjs',import.meta.url),'utf8');
  assert.match(html,/name="confirmNewPassword"/);
  assert.match(html,/<dialog id="message"/);
  assert.match(client,/body\.newPassword!==body\.confirmNewPassword/);
  assert.match(client,/node\.showModal\(\)/);
  assert.match(client,/form\.reset\(\)/);
  assert.doesNotMatch(client,/event\.currentTarget\.reset\(\)/);
  assert.match(server,/PASSWORD_MISMATCH/);
});

test('canonical profile mapping includes the complete application defaults without invention', () => {
  const profile=profileFromCanonical({identity:{email:'alex@example.com',phone:'+49 123',workAuthorisation:{de:'Ja',en:'Yes'}},applicationForm:{firstName:'Alex',legalFirstName:'Mohsen',lastName:'Hasani',birthDate:'1986-07-03',euWorkPermit:{de:'Ja',en:'Yes'},commute:{de:'Pendeln',en:'Commute'},desiredSalaryAnnualEur:75000}});
  assert.equal(profile.firstName,'Alex');
  assert.equal(profile.legalFirstName,'Mohsen');
  assert.equal(profile.birthDate,'1986-07-03');
  assert.equal(profile.euWorkPermitEn,'Yes');
  assert.equal(profile.commuteDe,'Pendeln');
  assert.equal(profile.desiredSalaryAnnualEur,'75000');
});

test('open dashboard pages continuously verify the login session', async () => {
  const html=await readFile(new URL('./index.html',import.meta.url),'utf8');
  assert.match(html,/api\/user-space\/session/);
  assert.match(html,/location\.replace\('\/'\)/);
});

test('root is the account landing page and the dashboard redirects signed-out visitors', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'alex-job-user-space-routes-'));
  await writeFile(join(directory, 'user-space.html'), '<h1>Account landing</h1>');
  await writeFile(join(directory, 'index.html'), '<h1>Dashboard</h1>');
  await writeFile(join(directory, 'user-space.js'), '');
  await writeFile(join(directory, 'user-space.css'), '');
  const router = createUserSpaceRouter({ root:directory, workspace:directory });
  const request = { method:'GET', headers:{}, socket:{} };
  const response = () => ({ status:0, headers:{}, body:'', writeHead(status, headers) { this.status=status; this.headers=headers; }, end(body='') { this.body=String(body); } });
  try {
    const landing = response();
    assert.equal(await router.handle(request, landing, new URL('http://127.0.0.1/')), true);
    assert.equal(landing.status, 200);
    assert.match(landing.body, /Account landing/);
    assert.doesNotMatch(landing.headers['content-security-policy'], /unsafe-inline/);

    const profile = response();
    assert.equal(await router.handle(request, profile, new URL('http://127.0.0.1/profile')), true);
    assert.equal(profile.status, 200);

    const dashboard = response();
    assert.equal(await router.handle(request, dashboard, new URL('http://127.0.0.1/dashboard')), true);
    assert.equal(dashboard.status, 302);
    assert.equal(dashboard.headers.location, '/');
  } finally { router.close(); await rm(directory, { recursive:true, force:true }); }
});

test('dashboard keeps its existing inline application UI while login pages retain strict CSP', async () => {
  const directory=await mkdtemp(join(tmpdir(),'alex-job-dashboard-csp-'));
  await writeFile(join(directory,'user-space.html'),'<h1>Login</h1>');
  await writeFile(join(directory,'index.html'),'<style>body{color:red}</style><script>window.ready=true</script>');
  const router=createUserSpaceRouter({root:directory,workspace:directory}),createdAt='2026-10-04T00:00:00.000Z',token='dashboard-session';
  router.db.prepare('INSERT INTO users(id,username,display_name,role,password_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('user-id','tester','Tester','user','hash',createdAt,createdAt);
  router.db.prepare('INSERT INTO sessions(token_hash,user_id,csrf_token,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),'user-id','csrf',createdAt,'2099-01-01T00:00:00.000Z',createdAt);
  const response={status:0,headers:{},body:'',writeHead(status,headers){this.status=status;this.headers=headers;},end(body=''){this.body=String(body);}};
  try {
    await router.handle({method:'GET',headers:{cookie:`alex_job_session=${token}`},socket:{}},response,new URL('http://127.0.0.1/dashboard'));
    assert.equal(response.status,200);
    assert.match(response.headers['content-security-policy'],/style-src 'self' 'unsafe-inline'/);
    assert.match(response.headers['content-security-policy'],/script-src 'self' 'unsafe-inline'/);
  } finally {router.close();await rm(directory,{recursive:true,force:true});}
});
