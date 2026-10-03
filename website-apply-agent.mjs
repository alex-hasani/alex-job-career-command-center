import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { chromeDevtoolsInternals } from './chrome-devtools-client.mjs';
import { createChromeHelperClient } from './chrome-helper-client.mjs';

const FINAL=/\b(?:submit|send application|submit application|application abschicken|bewerbung absenden|bewerbung einreichen|jetzt verbindlich bewerben|envoyer (?:la )?candidature|invia(?:re)? (?:la )?candidatura|enviar (?:la )?(?:solicitud|candidatura))\b/i;
const ADVANCE=/\b(?:next|continue|weiter|fortfahren|proceed|save and continue|speichern und weiter|lebenslauf hochladen|cv hochladen|resume upload|upload resume|upload cv|suivant|continuer|volgende|doorgaan|siguiente|continuar|avanti|prosegui|dalej)\b/i;
const START=/\b(?:apply now|apply for this job|start application|auf diese stelle bewerben|jetzt bewerben|online bewerben|zur bewerbung|bewerben|bewirb dich|bewerbung starten|postuler|candidater|solliciteer|solicitar|candidati|candidatura|aplikuj|ansök)\b/i;
const LOGIN=/\b(?:sign in|log in|anmelden|einloggen|password|passwort)\b/i;
const chromePath=['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'].find(existsSync);

function normal(value='') { return String(value).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,''); }
function deepElements(selector) {
  const found=[];
  const visit=root=>{
    found.push(...root.querySelectorAll(selector));
    for(const node of root.querySelectorAll('*')) if(node.shadowRoot) visit(node.shadowRoot);
  };
  visit(document);
  return [...new Set(found)];
}
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
  if(/(?:eu|european union).{0,20}(?:work|arbeits).{0,12}(?:permit|genehmigung|erlaubnis)|(?:work|arbeits).{0,12}(?:permit|genehmigung|erlaubnis).{0,20}(?:eu|european union)/.test(hint)) return 'euWorkPermit';
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
  if(/(?:minimum|min(?:destens)?).{0,28}(?:hours?|stunden).{0,16}(?:week|woche)|(?:hours?|stunden).{0,16}(?:week|woche).{0,28}(?:minimum|min(?:destens)?)/.test(hint)) return 'weeklyHoursMin';
  if(/(?:maximum|max(?:imal)?|hochstens).{0,28}(?:hours?|stunden).{0,16}(?:week|woche)|(?:hours?|stunden).{0,16}(?:week|woche).{0,28}(?:maximum|max(?:imal)?|hochstens)/.test(hint)) return 'weeklyHoursMax';
  if(/commut|pendel|ins buro kommen|ins buero kommen|office.{0,20}(?:travel|come|get)/.test(hint)) return 'commute';
  if(/(?:salary|gehalt).{0,30}(?:negotiable|verhandelbar)|(?:negotiable|verhandelbar).{0,30}(?:salary|gehalt)/.test(hint)) return 'salaryNegotiable';
  if(/(?:german|deutsch).{0,20}(?:level|kenntnis|proficiency|language)|(?:level|kenntnis|proficiency).{0,20}(?:german|deutsch)/.test(hint)) return 'germanLevel';
  if(/(?:english|englisch).{0,20}(?:level|kenntnis|proficiency|language)|(?:level|kenntnis|proficiency).{0,20}(?:english|englisch)/.test(hint)) return 'englishLevel';
  if(/salary|gehalt|compensation/.test(hint)) return 'salary';
  if(/start.?date|available.?from|availability|eintritt|beginn|verfügbar|kuendigung|kündigung/.test(hint)) return 'startDate';
  if(/anmerkung|comment|additional.?information|nachricht|message|motivation|anschreiben/.test(hint)) return 'notes';
  return '';
}
function isLegalConsentHint(value='') { return /privacy|datenschutz|terms|bedingungen|consent|einwillig|agreement|agb|data.?processing/.test(normal(value)); }
function applicationCandidateScore({text='',href=''}={}) {
  const label=normal(text), target=normal(href);
  // Keep this helper self-contained because it is serialized and executed in
  // the page by Chrome DevTools. Module-scoped regexes do not exist there.
  const final=/\b(?:submit|send application|submit application|application abschicken|bewerbung absenden|bewerbung einreichen|jetzt verbindlich bewerben|envoyer (?:la )?candidature|invia(?:re)? (?:la )?candidatura|enviar (?:la )?(?:solicitud|candidatura))\b/i;
  const start=/\b(?:apply|apply now|apply for this job|start application|auf diese stelle bewerben|jetzt bewerben|online bewerben|zur bewerbung|bewerben|bewirb dich|bewerbung starten|postuler|candidater|solliciteer|solicitar|candidati|candidatura|aplikuj|ansök)\b/i;
  if(/mailto:|tel:/.test(target)||/privacy|datenschutz|terms|agb|impressum|unsubscribe|share|facebook|linkedin|twitter/.test(`${label} ${target}`)) return -100;
  if(final.test(label)) return -100;
  let score=0;
  if(start.test(label)) score+=80;
  if(/auf diese stelle bewerben|jetzt bewerben|bewirb dich|apply now|start application|bewerbung starten/.test(label)) score+=35;
  if(/\/(?:apply|application|bewerbung|career|jobs?)(?:[/?#]|$)/.test(target)) score+=30;
  if(/continue application|bewerbung fortsetzen/.test(label)) score+=20;
  return score;
}
function fileKindForHint(value='') {
  const hint=normal(value);
  if(/weitere\s+(?:dokumente?|anlagen?)|zusatzdokumente?|additional\s+(?:documents?|attachments?)|other\s+documents?|supporting\s+documents?|attachments?/.test(hint)) return '';
  if(/resume|curriculum|lebenslauf|\bcv\b/.test(hint)) return 'cv';
  if(/cover|letter|anschreiben|motivationsschreiben/.test(hint)) return 'letter';
  if(/zeugnis|certificate|reference|arbeitszeugnis|employment.?reference/.test(hint)) return 'certificate';
  return '';
}
function nextUploadKind(value='', uploadedFileKinds=new Set(), availableKinds=new Set()) {
  const hint=normal(value);
  const generic=/weitere\s+(?:dokumente?|anlagen?)|zusatzdokumente?|additional\s+(?:documents?|attachments?)|other\s+documents?|supporting\s+documents?|attachments?/.test(hint);
  const explicitLetter=!generic&&/cover|letter|anschreiben|motivationsschreiben/.test(hint);
  const explicitCv=!generic&&/resume|curriculum|lebenslauf|\bcv\b/.test(hint);
  const explicitCertificate=!generic&&/zeugnis|certificate|reference|arbeitszeugnis|employment.?reference/.test(hint);
  if(explicitLetter) return uploadedFileKinds.has('letter')?'':'letter';
  if(explicitCv) return uploadedFileKinds.has('cv')?'':'cv';
  if(explicitCertificate) return uploadedFileKinds.has('certificate')?'':'certificate';
  if(!uploadedFileKinds.has('cv')) return 'cv';
  if(!availableKinds.has('letter')&&!uploadedFileKinds.has('letter')) return 'letter';
  if(!availableKinds.has('certificate')&&!uploadedFileKinds.has('certificate')) return 'certificate';
  return '';
}
function uploadKindsForHint(value='', uploadedFileKinds=new Set(), availableKinds=new Set(), multiple=false) {
  const hint=normal(value);
  const generic=/weitere\s+(?:dokumente?|anlagen?)|zusatzdokumente?|additional\s+(?:documents?|attachments?)|other\s+documents?|supporting\s+documents?|attachments?/.test(hint);
  const explicitLetter=!generic&&/cover|letter|anschreiben|motivationsschreiben/.test(hint);
  const explicitCv=!generic&&/resume|curriculum|lebenslauf|\bcv\b/.test(hint);
  const explicitCertificate=!generic&&/zeugnis|certificate|reference|arbeitszeugnis|employment.?reference/.test(hint);
  if(explicitLetter) return uploadedFileKinds.has('letter')?[]:['letter'];
  if(explicitCv) return uploadedFileKinds.has('cv')?[]:['cv'];
  if(explicitCertificate) return uploadedFileKinds.has('certificate')?[]:['certificate'];
  const kinds=[];
  if(!availableKinds.has('cv')&&!uploadedFileKinds.has('cv')) kinds.push('cv');
  if(!availableKinds.has('letter')&&!uploadedFileKinds.has('letter')) kinds.push('letter');
  if(!availableKinds.has('certificate')&&!uploadedFileKinds.has('certificate')) kinds.push('certificate');
  return multiple?kinds:kinds.slice(0,1);
}
function uploadedKindsFromPageText(value='',fileNames={}) {
  const text=normal(value);
  return new Set(Object.entries(fileNames).filter(([,fileName])=>fileName&&text.includes(normal(fileName))).map(([kind])=>kind));
}
function uniqueUploadPlans(uploads=[],files={},uploadedFileKinds=new Set(),uploadedFilePaths=new Set()) {
  const queuedKinds=new Set(uploadedFileKinds),queuedPaths=new Set(uploadedFilePaths),plans=[];
  for(const upload of uploads) {
    const kinds=(upload.kinds||[upload.kind]).filter(kind=>files[kind]&&!queuedKinds.has(kind)&&!queuedPaths.has(files[kind]));
    if(!kinds.length) continue;
    kinds.forEach(kind=>{queuedKinds.add(kind);queuedPaths.add(files[kind])});
    plans.push({...upload,kinds});
  }
  return plans;
}
function firstDayOfNextMonth(value=new Date()) {
  const date=new Date(value.getFullYear(),value.getMonth()+1,1);
  const pad=number=>String(number).padStart(2,'0');
  return {iso:`${date.getFullYear()}-${pad(date.getMonth()+1)}-01`,display:`01.${pad(date.getMonth()+1)}.${date.getFullYear()}`};
}
function scalarValueForField(kind,type,hint,values) {
  if(kind==='salary'&&(type==='number'||/nur\s*(?:zahl|ziffer)|number\s*only|digits?\s*only|numeric|ohne\s*(?:punkt|komma|wahrungszeichen|währungszeichen)/i.test(hint))) return values.salaryNumber;
  if(kind==='startDate') return type==='date'?values.startDateIso:values.startDateDisplay;
  if(kind==='birthDate'&&type==='date') return values.birthDateIso;
  return values[kind];
}
function uploadWasConfirmed(result,expectedCount) {
  const detail=result?.structuredContent||{};
  return Array.isArray(detail.files)?detail.files.length===expectedCount:detail.ok===true;
}
function captchaRequiresAction({present=false,responseValues=[],checked=false,success=false}={}) {
  return Boolean(present)&&!Boolean(checked||success||(responseValues||[]).some(value=>String(value||'').trim().length>0));
}
async function preparedFileEvidence(files={}) {
  const evidence={};
  for(const [kind,path] of Object.entries(files)) {
    const [contents,details]=await Promise.all([readFile(path),stat(path)]);
    evidence[kind]={path,name:String(path).split(/[\\/]/).pop(),size:details.size,sha256:createHash('sha256').update(contents).digest('hex')};
  }
  return evidence;
}
async function verifyPreparedFileEvidence(files={},expected={}) {
  const actual=await preparedFileEvidence(files);
  for(const kind of Object.keys(expected)) {
    if(!actual[kind]||actual[kind].path!==expected[kind].path||actual[kind].name!==expected[kind].name||actual[kind].size!==expected[kind].size||actual[kind].sha256!==expected[kind].sha256) throw new Error(`The prepared ${kind} PDF changed after this job package was created`);
  }
  return actual;
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
export function websiteApplyInternals() { return { FINAL, ADVANCE, START, LOGIN, fieldKindForHint, fileKindForHint, nextUploadKind, uploadKindsForHint, uploadedKindsFromPageText, uniqueUploadPlans, firstDayOfNextMonth, scalarValueForField, uploadWasConfirmed, captchaRequiresAction, preparedFileEvidence, verifyPreparedFileEvidence, applicationNote, applicationCandidateScore, isLegalConsentHint }; }

export function createWebsiteApplyAgent({ workspace, coverLetters, profile, onEvent=()=>{}, onBusyChange=async()=>{}, chromeClient=null }) {
  const sessions=new Map(), chrome=chromeClient||createChromeHelperClient(); let busyCount=0;
  const { uploadUid }=chromeDevtoolsInternals();
  async function browserContext() {
    if(!chromePath) throw new Error('Google Chrome is not installed in a supported location on this computer');
    try { await chrome.start(); return chrome; }
    catch(error) { throw new Error('The normal-profile Chrome helper is not connected. '+error.message); }
  }
  const publicSession=session=>session ? {id:session.id,jobId:session.jobId,status:session.status,message:session.message,startedAt:session.startedAt,updatedAt:session.updatedAt,steps:session.steps,browser:'Existing Google Chrome Default profile on this computer'} : null;
  function set(session,status,message) { const changed=session.status!==status||session.message!==message; session.status=status; session.message=message; session.updatedAt=new Date().toISOString(); if(changed) onEvent({action:`website_apply.${status}`,result:status==='failed'?'error':'ok',jobId:session.jobId,detail:message}); return publicSession(session); }
  async function busy(operation) {
    busyCount+=1;
    if(busyCount===1) {
      try { await onBusyChange(true); }
      catch(error) { onEvent({action:'website_apply.busy_state',result:'error',detail:error.message}); }
    }
    try { return await operation(); }
    finally {
      busyCount=Math.max(0,busyCount-1);
      if(busyCount===0) {
        try { await onBusyChange(false); }
        catch(error) { onEvent({action:'website_apply.busy_state',result:'error',detail:error.message}); }
      }
    }
  }
  async function pageExists(pageId) { return (await chrome.pages()).some(page=>page.id===pageId); }
  async function evaluateFrames(pageId,code) {
    if(typeof chrome.evaluateFrames==='function') return chrome.evaluateFrames(pageId,code);
    return [{frameId:0,result:await chrome.evaluate(pageId,code)}];
  }
  async function snapshot(pageId) {
    const frames=await evaluateFrames(pageId,`()=>{const visible=node=>Boolean(node&&(node.offsetWidth||node.offsetHeight||node.getClientRects().length));const controls=[...document.querySelectorAll('button,input[type="submit"],input[type="button"],[role="button"]')].filter(visible);const formFields=[...document.querySelectorAll('input:not([type="hidden"]):not([type="password"]):not([type="submit"]):not([type="button"]),textarea,select')].filter(visible);const captchaNodes=[...document.querySelectorAll('iframe[src*="captcha" i],iframe[src*="recaptcha" i],iframe[src*="hcaptcha" i],iframe[src*="turnstile" i],[class*="captcha" i],[id*="captcha" i],[class*="turnstile" i],[id*="turnstile" i]')];const captchaResponses=[...document.querySelectorAll('textarea[name="g-recaptcha-response"],textarea[name="h-captcha-response"],input[name="cf-turnstile-response"],input[name="frc-captcha-solution"],[data-hcaptcha-response]')].map(node=>node.value||node.getAttribute('data-hcaptcha-response')||'');const captchaChecked=Boolean(document.querySelector('.recaptcha-checkbox-checked,.frc-success,.frc-captcha--solution,[class*="captcha" i] [aria-checked="true"],[class*="turnstile" i] [aria-checked="true"]'));const captchaSuccess=Boolean(document.querySelector('[data-captcha-valid="true"],[data-captcha-verified="true"]'));return{text:document.body?.innerText?.slice(0,30000)||'',formFields:formFields.length,password:[...document.querySelectorAll('input[type="password"]')].some(visible),captchaPresent:captchaNodes.some(visible)||captchaResponses.length>0,captchaResponses,captchaChecked,captchaSuccess,final:controls.some(el=>/submit|send application|submit application|application abschicken|bewerbung absenden|bewerbung einreichen|jetzt verbindlich bewerben|envoyer (?:la )?candidature|invia(?:re)? (?:la )?candidatura|enviar (?:la )?(?:solicitud|candidatura)/i.test((el.innerText||el.textContent||el.value||el.getAttribute('aria-label')||el.getAttribute('title')||'').trim())),url:location.href,title:document.title};}`);
    const states=frames.map(item=>item.result).filter(Boolean),top=states[0]||{};
    return {text:states.map(item=>item.text||'').join('\n').slice(0,60000),formFields:states.reduce((sum,item)=>sum+(item.formFields||0),0),password:states.some(item=>item.password),captcha:states.some(item=>captchaRequiresAction({present:item.captchaPresent,responseValues:item.captchaResponses,checked:item.captchaChecked,success:item.captchaSuccess})),final:states.some(item=>item.final),url:top.url||'',title:top.title||''};
  }
  async function fill(pageId,values,files,uploadedFileKinds,uploadedFilePaths) {
    const payload=JSON.stringify(values),uploadedKindsPayload=JSON.stringify([...uploadedFileKinds]),fileNamesPayload=JSON.stringify(Object.fromEntries(Object.entries(files).map(([kind,path])=>[kind,String(path||'').split(/[\\/]/).pop()])));
    const frames=await evaluateFrames(pageId,`()=>{const values=${payload};const normal=${normal.toString()};const deepElements=${deepElements.toString()};const fieldKindForHint=${fieldKindForHint.toString()};const fileKindForHint=${fileKindForHint.toString()};const uploadKindsForHint=${uploadKindsForHint.toString()};const uploadedKindsFromPageText=${uploadedKindsFromPageText.toString()};const scalarValueForField=${scalarValueForField.toString()};const isLegalConsentHint=${isLegalConsentHint.toString()};const hint=el=>{const root=el.getRootNode?.()||document;const label=el.id?root.querySelector?.('label[for="'+CSS.escape(el.id)+'"]')?.innerText:'';const parent=el.parentElement&&!/^(?:HTML|BODY|FORM)$/i.test(el.parentElement.tagName)&&el.parentElement.querySelectorAll('input,textarea,select').length<=2?el.parentElement.innerText:'';return[label,el.closest('label')?.innerText,parent,el.name,el.id,el.placeholder,el.getAttribute('aria-label'),el.getAttribute('title'),el.accept,el.autocomplete].filter(Boolean).join(' ').slice(0,1000)};const setValue=(el,value)=>{const proto=el instanceof HTMLSelectElement?HTMLSelectElement.prototype:el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;const setter=Object.getOwnPropertyDescriptor(proto,'value')?.set;setter?setter.call(el,value):el.value=value;el.dispatchEvent(new Event('input',{bubbles:true,composed:true}));el.dispatchEvent(new Event('change',{bubbles:true,composed:true}))};const assigned=[];for(const control of deepElements('input:not([type="hidden"]):not([type="password"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"]),textarea,select')){if(control.disabled||String(control.value||'').trim())continue;const text=hint(control),kind=fieldKindForHint(text);if(!kind||!values[kind])continue;let value=scalarValueForField(kind,control.type,text,values);if(kind==='phone'&&/ohne\\s*(?:0|landes)|without\\s*(?:0|country)/i.test(text))value=values.phoneSubscriber;else if(kind==='phone'&&/(?:^|\\D)0\\s*1\\d{2}/.test(text))value=values.phoneNational;if(control instanceof HTMLSelectElement){const wanted=[value,values.countryAlt].filter(Boolean).map(normal);const option=[...control.options].find(item=>wanted.some(candidate=>normal(item.textContent)===candidate||normal(item.textContent).includes(candidate)));if(!option)continue;value=option.value}setValue(control,value);assigned.push(kind)}for(const radio of deepElements('input[type="radio"]')){if(radio.disabled||radio.checked)continue;const text=hint(radio);if(isLegalConsentHint(text))continue;const kind=fieldKindForHint(text),wanted=normal(values[kind]||'');if(!kind||!wanted)continue;const option=normal([radio.value,radio.getAttribute('aria-label'),text].filter(Boolean).join(' '));const matches=option.includes(wanted)||(/^(?:no|nein)$/.test(wanted)&&/\\b(?:no|nein)\\b/.test(option))||(/^(?:yes|ja)$/.test(wanted)&&/\\b(?:yes|ja)\\b/.test(option));if(matches){radio.click();assigned.push(kind)}}const uploads=[],planned=new Set(${uploadedKindsPayload}),fileInputs=deepElements('input[type="file"]'),availableKinds=new Set(fileInputs.map(input=>fileKindForHint(hint(input))).filter(Boolean));for(const kind of uploadedKindsFromPageText(document.body?.innerText||'',${fileNamesPayload}))planned.add(kind);for(const input of fileInputs){if(input.files?.length){const existing=normal([...input.files].map(file=>file.name).join(' '));if(/cover|letter|anschreiben/.test(existing))planned.add('letter');if(/zeugnis|certificate|reference/.test(existing))planned.add('certificate');if(/(?:^|[^a-z])cv(?:[^a-z]|$)|resume|lebenslauf/.test(existing))planned.add('cv')}}for(const input of fileInputs){if(input.disabled||input.files?.length)continue;const text=hint(input),kinds=uploadKindsForHint(text,planned,availableKinds,Boolean(input.multiple));if(!kinds.length)continue;const label='alex-'+kinds.join('-')+'-pdf-upload-'+crypto.randomUUID();input.setAttribute('aria-label',label);uploads.push({kinds,label});kinds.forEach(kind=>planned.add(kind))}return{assigned:[...new Set(assigned)],uploads};}`);
    const result={assigned:[],uploads:[]},frameUploads=[];
    for(const frame of frames){if(!frame.result)continue;result.assigned.push(...(frame.result.assigned||[]));frameUploads.push(...(frame.result.uploads||[]))}
    result.uploads=uniqueUploadPlans(frameUploads,files,uploadedFileKinds,uploadedFilePaths);
    for(const upload of result.uploads||[]) {
      const tree=await chrome.tool('take_snapshot',{pageId,verbose:true}),uid=uploadUid(tree,upload.label); if(!uid) continue;
      const paths=upload.kinds.map(kind=>files[kind]);
      const uploaded=await chrome.tool('upload_file',{pageId,uid,filePaths:paths});
      if(!uploadWasConfirmed(uploaded,paths.length)) throw new Error(`Chrome did not verify the ${upload.kinds.join(' and ')} PDF upload`);
      upload.kinds.forEach((kind,index)=>{uploadedFileKinds.add(kind);uploadedFilePaths.add(paths[index]);result.assigned.push(`${kind} PDF`)});
    }
    return [...new Set(result.assigned||[])];
  }
  async function requiredUnknowns(pageId) {
    const frames=await evaluateFrames(pageId,`()=>{const deepElements=${deepElements.toString()};return deepElements('input:required,textarea:required,select:required').filter(el=>!el.disabled&&((el.type==='file'?!el.files?.length:el.type==='checkbox'||el.type==='radio'?!el.checked:!String(el.value||'').trim())||!el.checkValidity())).map(el=>{const root=el.getRootNode?.()||document;const label=el.id?root.querySelector?.('label[for="'+CSS.escape(el.id)+'"]')?.innerText:'';return(label||el.getAttribute('aria-label')||el.placeholder||el.name||el.id||'required field').replace(/\\s+/g,' ').trim()}).slice(0,6)}`);
    return [...new Set(frames.flatMap(item=>item.result||[]))].slice(0,6);
  }
  async function dismissCookieBanner(pageId) {
    return chrome.evaluate(pageId,`()=>{const controls=[...document.querySelectorAll('[id*="cookie" i] button,[class*="cookie" i] button,[aria-label*="cookie" i] button,[id*="consent" i] button,[class*="consent" i] button,#onetrust-banner-sdk button')];for(const matcher of[/^(?:reject all|decline|necessary only|nur notwendige|alle ablehnen|ablehnen)$/i,/^(?:accept all|allow all|alle akzeptieren|akzeptieren|zustimmen)$/i])for(const control of controls){const text=(control.innerText||control.getAttribute('aria-label')||'').trim();if(matcher.test(text)&&(control.offsetWidth||control.offsetHeight||control.getClientRects().length)&&!control.disabled){control.click();return true}}return false}`);
  }
  async function navigateToApplication(session) {
    if(session.navigationCount>=8) return false;
    await dismissCookieBanner(session.pageId);
    const before=new Set((await chrome.pages()).map(page=>page.id));
    try {
      const selected=await chrome.tool('click_application',{pageId:session.pageId},15000);
      if(selected?.structuredContent?.ok) {
        session.navigationCount+=1;
        set(session,'opening_application',`Following application step ${session.navigationCount} in Google Chrome…`);
        const pages=await chrome.pages(),created=pages.find(page=>!before.has(page.id));
        if(created){session.pageId=created.id;session.visitedUrls.add(created.url);await chrome.tool('select_page',{pageId:created.id,bringToFront:true});}
        else {const current=pages.find(page=>page.id===session.pageId);if(current?.url)session.visitedUrls.add(current.url);}
        await chrome.tool('select_page',{pageId:session.pageId,bringToFront:true});
        return true;
      }
    } catch(error) {
      // Older unpacked helpers and the DevTools test client do not implement
      // frame-aware clicking. Keep the established top-document fallback.
      if(!/Unknown Alex Job command|Unsupported Chrome helper action/.test(error.message)) throw error;
    }
    const candidate=await chrome.evaluate(session.pageId,`()=>{const score=${applicationCandidateScore.toString()};const deepElements=${deepElements.toString()};const explicit=deepElements('a[href],button,input[type="button"],input[type="submit"],[role="button"],[role="link"],[onclick],[data-href]');const textual=deepElements('body *').filter(node=>{const text=(node.innerText||node.textContent||'').replace(/\\s+/g,' ').trim();return text.length>0&&text.length<=160&&node.children.length<=3});const nodes=[...new Set([...explicit,...textual])];const candidates=nodes.map(node=>({node,text:(node.innerText||node.textContent||node.value||node.getAttribute('aria-label')||node.getAttribute('title')||node.getAttribute('data-testid')||'').replace(/\\s+/g,' ').trim(),href:node.href||node.getAttribute('href')||node.getAttribute('data-href')||'',disabled:Boolean(node.disabled||node.getAttribute('aria-disabled')==='true'),visible:Boolean(node.offsetWidth||node.offsetHeight||node.getClientRects().length)})).filter(item=>item.visible&&!item.disabled).map(item=>({...item,score:score(item)})).filter(item=>item.score>0).sort((a,b)=>b.score-a.score||a.text.length-b.text.length);const chosen=candidates[0];if(!chosen)return null;deepElements('[aria-label="alex-application-target"]').forEach(node=>node.removeAttribute('aria-label'));chosen.node.setAttribute('aria-label','alex-application-target');return{text:chosen.text,href:chosen.href||'',label:'alex-application-target'}}`); if(!candidate) return false;
    session.navigationCount+=1;
    set(session,'opening_application',`Following application step ${session.navigationCount} in Google Chrome…`);
    const tree=await chrome.tool('take_snapshot',{pageId:session.pageId,verbose:true}),uid=uploadUid(tree,candidate.label); if(!uid) return false;
    // Always click the real element. Many job sites use an ordinary-looking
    // link to open a modal, run JavaScript, set cookies, or create a new tab.
    await chrome.tool('click',{pageId:session.pageId,uid,includeSnapshot:false});
    const pages=await chrome.pages(),created=pages.find(page=>!before.has(page.id));
    if(created){session.pageId=created.id;session.visitedUrls.add(created.url);await chrome.tool('select_page',{pageId:created.id,bringToFront:true});}
    else {const current=pages.find(page=>page.id===session.pageId);if(current?.url)session.visitedUrls.add(current.url);}
    await chrome.tool('select_page',{pageId:session.pageId,bringToFront:true}); return true;
  }
  async function advance(pageId) {
    try {
      const selected=await chrome.tool('click_advance',{pageId},15000);
      if(selected?.structuredContent?.ok) return true;
    } catch(error) { if(!/Unknown Alex Job command|Unsupported Chrome helper action/.test(error.message)) throw error; }
    const marked=await chrome.evaluate(pageId,`()=>{const deepElements=${deepElements.toString()};const controls=deepElements('button,input[type="button"],input[type="submit"],a[role="button"],[role="button"]');const control=controls.find(el=>/\\b(?:next|continue|weiter|fortfahren|proceed|save and continue|speichern und weiter|suivant|continuer|volgende|doorgaan|siguiente|continuar|avanti|prosegui|dalej)\\b/i.test((el.innerText||el.textContent||el.value||el.getAttribute('aria-label')||el.getAttribute('title')||'').trim())&&!/\\b(?:submit|send application|submit application|application abschicken|bewerbung absenden|bewerbung einreichen|jetzt verbindlich bewerben|envoyer (?:la )?candidature|invia(?:re)? (?:la )?candidatura|enviar (?:la )?(?:solicitud|candidatura))\\b/i.test((el.innerText||el.textContent||el.value||'').trim())&&!el.disabled&&el.getAttribute('aria-disabled')!=='true'&&(el.offsetWidth||el.offsetHeight||el.getClientRects().length));if(!control)return false;deepElements('[aria-label="alex-advance-target"]').forEach(node=>node.removeAttribute('aria-label'));control.setAttribute('aria-label','alex-advance-target');return true}`); if(!marked)return false;
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
        if(state.url) session.visitedUrls.add(state.url);
        if(state.captcha) return set(session,'waiting_for_login','Complete the CAPTCHA in Google Chrome; the agent will continue automatically.');
        if(state.formFields===0&&(state.password||(LOGIN.test(state.text)&&!/application|bewerbung/i.test(state.text)))) return set(session,'waiting_for_login','Complete sign-in in Google Chrome; the agent will continue automatically.');
        await verifyPreparedFileEvidence(session.files,session.fileEvidence);
        const fields=await fill(session.pageId,session.values,session.files,session.uploadedFileKinds,session.uploadedFilePaths), unknowns=await requiredUnknowns(session.pageId), refreshed=await snapshot(session.pageId);
        if(unknowns.length) return set(session,'needs_review',`Complete these unknown required fields in Google Chrome: ${unknowns.join(', ')}. The agent will continue afterward.`);
        if(refreshed.final) return set(session,'ready_for_final_confirmation','All recognised fields and required PDF controls are ready. Review Google Chrome and confirm final submission in Alex Job.');
        let moved=await advance(session.pageId);
        if(!moved&&fields.length===0) moved=await navigateToApplication(session);
        if(moved) session.steps+=1;
        set(session,moved?'advancing':'needs_review',moved?`Completed or opened application step ${session.steps}; continuing automatically.`:`Filled ${fields.length} recognised item(s). Review Google Chrome for a site-specific question or control.`);
      } catch(error) { clearInterval(session.timer); set(session,'failed',`Browser agent paused: ${error.message}`); } finally { session.running=false; }
    });
  }
  async function activateFiles(jobId,job,files,language='de',applicationVersion='user-source') {
    return busy(async()=>{ const session=sessions.get(jobId); if(!session||!await pageExists(session.pageId)) throw new Error('The Google Chrome application tab is no longer open');
    const lang=['de','en'].includes(language)?language:'de';
    const form=profile.applicationForm||{}, applicantName=`${form.firstName||'Candidate'} ${form.lastName||''}`.trim(), startDate=firstDayOfNextMonth();
    const notes=applicationNote(job,lang,applicantName,form.startAvailability?.[lang]||'');
    session.files=Object.fromEntries(Object.entries(files||{}).filter(([,path])=>Boolean(path)));
    if(!session.files.cv) throw new Error('A PDF resume is required for this browser helper');
    session.fileEvidence=await preparedFileEvidence(session.files);
    session.packageIdentity={jobId:job.id,originUrl:session.originUrl,applicationVersion,files:Object.fromEntries(Object.entries(session.fileEvidence).map(([kind,item])=>[kind,{name:item.name,size:item.size,sha256:item.sha256}]))};
    const salaryNumber=String(form.desiredSalaryAnnualEur||75000);
    session.values={name:applicantName,firstName:form.firstName||'',legalFirstName:form.legalFirstName||form.firstName||'',lastName:form.lastName||'',salutation:form.salutation?.[lang]||'',nationality:form.nationality?.[lang]||'',nationalityAlternatives:form.nationalityAlternatives||[],birthDate:form.birthDateDisplay?.[lang]||form.birthDate||'',birthDateIso:form.birthDate||'',highestQualification:form.highestQualification?.[lang]||'',drivingLicence:form.drivingLicence||'',relocation:form.relocation?.[lang]||'',businessTravel:form.businessTravel?.[lang]||'',sponsorshipRequired:form.sponsorshipRequired?.[lang]||'',residencePermit:form.residencePermit?.[lang]||'',euWorkPermit:form.euWorkPermit?.[lang]||'',weeklyHoursMin:form.weeklyHoursMin||'',weeklyHoursMax:form.weeklyHoursMax||'',commute:form.commute?.[lang]||'',salaryNegotiable:form.salaryNegotiable?.[lang]||'',germanLevel:form.germanLevel||'',englishLevel:form.englishLevel||'',email:profile.identity.email,phone:form.phoneInternational||profile.identity.phone,phoneNational:form.phoneNational||'',phoneSubscriber:form.phoneSubscriber||'',address:form.address||profile.identity.location,street:form.street||'',houseNumber:form.houseNumber||'',postalCode:form.postalCode||'',city:form.city||'',country:form.country?.[lang]||'',countryAlt:form.country?.[lang==='de'?'en':'de']||'',location:profile.identity.location,linkedin:profile.identity.linkedin,github:profile.identity.github,authorisation:profile.identity.workAuthorisation[lang],salaryNumber,salary:lang==='de'?`${Number(salaryNumber).toLocaleString('de-DE')} EUR brutto pro Jahr`:`EUR ${Number(salaryNumber).toLocaleString('en-US')} gross per year`,startDate:startDate.display,startDateDisplay:startDate.display,startDateIso:startDate.iso,notes};
    set(session,'preparing_form','The account-specific application files are ready. Filling the website form in Google Chrome now…'); session.timer=setInterval(()=>{void drive(session).catch(error=>{clearInterval(session.timer);set(session,'failed',`Browser agent paused: ${error.message}`);});},5000); session.timer.unref?.(); await drive(session); return publicSession(session); });
  }
  async function attach(jobId,job,applicationPackage,language='de') {
    const lang=['de','en'].includes(language)?language:'de';
    const cv=await coverLetters.download(job,lang,'pdf','cv',applicationPackage.currentVersion), letter=await coverLetters.download(job,lang,'pdf','coverLetter',applicationPackage.currentVersion);
    return activateFiles(jobId,job,{cv:cv.path,letter:letter.path},lang,applicationPackage.currentVersion);
  }
  function createSession(job,pageId,message) {
    const session={id:randomUUID(),jobId:job.id,pageId,originUrl:job.url,status:'opening',message,startedAt:new Date().toISOString(),updatedAt:new Date().toISOString(),steps:0,navigationCount:0,visitedUrls:new Set([job.url]),running:false,files:null,fileEvidence:null,packageIdentity:null,values:{},uploadedFileKinds:new Set(),uploadedFilePaths:new Set(),timer:null};
    sessions.set(job.id,session);
    return session;
  }
  async function start(job,applicationPackage=null,language='de') {
    return busy(async()=>{ if(!/^https?:\/\//i.test(String(job.url||''))) throw new Error('An exact application URL is required');
    await browserContext(); const page=await chrome.newPage(job.url); if(!page) throw new Error('Chrome did not return the new application tab');
    const session=createSession(job,page.id,'Opening the exact advert in Google Chrome Default profile on this computer…'); if(applicationPackage) return attach(job.id,job,applicationPackage,language); set(session,'scanning_advert','Exact advert opened in the normal Chrome profile. Reading its complete rendered description and application controls…'); return publicSession(session); });
  }
  async function startOnPage(job,pageId,applicationPackage=null,language='de') {
    return busy(async()=>{ if(!/^https?:\/\//i.test(String(job.url||''))) throw new Error('An exact application URL is required');
    await browserContext(); if(!await pageExists(Number(pageId))) throw new Error('The selected Google Chrome tab is no longer open');
    const session=createSession(job,Number(pageId),'Using the selected job page in your current Google Chrome profile…');
    if(applicationPackage) return attach(job.id,job,applicationPackage,language);
    set(session,'scanning_advert','Scanning this Chrome tab for the job description and application controls…'); return publicSession(session); });
  }
  async function retryPage(pageId) {
    const session=[...sessions.values()].find(item=>item.pageId===Number(pageId));
    if(!session) return null;
    if(!await pageExists(session.pageId)) throw new Error('The selected Google Chrome tab is no longer open');
    clearInterval(session.timer); session.running=false;
    set(session,'retrying','Retrying recognised fields and PDF uploads on this page…');
    if(session.files) {
      session.timer=setInterval(()=>{void drive(session).catch(error=>{clearInterval(session.timer);set(session,'failed',`Browser agent paused: ${error.message}`);});},5000);
      session.timer.unref?.();
      await drive(session);
    }
    return publicSession(session);
  }
  async function posting(jobId) {
    return busy(async()=>{ const session=sessions.get(jobId); if(!session||!await pageExists(session.pageId)) throw new Error('The Google Chrome application tab is no longer open');
    const result=await chrome.evaluate(session.pageId,`async()=>{window.scrollTo(0,document.body.scrollHeight);await new Promise(resolve=>setTimeout(resolve,500));const raw=document.documentElement?.innerHTML||'';const emails=[...new Set(raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}/gi)||[])].join(' ');return{text:(document.body?.innerText||'').replace(/\\s+/g,' ').trim().slice(0,60000),emails,url:location.href,title:document.title}}`);
    return {...result,text:`${result.text} ${result.emails||''}`.trim(),source:'exact posting rendered in Google Chrome',retrievedAt:new Date().toISOString(),complete:result.text.length>=900}; });
  }
  async function prepareVisibleForm(jobId) { return busy(async()=>{ const session=sessions.get(jobId); if(!session||!await pageExists(session.pageId)) throw new Error('The Google Chrome application tab is no longer open'); return navigateToApplication(session); }); }
  function fail(jobId,error) { const session=sessions.get(jobId); if(session) { clearInterval(session.timer); return set(session,'failed',`Website application preparation failed: ${error.message}`); } }
  async function confirmSubmit(jobId) {
    return busy(async()=>{ const session=sessions.get(jobId); if(!session||session.status!=='ready_for_final_confirmation') throw new Error('The browser agent is not waiting at final submission');
    const marked=await chrome.evaluate(session.pageId,`()=>{const control=[...document.querySelectorAll('button,input[type="submit"],input[type="button"],[role="button"]')].find(el=>/\\b(?:submit|send application|submit application|application abschicken|bewerbung absenden|bewerbung einreichen|jetzt verbindlich bewerben|envoyer (?:la )?candidature|invia(?:re)? (?:la )?candidatura|enviar (?:la )?(?:solicitud|candidatura))\\b/i.test((el.innerText||el.textContent||el.value||el.getAttribute('aria-label')||'').trim())&&!el.disabled&&(el.offsetWidth||el.offsetHeight||el.getClientRects().length));if(!control)return false;control.setAttribute('aria-label','alex-final-submit-target');return true}`); if(!marked) throw new Error('The final submit control is no longer available. Review Google Chrome, then resume the agent.');
    const tree=await chrome.tool('take_snapshot',{pageId:session.pageId,verbose:true}),uid=uploadUid(tree,'alex-final-submit-target'); if(!uid) throw new Error('The final submit control could not be verified. Review Google Chrome, then resume the agent.'); await chrome.tool('click',{pageId:session.pageId,uid,includeSnapshot:false}); clearInterval(session.timer); set(session,'submitted','Final application submission was confirmed and sent from the website.'); return publicSession(session); });
  }
  async function close() {
    for(const session of sessions.values()) clearInterval(session.timer);
    // Detach the local agent bridge without closing any tab in the user's
    // normal Chrome Default profile.
    await chrome.close();
  }
  return { start,startOnPage,retryPage,attach,attachFiles:(jobId,job,files,language='de')=>activateFiles(jobId,job,files,language),posting,prepareVisibleForm,fail,confirmSubmit,close,status:jobId=>publicSession(sessions.get(jobId)),drive:jobId=>drive(sessions.get(jobId)) };
}
