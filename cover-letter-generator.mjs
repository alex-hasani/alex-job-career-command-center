import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import {
  AlignmentType,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from 'docx';
import { canonicalResumeProfile } from './canonical-resume-profile.mjs';

const MAX_JD_LENGTH = 45000;
const MAX_LETTER_LENGTH = 12000;
const MAX_RESUME_LENGTH = 30000;
const MIN_PASTED_JD_LENGTH = 650;
const MIN_RETRIEVED_JD_LENGTH = 900;

const evidenceCatalogue = [
  {
    id:'ev.current.infrastructure',
    keywords:['windows server','linux','server','infrastructure','datacenter','data center','patching','availability','incident','hardware','provisioning'],
    de:'Im aktuellen Beispielprofil umfasst die Systemadministration Windows- und Linux-Infrastruktur mit Provisionierung, Patching, Verfügbarkeitsüberwachung, Automatisierung und Incident-Lösung.',
    en:'In the current example profile, systems administration covers Windows and Linux infrastructure, provisioning, patching, availability monitoring, automation and incident resolution.'
  },
  {
    id:'ev.global.operations',
    keywords:['vmware','vsphere','virtualization','virtualisation','windows','linux','lifecycle','migration','global support','troubleshooting','recovery'],
    de:'Das Beispielprofil belegt plattformübergreifende Arbeit mit Windows, Linux und VMware vSphere sowie Lifecycle-Management, Troubleshooting, Recovery und kontrollierte Changes.',
    en:'The example profile demonstrates cross-platform work with Windows, Linux and VMware vSphere, including lifecycle management, troubleshooting, recovery and controlled changes.'
  },
  {
    id:'ev.cloud.hybrid',
    keywords:['azure','hybrid cloud','hybrid-cloud','network','vpn','firewall','active directory','entra','office 365','microsoft 365','backup','restore','it manager'],
    de:'Das Beispielprofil enthält praktische Arbeit mit Microsoft 365, Azure sowie Windows- und Linux-Systemen beim Aufbau hybrider Infrastruktur und Netzwerke.',
    en:'The example profile includes practical work with Microsoft 365, Azure, Windows and Linux systems while building hybrid infrastructure and networks.'
  },
  {
    id:'ev.support.m365',
    keywords:['microsoft 365','m365','office 365','exchange online','intune','azure ad','entra id','rights management','fasttrack'],
    de:'Die Microsoft-365-Erfahrung im Beispielprofil umfasst Onboarding und Support für Exchange Online, Intune und Entra ID.',
    en:'Microsoft 365 experience in the example profile includes onboarding and support across Exchange Online, Intune and Entra ID.'
  },
  {
    id:'ev.reference.current',
    keywords:['security','vulnerability','automation','quality','teamwork','communication','service continuity','servicekontinuität','stability','stabilität'],
    de:'Die Demo-Evidenz zeigt Beiträge zu Automatisierung, Server-Sicherheit, Zusammenarbeit und stabilem Rechenzentrumsbetrieb.',
    en:'The demo evidence shows contributions to automation, server security, collaboration and stable datacentre operations.'
  }
];

function safeSlug(value, fallback='application') {
  const normal = String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64);
  return normal || fallback;
}

function packageKey(job) {
  const digest = createHash('sha256').update(String(job.id || `${job.company}|${job.title}|${job.url}`)).digest('hex').slice(0, 12);
  return `${safeSlug(job.company)}_${safeSlug(job.title)}_${digest}`;
}

function decodeHtml(value='') {
  const entities = { amp:'&', lt:'<', gt:'>', quot:'"', apos:"'", nbsp:' ' };
  return String(value)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (all, name) => entities[name.toLowerCase()] ?? all);
}

function cleanText(value='') {
  return decodeHtml(String(value))
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractStructuredPosting(html) {
  const scripts = [...String(html).matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const match of scripts) {
    try {
      const parsed = JSON.parse(match[1]);
      const values = Array.isArray(parsed) ? parsed : parsed?.['@graph'] || [parsed];
      const posting = values.find(item => String(item?.['@type'] || '').toLowerCase().includes('jobposting'));
      if (!posting) continue;
      const text = cleanText([posting.title, posting.description, posting.responsibilities, posting.qualifications, posting.skills].filter(Boolean).join(' '));
      if (isCompleteJobDescription(text, MIN_RETRIEVED_JD_LENGTH)) return text;
    } catch {}
  }
  return '';
}

function extractMainPosting(html) {
  const candidates = [];
  const patterns = [
    /<main\b[^>]*>([\s\S]*?)<\/main>/gi,
    /<article\b[^>]*>([\s\S]*?)<\/article>/gi,
    /<(?:section|div)\b[^>]*(?:id|class)=["'][^"']*(?:job[-_ ]?description|job[-_ ]?details|stellenbeschreibung|description|vacancy)[^"']*["'][^>]*>([\s\S]*?)<\/(?:section|div)>/gi
  ];
  for (const pattern of patterns) {
    for (const match of String(html).matchAll(pattern)) candidates.push(cleanText(match[1]).slice(0, MAX_JD_LENGTH));
  }
  return candidates.sort((a,b) => b.length - a.length).find(text => isCompleteJobDescription(text, MIN_RETRIEVED_JD_LENGTH)) || '';
}

function extractChinaJobPosting(html) {
  const source = String(html);
  const title = cleanText((source.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i) || [,''])[1]);
  const starts = [
    source.search(/<strong>\s*About Company:\s*<\/strong>/i),
    source.search(/<strong>\s*Job Details:\s*<\/strong>/i),
    source.search(/<p\b[^>]*class=["'][^"']*fwb[^"']*["'][^>]*>\s*Responsibilities:\s*<\/p>/i)
  ].filter(index => index >= 0);
  if (!starts.length) return '';

  const start = Math.min(...starts);
  const tail = source.slice(start);
  const endMatch = tail.search(/<a\b[^>]+href=["'][^"']*(?:jobapply\.php|candidate\/login\.php)[^"']*["'][^>]*>/i);
  const bounded = tail.slice(0, endMatch >= 0 ? endMatch : Math.min(tail.length, 150000));
  const text = cleanText([title, bounded].filter(Boolean).join(' ')).slice(0, MAX_JD_LENGTH);
  return isCompleteJobDescription(text, MIN_RETRIEVED_JD_LENGTH) ? text : '';
}

export function isCompleteJobDescription(text, minimumLength=MIN_RETRIEVED_JD_LENGTH) {
  const value = cleanText(text);
  if (value.length < minimumLength || /\.\.\.|…/.test(value.slice(-80))) return false;
  const words = value.match(/[\p{L}\p{N}][\p{L}\p{N}+.#/-]*/gu) || [];
  const responsibilitySignals = [
    /\b(aufgaben|verantwortung|tätigkeiten|das erwartet sie|ihre rolle|deine aufgaben)\b/i,
    /\b(responsibilities|what you(?:'|’)?ll do|what you will do|your role|the role|key duties)\b/i
  ].filter(pattern => pattern.test(value)).length;
  const requirementSignals = [
    /\b(anforderungen|profil|qualifikation|das bringen sie mit|dein profil|kenntnisse|erfahrung)\b/i,
    /\b(requirements|qualifications|what you(?:'|’)?ll bring|what you bring|skills|experience)\b/i
  ].filter(pattern => pattern.test(value)).length;
  const roleSignals = (value.match(/\b(server|infrastructure|cloud|system|administrator|engineer|betrieb|operations|support)\b/gi) || []).length;
  const dutySignals = (value.match(/\b(responsible|develop|design|build|operate|maintain|support|manage|implement|monitor|troubleshoot|collaborate|lead|deliver|ensure|administer|verantwort|entwick|betreib|wart|unterstütz|implement|überwach|administrier)\w*/gi) || []).length;
  const structuredLongPosting = value.length >= Math.max(1500, minimumLength) && requirementSignals >= 1 && dutySignals >= 4;
  // Pasted job descriptions often lose headings while copying from LinkedIn or
  // an ATS.  A sufficiently long, lexical document with several duty verbs is
  // still trustworthy; do not reject it solely because section labels vanished.
  const substantialPastedPosting = minimumLength <= MIN_PASTED_JD_LENGTH && (
    (words.length >= 90 && dutySignals >= 3 && roleSignals >= 2) ||
    // Full-page copies often lose headings and grammar during clipboard
    // conversion. At this size the supplied text can be used conservatively
    // without asking the user to manually curate individual sections.
    (words.length >= 180 && value.length >= 1500)
  );
  return roleSignals >= 3 && ((responsibilitySignals >= 1 && requirementSignals >= 1) || structuredLongPosting) || substantialPastedPosting;
}

function identityTokens(value, excluded=new Set()) {
  return cleanText(value).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/).filter(token => token.length >= 4 && !excluded.has(token));
}

function postingMatchesJob(text, job) {
  const haystack = cleanText(text).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const companyExcluded = new Set(['gmbh','company','gruppe','group','services','service']);
  const titleExcluded = new Set(['system','engineer','engineering','infrastructure','hybrid','cloud','onprem','client','services']);
  const companyTokens = identityTokens(job.company, companyExcluded);
  const titleTokens = identityTokens(job.title, titleExcluded);
  const companyMatch = companyTokens.some(token => haystack.includes(token));
  const titleMatches = titleTokens.filter(token => haystack.includes(token)).length;
  return companyMatch || (titleTokens.length >= 2 && titleMatches >= Math.min(3, titleTokens.length));
}

function readerText(markdown='') {
  const value = String(markdown);
  const content = value.includes('Markdown Content:') ? value.split('Markdown Content:').slice(1).join('Markdown Content:') : value;
  return cleanText(content
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*]\s+/gm, ''));
}

async function fetchDirectPosting(url) {
  const response = await fetch(url, {
    redirect:'follow',
    signal:AbortSignal.timeout(12000),
    headers:{
      'accept':'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.7',
      'accept-language':'de-DE,de;q=0.9,en;q=0.8',
      'user-agent':'Mozilla/5.0 (compatible; AlexJobDashboard/1.0; personal application preparation)'
    }
  });
  if (!response.ok) throw new Error(`posting returned HTTP ${response.status}`);
  const html = (await response.text()).slice(0, 1000000);
  const host = new URL(response.url || url).hostname.toLowerCase();
  const sitePosting = host === 'chinajob.com' || host.endsWith('.chinajob.com')
    ? extractChinaJobPosting(html)
    : '';
  return { text:sitePosting || extractStructuredPosting(html) || extractMainPosting(html), method:'direct' };
}

async function fetchReaderPosting(url) {
  const readerUrl = `https://r.jina.ai/${url.href}`;
  const response = await fetch(readerUrl, {
    redirect:'follow',
    signal:AbortSignal.timeout(30000),
    headers:{ 'accept':'text/plain', 'user-agent':'Mozilla/5.0 (compatible; AlexJobDashboard/1.0; personal application preparation)' }
  });
  if (!response.ok) throw new Error(`public text reader returned HTTP ${response.status}`);
  return { text:readerText((await response.text()).slice(0, 1000000)), method:'reader' };
}

async function fetchBrowserPosting(url) {
  const { chromium } = await import('playwright');
  const executablePath = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ].find(existsSync);
  if (!executablePath) throw new Error('no local browser is available');
  const browser = await chromium.launch({ headless:true, executablePath });
  try {
    const page = await browser.newPage({ locale:'de-DE', userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36' });
    await page.goto(url.href, { waitUntil:'domcontentloaded', timeout:45000 });
    await page.waitForTimeout(1800);
    const html = (await page.content()).slice(0, 1500000);
    const bodyText = cleanText(await page.locator('body').innerText({ timeout:10000 })).slice(0, MAX_JD_LENGTH);
    return { text:extractStructuredPosting(html) || extractMainPosting(html) || bodyText, method:'browser' };
  } finally { await browser.close(); }
}

function linkedInJobId(url) {
  const ids = [...String(url?.pathname || '').matchAll(/(\d{8,})/g)].map(match => match[1]);
  return ids.at(-1) || '';
}

async function fetchLinkedInGuestPosting(url) {
  const id = linkedInJobId(url);
  if (!id) throw new Error('LinkedIn job ID was not found in the posting URL');
  const response = await fetch(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${encodeURIComponent(id)}`, {
    redirect:'follow',
    signal:AbortSignal.timeout(20000),
    headers:{
      'accept':'text/html,application/xhtml+xml',
      'accept-language':'de-DE,de;q=0.9,en;q=0.8',
      'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36'
    }
  });
  if (!response.ok) throw new Error(`LinkedIn guest posting returned HTTP ${response.status}`);
  const html = (await response.text()).slice(0, 1000000);
  const description = cleanText((html.match(/<div\b[^>]*class=["'][^"']*show-more-less-html__markup[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) || [,''])[1]);
  const title = cleanText((html.match(/<h2\b[^>]*class=["'][^"']*top-card-layout__title[^"']*["'][^>]*>([\s\S]*?)<\/h2>/i) || [,''])[1]);
  const text = cleanText([title, description].filter(Boolean).join(' ')).slice(0, MAX_JD_LENGTH);
  if (!text) throw new Error('LinkedIn guest posting did not expose the JD');
  return { text, method:'linkedin-guest' };
}
async function fetchFederalPosting(job) {
  const base = 'https://rest.arbeitsagentur.de/jobboerse/jobsuche-service';
  const location = cleanText(job.location).split(/[,/|]/)[0].trim();
  const params = new URLSearchParams({ angebotsart:'1', was:cleanText(job.title), page:'1', size:'25' });
  if (location && !/remote|germany|deutschland/i.test(location)) params.set('wo', location);
  const response = await fetch(`${base}/pc/v6/jobs?${params}`, {
    signal:AbortSignal.timeout(20000),
    headers:{ 'X-API-Key':'jobboerse-jobsuche', 'accept':'application/json' }
  });
  if (!response.ok) throw new Error(`federal job search returned HTTP ${response.status}`);
  const candidates = (await response.json()).ergebnisliste || [];
  const titleTokens = identityTokens(job.title, new Set(['system','engineer','engineering','infrastructure','hybrid','cloud','onprem','client','services']));
  const companyTokens = identityTokens(job.company, new Set(['gmbh','company','gruppe','group','services','service']));
  const ranked = candidates.map(candidate => {
    const text = `${candidate.stellenangebotsTitel || ''} ${candidate.firma || ''}`.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
    const titleScore = titleTokens.filter(token => text.includes(token)).length;
    const companyScore = companyTokens.filter(token => text.includes(token)).length;
    return { candidate, score:titleScore * 2 + companyScore * 4, companyScore };
  }).filter(item => item.companyScore > 0).sort((a,b) => b.score - a.score);
  const match = ranked[0]?.candidate;
  if (!match?.referenznummer) throw new Error('no matching federal job record was found');
  const code = Buffer.from(match.referenznummer).toString('base64');
  const detailsResponse = await fetch(`${base}/pc/v4/jobdetails/${encodeURIComponent(code)}`, {
    signal:AbortSignal.timeout(20000),
    headers:{ 'X-API-Key':'jobboerse-jobsuche', 'accept':'application/json' }
  });
  if (!detailsResponse.ok) throw new Error(`federal job details returned HTTP ${detailsResponse.status}`);
  const details = await detailsResponse.json();
  return cleanText([details.stellenangebotsTitel, match.firma, details.stellenangebotsBeschreibung].filter(Boolean).join('\n'));
}

function safePostingUrl(value) {
  const url = new URL(String(value || ''));
  if (!['http:','https:'].includes(url.protocol)) throw new Error('The exact posting URL must use HTTP or HTTPS');
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host === '::1' || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) throw new Error('Private network URLs cannot be retrieved');
  return url;
}

async function retrievePosting(job, suppliedDescription='') {
  const supplied = cleanText(suppliedDescription).slice(0, MAX_JD_LENGTH);
  if (supplied && !isCompleteJobDescription(supplied, MIN_PASTED_JD_LENGTH)) {
    const wordCount = (supplied.match(/[\p{L}\p{N}][\p{L}\p{N}+.#/-]*/gu) || []).length;
    return { text:supplied, source:'incomplete user-pasted text', retrievedAt:new Date().toISOString(), complete:false, retrievalError:`The pasted text has ${wordCount} words and ${supplied.length} characters. Paste the responsibilities and requirements as well as the role overview.` };
  }
  if (supplied) return { text:supplied, source:'user-pasted full job description', retrievedAt:new Date().toISOString(), complete:true };
  const existing = cleanText([job.description, job.jdSnapshot].filter(Boolean).join(' ')).slice(0, MAX_JD_LENGTH);
  let retrievalError = '';
  if (job.url) {
    const url = safePostingUrl(job.url);
    const isLinkedIn = /(?:^|\.)linkedin\.com$/i.test(url.hostname);
    const preferReader = /(?:stepstone|jobtome|indeed|glassdoor|xing)\./i.test(url.hostname);
    const attempts = isLinkedIn
      ? [fetchLinkedInGuestPosting, fetchReaderPosting, fetchDirectPosting, fetchBrowserPosting]
      : preferReader
        ? [fetchReaderPosting, fetchDirectPosting, fetchBrowserPosting]
        : [fetchDirectPosting, fetchReaderPosting, fetchBrowserPosting];
    const errors = [];
    for (const attempt of attempts) {
      try {
        const result = await attempt(url);
        if (!isCompleteJobDescription(result.text, MIN_RETRIEVED_JD_LENGTH)) throw new Error('page did not expose both complete responsibilities and requirements');
        if (!postingMatchesJob(result.text, job)) throw new Error('page content did not match the selected company or role');
        return { text:result.text, source:result.method === 'linkedin-guest' ? 'exact LinkedIn guest posting' : result.method === 'reader' ? 'exact posting via public text reader' : result.method === 'browser' ? 'exact posting rendered in local browser' : 'exact posting page content', retrievedAt:new Date().toISOString(), complete:true };
      } catch (error) { errors.push(`${attempt === fetchLinkedInGuestPosting ? 'linkedin-guest' : attempt === fetchReaderPosting ? 'reader' : attempt === fetchBrowserPosting ? 'browser' : 'direct'}: ${error.message}`); }
    }
    try {
      const federalText = await fetchFederalPosting(job);
      if (!isCompleteJobDescription(federalText, MIN_RETRIEVED_JD_LENGTH)) throw new Error('federal record did not contain complete responsibilities and requirements');
      if (!postingMatchesJob(federalText, job)) throw new Error('federal record did not match the selected company or role');
      return { text:federalText, source:'exact posting via federal job database', retrievedAt:new Date().toISOString(), complete:true };
    } catch (error) { errors.push(`federal: ${error.message}`); }
    retrievalError = errors.join(' | ');
  }
  if (isCompleteJobDescription(existing, 1400)) return { text:existing, source:'stored full tracker JD snapshot', retrievedAt:new Date().toISOString(), complete:true, retrievalError };
  return {
    text:existing,
    source:existing ? 'incomplete stored tracker summary' : 'none',
    retrievedAt:new Date().toISOString(),
    complete:false,
    retrievalError:retrievalError
      ? 'The job website blocked automatic reading. Paste the complete page text once; Alex Job will identify the useful job-description content itself.'
      : 'A full exact JD is not available. Paste the complete page text and Alex Job will extract the relevant content.',
    retrievalDiagnostics:retrievalError
  };
}

function rankEvidence(jd) {
  const text = jd.toLowerCase();
  return evidenceCatalogue
    .map(item => ({ ...item, score:item.keywords.reduce((sum, keyword) => sum + (text.includes(keyword) ? (keyword.includes(' ') ? 3 : 1) : 0), 0) }))
    .sort((a,b) => b.score - a.score)
    .filter((item,index) => item.score > 0 || index < 2)
    .slice(0, 3);
}

function salientRequirements(jd, language) {
  const categories = [
    ['Windows Server / Active Directory','Windows Server / Active Directory', /windows server|active directory|group policy|gpo/i],
    ['Linux-Administration','Linux administration', /\blinux\b|red hat|rhel|ubuntu|oracle linux/i],
    ['Microsoft Azure / Hybrid Cloud','Microsoft Azure / hybrid cloud', /\bazure\b|hybrid cloud|cloud infrastructure/i],
    ['Microsoft 365 / Entra ID','Microsoft 365 / Entra ID', /microsoft 365|m365|office 365|entra id|azure ad|exchange online|intune/i],
    ['VMware / Virtualisierung','VMware / virtualisation', /vmware|vsphere|virtuali[sz]/i],
    ['Automatisierung und Scripting','automation and scripting', /ansible|powershell|\bbash\b|automation|scripting/i],
    ['IT-Betrieb und Incident Management','IT operations and incident management', /incident|operations|betrieb|troubleshooting|service continuity|itil/i],
    ['Infrastruktur-Sicherheit','infrastructure security', /security|sicherheit|vulnerability|hardening|patch management/i],
    ['Rechenzentrums-Infrastruktur','datacentre infrastructure', /datacenter|data center|rechenzentrum|server hardware/i]
  ];
  const found = categories.filter(([, ,pattern]) => pattern.test(jd)).map(([de,en]) => language === 'de' ? de : en).slice(0, 4);
  if (found.length) return found;
  return language === 'de' ? ['Infrastruktur-Betrieb','technische Problemlösung'] : ['infrastructure operations','technical troubleshooting'];
}

function formatGermanDate(date=new Date()) {
  return new Intl.DateTimeFormat('de-DE', { day:'numeric', month:'long', year:'numeric', timeZone:'Europe/Berlin' }).format(date);
}

function formatEnglishDate(date=new Date()) {
  return new Intl.DateTimeFormat('en-GB', { day:'numeric', month:'long', year:'numeric', timeZone:'Europe/Berlin' }).format(date);
}

function draftLetter(job, posting, languagePreference) {
  const preference = String(languagePreference || '').toLowerCase();
  if (!['de','en'].includes(preference)) throw new Error('Choose German or English before generating the cover letter');
  const language = preference;
  const evidence = rankEvidence(posting.text);
  const requirements = salientRequirements(posting.text, language);
  const company = job.company || (language === 'de' ? 'Ihrem Unternehmen' : 'your organisation');
  const title = job.title || (language === 'de' ? 'die ausgeschriebene Position' : 'the advertised position');
  const requirementPhrase = requirements.slice(0,3).join(language === 'de' ? ', ' : ', ');
  const paragraphs = language === 'de' ? [
    `Die Position ${title} bei ${company} interessiert mich, weil sie ${requirementPhrase} mit zuverlässigem, serviceorientiertem Infrastruktur-Betrieb verbindet. Meine mehrjährige Erfahrung in Systemadministration und IT-Infrastruktur bietet dafür eine relevante praktische Grundlage, ohne die Besonderheiten Ihrer konkreten Umgebung vorwegzunehmen.`,
    evidence[0].de,
    `${evidence[1]?.de || evidence[0].de} Daraus ergeben sich nachvollziehbare Berührungspunkte mit ${requirements.slice(0,3).join(', ')} sowie mit Incident-, Change- und Freigabeprozessen.`,
    `Meine Sprachkenntnisse und Arbeitserlaubnis werden ausschließlich aus dem verifizierten lokalen Profil übernommen. In einem Gespräch würde ich gern mehr über Ihre konkrete Umgebung und Prioritäten erfahren und gemeinsam prüfen, wo meine Erfahrung ${company} sinnvoll unterstützen kann.`
  ] : [
    `The ${title} opportunity at ${company} interests me because it combines ${requirementPhrase} with reliable, service-oriented infrastructure operations. My years of experience in systems administration and IT infrastructure provide a relevant practical foundation, while I would not presume to know the specifics of your environment before speaking with the team.`,
    evidence[0].en,
    `${evidence[1]?.en || evidence[0].en} This gives me credible points of connection with ${requirements.slice(0,3).join(', ')}, together with incident, change and release processes.`,
    `Language proficiency and work authorisation are taken only from the verified local profile. I would welcome a conversation to understand your environment and priorities more fully and to explore where my experience could usefully support ${company}.`
  ];
  const greeting = language === 'de' ? 'Sehr geehrte Damen und Herren,' : `Dear ${company} Recruitment Team,`;
  const closing = language === 'de' ? 'Mit freundlichen Grüßen' : 'Yours sincerely';
  const subject = language === 'de' ? `Bewerbung als ${title}` : `Application for ${title}`;
  const date = language === 'de' ? formatGermanDate() : formatEnglishDate();
  const signer = canonicalResumeProfile.identity.name;
  const body = [greeting, ...paragraphs, closing, signer].join('\n\n');
  return { language, languagePreference:preference, subject, date, greeting, paragraphs, closing, signer, body, evidenceIds:[...new Set(evidence.map(item => item.id))], requirements };
}

export function buildApplicationRemarks(job, posting, languagePreference) {
  const language = String(languagePreference || '').toLowerCase() === 'en' ? 'en' : 'de';
  const title = cleanText(job.title || (language === 'de' ? 'die ausgeschriebene Position' : 'the advertised position'));
  const company = cleanText(job.company || (language === 'de' ? 'Ihrem Unternehmen' : 'your organisation'));
  const requirements = salientRequirements(posting.text, language).slice(0, 2);
  const body = language === 'de'
    ? `Ergänzend zu meiner Bewerbung als ${title} bei ${company}: Besonders relevant sind meine praktischen Berührungspunkte mit ${requirements.join(' und ')}. Angaben zu Verfügbarkeit, Arbeitserlaubnis und Führerschein werden aus dem verifizierten lokalen Profil übernommen. Für Rückfragen oder ein persönliches Gespräch stehe ich gern zur Verfügung.`
    : `Additional note regarding my application for ${title} at ${company}: My practical background is particularly relevant to ${requirements.join(' and ')}. Availability, work authorisation and driving-licence details are taken from the verified local profile. I would be pleased to answer any questions in an interview.`;
  return { language, body, manualEdited:false, evidenceIds:['ev.identity.work_authorisation','ev.identity.driving_licence'] };
}

const clusterDefinitions = {
  azure:{ patterns:/azure|entra|hybrid cloud|cloud infrastructure|microsoft 365|m365|ad connect|vnet|bastion|nsg/gi, headline:{de:'Senior Infrastructure Engineer | Azure & Hybrid Cloud',en:'Senior Infrastructure Engineer | Azure & Hybrid Cloud'}, order:['azure','microsoft','virtualization','automation','operations','linux','networking'] },
  microsoft:{ patterns:/windows server|active directory|gpo|microsoft infrastructure|exchange online|intune|office 365/gi, headline:{de:'Senior Systems Engineer | Microsoft-Infrastruktur & Virtualisierung',en:'Senior Systems Engineer | Microsoft Infrastructure & Virtualisation'}, order:['microsoft','virtualization','azure','operations','automation','linux','networking'] },
  virtualization:{ patterns:/vmware|vsphere|vcenter|esxi|virtuali[sz]|datacenter|data center|rechenzentrum/gi, headline:{de:'Senior Infrastructure Engineer | Windows · Linux · VMware',en:'Senior Infrastructure Engineer | Windows · Linux · VMware'}, order:['virtualization','microsoft','linux','operations','automation','azure','networking'] },
  automation:{ patterns:/ansible|automation|automatisierung|powershell|bash|python|scripting/gi, headline:{de:'Senior Infrastructure Engineer | Betrieb & Automatisierung',en:'Senior Infrastructure Engineer | Operations & Automation'}, order:['automation','linux','microsoft','operations','virtualization','azure','networking'] },
  lead:{ patterns:/technical lead|team lead|infrastructure lead|leitung|ownership|verantwortung|architect/gi, headline:{de:'Infrastructure Lead | Enterprise Systems & Hybrid Cloud',en:'Infrastructure Lead | Enterprise Systems & Hybrid Cloud'}, order:['operations','azure','microsoft','virtualization','automation','linux','networking'] },
  general:{ patterns:/infrastructure|system engineer|systemadministrator|systems administrator|it infrastructure/gi, headline:{de:'Senior Infrastructure Engineer | Enterprise Systems',en:'Senior Infrastructure Engineer | Enterprise Systems'}, order:['microsoft','linux','virtualization','operations','azure','automation','networking'] }
};

function determineCluster(jd='') {
  const scores = Object.entries(clusterDefinitions).map(([id, definition]) => ({ id, score:(String(jd).match(definition.patterns) || []).length }));
  return scores.sort((a,b) => b.score - a.score)[0]?.score ? scores.sort((a,b) => b.score - a.score)[0].id : 'general';
}

function jdTokens(jd='') {
  const ignored = new Set(['and','the','with','for','from','oder','und','der','die','das','eine','einer','your','you','our','will','this','that','have','work','team','role','job','skills','experience','kenntnisse','erfahrung','aufgaben','profil','responsibilities','requirements']);
  return [...new Set(cleanText(jd).toLowerCase().split(/[^\p{L}\p{N}+#.]+/u).filter(token => token.length >= 4 && !ignored.has(token)))];
}

function bulletRelevance(bullet, tokens, cluster) {
  const haystack = `${bullet.tags.join(' ')} ${bullet.de} ${bullet.en}`.toLowerCase();
  const tokenScore = tokens.reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
  const clusterBoosts = { azure:['azure','hybrid','identity','m365','networking'], microsoft:['windows','microsoft','identity','m365'], virtualization:['vmware','virtualization','datacenter','hardware'], automation:['automation','ansible','bash','python','powershell'], lead:['lead','project','architecture','scale'], general:['windows','linux','operations','server'] };
  return tokenScore + (clusterBoosts[cluster] || []).reduce((score, tag) => score + (bullet.tags.includes(tag) ? 2 : 0), 0);
}

function topBullets(role, tokens, cluster, limit) {
  return role.bullets.map((bullet,index) => ({ bullet,index,score:bulletRelevance(bullet,tokens,cluster) }))
    .sort((a,b) => b.score - a.score || a.index - b.index).slice(0, limit).sort((a,b) => a.index - b.index).map(item => item.bullet);
}

function summaryFor(cluster, language) {
  const values = {
    azure:{ de:'Infrastructure Engineer mit Erfahrung im Betrieb von Windows-, Linux- und VMware-Umgebungen sowie im Aufbau hybrider Azure-Infrastruktur. Verbindet stabilen Infrastruktur-Betrieb mit Azure, Identität, Migration, Recovery und Automatisierung.', en:'Infrastructure Engineer experienced in Windows, Linux and VMware operations and in building hybrid Azure infrastructure. Combines reliable operations with Azure, identity, migration, recovery and automation.' },
    microsoft:{ de:'Systems Engineer mit Erfahrung in Windows Server, Active Directory, Microsoft 365 sowie Linux- und VMware-Betrieb. Verbindet Microsoft-Infrastruktur mit Hybrid Identity, Lifecycle, Recovery und strukturierten ITSM-Prozessen.', en:'Systems Engineer experienced across Windows Server, Active Directory, Microsoft 365, Linux and VMware operations. Connects Microsoft infrastructure with hybrid identity, lifecycle, recovery and structured ITSM processes.' },
    virtualization:{ de:'Infrastructure Engineer mit Erfahrung in Windows-, Linux- und VMware-Umgebungen, Rechenzentrumsmigrationen und Server-Lifecycle. Verbindet Virtualisierung, Hardware, Recovery und kontrollierte Betriebsprozesse.', en:'Infrastructure Engineer experienced across Windows, Linux and VMware environments, datacentre migrations and server lifecycle. Combines virtualisation, hardware, recovery and controlled operational processes.' },
    automation:{ de:'Infrastructure Engineer mit Erfahrung im Windows-/Linux-Betrieb und in der Automatisierung administrativer Abläufe. Verbindet Enterprise Operations, Troubleshooting und Lifecycle mit Bash, Ansible sowie praktischen PowerShell-/Python-Kenntnissen.', en:'Infrastructure Engineer with Windows and Linux operations experience and a focus on automating administration. Combines enterprise operations, troubleshooting and lifecycle with Bash, Ansible and practical PowerShell/Python knowledge.' },
    lead:{ de:'Infrastructure Engineer und ehemaliger IT Manager mit Erfahrung in Enterprise Operations, hybrider Infrastruktur und technischer Koordination. Verbindet technische Ownership, Migration, Recovery und teamübergreifende Zusammenarbeit.', en:'Infrastructure Engineer and former IT Manager experienced in enterprise operations, hybrid infrastructure and technical coordination. Combines technical ownership, migration, recovery and cross-team collaboration.' },
    general:{ de:'Infrastructure Engineer mit Erfahrung im Betrieb von Windows-, Linux-, VMware- und hybriden Azure-Umgebungen. Schwerpunkte sind stabiler Betrieb, Migration, Recovery, Lifecycle und Automatisierung.', en:'Infrastructure Engineer experienced in Windows, Linux, VMware and hybrid Azure environments. Focus areas include reliable operations, migration, recovery, lifecycle and automation.' }
  };
  return values[cluster]?.[language] || values.general[language];
}

function resumeSectionLabels(language) {
  return language === 'de' ? {
    qualifications:'KERNQUALIFIKATIONEN', skills:'TECHNISCHE KOMPETENZEN', experience:'BERUFSERFAHRUNG', development:'ZERTIFIZIERUNGEN & AKTUELLE WEITERENTWICKLUNG', education:'AUSBILDUNG', languages:'SPRACHEN & WEITERE ANGABEN'
  } : {
    qualifications:'KEY QUALIFICATIONS', skills:'TECHNICAL COMPETENCIES', experience:'PROFESSIONAL EXPERIENCE', development:'CERTIFICATIONS & CURRENT DEVELOPMENT', education:'EDUCATION', languages:'LANGUAGES & ADDITIONAL INFORMATION'
  };
}

function localizedSkillItems(group, language) {
  if (language !== 'de') return group.items;
  const translations = new Map([
    ['Host maintenance','Host-Wartung'],['VM provisioning','VM-Provisionierung'],['Datacentre migrations','Rechenzentrumsmigrationen'],
    ['PowerShell (praktische Kenntnisse / practical knowledge)','PowerShell (praktische Kenntnisse)'],['Python (praktische Kenntnisse / practical knowledge)','Python (praktische Kenntnisse)'],
    ['Package, service, permission, storage and lifecycle administration','Paket-, Service-, Berechtigungs-, Storage- und Lifecycle-Administration'],
    ['Incident Management','Incident Management'],['Problem Management','Problem Management'],['Change Management','Change Management'],
    ['Server lifecycle','Server-Lifecycle'],['Firewall rules','Firewall-Regeln']
  ]);
  return group.items.map(item => translations.get(item) || item);
}

export function buildResume(job, posting, language='de') {
  const profile = canonicalResumeProfile;
  const cluster = determineCluster(posting.text);
  const definition = clusterDefinitions[cluster];
  const tokens = jdTokens(posting.text);
  const skills = definition.order.map(id => profile.skills.find(group => group.id === id)).filter(Boolean);
  const roleLimits = { 'current-infrastructure':5, 'global-operations':5, 'regional-operations':3, 'cloud-lead':cluster === 'azure' || cluster === 'lead' ? 5 : 3, 'platform-operations':2, 'm365-support':cluster === 'microsoft' ? 2 : 1 };
  const roles = profile.roles.map(role => ({ ...role, selectedBullets:topBullets(role,tokens,cluster,roleLimits[role.id] || 2) }));
  const allSelected = roles.flatMap(role => role.selectedBullets.map(bullet => ({ role, bullet, score:bulletRelevance(bullet,tokens,cluster) })));
  const keyQualifications = allSelected.sort((a,b) => b.score - a.score).slice(0,5).map(item => item.bullet[language]);
  const requirements = salientRequirements(posting.text, language);
  const labels = resumeSectionLabels(language);
  const lines = [
    profile.identity.name,
    definition.headline[language],
    `${profile.identity.location} | ${profile.identity.phone} | ${profile.identity.email} | LinkedIn: ${profile.identity.linkedin}`,
    profile.identity.workAuthorisation[language],
    '',
    summaryFor(cluster, language),
    '', labels.qualifications,
    ...keyQualifications.map(value => `• ${value}`),
    '', labels.skills,
    ...skills.map(group => `${group.label[language]}: ${localizedSkillItems(group,language).join(', ')}`),
    '', labels.experience,
    ...roles.flatMap(role => [`${role.officialTitle[language]} | ${role.employer} | ${role.location} | ${role.dates[language]}`, ...role.selectedBullets.map(value => `• ${value[language]}`)]),
    profile.earlierExperience[language],
    '', labels.development,
    ...profile.development[language].map(value => `• ${value}`),
    '', labels.education,
    ...profile.education.map(value => `• ${value[language]}`),
    '', labels.languages,
    ...profile.languages[language].map(value => `• ${value}`)
  ];
  const verifiedTerms = skills.flatMap(group => group.items).filter(item => tokens.some(token => item.toLowerCase().includes(token))).slice(0,12);
  const omittedGaps = profile.boundaries.flatMap(boundary => boundary.terms.filter(term => tokens.some(token => term.includes(token) || token.includes(term))).map(term => ({ term, reason:boundary.reason[language] })));
  const highlightedRoles = roles.map(role => ({ role, score:role.selectedBullets.reduce((sum,bullet) => sum + bulletRelevance(bullet,tokens,cluster),0) })).sort((a,b) => b.score-a.score).slice(0,3).map(item => item.role.employer);
  return {
    language,
    body:lines.join('\n').replace(/\n{3,}/g,'\n\n'),
    headline:definition.headline[language],
    summary:summaryFor(cluster, language),
    keyQualifications,
    skillGroups:skills,
    roles,
    labels,
    evidenceIds:[...new Set([...skills.flatMap(group => group.evidence), ...roles.flatMap(role => role.evidence)])],
    customization:{
      cluster,
      headlineChanged:`${profile.baseHeadline[language]} → ${definition.headline[language]}`,
      skillsPromoted:skills.slice(0,3).map(group => group.label[language]),
      experienceEmphasized:highlightedRoles,
      experienceCompressed:roles.filter(role => role.selectedBullets.length <= 2).map(role => role.employer),
      verifiedKeywords:verifiedTerms,
      gapsNotAdded:omittedGaps,
      matchedRequirements:requirements
    }
  };
}

function paragraphsFromBody(body) {
  return String(body || '').replace(/\r\n?/g, '\n').split(/\n\s*\n/).map(value => value.trim()).filter(Boolean);
}

async function createDocx(packageData, outputPath) {
  const letter = packageData.letter;
  const bodyParts = paragraphsFromBody(letter.body);
  const children = [
    new Paragraph({ spacing:{ after:80 }, children:[new TextRun({ text:canonicalResumeProfile.identity.name, bold:true, size:34, font:'Arial' })] }),
    new Paragraph({ spacing:{ after:40 }, children:[new TextRun({ text:letter.language === 'de' ? 'Senior Infrastructure Engineer | Azure- und Hybrid-Cloud-Infrastruktur' : 'Senior Infrastructure Engineer | Azure and Hybrid Cloud Infrastructure', bold:true, color:'245684', size:22, font:'Arial' })] }),
    new Paragraph({ spacing:{ after:20 }, children:[new TextRun({ text:`${canonicalResumeProfile.identity.location} | ${canonicalResumeProfile.identity.phone} | ${canonicalResumeProfile.identity.email}`, size:19, font:'Arial' })] }),
    new Paragraph({ spacing:{ after:180 }, children:[
      new ExternalHyperlink({ link:`https://${canonicalResumeProfile.identity.linkedin}`, children:[new TextRun({ text:`LinkedIn: ${canonicalResumeProfile.identity.linkedin}`, style:'Hyperlink', size:19, font:'Arial' })] }),
      new TextRun({ text:` | GitHub: ${canonicalResumeProfile.identity.github}`, size:19, font:'Arial' })
    ] }),
    new Paragraph({ spacing:{ after:100 }, children:[new TextRun({ text:letter.date, color:'555555', size:20, font:'Arial' })] }),
    new Paragraph({ spacing:{ after:180 }, children:[new TextRun({ text:letter.subject, bold:true, size:23, font:'Arial' })] })
  ];
  bodyParts.forEach((text,index) => children.push(new Paragraph({
    alignment:AlignmentType.LEFT,
    spacing:{ after:index === bodyParts.length - 1 ? 0 : 170, line:276 },
    children:[new TextRun({ text, bold:index === bodyParts.length - 1, size:20, font:'Arial' })]
  })));
  const doc = new Document({
    styles:{ default:{ document:{ run:{ font:'Arial', size:20 }, paragraph:{ spacing:{ line:276 } } } } },
    sections:[{ properties:{ page:{ margin:{ top:900, right:1040, bottom:900, left:1040 } } }, children }]
  });
  await writeFile(outputPath, await Packer.toBuffer(doc));
}

function resumeParagraphs(body) {
  const sectionNames = new Set(Object.values(resumeSectionLabels('de')).concat(Object.values(resumeSectionLabels('en'))));
  return String(body || '').replace(/\r\n?/g,'\n').split('\n').map((raw,index) => {
    const text = raw.trim();
    if (!text) return new Paragraph({ spacing:{ after:70 } });
    if (index === 0) return new Paragraph({ spacing:{ after:50 }, children:[new TextRun({ text, bold:true, size:34, font:'Arial' })] });
    if (index === 1) return new Paragraph({ spacing:{ after:80 }, children:[new TextRun({ text, bold:true, color:'245684', size:22, font:'Arial' })] });
    if (sectionNames.has(text)) return new Paragraph({ heading:HeadingLevel.HEADING_2, spacing:{ before:180, after:70 }, border:{ bottom:{ color:'8FAADC', size:5, space:3 } }, children:[new TextRun({ text, bold:true, color:'245684', size:21, font:'Arial' })] });
    if (text.startsWith('• ')) return new Paragraph({ bullet:{ level:0 }, spacing:{ after:40, line:240 }, children:[new TextRun({ text:text.slice(2), size:18, font:'Arial' })] });
    if (/\|.*\|.*\|/.test(text)) return new Paragraph({ spacing:{ before:90, after:45 }, children:[new TextRun({ text, bold:true, size:19, font:'Arial' })] });
    if (/^[^:]{2,40}:\s/.test(text)) {
      const [label,...rest] = text.split(':');
      return new Paragraph({ spacing:{ after:40, line:230 }, children:[new TextRun({ text:`${label}: `, bold:true, size:18, font:'Arial' }),new TextRun({ text:rest.join(':').trim(), size:18, font:'Arial' })] });
    }
    return new Paragraph({ spacing:{ after:80, line:240 }, children:[new TextRun({ text, size:18, font:'Arial' })] });
  });
}

async function createResumeDocx(resume, outputPath) {
  const doc = new Document({
    styles:{ default:{ document:{ run:{ font:'Arial', size:18 }, paragraph:{ spacing:{ line:240 } } } } },
    sections:[{ properties:{ page:{ margin:{ top:700, right:850, bottom:700, left:850 } } }, children:resumeParagraphs(resume.body) }]
  });
  await writeFile(outputPath, await Packer.toBuffer(doc));
}

function htmlEscape(value='') {
  return String(value).replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character]);
}

async function withPdfTimeout(operation, milliseconds=30000) {
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((_,reject) => { timer = setTimeout(() => reject(new Error('PDF rendering exceeded the safe time limit')),milliseconds); })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function createPdf(packageData, outputPath) {
  const { chromium } = await import('playwright');
  const browserCandidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ].filter(existsSync);
  if (!browserCandidates.length) throw new Error('PDF export requires Microsoft Edge or Google Chrome on this computer');
  const letter = packageData.letter;
  const paragraphs = paragraphsFromBody(letter.body);
  let browser = null;
  for (const executablePath of browserCandidates) {
    try {
      browser = await chromium.launch({ headless:true, executablePath });
      break;
    } catch {
      // A locally installed browser can be unavailable while it is updating.
      // Try the next known browser without exposing its verbose launch log.
    }
  }
  if (!browser) throw new Error('The PDF renderer could not start. Please try again in a moment.');
  try {
    const page = await browser.newPage();
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
      @page{size:A4;margin:18mm 20mm}*{box-sizing:border-box}body{margin:0;color:#17253a;font:10.5pt/1.45 Arial,sans-serif}h1{margin:0;font-size:17pt}h2{margin:2mm 0 1.5mm;color:#245684;font-size:11pt}header p{margin:0 0 1mm;font-size:9.5pt}.date{margin:8mm 0 4mm;color:#555}.subject{margin:0 0 6mm;font-weight:700;font-size:11.5pt}.letter p{margin:0 0 4.5mm;white-space:pre-wrap}.letter p:last-child{font-weight:700}</style></head><body>
      <header><h1>${htmlEscape(canonicalResumeProfile.identity.name)}</h1><h2>${htmlEscape(canonicalResumeProfile.baseHeadline[letter.language])}</h2><p>${htmlEscape(`${canonicalResumeProfile.identity.location} | ${canonicalResumeProfile.identity.phone} | ${canonicalResumeProfile.identity.email}`)}</p><p>${htmlEscape(`LinkedIn: ${canonicalResumeProfile.identity.linkedin} | GitHub: ${canonicalResumeProfile.identity.github}`)}</p></header>
      <p class="date">${htmlEscape(letter.date)}</p><p class="subject">${htmlEscape(letter.subject)}</p><div class="letter">${paragraphs.map(text => `<p>${htmlEscape(text)}</p>`).join('')}</div>
      </body></html>`, { waitUntil:'load' });
    await withPdfTimeout(page.pdf({ path:outputPath, format:'A4', printBackground:true, preferCSSPageSize:true }));
  } finally {
    await browser.close();
  }
}

async function createResumePdf(resume, outputPath) {
  const { chromium } = await import('playwright');
  const executablePath = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe','C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe','C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'].find(existsSync);
  if (!executablePath) throw new Error('PDF export requires Microsoft Edge or Google Chrome on this computer');
  let browser;
  try { browser = await chromium.launch({ headless:true, executablePath }); }
  catch { throw new Error('The PDF renderer could not start. Please try again in a moment.'); }
  try {
    const sectionNames = new Set(Object.values(resumeSectionLabels('de')).concat(Object.values(resumeSectionLabels('en'))));
    const lines = resume.body.replace(/\r\n?/g,'\n').split('\n');
    const html = lines.map((raw,index) => {
      const value = raw.trim();
      if (!value) return '<div class="space"></div>';
      if (index === 0) return `<h1>${htmlEscape(value)}</h1>`;
      if (index === 1) return `<p class="headline">${htmlEscape(value)}</p>`;
      if (sectionNames.has(value)) return `<h2>${htmlEscape(value)}</h2>`;
      if (value.startsWith('• ')) return `<p class="bullet">${htmlEscape(value.slice(2))}</p>`;
      if (/\|.*\|.*\|/.test(value)) return `<h3>${htmlEscape(value)}</h3>`;
      return `<p>${htmlEscape(value)}</p>`;
    }).join('');
    const page = await browser.newPage();
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>@page{size:A4;margin:14mm 16mm}*{box-sizing:border-box}body{margin:0;color:#17253a;font:9pt/1.32 Arial,sans-serif}h1{font-size:17pt;margin:0 0 1mm}p{margin:0 0 1.5mm}.headline{font-size:11pt;font-weight:700;color:#245684;margin-bottom:2mm}h2{font-size:10.5pt;color:#245684;border-bottom:.5pt solid #8faadc;margin:4mm 0 1.5mm}h3{font-size:9.2pt;margin:2.5mm 0 1mm}.bullet{padding-left:4mm;position:relative}.bullet:before{content:'•';position:absolute;left:1mm}.space{height:1.5mm}</style></head><body>${html}</body></html>`,{waitUntil:'load'});
    await withPdfTimeout(page.pdf({ path:outputPath, format:'A4', printBackground:true, preferCSSPageSize:true }));
  } finally { await browser.close(); }
}

async function writeTailoringNotes(folder, data) {
  const letters = data.variants ? Object.values(data.variants).map(item => item.letter) : [data.letter];
  const evidenceIds = [...new Set(letters.flatMap(letter => letter.evidenceIds || []))];
  const requirements = [...new Set(letters.flatMap(letter => letter.requirements || []))];
  const notes = [
    '# Application package tailoring notes',
    '',
    `- Exact posting URL: ${data.job.exactPostingUrl}`,
    `- JD source: ${data.posting.source}`,
    `- JD retrieved: ${data.posting.retrievedAt}`,
    `- Cover-letter strategy: evidence-grounded template v1`,
    `- Visual template: ${data.template.source}`,
    `- Selected evidence IDs: ${evidenceIds.join(', ')}`,
    `- Matched requirements: ${requirements.join(', ')}`,
    '- Added/reordered content: employer and role opening; strongest matched evidence first; work-authorisation close.',
    '- Known boundaries: verified local language levels remain unchanged; growth technologies are not represented as production expertise.',
    '- Human review outcome: revise before applying until the local operator approves the editable preview.',
    '- Quality checks: approved-evidence gate passed; DOCX generated; exact submission remains manual.',
    ''
  ].join('\n');
  await writeFile(join(folder, 'tailoring_notes.md'), notes, 'utf8');
}

export function createCoverLetterService({ workspace, approvedEvidencePath }) {
  const applicationsRoot = join(workspace, 'Applications');
  const approvedPath = approvedEvidencePath || join(workspace, 'Evidence_Bank', 'approved_evidence.json');
  const pdfBuilds = new Map();

  async function assertEvidenceReady() {
    if (!existsSync(approvedPath)) throw new Error('The approved career evidence bank is unavailable');
    const evidence = JSON.parse(await readFile(approvedPath, 'utf8'));
    const approvedIds = new Set((evidence.evidence_blocks || []).filter(item => item.classification !== 'growth_area').map(item => item.id));
    const missing = evidenceCatalogue.map(item => item.id).filter(id => !approvedIds.has(id));
    if (missing.length) throw new Error(`Approved evidence is incomplete for application-package generation: ${missing.join(', ')}`);
    return evidence;
  }

  function packagePath(job) { return join(applicationsRoot, packageKey(job), 'application-package.json'); }
  function current(data) { return data.versions?.find(version => version.versionNumber === data.currentVersion) || data.versions?.at(-1); }
  function versionFolder(job, number) { return join(applicationsRoot, packageKey(job), `v${number}`); }
  function datedPrefix(job, number) {
    const date = new Date().toISOString().slice(0,10);
    return `${date}_${safeSlug(job.company)}_${safeSlug(job.title)}_v${number}`;
  }

  async function writeVersionFiles(data, version) {
    const folder = versionFolder(data.job, version.versionNumber);
    await mkdir(folder, { recursive:true });
    for (const language of ['de','en']) {
      const cv = version.documents.cv[language];
      const letter = version.documents.coverLetter[language];
      await createResumeDocx(cv, cv.document.path);
      await createDocx({ letter }, letter.document.path);
      await writeFile(join(folder, `CV_${language.toUpperCase()}.txt`), cv.body, 'utf8');
      await writeFile(join(folder, `Cover_Letter_${language.toUpperCase()}.txt`), letter.body, 'utf8');
    }
  }

  function createVersion(job, posting, versionNumber, reason='full') {
    const folder = versionFolder(job, versionNumber);
    const prefix = datedPrefix(job, versionNumber);
    const resumes = { de:buildResume(job, posting, 'de'), en:buildResume(job, posting, 'en') };
    const letters = { de:draftLetter(job, posting, 'de'), en:draftLetter(job, posting, 'en') };
    const remarks = { de:buildApplicationRemarks(job, posting, 'de'), en:buildApplicationRemarks(job, posting, 'en') };
    for (const language of ['de','en']) {
      const suffix = language.toUpperCase();
      resumes[language].document = { fileName:`${prefix}_CV_${suffix}.docx`, path:join(folder, `${prefix}_CV_${suffix}.docx`) };
      resumes[language].manualEdited = false;
      letters[language].document = { fileName:`${prefix}_${language === 'de' ? 'Anschreiben_DE' : 'Cover_Letter_EN'}.docx`, path:join(folder, `${prefix}_${language === 'de' ? 'Anschreiben_DE' : 'Cover_Letter_EN'}.docx`) };
      letters[language].manualEdited = false;
    }
    return {
      versionNumber,
      versionId:`v${versionNumber}-${Date.now()}`,
      generatedAt:new Date().toISOString(),
      reason,
      documents:{ cv:resumes, coverLetter:letters, remarks },
      customizationSummary:{ de:resumes.de.customization, en:resumes.en.customization },
      evidenceTrace:{
        cv:{ de:resumes.de.evidenceIds, en:resumes.en.evidenceIds },
        coverLetter:{ de:letters.de.evidenceIds, en:letters.en.evidenceIds },
        remarks:{ de:remarks.de.evidenceIds, en:remarks.en.evidenceIds }
      },
      audit:{ canonicalProfile:'verified master ATS CVs + approved_evidence.json', jdSource:posting.source, manuallyEditedDocuments:[] }
    };
  }

  async function prepare(job, suppliedDescription='', options={}) {
    await assertEvidenceReady();
    if (!job) throw new Error('A saved job record is required before preparing an application');
    if (!job.url && !cleanText(suppliedDescription)) throw new Error('Add the exact posting URL or paste the complete job description before preparing an application');
    const posting = await retrievePosting(job, suppliedDescription);
    if (!posting.complete) {
      const error = new Error('The complete job description could not be retrieved. Paste the JD into the preparation window and try again.');
      error.code = 'NEEDS_JOB_DESCRIPTION';
      error.details = posting;
      throw error;
    }
    const key = packageKey(job);
    const folder = join(applicationsRoot, key);
    await mkdir(folder, { recursive:true });
    const path = packagePath(job);
    let data = existsSync(path) ? JSON.parse(await readFile(path,'utf8')) : null;
    const priorVersions = data?.version === 3 && Array.isArray(data.versions) ? data.versions : [];
    const versionNumber = Math.max(0,...priorVersions.map(version => Number(version.versionNumber) || 0)) + 1;
    const scope = ['cv','coverLetter','full'].includes(options.scope) ? options.scope : 'full';
    const next = createVersion(job, posting, versionNumber, scope);
    data = {
      version:3,
      packageKey:key,
      job:{ id:job.id, title:job.title, company:job.company, location:job.location, exactPostingUrl:job.url, verifiedAt:job.lastVerifiedAt || null },
      posting,
      currentVersion:versionNumber,
      versions:[...priorVersions,next],
      lifecycle:{ status:'Preparing', submitted:false },
      createdAt:data?.createdAt || new Date().toISOString(),
      updatedAt:new Date().toISOString()
    };
    await writeVersionFiles(data,next);
    await writeFile(path, JSON.stringify(data,null,2),'utf8');
    await writeFile(join(folder,'job-description.txt'), posting.text,'utf8');
    return publicPackage(data);
  }

  async function readPackage(job) {
    const path = packagePath(job);
    if (!existsSync(path)) return null;
    const data = JSON.parse(await readFile(path,'utf8'));
    return data.version === 3 ? publicPackage(data) : null;
  }

  async function inspectPosting(job) { return retrievePosting(job,''); }

  async function save(job, body, language='de', documentType='coverLetter') {
    await assertEvidenceReady();
    const path = packagePath(job);
    if (!existsSync(path)) throw new Error('Prepare the application package before editing a document');
    const data = JSON.parse(await readFile(path,'utf8'));
    if (data.version !== 3) throw new Error('This legacy draft is blocked. Regenerate it from the complete job description before saving.');
    const selectedLanguage = String(language).toLowerCase();
    const selectedType = ['cv','coverLetter','remarks'].includes(documentType) ? documentType : 'coverLetter';
    if (!['de','en'].includes(selectedLanguage)) throw new Error('Choose German or English before saving');
    const text = String(body || '').replace(/\r\n?/g,'\n').normalize('NFC').trim();
    const minimum = selectedType === 'cv' ? 1000 : selectedType === 'remarks' ? 20 : 300;
    const maximum = selectedType === 'cv' ? MAX_RESUME_LENGTH : selectedType === 'remarks' ? 2000 : MAX_LETTER_LENGTH;
    if (text.length < minimum) throw new Error(selectedType === 'cv' ? 'The resume is too short to save' : selectedType === 'remarks' ? 'The application note is too short to save' : 'The cover letter is too short to save');
    if (text.length > maximum) throw new Error(`This document is limited to ${maximum.toLocaleString('en-GB')} characters`);
    const active = current(data);
    active.documents.remarks ||= { de:buildApplicationRemarks(job,data.posting,'de'), en:buildApplicationRemarks(job,data.posting,'en') };
    const document = active.documents[selectedType][selectedLanguage];
    document.body = text;
    document.manualEdited = true;
    document.editedAt = new Date().toISOString();
    active.audit.manuallyEditedDocuments = [...new Set([...(active.audit.manuallyEditedDocuments || []),`${selectedType}.${selectedLanguage}`])];
    if (selectedType === 'cv') await createResumeDocx(document,document.document.path);
    else if (selectedType === 'coverLetter') await createDocx({ letter:document },document.document.path);
    data.updatedAt = new Date().toISOString();
    await writeFile(path,JSON.stringify(data,null,2),'utf8');
    return publicPackage(data);
  }

  async function restore(job, versionNumber) {
    const path = packagePath(job);
    if (!existsSync(path)) throw new Error('No application package exists for this job');
    const data = JSON.parse(await readFile(path,'utf8'));
    const source = data.versions.find(version => version.versionNumber === Number(versionNumber));
    if (!source) throw new Error('The selected package version no longer exists');
    const nextNumber = Math.max(...data.versions.map(version => version.versionNumber)) + 1;
    const restored = structuredClone(source);
    restored.versionNumber = nextNumber;
    restored.versionId = `v${nextNumber}-${Date.now()}`;
    restored.generatedAt = new Date().toISOString();
    restored.reason = 'restore';
    restored.restoredFrom = source.versionNumber;
    const folder = versionFolder(job,nextNumber);
    const prefix = datedPrefix(job,nextNumber);
    for (const language of ['de','en']) {
      restored.documents.cv[language].document = { fileName:`${prefix}_CV_${language.toUpperCase()}.docx`, path:join(folder,`${prefix}_CV_${language.toUpperCase()}.docx`) };
      restored.documents.coverLetter[language].document = { fileName:`${prefix}_${language === 'de' ? 'Anschreiben_DE' : 'Cover_Letter_EN'}.docx`, path:join(folder,`${prefix}_${language === 'de' ? 'Anschreiben_DE' : 'Cover_Letter_EN'}.docx`) };
    }
    data.versions.push(restored);
    data.currentVersion = nextNumber;
    data.updatedAt = new Date().toISOString();
    await writeVersionFiles(data,restored);
    await writeFile(path,JSON.stringify(data,null,2),'utf8');
    return publicPackage(data);
  }

  async function download(job, language='de', format='docx', documentType='coverLetter', versionNumber=null) {
    const path = packagePath(job);
    if (!existsSync(path)) throw new Error('No application package exists for this job');
    const data = JSON.parse(await readFile(path,'utf8'));
    if (data.version !== 3) throw new Error('Regenerate this legacy package before downloading');
    const selectedLanguage = String(language).toLowerCase();
    const selectedType = documentType === 'cv' ? 'cv' : 'coverLetter';
    const version = versionNumber ? data.versions.find(item => item.versionNumber === Number(versionNumber)) : current(data);
    const document = version?.documents?.[selectedType]?.[selectedLanguage];
    if (!document) throw new Error('The selected document is unavailable');
    if (String(format).toLowerCase() === 'pdf') {
      const fileName = basename(document.document.path).replace(/\.docx$/i,'.pdf');
      const outputPath = join(versionFolder(job,version.versionNumber),fileName);
      let cached = false;
      if (existsSync(outputPath)) {
        const [pdfInfo,wordInfo] = await Promise.all([stat(outputPath),stat(document.document.path)]);
        cached = pdfInfo.size >= 1000 && pdfInfo.mtimeMs >= wordInfo.mtimeMs;
      }
      if (!cached) {
        let build = pdfBuilds.get(outputPath);
        if (!build) {
          build = (selectedType === 'cv' ? createResumePdf(document,outputPath) : createPdf({ letter:document },outputPath))
            .finally(() => pdfBuilds.delete(outputPath));
          pdfBuilds.set(outputPath,build);
        }
        await build;
      }
      return { path:outputPath,fileName,contentType:'application/pdf' };
    }
    return { path:document.document.path,fileName:basename(document.document.path),contentType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
  }

  function publicDocument(jobId,version,documentType,language,document) {
    const base = `/api/application-package/download?id=${encodeURIComponent(jobId)}&language=${language}&type=${documentType}&version=${version.versionNumber}`;
    return { ...document, document:{ fileName:document.document.fileName, downloadUrl:base, pdfDownloadUrl:`${base}&format=pdf` } };
  }

  function publicPackage(data) {
    const active = current(data);
    active.documents.remarks ||= { de:buildApplicationRemarks(data.job,data.posting,'de'), en:buildApplicationRemarks(data.job,data.posting,'en') };
    const trustedFullSource = /^(exact LinkedIn guest posting|exact posting structured JD|exact posting main JD content|exact posting page content|exact posting rendered in local browser|exact posting via public text reader|exact posting via federal job database|user-pasted full job description|stored full tracker JD snapshot)$/.test(data.posting.source);
    const jdComplete = trustedFullSource && isCompleteJobDescription(data.posting.text,data.posting.source === 'user-pasted full job description' ? MIN_PASTED_JD_LENGTH : MIN_RETRIEVED_JD_LENGTH);
    const documents = {
      ...Object.fromEntries(['cv','coverLetter'].map(type => [type,Object.fromEntries(['de','en'].map(language => [language,publicDocument(data.job.id,active,type,language,active.documents[type][language])]))])),
      remarks:Object.fromEntries(['de','en'].map(language => [language,{ ...active.documents.remarks[language] }]))
    };
    const variants = Object.fromEntries(['de','en'].map(language => [language,{ letter:documents.coverLetter[language], document:documents.coverLetter[language].document }]));
    const history = [...data.versions].sort((a,b) => b.versionNumber-a.versionNumber).map(version => ({ versionNumber:version.versionNumber,versionId:version.versionId,generatedAt:version.generatedAt,reason:version.reason,restoredFrom:version.restoredFrom || null,manualEdits:version.audit?.manuallyEditedDocuments || [] }));
    return {
      packageKey:data.packageKey,
      job:data.job,
      posting:{ source:data.posting.source,text:data.posting.text,retrievedAt:data.posting.retrievedAt,retrievalError:data.posting.retrievalError || '',characterCount:data.posting.text.length },
      currentVersion:active.versionNumber,
      documents,
      variants,
      selectedLanguage:'de',
      letter:documents.coverLetter.de,
      document:{ fileName:documents.coverLetter.de.document.fileName,path:active.documents.coverLetter.de.document.path,downloadUrl:documents.coverLetter.de.document.downloadUrl },
      customizationSummary:active.customizationSummary,
      evidenceTrace:active.evidenceTrace,
      history,
      quality:{ jdComplete,applicationReady:Boolean(jdComplete && documents.cv.de && documents.cv.en && documents.coverLetter.de && documents.coverLetter.en),warning:jdComplete ? '' : 'Regenerate from the complete job description.' },
      lifecycle:data.lifecycle,
      createdAt:data.createdAt,
      updatedAt:data.updatedAt,
      generatedAt:active.generatedAt
    };
  }

  return { prepare,readPackage,inspectPosting,save,restore,download };
}
