import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import JSZip from 'jszip';
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';
import { teachingPaths } from './teaching-space.mjs';

const LANGUAGES = ['en', 'de'];
const TYPES = ['cv', 'coverLetter'];
const HTML_ESCAPE = value => String(value || '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const XML_DECODE = value => String(value || '').replace(/&(?:amp|lt|gt|quot|apos);/g, entity => ({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"}[entity]));
const clean = value => String(value || '').replace(/\s+/g,' ').trim();

function safeKey(job) {
  return createHash('sha256').update(String(job.id || job.url)).digest('hex').slice(0,24);
}
function fileStem(job, type, language, version) {
  const title=clean(job.title).normalize('NFKD').replace(/[^A-Za-z0-9]+/g,'_').replace(/^_|_$/g,'').slice(0,40) || 'Teaching';
  return `Demo_Candidate_${title}_${type === 'cv' ? 'CV' : 'CL'}_${language.toUpperCase()}_v${version}`;
}
function terms(value) {
  return new Set(clean(value).toLowerCase().match(/[\p{L}]{4,}/gu) || []);
}
function relevantEvidence(paragraphs, posting) {
  const keys=terms(posting);
  return paragraphs.filter(line => /^•\s/.test(line)).map(line => ({line:line.replace(/^•\s*/,''),score:[...terms(line)].filter(term => keys.has(term)).length}))
    .filter(item => item.score).sort((a,b) => b.score-a.score).slice(0,3).map(item => item.line);
}
async function masterParagraphs(path) {
  const zip=await JSZip.loadAsync(await readFile(path));
  const xml=await zip.file('word/document.xml')?.async('string');
  if(!xml) throw new Error('Teaching master CV cannot be read');
  return [...xml.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)]
    .map(match => [...match[1].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(part => XML_DECODE(part[1])).join('').trim())
    .filter(Boolean);
}
async function pickMaster(paths, language) {
  const pattern=new RegExp(`^Demo_Candidate_Teaching_CV_${language.toUpperCase()}_\\d{4}-\\d{2}-\\d{2}\\.docx$`);
  const candidates=(await readdir(paths.documents)).filter(name=>pattern.test(name)).sort().reverse();
  if(!candidates.length) throw new Error(`The ${language.toUpperCase()} Teaching master CV is unavailable`);
  return join(paths.documents,candidates[0]);
}
function makeLetter(job, language, evidence) {
  const role=clean(job.title), company=clean(job.company);
  const first=evidence[0] || (language==='de' ? 'Ich habe Englischunterricht für Kinder und Jugendliche vorbereitet und durchgeführt.' : 'I have planned and delivered English lessons for children and young learners.');
  const second=evidence[1] || (language==='de' ? 'Ich habe Lehrkräfte geschult und den Unterricht begleitet.' : 'I have trained teachers and supported classroom practice.');
  return language==='de'
    ? `Bewerbung als ${role} bei ${company}\n\nSehr geehrte Damen und Herren,\n\nich bewerbe mich für die Position ${role} bei ${company}. Meine Erfahrung umfasst Vollzeitunterricht für Kinder und Jugendliche in China und Iran sowie die Vorbereitung von Unterrichtsplänen, Materialien und Nachbereitung.\n\n${first}\n\n${second}\n\nGerne erläutere ich Ihnen in einem Gespräch, wie meine Unterrichtserfahrung zu Ihrer Stelle passt. Ich bin ab sofort oder jeweils zum Beginn des nächsten Monats verfügbar.\n\nMit freundlichen Grüßen\nDemo Candidate`
    : `Application for ${role} at ${company}\n\nDear Hiring Team,\n\nI am applying for the ${role} position at ${company}. My background includes full-time English teaching for children and young learners in China and Iran, with lesson planning, materials preparation and after-class follow-up.\n\n${first}\n\n${second}\n\nI would welcome a conversation about how my teaching experience fits your role. I am available immediately or at the beginning of the next month.\n\nKind regards\nDemo Candidate`;
}
function makeCv(source, job, language, evidence) {
  const focus=language==='de' ? 'BEWERBUNGSFOKUS' : 'APPLICATION FOCUS';
  const lines=[...source];
  lines.splice(3,0,focus,`${clean(job.title)} | ${clean(job.company)}`,...evidence.map(item => `• ${item}`));
  return lines.join('\n');
}
function documentLines(body, type, master) {
  const lines=body.split('\n');
  const header=master.slice(0,3);
  return type==='cv' ? lines : [...header,'',...lines];
}
async function writeDocx(path, body, type, master) {
  const lines=documentLines(body,type,master);
  const children=lines.map((line,index) => new Paragraph({
    ...(index>2 && line && !/^•/.test(line) && line===line.toUpperCase() && line.length<55 ? {heading:HeadingLevel.HEADING_2} : {}),
    spacing:{after: index<3 ? 70 : line ? 90 : 160},
    children:[new TextRun({text:line.replace(/^•\s*/,''),bold:index<2 || (type==='cv' && line===line.toUpperCase() && line.length<55),size:index===0?30:index===1?21:18,font:'Arial',color:index===1?'245684':'17253A'})]
  }));
  const doc=new Document({creator:'Demo Candidate',lastModifiedBy:'Demo Candidate',title:type==='cv'?'Teaching CV':'Teaching cover letter',subject:'Teaching application',description:'',keywords:'',sections:[{properties:{page:{margin:{top:700,right:850,bottom:700,left:850}}},children}]});
  await writeFile(path,await Packer.toBuffer(doc));
}
async function writePdf(path, body, type, master) {
  const {chromium}=await import('playwright');
  const lines=documentLines(body,type,master);
  const html=`<!doctype html><html><head><meta charset="utf-8"><style>@page{size:A4;margin:18mm 18mm}body{font:10pt/1.38 Arial,sans-serif;color:#17253a}h1{font-size:16pt;margin:0 0 2mm}h2{font-size:11pt;color:#245684;margin:0 0 2mm}p{margin:0 0 2.3mm;white-space:pre-wrap}section{break-inside:avoid}.space{height:3mm}.section{font-weight:700;color:#245684;margin-top:4mm}</style></head><body>${lines.map((line,index)=>index===0?`<h1>${HTML_ESCAPE(line)}</h1>`:index===1?`<h2>${HTML_ESCAPE(line)}</h2>`:line?`<p class="${type==='cv'&&line===line.toUpperCase()&&line.length<55?'section':''}">${HTML_ESCAPE(line)}</p>`:'<div class="space"></div>').join('')}</body></html>`;
  const candidates=['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe','C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe','C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].filter(existsSync);
  if(!candidates.length) throw new Error('PDF export requires Edge or Chrome');
  let browser;
  try {
    browser=await chromium.launch({headless:true,executablePath:candidates[0]});
    const page=await browser.newPage();
    await page.setContent(html,{waitUntil:'load'});
    await page.pdf({path,format:'A4',printBackground:true,preferCSSPageSize:true});
  } finally {await browser?.close();}
}
export function createTeachingApplicationService({workspace}) {
  const paths=teachingPaths(workspace);
  const root=join(paths.documents,'Applications');
  const packagePath=job=>join(root,safeKey(job),'application-package.json');
  async function read(job) {
    try {return JSON.parse(await readFile(packagePath(job),'utf8'));}
    catch(error){if(error.code==='ENOENT') return null;throw error;}
  }
  function publicPackage(data) {
    const active=data.versions.find(item=>item.version===data.currentVersion);
    const documents=Object.fromEntries(TYPES.map(type=>[type,Object.fromEntries(LANGUAGES.map(language=>{
      const base=`/api/user-space/teaching-application-package/download?id=${encodeURIComponent(data.job.id)}&type=${type}&language=${language}&version=${active.version}`;
      return [language,{body:active.text[type][language],document:{fileName:active.files[type][language].docx,downloadUrl:`${base}&format=docx`,pdfDownloadUrl:`${base}&format=pdf`}}];
    }))]));
    return {job:data.job,posting:{text:data.posting.text,source:data.posting.source},currentVersion:data.currentVersion,history:data.versions.map(item=>({version:item.version,createdAt:item.createdAt})),documents,quality:{jdComplete:true,applicationReady:true},updatedAt:data.updatedAt};
  }
  async function prepare(job, suppliedDescription='') {
    if(!job?.id || !job?.title || !job?.company || !job?.url) throw new Error('Select a verified Teaching job first');
    const posting=clean(suppliedDescription || job.description);
    if(posting.length<350) throw new Error('Paste the complete job description before preparing a Teaching application');
    const existing=await read(job),version=(existing?.currentVersion||0)+1;
    const folder=join(root,safeKey(job),`v${version}`);
    await mkdir(folder,{recursive:true});
    const text={cv:{},coverLetter:{}},files={cv:{},coverLetter:{}},headers={};
    for(const language of LANGUAGES) {
      const source=await masterParagraphs(await pickMaster(paths,language));
      headers[language]=source.slice(0,3);
      const evidence=relevantEvidence(source,posting);
      text.cv[language]=makeCv(source,job,language,evidence);
      text.coverLetter[language]=makeLetter(job,language,evidence);
      for(const type of TYPES) {
        const stem=fileStem(job,type,language,version);
        files[type][language]={docx:`${stem}.docx`,pdf:`${stem}.pdf`};
        await writeDocx(join(folder,files[type][language].docx),text[type][language],type,source);
      }
    }
    const data={version:1,job:{id:job.id,title:job.title,company:job.company,location:job.location,url:job.url},posting:{text:posting,source:suppliedDescription?'user-pasted full job description':'verified Teaching posting'},currentVersion:version,versions:[...(existing?.versions||[]),{version,createdAt:new Date().toISOString(),text,files,headers}],updatedAt:new Date().toISOString()};
    await writeFile(packagePath(job),JSON.stringify(data,null,2),'utf8');
    return publicPackage(data);
  }
  async function download(job,language='en',format='docx',type='cv',version=null) {
    if(!LANGUAGES.includes(language)||!TYPES.includes(type)||!['docx','pdf'].includes(format)) throw new Error('Unsupported Teaching document selection');
    const data=await read(job);
    if(!data) throw new Error('Prepare a Teaching application package first');
    const item=data.versions.find(entry=>entry.version===Number(version||data.currentVersion));
    if(!item) throw new Error('Teaching package version not found');
    const name=item.files[type][language][format],path=join(root,safeKey(job),`v${item.version}`,name);
    if(format==='pdf') {
      const docxPath=join(root,safeKey(job),`v${item.version}`,item.files[type][language].docx);
      const pdfStat=await stat(path).catch(()=>null),docxStat=await stat(docxPath);
      if(!pdfStat || pdfStat.mtimeMs<docxStat.mtimeMs) await writePdf(path,item.text[type][language],type,item.headers?.[language]||await masterParagraphs(await pickMaster(paths,language)));
    }
    return {path,fileName:name,contentType:format==='pdf'?'application/pdf':'application/vnd.openxmlformats-officedocument.wordprocessingml.document'};
  }
  return {read:async job=>{const data=await read(job);return data?publicPackage(data):null;},prepare,download};
}
