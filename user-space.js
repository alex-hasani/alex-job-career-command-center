const $ = selector => document.querySelector(selector);
let csrfToken = '';

function openDialog(id) {
  const dialog = document.getElementById(id);
  if (!dialog) return;
  document.body.classList.add('dialog-open');
  if (typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal();
  else dialog.setAttribute('open', '');
}

function closeDialog(dialog) {
  if (!dialog) return;
  if (typeof dialog.close === 'function' && dialog.open) dialog.close();
  else dialog.removeAttribute('open');
  if (!document.querySelector('dialog[open]')) document.body.classList.remove('dialog-open');
}

function showMessage(text, error=false) {
  const node = $('#message');
  node.textContent = text;
  node.classList.toggle('error', error);
  node.classList.remove('hidden');
  clearTimeout(showMessage.timer);
  showMessage.timer = setTimeout(() => node.classList.add('hidden'), 6500);
}

async function api(path, options={}) {
  const headers = new Headers(options.headers || {});
  if (csrfToken && options.method && options.method !== 'GET') headers.set('x-csrf-token', csrfToken);
  const response = await fetch(path, { ...options, headers, credentials:'same-origin' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

function setAuthenticated(data) {
  csrfToken = data.csrfToken || '';
  $('#authPanel').classList.add('hidden');
  $('#workspacePanel').classList.remove('hidden');
  $('#accountName').textContent = `${data.user.displayName} · ${data.user.username}`;
  $('#accountDetailsForm').elements.displayName.value=data.user.displayName||'';
  renderResume(data.resume || null);
  renderApplicationProfile(data.applicationProfile || {});
  const isAdmin=data.user.role==='global_admin';
  $('#adminPanel').classList.toggle('hidden',!isAdmin);
  if(isAdmin) void loadAdminUsers();
}

function setSignedOut() {
  csrfToken = '';
  $('#workspacePanel').classList.add('hidden');
  $('#authPanel').classList.remove('hidden');
  $('#adminPanel').classList.add('hidden');
  document.querySelectorAll('dialog[open]').forEach(closeDialog);
}

function renderResume(document) {
  const status = $('#resumeStatus');
  if (!document) {
    status.textContent = 'No resume loaded.';
    status.className = 'status muted';
    return;
  }
  status.textContent = `${document.originalName} · ${Math.round(document.byteSize / 1024)} KB · ${document.extractedCharacters} extracted characters`;
  status.className = 'status ready';
}

function renderApplicationProfile(profile) {
  const form=$('#applicationProfileForm');
  for(const element of form.elements) if(element.name) element.value=profile[element.name]||'';
}

async function loadAdminUsers() {
  const data=await api('/api/user-space/admin/users');
  $('#adminUsers').replaceChildren(...data.users.map(user=>{
    const row=document.createElement('article');row.className='admin-user';
    const summary=document.createElement('div');summary.innerHTML=`<strong></strong><span></span>`;summary.querySelector('strong').textContent=`${user.displayName} · ${user.username}`;summary.querySelector('span').textContent=`${user.role} · ${user.disabledAt?'disabled':'active'} · ${user.activeSessions} session(s) · ${user.documentCount} document(s)`;
    const actions=document.createElement('div');actions.className='account-actions';
    const choices=user.protectedGlobalAdmin?['reset_password','revoke_sessions']:user.disabledAt?['enable','make_admin','make_user','reset_password','revoke_sessions']:['disable','make_admin','make_user','reset_password','revoke_sessions'];
    const labels={disable:'Disable',enable:'Enable',make_admin:'Make admin',make_user:'Make user',reset_password:'Reset password',revoke_sessions:'Sign out everywhere'};
    for(const action of choices){const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent=labels[action];button.onclick=()=>manageUser(user.id,action);actions.append(button);}
    row.append(summary,actions);return row;
  }));
}

async function manageUser(userId,action) {
  const body={userId,action};
  if(action==='reset_password') { const value=prompt('Enter a temporary password of at least 12 characters. The user will be signed out everywhere.'); if(value===null)return; body.newPassword=value; }
  try { await api('/api/user-space/admin/users',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(body)});await loadAdminUsers();showMessage(action==='reset_password'?'Password reset. Share the temporary password securely.':'User access updated.'); }
  catch(error){showMessage(error.message,true);}
}

async function authenticate(form, endpoint) {
  const button = form.querySelector('button');
  button.disabled = true;
  try {
    const body = Object.fromEntries(new FormData(form).entries());
    const data = await api(endpoint, { method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify(body) });
    form.reset();
    setAuthenticated(data);
    showMessage(endpoint.endsWith('register') ? 'Private workspace created.' : 'Signed in.');
  } catch (error) { showMessage(error.message, true); }
  finally { button.disabled = false; }
}

async function createDraft(jobDescription='') {
  const button = jobDescription ? $('#tailorButton') : $('#baseButton');
  button.disabled = true;
  try {
    const data = await api('/api/user-space/refine', { method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify({ jobDescription }) });
    const draft = data.draft;
    $('#draftMode').textContent = draft.mode === 'job-tailored' ? 'Job-focused evidence' : 'ATS base';
    $('#draftGuidance').textContent = draft.guidance;
    $('#atsText').value = draft.atsText;
    $('#priorityEvidence').replaceChildren(...(draft.priorityEvidence.length ? draft.priorityEvidence : [{ text:'No exact job-description overlap was found in the uploaded evidence.' }]).map(item => {
      const li = document.createElement('li'); li.textContent = item.text; return li;
    }));
    $('#missingKeywords').replaceChildren(...draft.missingKeywords.slice(0, 30).map(keyword => {
      const span = document.createElement('span'); span.textContent = keyword; return span;
    }));
    openDialog('resultDialog');
  } catch (error) { showMessage(error.message, true); }
  finally { button.disabled = false; }
}

$('#loginForm').addEventListener('submit', event => { event.preventDefault(); authenticate(event.currentTarget, '/api/user-space/login'); });
$('#registerForm').addEventListener('submit', event => { event.preventDefault(); authenticate(event.currentTarget, '/api/user-space/register'); });
$('#logoutButton').addEventListener('click', async () => {
  try { await api('/api/user-space/logout', { method:'POST' }); } catch {}
  setSignedOut();
});
$('#accountDetailsForm').addEventListener('submit',async event=>{
  event.preventDefault();const button=event.currentTarget.querySelector('button');button.disabled=true;
  try { const data=await api('/api/user-space/account',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(event.currentTarget).entries()))});$('#accountName').textContent=`${data.user.displayName} · ${data.user.username}`;showMessage('Account details saved.'); }
  catch(error){showMessage(error.message,true);} finally{button.disabled=false;}
});
$('#passwordForm').addEventListener('submit',async event=>{
  event.preventDefault();const button=event.currentTarget.querySelector('button');button.disabled=true;
  try { await api('/api/user-space/password',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(event.currentTarget).entries()))});event.currentTarget.reset();showMessage('Password changed. Other sessions were signed out.'); }
  catch(error){showMessage(error.message,true);} finally{button.disabled=false;}
});
$('#uploadButton').addEventListener('click', async () => {
  const file = $('#resumeFile').files[0];
  if (!file) return showMessage('Choose a PDF or TXT resume first.', true);
  const button = $('#uploadButton'); button.disabled = true;
  try {
    const data = await api('/api/user-space/resume', { method:'POST', headers:{ 'content-type':file.type || 'application/octet-stream', 'x-file-name':encodeURIComponent(file.name) }, body:file });
    renderResume(data.document);
    showMessage(data.duplicate ? 'This exact resume was already stored; no duplicate was created.' : 'Source resume uploaded and isolated to your account.');
  } catch (error) { showMessage(error.message, true); }
  finally { button.disabled = false; }
});
$('#baseButton').addEventListener('click', () => createDraft());
$('#tailorButton').addEventListener('click', () => {
  const value = $('#jobDescription').value.trim();
  if (!value) return showMessage('Paste the exact job description first.', true);
  createDraft(value);
});
$('#saveProfileButton').addEventListener('click',async()=>{
  const button=$('#saveProfileButton');button.disabled=true;
  try { const body=Object.fromEntries(new FormData($('#applicationProfileForm')).entries()); await api('/api/user-space/application-profile',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(body)}); showMessage('Application profile saved for this account.'); }
  catch(error){showMessage(error.message,true);} finally{button.disabled=false;}
});
$('#exportExtensionButton').addEventListener('click',async()=>{
  const button=$('#exportExtensionButton');button.disabled=true;
  try {
    const response=await fetch('/api/user-space/chrome-extension',{method:'POST',headers:{'x-csrf-token':csrfToken},credentials:'same-origin'});
    if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.error||'Extension export failed.');}
    const blob=await response.blob(),disposition=response.headers.get('content-disposition')||'',match=disposition.match(/filename="([^"]+)"/i),name=match?.[1]||'alex-job-helper.zip';
    const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(link.href),1000);
    showMessage('Personal Chrome helper exported. Extract the ZIP, then load that folder unpacked in Chrome.');
  } catch(error){showMessage(error.message,true);} finally{button.disabled=false;}
});
$('#refreshUsersButton').addEventListener('click',()=>loadAdminUsers().catch(error=>showMessage(error.message,true)));
document.querySelectorAll('[data-dialog]').forEach(button=>button.addEventListener('click',()=>openDialog(button.dataset.dialog)));
document.querySelectorAll('[data-close-dialog]').forEach(button=>button.addEventListener('click',()=>closeDialog(button.closest('dialog'))));
document.querySelectorAll('dialog.workspace-dialog').forEach(dialog=>{
  dialog.addEventListener('click',event=>{if(event.target===dialog)closeDialog(dialog);});
  dialog.addEventListener('close',()=>{if(!document.querySelector('dialog[open]'))document.body.classList.remove('dialog-open');});
});

async function verifySession({initial=false}={}) {
  try {
    const data=await api('/api/user-space/session');
    if(data.authenticated){if(initial)setAuthenticated(data);return true;}
  } catch {}
  setSignedOut();
  if(!initial&&location.pathname!=='/') location.replace('/');
  return false;
}
void verifySession({initial:true});
if(location.pathname.startsWith('/profile')) window.addEventListener('load',()=>openDialog('accountDialog'),{once:true});
setInterval(()=>void verifySession(),5000);
window.addEventListener('focus',()=>void verifySession());
window.addEventListener('pageshow',()=>void verifySession());
if('serviceWorker' in navigator&&(location.protocol==='https:'||location.hostname==='localhost')) navigator.serviceWorker.register('/service-worker.js').then(registration=>registration.update()).catch(()=>{});
