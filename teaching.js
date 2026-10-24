import { filterTeachingJobs, teachingFilterIds, teachingCheckboxIds, teachingStatuses } from './teaching-filter-logic.js';

function sourceAvailability(source){
  if(source.availability)return source.availability;
  if(['ok','results'].includes(source.status))return 'available';
  if(source.status==='needs_key')return 'access_restricted';
  if(source.status==='unavailable')return 'unavailable';
  return 'not_checked';
}
function compareSourcesByAvailabilityAndName(a,b){
  const priority={available:0,access_restricted:1,not_checked:2,unavailable:3};
  return (priority[sourceAvailability(a)]??4)-(priority[sourceAvailability(b)]??4)||
    String(a.name||a.source||'').localeCompare(String(b.name||b.source||''),undefined,{sensitivity:'base'});
}

const $=id=>document.getElementById(id);
const statusNames=['Not recorded','Stashed','Preparing','Applied','Interviewing','Offer','Rejected','Silent','Case Closed','Withdrawn'];
const filterIds=teachingFilterIds;
const teachingWeights={english:['english','esl','efl','englisch'],youngLearners:['children','young learners','jugendliche','kinder'],training:['teacher training','teacher observation','trainer','fortbildung'],online:['online','remote','digital','virtual'],operations:['lesson plan','class management','follow-up','curriculum']};
const germanyCities=['Aachen','Backnang','Bad Friedrichshall','Berlin','Bietigheim-Bissingen','Böblingen','Bonn','Bremen','Cologne','Ditzingen','Dortmund','Dresden','Düsseldorf','Essen','Esslingen','Fellbach','Filderstadt','Frankfurt am Main','Göppingen','Hamburg','Hannover','Heidelberg','Heilbronn','Herrenberg','Karlsruhe','Kirchheim unter Teck','Kornwestheim','Leinfelden-Echterdingen','Leipzig','Leonberg','Ludwigsburg','Mannheim','Marbach am Neckar','Metzingen','Munich','Neckarsulm','Nuremberg','Nürtingen','Ostfildern','Pforzheim','Remseck am Neckar','Reutlingen','Schorndorf','Sindelfingen','Stuttgart','Tübingen','Vaihingen an der Enz','Waiblingen','Wiesbaden','Winnenden'];
let weights=JSON.parse(localStorage.getItem('alex-teaching-weights')||'{"english":5,"youngLearners":5,"training":4,"online":3,"operations":3}');
let csrfToken='', data={jobs:[],sources:[],documents:[],savedSearches:[],sourceStatus:[],databaseStats:{total:0}},view=localStorage.getItem('alex-teaching-view')||'list',refreshing=false;
let locationsReady=false;

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

function postingLink(job,label='Apply ↗'){
  const link=element('a','',label);link.href=job.url;link.target='_blank';link.rel='noopener noreferrer';return link;
}
function teachingScore(job,key,fallback){
  const value=Number(job[key]??fallback);
  return Number.isFinite(value)&&value>0?`${Math.round(value)}/100`:'Not assessed';
}
function jobCard(job,compact=false){
  const card=element('article',compact?'board-card':'panel job-card');
  if(compact){
    card.append(element('h4','',job.title),element('p','',`${job.company} · ${job.location}`));
    const actions=element('div','job-actions');actions.append(postingLink(job,'Posting ↗'),statusSelect(job));
    const studio=element('button','','Prepare documents');studio.type='button';studio.addEventListener('click',()=>openApplication(job));actions.append(studio);card.append(actions);
    return card;
  }
  const top=element('div','jobtop'),identity=element('div'),topActions=element('div','jobtop-actions');
  identity.append(element('h3','',job.title),element('p','',`${job.company} · ${job.location}`));
  topActions.append(postingLink(job));
  const share=element('button','','Share');share.type='button';share.addEventListener('click',async()=>{
    try{if(navigator.share)await navigator.share({title:job.title,text:`${job.company} · ${job.location}`,url:job.url});else{await navigator.clipboard.writeText(job.url);share.textContent='Copied';setTimeout(()=>share.textContent='Share',1500);}}
    catch(error){if(error.name!=='AbortError')setMessage('Could not share this posting.',true);}
  });topActions.append(share);top.append(identity,topActions);card.append(top);
  const source=job.source||'Teaching source';
  card.append(element('div','job-origin',`Source: ${source} · verified Teaching posting`));
  const meta=element('div','job-meta');
  for(const [label,kind] of [[`${teachingScore(job,'interviewFitScore',job.match)} provisional interview fit`,'positive'],[`${teachingScore(job,'opportunityQualityScore',0)} opportunity quality`,'neutral'],[job.recommendation||'Review','positive'],[job.workType||'Not stated','neutral'],[job.remote?'Remote / hybrid':'On-site / not stated','neutral'],[job.rawLanguage||'Language not stated','neutral']])meta.append(element('span',`chip ${kind}`,label));
  card.append(meta);
  const summary=element('div','strategy-summary');
  for(const [label,value] of [['Interview fit',teachingScore(job,'interviewFitScore',job.match)],['Opportunity',teachingScore(job,'opportunityQualityScore',0)],['Priority',job.recommendation||'Review'],['Assessment',job.description?'Review verified description':'Title only — review source']]){
    const tile=element('div','strategy-tile');tile.append(element('small','',label),element('strong','',value));summary.append(tile);
  }card.append(summary);
  const why=element('details');why.append(element('summary','','Why apply or skip'),element('p','',`Recommendation: ${job.recommendation||'Not assessed'}. Interview fit is provisional and should be checked against the full posting before applying.`));card.append(why);
  const evidence=element('div','job-evidence');evidence.append(element('strong','','Match evidence'),element('p','',job.description?'Based on the saved posting title and description. Review the exact posting for requirements and eligibility.':'Title alignment only — review the exact source posting.'));card.append(evidence);
  if(job.location){
    const map=element('details','job-map'),destination=[job.company,job.location].filter(Boolean).join(', ');
    map.append(element('summary','','Google Map and route from Berlin'),element('p','',`Destination: ${destination}. Confirm the exact address before travelling.`));
    for(const [label,url] of [['Open in Google Maps',`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(destination)}`],['Driving route',`https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent('Berlin, Germany')}&destination=${encodeURIComponent(destination)}&travelmode=driving`],['Public transport',`https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent('Berlin, Germany')}&destination=${encodeURIComponent(destination)}&travelmode=transit`]]){
      const link=element('a','',label);link.href=url;link.target='_blank';link.rel='noopener noreferrer';map.append(link);
    }card.append(map);
  }
  const jd=element('details');jd.append(element('summary','','JD details and strategic assessment'),element('p','',job.description||'No complete job description is saved. Check the exact posting before preparing an application.'));card.append(jd);
  const actions=element('div','job-actions'),statusField=element('label','action-field','Application status'),commentField=element('label','action-field','Application comment'),comment=element('textarea');
  statusField.append(statusSelect(job));comment.value=job.applicationComment||'';comment.placeholder='Why I applied or skipped it, follow-up plan, interview notes…';comment.setAttribute('aria-label',`Application comment for ${job.title}`);commentField.append(comment);
  const save=element('button','','Save note');save.type='button';save.addEventListener('click',()=>saveStatus(job,statusField.querySelector('select').value,comment.value));actions.append(statusField,commentField,save);card.append(actions);
  const applyActions=element('div','job-apply-actions');
  for(const [label,mode,autoStart] of [['Prepare application','package',false],['Start AI website application','website',true],['Edit link / Retry AI Apply','editLink',false],['Fast Apply','fast',false]]){
    const button=element('button',label==='Fast Apply'?'primary':'',label);button.type='button';button.addEventListener('click',()=>openApplication(job,mode,autoStart));applyActions.append(button);
  }card.append(applyActions);
  const timing=element('div','job-timing');
  timing.append(element('span','',`Applied: ${job.appliedAt?new Date(job.appliedAt).toLocaleString():'Date not recorded'} · Status last changed: ${job.applicationStatusChangedAt?new Date(job.applicationStatusChangedAt).toLocaleString():'Timestamp not recorded'}`));
  if(Array.isArray(job.applicationHistory)&&job.applicationHistory.length){
    const history=element('details','status-history'),list=element('ol');history.append(element('summary','',`View status history (${job.applicationHistory.length})`));
    for(const event of job.applicationHistory){const at=event.changedAt?new Date(event.changedAt).toLocaleString():'Date not recorded';list.append(element('li','',`${at}: ${event.previousStatus||'—'} → ${event.newStatus||'Not recorded'}${event.source?` · ${event.source}`:''}`));}
    history.append(list);timing.append(history);
  }card.append(timing);
  const salary=job.salaryMin||job.salaryMax?`Salary: ${[job.salaryMin,job.salaryMax].filter(Boolean).map(value=>`${Math.round(Number(value))} EUR`).join('–')}`:'Salary not stated';
  card.append(element('div','job-foot',`${salary} · ${job.posted||job.postedAt?`Posted ${job.posted||job.postedAt}`:'Posting date not stated'}`));
  return card;
}

let applicationJob=null,applicationPackage=null,applicationMode='package',documentType='cv',documentLanguage='de',gmailReady=false,teachingPending=null,previewSequence=0,websiteStatusRequest=0;
const documentDrafts=new Map();
function renderTeachingActivity(){
  const log=$('teachingActivityBody');log.replaceChildren();
  if(!applicationJob)return;
  const events=[...(applicationJob.applicationHistory||[]).map(item=>`${item.changedAt?new Date(item.changedAt).toLocaleString():'Date not recorded'} · ${item.previousStatus||'—'} → ${item.newStatus||'Not recorded'}${item.source?` · ${item.source}`:''}`)];
  if(applicationPackage)events.push(`Teaching document package v${applicationPackage.currentVersion} · ${new Date(applicationPackage.updatedAt).toLocaleString()}`);
  if(teachingPending)events.unshift(`Gmail delivery: ${teachingPending.status}${teachingPending.sentAt?` · ${new Date(teachingPending.sentAt).toLocaleString()}`:''}`);
  if(!events.length)events.push('No Teaching application activity recorded yet.');
  for(const line of events)log.append(element('p','',line));
}
function validTeachingRecipient(value){return /^[^\s@<>]+@[^\s@<>]+\.[A-Za-z]{2,}$/.test(String(value||'').trim());}
function updateTeachingSendState(){
  const recipient=$('teachingRecipient').value.trim(),subject=$('teachingSubject').value.trim(),body=$('teachingMessage').value.trim();
  $('sendTeachingEmail').disabled=!applicationPackage||!gmailReady||!validTeachingRecipient(recipient)||!subject||body.length<40||Boolean(teachingPending&&['queued','sending','sent','uncertain'].includes(teachingPending.status));
  if($('teachingRecipient').dataset.source!=='verified')$('teachingRecipientProof').textContent=validTeachingRecipient(recipient)?'Manual address: check it against the posting before confirming Send.':'Enter a valid recruiter or application email address.';
}
function showApplicationMode(mode){
  applicationMode=mode;
  $('teachingFastApply').hidden=mode!=='fast'||!applicationPackage;
  $('teachingWebsiteApply').hidden=mode!=='website'||!applicationPackage;
  $('openTeachingFastApply').classList.toggle('active',mode==='fast');
  $('openTeachingWebsiteApply').classList.toggle('active',mode==='website');
  if(!applicationPackage&&['fast','website'].includes(mode))$('applicationHelp').textContent='Prepare and review the Teaching CV and cover letter before Fast Apply or AI Apply.';
  if(mode==='fast'&&applicationPackage)previewTeachingEmail();
  if(mode==='website'&&applicationPackage){
    const sequence=++websiteStatusRequest,jobId=applicationJob.id;
    request(`/api/user-space/teaching-website-apply/status?id=${encodeURIComponent(jobId)}`).then(result=>{if(sequence===websiteStatusRequest&&applicationJob?.id===jobId&&result.session)showTeachingWebsiteSession(result.session);}).catch(error=>{if(sequence===websiteStatusRequest)$('teachingWebsiteState').textContent=error.message;});
  }
  if(mode==='editLink')$('teachingApplicationUrl').focus();
  else if(applicationPackage&&['fast','website'].includes(mode))$(mode==='fast'?'teachingFastApply':'teachingWebsiteApply').scrollIntoView({block:'nearest'});
}
async function openApplication(job,mode='package',autoStart=false){
  applicationJob=job;
  applicationPackage=null;teachingPending=null;gmailReady=false;documentDrafts.clear();previewSequence++;
  $('applicationTitle').textContent=job.title;
  $('applicationCompany').textContent=`${job.company} · ${job.location}`;
  $('applicationHelp').textContent='Checking the saved Teaching package…';
  $('applicationDescription').value=job.description||'';
  $('teachingApplicationUrl').value=job.applicationUrl||job.url||'';
  $('openTeachingApplicationPage').href=job.applicationUrl||job.url;
  $('applicationPackage').replaceChildren();
  $('teachingPackageControls').hidden=true;
  $('teachingFastApply').hidden=true;
  $('teachingWebsiteApply').hidden=true;
  $('teachingSendState').textContent='';
  $('teachingWebsiteState').textContent='';
  $('sendTeachingEmail').disabled=true;
  $('submitTeachingWebsiteApply').disabled=true;
  $('teachingRecipient').value='';$('teachingSubject').value='';$('teachingMessage').value='';
  $('teachingRecipient').dataset.source='';
  renderTeachingActivity();
  applicationMode=mode;
  if($('applicationDialog').open)$('applicationDialog').close();
  $('applicationDialog').showModal();
  try{
    const result=await request(`/api/user-space/teaching-application-package?id=${encodeURIComponent(job.id)}`);
    if(applicationJob?.id!==job.id)return;
    if(result.package){renderApplicationPackage(result.package);showApplicationMode(mode);if(autoStart&&mode==='website')await startTeachingWebsiteApply();}
    else{$('applicationHelp').textContent=`No Teaching package is saved yet. Review the complete job description, then prepare the CV and cover letter before ${mode==='website'?'AI Apply':mode==='fast'?'Fast Apply':'applying'}.`;$('teachingJdFallback').open=true;showApplicationMode(mode);}
  }catch(error){$('applicationHelp').textContent=error.message;setMessage(error.message,true);}
}
function renderApplicationPackage(pkg){
  applicationPackage=pkg;documentDrafts.clear();
  for(const type of ['cv','coverLetter','remarks'])for(const language of ['de','en'])documentDrafts.set(`${type}:${language}`,pkg.documents[type]?.[language]?.body||'');
  $('teachingPackageControls').hidden=false;
  $('teachingStudioStart').hidden=false;$('teachingJdFallback').open=false;
  $('applicationHelp').textContent='The latest Teaching package is ready. Earlier versions remain available below.';
  $('teachingPackageMeta').textContent=`Version ${pkg.currentVersion} · generated ${new Date(pkg.updatedAt).toLocaleString()} · ${pkg.job.company} · ${pkg.job.title}`;
  renderTeachingActivity();
  const history=$('teachingPackageHistoryBody');history.replaceChildren();
  for(const prior of [...pkg.history].reverse()){
    const row=element('div','history-row'),label=element('span','',`Version ${prior.version} · ${new Date(prior.createdAt).toLocaleString()} · ${prior.changeType}`);row.append(label);
    if(prior.version!==pkg.currentVersion){const restore=element('button','','Restore as new version');restore.type='button';restore.addEventListener('click',()=>restoreTeachingVersion(prior.version));row.append(restore);}
    history.append(row);
  }
  renderTeachingDocument();
}
function renderTeachingDocument(){
  if(!applicationPackage)return;
  for(const button of $('teachingDocumentChoices').querySelectorAll('button'))button.classList.toggle('active',button.dataset.teachingType===documentType);
  for(const button of $('teachingLanguageChoices').querySelectorAll('button'))button.classList.toggle('active',button.dataset.teachingLanguage===documentLanguage);
  $('teachingDocumentLabel').textContent=`${documentLanguage==='de'?'German':'English'} ${documentType==='cv'?'CV / resume':documentType==='portalNote'?'portal note / Ihre Bemerkungen':'cover letter'}`;
  const isPortalNote=documentType==='portalNote';
  $('teachingDocumentEditor').value=documentDrafts.get(`${isPortalNote?'remarks':documentType}:${documentLanguage}`)||'';
  $('saveTeachingDocument').textContent=isPortalNote?'Save portal note':'Save my edits';
  $('printTeachingDocument').hidden=isPortalNote;
  const area=$('applicationPackage');area.replaceChildren(element('h3','',isPortalNote?'Copy the portal note into the application form':`Downloads · ${documentLanguage==='de'?'German':'English'}`));
  if(isPortalNote)return;
  for(const type of ['cv','coverLetter'])for(const [format,label] of [['docx',`Download ${type==='cv'?'CV':'cover letter'} · Word`],['pdf',`Save ${type==='cv'?'CV':'cover letter'} · PDF`]]){
    const item=applicationPackage.documents[type][documentLanguage],button=element('button','',label);button.type='button';
    button.addEventListener('click',()=>downloadDocument({url:format==='pdf'?item.document.pdfDownloadUrl:item.document.downloadUrl,name:item.document.fileName.replace(/\.docx$/i,format==='pdf'?'.pdf':'.docx')},button));area.append(button);
  }
}
async function restoreTeachingVersion(version){
  if(!applicationJob||!confirm(`Restore Teaching package version ${version} as a new version?`))return;
  try{const result=await request('/api/user-space/teaching-application-package',{method:'POST',body:JSON.stringify({id:applicationJob.id,action:'restore',version})});renderApplicationPackage(result.package);$('applicationHelp').textContent=`Version ${version} restored as version ${result.package.currentVersion}.`;}
  catch(error){$('applicationHelp').textContent=error.message;}
}
async function previewTeachingEmail(){
  if(!applicationJob)return;
  const jobId=applicationJob.id,language=$('teachingEmailLanguage').value,sequence=++previewSequence,manualRecipient=$('teachingRecipient').value.trim();
  try{
    const result=await request('/api/user-space/teaching-fast-apply/preview',{method:'POST',body:JSON.stringify({id:jobId,language,recipient:manualRecipient})});
    if(applicationJob?.id!==jobId||$('teachingEmailLanguage').value!==language||sequence!==previewSequence)return;
    const p=result.preview;
    $('teachingRecipient').value=p.recipient||'';
    $('teachingSubject').value=p.subject||'';
    $('teachingMessage').value=p.body||'';
    gmailReady=Boolean(p.gmail.connected);
    $('teachingRecipient').dataset.source=p.recipientVerified?'verified':'manual';
    $('teachingRecipientProof').textContent=p.recipientVerified?`Verified on the retrieved job description: ${p.verifiedRecipients.join(', ')}.`:'Enter an address explicitly shown on the posting; manually entered addresses require your review.';
    $('teachingGmailStatus').textContent=gmailReady?`Gmail connected as ${p.gmail.email}. ${result.remaining} of 10 Teaching sends available today.`:'Gmail is not connected. Reconnect the shared account, then return here.';
    $('teachingFastApplyPolicy').textContent=`BCC: ${p.bcc||'not configured'} · The 15-second Undo window begins after you confirm Send.`;
    const attachments=$('teachingAttachments');attachments.replaceChildren(...(p.attachments||[]).map(item=>element('li','',item.fileName)));
    teachingPending=result.pending||null;
    if(result.pending)showTeachingPending(result.pending);
    updateTeachingSendState();
  }catch(error){if(applicationJob?.id!==jobId||sequence!==previewSequence)return;$('teachingGmailStatus').textContent=error.message;$('sendTeachingEmail').disabled=true;}
}
function showTeachingPending(pending){
  teachingPending=pending;
  renderTeachingActivity();
  const undo=$('undoTeachingEmail'),send=$('sendTeachingEmail');
  undo.hidden=pending.status!=='queued';
  $('teachingSendState').textContent=pending.status==='queued'?`Queued. Undo before ${new Date(pending.dueAt).toLocaleTimeString()}.`:pending.status==='sent'?`Sent to ${pending.to} at ${new Date(pending.sentAt).toLocaleString()}. Teaching status is Applied.`:pending.error||`Teaching send: ${pending.status}`;
  updateTeachingSendState();
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
async function startTeachingWebsiteApply(){
  if(!applicationJob)return;
  if(!applicationPackage){$('applicationHelp').textContent='Prepare and review the Teaching CV and cover letter before AI Apply.';return;}
  const stored=applicationJob.applicationUrl||applicationJob.url;
  if($('teachingApplicationUrl').value.trim()!==stored){$('teachingWebsiteState').textContent='Save the edited application link before starting AI Apply.';showApplicationMode('editLink');return;}
  showApplicationMode('website');
  websiteStatusRequest++;
  const button=$('startTeachingWebsiteApply');button.disabled=true;
  try{
    const result=await request('/api/user-space/teaching-website-apply/start',{method:'POST',body:JSON.stringify({id:applicationJob.id,language:$('teachingEmailLanguage').value})});
    showTeachingWebsiteSession(result.session);pollTeachingWebsite(applicationJob.id).catch(error=>{$('teachingWebsiteState').textContent=error.message;});
  }catch(error){$('teachingWebsiteState').textContent=error.message;setMessage(error.message,true);}finally{button.disabled=false;}
}
async function saveTeachingApplicationUrl(){
  if(!applicationJob)return;
  const button=$('saveTeachingApplicationUrl');button.disabled=true;
  try{
    const result=await request('/api/user-space/teaching-application-link',{method:'POST',body:JSON.stringify({id:applicationJob.id,url:$('teachingApplicationUrl').value.trim()})});
    applicationJob=result.job;data.jobs=data.jobs.map(job=>job.id===result.job.id?result.job:job);
    $('openTeachingApplicationPage').href=result.job.applicationUrl;
    $('applicationHelp').textContent='Actual Teaching application link saved. The exact posting URL remains unchanged.';
    await startTeachingWebsiteApply();
  }catch(error){$('applicationHelp').textContent=error.message;setMessage(error.message,true);}finally{button.disabled=false;}
}
async function saveTeachingDocument(){
  if(!applicationJob||!applicationPackage)return;
  const button=$('saveTeachingDocument');button.disabled=true;
  try{
    const result=await request('/api/user-space/teaching-application-package',{method:'POST',body:JSON.stringify({id:applicationJob.id,action:'save',type:documentType==='portalNote'?'remarks':documentType,language:documentLanguage,body:$('teachingDocumentEditor').value})});
    renderApplicationPackage(result.package);$('applicationHelp').textContent=`Teaching edits saved as version ${result.package.currentVersion}. Review both PDF attachments before sending.`;
  }catch(error){$('applicationHelp').textContent=error.message;setMessage(error.message,true);}finally{button.disabled=false;}
}
async function regenerateTeachingPackage(scope='full'){
  if(!applicationJob)return;
  const button=$('prepareApplication');button.disabled=true;
  try{
    const result=await request('/api/user-space/teaching-application-package',{method:'POST',body:JSON.stringify({id:applicationJob.id,action:'prepare',scope,description:$('applicationDescription').value})});
    renderApplicationPackage(result.package);$('applicationHelp').textContent=`Teaching ${scope==='full'?'package':scope==='cv'?'CV':'cover letter'} prepared as version ${result.package.currentVersion}. Review before using it.`;
    if(applicationMode==='fast'||applicationMode==='website')showApplicationMode(applicationMode);
  }catch(error){$('applicationHelp').textContent=error.message;setMessage(error.message,true);}finally{button.disabled=false;}
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
function renderLocations(){
  const select=$('location'),current=locationsReady?(select.value==='Germany'?'':select.value):'Stuttgart area';
  const german=element('optgroup');german.label='Germany';
  for(const city of germanyCities)german.append(option(city,city));
  const saved=element('optgroup');saved.label='Locations in saved Teaching results';
  for(const location of [...new Set((data.jobs||[]).map(job=>job.location).filter(Boolean))].sort())if(!germanyCities.includes(location))saved.append(option(location,location));
  select.replaceChildren(option('','All locations / Germany'),option('Stuttgart area','Stuttgart — within 50 km + remote'),german);
  if(saved.childElementCount)select.append(saved);
  select.value=[...select.options].some(item=>item.value===current)?current:'Stuttgart area';
  locationsReady=true;
}
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
function restore(values){for(const id of filterIds)if(Object.hasOwn(values,id)){if(teachingCheckboxIds.has(id))$(id).checked=Boolean(values[id]);else $(id).value=id==='location'&&values[id]==='Germany'?'':String(values[id]??'');}render();}
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
  $('applicationDialog').addEventListener('click',event=>{if(event.target===$('applicationDialog'))$('applicationDialog').close();});
  $('openTeachingFastApply').addEventListener('click',()=>showApplicationMode('fast'));
  $('openTeachingWebsiteApply').addEventListener('click',()=>showApplicationMode('website'));
  $('saveTeachingApplicationUrl').addEventListener('click',saveTeachingApplicationUrl);
  $('teachingDocumentChoices').addEventListener('click',event=>{const type=event.target.closest('[data-teaching-type]')?.dataset.teachingType;if(type){documentType=type;renderTeachingDocument();}});
  $('teachingLanguageChoices').addEventListener('click',event=>{const language=event.target.closest('[data-teaching-language]')?.dataset.teachingLanguage;if(language){documentLanguage=language;$('teachingEmailLanguage').value=language;renderTeachingDocument();if(applicationMode==='fast')previewTeachingEmail();}});
  $('teachingDocumentEditor').addEventListener('input',()=>documentDrafts.set(`${documentType==='portalNote'?'remarks':documentType}:${documentLanguage}`,$('teachingDocumentEditor').value));
  $('saveTeachingDocument').addEventListener('click',saveTeachingDocument);
  $('copyTeachingDocument').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('teachingDocumentEditor').value);$('applicationHelp').textContent='Selected Teaching document copied.';}catch{$('applicationHelp').textContent='Clipboard access is unavailable.';}});
  $('printTeachingDocument').addEventListener('click',()=>{
    const popup=window.open('','_blank');if(!popup){$('applicationHelp').textContent='Allow the print window, then try again.';return;}
    popup.document.title=`Teaching ${documentType==='cv'?'CV':'cover letter'} · ${documentLanguage.toUpperCase()}`;
    const style=popup.document.createElement('style');style.textContent='body{font:12pt/1.5 Arial,sans-serif;margin:20mm;color:#17253a}pre{white-space:pre-wrap;font:inherit}button{margin-bottom:16px;padding:8px 14px}@media print{button{display:none}}';popup.document.head.append(style);
    const close=popup.document.createElement('button');close.textContent='Close and return to Alex Job';close.addEventListener('click',()=>popup.close());
    const body=popup.document.createElement('pre');body.textContent=$('teachingDocumentEditor').value;popup.document.body.append(close,body);popup.focus();popup.print();
  });
  $('teachingPackageControls').addEventListener('click',event=>{const scope=event.target.closest('[data-teaching-scope]')?.dataset.teachingScope;if(scope)regenerateTeachingPackage(scope);});
  $('teachingEmailLanguage').addEventListener('change',()=>previewTeachingEmail());
  $('teachingRecipient').addEventListener('input',()=>{$('teachingRecipient').dataset.source='manual';updateTeachingSendState();});
  $('teachingSubject').addEventListener('input',updateTeachingSendState);
  $('teachingMessage').addEventListener('input',updateTeachingSendState);
  $('sendTeachingEmail').addEventListener('click',async()=>{
    if(!applicationJob)return;
    updateTeachingSendState();if($('sendTeachingEmail').disabled)return;
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
  $('startTeachingWebsiteApply').addEventListener('click',startTeachingWebsiteApply);
  $('submitTeachingWebsiteApply').addEventListener('click',async()=>{
    if(!applicationJob)return;
    if(!confirm(`Submit the Teaching application for ${applicationJob.title} at ${applicationJob.company} from the currently open Chrome page?`))return;
    const button=$('submitTeachingWebsiteApply');button.disabled=true;
    try{
      const result=await request('/api/user-space/teaching-website-apply/submit',{method:'POST',body:JSON.stringify({id:applicationJob.id,confirmed:true})});
      showTeachingWebsiteSession(result.session);data.jobs=data.jobs.map(job=>job.id===result.job.id?result.job:job);renderStatuses();render();
    }catch(error){$('teachingWebsiteState').textContent=error.message;setMessage(error.message,true);}finally{button.disabled=false;}
  });
  $('confirmTeachingManualSubmit').addEventListener('click',async()=>{
    if(!applicationJob||!confirm(`Confirm you already submitted the Teaching application for ${applicationJob.title} at ${applicationJob.company} outside Alex Job?`))return;
    const button=$('confirmTeachingManualSubmit');button.disabled=true;
    try{
      const result=await request('/api/user-space/teaching-application-status',{method:'POST',body:JSON.stringify({id:applicationJob.id,status:'Applied',comment:'Manually confirmed by user as submitted outside Alex Job.'})});
      applicationJob=result.job;data.jobs=data.jobs.map(job=>job.id===result.job.id?result.job:job);renderTeachingActivity();renderStatuses();render();
      $('applicationHelp').textContent='Teaching application marked Applied from your manual confirmation.';
    }catch(error){$('applicationHelp').textContent=error.message;setMessage(error.message,true);}finally{button.disabled=false;}
  });
  $('prepareApplication').addEventListener('click',()=>regenerateTeachingPackage('full'));
  $('mobileFilters').addEventListener('click',()=>$('filters').scrollIntoView({behavior:'smooth'}));$('mobileResults').addEventListener('click',()=>$('results').scrollIntoView({behavior:'smooth'}));$('mobileBoard').addEventListener('click',()=>{view='board';render();$('jobs').scrollIntoView({behavior:'smooth'});});$('mobileRefresh').addEventListener('click',()=>refresh());
  renderWeightControls();
}

document.documentElement.dataset.theme=localStorage.getItem('alex-teaching-theme')||'dark';
const session=await request('/api/user-space/session');
if(!session.authenticated)location.assign('/');
else{csrfToken=session.csrfToken;bind();load().catch(error=>setMessage(error.message,true));}
