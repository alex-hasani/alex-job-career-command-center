import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const FINAL=/\b(?:submit|send application|submit application|application abschicken|bewerbung absenden|bewerbung einreichen|jetzt verbindlich bewerben)\b/i;
const ADVANCE=/\b(?:next|continue|weiter|fortfahren|proceed)\b/i;
const START=/\b(?:apply now|apply for this job|jetzt bewerben|online bewerben|zur bewerbung|bewerben)\b/i;
const LOGIN=/\b(?:sign in|log in|anmelden|einloggen|password|passwort)\b/i;
const chromePath=['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'].find(existsSync);

function normal(value='') { return String(value).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,' '); }
export function fieldKindForHint(value='') {
  const hint=normal(value);
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
  if(/salary|gehalt|compensation/.test(hint)) return 'salary';
  if(/start.?date|available.?from|availability|eintritt|beginn|verfügbar|kuendigung|kündigung/.test(hint)) return 'startDate';
  if(/anmerkung|comment|additional.?information|nachricht|message|motivation|anschreiben/.test(hint)) return 'notes';
  return '';
}
function fileKindForHint(value='') {
  const hint=normal(value);
  if(/cover|letter|anschreiben|motivationsschreiben/.test(hint)) return 'letter';
  if(/resume|curriculum|lebenslauf|\bcv\b/.test(hint)) return 'cv';
  return 'cv';
}
function nextUploadKind(value='', uploadedFileKinds=new Set()) {
  const kind=fileKindForHint(value)==='letter'?'letter':'cv';
  return uploadedFileKinds.has(kind)?'':kind;
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
export function websiteApplyInternals() { return { FINAL, ADVANCE, START, LOGIN, fieldKindForHint, fileKindForHint, nextUploadKind, applicationNote }; }

export function createWebsiteApplyAgent({ workspace, coverLetters, profile, onEvent=()=>{} }) {
  const sessions=new Map(); let context=null;
  const profileDir=join(workspace,'State','website-application-chrome-profile');
  async function browserContext() {
    if(context) return context;
    if(!chromePath) throw new Error('Google Chrome is not installed in a supported location on HOME-PC');
    await mkdir(profileDir,{recursive:true});
    const { chromium }=await import('playwright');
    context=await chromium.launchPersistentContext(profileDir,{headless:false,executablePath:chromePath,viewport:null,locale:'de-DE',ignoreDefaultArgs:['--no-sandbox'],args:['--start-maximized','--new-window']});
    context.on('close',()=>{ context=null; }); return context;
  }
  const publicSession=session=>session ? {id:session.id,jobId:session.jobId,status:session.status,message:session.message,startedAt:session.startedAt,updatedAt:session.updatedAt,steps:session.steps,browser:'Google Chrome on HOME-PC'} : null;
  function set(session,status,message) { const changed=session.status!==status||session.message!==message; session.status=status; session.message=message; session.updatedAt=new Date().toISOString(); if(changed) onEvent({action:`website_apply.${status}`,result:status==='failed'?'error':'ok',jobId:session.jobId,detail:message}); return publicSession(session); }
  async function snapshot(page) {
    return page.evaluate(() => { const visible=node=>Boolean(node&&(node.offsetWidth||node.offsetHeight||node.getClientRects().length)); const controls=[...document.querySelectorAll('button,input[type="submit"],input[type="button"]')].filter(visible); return {text:document.body?.innerText?.slice(0,30000)||'',password:Boolean(document.querySelector('input[type="password"]')),captcha:Boolean(document.querySelector('iframe[src*="captcha" i],[class*="captcha" i],[id*="captcha" i]')),final:controls.some(el=>/submit|send application|submit application|application abschicken|bewerbung absenden|bewerbung einreichen|jetzt verbindlich bewerben/i.test((el.innerText||el.value||'').trim()))}; });
  }
  async function controlHint(control) {
    return control.evaluate(el=>{ const label=el.id?document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.innerText:''; const wrapping=el.closest('label')?.innerText||el.parentElement?.innerText||''; return [label,wrapping,el.name,el.id,el.placeholder,el.getAttribute('aria-label'),el.autocomplete].filter(Boolean).join(' ').slice(0,1000); });
  }
  async function fill(page,values,files,uploadedFileKinds) {
    const assigned=[];
    const controls=await page.locator('input:not([type="hidden"]):not([type="password"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"]),textarea,select').all();
    for(const control of controls) {
      try {
        if(await control.isDisabled()||(await control.inputValue()).trim()) continue;
        const hint=await controlHint(control), kind=fieldKindForHint(hint); if(!kind||!values[kind]) continue;
        const tag=await control.evaluate(el=>el.tagName.toLowerCase()), type=(await control.getAttribute('type')||'').toLowerCase();
        let value=values[kind];
        if(kind==='phone' && /ohne\s*(?:0|landes)|without\s*(?:0|country)/i.test(hint)) value=values.phoneSubscriber;
        else if(kind==='phone' && /(?:^|\D)0\s*1\d{2}/.test(hint)) value=values.phoneNational;
        if(kind==='startDate' && type==='date') value=values.startDateIso;
        if(tag==='select') {
          const options=await control.locator('option').evaluateAll(nodes=>nodes.map(node=>({label:(node.textContent||'').trim(),value:node.value})));
          const wanted=[value,values.countryAlt].filter(Boolean).map(normal);
          const option=options.find(item=>wanted.some(candidate=>normal(item.label)===candidate||normal(item.label).includes(candidate)));
          if(!option) continue; await control.selectOption(option.value);
        } else await control.fill(value);
        assigned.push(kind);
      } catch {}
    }
    for(const upload of await page.locator('input[type="file"]').all()) {
      try {
        const kind=nextUploadKind(await controlHint(upload),uploadedFileKinds);
        if(!kind) continue;
        await upload.setInputFiles(kind==='letter'?[files.letter]:[files.cv]);
        uploadedFileKinds.add(kind); assigned.push(`${kind} PDF`);
      } catch {}
    }
    return [...new Set(assigned)];
  }
  async function requiredUnknowns(page) {
    return page.locator('input:required:not([type="file"]),textarea:required,select:required').evaluateAll(nodes=>nodes.filter(el=>!el.disabled&&((el.type==='checkbox'||el.type==='radio'?!el.checked:!String(el.value||'').trim())||!el.checkValidity())).map(el=>{ const label=el.id?document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.innerText:''; return (label||el.getAttribute('aria-label')||el.placeholder||el.name||el.id||'required field').replace(/\s+/g,' ').trim(); }).slice(0,6));
  }
  async function navigateToApplication(session) {
    const page=session.page;
    const destination=await page.evaluate(() => { const start=/apply now|apply for this job|jetzt bewerben|online bewerben|zur bewerbung|bewerben/i; const link=[...document.querySelectorAll('a[href]')].find(node=>start.test((node.innerText||'').trim())||/\/(?:apply|application|bewerbung)(?:[/?#]|$)/i.test(node.getAttribute('href')||'')); return link?new URL(link.getAttribute('href'),location.href).href:''; });
    if(destination&&destination!==page.url()) { set(session,'opening_application','Advert scanned. Opening its application form in Google Chrome while the PDFs are prepared…'); await page.goto(destination,{waitUntil:'domcontentloaded',timeout:45000}); await page.bringToFront(); return true; }
    const clicked=await page.locator('button,a[role="button"]').evaluateAll(nodes=>{ const start=/apply now|apply for this job|jetzt bewerben|online bewerben|zur bewerbung|bewerben/i, final=/submit|send application|application abschicken|bewerbung absenden|bewerbung einreichen|jetzt verbindlich bewerben/i; const el=nodes.find(node=>start.test((node.innerText||node.value||'').trim())&&!final.test((node.innerText||node.value||'').trim())&&!node.disabled); if(!el)return false;el.click();return true; });
    if(clicked) { set(session,'opening_application','Advert scanned. Opening its application form while the PDFs are prepared…'); await page.waitForTimeout(1200); await page.bringToFront(); } return clicked;
  }
  async function advance(page) {
    const locator=page.locator('button:not([type="submit"]),input[type="button"],a[role="button"]');
    for(let i=0;i<await locator.count();i++) { const control=locator.nth(i), text=((await control.innerText().catch(()=>''))||(await control.getAttribute('value'))||'').trim(); if(ADVANCE.test(text)&&!FINAL.test(text)&&await control.isEnabled()&&await control.isVisible()) { await control.click(); return true; } } return false;
  }
  async function drive(session) {
    if(!session||session.running||!session.files||['submitted','ready_for_final_confirmation','closed','failed'].includes(session.status)) return;
    if(session.page.isClosed()) { clearInterval(session.timer); return set(session,'closed','The Google Chrome application window was closed before submission.'); }
    session.running=true;
    try {
      const state=await snapshot(session.page);
      if(state.captcha) return set(session,'waiting_for_login','Complete the CAPTCHA in Google Chrome; the agent will continue automatically.');
      if(state.password||(LOGIN.test(state.text)&&!/application|bewerbung/i.test(state.text))) return set(session,'waiting_for_login','Complete sign-in in Google Chrome; the agent will continue automatically.');
      const fields=await fill(session.page,session.values,session.files,session.uploadedFileKinds), unknowns=await requiredUnknowns(session.page), refreshed=await snapshot(session.page);
      if(refreshed.final) return set(session,'ready_for_final_confirmation',unknowns.length?`Review required fields in Chrome before final submission: ${unknowns.join(', ')}.`:'Form and two PDFs are ready. Review Google Chrome and confirm final submission in Alex Job.');
      if(unknowns.length) return set(session,'needs_review',`Complete these unknown required fields in Google Chrome: ${unknowns.join(', ')}. The agent will continue afterward.`);
      const moved=await advance(session.page); session.steps+=1; set(session,moved?'advancing':'needs_review',moved?`Completed form step ${session.steps}; continuing automatically.`:`Filled ${fields.length} recognised item(s). Review Google Chrome for a site-specific question or control.`);
    } catch(error) { clearInterval(session.timer); set(session,'failed',`Browser agent paused: ${error.message}`); } finally { session.running=false; }
  }
  async function attach(jobId,job,applicationPackage,language='de') {
    const session=sessions.get(jobId); if(!session||session.page.isClosed()) throw new Error('The Google Chrome application window is no longer open');
    const lang=['de','en'].includes(language)?language:'de', cv=await coverLetters.download(job,lang,'pdf','cv',applicationPackage.currentVersion), letter=await coverLetters.download(job,lang,'pdf','coverLetter',applicationPackage.currentVersion);
    const form=profile.applicationForm||{}, applicantName=`${form.firstName||'Candidate'} ${form.lastName||''}`.trim(), startDate=new Date(); startDate.setMonth(startDate.getMonth()+3);
    const notes=applicationNote(job,lang,applicantName,form.startAvailability?.[lang]||'');
    session.files={cv:cv.path,letter:letter.path};
    session.values={name:applicantName,firstName:form.firstName||'',lastName:form.lastName||'',email:profile.identity.email,phone:form.phoneInternational||profile.identity.phone,phoneNational:form.phoneNational||'',phoneSubscriber:form.phoneSubscriber||'',address:form.address||profile.identity.location,street:form.street||'',houseNumber:form.houseNumber||'',postalCode:form.postalCode||'',city:form.city||'',country:form.country?.[lang]||'',countryAlt:form.country?.[lang==='de'?'en':'de']||'',location:profile.identity.location,linkedin:profile.identity.linkedin,github:profile.identity.github,authorisation:profile.identity.workAuthorisation[lang],salary:lang==='de'?'80.000 EUR brutto pro Jahr, verhandelbar':'EUR 80,000 gross per year, negotiable',startDate:form.startAvailability?.[lang]||'',startDateIso:startDate.toISOString().slice(0,10),notes};
    set(session,'preparing_form','Two reviewed PDF files are ready. Filling the website form in Google Chrome now…'); session.timer=setInterval(()=>drive(session),2000); session.timer.unref?.(); await drive(session); return publicSession(session);
  }
  async function start(job,applicationPackage=null,language='de') {
    if(!/^https?:\/\//i.test(String(job.url||''))) throw new Error('An exact application URL is required');
    const activeContext=await browserContext(), blankPages=activeContext.pages().filter(candidate=>candidate.url()==='about:blank'); let page=blankPages[0]; if(!page) page=await activeContext.newPage();
    for(const extra of blankPages.slice(1)) await extra.close().catch(()=>{});
    const session={id:randomUUID(),jobId:job.id,page,status:'opening',message:'Opening the exact advert in Google Chrome on HOME-PC…',startedAt:new Date().toISOString(),updatedAt:new Date().toISOString(),steps:0,running:false,files:null,values:{},uploadedFileKinds:new Set(),timer:null};
    sessions.set(job.id,session); page.on('close',()=>{ clearInterval(session.timer); if(session.status!=='submitted') set(session,'closed','The Google Chrome application window was closed before submission.'); });
    await page.goto(job.url,{waitUntil:'domcontentloaded',timeout:45000}); await page.bringToFront(); if(applicationPackage) return attach(job.id,job,applicationPackage,language); set(session,'scanning_advert','Exact advert opened in Google Chrome. Reading its complete rendered description and application controls…'); return publicSession(session);
  }
  async function posting(jobId) {
    const session=sessions.get(jobId); if(!session||session.page.isClosed()) throw new Error('The Google Chrome application window is no longer open');
    await session.page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight)); await session.page.waitForTimeout(500);
    const result=await session.page.evaluate(()=>({text:(document.body?.innerText||'').replace(/\s+/g,' ').trim(),html:document.documentElement?.outerHTML||'',url:location.href,title:document.title}));
    const emails=result.html.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)?.join(' ')||''; return {...result,text:`${result.text} ${emails}`.trim(),source:'exact posting rendered in Google Chrome',retrievedAt:new Date().toISOString(),complete:result.text.length>=900};
  }
  async function prepareVisibleForm(jobId) { const session=sessions.get(jobId); if(!session||session.page.isClosed()) throw new Error('The Google Chrome application window is no longer open'); return navigateToApplication(session); }
  function fail(jobId,error) { const session=sessions.get(jobId); if(session) { clearInterval(session.timer); return set(session,'failed',`Website application preparation failed: ${error.message}`); } }
  async function confirmSubmit(jobId) {
    const session=sessions.get(jobId); if(!session||session.status!=='ready_for_final_confirmation') throw new Error('The browser agent is not waiting at final submission');
    const controls=session.page.locator('button,input[type="submit"],input[type="button"]'); let clicked=false;
    for(let i=0;i<await controls.count();i++) { const control=controls.nth(i), text=((await control.innerText().catch(()=>''))||(await control.getAttribute('value'))||'').trim(); if(FINAL.test(text)&&await control.isEnabled()&&await control.isVisible()) { await control.click(); clicked=true; break; } }
    if(!clicked) throw new Error('The final submit control is no longer available. Review Google Chrome, then resume the agent.'); clearInterval(session.timer); set(session,'submitted','Final application submission was confirmed and sent from the website.'); return publicSession(session);
  }
  return { start,attach,posting,prepareVisibleForm,fail,confirmSubmit,status:jobId=>publicSession(sessions.get(jobId)),drive:jobId=>drive(sessions.get(jobId)) };
}
