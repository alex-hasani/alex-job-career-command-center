import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

const EMAIL=/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const BLOCKED=/(?:no-?reply|donotreply|privacy|datenschutz|unsubscribe|mailer-daemon)/i;
const clean=value=>String(value||'').replace(/\s+/g,' ').trim();
const unique=values=>[...new Set(values.map(v=>v.toLowerCase()))];
const b64url=value=>Buffer.from(value).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
function validRecipient(value) {
  const email=String(value||'').trim().toLowerCase();
  if (!/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(email) || BLOCKED.test(email)) {
    const error=new Error('Enter the recruiter or application email shown in the verified job description');
    error.code='RECIPIENT_REQUIRED'; throw error;
  }
  return email;
}
function candidates(job,posting='') {
  const values=[];
  for (const [text,source] of [[job?.recruiterContact,'saved recruiter contact'],[posting,'verified job description']]) {
    for (const email of unique(String(text||'').match(EMAIL)||[])) if (!BLOCKED.test(email)) values.push({email,source});
  }
  return values.filter((item,index)=>values.findIndex(other=>other.email===item.email)===index);
}
function language(posting='',requested='') {
  if (['de','en'].includes(requested)) return requested;
  const de=(String(posting).match(/\b(und|oder|sie|wir|ihre|aufgaben|anforderungen)\b/gi)||[]).length;
  const en=(String(posting).match(/\b(and|or|you|we|your|responsibilities|requirements)\b/gi)||[]).length;
  return de>=en?'de':'en';
}
function copy(job,lang,senderName) {
  const role=clean(job.title), company=clean(job.company);
  return lang==='de'
    ? {subject:`Bewerbung als ${role}`,body:`Guten Tag,\n\nanbei sende ich Ihnen meine Bewerbung als ${role} bei ${company}. Meinen Lebenslauf und mein Anschreiben finden Sie im Anhang.\n\nFür Rückfragen oder ein persönliches Gespräch stehe ich gerne zur Verfügung.\n\nFreundliche Grüße\n${senderName}`}
    : {subject:`Application for ${role}`,body:`Hello,\n\nPlease find attached my application for the ${role} position at ${company}. My CV and cover letter are attached.\n\nI would be pleased to discuss my experience and the role with you.\n\nKind regards,\n${senderName}`};
}
function mime({from,to,subject,body,files}) {
  const boundary=`alex-job-${randomBytes(12).toString('hex')}`;
  const lines=[`From: ${from}`,`To: ${to}`,`Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,'MIME-Version: 1.0',`Content-Type: multipart/mixed; boundary="${boundary}"`,'',`--${boundary}`,'Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',Buffer.from(body).toString('base64')];
  for (const file of files) lines.push(`--${boundary}`,`Content-Type: ${file.contentType}; name="${file.fileName.replace(/["\r\n]/g,'')}"`,'Content-Transfer-Encoding: base64',`Content-Disposition: attachment; filename="${file.fileName.replace(/["\r\n]/g,'')}"`,'',file.bytes.toString('base64'));
  lines.push(`--${boundary}--`,'');
  return b64url(lines.join('\r\n'));
}
export function createFastApplyService({root,workspace,coverLetters,senderEmail,senderName}) {
  const configPath=join(root,'gmail-oauth.config.json');
  const tokenPath=join(workspace,'State','gmail-oauth-tokens.json');
  const states=new Map();
  async function config() {
    if (!existsSync(configPath)) { const e=new Error('Gmail sending is not configured yet. Create gmail-oauth.config.json from the example.'); e.code='GMAIL_SETUP_REQUIRED'; throw e; }
    const c=JSON.parse(await readFile(configPath,'utf8'));
    if (!c.clientId||!c.clientSecret||!c.redirectUri) throw new Error('Gmail OAuth configuration is incomplete');
    return c;
  }
  const tokens=async()=>existsSync(tokenPath)?JSON.parse(await readFile(tokenPath,'utf8')):null;
  async function status(){let configured=true;try{await config();}catch{configured=false;}const t=await tokens();return{configured,connected:Boolean(t?.refreshToken||(t?.accessToken&&t.expiresAt>Date.now())),email:t?.email||''};}
  async function authorizationUrl(){
    const c=await config(), state=randomBytes(24).toString('hex'); states.set(state,Date.now()+600000);
    const q=new URLSearchParams({client_id:c.clientId,redirect_uri:c.redirectUri,response_type:'code',scope:'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email',access_type:'offline',prompt:'consent',state});
    return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
  }
  async function callback(code,state){
    const expiry=states.get(state);states.delete(state);if(!expiry||expiry<Date.now())throw new Error('The Gmail connection request expired');
    const c=await config();
    const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code,client_id:c.clientId,client_secret:c.clientSecret,redirect_uri:c.redirectUri,grant_type:'authorization_code'}),signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw new Error('Google did not complete the Gmail connection');
    const grant=await response.json();
    const profileResponse=await fetch('https://openidconnect.googleapis.com/v1/userinfo',{headers:{authorization:`Bearer ${grant.access_token}`},signal:AbortSignal.timeout(15000)});
    if(!profileResponse.ok)throw new Error('The connected Gmail account could not be verified');
    const profile=await profileResponse.json(), prior=await tokens();
    if(senderEmail&&profile.email.toLowerCase()!==senderEmail.toLowerCase())throw new Error(`Connect ${senderEmail}, not ${profile.email}`);
    await writeFile(tokenPath,JSON.stringify({email:profile.email,accessToken:grant.access_token,refreshToken:grant.refresh_token||prior?.refreshToken||'',expiresAt:Date.now()+(Number(grant.expires_in)||3600)*1000},null,2),'utf8');
    return{email:profile.email};
  }
  async function accessToken(){
    const t=await tokens();
    if(!t){const e=new Error('Connect Gmail before sending');e.code='GMAIL_CONNECTION_REQUIRED';throw e;}
    if(t.accessToken&&t.expiresAt>Date.now()+60000)return t.accessToken;
    if(!t.refreshToken)throw new Error('Reconnect Gmail before sending');
    const c=await config();
    const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:c.clientId,client_secret:c.clientSecret,refresh_token:t.refreshToken,grant_type:'refresh_token'}),signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw new Error('Gmail authorization expired. Reconnect Gmail.');
    const grant=await response.json();t.accessToken=grant.access_token;t.expiresAt=Date.now()+(Number(grant.expires_in)||3600)*1000;
    await writeFile(tokenPath,JSON.stringify(t,null,2),'utf8');return t.accessToken;
  }
  async function preview(job,pkg,requested='',recipientOverride=''){
    if(!pkg?.quality?.applicationReady)throw new Error('Prepare and review the application package first');
    const lang=language(pkg.posting?.text,requested), found=candidates(job,pkg.posting?.text);
    const recipient=recipientOverride?validRecipient(recipientOverride):(found[0]?.email||'');
    const message=copy(job,lang,clean(senderName)||'Candidate'), cv=pkg.documents.cv[lang], letter=pkg.documents.coverLetter[lang];
    return{language:lang,recipient,recipientVerified:Boolean(recipient),recipientSource:recipientOverride?'entered by Alex for this application':(found[0]?.source||''),subject:message.subject,body:message.body,attachments:[{type:'cv',fileName:cv.document.fileName.replace(/\.docx$/i,'.pdf')},{type:'coverLetter',fileName:letter.document.fileName.replace(/\.docx$/i,'.pdf')}],gmail:await status()};
  }
  async function send(job,pkg,input){
    const to=validRecipient(input.to), subject=String(input.subject||'').replace(/[\r\n]+/g,' ').trim(), body=String(input.body||'').replace(/\r\n?/g,'\n').trim();
    if(!subject||subject.length>300)throw new Error('Review the email subject before sending');
    if(body.length<40||body.length>5000)throw new Error('Review the email message before sending');
    if(input.confirmed!==true)throw new Error('Final send confirmation is required');
    const lang=language(pkg.posting?.text,input.language), files=[];
    for(const type of ['cv','coverLetter']){const item=await coverLetters.download(job,lang,'pdf',type,pkg.currentVersion);files.push({fileName:item.fileName,contentType:item.contentType,bytes:await readFile(item.path)});}
    const token=await accessToken(), t=await tokens();
    const response=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({raw:mime({from:t.email,to,subject,body,files})}),signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw new Error('Gmail did not send the application email');
    const result=await response.json();return{messageId:result.id,threadId:result.threadId||'',sentAt:new Date().toISOString(),to,subject,language:lang,attachmentNames:files.map(f=>f.fileName)};
  }
  return{status,authorizationUrl,callback,preview,send};
}
export const fastApplyInternals={candidates,language,copy,validRecipient,mime};
