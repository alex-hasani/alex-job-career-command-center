import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { openJobDatabase } from './job-database.mjs';
import { buildSourceSearchUrls } from './source-search-urls.mjs';
import { teachingOverview, teachingPaths } from './teaching-space.mjs';

const teachingRole = /\b(?:english|esl|efl|elt|teacher|teaching|tutor|trainer|instructor|educator|englisch|sprachtrainer|dozent|lehrkraft)\b/i;
const blockedRole = /\b(?:it administrator|software engineer|sales manager|refrigeration|purchasing)\b/i;
const statuses = new Set(['Not recorded','Stashed','Preparing','Applied','Interviewing','Offer','Rejected','Withdrawn','Case Closed','Silent']);

function publicUrl(value, posting=false) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || /^(?:localhost|127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|\[?::1\]?)/i.test(url.hostname)) return null;
    if (posting && /\b(?:login|signin|search|suche|tracker|redirect|click)\b/i.test(url.pathname)) return null;
    url.hash='';
    return url;
  } catch { return null; }
}

function flattenJsonLd(value) {
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  if (!value || typeof value !== 'object') return [];
  return [value, ...flattenJsonLd(value['@graph'] || [])];
}

function plain(value) {
  return String(value || '').replace(/<[^>]*>/g,' ').replace(/&(?:amp|nbsp|quot);/g,' ').replace(/\s+/g,' ').trim();
}

export function verifiedTeachingPosting(html, pageUrl, sourceName, now=new Date()) {
  const page=publicUrl(pageUrl,true);
  if (!page || typeof html !== 'string') return null;
  if (/\b(?:sign in to continue|log in to view this job|position is closed|job is no longer available)\b/i.test(html)) return null;
  const scripts=[...String(html).matchAll(/<script\b(?=[^>]*\btype\s*=\s*["']application\/ld\+json["'])[^>]*>([\s\S]*?)<\/script>/gi)];
  for (const script of scripts) {
    let parsed;
    try { parsed=JSON.parse(script[1]); } catch { continue; }
    for (const entry of flattenJsonLd(parsed)) {
      if (![entry['@type']].flat().some(type=>String(type).split('/').includes('JobPosting'))) continue;
      const title=plain(entry.title),company=plain(entry.hiringOrganization?.name);
      const address=Array.isArray(entry.jobLocation) ? entry.jobLocation[0]?.address : entry.jobLocation?.address;
      const location=plain([address?.addressLocality,address?.addressRegion,address?.addressCountry?.name || address?.addressCountry].filter(Boolean).join(', ')) || (entry.jobLocationType==='TELECOMMUTE' ? 'Remote' : '');
      const stated=entry.url ? publicUrl(entry.url,true) : page;
      if (!title || !company || !location || !stated || stated.origin!==page.origin || stated.pathname.replace(/\/$/,'')!==page.pathname.replace(/\/$/,'')) continue;
      if (!teachingRole.test(title) || blockedRole.test(title)) continue;
      if (entry.validThrough && Date.parse(entry.validThrough) < now.getTime()) continue;
      const description=plain(entry.description).slice(0,12000);
      if (/\b(?:C1|C2)\b.{0,45}\b(?:German|Deutsch)\b|\b(?:German|Deutsch)\b.{0,45}\b(?:C1|C2)\b|\bBAMF\b.{0,45}\b(?:required|erforderlich)\b/i.test(description)) continue;
      const country=String(address?.addressCountry?.name || address?.addressCountry || '');
      if (country && !/Germany|Deutschland|^DE$/i.test(country)) continue;
      return {
        id:`teaching:${page.href}`,origin:'live',title,company,location,url:page.href,
        description,source:sourceName,provider:sourceName,postedAt:entry.datePosted || '',
        workType:plain(entry.employmentType) || 'Not stated',remote:entry.jobLocationType==='TELECOMMUTE',
        match:Math.min(90,55+(description.match(/\b(?:lesson|classroom|english|children|learners|training|unterricht|lehrplan)\b/gi)||[]).length*4),
        recommendation:'REVIEW',verifiedAt:now.toISOString(),jdFetched:true,jdSource:page.href
      };
    }
  }
  return null;
}

function postingLinks(html, base) {
  const root=publicUrl(base);
  if (!root) return [];
  const matches=[...String(html).matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  return [...new Set(matches.filter(([,href,label])=>teachingRole.test(`${href} ${plain(label)}`)).map(([,href])=>{
    try { const url=publicUrl(new URL(href,root).href,true); return url?.origin===root.origin ? url.href : null; } catch { return null; }
  }).filter(Boolean))].slice(0,2);
}

async function fetchHtml(url, fetchImpl, timeoutMs=4500) {
  const response=await fetchImpl(url,{redirect:'manual',signal:AbortSignal.timeout(timeoutMs),headers:{accept:'text/html'}});
  if (!response.ok || !/text\/html/i.test(response.headers.get('content-type') || '')) return null;
  const content=await response.text();
  return content.length<=2_000_000 ? content : null;
}

export function createTeachingDashboard({workspace,fetchImpl=fetch}) {
  const paths=teachingPaths(workspace);
  const db=openJobDatabase(paths.database);
  let refreshPromise=null;

  async function overview() {
    const configured=await teachingOverview(workspace);
    return {...configured,liveSearchReady:true,jobs:db.listJobs({includeInactive:true}),databaseStats:db.stats(),savedSearches:db.listSavedSearches(),sourceStatus:db.latestProviderRuns(),refreshRunning:Boolean(refreshPromise)};
  }

  async function refresh({query='',location='Stuttgart'}={}) {
    if (refreshPromise) return refreshPromise;
    refreshPromise=(async()=>{
      const configured=await teachingOverview(workspace);
      const terms=(query.trim() ? [query.trim()] : configured.keywords).filter(term=>teachingRole.test(term)).slice(0,3);
      const selected=configured.sources;
      const checked=[],verified=[];
      let next=0;
      async function worker() {
        while(next<selected.length) {
          const source=selected[next++],started=Date.now();
          const template=/\bIndeed\b/i.test(source.name)?'https://de.indeed.com/jobs?q={keywords}&l={location}&fromage=7':/\bStepStone\b/i.test(source.name)?'https://www.stepstone.de/jobs/{keywordSlug}/in-{locationSlug}?radius=50':'';
          const urls=buildSourceSearchUrls({...source,searchUrlTemplate:template},terms,location).slice(0,1);
          const entryUrl=publicUrl(urls[0] || source.url);
          if(!entryUrl){checked.push({source:source.name,status:'unavailable',count:0,message:'Unsafe source URL'});continue;}
          try {
            const html=await fetchHtml(entryUrl.href,fetchImpl);
            if(!html){checked.push({source:source.name,status:'unavailable',count:0,message:'Source did not return an open HTML page',latencyMs:Date.now()-started});continue;}
            const candidates=[entryUrl.href,...postingLinks(html,entryUrl.href)];
            const found=[];
            for(const url of candidates) {
              if (verified.length>=12) break;
              const page=url===entryUrl.href ? html : await fetchHtml(url,fetchImpl).catch(()=>null);
              const job=page && verifiedTeachingPosting(page,url,source.name);
              if(job && !verified.some(item=>item.url===job.url)){verified.push(job);found.push(job);}
            }
            checked.push({source:source.name,status:found.length?'ok':'not_verified',count:found.length,jobs:found,latencyMs:Date.now()-started,message:found.length?'Exact open posting verified':'No exact open Teaching posting verified'});
          } catch(error) {checked.push({source:source.name,status:'unavailable',count:0,message:error.message,latencyMs:Date.now()-started});}
        }
      }
      await Promise.all(Array.from({length:Math.min(12,selected.length)},worker));
      db.saveRefresh(verified,checked,randomUUID());
      return {verified:verified.length,checked:checked.length,sourceStatus:checked,refreshedAt:new Date().toISOString(),jobs:db.listJobs({includeInactive:true}),databaseStats:db.stats()};
    })();
    try { return await refreshPromise; } finally {refreshPromise=null;}
  }

  function updateStatus(id,status,comment='') {
    if (!statuses.has(status)) throw new Error('Unsupported Teaching application status');
    const current=db.getJob(id);
    if (!current) throw new Error('Teaching job was not found');
    if (typeof comment!=='string' || comment.length>2000) throw new Error('Comment is too long');
    const statusChanged=status!==current.applicationStatus;
    return db.updateApplication(id,{applicationStatus:status,applicationComment:comment,...(statusChanged?{applicationStatusChangedAt:new Date().toISOString()}:{}),changeSource:'user'});
  }

  function saveSearch(name,criteria={}) {
    if(typeof name!=='string'||!name.trim()||name.length>100) throw new Error('Enter a search name of at most 100 characters');
    return db.saveSearch({name:name.trim(),criteria});
  }

  return {overview,refresh,updateStatus,saveSearch,deleteSearch:id=>db.deleteSearch(id),close:()=>db.db.close(),databasePath:paths.database};
}
