import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const FINAL=/\b(?:submit|send application|application abschicken|bewerbung absenden|bewerbung einreichen|jetzt verbindlich bewerben)\b/i;
const ADVANCE=/\b(?:next|continue|weiter|fortfahren|proceed)\b/i;
const LOGIN=/\b(?:sign in|log in|anmelden|einloggen|password|passwort)\b/i;
const LABELS={name:['full name','name','vorname nachname','ihr name'],email:['email','e-mail','e mail','e-mail-adresse'],phone:['phone','telefon','mobile','mobil'],location:['location','standort','wohnort','city','stadt'],linkedin:['linkedin'],github:['github'],authorisation:['work authorization','arbeitserlaubnis','work permit']};
const edgePath=['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe','C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find(existsSync);

export function websiteApplyInternals() { return { FINAL, ADVANCE, LOGIN }; }

export function createWebsiteApplyAgent({ workspace, coverLetters, profile, onEvent=()=>{} }) {
  const sessions=new Map(); let context=null;
  const profileDir=join(workspace,'State','website-application-browser-profile');
  async function browserContext() {
    if (context) return context;
    await mkdir(profileDir,{recursive:true});
    const { chromium }=await import('playwright');
    context=await chromium.launchPersistentContext(profileDir,{headless:false,executablePath:edgePath,viewport:null,args:['--start-maximized']});
    context.on('close',()=>{ context=null; }); return context;
  }
  const publicSession=session=>session ? {id:session.id,jobId:session.jobId,status:session.status,message:session.message,startedAt:session.startedAt,updatedAt:session.updatedAt,steps:session.steps} : null;
  function set(session,status,message) { session.status=status; session.message=message; session.updatedAt=new Date().toISOString(); onEvent({action:`website_apply.${status}`,result:'ok',jobId:session.jobId,detail:message}); }
  async function snapshot(page) { return page.evaluate(() => ({text:document.body?.innerText?.slice(0,24000)||'',password:Boolean(document.querySelector('input[type="password"]')),final:[...document.querySelectorAll('button,input[type="submit"],input[type="button"]')].some(el=>/submit|send application|application abschicken|bewerbung absenden|bewerbung einreichen|jetzt verbindlich bewerben/i.test((el.innerText||el.value||'').trim()))})); }
  async function fill(page,values,files) {
    const assigned=await page.evaluate(({labels,values})=>{
      const done=[]; for(const control of document.querySelectorAll('input:not([type="hidden"]):not([type="password"]),textarea')) {
        if(control.disabled||control.value||/checkbox|radio|file|submit|button/i.test(control.type||'')) continue;
        const label=control.id?document.querySelector(`label[for="${CSS.escape(control.id)}"]`)?.innerText:'';
        const hint=[label,control.name,control.id,control.placeholder,control.getAttribute('aria-label')].filter(Boolean).join(' ').toLowerCase();
        const key=Object.keys(labels).find(name=>labels[name].some(term=>hint.includes(term))); if(!key||!values[key]) continue;
        control.value=values[key]; control.dispatchEvent(new Event('input',{bubbles:true})); control.dispatchEvent(new Event('change',{bubbles:true})); done.push(key);
      } return [...new Set(done)];
    },{labels:LABELS,values});
    for(const input of await page.locator('input[type="file"]').all()) { try { await input.setInputFiles(files); } catch {} }
    return assigned;
  }
  async function advance(page) { return page.evaluate(() => { const el=[...document.querySelectorAll('button,a[role="button"]')].find(node=>{const text=(node.innerText||node.value||'').trim();return /next|continue|weiter|fortfahren|proceed/i.test(text)&&!/submit|send application|application abschicken|bewerbung absenden|bewerbung einreichen|jetzt verbindlich bewerben/i.test(text)&&!node.disabled&&node.type!=='submit';});if(!el)return false;el.click();return true; }); }
  async function drive(session) {
    if(!session||session.running||['submitted','ready_for_final_confirmation'].includes(session.status)) return;
    session.running=true; try {
      const pageState=await snapshot(session.page);
      if(pageState.password || (LOGIN.test(pageState.text)&&!/application|bewerbung/i.test(pageState.text))) return set(session,'waiting_for_login','Complete sign-in or CAPTCHA in the opened browser; the agent will continue automatically.');
      const fields=await fill(session.page,session.values,session.files);
      if(pageState.final) return set(session,'ready_for_final_confirmation','Form preparation is complete. Review the browser and confirm final submission in Alex Job.');
      const moved=await advance(session.page); session.steps+=1;
      set(session,moved?'advancing':'review_needed',moved?`Completed step ${session.steps}; continuing automatically.`:`Filled ${fields.length} recognised field(s). Complete unknown required fields in the browser.`);
    } catch(error) { set(session,'needs_review',`Browser agent paused: ${error.message}`); } finally { session.running=false; }
  }
  async function start(job,applicationPackage,language='de') {
    if(!/^https?:\/\//i.test(String(job.url||''))) throw new Error('An exact application URL is required');
    const lang=['de','en'].includes(language)?language:'de';
    const cv=await coverLetters.download(job,lang,'pdf','cv',applicationPackage.currentVersion), letter=await coverLetters.download(job,lang,'pdf','coverLetter',applicationPackage.currentVersion);
    const page=await (await browserContext()).newPage();
    const session={id:randomUUID(),jobId:job.id,page,status:'starting',message:'Opening the exact job application page…',startedAt:new Date().toISOString(),updatedAt:new Date().toISOString(),steps:0,running:false,files:[cv.path,letter.path],values:{name:profile.identity.name,email:profile.identity.email,phone:profile.identity.phone,location:profile.identity.location,linkedin:profile.identity.linkedin,github:profile.identity.github,authorisation:profile.identity.workAuthorisation[lang]}};
    sessions.set(job.id,session); page.on('close',()=>clearInterval(session.timer)); await page.goto(job.url,{waitUntil:'domcontentloaded',timeout:45000}); session.timer=setInterval(()=>drive(session),2500); session.timer.unref?.(); await drive(session); return publicSession(session);
  }
  async function confirmSubmit(jobId) {
    const session=sessions.get(jobId); if(!session||session.status!=='ready_for_final_confirmation') throw new Error('The browser agent is not waiting at final submission');
    const clicked=await session.page.evaluate(() => { const el=[...document.querySelectorAll('button,input[type="submit"],input[type="button"]')].find(node=>/submit|send application|application abschicken|bewerbung absenden|bewerbung einreichen|jetzt verbindlich bewerben/i.test((node.innerText||node.value||'').trim())&&!node.disabled);if(!el)return false;el.click();return true; });
    if(!clicked) throw new Error('The final submit control is no longer available. Review the browser, then resume the agent.');
    clearInterval(session.timer); set(session,'submitted','Final application submission was confirmed and sent from the website.'); return publicSession(session);
  }
  return { start,confirmSubmit,status:jobId=>publicSession(sessions.get(jobId)),drive:jobId=>drive(sessions.get(jobId)) };
}
