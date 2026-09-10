import http from 'node:http';
import { readFile, writeFile, mkdtemp, rm, readdir, stat, rename } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { basename, dirname, join, extname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openJobDatabase } from './job-database.mjs';
import { createCoverLetterService } from './cover-letter-generator.mjs';
import { createFastApplyService } from './fast-apply-service.mjs';
import { canonicalResumeProfile } from './canonical-resume-profile.mjs';
import { assessAgainstResume } from './resume-assessment.mjs';
import { matchesLocation } from './filter-logic.js';

const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 8787);
const serverStartedAt = Date.now();
const appVersion = `${Date.now()}-${process.pid}`;
const configPath = join(root, 'job-sources.config.json');
const examplePath = join(root, 'job-sources.config.example.json');
const additionalSourcesPath = join(root, 'additional-job-sources.json');
const gmailSourcesPath = join(root, 'gmail-discovered-sources.json');
const retiredSourcesPath = join(root, 'retired-job-sources.json');
const sourceHealthPath = join(root, 'source-health.json');
const workspace = process.env.ALEX_JOB_DATA_DIR ? resolve(process.env.ALEX_JOB_DATA_DIR) : join(root, 'runtime');
const statePath = join(workspace, 'State', 'cv_command_center_state.json');
const trackerImporter = join(root, 'import-tracker.mjs');
const trackerWorkbook = join(root, 'tracker-workbook.mjs');
const databaseBackupScript = join(root, 'backup-databases.mjs');
const trackerImportStatusPath = join(workspace, 'State', 'tracker_import_status.json');
const liveDatabasePath = join(workspace, 'State', 'live_job_database.json');
const sqlitePath = join(workspace, 'State', 'job_search.sqlite');
const emailReconciliationRequestPath = join(workspace, 'State', 'gmail_reconciliation_request.json');
mkdirSync(join(workspace, 'State'), { recursive:true });
const jobDb = openJobDatabase(sqlitePath);
const coverLetters = createCoverLetterService({ workspace, approvedEvidencePath:join(workspace, 'Evidence_Bank', 'approved_evidence.json') });
const fastApply = createFastApplyService({ root, workspace, coverLetters, senderEmail:canonicalResumeProfile.identity.email, senderName:canonicalResumeProfile.identity.name });
let importedTracker = { path:'', modified:0 };
const refreshJobs = new Map();
let databaseMigrated = false;
let excelSyncChain = Promise.resolve();
const profile = {
  defaultQuery: 'system administrator OR system engineer OR infrastructure engineer OR cloud administrator OR IT operations OR IT consultant',
  searchHeadlines: [
    'Senior System Administrator','Systems Administrator','Server Administrator','Windows Administrator','Linux Administrator',
    'IT Administrator','System Engineer','Infrastructure Engineer','IT Infrastructure Engineer','Datacenter Engineer',
    'Virtualization Engineer','VMware Engineer','Cloud Administrator','Azure Administrator','Cloud Operations Engineer',
    'Hybrid Cloud Engineer','Microsoft 365 Administrator','Modern Workplace Engineer','Endpoint Administrator','Intune Administrator',
    'IT Operations Engineer','Platform Administrator','Application Administrator','Technical Support Engineer','L2/L3 Support Engineer',
    'Service Delivery Engineer','IT Service Engineer','IT Consultant Infrastructure','IT Consultant Microsoft Cloud','Technical Consultant'
  ],
  skills: {
    'Windows Server': ['windows server', 'active directory', 'windows infrastructure'],
    'Linux Server': ['linux server', 'linux administration', 'linux systems', 'red hat', 'ubuntu'],
    'VMware vSphere': ['vmware', 'vsphere', 'virtualisation', 'virtualization'],
    'Azure Administration': ['microsoft azure', 'azure cloud', 'azure iaas', 'azure paas'],
    'Microsoft 365': ['microsoft 365', 'office 365', 'exchange online', 'intune'],
    'Active Directory': ['active directory', 'azure ad', 'entra id', 'aad'],
    'Bash / PowerShell': ['bash', 'powershell', 'shell scripting'],
    'Ansible': ['ansible'],
    'Datacentre Operations': ['datacenter', 'data center', 'hardware operations', 'server hardware'],
    'L2/L3 Support': ['l2 support', 'l3 support', 'technical support', 'incident management'],
    'Asset Management': ['asset management', 'asset lifecycle']
  }
};
const baseDirectSources = [
  { name:'Indeed Germany', url:'https://de.indeed.com/', careerChangeUrl:'https://de.indeed.com/q-it-quereinsteiger-l-stuttgart-jobs.html', kind:'General job board' },
  { name:'XING Jobs', url:'https://www.xing.com/jobs', kind:'Professional network' },
  { name:'get in IT', url:'https://www.get-in-it.de/jobsuche', careerChangeUrl:'https://starte-hier.get-in-it.de/quereinsteiger', kind:'IT job board' },
  { name:'Jobrapido Germany', url:'https://de.jobrapido.com/', kind:'Job aggregator' },
  { name:'Talent.com Germany', url:'https://de.talent.com/', kind:'Job board' },
  { name:'Minijob-Zentrale', url:'https://www.minijob-zentrale.de/', kind:'Minijob information' },
  { name:'Workwise', url:'https://www.workwise.io/', kind:'Job platform' },
  { name:'Joblift', url:'https://joblift.de/', kind:'Job board' },
  { name:'IT-Jobs.de', url:'https://en.it-jobs.de/', kind:'IT job board' },
  { name:'hackajob', url:'https://hackajob.com/', kind:'Tech talent platform' },
  { name:'Schwarz Digits', url:'https://schwarz-digits.de/jobsearch?includeAllLanguages=true', kind:'Employer careers' },
  { name:'StepStone Germany', url:'https://www.stepstone.de/', careerChangeUrl:'https://www.stepstone.de/jobs/quereinsteiger-it/in-stuttgart', kind:'General job board' },
  { name:'Schwarz Global Services', url:'https://schwarzgt.jobs.schwarz/search', kind:'Employer careers' },
  { name:'Computerwoche Jobs', url:'https://jobs.computerwoche.de/', kind:'IT job board' },
  { name:'Swoboda Careers', url:'https://www.swoboda.com/en/careers/', kind:'Employer careers' },
  { name:'Onventis Careers', url:'https://www.onventis.com/', kind:'Employer careers' },
  { name:'DSV Group', url:'https://www.dsv-gruppe.de/', kind:'Employer careers' },
  { name:'DSV Group Workday', url:'https://dsvgruppe.wd103.myworkdayjobs.com/', kind:'Employer careers' },
  { name:'Daimler Truck Careers', url:'https://jobsearch.daimlertruck.com/', kind:'Employer careers' },
  { name:'Siemens Jobs', url:'https://jobs.siemens.com/', kind:'Employer careers' },
  { name:'SAP Careers', url:'https://jobs.sap.com/', kind:'Employer careers' },
  { name:'Bosch Careers', url:'https://jobs.bosch.com/', kind:'Employer careers' },
  { name:'LinkedIn Jobs', url:'https://www.linkedin.com/jobs/', kind:'Professional network' },
  { name:'CANCOM Careers', url:'https://karriere.cancom.de/jobs/', kind:'Employer careers' }
  ,{ name:'Stellenanzeigen.de', url:'https://www.stellenanzeigen.de/', kind:'General job board' }
  ,{ name:'Rems-Murr-Jobs', url:'https://rems-murr-jobs.de/', kind:'Regional job board' }
  ,{ name:'INTERAMT', url:'https://interamt.de/', kind:'Public-sector jobs', healthOverride:'available' }
  ,{ name:'service.bund.de', url:'https://www.service.bund.de/Content/DE/Stellen/Suche/Formular.html', kind:'Federal public-sector jobs' }
  ,{ name:'Baden-Württemberg Careers', url:'https://karriere.baden-wuerttemberg.de/', kind:'State public-sector jobs' }
  ,{ name:'Experteer Stuttgart', url:'https://www.experteer.de/jobs-stuttgart-cid9678', kind:'Professional jobs' }
  ,{ name:'Diehl Careers', url:'https://www.diehl.com/career/en/jobs-application/job-offers/', kind:'Employer careers' }
  ,{ name:'STACKIT Careers', url:'https://stackit.com/de/warum-stackit/karriere/stellenangebote?includeAllLanguages=true', kind:'IT service and cloud employer careers' }
  ,{ name:'Oracle Careers Germany', url:'https://careers.oracle.com/en/sites/jobsearch/jobs?location=Germany&locationId=300000000106803&locationLevel=country&mode=location', kind:'Employer careers' }
  ,{ name:'IONOS Careers', url:'https://jobs.ionos.de/karriere/jobs/alle-jobs', kind:'Cloud and IT service employer careers' }
  ,{ name:'Mahr EDV Careers', url:'https://www.mahr-edv.de/karriere/#stellenangebote', kind:'IT system house careers' }
  ,{ name:'Bechtle Careers', url:'https://jobs.bechtle.com/viewalljobs/?locale=de_DE', kind:'IT service and system house careers' }
  ,{ name:'DATAGROUP Careers', url:'https://www.datagroup.de/karriere/jobs/', kind:'Managed IT services careers' }
  ,{ name:'OCX Stuttgart Careers', url:'https://www.ocx.de/karriere', kind:'Stuttgart IT system house careers' }
  ,{ name:'badenIT Careers', url:'https://www.badenit.de/jobs/', kind:'Baden-Württemberg IT service careers' }
  ,{ name:'RAUSYS Careers', url:'https://www.rausys.de/karriere/', kind:'Stuttgart-area IT system house careers' }
  ,{ name:'MP-Datentechnik Careers', url:'https://www.mp-datentechnik.de/karriere', kind:'Stuttgart-area IT system house careers' }
  ,{ name:'TMG Consultants Careers', url:'https://www.tmg.com/karriere/offene-stellen/', kind:'Stuttgart IT consulting careers' }
  ,{ name:'eBay Careers', url:'https://jobs.ebayinc.com/us/en', kind:'Employer careers' }
  ,{ name:'Microsoft Careers', url:'https://jobs.careers.microsoft.com/global/en/search', kind:'Employer careers' }
  ,{ name:'Amazon Jobs Germany', url:'https://www.amazon.jobs/en/locations/germany', kind:'Employer careers' }
  ,{ name:'Google Careers Germany', url:'https://www.google.com/about/careers/applications/jobs/results/?location=Germany', kind:'Employer careers' }
  ,{ name:'TEKsystems UK & Europe Jobs', url:'https://careers.teksystems.com/gb/en/search-results', kind:'Technology recruiter job board - UK and Europe' }
  ,{ name:'EURES', url:'https://eures.europa.eu/index_en', kind:'European job network' }
];
async function readArray(path) {
  if (!existsSync(path)) return [];
  const parsed = JSON.parse(await readFile(path, 'utf8'));
  return Array.isArray(parsed) ? parsed : [];
}
function sourceNameKey(value) { return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }
function sourceUrlKey(value) {
  try {
    const parsed = new URL(value);
    parsed.hash = '';
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(utm_|trk$|tracking|ref$|source$)/i.test(key)) parsed.searchParams.delete(key);
    }
    return parsed.toString().replace(/\/$/, '').toLowerCase();
  } catch { return ''; }
}
function registrableDomain(value) {
  try {
    const host = new URL(value.includes('://') ? value : `https://${value}`).hostname.toLowerCase().replace(/^www\./, '');
    if (/\.(myworkdayjobs|personio|softgarden)\.com$/.test(host) || /\.jobs\.personio\.de$/.test(host) || /\.jobs2web\.com$/.test(host)) return host;
    const parts = host.split('.');
    const threePartSuffix = /\.(co\.uk|com\.au|co\.nz)$/.test(host);
    return parts.slice(threePartSuffix ? -3 : -2).join('.');
  } catch { return ''; }
}
function sourceDomainKeys(source) {
  const values = [source.canonicalDomain, ...(source.aliases || [])].filter(Boolean);
  if (!values.length && source.url) values.push(registrableDomain(source.url));
  return values.map(registrableDomain).filter(Boolean).map(value => `domain:${value}`);
}
function sourceKeys(source) {
  const name = sourceNameKey(source.name);
  const url = sourceUrlKey(source.url);
  return [name && `name:${name}`, url && `url:${url}`, ...sourceDomainKeys(source)].filter(Boolean);
}
async function loadDirectSources() {
  const [additionalSources, gmailSources, retiredSources] = await Promise.all([
    readArray(additionalSourcesPath), readArray(gmailSourcesPath), readArray(retiredSourcesPath)
  ]);
  const retiredNames = new Set(retiredSources.map(source => sourceNameKey(source.name)).filter(Boolean));
  const retiredUrls = new Set(retiredSources.map(source => sourceUrlKey(source.url)).filter(Boolean));
  const retiredDomains = new Set(retiredSources.map(source => registrableDomain(source.canonicalDomain)).filter(Boolean));
  const seen = new Set();
  return [...baseDirectSources, ...additionalSources, ...gmailSources]
    .filter(source => {
      const name = sourceNameKey(source.name);
      const url = sourceUrlKey(source.url);
      const domain = registrableDomain(source.canonicalDomain || source.url || '');
      if (retiredNames.has(name) || retiredUrls.has(url) || retiredDomains.has(domain)) return false;
      const keys = sourceKeys(source);
      if (keys.some(key => seen.has(key))) return false;
      keys.forEach(key => seen.add(key));
      return Boolean(name && url);
    })
    .map(source => ({ ...source, provenance:source.discoveredFrom || source.provenance || 'Configured source' }));
}
const germanCities = ['Aachen','Backnang','Bad Friedrichshall','Berlin','Bietigheim-Bissingen','Böblingen','Bonn','Bremen','Cologne','Ditzingen','Dortmund','Dresden','Düsseldorf','Essen','Esslingen','Fellbach','Filderstadt','Frankfurt am Main','Göppingen','Hamburg','Hannover','Heidelberg','Heilbronn','Herrenberg','Karlsruhe','Kirchheim unter Teck','Kornwestheim','Leinfelden-Echterdingen','Leipzig','Leonberg','Ludwigsburg','Mannheim','Marbach am Neckar','Metzingen','Munich','Neckarsulm','Nuremberg','Nürtingen','Ostfildern','Pforzheim','Remseck am Neckar','Reutlingen','Schorndorf','Sindelfingen','Stuttgart','Tübingen','Vaihingen an der Enz','Waiblingen','Weinstadt','Wiesbaden','Winnenden'];
const chineseCities = ['Beijing','Chengdu','Chongqing','Guangzhou','Hangzhou','Nanjing','Ningbo','Qingdao','Shanghai','Shenzhen','Suzhou','Tianjin','Wuhan','Xiamen',"Xi'an"];
const locationOptions = ['', 'Stuttgart area', ...germanCities, 'China major cities', 'Shanghai + hybrid', 'Shanghai only', ...chineseCities].map(city => [city, city]);

async function getConfig() {
  const path = existsSync(configPath) ? configPath : examplePath;
  return JSON.parse(await readFile(path, 'utf8'));
}
function isConfigured(value) { return value && !String(value).startsWith('PASTE_'); }
function clean(text = '') { return String(text).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim(); }
function conciseChildError(error, fallback) {
  const match = String(error || '').match(/Error:\s*([^\r\n]+)/);
  return match?.[1]?.trim() || fallback;
}
function first(...values) { return values.find(v => v !== undefined && v !== null && String(v).trim() !== '') || ''; }
function dateValue(value) { const t = Date.parse(String(value || '').replace(/ CEST$/i, ' +02:00').replace(/ CET$/i, ' +01:00')); return Number.isFinite(t) ? new Date(t).toISOString() : ''; }
function addressValue(value) {
  if (!value) return '';
  if (typeof value === 'string') return clean(value);
  if (Array.isArray(value)) return value.map(addressValue).filter(Boolean).join(', ');
  if (typeof value === 'object') return clean([
    value.streetAddress, value.postalCode, value.addressLocality,
    value.addressRegion, value.addressCountry
  ].filter(Boolean).join(', '));
  return '';
}
const titleCities = ['Aachen','Berlin','Bielefeld','Bochum','Bonn','Bremen','Chemnitz','Dortmund','Dresden','Düsseldorf','Essen','Frankfurt','Freiburg','Hamburg','Hannover','Heidelberg','Heilbronn','Ingolstadt','Karlsruhe','Köln','Leipzig','Leinfelden-Echterdingen','Ludwigsburg','Mannheim','München','Münster','Nürnberg','Pforzheim','Reutlingen','Stuttgart','Tübingen','Ulm','Wiesbaden'];
const titleCityAliases = { Nuremberg:'Nürnberg', Nurenberg:'Nürnberg', Munich:'München', Cologne:'Köln', Dusseldorf:'Düsseldorf' };
function locationFromTitle(title='') {
  const grinnbergPattern = String(title).match(/\b(?:im Raum|in)\s+([A-ZÄÖÜ][\p{L}-]+(?:\s+(?:am|an|der|unter)\s+[A-ZÄÖÜ][\p{L}-]+)?)/u);
  if (grinnbergPattern) return grinnbergPattern[1];
  const match = [...titleCities, ...Object.keys(titleCityAliases)].find(city => new RegExp(`(?:^|[^\\p{L}])${city.replace(/[.*+?^${}()|[\\]\\]/g,'\\$&')}(?:$|[^\\p{L}])`,'iu').test(title));
  return match ? (titleCityAliases[match] || match) : '';
}
const careerChangePattern = /quereinstieg(?:er|ende|ern)?(?:\s+m[oö]glich)?|quereinsteiger(?:in|innen)?|career[ -]?changer|career change|fachfremd|berufsumsteiger|seiteneinstieg|auch ohne (?:it[- ]?)?ausbildung/i;
const careerChangeRolePattern = /\bit\b|system|server|infrastruktur|infrastructure|cloud|azure|microsoft|linux|windows|network|netzwerk|datacenter|rechenzentrum|support|service desk|consultant|berater|administrator|engineer|techniker.*(?:it|system|netzwerk)/i;
const unrelatedCareerChangePattern = /finanzberater|kundenberater|verk[aä]ufer|vertrieb|monteur|handwerker|pflege|fahrer|gastronomie/i;
function careerChangeDetails(job={}) {
  const text = clean([job.title, job.description, job.careerChangeEvidence, job.quereinstieg].filter(Boolean).join(' '));
  const match = text.match(careerChangePattern);
  const suppliedEvidence = clean(job.careerChangeEvidence || '');
  const trustedProviderFlag = job.careerChangePossible === true && !/vergleichbare qualifikation/i.test(suppliedEvidence);
  const resumeAligned = careerChangeRolePattern.test(clean(job.title || '')) && !unrelatedCareerChangePattern.test(clean(job.title || ''));
  return {
    careerChangePossible:resumeAligned && (trustedProviderFlag || Boolean(match)),
    careerChangeEvidence:resumeAligned ? (trustedProviderFlag ? suppliedEvidence : clean(match?.[0] || '')) : ''
  };
}
function assessJob(job) {
  const titleLocation = locationFromTitle(job.title);
  const grinnberg = /grinnberg/i.test(`${job.company || ''} ${job.source || ''} ${job.provider || ''}`);
  return assessAgainstResume({ ...job, ...careerChangeDetails(job), location:titleLocation || (grinnberg && /^(berlin|stuttgart)$/i.test(job.location || '') ? 'Location not stated' : job.location) });
}
function normalise(input, source) {
  const title = clean(first(input.title, input.job_title, input.jobTitle, input.position, input.text, input.stellenangebotsTitel, input.name));
  const company = clean(first(input.company?.display_name, input.company?.name, input.company, input.company_name, input.companyName, input.organization?.name, input.employer_name, input.firma));
  const description = clean(first(input.description, input.contents, input.job_description, input.jobDescription, input.descriptionPlain, input.snippet));
  const advertisedLocation = clean(first(input.location?.display_name, input.location, input.candidate_required_location, input.job_geo, input.jobGeo, input.locations?.[0]?.name, input.categories?.location, input.stellenlokationen?.[0]?.adresse?.ort, input.category));
  const location = locationFromTitle(title) || advertisedLocation;
  const workAddress = addressValue(first(input.workAddress, input.work_address, input.address, input.jobLocation?.address, input.jobLocation?.[0]?.address, input.stellenlokationen?.[0]?.adresse));
  const url = first(input.redirect_url, input.url, input.job_url, input.link, input.externalURL, input.hostedUrl, input.absolute_url, input.refs?.landing_page);
  const salaryMin = Number(first(input.salary_min, input.salaryMin, input.salary, input.annual_salary_min, input.salary_from, input.salaryRange?.min, 0)) || 0;
  const salaryMax = Number(first(input.salary_max, input.salaryMax, input.salary, input.annual_salary_max, input.salary_to, input.salaryRange?.max, 0)) || 0;
  const remote = input.remote === true || /remote|hybrid|home office|telecommute/i.test(`${title} ${description} ${location} ${input.workplaceType || ''}`);
  const haystack = `${title} ${description}`;
  const workType = /part[- ]?time|teilzeit/i.test(`${haystack} ${input.commitment || ''}`) ? 'Part-time' : /contract|freelance|befristet/i.test(`${haystack} ${input.commitment || ''}`) ? 'Contract' : /full[- ]?time|vollzeit/i.test(`${haystack} ${input.commitment || ''}`) ? 'Full-time' : 'Not stated';
  const experience = /lead|principal|head of|architect/i.test(title) ? 'Lead / Architect' : /senior|sr\.?/i.test(title) ? 'Senior' : /junior|entry|graduate/i.test(title) ? 'Entry level' : 'Mid level';
  const careerChange = careerChangeDetails({ ...input, title, description });
  return { id: `${source}:${url || title + company}`, source, provider: source, title, company: company || 'Company not stated', description, location: location || 'Location not stated', workAddress, url, salaryMin, salaryMax, remote, workType, experience, ...careerChange, posted: dateValue(first(input.created, input.publication_date, input.datumErsteVeroeffentlichung, input.date, input.pubDate)), rawLanguage: /[äöüß]|\b(m\/w\/d|stellen|kenntnisse|verwaltung|betrieb)\b/i.test(haystack) ? 'German / confirm' : 'Not stated' };
}
async function getCareerState() {
  if (!existsSync(statePath)) return { leads:[], deleted_leads:[], lead_tombstones:[] };
  return JSON.parse(await readFile(statePath, 'utf8'));
}
function stateLeadToJob(lead) {
  const description = clean(first(lead.full_description, lead.description, lead.jd_snapshot, lead.summary));
  const location = clean(first(lead.location, lead.work_arrangement, lead.country));
  const source = clean(first(lead.source, lead.source_name, 'Job Search Agent'));
  const applicationStatus = first(lead.application_status,
    lead.status === 'applied' ? 'Applied' : lead.status === 'archived' ? 'Case Closed' : 'Stashed');
  const rawLanguage = first(lead.language_stream, lead.description_language, lead.work_language,
    /[äöüß]|\b(kenntnisse|aufgaben|bewerbung)\b/i.test(description) ? 'German / confirm' : 'English');
  return {
    id: lead.id,
    source,
    provider:'Job Search Agent',
    origin:'agent',
    verified:lead.verified !== false,
    title:clean(first(lead.title, lead.position)),
    company:clean(first(lead.organization, lead.company, 'Company not stated')),
    description,
    jdSnapshot:clean(first(lead.jd_snapshot, lead.summary)),
    location:location || 'Location not stated',
    workAddress:clean(first(lead.work_address, lead.address, lead.office_address)),
    url:first(lead.job_url, lead.url),
    salaryMin:Number(first(lead.salary_min, 0)) || 0,
    salaryMax:Number(first(lead.salary_max, 0)) || 0,
    salaryText:clean(first(lead.salary, lead.salary_text)),
    remote:/remote|hybrid|home office/i.test(`${location} ${lead.work_arrangement || ''}`),
    workType:clean(first(lead.work_type, lead.employment_type, lead.employment, 'Not stated')),
    experience:clean(first(lead.experience, lead.seniority, 'Not stated')),
    posted:dateValue(first(lead.posted_at, lead.posted, lead.publication_date)),
    foundAt:dateValue(first(lead.found_at, lead.discovered_at, lead.created_at)),
    lastVerifiedAt:dateValue(first(lead.last_verified_at, lead.verified_at, lead.updated_at)),
    rawLanguage,
    match:Number(first(lead.fit_score, lead.score, 0)) || 0,
    shortlistChance:Number(first(lead.shortlist_chance, 0)) || 0,
    decision:clean(first(lead.decision, lead.tier === 'A' ? 'Apply' : 'Maybe')),
    applicationStatus:applicationStatus === 'Closed' ? 'Case Closed' : applicationStatus,
    applicationComment:String(lead.application_comment || '').replace(/\r\n?/g, '\n').normalize('NFC').trim(),
    applicationStatusChangedAt:dateValue(lead.application_status_changed_at),
    appliedAt:dateValue(lead.applied_at),
    lifecycleStatus:lead.status || 'to_apply',
    evidence:Array.isArray(lead.match_strengths) ? lead.match_strengths : [],
    fitGaps:Array.isArray(lead.fit_gaps) ? lead.fit_gaps : [],
    eligibilityConstraints:Array.isArray(lead.eligibility_constraints) ? lead.eligibility_constraints : [],
    applicationRequirements:Array.isArray(lead.application_requirements) ? lead.application_requirements : [],
    searchNotes:Array.isArray(lead.search_notes) ? lead.search_notes : []
    ,track:clean(lead.track)
    ,employment:clean(first(lead.employment, lead.employment_type))
    ,salaryBasis:clean(lead.salary_basis)
    ,recruiterContact:clean(lead.recruiter_contact)
    ,cvAngle:clean(lead.cv_angle)
    ,recommendedCvBase:clean(lead.recommended_cv_base)
    ,openStatus:clean(lead.open_status)
    ,trackerSheet:lead.tracker_sheet || ''
    ,trackerRow:Number(lead.tracker_row) || 0
    ,trackerFile:lead.tracker_file || ''
    ,updatedAt:dateValue(lead.updated_at) || new Date().toISOString()
  };
}
async function agentJobs() {
  const state = await getCareerState();
  const jobs = (state.leads || []).filter(lead => lead.status !== 'deleted').map(stateLeadToJob).filter(job => job.title).map(assessJob);
  jobDb.importAgentJobs(jobs);
  return jobs;
}
async function newestTracker() {
  const entries = await readdir(workspace, { withFileTypes:true });
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/\.xlsx$/i.test(entry.name) || !/tracker|job.?search|shortlist/i.test(entry.name)) continue;
    const path = join(workspace, entry.name);
    candidates.push({ path, modified:(await stat(path)).mtimeMs });
  }
  const canonical = candidates.find(item => /job_shortlist\.xlsx$/i.test(item.path));
  return canonical || candidates.sort((a,b) => b.modified-a.modified)[0];
}
async function importTrackerIfNeeded() {
  const tracker = await newestTracker();
  if (!tracker) return;
  if (!importedTracker.path && existsSync(trackerImportStatusPath)) {
    try {
      const saved = JSON.parse(await readFile(trackerImportStatusPath, 'utf8'));
      importedTracker = { path:saved.tracker_path || '', modified:Number(saved.modified) || 0 };
    } catch {}
  }
  if (tracker.path === importedTracker.path && Math.abs(tracker.modified - importedTracker.modified) < 1) return;
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [trackerImporter, tracker.path], { windowsHide:true, cwd:root });
    let error = '';
    child.stderr.on('data', chunk => error += chunk);
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(error || `Tracker import failed (${code})`)));
  });
  importedTracker = tracker;
}
async function safeImportTrackerIfNeeded() {
  try { await importTrackerIfNeeded(); }
  catch (error) {
    if (!jobDb.stats().total) throw error;
    jobDb.setMetadata('last_tracker_import_error', JSON.stringify({ message:conciseChildError(error.message, 'Tracker import deferred'), at:new Date().toISOString() }));
  }
}
async function migrateDatabaseIfNeeded() {
  if (databaseMigrated) return;
  jobDb.migrateStatusLabel('Closed', 'Case Closed');
  jobDb.migrateStatusLabel('Not applied', 'Stashed');
  jobDb.repairApplicationStateFromEvents();
  const state = await getCareerState();
  const needsStateMigration = (state.leads || []).some(lead => lead.application_status === 'Closed');
  if (needsStateMigration) await persistCareerState({ ...state, leads:(state.leads || []).map(lead => lead.application_status === 'Closed' ? { ...lead, application_status:'Case Closed' } : lead) });
  const saved = await agentJobs();
  let cached = null;
  try { cached = JSON.parse(await readFile(liveDatabasePath, 'utf8')); } catch {}
  jobDb.importAgentJobs([...(cached?.jobs || []).filter(job => job.origin !== 'agent'), ...saved].map(assessJob));
  jobDb.enrichPayloads(assessJob);
  databaseMigrated = true;
}
function syncExcelMirror(reason = 'database-update') {
  const operation = async () => {
    const tracker = await newestTracker();
    if (!tracker) throw new Error('The canonical Excel tracker is unavailable');
    const temp = await mkdtemp(join(tmpdir(), 'job-db-excel-'));
    const snapshotPath = join(temp, 'snapshot.json');
    try {
      const jobs = jobDb.listJobs({ includeInactive:true }).map(assessJob);
      await writeFile(snapshotPath, JSON.stringify({ updatedAt:new Date().toISOString(), reason, jobs }), 'utf8');
      await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [trackerWorkbook, 'sync-database', tracker.path, snapshotPath], { windowsHide:true, cwd:root });
        let error = '';
        child.stderr.on('data', chunk => error += chunk);
        child.on('error', reject);
        child.on('close', code => code === 0 ? resolve() : reject(new Error(conciseChildError(error, `Excel database sync failed (${code})`))));
      });
      const trackerStat = await stat(tracker.path);
      importedTracker = { path:tracker.path, modified:trackerStat.mtimeMs };
      let trackerStatus = {};
      try { trackerStatus = JSON.parse(await readFile(trackerImportStatusPath, 'utf8')); } catch {}
      await writeFile(trackerImportStatusPath, JSON.stringify({
        ...trackerStatus,
        tracker_path:tracker.path,
        tracker_file:basename(tracker.path),
        modified:trackerStat.mtimeMs,
        mirrored_from_sqlite_at:new Date().toISOString(),
        mirrored_jobs:jobs.length,
        mirror_reason:reason
      }, null, 2), 'utf8');
      jobDb.setMetadata('last_excel_sync', JSON.stringify({ reason, tracker:basename(tracker.path), jobs:jobs.length, syncedAt:new Date().toISOString() }));
      return { tracker:tracker.path, jobs:jobs.length };
    } finally { await rm(temp, { recursive:true, force:true }); }
  };
  excelSyncChain = excelSyncChain.then(operation, operation);
  return excelSyncChain;
}
function excelSyncInfo() {
  const metadata = jobDb.getMetadata('last_excel_sync');
  if (!metadata) return null;
  try { return { ...JSON.parse(metadata.value), metadataUpdatedAt:metadata.updatedAt }; }
  catch { return { value:metadata.value, metadataUpdatedAt:metadata.updatedAt }; }
}
const THREE_HOURS_MS = 3 * 60 * 60 * 1000;
const EXCEL_MIRROR_INTERVAL_MS = THREE_HOURS_MS;
function excelMirrorIsDue() {
  const info = excelSyncInfo();
  return !info?.syncedAt || Date.now() - Date.parse(info.syncedAt) >= EXCEL_MIRROR_INTERVAL_MS;
}
function queueExcelMirror(reason='database-update') {
  jobDb.setMetadata('excel_sync_pending', JSON.stringify({ reason, requestedAt:new Date().toISOString() }));
  if (!excelMirrorIsDue()) return;
  setTimeout(() => syncExcelMirror(reason).catch(error => {
    jobDb.setMetadata('last_excel_sync_error', JSON.stringify({ reason, message:error.message, at:new Date().toISOString() }));
  }), 0);
}
let databaseBackupChain = Promise.resolve();
function databaseBackupIsDue() {
  const metadata = jobDb.getMetadata('last_database_backup');
  if (!metadata) return true;
  try { return Date.now() - Date.parse(JSON.parse(metadata.value).createdAt) >= THREE_HOURS_MS; }
  catch { return true; }
}
function queueDatabaseBackup(reason='scheduled-3h') {
  if (!databaseBackupIsDue()) return databaseBackupChain;
  const operation = () => {
    // A second trigger can be queued while the first backup is still running.
    // Recheck after entering the serial chain to prevent duplicate snapshots.
    if (!databaseBackupIsDue()) return Promise.resolve({ ok:true, skipped:true, reason:'backup-not-due' });
    return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [databaseBackupScript, workspace], { windowsHide:true, cwd:root });
    let output = '', error = '';
    child.stdout.on('data', chunk => output += chunk);
    child.stderr.on('data', chunk => error += chunk);
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) return reject(new Error(conciseChildError(error, `Database backup failed (${code})`)));
      try {
        const result = JSON.parse(output.trim());
        jobDb.setMetadata('last_database_backup', JSON.stringify({ ...result, reason }));
        resolve(result);
      } catch (parseError) { reject(parseError); }
    });
    });
  };
  const guardedOperation = () => operation().catch(error => {
    jobDb.setMetadata('last_database_backup_error', JSON.stringify({ reason, message:error.message, at:new Date().toISOString() }));
    throw error;
  });
  databaseBackupChain = databaseBackupChain.then(guardedOperation, guardedOperation);
  return databaseBackupChain;
}
async function request(url, options = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const signal = AbortSignal.timeout(10000);
      const response = await fetch(url, { ...options, signal, headers: { 'user-agent': 'Alex-Job-Career-Command-Center/1.0', ...(options.headers || {}) } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 350));
    }
  }
  throw lastError;
}
async function json(url, options) { return (await request(url, options)).json(); }
async function publicHtml(url) {
  return (await request(url, { headers:{
    'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36',
    'accept':'text/html,application/xhtml+xml',
    'accept-language':'en-US,en;q=0.9'
  } })).text();
}
function decodeHtml(value='') {
  return String(value)
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>');
}
function htmlText(value='') { return clean(decodeHtml(value)); }
function richHtmlText(value='') {
  return decodeHtml(value)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/(?:p|li|ul|ol|h[1-6]|section|div)>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\t \f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
function classText(block, className) {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return htmlText((block.match(new RegExp(`<[^>]+class=["'][^"']*${escaped}[^"']*["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, 'i')) || [, ''])[1]);
}
function absoluteUrl(base, value='') {
  try { return new URL(decodeHtml(value), base).href; } catch { return ''; }
}
function englishChinaJob(input, source, extras={}) {
  return { ...normalise(input, source), rawLanguage:'English', market:'China', languageConfidence:'source-English', ...extras };
}
function chineseChinaJob(input, source, extras={}) {
  return { ...normalise(input, source), rawLanguage:'Chinese', market:'China', languageConfidence:'source-Chinese', ...extras };
}
function relevantChinaRole(job) {
  return /\b(it|ict|ai|data|digital|social media|seo|geo|software|developer|engineer|engineering|system|systems|infrastructure|cloud|azure|linux|windows|network|devops|technology|technical|automation|cyber|security|support)\b|系统管理|服务器管理|系统运维|运维工程|基础设施|混合云|云平台|云计算|微软\s*365|Microsoft\s*365|平台运维|IT运维|信息技术运维|网络运维|技术支持|自动化运维|数据中心/i.test(`${job.title} ${job.description}`);
}
function uniqueJobs(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = item.url || `${item.company}|${item.title}|${item.location}`.toLowerCase();
    if (!item.title || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function directSourceJobs(page, site, fallbackLocation) {
  const structured = jobPostingObjects(page).map(item => {
    const locations = Array.isArray(item.jobLocation) ? item.jobLocation : [item.jobLocation];
    const address = locations.map(location => addressValue(location?.address || location)).filter(Boolean).join(' / ');
    return normalise({ title:item.title || item.name, company:item.hiringOrganization?.name || site.name,
      description:richHtmlText(item.description || ''), location:address || locationFromTitle(item.title || item.name) || 'Location not stated',
      workAddress:address, url:absoluteUrl(site.url, item.url || item.mainEntityOfPage?.['@id'] || item.mainEntityOfPage),
      publication_date:item.datePosted, commitment:item.employmentType }, site.name);
  });
  const linked = [...String(page || '').matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map(([, href, label]) => ({ href:absoluteUrl(site.url, href), title:htmlText(label) }))
    .filter(item => item.href && /^https?:/i.test(item.href) && relevantResumeHeadline(item.title))
    .map(item => normalise({ title:item.title, company:site.name, location:locationFromTitle(item.title) || 'Location not stated', url:item.href }, site.name));
  return uniqueJobs([...structured, ...linked]).filter(job => relevantResumeHeadline(job.title)).slice(0, 25);
}
function directSourceFailure(error) {
  const message = String(error?.message || error || 'Source request failed');
  const status = Number((message.match(/HTTP\s+(\d{3})/i) || [])[1] || 0);
  return [401,403,429].includes(status) ? {status:'access_restricted',message} : {status:'unavailable',message};
}
async function attemptDirectSource(site, query, location) {
  const startedAt=Date.now(), checkedAt=new Date().toISOString();
  try {
    const urls=[...new Set([site.url, site.careerChangeUrl].filter(Boolean))];
    const pageResults=await Promise.allSettled(urls.map(async url => {
      const response=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(8000),headers:{
        'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36',
        'accept':'text/html,application/xhtml+xml','accept-language':'en-US,en;q=0.9,de;q=0.8'}});
      if(!response.ok) throw new Error('HTTP '+response.status);
      const contentType=response.headers.get('content-type')||'';
      return /html|text\//i.test(contentType)?response.text():'';
    }));
    const pages=pageResults.map(result => result.status === 'fulfilled' ? result.value : '');
    if (!pages.some(Boolean)) throw pageResults.find(result => result.status === 'rejected')?.reason || new Error('No readable source page');
    const jobs=uniqueJobs(pages.flatMap((page,index) => page ? directSourceJobs(page,{...site,url:urls[index]},providerLocation(location)).map(job => index > 0 ? {...job,careerChangePossible:true,careerChangeEvidence:'Dedicated Quereinstieg search page'} : job) : []));
    return {source:site.name+' (source pool)',registrySource:site.name,status:jobs.length?'ok':'no_matches',
      message:jobs.length?'Parsed '+jobs.length+' matching postings from the configured source URL':'Configured source URL was searched, but no matching public postings could be parsed',
      jobs,checkedAt,latencyMs:Date.now()-startedAt,searchUrl:site.url,query,location};
  } catch(error) {
    return {source:site.name+' (source pool)',registrySource:site.name,...directSourceFailure(error),jobs:[],checkedAt,latencyMs:Date.now()-startedAt,searchUrl:site.url,query,location};
  }
}
async function mapWithConcurrency(items, limit, worker) {
  const output=new Array(items.length); let cursor=0;
  async function run(){while(true){const index=cursor++;if(index>=items.length)return;output[index]=await worker(items[index],index);}}
  await Promise.all(Array.from({length:Math.min(limit,items.length)},run));
  return output;
}
async function eChinaCitiesJobs() {
  const url = 'https://jobs.echinacities.com/jobs/search?keyword=IT+Social+Media+Engineering+Engineer+software&cityid=&ins_ids=&jobType=6&lastUpdate=0&money_type=1&min_salary=&max_salary=';
  const page = await publicHtml(url);
  const marker = page.search(/var\s+_searchJobList\s*=\s*/);
  const valueStart = marker < 0 ? -1 : page.indexOf('{', marker);
  const scriptEnd = valueStart < 0 ? -1 : page.indexOf('</script>', valueStart);
  const valueEnd = scriptEnd < 0 ? -1 : page.lastIndexOf(';', scriptEnd);
  if (valueStart < 0 || valueEnd <= valueStart) throw new Error('Public eChinaCities listing data was not found');
  const payload = JSON.parse(page.slice(valueStart, valueEnd));
  return (payload.data?.list || []).map(item => englishChinaJob({
    title:item.title, company:item.company_name, description:item.description,
    location:item.city ? cityFromChineseText(item.city) : 'China',
    url:`https://jobs.echinacities.com/jobchapter/${item.id}`,
    publication_date:item.refresh_time, commitment:item.job_type
  }, 'eChinaCities Jobs', {
    salaryText:item.salaryRmb || item.salary || '', salaryBasis:'listed · CNY/month',
    workType:item.job_type || 'Not stated', externalId:String(item.id), verified:false
  })).filter(relevantChinaRole);
}
function parseChinaJobCards(page) {
  return [...page.matchAll(/<div class=["']cj-job-item["']>([\s\S]*?)(?=<div class=["']cj-job-item["']>|<div class=["'][^"']*(?:pagination|page))/gi)].map(([, block]) => {
    const path = (block.match(/location\.href=["']([^"']*job-detail\.php[^"']+)["']/i) || [, ''])[1];
    const info = [...block.matchAll(/<span class=["'][^"']*info-txt[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi)].map(match => htmlText(match[1]));
    return englishChinaJob({ title:classText(block, 'job-title'), company:htmlText((block.match(/class=["']job-post["'][^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i) || [, ''])[1]), location:info[1], url:absoluteUrl('https://www.chinajob.com/job/', path), commitment:info[0] }, 'ChinaJob', { salaryText:info[2] || '', salaryBasis:'listed · RMB', verified:false });
  });
}
function extractChinaJobDetail(page) {
  const source = String(page || '');
  const title = htmlText((source.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i) || [,''])[1]);
  const starts = [
    source.search(/<strong>\s*About Company:\s*<\/strong>/i),
    source.search(/<strong>\s*Job Profile:\s*<\/strong>/i),
    source.search(/<strong>\s*Job Details:\s*<\/strong>/i),
    source.search(/<p\b[^>]*class=["'][^"']*fwb[^"']*["'][^>]*>\s*Responsibilities:\s*<\/p>/i)
  ].filter(index => index >= 0);
  if (!starts.length) return '';
  const tail = source.slice(Math.min(...starts));
  const end = tail.search(/<a\b[^>]+href=["'][^"']*(?:jobapply\.php|candidate\/login\.php)[^"']*["'][^>]*>/i);
  const bounded = tail.slice(0, end >= 0 ? end : Math.min(tail.length, 150000));
  const detail = htmlText([title, bounded].filter(Boolean).join(' ')).slice(0, 50000);
  return detail.length >= 180 ? detail : '';
}
async function chinaJobJobs() {
  const categories = ['IT', 'Engineer - Information/Electron/Telecommunication'];
  const pages = await Promise.all(categories.map(category => publicHtml(`https://www.chinajob.com/job/index.php?m=s&f=${encodeURIComponent(category)}&l=&q=`)));
  const jobs = uniqueJobs(pages.flatMap(parseChinaJobCards)).filter(relevantChinaRole);
  return Promise.all(jobs.map(async job => {
    try {
      const description = extractChinaJobDetail(await publicHtml(job.url));
      return description ? { ...job, description, jdFetched:true, jdSource:'exact ChinaJob posting page' } : job;
    } catch {
      return job;
    }
  }));
}
function parseForeignHrCards(page) {
  return [...page.matchAll(/<article class=["']js_result_row["']>([\s\S]*?)<\/article>/gi)].map(([, block]) => {
    const path = (block.match(/location\.href=["']([^"']*job_details\.php[^"']+)["']/i) || [, ''])[1];
    return englishChinaJob({
      title:classText(block, 'job-title'),
      company:htmlText((block.match(/class=["']job-post["'][^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i) || [, ''])[1]),
      description:classText(block, 'job-desc'), location:classText(block, 'info-txt-local'),
      url:absoluteUrl('https://foreignhr.com/', path), commitment:classText(block, 'info-txt-time')
    }, 'ForeignHR', { salaryText:classText(block, 'info-txt-money'), salaryBasis:'listed · RMB/month', verified:false });
  });
}
async function foreignHrJobs() {
  const pages = await Promise.all(['IT', 'Engineering'].map(category => publicHtml(`https://foreignhr.com/jobs_search_result.php?f=${encodeURIComponent(category)}&m=s`)));
  return uniqueJobs(pages.flatMap(parseForeignHrCards)).filter(job => /China/i.test(job.location) && relevantChinaRole(job));
}
function parseLaowaiCards(page) {
  return [...page.matchAll(/<div class=["'][^"']*\bjobpanel\b[^"']*["'][^>]*>([\s\S]*?)(?=<div class=["'][^"']*\bjobpanel\b|<\/div>\s*<\/div>\s*<\/div>)/gi)].map(([, block]) => {
    const titleLink = block.match(/class=["']job-title-box["'][^>]*>[\s\S]*?<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i) || [];
    const company = htmlText((block.match(/title=["']([^"']+)\s+-\s+[^"']+["']/i) || [, ''])[1]);
    const field = name => htmlText((block.match(new RegExp(`class=["'][^"']*${name}[^"']*["'][^>]*>([\\s\\S]*?)<\\/div>`, 'i')) || [, ''])[1]);
    return englishChinaJob({ title:htmlText(titleLink[2]), company, location:field('job-location-box'), url:absoluteUrl('https://www.laowaicareer.com/', titleLink[1]), commitment:field('job-type-box') }, 'LaowaiCareer', { salaryText:field('job-salary-box'), salaryBasis:'listed · source display', verified:false });
  });
}
async function laowaiCareerJobs(location) {
  const city = providerLocation(location);
  const path = city && city !== 'China' ? `/search/jobs/${encodeURIComponent(city)}` : '/search/jobs';
  return uniqueJobs(parseLaowaiCards(await publicHtml(`https://www.laowaicareer.com${path}`))).filter(relevantChinaRole);
}
function parseEChinaCareerAjax(page) {
  return [...page.matchAll(/<div class=["']row job-row["'][^>]*>([\s\S]*?)(?=<div class=["']row job-row["']>|No More Results)/gi)].map(([, block]) => {
    const call = block.match(/AJAXJobFetch\(["']?(\d+)["']?\s*,\s*["']?(\d+)["']?\s*,\s*["']([^"']+)["']/i) || [];
    const text = htmlText(block);
    return englishChinaJob({ title:call[3], company:'eChinaCareers employer', description:text, location:(text.match(/([A-Za-z]+)\s*\([^)]*\)\s*,?\s*China/i) || [, 'China'])[1] + ', China', url:call[1] ? `https://echinacareers.com/Jobs/JobSearch?input=${encodeURIComponent(call[3])}&empID=${call[2]}&job_ID=${call[1]}` : '' }, 'eChinaCareers', { externalId:call[1] || '', verified:false });
  });
}
async function eChinaCareerJobs(location) {
  const params = new URLSearchParams({ keywords:'IT', pageNum:'1', locations:providerLocation(location) === 'China' ? '' : providerLocation(location), employerID:'0', job_ID:'0', specialisms_:'', jobType_:'', minSalary_:'', maxSalary_:'', jobFunctions:'Software,Technology' });
  return parseEChinaCareerAjax(await publicHtml(`https://echinacareers.com/Jobs/JobSearchAJAX?${params}`)).filter(relevantChinaRole);
}
function xmlItems(xml, source) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(([, item]) => {
    const tag = name => clean((item.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i')) || [, ''])[1].replace(/<!\[CDATA\[|\]\]>/g, ''));
    return normalise({ title: tag('title'), description: tag('description'), url: tag('link'), publication_date: tag('pubDate'), company: source, location: 'Remote / confirm' }, source);
  });
}
function chinaLocationFromText(value='') {
  const text = clean(value);
  const cities = ['Shanghai','Beijing','Guangzhou','Shenzhen','Hangzhou','Chengdu','Nanjing','Suzhou','Wuhan',"Xi'an",'Chongqing','Tianjin','Qingdao','Xiamen','Ningbo','Hong Kong'];
  const city = cities.find(item => new RegExp(item.replace("'", "['’]?"), 'i').test(text));
  return city ? `${city}, China` : /\bChina\b/i.test(text) ? 'China' : '';
}
async function sinoJobs() {
  const xml = await (await request('https://www.sinojobs.com/en/rss/action/rss/controller/Job.rss')).text();
  return xmlItems(xml, 'SinoJobs').map(job => ({ ...englishChinaJob(job, 'SinoJobs'), location:chinaLocationFromText(`${job.title} ${job.description}`) }))
    .filter(job => job.location && relevantChinaRole(job));
}
async function smartShanghaiJobs() {
  const page = await publicHtml('https://www.smartshanghai.com/jobs/list/');
  return uniqueJobs([...page.matchAll(/<a[^>]+href=["'](\/jobs\/[^"'#?]+)["'][^>]*>([\s\S]*?)<\/a>/gi)].map(([, path, label]) => englishChinaJob({
    title:htmlText(label), company:'SmartShanghai listed employer', location:'Shanghai, China', url:absoluteUrl('https://www.smartshanghai.com/', path)
  }, 'SmartShanghai Jobs', { verified:false }))).filter(relevantChinaRole);
}
function jsonLdJobPostings(page, base, source, fallbackLocation='China') {
  const records = [];
  const visit = value => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== 'object') return;
    if (value['@type'] === 'JobPosting' || (Array.isArray(value['@type']) && value['@type'].includes('JobPosting'))) records.push(value);
    Object.values(value).forEach(child => { if (child && typeof child === 'object') visit(child); });
  };
  for (const match of page.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { visit(JSON.parse(match[1].trim())); } catch {}
  }
  return uniqueJobs(records.map(item => {
    const address = item.jobLocation?.address || item.jobLocation?.[0]?.address || {};
    const location = [address.addressLocality, address.addressRegion, address.addressCountry].filter(Boolean).join(', ') || fallbackLocation;
    return englishChinaJob({ title:item.title, company:item.hiringOrganization?.name, description:item.description, location, url:absoluteUrl(base, item.url || item.mainEntityOfPage?.['@id'] || item.mainEntityOfPage), publication_date:item.datePosted, commitment:Array.isArray(item.employmentType) ? item.employmentType.join(', ') : item.employmentType }, source, { verified:false });
  })).filter(relevantChinaRole);
}
async function haysChinaJobs() {
  return jsonLdJobPostings(await publicHtml('https://www.hays-china.cn/en/jobs'), 'https://www.hays-china.cn/', 'Hays China Jobs');
}
const zhipinCityCodes = { Shanghai:'101020100', Beijing:'101010100', Guangzhou:'101280100', Shenzhen:'101280600', Hangzhou:'101210100', Chengdu:'101270100', Nanjing:'101190100', Suzhou:'101190400', Wuhan:'101200100', "Xi'an":'101110100', Chongqing:'101040100', Tianjin:'101030100', Qingdao:'101120200', Xiamen:'101230200', Ningbo:'101210400' };
async function bossZhipinJobs(location) {
  const selected = providerLocation(location);
  const cityNames = selected === 'China' ? ['Shanghai','Beijing','Guangzhou','Shenzhen','Hangzhou'] : [selected];
  const pages = await Promise.all(cityNames.filter(name => zhipinCityCodes[name]).map(async city => {
    const payload = await json(`https://www.zhipin.com/wapi/zpgeek/pc/recommend/job/list.json?page=1&pageSize=30&city=${zhipinCityCodes[city]}`);
    if (payload.code !== 0) throw new Error(payload.message || 'BOSS Zhipin public search did not return jobs');
    return (payload.zpData?.jobList || []).map(item => englishChinaJob({ title:item.jobName, company:item.brandName, description:[item.skills?.join(', '), item.jobExperience, item.jobDegree].filter(Boolean).join(' · '), location:`${item.cityName || city}, China`, url:item.encryptJobId ? `https://www.zhipin.com/job_detail/${item.encryptJobId}.html` : '', commitment:item.jobType }, 'BOSS Zhipin', { salaryText:item.salaryDesc || '', salaryBasis:'listed · source display', externalId:item.encryptJobId || '', rawLanguage:'Chinese / English to confirm', languageConfidence:'confirm', verified:false }));
  }));
  return uniqueJobs(pages.flat()).filter(relevantChinaRole);
}
const chineseRoleSearches = [
  '系统管理员',
  '基础设施工程师',
  'IT运维工程师'
];
const chinaCityChinese = {
  Shanghai:'上海', Beijing:'北京', Guangzhou:'广州', Shenzhen:'深圳', Hangzhou:'杭州',
  Chengdu:'成都', Nanjing:'南京', Suzhou:'苏州', Wuhan:'武汉', "Xi'an":'西安',
  Chongqing:'重庆', Tianjin:'天津', Qingdao:'青岛', Xiamen:'厦门', Ningbo:'宁波'
};
function chineseSearchCity(location) {
  const selected = providerLocation(location);
  return selected === 'China' ? '全国' : (chinaCityChinese[selected] || selected || '全国');
}
function cityFromChineseText(value='') {
  const text = clean(value);
  const found = Object.entries(chinaCityChinese).find(([, chinese]) => text.includes(chinese));
  return found ? `${found[0]}, China` : 'China';
}
function jsonScript(page, pattern) {
  const match = String(page).match(pattern);
  if (!match) throw new Error('Public embedded listing data was not found');
  return JSON.parse(match[1].trim().replace(/;\s*$/, ''));
}
function collectObjects(value, predicate, output=[]) {
  if (!value || typeof value !== 'object') return output;
  if (predicate(value)) output.push(value);
  Object.values(value).forEach(child => collectObjects(child, predicate, output));
  return output;
}
function parseZhaopinResults(page) {
  const state = jsonScript(page, /__INITIAL_STATE__=([\s\S]*?)<\/script>/i);
  const records = collectObjects(state, item => Boolean(item?.position?.base?.positionId));
  return uniqueJobs(records.map(item => {
    const base = item.position.base;
    const locationText = [item.position.workLocation?.address, item.position.workLocation?.workAddress].filter(Boolean).join(' ');
    return chineseChinaJob({
      title:base.positionName,
      company:item.companyProxy?.companyName || item.staff?.companyName || 'Zhaopin listed employer',
      description:item.position.desc?.description || '',
      location:cityFromChineseText(locationText),
      url:`https://www.zhaopin.com/jobdetail/${base.positionNumber}.htm`,
      publication_date:item.position.date?.positionPublishTime || item.position.date?.positionUpdateTime,
      commitment:base.workType
    }, 'Zhaopin', {
      salaryText:base.salary || '', salaryBasis:'listed · source display', externalId:String(base.positionId),
      experience:item.position.base?.positionWorkingExp || '', verified:false
    });
  })).filter(relevantChinaRole);
}
async function zhaopinJobs(location) {
  const city = chineseSearchCity(location);
  const pages = await Promise.all(chineseRoleSearches.map(keyword => publicHtml(`https://sou.zhaopin.com/?jl=${encodeURIComponent(city)}&kw=${encodeURIComponent(keyword)}`)));
  return uniqueJobs(pages.flatMap(parseZhaopinResults));
}
function parseLagouResults(page) {
  const state = jsonScript(page, /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  const records = collectObjects(state, item => Boolean(item?.positionId && item?.positionName));
  return uniqueJobs(records.map(item => chineseChinaJob({
    title:item.positionName,
    company:item.companyFullName || item.companyShortName || 'Lagou listed employer',
    description:htmlText([item.positionDetail, ...(item.skillLables || [])].filter(Boolean).join(' ')),
    location:item.city ? `${item.city}, China` : 'China',
    url:`https://www.lagou.com/wn/jobs/${item.positionId}.html`,
    publication_date:item.createTime || item.updateTime,
    commitment:item.jobNature
  }, 'Lagou', {
    salaryText:item.salary || '', salaryBasis:'listed · source display', externalId:String(item.positionId),
    experience:item.workYear || '', verified:false
  }))).filter(relevantChinaRole);
}
async function lagouJobs(location) {
  const city = chineseSearchCity(location);
  const cityParam = city === '全国' ? '' : `&city=${encodeURIComponent(city)}`;
  const pages = await Promise.all(chineseRoleSearches.map(keyword => publicHtml(`https://www.lagou.com/wn/jobs?kd=${encodeURIComponent(keyword)}${cityParam}`)));
  return uniqueJobs(pages.flatMap(parseLagouResults));
}
function relevantResumeHeadline(value='') {
  return /system(?:s)?[- ]?(?:administrator|engineer)|server[- ]?(?:administrator|engineer)|windows[- ]?administrator|linux[- ]?administrator|it[- ]?administrator|infrastructure|datacenter|data center|virtuali[sz]ation|vmware|cloud[- ]?(?:administrator|engineer|operations)|azure[- ]?(?:administrator|engineer)|microsoft 365|modern workplace|endpoint[- ]?administrator|intune|it[- ]?operations|platform[- ]?administrator|application[- ]?administrator|technical support|l2|l3|service delivery|it service engineer|it[- ]?consultant|technical consultant|systemadministrator|systemingenieur|infrastruktur|rechenzentrum|cloud[- ]?administrator|cloud[- ]?betrieb|it[- ]?betrieb|plattform[- ]?administrator|anwendungsadministrator|it[- ]?berater|it[- ]?consultant|servicetechniker/i.test(clean(value));
}
function jobPostingObjects(page) {
  const postings = [];
  for (const match of String(page || '').matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      // Parse the JSON before decoding HTML entities. Some career pages keep
      // carriage returns as &#13; inside JSON strings; decoding first would
      // create an illegal literal control character and discard the full JD.
      const parsed = JSON.parse(match[1].trim());
      const queue = Array.isArray(parsed) ? [...parsed] : [parsed];
      while (queue.length) {
        const item = queue.shift();
        if (!item || typeof item !== 'object') continue;
        if (Array.isArray(item['@graph'])) queue.push(...item['@graph']);
        const types = Array.isArray(item['@type']) ? item['@type'] : [item['@type']];
        if (types.some(type => String(type).toLowerCase() === 'jobposting')) postings.push(item);
      }
    } catch {}
  }
  return postings;
}
function extractMainPageText(page) {
  const source = String(page || '');
  const structured = jobPostingObjects(source)
    .map(posting => richHtmlText(posting.description || ''))
    .sort((a, b) => b.length - a.length)[0] || '';
  if (structured.length >= 500) return structured.slice(0, 50000);
  const candidates = [...source.matchAll(/<(?:main|article)\b[^>]*>([\s\S]*?)<\/(?:main|article)>/gi)]
    .map(match => htmlText(match[1]))
    .filter(text => text.length >= 500)
    .sort((a, b) => b.length - a.length);
  return (candidates[0] || structured).slice(0, 50000);
}
function extractPostedAddress(page) {
  for (const item of jobPostingObjects(page)) {
    const locations = Array.isArray(item.jobLocation) ? item.jobLocation : [item.jobLocation];
    const address = locations.map(location => addressValue(location?.address || location)).filter(Boolean).join(' / ');
    if (address) return address;
  }
  return '';
}
function parseGetInItCards(page) {
  const cards = [...String(page).matchAll(/<a\b[^>]*class=["'][^"']*CardJob_jobCard[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  return cards.map(([, path, block]) => normalise({
    title:htmlText((block.match(/CardJob_jobTitle[^>]*>([\s\S]*?)<\/div>/i) || [,''])[1]),
    company:htmlText((block.match(/<img[^>]+alt=["']([^"']+)["']/i) || [,'get in IT listed employer'])[1]),
    location:htmlText((block.match(/IconLocation_location[\s\S]*?popover-wrapper[^>]*>([\s\S]*?)<\/div>/i) || [,'Germany'])[1]),
    url:absoluteUrl('https://www.get-in-it.de/', path),
    commitment:'Not stated'
  }, 'get in IT')).filter(job => relevantResumeHeadline(job.title));
}
async function getInItJobs() {
  const jobs = uniqueJobs(parseGetInItCards(await publicHtml('https://www.get-in-it.de/jobsuche')));
  return Promise.all(jobs.map(async job => {
    try {
      const page = await publicHtml(job.url);
      const description = extractMainPageText(page);
      const workAddress = extractPostedAddress(page);
      return description || workAddress ? { ...job, description:description || job.description, workAddress:workAddress || job.workAddress, jdFetched:Boolean(description), jdSource:'exact get in IT posting page' } : job;
    } catch { return job; }
  }));
}
function parseIonosRows(page) {
  return [...String(page).matchAll(/<tr\b[^>]*class=["'][^"']*table-component-row[^"']*["'][^>]*>([\s\S]*?)<\/tr>/gi)].map(([, block]) => {
    const link = block.match(/<a\b[^>]*class=["'][^"']*link--neutral[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i) || [];
    const cells = [...block.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(match => htmlText(match[1]));
    return normalise({ title:htmlText(link[2]), company:'IONOS', description:cells[1] || '', location:cells[2] || 'Germany', url:absoluteUrl('https://jobs.ionos.de/', link[1]), commitment:'Not stated' }, 'IONOS Careers');
  }).filter(job => relevantResumeHeadline(job.title));
}
async function ionosJobs() {
  const jobs = uniqueJobs(parseIonosRows(await publicHtml('https://jobs.ionos.de/karriere/jobs/alle-jobs')));
  return Promise.all(jobs.map(async job => {
    try {
      const page = await publicHtml(job.url);
      const description = extractMainPageText(page);
      const workAddress = extractPostedAddress(page);
      return description || workAddress ? { ...job, description:description || job.description, workAddress:workAddress || job.workAddress, jdFetched:Boolean(description), jdSource:'exact IONOS posting page' } : job;
    } catch { return job; }
  }));
}
const stuttgartRadius = { city:'Stuttgart', latitude:48.7758, longitude:9.1829, maxDistance:50 };
async function schwarzSearchPage(host, term, page, location) {
  const payload = {
    term,
    page,
    perPage:50,
    includeAllLanguages:true,
    filters:{},
    ...(location === 'Stuttgart area' ? { location:stuttgartRadius } : {})
  };
  return json(`${host}/api/v1/job/search`, {
    method:'POST',
    headers:{ 'content-type':'application/json', 'accept':'application/json' },
    body:JSON.stringify(payload)
  });
}
async function schwarzFeedJobs({ stackit=false, location='' }={}) {
  const host = stackit ? 'https://stackit.com' : 'https://schwarz-digits.de';
  const term = stackit ? 'STACKIT' : '';
  const firstPage = await schwarzSearchPage(host, term, 1, location);
  const totalPages = Math.max(1, Math.ceil(Number(firstPage.pagination?.totalCount || firstPage.jobs?.length || 0) / 50));
  const remaining = await Promise.all(Array.from({ length:totalPages - 1 }, (_, index) => schwarzSearchPage(host, term, index + 2, location)));
  const source = stackit ? 'STACKIT Careers' : 'Schwarz Digits';
  const jobs = uniqueJobs([firstPage, ...remaining].flatMap(result => result.jobs || []).map(item => normalise({
    title:item.title,
    company:stackit ? 'STACKIT' : 'Schwarz Digits',
    location:item.location,
    url:item.url,
    experience:item.entryLevel
  }, source)).filter(job => relevantResumeHeadline(job.title) && (stackit || !/\bSTACKIT\b/i.test(job.title))));
  return Promise.all(jobs.map(async job => {
    try {
      const page = await publicHtml(job.url);
      const description = extractMainPageText(page);
      const workAddress = extractPostedAddress(page);
      return description || workAddress ? { ...job, description:description || job.description, workAddress:workAddress || job.workAddress, jdFetched:Boolean(description), jdSource:`exact ${source} posting page` } : job;
    } catch { return job; }
  }));
}
function configuredProvider(name, ready, run) { return { name, ready, run }; }
function primarySearchTerm(query) { return String(query).split(/\s+(?:OR|AND)\s+/i)[0].trim() || 'system administrator'; }
const resumeSearchLanes = [
  'system administrator OR systems administrator OR server administrator OR IT administrator OR Windows administrator OR Linux administrator',
  'system engineer OR infrastructure engineer OR IT infrastructure engineer OR datacenter engineer OR VMware engineer OR virtualization engineer',
  'cloud administrator OR Azure administrator OR cloud operations engineer OR hybrid cloud engineer OR Microsoft 365 administrator OR Modern Workplace engineer',
  'IT operations engineer OR platform administrator OR application administrator OR service delivery engineer OR IT service engineer OR IT consultant infrastructure OR technical consultant',
  'IT Quereinsteiger OR Quereinstieg IT-Systemadministrator OR Quereinstieg IT Support OR Quereinstieg IT Consultant'
];
function providerSearchLanes(query) {
  const value = clean(query);
  return !value || value === profile.defaultQuery ? resumeSearchLanes : [value];
}
function providerLocation(location) {
  if (location === 'Stuttgart area') return 'Stuttgart';
  if (location === 'Shanghai + hybrid' || location === 'Shanghai only') return 'Shanghai';
  if (location === 'China major cities') return 'China';
  return location;
}
async function sources(query, location, config) {
  const encoded = encodeURIComponent(query);
  const searchLanes = providerSearchLanes(query);
  const primaryTerms = searchLanes.map(lane => encodeURIComponent(primarySearchTerm(lane)));
  const primary = primaryTerms[0];
  const sourceLocation = providerLocation(location);
  const chinaMarket = /china|shanghai|beijing|guangzhou|shenzhen|hangzhou|chengdu|nanjing|suzhou|wuhan|xi'an|chongqing|tianjin|qingdao|xiamen|ningbo/i.test(location);
  const countryCode = chinaMarket ? 'CN' : 'DE';
  const remoteGeo = chinaMarket ? 'china' : 'germany';
  const germanLocation = sourceLocation && sourceLocation !== 'Germany' ? `&wo=${encodeURIComponent(sourceLocation)}` : '';
  const chinaProviders = chinaMarket ? [
    configuredProvider('eChinaCities Jobs', true, eChinaCitiesJobs),
    configuredProvider('ChinaJob', true, chinaJobJobs),
    configuredProvider('ForeignHR', true, foreignHrJobs),
    configuredProvider('LaowaiCareer', true, () => laowaiCareerJobs(location)),
    configuredProvider('eChinaCareers', true, () => eChinaCareerJobs(location)),
    configuredProvider('SinoJobs', true, sinoJobs),
    configuredProvider('SmartShanghai Jobs', true, smartShanghaiJobs),
    configuredProvider('Hays China Jobs', true, haysChinaJobs),
    configuredProvider('BOSS Zhipin', true, () => bossZhipinJobs(location)),
    configuredProvider('Zhaopin', true, () => zhaopinJobs(location)),
    configuredProvider('Lagou', true, () => lagouJobs(location))
  ] : [];
  return [
    ...chinaProviders,
    ...(chinaMarket ? [] : [
      configuredProvider('get in IT', true, getInItJobs),
      configuredProvider('IONOS Careers', true, ionosJobs),
      configuredProvider('Schwarz Digits', true, () => schwarzFeedJobs({ location })),
      configuredProvider('STACKIT Careers', true, () => schwarzFeedJobs({ stackit:true, location }))
    ]),
    configuredProvider('Arbeitnow', true, async () => (await json('https://www.arbeitnow.com/api/job-board-api')).data.map(x => normalise(x, 'Arbeitnow'))),
    configuredProvider('Bundesagentur Arbeit Jobsuche', true, async () => uniqueJobs((await Promise.all(primaryTerms.map(async term => {
      const radius = location === 'Stuttgart area' ? '&umkreis=50' : '';
      const payload = await json(`https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc/v6/jobs?was=${term}${germanLocation}${radius}&size=100`, { headers:{ 'x-api-key':'jobboerse-jobsuche' } });
      return (payload.ergebnisliste || []).map(x => normalise(x, 'Bundesagentur Arbeit Jobsuche'));
    }))).flat())),
    configuredProvider('Bundesagentur Arbeit Jobsuche — Quereinstieg', true, async () => uniqueJobs((await Promise.all(primaryTerms.map(async term => {
      const radius = location === 'Stuttgart area' ? '&umkreis=50' : '';
      const payload = await json(`https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc/v6/jobs?was=${term}${germanLocation}${radius}&quereinstieg=true&size=100`, { headers:{ 'x-api-key':'jobboerse-jobsuche' } });
      return (payload.ergebnisliste || []).map(x => ({ ...normalise(x, 'Bundesagentur Arbeit Jobsuche'), careerChangePossible:true, careerChangeEvidence:'Bundesagentur filter: Quereinstieg möglich' }));
    }))).flat())),
    configuredProvider('Remotive', true, async () => (await json(`https://remotive.com/api/remote-jobs?search=${primary}`)).jobs.map(x => normalise(x, 'Remotive'))),
    configuredProvider('Jobicy', true, async () => (await json(`https://jobicy.com/api/v2/remote-jobs?count=100&geo=${remoteGeo}&tag=${primary}`)).jobs.map(x => normalise(x, 'Jobicy'))),
    configuredProvider('Remote OK', true, async () => (await json('https://remoteok.com/api')).slice(1).map(x => normalise(x, 'Remote OK'))),
    configuredProvider('We Work Remotely', true, async () => xmlItems(await (await request('https://weworkremotely.com/categories/remote-sysadmin-devops-jobs.rss')).text(), 'We Work Remotely')),
    configuredProvider('The Muse', true, async () => (await json(`https://www.themuse.com/api/public/jobs?category=Engineering&location=${encodeURIComponent(sourceLocation || 'Germany')}&page=0`)).results.map(x => normalise({ title:x.name, company:x.company?.name, description:x.contents, location:x.locations?.[0]?.name, url:x.refs?.landing_page, publication_date:x.publication_date }, 'The Muse'))),
    configuredProvider('Freehire', true, async () => uniqueJobs((await Promise.all(searchLanes.map(async lane => (await json(`https://freehire.me/api/v1/jobs/search?q=${encodeURIComponent(lane)}&countries=${countryCode}&limit=100`)).data.map(x => {
      const job = normalise({ title:x.title, company:x.company, description:x.description, location:x.location, url:x.url, salary_min:x.enrichment?.salary_min, salary_max:x.enrichment?.salary_max, publication_date:x.posted_at }, 'Freehire');
      return { ...job, source:`Freehire · ${x.source || 'direct ATS'}`, provider:'Freehire' };
    })))).flat())),
    configuredProvider('Adzuna', isConfigured(config.adzuna?.appId) && isConfigured(config.adzuna?.appKey), async () => (await json(`https://api.adzuna.com/v1/api/jobs/de/search/1?app_id=${encodeURIComponent(config.adzuna.appId)}&app_key=${encodeURIComponent(config.adzuna.appKey)}&what=${encoded}&where=${encodeURIComponent(sourceLocation || 'Germany')}&results_per_page=50&content-type=application/json`)).results.map(x => normalise(x, 'Adzuna'))),
    configuredProvider('Jooble', isConfigured(config.jooble?.apiKey), async () => (await json(`https://jooble.org/api/${encodeURIComponent(config.jooble.apiKey)}`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ keywords:query, location:sourceLocation || 'Germany' }) })).jobs.map(x => normalise(x, 'Jooble'))),
    configuredProvider('Google Jobs via SerpApi', isConfigured(config.serpApi?.apiKey), async () => (await json(`https://serpapi.com/search.json?engine=google_jobs&q=${encoded}+in+${encodeURIComponent(sourceLocation || 'Germany')}&api_key=${encodeURIComponent(config.serpApi.apiKey)}`)).jobs_results.map(x => normalise({ title:x.title, company:x.company_name, description:x.description, location:x.location, url:x.related_links?.[0]?.link, date:x.detected_extensions?.posted_at }, 'Google Jobs via SerpApi'))),
    configuredProvider('JSearch', isConfigured(config.jsearch?.apiKey), async () => (await json(`https://jsearch.p.rapidapi.com/search?query=${encoded}+in+${encodeURIComponent(sourceLocation || 'Germany')}&num_pages=1`, { headers:{'x-rapidapi-key':config.jsearch.apiKey,'x-rapidapi-host':'jsearch.p.rapidapi.com'} })).data.map(x => normalise(x, 'JSearch')))
  ];
}
function score(job) {
  const text = `${job.title} ${job.description}`.toLowerCase();
  const evidence = Object.entries(profile.skills).filter(([, terms]) => terms.some(term => text.includes(term))).map(([skill]) => skill);
  const titleFit = /system(?:s)? administrator|server administrator|windows administrator|linux administrator|it administrator|system engineer|infrastructure|datacenter|virtuali[sz]ation|vmware|cloud.*(?:engineer|administrator|operations)|azure.*admin|microsoft 365|modern workplace|endpoint administrator|intune administrator|it operations|platform administrator|application administrator|service delivery|it service engineer|technical support|l2|l3|it consultant|technical consultant|devops/i.test(job.title) ? 20 : 7;
  const value = Math.min(98, Math.round(42 + titleFit + Math.min(33, evidence.length * 4.7) + (job.remote ? 3 : 0)));
  return assessAgainstResume({ ...job, discoveryScore:value, match:value, evidence });
}
function dedupe(items) { const seen = new Set(); return items.filter(x => { const key = `${x.company}|${x.title}|${x.location}`.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, ''); if (!x.title || seen.has(key)) return false; seen.add(key); return true; }); }
function filter(items, query, location, includeRemoteAnywhere=false) {
  if (!location || location === 'Germany') return items;
  return items.filter(job => matchesLocation(job, location, locationOptions, includeRemoteAnywhere));
}
async function providerDirectory(query, location) {
  const [sources, healthReport] = await Promise.all([
    loadDirectSources(),
    existsSync(sourceHealthPath) ? readFile(sourceHealthPath, 'utf8').then(JSON.parse).catch(() => ({})) : {}
  ]);
  const healthByUrl = new Map((healthReport.sources || []).map(item => [sourceUrlKey(item.url), item]));
  return sources.map(site => {
    const health = healthByUrl.get(sourceUrlKey(site.url)) || {};
    return {
      ...site,
      registryStatus:site.status || 'configured',
      availability:site.healthOverride || health.classification || 'not_checked',
      httpStatus:health.httpStatus || 0,
      checkedAt:health.checkedAt || '',
      latencyMs:health.latencyMs,
      healthMessage:health.message || '',
      query,
      location,
      status:'open_search'
    };
  });
}
async function search(params, onProgress = () => {}, refreshId = randomUUID()) {
  onProgress({ progress:3, phase:'Importing Excel tracker', completedSources:0, totalSources:0 });
  await safeImportTrackerIfNeeded();
  const config = await getConfig();
  const query = params.get('query') || profile.defaultQuery;
  const location = params.get('location') || 'Germany';
  const includeRemoteAnywhere = params.get('includeRemoteAnywhere') === 'true';
  const [providers, directSites] = await Promise.all([sources(query, location, config), loadDirectSources()]);
  const totalSources = providers.length + directSites.length;
  let completedSources = 0;
  onProgress({ progress:8, phase:'Preparing full source-pool search', completedSources, totalSources });
  const reportProgress = name => {
    completedSources += 1;
    onProgress({ progress:8 + Math.round((completedSources / Math.max(1, totalSources)) * 72), phase:'Checked '+name, completedSources, totalSources });
  };
  const automaticPromise = Promise.all(providers.map(async provider => {
    let result;
    const startedAt = Date.now();
    if (!provider.ready) result = { source:provider.name, status:'needs_key', jobs:[] };
    else {
      try { result = { source:provider.name, status:'ok', jobs:await provider.run() }; }
      catch (error) { result = { source:provider.name, status:'unavailable', message:error.message, jobs:[] }; }
    }
    result.latencyMs = Date.now() - startedAt;
    result.checkedAt = new Date().toISOString();
    reportProgress(provider.name);
    return result;
  }));
  const directPromise = mapWithConcurrency(directSites, 12, async site => {
    const result = await attemptDirectSource(site, query, location);
    reportProgress(site.name);
    return result;
  });
  const [automaticResults, directResults] = await Promise.all([automaticPromise, directPromise]);
  const results = [...automaticResults, ...directResults];
  onProgress({ progress:84, phase:'Matching and deduplicating full-pool results', completedSources, totalSources });
  const saved = await agentJobs();
  const live = filter(results.flatMap(x => x.jobs), query, location, includeRemoteAnywhere).map(score);
  jobDb.saveRefresh(live, results, refreshId);
  const jobs = dedupe([...saved, ...live]).sort((a,b) => {
    if (a.origin === 'agent' && b.origin !== 'agent') return -1;
    if (b.origin === 'agent' && a.origin !== 'agent') return 1;
    return b.match-a.match;
  }).slice(0,250);
  const sourceStatus = [
    { source:'Job Search Agent', status:'ok', count:saved.length },
    ...results.map(({source,status,message,jobs,latencyMs,checkedAt}) => ({source,status,message,count:jobs.length,latencyMs,checkedAt}))
  ];
  const data = { refreshedAt:new Date().toISOString(), query, location, profile:{ title:'Infrastructure Engineer / Systems Administrator', workAuthorisation:'Loaded from the private local profile', skills:Object.keys(profile.skills) }, sourceStatus, directSources:await providerDirectory(query, location), agentLeadCount:saved.length, jobs:jobDb.listJobs({ includeInactive:true }).map(assessJob), databaseStats:jobDb.stats() };
  onProgress({ progress:90, phase:'Saving SQLite database', completedSources, totalSources });
  await writeFile(liveDatabasePath, JSON.stringify(data, null, 2), 'utf8');
  onProgress({ progress:94, phase:'Synchronising SQLite to Excel', completedSources, totalSources });
  queueExcelMirror('live-refresh');
  onProgress({ progress:100, phase:'Database and website results ready', completedSources, totalSources });
  return data;
}
async function loadDatabase(params) {
  await safeImportTrackerIfNeeded();
  await migrateDatabaseIfNeeded();
  const saved = await agentJobs();
  if (excelMirrorIsDue()) queueExcelMirror('scheduled-3h');
  if (databaseBackupIsDue()) queueDatabaseBackup('scheduled-3h').catch(() => {});
  let cached = null;
  try { cached = JSON.parse(await readFile(liveDatabasePath, 'utf8')); } catch {}
  // Filters run instantly in the browser, so every canonical SQLite record
  // must reach the client. Truncating this list before location filtering made
  // cities outside the dominant Stuttgart dataset appear almost empty.
  const jobs = jobDb.listJobs({ includeInactive:true }).map(assessJob).sort((a,b) => a.origin === 'agent' && b.origin !== 'agent' ? -1 : b.origin === 'agent' && a.origin !== 'agent' ? 1 : b.match-a.match);
  const savedSearches = jobDb.listSavedSearches();
  let activeSavedSearchId = jobDb.getMetadata('active_saved_search_id')?.value || '';
  if (!savedSearches.some(search => search.id === activeSavedSearchId)) {
    activeSavedSearchId = savedSearches.length === 1 ? savedSearches[0].id : '';
    jobDb.setMetadata('active_saved_search_id', activeSavedSearchId);
  }
  const query = params.get('query') || cached?.query || profile.defaultQuery;
  const location = params.get('location') || cached?.location || 'Germany';
  return { refreshedAt:cached?.refreshedAt || null, query, location, sourceStatus:jobDb.latestProviderRuns().length ? [{source:'Job Search Agent',status:'ok',count:saved.length}, ...jobDb.latestProviderRuns()] : (cached?.sourceStatus || [{source:'Job Search Agent',status:'ok',count:saved.length}]), directSources:await providerDirectory(query, location), agentLeadCount:saved.length, jobs, databaseStats:jobDb.stats(), savedSearches, activeSavedSearchId, excelSync:excelSyncInfo() };
}
function refreshStatus(job) {
  const elapsedSeconds = Math.max(0, Math.round((Date.now() - job.startedAt) / 1000));
  const remainingSeconds = job.status === 'running' && job.progress > 3 ? Math.max(0, Math.round(elapsedSeconds * (100 - job.progress) / job.progress)) : null;
  return { ...job, elapsedSeconds, remainingSeconds };
}
function startRefresh(query, location, includeRemoteAnywhere=false) {
  const resolvedQuery = query || profile.defaultQuery;
  const resolvedLocation = location || 'Germany';
  const existing = [...refreshJobs.values()].find(job =>
    job.status === 'running' &&
    job.query === resolvedQuery &&
    job.location === resolvedLocation &&
    job.includeRemoteAnywhere === Boolean(includeRemoteAnywhere)
  );
  if (existing) return refreshStatus(existing);
  const id = randomUUID();
  const job = { id, status:'running', progress:1, phase:'Starting live refresh', completedSources:0, totalSources:0, startedAt:Date.now(), result:null, error:null, query:resolvedQuery, location:resolvedLocation, includeRemoteAnywhere:Boolean(includeRemoteAnywhere) };
  refreshJobs.set(id, job);
  const params = new URLSearchParams({ query:resolvedQuery, location:resolvedLocation, includeRemoteAnywhere:String(Boolean(includeRemoteAnywhere)) });
  search(params, update => Object.assign(job, update), id).then(result => {
    Object.assign(job, { status:'completed', progress:100, phase:'Database and website results ready', result, finishedAt:Date.now() });
  }).catch(error => {
    Object.assign(job, { status:'failed', phase:'Refresh failed', error:error.message, finishedAt:Date.now() });
  });
  return refreshStatus(job);
}
function jsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 100000) reject(new Error('Request too large'));
    });
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}
async function persistCareerState(state) {
  const temporaryStatePath = `${statePath}.writing-${process.pid}-${Date.now()}`;
  await writeFile(temporaryStatePath, JSON.stringify(state, null, 2), 'utf8');
  try {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try { await rename(temporaryStatePath, statePath); return; }
      catch (error) {
        if (attempt === 2) break;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    }
    await writeFile(statePath, JSON.stringify(state, null, 2), 'utf8');
  } finally { try { await rm(temporaryStatePath, { force:true }); } catch {} }
}
async function updateApplicationStatus(id, applicationStatus) {
  const allowed = ['Not recorded','Stashed','Preparing','Applied','Interviewing','Offer','Rejected','Withdrawn','Case Closed'];
  if (!allowed.includes(applicationStatus)) throw new Error('Unsupported application status');
  const state = await getCareerState();
  const lead = (state.leads || []).find(item => item.id === id);
  await migrateDatabaseIfNeeded();
  const lifecycleStatus = ['Applied','Interviewing','Offer'].includes(applicationStatus)
    ? 'applied' : ['Rejected','Withdrawn','Case Closed'].includes(applicationStatus) ? 'archived' : 'to_apply';
  const previous = jobDb.listJobs({ includeInactive:true }).find(job => job.id === id);
  if (!previous) throw new Error('Job was not found in SQLite');
  const changedAt = new Date().toISOString();
  const statusActuallyChanged = applicationStatus !== previous.applicationStatus;
  const appliedStage = ['Applied','Interviewing','Offer'].includes(applicationStatus);
  const missingStatusTimestamp = !previous.applicationStatusChangedAt;
  const recordStatusEvent = statusActuallyChanged || missingStatusTimestamp;
  const appliedAt = lead?.applied_at || previous.appliedAt || (appliedStage ? changedAt : null);
  if (!lead) {
    const databaseJob = jobDb.updateApplication(id, { applicationStatus, lifecycleStatus, applicationStatusChangedAt:recordStatusEvent ? changedAt : previous.applicationStatusChangedAt, appliedAt, recordEvent:recordStatusEvent, previousStatusOverride:statusActuallyChanged ? previous.applicationStatus : '', changeSource:'user' });
    queueExcelMirror('application-status');
    return databaseJob;
  }
  const updated = { ...lead, application_status:applicationStatus, application_status_changed_at:recordStatusEvent ? changedAt : (lead.application_status_changed_at || previous.applicationStatusChangedAt || null), applied_at:appliedAt, status:lifecycleStatus, updated_at:changedAt };
  const nextState = { ...state, leads:(state.leads || []).map(item => item.id === id ? updated : item) };
  if (!lead.tracker_file || !lead.tracker_sheet || !lead.tracker_row) throw new Error('This lead is not linked to an Excel tracker row');
  const trackerPath = join(workspace, lead.tracker_file);
  if (!trackerPath.startsWith(workspace) || !existsSync(trackerPath)) throw new Error('The linked Excel tracker is unavailable');
  let databaseJob = jobDb.updateApplication(id, { applicationStatus, lifecycleStatus, applicationStatusChangedAt:updated.application_status_changed_at, appliedAt, recordEvent:recordStatusEvent, previousStatusOverride:statusActuallyChanged ? previous.applicationStatus : '', changeSource:'user' });
  queueExcelMirror('application-status');
  try { await persistCareerState(nextState); }
  catch (error) { jobDb.setMetadata('last_state_sync_error', JSON.stringify({ operation:'application-status', id, message:error.message, at:new Date().toISOString() })); }
  const trackerStat = await stat(trackerPath);
  importedTracker = { path:trackerPath, modified:trackerStat.mtimeMs };
  await writeFile(trackerImportStatusPath, JSON.stringify({
    tracker_path:trackerPath,
    tracker_file:lead.tracker_file,
    modified:trackerStat.mtimeMs,
    imported:(state.leads || []).length,
    skipped:0,
    imported_at:new Date().toISOString(),
    last_web_status_update:{ lead_id:id, sheet:lead.tracker_sheet, row:lead.tracker_row, application_status:applicationStatus, updated_at:new Date().toISOString() }
  }, null, 2), 'utf8');
  return databaseJob;
}
async function updateApplicationComment(id, applicationComment) {
  if (typeof applicationComment !== 'string') throw new Error('Application comment must be text');
  const comment = applicationComment.replace(/\r\n?/g, '\n').normalize('NFC').trim();
  if (comment.length > 2000) throw new Error('Application comment is limited to 2,000 characters');
  const state = await getCareerState();
  const lead = (state.leads || []).find(item => item.id === id);
  await migrateDatabaseIfNeeded();
  const previous = jobDb.listJobs({ includeInactive:true }).find(job => job.id === id);
  if (!previous) throw new Error('Job was not found in SQLite');
  if (!lead) {
    const databaseJob = jobDb.updateApplication(id, { applicationComment:comment });
    queueExcelMirror('application-comment');
    return databaseJob;
  }
  if (!lead.tracker_file || !lead.tracker_sheet || !lead.tracker_row) throw new Error('This lead is not linked to an Excel tracker row');
  const trackerPath = join(workspace, lead.tracker_file);
  if (!trackerPath.startsWith(workspace) || !existsSync(trackerPath)) throw new Error('The linked Excel tracker is unavailable');
  const updated = { ...lead, application_comment:comment, updated_at:new Date().toISOString() };
  let databaseJob = jobDb.updateApplication(id, { applicationComment:comment });
  const latestState = await getCareerState();
  const nextState = {
    ...latestState,
    leads:(latestState.leads || []).map(item => item.id === id ? { ...item, application_comment:comment, updated_at:updated.updated_at } : item)
  };
  queueExcelMirror('application-comment');
  try { await persistCareerState(nextState); }
  catch (error) { jobDb.setMetadata('last_state_sync_error', JSON.stringify({ operation:'application-comment', id, message:error.message, at:new Date().toISOString() })); }
  const trackerStat = await stat(trackerPath);
  importedTracker = { path:trackerPath, modified:trackerStat.mtimeMs };
  await writeFile(trackerImportStatusPath, JSON.stringify({
    tracker_path:trackerPath,
    tracker_file:lead.tracker_file,
    modified:trackerStat.mtimeMs,
    imported:(state.leads || []).length,
    skipped:0,
    imported_at:new Date().toISOString(),
    last_web_comment_update:{ lead_id:id, sheet:lead.tracker_sheet, row:lead.tracker_row, application_comment:comment, updated_at:new Date().toISOString() }
  }, null, 2), 'utf8');
  return databaseJob;
}
async function applicationJob(id) {
  await migrateDatabaseIfNeeded();
  const job = jobDb.listJobs({ includeInactive:true }).find(item => item.id === id);
  if (!job) throw new Error('Job was not found in SQLite');
  return job;
}
async function storeRetrievedJobDescription(job, posting, reason='job-description') {
  if (!posting?.complete || !posting.text) {
    const error = new Error('The complete JD could not be verified. Use Prepare application to paste the full description.');
    error.code = 'NEEDS_JOB_DESCRIPTION';
    error.details = posting || null;
    throw error;
  }
  const retrievedAt = posting.retrievedAt || new Date().toISOString();
  const changes = {
    description:posting.text,
    jdSnapshot:posting.text,
    jdFetched:true,
    jdSource:posting.source,
    jdRetrievedAt:retrievedAt,
    lastVerifiedAt:retrievedAt
  };
  jobDb.updateApplication(job.id, changes);
  if (job.origin === 'agent') {
    const state = await getCareerState();
    const leads = (state.leads || []).map(lead => lead.id === job.id ? {
      ...lead,
      full_description:posting.text,
      description:posting.text,
      jd_snapshot:posting.text,
      jd_source:posting.source,
      jd_retrieved_at:retrievedAt,
      last_verified_at:retrievedAt,
      updated_at:retrievedAt
    } : lead);
    await persistCareerState({ ...state, leads });
  }
  queueExcelMirror(reason);
  return assessJob(await applicationJob(job.id));
}
const types = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json; charset=utf-8','.svg':'image/svg+xml' };
const versionProtectedWrites = new Set(['/api/application-status','/api/application-comment','/api/application-package','/api/job-description','/api/saved-searches','/api/saved-searches/active','/api/email-reconciliation-request','/api/fast-apply/preview','/api/fast-apply/send']);
function requireCurrentClientVersion(req, url) {
  if (!versionProtectedWrites.has(url.pathname) || !['POST','PUT','PATCH','DELETE'].includes(req.method || '')) return;
  if (req.headers['x-app-version'] === appVersion) return;
  const error = new Error('This dashboard was updated. Reloading before saving protects your latest application data.');
  error.code = 'STALE_CLIENT';
  throw error;
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    requireCurrentClientVersion(req, url);
    if (url.pathname === '/api/app-version') {
      res.writeHead(200, {'content-type':'application/json','cache-control':'no-store'});
      return res.end(JSON.stringify({ version:appVersion }));
    }
    if (url.pathname === '/api/email-reconciliation-request' && req.method === 'GET') {
      let request = null;
      try { request = JSON.parse(await readFile(emailReconciliationRequestPath, 'utf8')); } catch {}
      const checkpoint = jobDb.getMetadata('last_email_reconciliation');
      res.writeHead(200, {'content-type':'application/json','cache-control':'no-store'});
      return res.end(JSON.stringify({ request, checkpoint }));
    }
    if (url.pathname === '/api/email-reconciliation-request' && req.method === 'POST') {
      const input = await jsonBody(req);
      const requestedAt = new Date().toISOString();
      const days = Math.min(7, Math.max(1, Number(input.days) || 7));
      const prompt = 'Review job-application emails in the connected account configured by the local operator from the last ' + days + ' days, including forwarded and attached messages. Read each exact message and reconcile only explicit application confirmations, interviews or changes, rejections, offers, withdrawals, cancellations, or case closures into SQLite, local career state, and the spreadsheet mirror. Preserve original email timestamps. For every reviewed message, identify useful job-board, recruiter, or employer-career domains; verify the official job-search or careers URL; deduplicate it by canonical domain against the active source registry; add only beneficial reachable sources to the local discovered-source file; and ignore login, tracking, unsubscribe, email-delivery, generic shared ATS, duplicate, and unavailable domains. Never send email and never apply.';
      const request = { id:randomUUID(), status:'pending-codex', requestedAt, days, requestedBy:'dashboard', prompt, note:'Gmail access is intentionally delegated to the connected Codex Gmail connector; the local dashboard never stores Gmail credentials.' };
      await writeFile(emailReconciliationRequestPath, JSON.stringify(request, null, 2), 'utf8');
      jobDb.setMetadata('pending_email_reconciliation', JSON.stringify(request));
      res.writeHead(202, {'content-type':'application/json','cache-control':'no-store'});
      return res.end(JSON.stringify({ ok:true, request }));
    }
    if (url.pathname === '/api/health') {
      const body = JSON.stringify({ ok:true, service:'Alex Job', sqlite:basename(sqlitePath), databaseStats:jobDb.stats(), excelSync:excelSyncInfo(), time:new Date().toISOString() });
      res.writeHead(200, {'content-type':'application/json','cache-control':'no-store'});
      return res.end(body);
    }
    if (url.pathname === '/api/jobs') { const body = JSON.stringify(await loadDatabase(url.searchParams)); res.writeHead(200, {'content-type':'application/json','cache-control':'no-store'}); return res.end(body); }
    if (url.pathname === '/api/refresh' && req.method === 'POST') {
      const input = await jsonBody(req);
      const body = JSON.stringify(startRefresh(input.query, input.location, input.includeRemoteAnywhere));
      res.writeHead(202, {'content-type':'application/json','cache-control':'no-store'});
      return res.end(body);
    }
    if (url.pathname === '/api/refresh' && req.method === 'GET') {
      const job = refreshJobs.get(url.searchParams.get('id'));
      if (!job) throw new Error('Refresh job not found');
      const body = JSON.stringify(refreshStatus(job));
      res.writeHead(200, {'content-type':'application/json','cache-control':'no-store'});
      return res.end(body);
    }
    if (url.pathname === '/api/application-status' && req.method === 'POST') {
      const input = await jsonBody(req);
      const job = await updateApplicationStatus(input.id, input.applicationStatus);
      res.writeHead(200, {'content-type':'application/json','cache-control':'no-store'});
      return res.end(JSON.stringify({ ok:true, job }));
    }
    if (url.pathname === '/api/application-comment' && req.method === 'POST') {
      const input = await jsonBody(req);
      const job = await updateApplicationComment(input.id, input.applicationComment);
      res.writeHead(200, {'content-type':'application/json','cache-control':'no-store'});
      return res.end(JSON.stringify({ ok:true, job }));
    }
    if (url.pathname === '/api/job-description' && req.method === 'POST') {
      const input = await jsonBody(req);
      const job = await applicationJob(input.id);
      const posting = await coverLetters.inspectPosting(job);
      const updatedJob = await storeRetrievedJobDescription(job, posting, 'job-description-refresh');
      res.writeHead(200, {'content-type':'application/json','cache-control':'no-store'});
      return res.end(JSON.stringify({ ok:true, job:updatedJob, posting:{ source:posting.source, retrievedAt:posting.retrievedAt, characterCount:posting.text.length } }));
    }    if (url.pathname === '/api/application-package' && req.method === 'GET') {
      const job = await applicationJob(url.searchParams.get('id'));
      const applicationPackage = await coverLetters.readPackage(job);
      res.writeHead(200, {'content-type':'application/json','cache-control':'no-store'});
      return res.end(JSON.stringify({ ok:true, applicationPackage }));
    }
    if (url.pathname === '/api/application-package' && req.method === 'POST') {
      const input = await jsonBody(req);
      const job = await applicationJob(input.id);
      const action = input.action || 'prepare';
      const suppliedPostingUrl = String(input.postingUrl || '').trim();
      const preparationJob = ['save','restore'].includes(action) || !suppliedPostingUrl ? job : { ...job, url:suppliedPostingUrl };
      const applicationPackage = action === 'save'
        ? await coverLetters.save(job, input.body, input.language, input.documentType)
        : action === 'restore'
          ? await coverLetters.restore(job, input.versionNumber)
          : await coverLetters.prepare(preparationJob, input.jobDescription || '', { scope:input.scope || 'full' });
      if (!['save','restore'].includes(action) && applicationPackage.job.exactPostingUrl && applicationPackage.job.exactPostingUrl !== job.url) jobDb.updateApplication(job.id, { url:applicationPackage.job.exactPostingUrl });
      if (!['save','restore'].includes(action) && applicationPackage.posting?.text) await storeRetrievedJobDescription(preparationJob, { ...applicationPackage.posting, complete:true }, 'application-package-jd');
      jobDb.upsertApplicationPackage(job.id, applicationPackage);
      let updatedJob = await applicationJob(job.id);
      if (!['save','restore'].includes(action) && ['Not recorded','Stashed'].includes(job.applicationStatus)) updatedJob = await updateApplicationStatus(job.id, 'Preparing');
      res.writeHead(200, {'content-type':'application/json','cache-control':'no-store'});
      return res.end(JSON.stringify({ ok:true, applicationPackage, job:updatedJob }));
    }
    if (url.pathname === '/api/application-package/download' && req.method === 'GET') {
      const job = await applicationJob(url.searchParams.get('id'));
      const download = await coverLetters.download(job, url.searchParams.get('language'), url.searchParams.get('format'), url.searchParams.get('type'), url.searchParams.get('version'));
      const file = await readFile(download.path);
      res.writeHead(200, {
        'content-type':download.contentType,
        'content-disposition':`attachment; filename="${download.fileName.replace(/["\r\n]/g, '')}"`,
        'content-length':file.length,
        'cache-control':'no-store'
      });
      return res.end(file);
    }
    if (url.pathname === '/api/saved-searches' && req.method === 'GET') {
      res.writeHead(200, {'content-type':'application/json','cache-control':'no-store'});
      return res.end(JSON.stringify({ searches:jobDb.listSavedSearches(), activeSavedSearchId:jobDb.getMetadata('active_saved_search_id')?.value || '' }));
    }
    if (url.pathname === '/api/saved-searches' && req.method === 'POST') {
      const input = await jsonBody(req);
      if (!String(input.name || '').trim()) throw new Error('Saved search name is required');
      const search = jobDb.saveSearch(input);
      jobDb.setMetadata('active_saved_search_id', search.id);
      res.writeHead(200, {'content-type':'application/json','cache-control':'no-store'});
      return res.end(JSON.stringify({ ok:true, search, searches:jobDb.listSavedSearches(), activeSavedSearchId:search.id }));
    }
    if (url.pathname === '/api/saved-searches/active' && req.method === 'POST') {
      const input = await jsonBody(req);
      const id = String(input.id || '');
      if (id && !jobDb.listSavedSearches().some(search => search.id === id)) throw new Error('Saved search was not found');
      jobDb.setMetadata('active_saved_search_id', id);
      res.writeHead(200, {'content-type':'application/json','cache-control':'no-store'});
      return res.end(JSON.stringify({ ok:true, activeSavedSearchId:id }));
    }
    if (url.pathname === '/api/saved-searches' && req.method === 'DELETE') {
      const id = url.searchParams.get('id');
      const removed = jobDb.deleteSearch(id);
      if (jobDb.getMetadata('active_saved_search_id')?.value === id) jobDb.setMetadata('active_saved_search_id', '');
      res.writeHead(200, {'content-type':'application/json','cache-control':'no-store'});
      return res.end(JSON.stringify({ ok:true, removed, searches:jobDb.listSavedSearches(), activeSavedSearchId:jobDb.getMetadata('active_saved_search_id')?.value || '' }));
    }
    if (url.pathname === '/api/gmail/status' && req.method === 'GET') {
      res.writeHead(200, {'content-type':'application/json','cache-control':'no-store'});
      return res.end(JSON.stringify(await fastApply.status()));
    }
    if (url.pathname === '/api/gmail/oauth/start' && req.method === 'POST') {
      res.writeHead(200, {'content-type':'application/json','cache-control':'no-store'});
      return res.end(JSON.stringify({ authorizationUrl:await fastApply.authorizationUrl() }));
    }
    if (url.pathname === '/api/gmail/oauth/callback' && req.method === 'GET') {
      await fastApply.callback(url.searchParams.get('code'),url.searchParams.get('state'));
      res.writeHead(200, {'content-type':'text/html; charset=utf-8','cache-control':'no-store'});
      return res.end('<!doctype html><meta name="viewport" content="width=device-width"><title>Gmail connected</title><p>Gmail is connected. You can close this window.</p><script>window.opener?.postMessage({type:"alex-job-gmail-connected"},location.origin);window.close();</script>');
    }
    if (url.pathname === '/api/fast-apply/preview' && req.method === 'POST') {
      const input=await jsonBody(req), job=await applicationJob(input.id);
      let applicationPackage=await coverLetters.readPackage(job);
      if (!applicationPackage?.quality?.applicationReady) {
        applicationPackage=await coverLetters.prepare(job,input.jobDescription||'',{scope:'full'});
        jobDb.upsertApplicationPackage(job.id,applicationPackage);
        if (applicationPackage.job.exactPostingUrl && applicationPackage.job.exactPostingUrl !== job.url) jobDb.updateApplication(job.id,{url:applicationPackage.job.exactPostingUrl});
        if (applicationPackage.posting?.text) await storeRetrievedJobDescription(job,{...applicationPackage.posting,complete:true},'fast-apply-jd');
      }
      const preview=await fastApply.preview(job,applicationPackage,input.language||'',input.recipient||'');
      res.writeHead(200, {'content-type':'application/json','cache-control':'no-store'});
      return res.end(JSON.stringify({ok:true,preview,applicationPackage}));
    }
    if (url.pathname === '/api/fast-apply/send' && req.method === 'POST') {
      const input=await jsonBody(req), job=await applicationJob(input.id), applicationPackage=await coverLetters.readPackage(job);
      if (!applicationPackage?.quality?.applicationReady) throw new Error('Prepare and review the application package before sending');
      const sent=await fastApply.send(job,applicationPackage,input);
      const updatedJob=await updateApplicationStatus(job.id,'Applied');
      jobDb.setMetadata('last_fast_apply_send',JSON.stringify({...sent,jobId:job.id}));
      res.writeHead(200, {'content-type':'application/json','cache-control':'no-store'});
      return res.end(JSON.stringify({ok:true,sent,job:updatedJob}));
    }
    if (url.pathname === '/api/sync-excel' && req.method === 'POST') {
      const result = await syncExcelMirror('manual-sync');
      res.writeHead(200, {'content-type':'application/json','cache-control':'no-store'});
      return res.end(JSON.stringify({ ok:true, ...result, excelSync:excelSyncInfo() }));
    }
    const requestPath = url.pathname === '/' ? '/index.html' : url.pathname;
    const safePath = join(root, requestPath.replace(/^\/+/, ''));
    if (!safePath.startsWith(root)) throw new Error('Invalid path');
    const file = await readFile(safePath);
    const cacheControl = /(?:index\.html|service-worker\.js)$/.test(safePath) ? 'no-cache, must-revalidate' : 'public, max-age=3600';
    res.writeHead(200, {'content-type':types[extname(safePath)] || 'application/octet-stream','cache-control':cacheControl}); res.end(file);
  } catch (error) {
    const status = ['NEEDS_JOB_DESCRIPTION','STALE_CLIENT'].includes(error.code) ? 409 : (url.pathname.startsWith('/api/') ? 500 : 404);
    res.writeHead(status, {'content-type':'application/json','cache-control':'no-store'});
    const pdfDownloadFailed = url.pathname === '/api/application-package/download' && url.searchParams.get('format') === 'pdf';
    res.end(JSON.stringify({
      error:pdfDownloadFailed ? 'The PDF could not be created. Please try again; the Word version remains available.' : error.message,
      code:pdfDownloadFailed ? 'PDF_EXPORT_FAILED' : (error.code || ''),
      details:pdfDownloadFailed ? null : (error.details || null)
    }));
  }
});
server.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Alex Job ready at http://localhost:${port}`));
let sourceRestartRequested = false;
async function restartWhenApplicationCodeChanges() {
  if (sourceRestartRequested) return;
  const names = await readdir(root);
  const codeNames = names.filter(name => /\.(?:mjs|js|html|webmanifest)$/i.test(name) && !/\.test\./i.test(name));
  const timestamps = await Promise.all(codeNames.map(async name => (await stat(join(root,name))).mtimeMs));
  if (Math.max(0,...timestamps) <= serverStartedAt) return;
  sourceRestartRequested = true;
  console.log('Alex Job application code changed; stopping cleanly so the watchdog can load the new version.');
  server.close(() => {
    try { jobDb.db.close(); } catch {}
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 10000).unref();
}
setInterval(() => restartWhenApplicationCodeChanges().catch(error => console.error('Source change check failed:',error.message)),15000).unref();
setInterval(() => {
  if (excelMirrorIsDue()) queueExcelMirror('scheduled-3h');
  if (databaseBackupIsDue()) queueDatabaseBackup('scheduled-3h').catch(() => {});
}, 60 * 60 * 1000).unref();
