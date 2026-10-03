import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createChromeDevtoolsClient, chromeDevtoolsInternals } from './chrome-devtools-client.mjs';

const FINAL=/\b(?:submit|send application|submit application|application abschicken|bewerbung absenden|bewerbung einreichen|jetzt verbindlich bewerben)\b/i;
const ADVANCE=/\b(?:next|continue|weiter|fortfahren|proceed)\b/i;
const START=/\b(?:apply now|apply for this job|jetzt bewerben|online bewerben|zur bewerbung|bewerben)\b/i;
const LOGIN=/\b(?:sign in|log in|anmelden|einloggen|password|passwort)\b/i;
const chromePath=['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'].find(existsSync);

function normal(value='') { return String(value).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,''); }
export function fieldKindForHint(value='') {
  const hint=normal(value);
  if(/legal.?first.?name|legal.?given.?name|amtlich(?:er|e).?vorname|rechtlich(?:er|e).?vorname/.test(hint)) return 'legalFirstName';
  if(/first.?name|given.?name|vorname/.test(hint)) return 'firstName';
  if(/last.?name|family.?name|surname|nachname/.test(hint)) return 'lastName';
  if(/full.?name|vorname.?nachname|ihr.?name|^name$/.test(hint.trim())) return 'name';
  if(/e.?mail/.test(hint)) return 'email';
  if(/phone|telefon|mobile|mobil/.test(hint)) return 'phone';
  if(/house.?number|hausnummer|haus.?nr/.test(hint)) return 'houseNumber';
  if(/postal|post.?code|zip|\bplz\b/.test(hint)) return 'postalCode';
  if(/street|straße|strasse/.test(hint)) return 'street';
  if(/country|land/.test(hint)) return 'country';
  if(/city|stadt|\bort\b/.test(hint)) return 'city';
  if(/full.?address|anschrift|adresse|address/.test(hint)) return 'address';
  if(/location|standort|wohnort/.test(hint)) return 'location';
  if(/linkedin/.test(hint)) return 'linkedin';
  if(/github/.test(hint)) return 'github';
  if(/work.?auth|arbeitserlaubnis|work.?permit/.test(hint)) return 'authorisation';
  if(/salutation|title|anrede/.test(hint)) return 'salutation';
  if(/nationality|citizenship|staatsangehorigkeit|nationalitat/.test(hint)) return 'nationality';
  if(/date.?of.?birth|birth.?date|dob|geburtsdatum/.test(hint)) return 'birthDate';
  if(/highest.?qualification|degree|education|abschluss|hochster.?abschluss/.test(hint)) return 'highestQualification';
  if(/driving.?licen[cs]e|fuhrerschein/.test(hint)) return 'drivingLicence';
  if(/relocat|umzug|umzugsbereitschaft/.test(hint)) return 'relocation';
  if(/business.?travel|travel.?willing|reisebereitschaft|dienstreise/.test(hint)) return 'businessTravel';
  if(/visa.?sponsor|sponsorship/.test(hint)) return 'sponsorshipRequired';
  if(/residence.?permit|immigration.?status|aufenthaltstitel|niederlassungserlaubnis/.test(hint)) return 'residencePermit';
  if(/salary|gehalt|compensation/.test(hint)) return 'salary';
  if(/start.?date|available.?from|availability|eintritt|beginn|verfügbar|kuendigung|kündigung/.test(hint)) return 'startDate';
  if(/anmerkung|comment|additional.?information|nachricht|message|motivation|anschreiben/.test(hint)) return 'notes';
  return '';
}
function isLegalConsentHint(value='') { return /privacy|datenschutz|terms|bedingungen|consent|einwillig|agreement|agb|data.?processing/.test(normal(value)); }
function applicationCandidateScore({text='',href=''}={}) {
  const label=normal(text), target=normal(href);
  if(/mailto:|tel:|javascript:/.test(target)||/privacy|datenschutz|terms|agb|impressum|unsubscribe|share|facebook|linkedin|twitter/.test(`${label} ${target}`)) return -100;
  if(FINAL.test(label)) return -100;
  let score=0;
  if(START.test(label)) score+=80;
  if(/jetzt bewerben|apply now|start application|bewerbung starten/.test(label)) score+=35;
  if(/\/(?:apply|application|bewerbung|career|jobs?)(?:[/?#]|$)/.test(target)) score+=30;
  if(/continue application|bewerbung fortsetzen/.test(label)) score+=20;
  return score;
}
function fileKindForHint(value='') {
  const hint=normal(value);
  if(/weitere\s+(?:dokumente?|anlagen?)|zusatzdokumente?|additional\s+(?:documents?|attachments?)|other\s+documents?|supporting\s+documents?|attachments?/.test(hint)) return '';
  if(/cover|letter|anschreiben|motivationsschreiben/.test(hint)) return 'letter';
  if(/resume|curriculum|lebenslauf|\bcv\b/.test(hint)) return 'cv';
  return 'cv';
}
function nextUploadKind(value='', uploadedFileKinds=new Set()) {
  const kind=fileKindForHint(value);
  if(kind) return uploadedFileKinds.has(kind)?'':kind;
  if(!uploadedFileKinds.has('cv')) return 'cv';
  return uploadedFileKinds.has('letter')?'':'letter';
}
function applicationNote(job,lang,name,startAvailability) {
  const text=normal(`${job.title||''} ${job.description||''}`);
  const focus=/(?:microsoft 365|m365|intune|entra|active directory|modern workplace)/.test(text)
    ? {de:'Meine praktische Erfahrung mit Microsoft 365, Intune, Entra ID und Active Directory passt besonders gut zu den beschriebenen Aufgaben.',en:'My practical experience with Microsoft 365, Intune, Entra ID and Active Directory aligns particularly well with the described responsibilities.'}
    : /(?:azure|hybrid cloud|cloud infrastructure)/.test(text)
      ? {de:'Meine Erfahrung mit Azure, hybrider Infrastruktur sowie Windows- und Linux-Betrieb passt besonders gut zu dieser Position.',en:'My experience with Azure, hybrid infrastructure, and Windows and Linux operations aligns particularly well with this position.'}
      : /(?:linux|vmware|virtuali|server|infrastruktur|infrastructure)/.test(text)
        ? {de:'Meine langjährige Erfahrung im Windows-, Linux-, VMware- und Infrastruktur-Betrieb passt besonders gut zu dieser Position.',en:'My extensive experience in Windows, Linux, VMware, and infrastructure operations aligns particularly well with this position.'}
        : {de:'Meine nachgewiesene Erfahrung im IT-Infrastruktur- und Systembetrieb passt gut zu den beschriebenen Aufgaben.',en:'My verified experience in IT infrastructure and systems operations aligns well with the described responsibilities.'};
  return lang==='de'
    ? `Guten Tag, ich bewerbe mich mit großem Interesse auf die Position ${job.title} bei ${job.company}. ${focus.de} ${startAvailability} Freundliche Grüße, ${name}`
    : `Hello, I am very interested in the ${job.title} position at ${job.company}. ${focus.en} ${startAvailability} Kind regards, ${name}`;
}
export function websiteApplyInternals() { return { FINAL, ADVANCE, START, LOGIN, fieldKindForHint, fileKindForHint, nextUploadKind, applicationNote, applicationCandidateScore, isLegalConsentHint }; }

export function createWebsiteApplyAgent({ workspace, coverLetters, profile, onEvent=()=>{}, onBusyChange=async()=>{}, chromeClient=null }) {
  const sessions=new Map(), chrome=chromeClient||createChromeDevtoolsClient({cwd:process.cwd()}); let busyCount=0;
  const { uploadUid }=chromeDevtoolsInternals();
  async function browserContext() {
    if(!chromePath) throw new Error('Google Chrome is not installed in a supported location on this computer');
    try { await chrome.start(); return chrome; }
    catch(error) { throw new Error(`Chrome connection needs approval. In the normal Chrome window click Allow when prompted, then retry. ${error.message}`); }
  }
  const publicSession=session=>session ? {id:session.id,jobId:session.jobId,status:session.status,message:session.message,startedAt:session.startedAt,updatedAt:session.updatedAt,steps:session.steps,browser:'Existing Google Chrome Default profile on this computer'} : null;
  function set(session,status,message) { const changed=session.status!==status||session.message!==message; session.status=status; session.message=message; session.updatedAt=new Date().toISOString(); if(changed) onEvent({action:`website_apply.${status}`,result:status==='failed'?'error':'ok',jobId:session.jobId,detail:message}); return publicSession(session); }
  async function busy(operation) {
    busyCount+=1;
    if(busyCount===1) await onBusyChange(true);
    try { return await operation(); }
    finally {
      busyCount=Math.max(0,busyCount-1);
      if(busyCount===0) await onBusyChange(false);
    }
  }
  async function pageExists(pageId) { return (await chrome.pages()).some(page=>page.id===pageId); }
  async function snapshot(pageId) {
    return chrome.evaluate(pageId,`()=>{const visible=node=>Boolean(node&&(node.offsetWidth||node.offsetHeight||node.getClientRects().length));const controls=[...document.querySelectorAll('button,input[type="submit"],input[type="button"]')].filter(visible);return{text:document.body?.innerText?.slice(0,30000)||'',password:Boolean(document.querySelector('input[type="password"]')),captcha:Boolean(document.querySelector('iframe[src*="captcha" i],[class*="captcha" i],[id*="captcha" i]')),final:controls.some(el=>/submit|send application|submit application|application abschicken|bewerbung absenden|bewerbung einreichen|jetzt verbindlich bewerben/i.test((el.innerText||el.value||'').trim())),url:location.href,title:document.title};}`);
  }
  async function fill(pageId,values,files,uploadedFileKinds) {
    const payload=JSON.stringify(values),uploaded=JSON.stringify([...uploadedFileKinds]);
    const result=await chrome.evaluate(pageId,`()=>{const values=${payload},uploaded=new Set(${uploaded});const normal=${normal.toString()};const fieldKindForHint=${fieldKindForHint.toString()};const fileKindForHint=${fileKindForHint.toString()};const nextUploadKind=${nextUploadKind.toString()};const isLegalConsentHint=${isLegalConsentHint.toString()};const hint=el=>{const label=el.id?document.querySelector('label[for="'+CSS.escape(el.id)+'"]')?.innerText:'';return[label,el.closest('label')?.innerText,el.parentElement?.innerText,el.name,el.id,el.placeholder,el.getAttribute('aria-label'),el.autocomplete].filter(Boolean).join(' ').slice(0,1000)};const setValue=(el,value)=>{const proto=el instanceof HTMLSelectElement?HTMLSelectElement.prototype:el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;const setter=Object.getOwnPropertyDescriptor(proto,'value')?.set;setter?setter.call(el,value):el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))};const assigned=[];for(const control of document.querySelectorAll('input:not([type="hidden"]):not([type="password"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"]),textarea,select')){if(control.disabled||String(control.value||'').trim())continue;const text=hint(control),kind=fieldKindForHint(text);if(!kind||!values[kind])continue;let value=values[kind];if(kind==='phone'&&/ohne\\s*(?:0|landes)|without\\s*(?:0|country)/i.test(text))value=values.phoneSubscriber;else if(kind==='phone'&&/(?:^|\\D)0\\s*1\\d{2}/.test(text))value=values.phoneNational;if(kind==='startDate'&&control.type==='date')value=values.startDateIso;if(kind==='birthDate'&&control.type==='date')value=values.birthDateIso;if(control instanceof HTMLSelectElement){const wanted=[value,values.countryAlt].filter(Boolean).map(normal);const option=[...control.options].find(item=>wanted.some(candidate=>normal(item.textContent)===candidate||normal(item.textContent).includes(candidate)));if(!option)continue;value=option.value}setValue(control,value);assigned.push(kind)}for(const radio of document.querySelectorAll('input[type="radio"]')){if(radio.disabled||radio.checked)continue;const text=hint(radio);if(isLegalConsentHint(text))continue;const kind=fieldKindForHint(text),wanted=normal(values[kind]||'');if(!kind||!wanted)continue;const option=normal([radio.value,radio.getAttribute('aria-label'),text].filter(Boolean).join(' '));const matches=option.includes(wanted)||(/^(?:no|nein)$/.test(wanted)&&/\\b(?:no|nein)\\b/.test(option))||(/^(?:yes|ja)$/.test(wanted)&&/\\b(?:yes|ja)\\b/.test(option));if(matches){radio.click();assigned.push(kind)}}const uploads=[];for(const input of document.querySelectorAll('input[type="file"]')){const text=hint(input),kind=nextUploadKind(text,uploaded);if(!kind)continue;const label='alex-'+kind+'-pdf-upload';input.setAttribute('aria-label',label);uploads.push({kind,label,multiple:Boolean(input.multiple)});if(kind==='cv'&&input.multiple&&!uploaded.has('letter'))uploads[uploads.length-1].includeLetter=true}return{assigned:[...new Set(assigned)],uploads};}`);
    for(const upload of result.uploads||[]) {
      if(uploadedFileKinds.has(upload.kind)) continue;
      const tree=await chrome.tool('take_snapshot',{pageId,verbose:true}),uid=uploadUid(tree,upload.label); if(!uid) continue;
      const paths=upload.includeLetter?[files.cv,files.letter]:[upload.kind==='letter'?files.letter:files.cv];
      await chrome.tool('upload_file',{pageId,uid,filePaths:paths});
      uploadedFileKinds.add(upload.kind); result.assigned.push(`${upload.kind} PDF`);
      if(upload.includeLetter){uploadedFileKinds.add('letter');result.assigned.push('letter PDF');}
    }
    return [...new Set(result.assigned||[])];
  }
  async function requiredUnknowns(pageId) {
    return chrome.evaluate(pageId,`()=>[...document.querySelectorAll('input:required:not([type="file"]),textarea:required,select:required')].filter(el=>!el.disabled&&((el.type==='checkbox'||el.type==='radio'?!el.checked:!String(el.value||'').trim())||!el.checkValidity())).map(el=>{const label=el.id?document.querySelector('label[for="'+CSS.escape(el.id)+'"]')?.innerText:'';return(label||el.getAttribute('aria-label')||el.placeholder||el.name||el.id||'required field').replace(/\\s+/g,' ').trim()}).slice(0,6)`);
  }
  async function dismissCookieBanner(pageId) {
    return chrome.evaluate(pageId,`()=>{const controls=[...document.querySelectorAll('[id*="cookie" i] button,[class*="cookie" i] button,[aria-label*="cookie" i] button,[id*="consent" i] button,[class*="consent" i] button,#onetrust-banner-sdk button')];for(const matcher of[/^(?:reject all|decline|necessary only|nur notwendige|alle ablehnen|ablehnen)$/i,/^(?:accept all|allow all|alle akzeptieren|akzeptieren|zustimmen)$/i])for(const control of controls){const text=(control.innerText||control.getAttribute('aria-label')||'').trim();if(matcher.test(text)&&(control.offsetWidth||control.offsetHeight||control.getClientRects().length)&&!control.disabled){control.click();return true}}return false}`);
  }
  async function navigateToApplication(session) {
    if(session.navigationCount>=8) return false;
    await dismissCookieBanner(session.pageId);
    const candidate=await chrome.evaluate(session.pageId,`()=>{const normal=${normal.toString()};const score=${applicationCandidateScore.toString()};const nodes=[...document.querySelectorAll('a[href],button,input[type="button"],input[type="submit"],[role="button"]')];const candidates=nodes.map(node=>({node,text:(node.innerText||node.value||node.getAttribute('aria-label')||'').trim(),href:node.href||'',disabled:Boolean(node.disabled),visible:Boolean(node.offsetWidth||node.offsetHeight||node.getClientRects().length)})).filter(item=>item.visible&&!item.disabled).map(item=>({...item,score:score(item)})).filter(item=>item.score>0).sort((a,b)=>b.score-a.score);const chosen=candidates[0];if(!chosen)return null;if(!chosen.href)chosen.node.setAttribute('aria-label','alex-application-target');return{text:chosen.text,href:chosen.href||'',label:chosen.href?'':'alex-application-target'}}`); if(!candidate) return false;
    session.navigationCount+=1;
    set(session,'opening_application',`Following application step ${session.navigationCount} in Google Chrome…`);
    if(candidate.href) {
      const current=await snapshot(session.pageId),destination=new URL(candidate.href,current.url).href;
      if(session.visitedUrls.has(destination)) return false;
      session.visitedUrls.add(destination);
      await chrome.tool('navigate_page',{pageId:session.pageId,type:'url',url:destination,timeout:45000});
    } else {
      const before=new Set((await chrome.pages()).map(page=>page.id)),tree=await chrome.tool('take_snapshot',{pageId:session.pageId,verbose:true}),uid=uploadUid(tree,candidate.label); if(!uid) return false;
      await chrome.tool('click',{pageId:session.pageId,uid,includeSnapshot:false});
      const pages=await chrome.pages(),created=pages.find(page=>!before.has(page.id)); if(created){session.pageId=created.id;session.visitedUrls.add(created.url);await chrome.tool('select_page',{pageId:created.id,bringToFront:true});}
    }
    await chrome.tool('select_page',{pageId:session.pageId,bringToFront:true}); return true;
  }
  async function advance(pageId) {
    const marked=await chrome.evaluate(pageId,`()=>{const control=[...document.querySelectorAll('button:not([type="submit"]),input[type="button"],a[role="button"]')].find(el=>/\\b(?:next|continue|weiter|fortfahren|proceed)\\b/i.test((el.innerText||el.value||'').trim())&&!/\\b(?:submit|send application|submit application|application abschicken|bewerbung absenden|bewerbung einreichen|jetzt verbindlich bewerben)\\b/i.test((el.innerText||el.value||'').trim())&&!el.disabled&&(el.offsetWidth||el.offsetHeight||el.getClientRects().length));if(!control)return false;control.setAttribute('aria-label','alex-advance-target');return true}`); if(!marked)return false;
    const tree=await chrome.tool('take_snapshot',{pageId,verbose:true}),uid=uploadUid(tree,'alex-advance-target'); if(!uid)return false; await chrome.tool('click',{pageId,uid,includeSnapshot:false}); return true;
  }
  async function drive(session) {
    if(!session||session.running||!session.files||['submitted','ready_for_final_confirmation','closed','failed'].includes(session.status)) return;
    return busy(async()=>{
      if(!await pageExists(session.pageId)) { clearInterval(session.timer); return set(session,'closed','The Google Chrome application tab was closed before submission.'); }
      session.running=true;
      try {
        await dismissCookieBanner(session.pageId);
        const state=await snapshot(session.pageId);
        if(state.captcha) return set(session,'waiting_for_login','Complete the CAPTCHA in Google Chrome; the agent will continue automatically.');
        if(state.password||(LOGIN.test(state.text)&&!/application|bewerbung/i.test(state.text))) return set(session,'waiting_for_login','Complete sign-in in Google Chrome; the agent will continue automatically.');
        const fields=await fill(session.pageId,session.values,session.files,session.uploadedFileKinds), unknowns=await requiredUnknowns(session.pageId), refreshed=await snapshot(session.pageId);
        if(refreshed.final) return set(session,'ready_for_final_confirmation',unknowns.length?`Review required fields in Chrome before final submission: ${unknowns.join(', ')}.`:'Form and two PDFs are ready. Review Google Chrome and confirm final submission in Alex Job.');
        if(unknowns.length) return set(session,'needs_review',`Complete these unknown required fields in Google Chrome: ${unknowns.join(', ')}. The agent will continue afterward.`);
        let moved=await advance(session.pageId);
        if(!moved) moved=await navigateToApplication(session);
        session.steps+=1; set(session,moved?'advancing':'needs_review',moved?`Completed or opened application step ${session.steps}; continuing automatically.`:`Filled ${fields.length} recognised item(s). Review Google Chrome for a site-specific question or control.`);
      } catch(error) { clearInterval(session.timer); set(session,'failed',`Browser agent paused: ${error.message}`); } finally { session.running=false; }
    });
  }
  async function attach(jobId,job,applicationPackage,language='de') {
    return busy(async()=>{ const session=sessions.get(jobId); if(!session||!await pageExists(session.pageId)) throw new Error('The Google Chrome application tab is no longer open');
    const lang=['de','en'].includes(language)?language:'de', cv=await coverLetters.download(job,lang,'pdf','cv',applicationPackage.currentVersion), letter=await coverLetters.download(job,lang,'pdf','coverLetter',applicationPackage.currentVersion);
    const form=profile.applicationForm||{}, applicantName=`${form.firstName||'Candidate'} ${form.lastName||''}`.trim(), startDate=new Date(); startDate.setMonth(startDate.getMonth()+3);
    const notes=applicationNote(job,lang,applicantName,form.startAvailability?.[lang]||'');
    session.files={cv:cv.path,letter:letter.path};
    session.values={name:applicantName,firstName:form.firstName||'',legalFirstName:form.legalFirstName||form.firstName||'',lastName:form.lastName||'',salutation:form.salutation?.[lang]||'',nationality:form.nationality?.[lang]||'',birthDate:form.birthDateDisplay?.[lang]||form.birthDate||'',birthDateIso:form.birthDate||'',highestQualification:form.highestQualification?.[lang]||'',drivingLicence:form.drivingLicence||'',relocation:form.relocation?.[lang]||'',businessTravel:form.businessTravel?.[lang]||'',sponsorshipRequired:form.sponsorshipRequired?.[lang]||'',residencePermit:form.residencePermit?.[lang]||'',email:profile.identity.email,phone:form.phoneInternational||profile.identity.phone,phoneNational:form.phoneNational||'',phoneSubscriber:form.phoneSubscriber||'',address:form.address||profile.identity.location,street:form.street||'',houseNumber:form.houseNumber||'',postalCode:form.postalCode||'',city:form.city||'',country:form.country?.[lang]||'',countryAlt:form.country?.[lang==='de'?'en':'de']||'',location:profile.identity.location,linkedin:profile.identity.linkedin,github:profile.identity.github,authorisation:profile.identity.workAuthorisation[lang],salary:lang==='de'?'80.000 EUR brutto pro Jahr, verhandelbar':'EUR 80,000 gross per year, negotiable',startDate:form.startAvailability?.[lang]||'',startDateIso:startDate.toISOString().slice(0,10),notes};
    set(session,'preparing_form','Two reviewed PDF files are ready. Filling the website form in Google Chrome now…'); session.timer=setInterval(()=>drive(session),2000); session.timer.unref?.(); await drive(session); return publicSession(session); });
  }
  async function start(job,applicationPackage=null,language='de') {
    return busy(async()=>{ if(!/^https?:\/\//i.test(String(job.url||''))) throw new Error('An exact application URL is required');
    await browserContext(); const page=await chrome.newPage(job.url); if(!page) throw new Error('Chrome did not return the new application tab');
    const session={id:randomUUID(),jobId:job.id,pageId:page.id,status:'opening',message:'Opening the exact advert in Google Chrome Default profile on this computer…',startedAt:new Date().toISOString(),updatedAt:new Date().toISOString(),steps:0,navigationCount:0,visitedUrls:new Set([job.url]),running:false,files:null,values:{},uploadedFileKinds:new Set(),timer:null};
    sessions.set(job.id,session); if(applicationPackage) return attach(job.id,job,applicationPackage,language); set(session,'scanning_advert','Exact advert opened in the normal Chrome profile. Reading its complete rendered description and application controls…'); return publicSession(session); });
  }
  async function posting(jobId) {
    return busy(async()=>{ const session=sessions.get(jobId); if(!session||!await pageExists(session.pageId)) throw new Error('The Google Chrome application tab is no longer open');
    const result=await chrome.evaluate(session.pageId,`async()=>{window.scrollTo(0,document.body.scrollHeight);await new Promise(resolve=>setTimeout(resolve,500));return{text:(document.body?.innerText||'').replace(/\\s+/g,' ').trim(),html:document.documentElement?.outerHTML||'',url:location.href,title:document.title}}`);
    const emails=result.html.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)?.join(' ')||''; return {...result,text:`${result.text} ${emails}`.trim(),source:'exact posting rendered in Google Chrome',retrievedAt:new Date().toISOString(),complete:result.text.length>=900}; });
  }
  async function prepareVisibleForm(jobId) { return busy(async()=>{ const session=sessions.get(jobId); if(!session||!await pageExists(session.pageId)) throw new Error('The Google Chrome application tab is no longer open'); return navigateToApplication(session); }); }
  function fail(jobId,error) { const session=sessions.get(jobId); if(session) { clearInterval(session.timer); return set(session,'failed',`Website application preparation failed: ${error.message}`); } }
  async function confirmSubmit(jobId) {
    return busy(async()=>{ const session=sessions.get(jobId); if(!session||session.status!=='ready_for_final_confirmation') throw new Error('The browser agent is not waiting at final submission');
    const marked=await chrome.evaluate(session.pageId,`()=>{const control=[...document.querySelectorAll('button,input[type="submit"],input[type="button"]')].find(el=>/\\b(?:submit|send application|submit application|application abschicken|bewerbung absenden|bewerbung einreichen|jetzt verbindlich bewerben)\\b/i.test((el.innerText||el.value||'').trim())&&!el.disabled&&(el.offsetWidth||el.offsetHeight||el.getClientRects().length));if(!control)return false;control.setAttribute('aria-label','alex-final-submit-target');return true}`); if(!marked) throw new Error('The final submit control is no longer available. Review Google Chrome, then resume the agent.');
    const tree=await chrome.tool('take_snapshot',{pageId:session.pageId,verbose:true}),uid=uploadUid(tree,'alex-final-submit-target'); if(!uid) throw new Error('The final submit control could not be verified. Review Google Chrome, then resume the agent.'); await chrome.tool('click',{pageId:session.pageId,uid,includeSnapshot:false}); clearInterval(session.timer); set(session,'submitted','Final application submission was confirmed and sent from the website.'); return publicSession(session); });
  }
  async function close() {
    for(const session of sessions.values()) clearInterval(session.timer);
    // Detach the local agent bridge without closing any tab in the user's
    // normal Chrome Default profile.
    await chrome.close();
  }
  return { start,attach,posting,prepareVisibleForm,fail,confirmSubmit,close,status:jobId=>publicSession(sessions.get(jobId)),drive:jobId=>drive(sessions.get(jobId)) };
}
