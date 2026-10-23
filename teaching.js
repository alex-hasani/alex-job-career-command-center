import { compareSourcesByAvailabilityAndName } from './filter-logic.js';
import { filterTeachingJobs, teachingFilterIds, teachingCheckboxIds, teachingStatuses } from './teaching-filter-logic.js';

const $=id=>document.getElementById(id);
const statusNames=['Not recorded','Stashed','Preparing','Applied','Interviewing','Offer','Rejected','Silent','Case Closed','Withdrawn'];
const filterIds=teachingFilterIds;
const teachingWeights={english:['english','esl','efl','englisch'],youngLearners:['children','young learners','jugendliche','kinder'],training:['teacher training','teacher observation','trainer','fortbildung'],online:['online','remote','digital','virtual'],operations:['lesson plan','class management','follow-up','curriculum']};
let weights=JSON.parse(localStorage.getItem('alex-teaching-weights')||'{"english":5,"youngLearners":5,"training":4,"online":3,"operations":3}');
let csrfToken='', data={jobs:[],sources:[],documents:[],savedSearches:[],sourceStatus:[],databaseStats:{total:0}},view=localStorage.getItem('alex-teaching-view')||'list',refreshing=false;

function setMessage(value,error=false){$('loadStatus').textContent=value;$('loadStatus').classList.toggle('error',error);}
function element(tag,className='',text=''){const node=document.createElement(tag);if(className)node.className=className;if(text)node.textContent=text;return node;}
function option(value,label){const item=document.createElement('option');item.value=value;item.textContent=label;return item;}

async function request(path,options={}) {
  const headers=new Headers(options.headers||{});
  if(options.method&&options.method!=='GET'){headers.set('content-type','application/json');headers.set('x-csrf-token',csrfToken);}
  const response=await fetch(path,{...options,headers,credentials:'same-origin',cache:'no-store'});
  if(response.status===401){location.assign('/');throw new Error('Sign in to continue.');}
  const result=await response.json();
  if(!response.ok)throw new Error(result.error||'Teaching request failed.');
  return result;
}

function renderMetrics(visible) {
  const all=data.jobs||[];
  $('count').textContent=String(visible.length);
  $('strongCount').textContent=String(visible.filter(job=>['PRIORITY APPLY','APPLY'].includes(job.recommendation)).length);
  $('online').textContent=String((data.sourceStatus||[]).filter(source=>source.status==='ok').length);
  $('appliedCount').textContent=String(all.filter(job=>['Applied','Interviewing','Offer'].includes(job.applicationStatus)).length);
  $('dbCount').textContent=String(data.databaseStats?.total||0);
  $('resultCount').textContent=`${visible.length} result${visible.length===1?'':'s'}`;
  const active=filterIds.filter(id=>teachingCheckboxIds.has(id)?$(id).checked:$(id).value!==''&&$(id).value!=='0'&&id!=='sort').length;
  $('filterStatus').textContent=active?`${active} active filter${active===1?'':'s'} · results update instantly`:'No filters applied';
  const conversion=data.databaseStats?.conversion||{};
  $('outcomeSummary').textContent=conversion.applications?`${conversion.applications} tracked applications · ${conversion.interviews||0} interviews or offers · application-to-interview ${conversion.applicationToInterview??'not enough data'}% · interview-to-offer ${conversion.interviewToOffer??'not enough data'}%.`:'No completed Teaching application funnel yet.';
}

function weightedMatch(job){
  const evidence=`${job.title||''} ${job.description||''}`.toLowerCase();
  let possible=0,matched=0;
  for(const [family,terms] of Object.entries(teachingWeights)){const value=Number(weights[family])||0;possible+=value;if(terms.some(term=>evidence.includes(term)))matched+=value;}
  const base=Number(job.interviewFitScore??job.match)||0;
  return possible?Math.min(99,Math.round(base*.9+matched/possible*10)):base;
}
function criteria(){return Object.fromEntries(filterIds.map(id=>[id,teachingCheckboxIds.has(id)?$(id).checked:$(id).value]));}
function filteredJobs(){
  const cities=[...$('location').options].map(item=>item.value).filter(Boolean);
  return filterTeachingJobs((data.jobs||[]).map(job=>({...job,interviewFitScore:weightedMatch(job)})),criteria(),cities);
}

async function saveStatus(job,status,comment){
  try{
    const result=await request('/api/user-space/teaching-application-status',{method:'POST',body:JSON.stringify({id:job.id,status,comment})});
    data.jobs=data.jobs.map(item=>item.id===job.id?result.job:item);
    setMessage(`Teaching application updated to ${status}.`);render();
  }catch(error){setMessage(error.message,true);render();}
}

function statusSelect(job) {
  const select=element('select');select.setAttribute('aria-label',`Application status for ${job.title}`);
  for(const name of statusNames)select.append(option(name,name));
  select.value=job.applicationStatus||'Not recorded';
  select.addEventListener('change',()=>saveStatus(job,select.value,job.applicationComment||''));
  return select;
}

function jobCard(job,compact=false){
  const card=element(compact?'article':'article',compact?'board-card':'panel job-card');
  card.append(element(compact?'h4':'h3','',job.title));
  card.append(element('p','',`${job.company} · ${job.location}`));
  if(!compact){
    const meta=element('div','job-meta');
    for(const label of [`${job.interviewFitScore||job.match||0}% provisional interview fit`,job.workType||'Not stated',job.remote?'Remote / hybrid':'On-site / not stated',job.source])meta.append(element('span','chip',label));
    card.append(meta);
    if(job.description){const details=element('details');const summary=element('summary','', 'Job description');details.append(summary,element('p','',job.description.slice(0,2500)));card.append(details);}
  }
  const actions=element('div','job-actions');
  const link=element('a','',compact?'Posting':'Apply ↗');link.href=job.url;link.target='_blank';link.rel='noopener noreferrer';actions.append(link,statusSelect(job));
  const studio=element('button','','Prepare documents');studio.type='button';studio.addEventListener('click',()=>openApplication(job));actions.append(studio);card.append(actions);
  if(!compact){const comment=element('textarea');comment.value=job.applicationComment||'';comment.placeholder='Application notes';comment.setAttribute('aria-label',`Application notes for ${job.title}`);const save=element('button','', 'Save note');save.type='button';save.addEventListener('click',()=>saveStatus(job,job.applicationStatus||'Not recorded',comment.value));card.append(comment,save);}
  return card;
}

let applicationJob=null;
async function openApplication(job){
  applicationJob=job;
  $('applicationTitle').textContent=`Teaching application · ${job.title}`;
  $('applicationDescription').value=job.description||'';
  $('applicationPackage').replaceChildren();
  $('teachingFastApply').hidden=true;
  $('teachingWebsiteApply').hidden=true;
  $('teachingSendState').textContent='';
  $('teachingWebsiteState').textContent='';
  $('sendTeachingEmail').disabled=true;
  $('submitTeachingWebsiteApply').disabled=true;
  $('applicationDialog').showModal();
  try{
    const result=await request(`/api/user-space/teaching-application-package?id=${encodeURIComponent(job.id)}`);
    if(applicationJob?.id===job.id && result.package)renderApplicationPackage(result.package);
  }catch(error){setMessage(error.message,true);}
}
function renderApplicationPackage(pkg){
  const area=$('applicationPackage');area.replaceChildren(element('p','',`Version ${pkg.currentVersion} · Teaching-only documents`));
  for(const language of ['en','de'])for(const type of ['cv','coverLetter']){
    const item=pkg.documents[type][language],row=element('div','document');
    row.append(element('strong','',`${language.toUpperCase()} ${type==='cv'?'CV':'cover letter'}`));
    for(const [label,url,format] of [['Word',item.document.downloadUrl,'docx'],['PDF',item.document.pdfDownloadUrl,'pdf']]){
      const button=element('button','',label);button.type='button';button.addEventListener('click',()=>downloadDocument({url,name:item.document.fileName.replace(/\.docx$/i,`.${format}`)},button));row.append(button);
    }
    area.append(row);
  }
  area.append(element('p','hint','Review both documents and the recipient before any application. Preparing documents does not send or submit anything.'));
  $('teachingFastApply').hidden=false;
  $('teachingWebsiteApply').hidden=false;
  previewTeachingEmail();
}
async function previewTeachingEmail(){
  if(!applicationJob)return;
  const jobId=applicationJob.id,language=$('teachingEmailLanguage').value;
  try{
    const result=await request('/api/user-space/teaching-fast-apply/preview',{method:'POST',body:JSON.stringify({id:jobId,language})});
    if(applicationJob?.id!==jobId||$('teachingEmailLanguage').value!==language)return;
    const p=result.preview;
    $('teachingRecipient').value=p.recipient||'';
    $('teachingSubject').value=p.subject||'';
    $('teachingMessage').value=p.body||'';
    $('teachingGmailStatus').textContent=p.gmail.connected?`Connected as ${p.gmail.email}. ${result.remaining} of 10 Teaching sends available today.`:'Gmail is not connected. Reconnect the shared Gmail account in IT Jobs, then return here.';
    $('sendTeachingEmail').disabled=!p.gmail.connected;
    if(result.pending)showTeachingPending(result.pending);
  }catch(error){if(applicationJob?.id!==jobId)return;$('teachingGmailStatus').textContent=error.message;$('sendTeachingEmail').disabled=true;}
}
function showTeachingPending(pending){
  const undo=$('undoTeachingEmail'),send=$('sendTeachingEmail');
  undo.hidden=pending.status!=='queued';
  send.disabled=['queued','sending','sent','uncertain'].includes(pending.status);
  $('teachingSendState').textContent=pending.status==='queued'?`Queued. Undo before ${new Date(pending.dueAt).toLocaleTimeString()}.`:pending.status==='sent'?`Sent to ${pending.to} at ${new Date(pending.sentAt).toLocaleString()}. Teaching status is Applied.`:pending.error||`Teaching send: ${pending.status}`;
}
async function pollTeachingPending(jobId){
  for(let count=0;count<22;count++){
    await new Promise(resolve=>setTimeout(resolve,1000));
    const result=await request(`/api/user-space/teaching-fast-apply/pending?id=${encodeURIComponent(jobId)}`);
    if(applicationJob?.id===jobId&&result.pending)showTeachingPending(result.pending);
    if(!result.pending||!['queued','sending'].includes(result.pending.status)){
      if(result.pending?.status==='sent'){
        const overview=await request('/api/user-space/teaching-overview');
        data.jobs=overview.jobs;renderStatuses();render();
      }
      return;
    }
  }
}
function showTeachingWebsiteSession(session){
  $('teachingWebsiteState').textContent=session?.message||session?.status||'No Teaching website application is running.';
  $('submitTeachingWebsiteApply').disabled=session?.status!=='ready_for_final_confirmation';
}
async function pollTeachingWebsite(jobId){
  for(let count=0;count<150;count++){
    await new Promise(resolve=>setTimeout(resolve,2000));
    const result=await request(`/api/user-space/teaching-website-apply/status?id=${encodeURIComponent(jobId)}`);
    if(applicationJob?.id===jobId)showTeachingWebsiteSession(result.session);
    if(!result.session||['ready_for_final_confirmation','submitted','failed','cancelled'].includes(result.session.status))return;
  }
}

function renderJobs(visible){
  const container=$('jobs');container.replaceChildren();container.classList.toggle('board',view==='board');
  $('listView').classList.toggle('active',view==='list');$('boardView').classList.toggle('active',view==='board');
  if(view==='list'){
    if(!visible.length)container.append(element('div','panel empty','No verified Teaching postings match these filters. Open the source directory or refresh live results.'));
    for(const job of visible)container.append(jobCard(job));
  }else{
    for(const group of ['Not recorded','Preparing','Applied','Interviewing','Offer','Rejected','Silent','Other']){
      const matching=visible.filter(job=>group==='Other'?!['Not recorded','Preparing','Applied','Interviewing','Offer','Rejected','Silent'].includes(job.applicationStatus||'Not recorded'):(job.applicationStatus||'Not recorded')===group);
      const column=element('section','board-column');column.append(element('h3','',`${group} · ${matching.length}`));for(const job of matching)column.append(jobCard(job,true));container.append(column);
    }
  }
}

function renderSources(){
  const statusByName=new Map((data.sourceStatus||[]).map(item=>[item.source,item]));
  const sources=(data.sources||[]).map(source=>{const status=statusByName.get(source.name)?.status||source.availability||'not_checked';return {...source,status,availability:status==='ok'?'available':status==='unavailable'?'unavailable':source.availability||'not_checked'};}).sort(compareSourcesByAvailabilityAndName);
  const badges=$('sources');badges.replaceChildren();
  for(const source of sources)badges.append(element('span',`source ${source.status}`,`${source.name} · ${source.status==='ok'?'Verified':source.status==='unavailable'?'Unavailable':'Not verified'}`));
  $('networkSummary').textContent=`${sources.length} Teaching sources · ${sources.filter(source=>source.status==='ok').length} with verified postings`;
  const sites=$('sites');sites.replaceChildren();
  for(const source of sources){const row=element('div','site'),body=element('div');body.append(element('strong','',source.name),element('small','',source.type==='shared-source'?'General source':'Teaching source'));const link=element('a','','Open in split view ↗');link.href=source.url;link.target='_blank';link.rel='noopener noreferrer';link.dataset.sourceName=source.name;row.append(body,link);sites.append(row);}
  const sourceSelect=$('sourceSelect'),selected=sourceSelect.value;sourceSelect.replaceChildren(option('','All sources'));
  for(const source of sources)sourceSelect.append(option(source.name,source.name));sourceSelect.value=selected;
}

async function downloadDocument(info,button){
  button.disabled=true;
  try{const response=await fetch(info.url,{credentials:'same-origin'});if(!response.ok)throw new Error('Download could not be started.');const blob=await response.blob();const url=URL.createObjectURL(blob);const anchor=element('a');anchor.href=url;anchor.download=info.name;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
  catch(error){setMessage(error.message,true);}finally{button.disabled=false;}
}

function renderDocuments(){const documents=$('documents');documents.replaceChildren();for(const info of data.documents||[]){const row=element('div','document'),body=element('div');body.append(element('strong','',info.name),element('small','',`${info.format} · ${Math.ceil(info.bytes/1024)} KB`));const button=element('button','','Download');button.type='button';button.addEventListener('click',()=>downloadDocument(info,button));row.append(body,button);documents.append(row);}if(!documents.childElementCount)documents.append(element('p','muted','No Teaching documents are available yet.'));}

function render(){const visible=filteredJobs();renderMetrics(visible);renderJobs(visible);renderSources();renderDocuments();}
function renderSearches(){const select=$('savedSearch'),current=select.value;select.replaceChildren(option('','Saved searches'));for(const saved of data.savedSearches||[])select.append(option(saved.id,saved.name));select.value=data.activeSavedSearchId||current;}
function renderLocations(){const select=$('location'),current=select.value,values=[...new Set((data.jobs||[]).map(job=>job.location).filter(Boolean))].sort();for(const location of values)if(![...select.options].some(item=>item.value===location))select.append(option(location,location));select.value=current;}
function renderStatuses(){const select=$('applicationStatus'),current=select.value;select.replaceChildren(option('active',`Active applications (${(data.jobs||[]).filter(job=>job.active!==false&&!['Rejected','Withdrawn','Case Closed','Silent'].includes(job.applicationStatus)).length})`),option('',`Any application status (${data.jobs?.length||0})`));for(const status of teachingStatuses)select.append(option(status,`${status} (${(data.jobs||[]).filter(job=>job.applicationStatus===status).length})`));select.value=current;}
async function load(){
  data=await request('/api/user-space/teaching-overview');
  renderLocations();renderStatuses();renderSearches();
  const saved=data.savedSearches?.find(item=>item.id===data.activeSavedSearchId);
  if(saved)restore(saved.criteria);
  $('updated').textContent=data.databaseStats?.total?`Loaded ${data.databaseStats.total} saved Teaching records`:'Not refreshed yet';
  setMessage(`${data.databaseStats?.active||0} active · ${data.databaseStats?.archived||0} archived`);
  render();
  if(data.refreshState?.status==='running')await pollRefresh(data.refreshState);
  else refresh('automatic').catch(error=>setMessage(error.message,true));
}
function showProgress(state){
  $('refreshProgress').classList.add('active');
  $('refreshBar').style.width=`${state.progress||0}%`;
  $('refreshPercent').textContent=`${state.progress||0}%`;
  $('refreshPhase').textContent=state.phase||'Refreshing Teaching database';
  $('refreshSources').textContent=state.totalSources?`${state.completedSources||0} of ${state.totalSources} Teaching sources checked`:'Preparing sources';
  const seconds=Math.max(0,Number(state.elapsedSeconds)||0);
  $('refreshTime').textContent=`Elapsed ${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
}
async function pollRefresh(initial){
  const button=$('refresh');button.disabled=true;button.textContent='Refreshing database…';refreshing=true;
  let state=initial;
  try{
    const deadline=Date.now()+5*60_000;
    while(state.status==='running'){
      showProgress(state);
      if(Date.now()>deadline)throw new Error('Teaching refresh timed out; saved results remain available.');
      await new Promise(resolve=>setTimeout(resolve,900));
      state=await request(`/api/user-space/teaching-refresh?id=${encodeURIComponent(state.id)}`);
    }
    showProgress(state);
    if(state.status==='failed')throw new Error(state.error||'Teaching refresh failed.');
    data={...data,...state.result};renderLocations();renderStatuses();renderSearches();render();
    $('updated').textContent=`Database refreshed ${new Date(data.refreshedAt).toLocaleString('en-GB')}`;
    setMessage(`${state.result.verified} exact postings verified across ${state.result.checked} Teaching sources.`);
  }catch(error){setMessage(error.message,true);$('refreshPhase').textContent='Refresh failed';}
  finally{button.disabled=false;button.textContent='Refresh live results';refreshing=false;}
}
async function refresh(trigger='manual'){
  if(refreshing)return;
  setMessage(trigger==='automatic'?'Opening Teaching Jobs — automatically refreshing live results.':'Starting manual Teaching source refresh.');
  const state=await request('/api/user-space/teaching-refresh',{method:'POST',body:JSON.stringify({query:$('query').value.trim(),location:$('location').value,includeRemoteAnywhere:$('includeRemoteAnywhere').checked})});
  await pollRefresh(state);
}
function restore(values){for(const id of filterIds)if(Object.hasOwn(values,id)){if(teachingCheckboxIds.has(id))$(id).checked=Boolean(values[id]);else $(id).value=String(values[id]??'');}render();}
function renderWeightControls(){const grid=$('weightGrid');for(const family of Object.keys(teachingWeights)){const label=element('label','',family.replace(/([A-Z])/g,' $1'));const select=element('select');select.dataset.family=family;for(let n=0;n<=5;n++)select.append(option(String(n),n?'Weight '+n:'Ignore'));select.value=String(weights[family]||0);select.addEventListener('change',()=>{weights[family]=Number(select.value);localStorage.setItem('alex-teaching-weights',JSON.stringify(weights));render();});grid.append(label,select);}}
function renderQueue(){const container=$('queueJobs');container.replaceChildren();const pending=(data.jobs||[]).filter(job=>['Preparing','Stashed'].includes(job.applicationStatus));if(!pending.length)container.append(element('p','muted','No Teaching applications are preparing.'));for(const job of pending)container.append(jobCard(job,true));}
function bind(){
  for(const id of filterIds)$(id).addEventListener(['search','query','company','salary'].includes(id)?'input':'change',()=>{render();if(['query','location'].includes(id))$('subtitle').textContent='Search criteria changed. Refresh to rebuild the live Teaching database.';});
  $('refresh').addEventListener('click',()=>refresh());
  $('query').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();refresh();}});
  $('clear').addEventListener('click',()=>{const empty=Object.fromEntries(filterIds.map(id=>[id,teachingCheckboxIds.has(id)?false:'']));empty.match='0';empty.opportunity='0';empty.sort='priority';restore(empty);});
  $('savedSearch').addEventListener('change',async()=>{const id=$('savedSearch').value;const saved=data.savedSearches.find(item=>item.id===id);if(saved)restore(saved.criteria);try{await request('/api/user-space/teaching-saved-searches/active',{method:'POST',body:JSON.stringify({id})});data.activeSavedSearchId=id;}catch(error){setMessage(error.message,true);}});
  $('saveSearch').addEventListener('click',async()=>{const name=prompt('Name this Teaching search:',$('query').value.trim()||'Stuttgart Teaching roles');if(!name)return;try{const result=await request('/api/user-space/teaching-saved-searches',{method:'POST',body:JSON.stringify({name,criteria:criteria()})});data.savedSearches=[...data.savedSearches.filter(item=>item.id!==result.search.id),result.search];data.activeSavedSearchId=result.search.id;renderSearches();setMessage('Teaching search saved in its own database.');}catch(error){setMessage(error.message,true);}});
  $('deleteSearch').addEventListener('click',async()=>{const id=$('savedSearch').value;if(!id)return;try{await request(`/api/user-space/teaching-saved-searches?id=${encodeURIComponent(id)}`,{method:'DELETE'});data.savedSearches=data.savedSearches.filter(item=>item.id!==id);data.activeSavedSearchId='';renderSearches();setMessage('Teaching search removed.');}catch(error){setMessage(error.message,true);}});
  for(const choice of ['list','board'])$(`${choice}View`).addEventListener('click',()=>{view=choice;localStorage.setItem('alex-teaching-view',choice);render();});
  $('themeToggle').addEventListener('click',()=>{const next=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=next;localStorage.setItem('alex-teaching-theme',next);});
  $('copy').addEventListener('click',async()=>{const brief=`Teaching jobs: ${$('query').value||'English teacher / trainer'} · ${$('location').value||'any location'} · ${$('workType').value||'any work type'}`;try{await navigator.clipboard.writeText(brief);$('copy').textContent='Copied';setTimeout(()=>$('copy').textContent='Copy search brief',1500);}catch{setMessage('Clipboard access is unavailable.',true);}});
  $('sites').addEventListener('click',event=>{const link=event.target.closest('a[data-source-name]');if(!link)return;event.preventDefault();$('sourceTitle').textContent=link.dataset.sourceName;$('sourceFrameLabel').textContent=link.dataset.sourceName;$('sourceQuery').textContent=`${$('query').value||'English teacher / trainer'} · ${$('workType').value||'any work type'}`;$('sourceLocation').textContent=$('location').selectedOptions[0]?.textContent||'Any location';$('sourceOpen').href=link.href;$('sourceFrame').src=link.href;$('sourceSplit').hidden=false;$('sourceSplit').scrollIntoView({behavior:'smooth'});});
  $('closeSource').addEventListener('click',()=>{$('sourceFrame').src='about:blank';$('sourceSplit').hidden=true;});
  $('goTop').addEventListener('click',()=>window.scrollTo({top:0,behavior:'smooth'}));
  $('goEnd').addEventListener('click',()=>window.scrollTo({top:document.documentElement.scrollHeight,behavior:'smooth'}));
  $('queue').addEventListener('click',()=>{renderQueue();$('queueDialog').showModal();});
  $('closeQueue').addEventListener('click',()=>$('queueDialog').close());
  $('closeApplication').addEventListener('click',()=>$('applicationDialog').close());
  $('teachingEmailLanguage').addEventListener('change',()=>previewTeachingEmail());
  $('sendTeachingEmail').addEventListener('click',async()=>{
    if(!applicationJob)return;
    if(!confirm(`Send this Teaching application to ${$('teachingRecipient').value.trim()} after a 15-second Undo window?`))return;
    try{
      const result=await request('/api/user-space/teaching-fast-apply/send',{method:'POST',body:JSON.stringify({id:applicationJob.id,to:$('teachingRecipient').value.trim(),subject:$('teachingSubject').value,body:$('teachingMessage').value,language:$('teachingEmailLanguage').value,confirmed:true})});
      showTeachingPending(result.pending);pollTeachingPending(applicationJob.id).catch(error=>setMessage(error.message,true));
    }catch(error){$('teachingSendState').textContent=error.message;setMessage(error.message,true);}
  });
  $('undoTeachingEmail').addEventListener('click',async()=>{if(!applicationJob)return;try{const result=await request('/api/user-space/teaching-fast-apply/undo',{method:'POST',body:JSON.stringify({id:applicationJob.id})});showTeachingPending(result.pending);}catch(error){setMessage(error.message,true);}});
  $('downloadTeachingHelper').addEventListener('click',async()=>{
    const button=$('downloadTeachingHelper');button.disabled=true;
    try{
      const response=await fetch('/api/user-space/teaching-chrome-extension',{method:'POST',headers:{'x-csrf-token':csrfToken},credentials:'same-origin'});
      if(!response.ok){const error=await response.json().catch(()=>({}));throw new Error(error.error||'Teaching helper export failed');}
      const blob=await response.blob(),name=response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1]||'alex-job-teaching-helper.zip';
      const url=URL.createObjectURL(blob),anchor=element('a');anchor.href=url;anchor.download=name;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
      $('teachingWebsiteState').textContent='Teaching helper downloaded. Extract it and load the folder unpacked in the same Chrome profile.';
    }catch(error){$('teachingWebsiteState').textContent=error.message;setMessage(error.message,true);}finally{button.disabled=false;}
  });
  $('startTeachingWebsiteApply').addEventListener('click',async()=>{
    if(!applicationJob)return;
    const button=$('startTeachingWebsiteApply');button.disabled=true;
    try{
      const result=await request('/api/user-space/teaching-website-apply/start',{method:'POST',body:JSON.stringify({id:applicationJob.id,language:$('teachingEmailLanguage').value})});
      showTeachingWebsiteSession(result.session);pollTeachingWebsite(applicationJob.id).catch(error=>setMessage(error.message,true));
    }catch(error){$('teachingWebsiteState').textContent=error.message;setMessage(error.message,true);}finally{button.disabled=false;}
  });
  $('submitTeachingWebsiteApply').addEventListener('click',async()=>{
    if(!applicationJob)return;
    if(!confirm(`Submit the Teaching application for ${applicationJob.title} at ${applicationJob.company} from the currently open Chrome page?`))return;
    const button=$('submitTeachingWebsiteApply');button.disabled=true;
    try{
      const result=await request('/api/user-space/teaching-website-apply/submit',{method:'POST',body:JSON.stringify({id:applicationJob.id,confirmed:true})});
      showTeachingWebsiteSession(result.session);data.jobs=data.jobs.map(job=>job.id===result.job.id?result.job:job);renderStatuses();render();
    }catch(error){$('teachingWebsiteState').textContent=error.message;setMessage(error.message,true);}finally{button.disabled=false;}
  });
  $('prepareApplication').addEventListener('click',async()=>{
    if(!applicationJob)return;
    const button=$('prepareApplication');button.disabled=true;
    try{
      const result=await request('/api/user-space/teaching-application-package',{method:'POST',body:JSON.stringify({id:applicationJob.id,description:$('applicationDescription').value})});
      renderApplicationPackage(result.package);
      setMessage('Teaching documents prepared in the separate Teaching folder. Review before using them.');
    }catch(error){$('applicationPackage').replaceChildren(element('p','',error.message));setMessage(error.message,true);}
    finally{button.disabled=false;}
  });
  $('mobileFilters').addEventListener('click',()=>$('filters').scrollIntoView({behavior:'smooth'}));$('mobileResults').addEventListener('click',()=>$('results').scrollIntoView({behavior:'smooth'}));$('mobileBoard').addEventListener('click',()=>{view='board';render();$('jobs').scrollIntoView({behavior:'smooth'});});$('mobileRefresh').addEventListener('click',()=>refresh());
  renderWeightControls();
}

document.documentElement.dataset.theme=localStorage.getItem('alex-teaching-theme')||'dark';
const session=await request('/api/user-space/session');
if(!session.authenticated)location.assign('/');
else{csrfToken=session.csrfToken;bind();load().catch(error=>setMessage(error.message,true));}
