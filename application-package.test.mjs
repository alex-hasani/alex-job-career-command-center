import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildApplicationRemarks, buildResume, compactDocumentFileName } from './cover-letter-generator.mjs';

const job = { company:'Test Employer', title:'Senior Hybrid Infrastructure Engineer', location:'Stuttgart' };
const posting = {
  text:'Responsibilities include Windows Server, Active Directory, VMware vSphere, Azure hybrid infrastructure, Linux operations, Ansible automation, incident management, backup and recovery. Requirements include enterprise infrastructure experience, English communication, Terraform and Kubernetes as desirable skills.'
};

test('application document names stay informative and below portal limits', () => {
  const longJob = { title:'IT System-Administrator (m/w/d) Fieldservice Im Großraum Stuttgart' };
  const names = [
    compactDocumentFileName(longJob,12,'cv','de','pdf'),
    compactDocumentFileName(longJob,12,'coverLetter','de','pdf'),
    compactDocumentFileName(longJob,12,'cv','en','docx')
  ];
  assert.deepEqual(names,[
    'Alex_Hasani_IT_System_Admin_CV_DE_v12.pdf',
    'Alex_Hasani_IT_System_Admin_CL_DE_v12.pdf',
    'Alex_Hasani_IT_System_Admin_CV_EN_v12.docx'
  ]);
  assert.ok(names.every(name => name.length < 50));
});

test('application document names remove posting-age metadata and keep the actual position', () => {
  const noisyJobs = [
    { title:'1 day ago IT System-Administrator (m/w/d) Fieldservice Im Großraum Stuttgart' },
    { title:'Vor 2 Tagen Senior Cloud Platform Engineer' },
    { title:'Neu DevOps Engineer' },
    { title:'1 day ago IT', positionTitle:'IT System Engineer Infrastructure' }
  ];
  const names = noisyJobs.map(job => compactDocumentFileName(job,1,'cv','de','pdf'));
  assert.deepEqual(names,[
    'Alex_Hasani_IT_System_Admin_CV_DE_v1.pdf',
    'Alex_Hasani_Senior_Cloud_Platform_CV_DE_v1.pdf',
    'Alex_Hasani_DevOps_Engineer_CV_DE_v1.pdf',
    'Alex_Hasani_IT_System_Engineer_Infra_CV_DE_v1.pdf'
  ]);
  assert.ok(names.every(name => name.length < 50));
  assert.ok(names.every(name => !/day|ago|tagen|neu/i.test(name)));
});

test('job-specific CV uses one evidence map in German and English', () => {
  const de = buildResume(job,posting,'de');
  const en = buildResume(job,posting,'en');
  assert.match(de.body,/Jordan Example/);
  assert.match(en.body,/Jordan Example/);
  assert.match(de.body,/Arbeitserlaubnis: im lokalen Profil verifizieren/);
  assert.match(en.body,/Work authorisation: verify in the local profile/);
  assert.ok(de.evidenceIds.length > 3);
  assert.deepEqual(de.roles.map(role => role.employer),en.roles.map(role => role.employer));
});

test('unverified growth technologies are reported internally and not added to the CV', () => {
  const resume = buildResume(job,posting,'en');
  assert.equal(/Terraform|Kubernetes/.test(resume.body),false);
  assert.deepEqual(resume.customization.gapsNotAdded.map(item => item.term),['terraform','kubernetes']);
});

test('candidate facts remain stable while emphasis changes', () => {
  const azure = buildResume(job,{text:'Azure Entra ID VNet Bastion hybrid cloud infrastructure responsibilities and requirements'},'en');
  const vmware = buildResume(job,{text:'VMware vSphere ESXi datacentre virtualisation responsibilities and requirements'},'en');
  assert.notEqual(azure.headline,vmware.headline);
  assert.equal(azure.roles[0].employer,vmware.roles[0].employer);
  assert.equal(azure.roles[0].officialTitle.en,vmware.roles[0].officialTitle.en);
});

test('languages use one compact ordered line before the driving licence', () => {
  const de = buildResume(job,posting,'de');
  const en = buildResume(job,posting,'en');
  assert.match(de.body,/• Deutsch: B2[^\n]+\| Englisch:[^\n]+\| Weitere Sprache: Muttersprache\n• Führerschein: Klasse B/);
  assert.match(en.body,/• German: B2[^\n]+\| English:[^\n]+\| Additional language: Native\n• Driving licence: Category B/);
  assert.equal(de.body.indexOf('Deutsch:'), de.body.lastIndexOf('Deutsch:'));
  assert.equal(en.body.indexOf('German:'), en.body.lastIndexOf('German:'));
});

test('portal remarks stay concise, job-specific and evidence-grounded', () => {
  const de = buildApplicationRemarks(job,posting,'de');
  const en = buildApplicationRemarks(job,posting,'en');
  assert.match(de.body,/Senior Hybrid Infrastructure Engineer/);
  assert.match(de.body,/verifizierten lokalen Profil/);
  assert.match(en.body,/verified local profile/);
  assert.ok(de.body.length < 700);
  assert.ok(en.body.length < 700);
  assert.equal(/salary|gehalt|start date|eintritt/i.test(`${de.body} ${en.body}`),false);
});

test('application recommendations guide without blocking user choice', async () => {
  const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
  assert.match(html, /\["Rejected","Withdrawn","Case Closed"\]\.includes\(j\.applicationStatus\) \? " disabled" : ""/);
  assert.doesNotMatch(html, /includes\(j\.applicationStatus\) \|\| j\.documentGenerationGate === "DO NOT GENERATE"/);
});
