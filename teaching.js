import { matchesBooleanText, compareSourcesByAvailabilityAndName } from './filter-logic.js';

const $=id=>document.getElementById(id);
const statusNames=['Not recorded','Stashed','Preparing','Applied','Interviewing','Offer','Rejected','Silent','Case Closed','Withdrawn'];
const filterIds=['query','location','company','sourceSelect','applicationStatus','workType','model','freshness','search','sort'];
let csrfToken='', data={jobs:[],sources:[],documents:[],savedSearches:[],sourceStatus:[],databaseStats:{total:0}},view=localStorage.getItem('alex-teaching-view')||'list';

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
  $('count').textContent=String(all.filter(job=>job.active!==false).length);
  $('strongCount').textContent=String(all.filter(job=>job.active!==false&&Number(job.match||0)>=70).length);
  $('online').textContent=String((data.sourceStatus||[]).filter(source=>source.status==='ok').length);
  $('appliedCount').textContent=String(all.filter(job=>['Applied','Interviewing','Offer'].includes(job.applicationStatus)).length);
  $('dbCount').textContent=String(data.databaseStats?.total||0);
  $('resultCount').textContent=`${visible.length} shown`;
  $('filterStatus').textContent=`${visible.length} matching Teaching roles in a separate database`;
}

function filteredJobs(){
  const query=$('query').value.trim(),search=$('search').value.trim(),location=$('location').value.trim().toLowerCase();
  const company=$('company').value.trim().toLowerCase(),source=$('sourceSelect').value,status=$('applicationStatus').value;
  const workType=$('workType').value,model=$('model').value,freshness=Number($('freshness').value||0);
  const result=(data.jobs||[]).filter(job=>{
    const text=`${job.title||''} ${job.company||''} ${job.location||''} ${job.description||''}`.toLowerCase();
    if(query&&!matchesBooleanText(job,query))return false;
    if(search&&!text.includes(search.toLowerCase()))return false;
    if(location&&!String(job.location||'').toLowerCase().includes(location)&&!job.remote)return false;
    if(company&&!String(job.company||'').toLowerCase().includes(company))return false;
    if(source&&job.source!==source)return false;
    if(status&&job.applicationStatus!==status)return false;
    if(workType&&job.workType!==workType)return false;
    if(model==='remote'&&!job.remote)return false;
    if(model==='onsite'&&job.remote)return false;
    if(freshness&&(!job.postedAt||Date.now()-Date.parse(job.postedAt)>freshness*86400000))return false;
    return true;
  });
  const sort=$('sort').value;
  result.sort((a,b)=>sort==='company'?String(a.company).localeCompare(String(b.company)):sort==='source'?String(a.source).localeCompare(String(b.source)):sort==='newest'?(Date.parse(b.postedAt||b.verifiedAt||0)-Date.parse(a.postedAt||a.verifiedAt||0)):(Number(b.match||0)-Number(a.match||0)));
  return result;
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
    for(const label of [`${job.match||0}% interview fit`,job.workType||'Not stated',job.remote?'Remote / hybrid':'On-site / not stated',job.source])meta.append(element('span','chip',label));
    card.append(meta);
    if(job.description){const details=element('details');const summary=element('summary','', 'Job description');details.append(summary,element('p','',job.description.slice(0,2500)));card.append(details);}
  }
  const actions=element('div','job-actions');
  const link=element('a','',compact?'Posting':'Apply ↗');link.href=job.url;link.target='_blank';link.rel='noopener noreferrer';actions.append(link,statusSelect(job));card.append(actions);
  if(!compact){const comment=element('textarea');comment.value=job.applicationComment||'';comment.placeholder='Application notes';comment.setAttribute('aria-label',`Application notes for ${job.title}`);const save=element('button','', 'Save note');save.type='button';save.addEventListener('click',()=>saveStatus(job,job.applicationStatus||'Not recorded',comment.value));card.append(comment,save);}
  return card;
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
  const sources=(data.sources||[]).map(source=>({...source,status:statusByName.get(source.name)?.status||source.availability||'not_checked'})).sort(compareSourcesByAvailabilityAndName);
  const badges=$('sources');badges.replaceChildren();
  for(const source of sources)badges.append(element('span',`source ${source.status}`,`${source.name} · ${source.status==='ok'?'Verified':source.status==='unavailable'?'Unavailable':'Not verified'}`));
  $('networkSummary').textContent=`${sources.length} Teaching sources · ${sources.filter(source=>source.status==='ok').length} with verified postings`;
  const sites=$('sites');sites.replaceChildren();
  for(const source of sources){const row=element('div','site'),body=element('div');body.append(element('strong','',source.name),element('small','',source.type==='shared-source'?'General source':'Teaching source'));const link=element('a','','Open source');link.href=source.url;link.target='_blank';link.rel='noopener noreferrer';row.append(body,link);sites.append(row);}
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
async function load(){data=await request('/api/user-space/teaching-overview');$('location').value=data.targetRegion?.match(/Stuttgart/i)?'Stuttgart':data.targetRegion||'Stuttgart';const searches=$('savedSearch');searches.replaceChildren(option('','Saved searches'));for(const saved of data.savedSearches||[])searches.append(option(saved.id,saved.name));setMessage(`${data.databaseStats?.total||0} Teaching records · ${data.sources?.length||0} sources`);render();}

async function refresh(){const button=$('refresh');button.disabled=true;setMessage('Checking exact Teaching posting pages. Your saved results remain available…');try{const result=await request('/api/user-space/teaching-refresh',{method:'POST',body:JSON.stringify({query:$('query').value,location:$('location').value})});data={...data,...result};setMessage(`${result.verified} exact postings verified across ${result.checked} Teaching sources.`);render();}catch(error){setMessage(error.message,true);}finally{button.disabled=false;}}

function criteria(){return Object.fromEntries(filterIds.map(id=>[id,$(id).value]));}
function restore(values){for(const id of filterIds)if(Object.hasOwn(values,id))$(id).value=String(values[id]??'');render();}

function bind(){
  for(const id of filterIds)$(id).addEventListener(id==='search'||id==='query'||id==='company'||id==='location'?'input':'change',render);
  $('refresh').addEventListener('click',refresh);
  $('clear').addEventListener('click',()=>{restore({query:'',location:'',company:'',sourceSelect:'',applicationStatus:'',workType:'',model:'',freshness:'',search:'',sort:'priority'});});
  $('savedSearch').addEventListener('change',()=>{const saved=data.savedSearches.find(item=>item.id===$('savedSearch').value);if(saved)restore(saved.criteria);});
  $('saveSearch').addEventListener('click',async()=>{const name=prompt('Name this Teaching search:');if(!name)return;try{const result=await request('/api/user-space/teaching-saved-searches',{method:'POST',body:JSON.stringify({name,criteria:criteria()})});data.savedSearches=[...data.savedSearches.filter(item=>item.id!==result.search.id),result.search];$('savedSearch').append(option(result.search.id,result.search.name));$('savedSearch').value=result.search.id;setMessage('Teaching search saved in its own database.');}catch(error){setMessage(error.message,true);}});
  $('deleteSearch').addEventListener('click',async()=>{const id=$('savedSearch').value;if(!id)return;try{await request(`/api/user-space/teaching-saved-searches?id=${encodeURIComponent(id)}`,{method:'DELETE'});data.savedSearches=data.savedSearches.filter(item=>item.id!==id);$('savedSearch').querySelector(`option[value="${CSS.escape(id)}"]`)?.remove();$('savedSearch').value='';setMessage('Teaching search removed.');}catch(error){setMessage(error.message,true);}});
  for(const choice of ['list','board'])$(`${choice}View`).addEventListener('click',()=>{view=choice;localStorage.setItem('alex-teaching-view',choice);render();});
  $('themeToggle').addEventListener('click',()=>{const next=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=next;localStorage.setItem('alex-teaching-theme',next);});
  $('mobileFilters').addEventListener('click',()=>$('filters').scrollIntoView({behavior:'smooth'}));$('mobileResults').addEventListener('click',()=>$('results').scrollIntoView({behavior:'smooth'}));$('mobileBoard').addEventListener('click',()=>{view='board';render();$('jobs').scrollIntoView({behavior:'smooth'});});$('mobileRefresh').addEventListener('click',refresh);
}

document.documentElement.dataset.theme=localStorage.getItem('alex-teaching-theme')||'dark';
const session=await request('/api/user-space/session');
if(!session.authenticated)location.assign('/');
else{csrfToken=session.csrfToken;bind();load().catch(error=>setMessage(error.message,true));}
