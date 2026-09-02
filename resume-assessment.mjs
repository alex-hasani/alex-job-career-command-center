const evidenceRules = [
  { label:'Windows Server and Active Directory', pattern:/windows server|active directory|group policy|\bgpo\b/i, depth:'Production · enterprise', recency:'Current / recent', type:'DIRECT STRONG', confidence:'High', evidence:'Demo profile: verified Windows Server and Active Directory operations.' },
  { label:'Linux administration', pattern:/\blinux\b|rhel|red hat|ubuntu|oracle linux/i, depth:'Production · enterprise', recency:'Current / recent', type:'DIRECT STRONG', confidence:'High', evidence:'Demo profile: verified Windows/Linux infrastructure operations.' },
  { label:'VMware and virtualisation', pattern:/vmware|vsphere|virtuali[sz]/i, depth:'Production', recency:'Recent', type:'DIRECT STRONG', confidence:'High', evidence:'Demo profile: verified VMware vSphere lifecycle, troubleshooting and migration work.' },
  { label:'Azure, Microsoft 365 and Entra', pattern:/\bazure\b|microsoft 365|m365|office 365|entra|azure ad|exchange online|intune/i, depth:'Production exposure and support', recency:'Recent / foundational', type:'DIRECT', confidence:'High', evidence:'Demo profile: verified hybrid Azure, Microsoft 365 and Entra exposure.' },
  { label:'Infrastructure operations and troubleshooting', pattern:/infrastructure|systems? admin|operations|betrieb|incident|troubleshoot|patch|availability|recovery/i, depth:'Production · enterprise', recency:'Current', type:'DIRECT STRONG', confidence:'High', evidence:'Verified enterprise operations, incident resolution, patching, monitoring and service continuity.' },
  { label:'Datacentre and server hardware', pattern:/data ?cent(er|re)|rechenzentrum|server hardware|physical server/i, depth:'Production', recency:'Current', type:'DIRECT STRONG', confidence:'High', evidence:'Demo profile: verified physical and virtual server and datacentre operations.' },
  { label:'Automation and scripting', pattern:/automation|scripting|powershell|\bbash\b|ansible/i, depth:'Relevant exposure; tool depth varies', recency:'Recent', type:'TRANSFERABLE STRONG', confidence:'Medium', evidence:'Verified automation and scripting exposure; depth in each named tool must be confirmed rather than assumed.' },
  { label:'Networking, VPN or firewall', pattern:/network|vpn|firewall|routing|switching/i, depth:'Infrastructure operations / build-out', recency:'Foundational', type:'TRANSFERABLE STRONG', confidence:'Medium', evidence:'Demo profile: infrastructure and network build-out experience; product-specific depth is not assumed.' },
  { label:'Terraform or Kubernetes', pattern:/terraform|kubernetes|\bk8s\b|helm/i, depth:'Training / currently learning', recency:'Current learning', type:'LEARNING', confidence:'High', evidence:'Recorded learning target; no verified production-depth claim.' },
  { label:'Advanced Python or data engineering', pattern:/python|databricks|\bdbt\b|airflow|snowflake|data engineer|spark/i, depth:'Training / currently learning', recency:'Current learning', type:'LEARNING', confidence:'High', evidence:'Recorded learning target; no verified advanced production-depth claim.' },
  { label:'AWS or GCP', pattern:/\baws\b|amazon web services|\bgcp\b|google cloud/i, depth:'Conceptually transferable', recency:'Unknown', type:'PARTIAL', confidence:'Medium', evidence:'Cloud concepts may transfer from Azure, but hands-on production depth is not verified.' },
  { label:'Advanced CI/CD or observability', pattern:/ci\/cd|jenkins|gitlab ci|github actions|prometheus|grafana|observability/i, depth:'Training / needs confirmation', recency:'Unknown', type:'LEARNING', confidence:'Medium', evidence:'Recorded learning area; exact production tool experience is not verified.' },
  { label:'SAP, Citrix or specialist platforms', pattern:/\bsap\b|citrix|netscaler/i, depth:'Not verified', recency:'Unknown', type:'GAP', confidence:'High', evidence:'No verified specialist production depth in the approved evidence.' }
];

const uniq = values => [...new Set(values.filter(Boolean).map(value => String(value).trim()).filter(Boolean))];
const clamp = value => Math.max(0, Math.min(100, Math.round(value)));
const daysOld = value => value && Number.isFinite(new Date(value).getTime()) ? Math.max(0, (Date.now() - new Date(value).getTime()) / 86400000) : null;

function importance(rule, text) {
  const token = rule.label.split(/\s+/)[0];
  const must = new RegExp(`(?:must|required|mandatory|zwingend|voraussetzung|erforderlich).{0,80}${token}|${token}.{0,80}(?:must|required|mandatory|zwingend|voraussetzung|erforderlich)`, 'i');
  const nice = new RegExp(`(?:nice.to.have|preferred|wünschenswert|von vorteil).{0,80}${token}|${token}.{0,80}(?:nice.to.have|preferred|wünschenswert|von vorteil)`, 'i');
  return must.test(text) ? 'Must' : nice.test(text) ? 'Nice-to-have' : 'Should';
}
function matrixRisk(type, level) {
  if (level === 'Must' && type === 'GAP') return 'LIKELY BLOCKER';
  if (level === 'Must' && ['LEARNING','PARTIAL'].includes(type)) return 'SIGNIFICANT RISK';
  if (type === 'GAP') return 'SIGNIFICANT RISK';
  if (['LEARNING','PARTIAL'].includes(type)) return 'MINOR RISK';
  return 'NO ISSUE';
}
function blockerAssessment(job, text) {
  const rows = [];
  const add = (factor, severity, evidence) => rows.push({ factor, severity, evidence });
  if (/(?:german|deutsch).{0,45}(?:c1|c2|native|muttersprach|verhandlungssicher)|(?:c1|c2).{0,25}(?:german|deutsch)/i.test(text)) add('German language','HARD BLOCKER','The vacancy appears to require C1/C2, native or negotiation-level German; compare it with the verified local profile.');
  else if (/(?:german|deutsch).{0,35}\bb2\b|\bb2\b.{0,25}(?:german|deutsch)/i.test(text)) add('German language','SIGNIFICANT RISK','The vacancy appears to request B2 German; confirm the verified local level, flexibility and team language.');
  else add('German language','NO ISSUE','No mandatory German level above the verified profile was detected in the available JD.');
  if (/security clearance|sicherheitsüberprüfung|ü\s*2|ü\s*3|top secret|nato secret/i.test(text)) add('Security clearance','LIKELY BLOCKER','A clearance requirement was detected and eligibility is not verified.');
  if (/night shift|nachtschicht|rotating shift|schichtarbeit|24\s*[x/]\s*7/i.test(text)) add('Shift work','SIGNIFICANT RISK','Shift or 24/7 work appears in the available JD.');
  if (/rufbereitschaft|on[- ]call|bereitschaftsdienst/i.test(text)) add('On-call','MINOR RISK','On-call duty appears in the JD; confirm frequency and compensation.');
  if (/relocation required|umzugsbereitschaft erforderlich/i.test(text)) add('Relocation','LIKELY BLOCKER','Mandatory relocation appears in the JD.');
  if (job.workType === 'Contract' || /befristet|fixed[- ]term/i.test(text)) add('Contract stability','SIGNIFICANT RISK','A contract or fixed-term arrangement was detected.');
  return rows;
}
function freshness(job) {
  const age = daysOld(job.posted || job.foundAt);
  if (age === null) return { days:null, band:'Date not verified', score:4 };
  if (age <= 3) return { days:Math.floor(age), band:'0–3 days · very high priority', score:10 };
  if (age <= 7) return { days:Math.floor(age), band:'4–7 days · high priority', score:8 };
  if (age <= 14) return { days:Math.floor(age), band:'8–14 days · normal priority', score:5 };
  if (age <= 30) return { days:Math.floor(age), band:'15–30 days · verify active', score:1 };
  return { days:Math.floor(age), band:'30+ days · low unless confirmed active', score:-5 };
}
function sourceQuality(job) {
  const value = `${job.source || ''} ${job.url || ''}`.toLowerCase();
  if (/careers|karriere|workdayjobs|schwarz|stackit/.test(value)) return { tier:1, label:'Employer or original career page' };
  if (/hays|robert half|michael page|ratbacher|grinnberg|ferchau|vesterling|recruit/.test(value)) return { tier:2, label:'Recruiter / represented vacancy' };
  if (/linkedin|stepstone|indeed|xing|glassdoor|jobware|stellenanzeigen|get-in-it|it-jobs/.test(value)) return { tier:3, label:'Major job platform' };
  return { tier:4, label:'Aggregator or source not verified' };
}
function practicalStep(rule) {
  if (/Terraform|Kubernetes/.test(rule.label)) return 'Build a small infrastructure-as-code and container lab with validation, health checks and rollback notes.';
  if (/Python|data engineering/.test(rule.label)) return 'Build a small Python pipeline with validation, failure logging and tests.';
  if (/AWS|GCP/.test(rule.label)) return 'Map requested services to familiar Azure equivalents, then deploy one small workload with identity, networking and monitoring.';
  if (/CI\/CD|observability/.test(rule.label)) return 'Create a versioned pipeline with test and rollback stages, useful logs, metrics and one actionable alert.';
  if (/Automation/.test(rule.label)) return 'Automate one realistic administration task with validation, logging, error handling and a concise README.';
  if (/Networking/.test(rule.label)) return 'Build and troubleshoot a small DNS, VPN and firewall lab, recording three introduced faults.';
  return `Complete one bounded hands-on exercise for ${rule.label} and document the result and its limits.`;
}
function readinessPlan(targets, detailed) {
  const selected = targets.length ? targets.slice(0,3) : [{ label:detailed ? 'Role-specific interview evidence' : 'Full-JD verification' }];
  const a=selected[0], b=selected[1]||a, c=selected[2]||b;
  const rows = [
    {day:1,focus:'Requirement-evidence map',action:'Confirm the five most important duties and mark each direct, transferable, learning, gap or blocker.',deliverable:'One-page evidence matrix',timebox:'60 min'},
    {day:2,focus:'Defensible examples',action:'Write two concise STAR examples with tools, scale, exact contribution and result.',deliverable:'Two interview-ready stories',timebox:'60 min'},
    {day:3,focus:a.label,action:practicalStep(a),deliverable:`Focused notes and lab plan: ${a.label}`,timebox:'75–90 min'},
    {day:4,focus:`${a.label} lab`,action:'Implement the smallest useful scenario and record decisions, errors and corrections.',deliverable:'Working lab checkpoint',timebox:'90 min'},
    {day:5,focus:'Operational depth',action:'Add validation, security, monitoring or rollback; break one part and document diagnosis.',deliverable:'Troubleshooting runbook',timebox:'75–90 min'},
    {day:6,focus:'Employer and stack',action:'Research the employer and named tools; prepare five questions without assuming facts absent from the posting.',deliverable:'Employer brief and questions',timebox:'45–60 min'},
    {day:7,focus:'Mock interview',action:'Rehearse the role summary, evidence stories and lab walkthrough; identify unresolved requirements.',deliverable:'Readiness scorecard',timebox:'60 min'}
  ];
  if (targets.length >= 2) rows.push(
    {day:8,focus:b.label,action:practicalStep(b),deliverable:`Second focused exercise: ${b.label}`,timebox:'75–90 min'},
    {day:9,focus:`${b.label} proof`,action:'Document what can now be demonstrated and what remains theoretical.',deliverable:'Evidence note with honest boundaries',timebox:'75 min'},
    {day:10,focus:c.label,action:practicalStep(c),deliverable:`Targeted practice: ${c.label}`,timebox:'60–90 min'},
    {day:11,focus:'Technical scenarios',action:'Answer five scenarios from the JD: incident, change, security, stakeholder and recovery.',deliverable:'Five concise scenario answers',timebox:'60 min'},
    {day:12,focus:'Communication and language',action:'Prepare a 90-second introduction and role vocabulary in the likely interview language.',deliverable:'Introduction and vocabulary',timebox:'45–60 min'},
    {day:13,focus:'Application alignment',action:'Fact-check CV and message against the JD and evidence ledger; remove unsupported claims.',deliverable:'Pre-submission audit',timebox:'60 min'},
    {day:14,focus:'Final mock and decision',action:'Run a timed mock and identify three hiring reasons plus two gaps to disclose accurately.',deliverable:'Final interview brief',timebox:'60–75 min'}
  );
  return rows;
}

export function assessAgainstResume(job) {
  const jd = [job.title,job.description,job.jdSnapshot].filter(Boolean).join('\n');
  const detected = evidenceRules.filter(rule => rule.pattern.test(jd));
  const matrix = detected.map(rule => {
    const level=importance(rule,jd);
    return {requirement:rule.label,importance:level,candidateEvidence:rule.evidence,evidenceRecency:rule.recency,evidenceDepth:rule.depth,matchType:rule.type,confidence:rule.confidence,risk:matrixRisk(rule.type,level),assessment:rule.type,evidence:rule.evidence};
  });
  const blockers=blockerAssessment(job,jd);
  const hard=blockers.some(x=>x.severity==='HARD BLOCKER');
  const likely=blockers.filter(x=>['HARD BLOCKER','LIKELY BLOCKER'].includes(x.severity)).length+matrix.filter(x=>x.risk==='LIKELY BLOCKER').length;
  const strong=matrix.filter(x=>['DIRECT STRONG','DIRECT'].includes(x.matchType));
  const transferable=matrix.filter(x=>x.matchType==='TRANSFERABLE STRONG');
  const gaps=matrix.filter(x=>['PARTIAL','LEARNING','GAP'].includes(x.matchType));
  const detailed=String(job.description||job.jdSnapshot||'').length>=900;
  const coverage=matrix.length?(strong.length+transferable.length*.72+gaps.filter(x=>x.matchType==='PARTIAL').length*.42+gaps.filter(x=>x.matchType==='LEARNING').length*.2)/matrix.length:.25;
  const base=Number(job.discoveryScore ?? job.match)||50;
  const interviewFitScore=clamp(base*.28+coverage*62+(detailed?5:0)-likely*15-(hard?30:0));
  const fresh=freshness(job), source=sourceQuality(job);
  const remoteValue=job.remote?8:/stuttgart|waiblingen|ludwigsburg|esslingen|fellbach/i.test(job.location||'')?7:3;
  const careerValue=strong.some(x=>/Azure|Infrastructure|Automation|VMware|Linux|Windows/i.test(x.requirement))?17:10;
  const opportunityQualityScore=clamp(35+fresh.score+remoteValue+careerValue+(job.workType==='Contract'?5:12)+(job.salaryMin||job.salaryMax?10:5)+(5-source.tier)*2-blockers.filter(x=>x.severity==='SIGNIFICANT RISK').length*5);
  const applicationPriorityScore=clamp(interviewFitScore*.58+opportunityQualityScore*.42-(hard?30:0)-likely*6);
  let recommendation=applicationPriorityScore>=82&&interviewFitScore>=78&&detailed&&!likely?'PRIORITY APPLY':applicationPriorityScore>=70&&interviewFitScore>=65&&detailed&&!hard?'APPLY':applicationPriorityScore>=55&&interviewFitScore>=48&&!hard?'STRATEGIC STRETCH':applicationPriorityScore>=38&&!hard?'LOW PRIORITY':'SKIP';
  if(!detailed && ['PRIORITY APPLY','APPLY'].includes(recommendation)) recommendation='STRATEGIC STRETCH';
  if(hard) recommendation='SKIP';
  const resumeStrengths=uniq([...(Array.isArray(job.evidence)?job.evidence:[]),...strong.map(x=>`${x.requirement}: ${x.candidateEvidence}`),...transferable.map(x=>`${x.requirement}: ${x.candidateEvidence}`)]);
  const fitGaps=uniq([...(Array.isArray(job.fitGaps)?job.fitGaps:[]),...gaps.map(x=>`${x.requirement}: ${x.candidateEvidence}`),...blockers.filter(x=>x.severity!=='NO ISSUE').map(x=>`${x.factor}: ${x.evidence}`)]);
  const plan=readinessPlan(detected.filter(x=>['PARTIAL','LEARNING','GAP','TRANSFERABLE STRONG'].includes(x.type)),detailed);
  const salaryAssessment=job.salaryMin||job.salaryMax?{basis:job.salaryBasis||'Published / source supplied',range:job.salaryText||[job.salaryMin,job.salaryMax].filter(Boolean).map(v=>`€${Number(v).toLocaleString('en-US')}`).join('–'),confidence:'Source supplied'}:{basis:'Not published',range:'Not confirmed',confidence:'Unknown'};
  return {...job,match:interviewFitScore,interviewFitScore,opportunityQualityScore,applicationPriorityScore,recommendation,decision:recommendation,requirementEvidenceMatrix:matrix,resumeComparison:matrix,blockerAssessment:blockers,resumeStrengths,fitGaps,whyItFits:resumeStrengths.slice(0,5),mainRisks:fitGaps.slice(0,5),missingLearnableSkills:gaps.filter(x=>['PARTIAL','LEARNING'].includes(x.matchType)).map(x=>x.requirement).slice(0,5),freshness:fresh,sourceQuality:source,salaryAssessment,languageRisk:blockers.find(x=>x.factor==='German language'),commuteRemoteAssessment:job.remote?'Remote or hybrid wording detected; verify permitted work location and office frequency.':'On-site or remote policy not confirmed; assess actual route and required office days.',careerValueAssessment:careerValue>=17?'Builds long-term value across infrastructure, cloud, automation or complex operations.':'Career value needs confirmation from the full responsibilities and technical ownership.',jobSecurityAssessment:job.workType==='Contract'?'Contract/fixed-term risk detected; verify term and conversion prospects.':'No contract warning detected; employer stability still needs current evidence for high-priority roles.',documentGenerationGate:['PRIORITY APPLY','APPLY'].includes(recommendation)?'GENERATE':recommendation==='STRATEGIC STRETCH'?'CONFIRM FIRST':'DO NOT GENERATE',coverLetterRecommended:['PRIORITY APPLY','APPLY'].includes(recommendation)&&(gaps.length>0||/public|government|behörde|stadt|landes/i.test(`${job.source} ${job.company}`)),readinessPlan:plan,learningPlan:plan.map(x=>`Day ${x.day}: ${x.focus} — ${x.action}`),resumeVerdict:`${strong.length} direct evidenced area(s), ${transferable.length} strong transferable area(s), and ${fitGaps.length} risk or gap item(s) identified from the available text.`,cvAngle:job.cvAngle||(strong.length?'Keep the verified infrastructure identity consistent; lead with relevant recent production evidence and label adjacent skills as transferable or learning.':'Verify the full JD before tailoring; do not add vacancy keywords without candidate evidence.'),assessmentConfidence:detailed?'High enough for detailed assessment':'Provisional — full JD not stored',assessmentSchemaVersion:5};
}
