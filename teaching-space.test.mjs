import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sortTeachingSources, teachingDocument, teachingOverview, teachingPaths } from './teaching-space.mjs';

test('Teaching workspace paths stay outside IT state and source directories', () => {
  const paths=teachingPaths('E:/Projects/Job Search');
  assert.match(paths.config,/Teaching_Job_Search/);
  assert.match(paths.documents,/Documents[\\/]Teaching/);
  assert.match(paths.state,/Teaching_Job_Search/);
  assert.doesNotMatch(paths.state,/dynamic-job-dashboard|[\\/]State[\\/]job_search\.sqlite/);
});
test('Teaching sources sort by availability then name', () => {
  const sorted=sortTeachingSources([
    {name:'Zeta',availability:'available'},
    {name:'Beta',availability:'not_checked'},
    {name:'Alpha',availability:'available'},
    {name:'Gamma',availability:'unavailable'}
  ]);
  assert.deepEqual(sorted.map(item=>item.name),['Alpha','Zeta','Beta','Gamma']);
});

test('Teaching overview lists only Teaching documents and rejects path traversal', async () => {
  const workspace=await mkdtemp(join(tmpdir(),'teaching-space-'));
  const configDir=join(workspace,'Teaching_Job_Search'),documents=join(workspace,'Documents','Teaching');
  await mkdir(configDir,{recursive:true});await mkdir(documents,{recursive:true});
  await writeFile(join(configDir,'teaching-search-config.json'),JSON.stringify({targetRegion:'Stuttgart',roleFamilies:['English teacher'],keywords:['English teacher'],officialSources:[{name:'Official school',url:'https://school.example/jobs'},{name:'Unsafe',url:'file:///private'}]}));
  await writeFile(join(documents,'Sample_Teaching_CV_EN_2026-10-22.pdf'),'PDF sample');
  await writeFile(join(documents,'private-notes.txt'),'not public');
  try {
    const overview=await teachingOverview(workspace);
    assert.equal(overview.documents.length,1);
    assert.equal(overview.sources.length,1);
    assert.equal(overview.documents[0].name,'Sample_Teaching_CV_EN_2026-10-22.pdf');
    assert.equal((await teachingDocument(workspace,'Sample_Teaching_CV_EN_2026-10-22.pdf')).file.toString(),'PDF sample');
    assert.equal(await teachingDocument(workspace,'../private-notes.txt'),null);
    assert.equal(await teachingDocument(workspace,'private-notes.txt'),null);
  } finally {await rm(workspace,{recursive:true,force:true});}
});
