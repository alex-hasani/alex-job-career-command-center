import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';
import { writeFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const trackerPath = process.argv[2];
if (!trackerPath) throw new Error('Tracker path is required');

const dashboardRoot = dirname(fileURLToPath(import.meta.url));
const workspace = dirname(dashboardRoot);
const stateCli = 'C:\\Users\\Alex\\.codex\\plugins\\cache\\openai-curated-remote\\career-command-center\\1.3.0+codex.20260715213050\\scripts\\state_cli.py';
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(trackerPath));

const aliases = {
  priority:['priority'],
  track:['track','role family'],
  title:['position','role','job title','title'],
  company:['company','organisation','organization','employer'],
  status:['application status','apply tracker','status'],
  applicationNotes:['application notes','application comment','application comments','comments','notes'],
  snapshot:['jd snapshot','job description snapshot','short jd','jd summary'],
  url:['url','job url','link','source url','exact url','exact posting url'],
  source:['source','job board','website'],
  location:['location','city','work location'],
  arrangement:['work arrangement','work model','remote/hybrid','work mode'],
  score:['fit score','fit','match','match percentage'],
  shortlist:['shortlist chance','estimated shortlist chance'],
  decision:['decision','recommendation','apply/maybe'],
  salary:['salary','compensation'],
  salaryMin:['salary min eur','minimum salary'],
  salaryMax:['salary max eur','maximum salary'],
  salaryBasis:['salary basis'],
  found:['found at','discovered at','date found'],
  posted:['posted','posted at','publication date'],
  checked:['checked at','last checked','verified at'],
  recruiter:['recruiter contact','recruiter/contact','contact'],
  mainMatch:['main match','match strengths'],
  mainRisk:['main risk','fit gaps'],
  cvAngle:['cv angle'],
  cvBase:['recommended cv base','cv base'],
  addTracker:['add to tracker'],
  jobId:['job id','source job id'],
  openStatus:['open status','vacancy status'],
  language:['language','work language','description language']
};
const normalize = value => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const text = value => String(value ?? '').trim();
const number = value => {
  const parsed = Number(String(value ?? '').replace('%','').replace(',','.').trim());
  if (!Number.isFinite(parsed)) return 0;
  return parsed <= 1 && parsed > 0 ? Math.round(parsed * 100) : parsed <= 10 && parsed > 1 ? Math.round(parsed * 10) : Math.round(parsed);
};
const cell = (row, index) => index >= 0 ? row[index] : '';
function findColumn(headers, names) {
  const wanted = names.map(normalize);
  return headers.findIndex(header => wanted.includes(normalize(header)));
}
function lifecycle(applicationStatus, openStatus = '') {
  applicationStatus = applicationStatus === 'Closed' ? 'Case Closed' : applicationStatus;
  if (['Applied','Interviewing','Offer'].includes(applicationStatus)) return 'applied';
  if (['Rejected','Withdrawn','Case Closed'].includes(applicationStatus)
    || /closed|expired|unavailable|removed|filled|besetzt|abgelaufen|nicht mehr verf.gbar/i.test(openStatus)) return 'archived';
  return 'to_apply';
}
function runStateCli(file) {
  return new Promise((resolve, reject) => {
    const child = spawn('python', [stateCli, '--workspace', workspace, 'upsert', '--lead-file', file], { windowsHide:true });
    let output = '', error = '';
    child.stdout.on('data', chunk => output += chunk);
    child.stderr.on('data', chunk => error += chunk);
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(output) : reject(new Error(error || `Import failed (${code})`)));
  });
}

let imported = 0;
let skipped = 0;
for (const sheet of workbook.worksheets.items) {
  if (!/shortlist|english/i.test(sheet.name)) continue;
  const used = sheet.getUsedRange(true);
  const rows = used?.values || [];
  const headerIndex = rows.slice(0, 20).findIndex(row => {
    const normalized = row.map(normalize);
    return aliases.title.some(name => normalized.includes(normalize(name))) && aliases.company.some(name => normalized.includes(normalize(name)));
  });
  if (headerIndex < 0) continue;
  const headers = rows[headerIndex];
  const col = Object.fromEntries(Object.entries(aliases).map(([key, names]) => [key, findColumn(headers, names)]));
  for (const [offset, row] of rows.slice(headerIndex + 1).entries()) {
    const title = text(cell(row, col.title));
    const organization = text(cell(row, col.company));
    if (!title || !organization) { skipped += 1; continue; }
    const applicationStatusRaw = text(cell(row, col.status)) || 'Stashed';
    const applicationStatus = applicationStatusRaw === 'Closed' ? 'Case Closed' : applicationStatusRaw;
    const applicationNotes = text(cell(row, col.applicationNotes));
    const jobUrl = text(cell(row, col.url));
    const openStatus = text(cell(row, col.openStatus));
    const sourceJobId = text(cell(row, col.jobId)) || jobUrl || `${organization}:${title}`;
    const mainMatch = text(cell(row, col.mainMatch));
    const mainRisk = text(cell(row, col.mainRisk));
    const jdSnapshot = text(cell(row, col.snapshot));
    const cvAngle = text(cell(row, col.cvAngle));
    const lead = {
      id:`tracker__${Buffer.from(sourceJobId).toString('base64url').slice(0, 48)}`,
      source_job_id:sourceJobId,
      title,
      organization,
      job_url:jobUrl,
      source:text(cell(row, col.source)) || 'Job Search Agent tracker',
      priority:Number(cell(row, col.priority)) || 0,
      track:text(cell(row, col.track)),
      location:text(cell(row, col.location)),
      work_arrangement:text(cell(row, col.arrangement)),
      status:lifecycle(applicationStatus, openStatus),
      application_status:applicationStatus,
      application_comment:applicationNotes,
      jd_snapshot:jdSnapshot,
      full_description:[jdSnapshot, mainMatch && `Main match: ${mainMatch}`, mainRisk && `Main risk: ${mainRisk}`, cvAngle && `CV angle: ${cvAngle}`].filter(Boolean).join('\n\n'),
      fit_score:number(cell(row, col.score)),
      shortlist_chance:number(cell(row, col.shortlist)),
      decision:text(cell(row, col.decision)) || 'Maybe',
      salary:text(cell(row, col.salary)),
      salary_min:Number(cell(row, col.salaryMin)) || 0,
      salary_max:Number(cell(row, col.salaryMax)) || 0,
      salary_basis:text(cell(row, col.salaryBasis)),
      found_at:text(cell(row, col.found)),
      posted_at:text(cell(row, col.posted)),
      last_verified_at:text(cell(row, col.checked)),
      recruiter_contact:text(cell(row, col.recruiter)),
      cv_angle:cvAngle,
      recommended_cv_base:text(cell(row, col.cvBase)),
      add_to_tracker:text(cell(row, col.addTracker)),
      open_status:openStatus,
      language_stream:/english/i.test(sheet.name) ? 'English accepted' : text(cell(row, col.language)),
      verified:true,
      tracker_sheet:sheet.name,
      tracker_row:headerIndex + offset + 2,
      tracker_status_column:'C',
      tracker_comment_column:'AB',
      tracker_header_row:headerIndex + 1,
      tracker_file:basename(trackerPath),
      assessment_schema_version:2,
      match_strengths:mainMatch ? [mainMatch] : [],
      fit_gaps:mainRisk ? [mainRisk] : [],
      eligibility_constraints:[],
      application_requirements:[],
      search_notes:[`Imported from ${basename(trackerPath)} / ${sheet.name}`]
    };
    const temp = await mkdtemp(join(tmpdir(), 'tracker-lead-'));
    const leadFile = join(temp, 'lead.json');
    try {
      await writeFile(leadFile, JSON.stringify(lead, null, 2), 'utf8');
      await runStateCli(leadFile);
      imported += 1;
    } finally {
      await rm(temp, { recursive:true, force:true });
    }
  }
}

const trackerStat = await stat(trackerPath);
await writeFile(join(workspace, 'State', 'tracker_import_status.json'), JSON.stringify({
  tracker_path:resolve(trackerPath),
  tracker_file:basename(trackerPath),
  modified:trackerStat.mtimeMs,
  imported,
  skipped,
  imported_at:new Date().toISOString()
}, null, 2), 'utf8');
console.log(JSON.stringify({ tracker:trackerPath, imported, skipped }));
