import assert from 'node:assert/strict';
import test from 'node:test';
import { compileVerifiedPostingAliases, groupVerifiedPostingAliases } from './verified-job-posting-aliases.mjs';

const de = 'https://careers.example.com/DE/(Engineer)/100';
const en = 'https://careers.example.com/EN/Engineer/101';
const other = 'https://careers.example.com/EN/Engineer/111';
const aliases = compileVerifiedPostingAliases([[de, en]]);
const jobs = [
  { id:'en', url:en, title:'Engineer', company:'Example', active:true },
  { id:'de', url:de.replace('(', '%28').replace(')', '%29') + '/', title:'Engineer', company:'Example', active:true },
  { id:'other', url:other, title:'Engineer', company:'Example', applicationStatus:'Case Closed', active:false }
];
const ids = rows => rows.map(row => row.id);

test('only confirmed translations group together, independent of order', () => {
  assert.deepEqual(ids(groupVerifiedPostingAliases(jobs, aliases)), ['de', 'other']);
  assert.deepEqual(ids(groupVerifiedPostingAliases(jobs.toReversed(), aliases)), ['other', 'de']);
  assert.deepEqual(ids(groupVerifiedPostingAliases(jobs, new Map())), ['en', 'de', 'other']);
  const distinct = { id:'distinct', url:en + '?requisition=1010' };
  assert.deepEqual(ids(groupVerifiedPostingAliases([...jobs, distinct], aliases)), ['de', 'other', 'distinct']);
});

test('an active copy takes precedence over an inactive untracked copy', () => {
  assert.deepEqual(ids(groupVerifiedPostingAliases([jobs[0], {...jobs[1], active:false}], aliases)), ['en']);
});

test('closing a copy suppresses untracked mirrors, but never hides other tracked records', () => {
  const closed = {...jobs[0], applicationStatus:'Case Closed', active:false};
  assert.deepEqual(groupVerifiedPostingAliases([closed, ...jobs.slice(1)], aliases), [closed, jobs[2]]);
  const prepared = {...jobs[1], applicationPackage:{ language:'de' }};
  assert.deepEqual(groupVerifiedPostingAliases([closed, prepared], aliases), [closed, prepared]);
});

test('rejects overlapping or insecure posting URL groups', () => {
  assert.throws(() => compileVerifiedPostingAliases([[de, en], [en, other]]), /overlapping/);
  assert.throws(() => compileVerifiedPostingAliases([[de.replace('https:', 'http:'), en]]), /Invalid/);
});
