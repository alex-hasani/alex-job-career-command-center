import test from 'node:test';
import assert from 'node:assert/strict';
import { assessAgainstResume } from './resume-assessment.mjs';

test('separates interview fit from opportunity quality and preserves verified evidence depth', () => {
  const result = assessAgainstResume({
    title:'Senior Systems Engineer - Windows and VMware',
    description:'Operate Windows Server, Active Directory and VMware vSphere in an enterprise infrastructure team. Hybrid work.',
    location:'Stuttgart',
    workType:'Full-time',
    remote:true,
    posted:new Date().toISOString(),
    discoveryScore:78
  });
  assert.equal(typeof result.interviewFitScore, 'number');
  assert.equal(typeof result.opportunityQualityScore, 'number');
  assert.equal(typeof result.applicationPriorityScore, 'number');
  assert.ok(result.requirementEvidenceMatrix.some(row => row.matchType === 'DIRECT STRONG'));
  assert.ok(result.requirementEvidenceMatrix.some(row => /Production/.test(row.evidenceDepth)));
  assert.ok(['PRIORITY APPLY','APPLY','STRATEGIC STRETCH','LOW PRIORITY','SKIP'].includes(result.recommendation));
});

test('mandatory C1 German remains a hard blocker pending verified local evidence', () => {
  const result = assessAgainstResume({
    title:'IT-Systemadministrator',
    description:'Zwingend erforderlich: Deutsch C1. Administration von Windows Server und Active Directory.',
    location:'Stuttgart',
    workType:'Full-time',
    discoveryScore:90
  });
  assert.equal(result.languageRisk.severity, 'HARD BLOCKER');
  assert.equal(result.recommendation, 'SKIP');
  assert.equal(result.documentGenerationGate, 'DO NOT GENERATE');
});

test('learning remains learning and is never promoted to production experience', () => {
  const result = assessAgainstResume({
    title:'Cloud Platform Engineer',
    description:'Must have Kubernetes and Terraform production experience with AWS.',
    location:'Remote Germany',
    workType:'Full-time',
    remote:true,
    discoveryScore:82
  });
  const terraform = result.requirementEvidenceMatrix.find(row => /Terraform/.test(row.requirement));
  assert.equal(terraform.matchType, 'LEARNING');
  assert.match(terraform.candidateEvidence, /no verified production-depth claim/i);
  assert.notEqual(terraform.risk, 'NO ISSUE');
});

test('provisional assessment is explicit when a full JD is unavailable', () => {
  const result = assessAgainstResume({ title:'System Engineer', description:'', discoveryScore:60 });
  assert.match(result.assessmentConfidence, /Provisional/);
});
