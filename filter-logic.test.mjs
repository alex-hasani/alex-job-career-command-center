import assert from 'node:assert/strict';
import { matchesBooleanText, matchesLocation, matchesLanguage, matchesWorkType, matchesSource, matchesExperience } from './filter-logic.js';

const cities = ['', 'Stuttgart area', 'Stuttgart', 'Ludwigsburg', 'Esslingen', 'Böblingen', 'Sindelfingen', 'Waiblingen', 'Fellbach', 'Weinstadt', 'Reutlingen', 'Tübingen', 'Karlsruhe', 'Heidelberg', 'Mannheim', 'Frankfurt am Main', 'Munich', 'Berlin', 'Hamburg', 'Cologne', 'Düsseldorf', 'Leipzig', 'Dresden', 'Nuremberg', 'Hannover', 'Bremen', 'Essen', 'Dortmund', 'Bonn', 'Wiesbaden', 'Aachen', 'Ostfildern', 'Ettlingen'].map(city => [city, city]);
const chinaCities = [...cities, ...['China major cities','Shanghai + hybrid','Shanghai only','Beijing','Guangzhou','Shenzhen','Hangzhou','Chengdu','Nanjing','Suzhou','Wuhan',"Xi'an",'Chongqing','Tianjin','Qingdao','Xiamen','Ningbo'].map(city => [city, city])];
assert.equal(matchesLocation({ location:'Berlin', remote:false }, 'Berlin', cities), true);
assert.equal(matchesLocation({ location:'Stuttgart', remote:true }, 'Berlin', cities), false);
assert.equal(matchesLocation({ location:'Remote, Germany', remote:true }, 'Berlin', cities), false);
assert.equal(matchesLocation({ location:'Remote, Germany', remote:true }, 'Berlin', cities, true), true);
assert.equal(matchesLocation({ location:'Munich / hybrid', remote:true }, 'Berlin', cities), false);
assert.equal(matchesLocation({ location:'Bad Friedrichshall', remote:false }, 'Stuttgart area', cities), true);
assert.equal(matchesLocation({ location:'Heilbronn', remote:false }, 'Stuttgart area', cities), true);
assert.equal(matchesLocation({ location:'Karlsruhe', remote:false }, 'Stuttgart area', cities), false);
assert.equal(matchesLocation({ location:'Shanghai', remote:false }, 'Shanghai only', chinaCities), true);
assert.equal(matchesLocation({ location:'Shanghai / hybrid', remote:true }, 'Shanghai only', chinaCities), false);
assert.equal(matchesLocation({ location:'Shanghai / hybrid', remote:true }, 'Shanghai + hybrid', chinaCities), true);
assert.equal(matchesLocation({ location:'Guangzhou', remote:false }, 'China major cities', chinaCities), true);
assert.equal(matchesLocation({ location:'Beijing', remote:false }, 'Beijing', chinaCities), true);
assert.equal(matchesLocation({ location:'Remote, Germany', remote:true }, 'Shanghai + hybrid', chinaCities, true), false);
assert.equal(matchesLocation({ location:'Remote, APAC', remote:true }, 'Shanghai + hybrid', chinaCities, true), true);
assert.equal(matchesBooleanText({ title:'Azure Linux Engineer' }, 'Azure AND Linux'), true);
assert.equal(matchesBooleanText({ title:'Azure Engineer' }, 'Azure OR Linux'), true);
assert.equal(matchesBooleanText({ title:'Azure Windows Engineer' }, 'Azure NOT Linux'), true);
assert.equal(matchesBooleanText({ title:'Azure Linux Engineer' }, 'Azure NOT Linux'), false);
assert.equal(matchesLanguage({ rawLanguage:'English accepted' }, 'English accepted'), true);
assert.equal(matchesLanguage({ rawLanguage:'German / confirm' }, 'English accepted'), false);
assert.equal(matchesWorkType({ workType:'Permanent, full-time' }, 'Full-time'), true);
assert.equal(matchesWorkType({ workType:'Contract' }, 'Full-time'), false);
assert.equal(matchesSource({ source:'Freehire', sources:['Remotive'] }, 'Remotive'), true);
assert.equal(matchesExperience({ experience:'Senior' }, 'Senior'), true);
assert.equal(matchesExperience({ experience:'Mid level' }, 'Senior'), false);

// Test the public portfolio's filters without contacting a running personal
// dashboard or requiring its database. API and authentication have their own tests.
const jobs = [
  ...Array.from({length:24},(_,index)=>({title:`Example Berlin role ${index+1}`,location:'Berlin',
    rawLanguage:index%2===0?'English accepted':'German / confirm',workType:index%3===0?'Full-time':'Contract',
    experience:index%3===0?'Senior':'Mid level',salaryMax:index%2===0?70000:50000,
    posted:index%2===0?'2026-01-01':'',match:index%2===0?85:55,
    url:index%2===0?'https://example.test/role':'',applicationStatus:index%3===0?'Applied':'Not applied'})),
  {location:'Stuttgart',remote:false}, {location:'Munich / hybrid',remote:true},
  {location:'Remote, Germany',remote:true}
];
const berlin = jobs.filter(job => matchesLocation(job, 'Berlin', cities));
const berlinPlusRemote = jobs.filter(job => matchesLocation(job, 'Berlin', cities, true));
assert.equal(berlin.length,24,'strict Berlin filtering retains all matching fixtures');
assert.equal(berlin.some(job => /stuttgart/i.test(job.location) && !/berlin/i.test(job.location)), false, 'Berlin results must not contain Stuttgart-tied roles');
assert.equal(berlin.some(job => /(munich|münchen|hamburg|cologne|köln|düsseldorf|leipzig|dresden|nuremberg|nürnberg|hannover|bremen|essen|dortmund|bonn|wiesbaden|aachen)/i.test(job.location) && !/berlin/i.test(job.location)), false, 'Berlin results must not contain roles tied to another configured city');
assert.equal(berlinPlusRemote.length,25,'Remote opt-in adds only the Germany-wide remote fixture');
const checks = {
  english:jobs.filter(job => matchesLanguage(job, 'English accepted')),
  fullTime:jobs.filter(job => matchesWorkType(job, 'Full-time')),
  senior:jobs.filter(job => matchesExperience(job, 'Senior')),
  salary65k:jobs.filter(job => Number(job.salaryMax) >= 65000 || Number(job.salaryMin) >= 65000),
  dated:jobs.filter(job => Boolean(job.posted)),
  remote:jobs.filter(job => Boolean(job.remote)),
  match80:jobs.filter(job => Number(job.match) >= 80),
  applyLink:jobs.filter(job => Boolean(job.url)),
  applied:jobs.filter(job => job.applicationStatus === 'Applied')
};
for (const [name, rows] of Object.entries(checks)) {
  assert.ok(rows.length > 0 && rows.length < jobs.length, `${name} must select a nonempty proper subset`);
}
console.log(JSON.stringify({ ok:true, total:jobs.length, berlin:berlin.length, berlinPlusRemote:berlinPlusRemote.length, counts:Object.fromEntries(Object.entries(checks).map(([name, rows]) => [name, rows.length])) }));
