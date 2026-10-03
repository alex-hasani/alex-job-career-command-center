const $ = selector => document.querySelector(selector);
let csrfToken = '';

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
  renderResume(data.resume || null);
}

function setSignedOut() {
  csrfToken = '';
  $('#workspacePanel').classList.add('hidden');
  $('#authPanel').classList.remove('hidden');
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
    $('#resultPanel').classList.remove('hidden');
    $('#resultPanel').scrollIntoView({ behavior:'smooth', block:'start' });
  } catch (error) { showMessage(error.message, true); }
  finally { button.disabled = false; }
}

$('#loginForm').addEventListener('submit', event => { event.preventDefault(); authenticate(event.currentTarget, '/api/user-space/login'); });
$('#registerForm').addEventListener('submit', event => { event.preventDefault(); authenticate(event.currentTarget, '/api/user-space/register'); });
$('#logoutButton').addEventListener('click', async () => {
  try { await api('/api/user-space/logout', { method:'POST' }); } catch {}
  setSignedOut();
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

api('/api/user-space/session').then(data => data.authenticated ? setAuthenticated(data) : setSignedOut()).catch(() => setSignedOut());
