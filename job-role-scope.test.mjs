import test from 'node:test';
import assert from 'node:assert/strict';
import { isTechnicalRole } from './job-role-scope.mjs';

test('keeps technical infrastructure and support roles', () => {
  for (const title of [
    'IT System Engineer / Systemarchitekt (m/w/d)',
    'Cloud Platform Engineer Azure',
    'Senior Systemadministrator Microsoft 365',
    'Technical Support Engineer L3',
    'Fachinformatiker Systemintegration'
  ]) assert.equal(isTechnicalRole({ title }), true, title);
});

test('removes sales and accounting roles even when their descriptions mention IT', () => {
  for (const title of [
    'Sales Manager Cloud Solutions',
    'Key Account Manager IT',
    'Vertriebsingenieur Digitalisierung',
    'Financial Accountant',
    'Sachbearbeiter Finanzbuchhaltung',
    'Controller IT-Kosten'
  ]) assert.equal(isTechnicalRole({ title, description:'Microsoft Azure and enterprise IT' }), false, title);
});

test('removes unrelated nontechnical roles from the search feed', () => {
  assert.equal(isTechnicalRole({ title:'Office Manager' }), false);
  assert.equal(isTechnicalRole({ title:'Recruiter' }), false);
});
