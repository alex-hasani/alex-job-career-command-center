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

const response = await fetch('http://127.0.0.1:8787/api/jobs');
assert.equal(response.ok, true);
const jobs = (await response.json()).jobs;
const berlin = jobs.filter(job => matchesLocation(job, 'Berlin', cities));
const berlinPlusRemote = jobs.filter(job => matchesLocation(job, 'Berlin', cities, true));
assert.ok(berlin.length > 0, 'Berlin filter should return at least one saved job');
assert.ok(berlin.length >= 20, `Berlin filter received only ${berlin.length} records; the API may be truncating the SQLite database before client-side filtering`);
assert.equal(berlin.some(job => /stuttgart/i.test(job.location) && !/berlin/i.test(job.location)), false, 'Berlin results must not contain Stuttgart-tied roles');
assert.equal(berlin.some(job => /(munich|münchen|hamburg|cologne|köln|düsseldorf|leipzig|dresden|nuremberg|nürnberg|hannover|bremen|essen|dortmund|bonn|wiesbaden|aachen)/i.test(job.location) && !/berlin/i.test(job.location)), false, 'Berlin results must not contain roles tied to another configured city');
assert.ok(berlinPlusRemote.length >= berlin.length, 'Remote opt-in must not remove strict Berlin matches');
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
  assert.ok(rows.length < jobs.length, `${name} must narrow the database`);
}
console.log(JSON.stringify({ ok:true, total:jobs.length, berlin:berlin.length, berlinPlusRemote:berlinPlusRemote.length, counts:Object.fromEntries(Object.entries(checks).map(([name, rows]) => [name, rows.length])) }));
