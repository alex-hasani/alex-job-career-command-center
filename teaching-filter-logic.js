import { matchesBooleanText, matchesLocation, matchesLanguage, matchesWorkType, matchesSource, matchesExperience } from './filter-logic.js';

export const teachingFilterIds = [
  'query','location','company','sourceSelect','language','stream','applicationStatus',
  'workType','experience','salary','freshness','model','match','recommendation',
  'opportunity','salaryOnly','applyOnly','includeRemoteAnywhere','careerChangeOnly',
  'search','sort'
];
export const teachingCheckboxIds = new Set(['salaryOnly','applyOnly','includeRemoteAnywhere','careerChangeOnly']);
export const teachingStatuses = ['Preparing','Stashed','Not recorded','Interviewing','Offer','Withdrawn','Applied','Rejected','Case Closed','Silent'];
const rank = Object.fromEntries(teachingStatuses.map((status,index)=>[status,index]));
const text = value => String(value || '').toLowerCase();

export function filterTeachingJobs(jobs, criteria, cityOptions=[], now=Date.now()) {
  const c=criteria || {};
  const freshness=String(c.freshness || '');
  const salary=Number(c.salary || 0), match=Number(c.match || 0), opportunity=Number(c.opportunity || 0);
  const rows=(jobs || []).filter(job=>{
    const posted=job.posted || job.postedAt || '';
    const age=posted && Number.isFinite(Date.parse(posted)) ? (now-Date.parse(posted))/86400000 : null;
    return matchesBooleanText(job,c.query) &&
      matchesBooleanText(job,c.search) &&
      (c.location==='Germany' || matchesLocation(job,c.location,cityOptions,Boolean(c.includeRemoteAnywhere))) &&
      (!c.company || text(job.company).includes(text(c.company).trim())) &&
      matchesSource(job,c.sourceSelect) &&
      matchesLanguage(job,c.language) &&
      matchesWorkType(job,c.workType) &&
      matchesExperience(job,c.experience) &&
      (!salary || Number(job.salaryMax || 0)>=salary || Number(job.salaryMin || 0)>=salary) &&
      (!freshness || (freshness==='dated' ? Boolean(posted) : age!==null && age>=0 && age<=Number(freshness))) &&
      (!c.model || (c.model==='remote' ? Boolean(job.remote) : !job.remote)) &&
      Number(job.interviewFitScore ?? job.match ?? 0)>=match &&
      (!c.recommendation || job.recommendation===c.recommendation) &&
      Number(job.opportunityQualityScore || 0)>=opportunity &&
      (!c.salaryOnly || Boolean(job.salaryMin || job.salaryMax)) &&
      (!c.applyOnly || Boolean(job.url)) &&
      (!c.careerChangeOnly || job.careerChangePossible===true) &&
      (!c.stream || (c.stream==='agent' ? job.origin==='agent' : c.stream==='live' ? job.origin!=='agent' : text(job.rawLanguage).includes('english'))) &&
      (!c.applicationStatus || (c.applicationStatus==='active'
        ? job.lifecycleStatus!=='archived' && job.active!==false &&
          !['Rejected','Withdrawn','Case Closed','Silent'].includes(job.applicationStatus) &&
          !/closed|expired|unavailable|removed|filled|besetzt|abgelaufen/i.test(job.openStatus || '')
        : job.applicationStatus===c.applicationStatus));
  });
  const sort=String(c.sort || 'priority');
  rows.sort((a,b)=>(rank[a.applicationStatus] ?? teachingStatuses.length)-(rank[b.applicationStatus] ?? teachingStatuses.length) ||
    (sort==='salary' ? Number(b.salaryMax || b.salaryMin || 0)-Number(a.salaryMax || a.salaryMin || 0)
    : sort==='newest' ? String(b.posted || b.postedAt || '').localeCompare(String(a.posted || a.postedAt || ''))
    : sort==='company' ? String(a.company || '').localeCompare(String(b.company || ''))
    : sort==='source' ? String(a.source || '').localeCompare(String(b.source || ''))
    : sort==='match' ? Number(b.interviewFitScore ?? b.match ?? 0)-Number(a.interviewFitScore ?? a.match ?? 0)
    : Number(b.applicationPriorityScore || 0)-Number(a.applicationPriorityScore || 0)));
  return rows;
}
