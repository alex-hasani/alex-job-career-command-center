import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { Document, Packer, Paragraph } from 'docx';
import { createTeachingApplicationService } from './teaching-application-service.mjs';

test('Teaching application packages use Teaching masters and Teaching-only versioned storage', async () => {
  const workspace=await mkdtemp(join(tmpdir(),'alex-teaching-package-'));
  try {
    const docs=join(workspace,'Documents','Teaching');
    await mkdir(docs,{recursive:true});
    for(const language of ['EN','DE']){
      const fixture=new Document({sections:[{children:[
        new Paragraph('Demo Candidate'),new Paragraph('English Language Teacher'),new Paragraph('Stuttgart | demo@example.org'),
        new Paragraph('TEACHING EXPERIENCE'),new Paragraph('English Teacher | Sample Language Centre | 2022-present'),
        new Paragraph('• Planned lessons for young learners and prepared teaching props and after-class follow-up.'),
        new Paragraph('• Trained teachers and supported classroom management.')
      ]}]});
      await writeFile(join(docs,`Demo_Candidate_Teaching_CV_${language}_2026-10-23.docx`),await Packer.toBuffer(fixture));
    }
    const service=createTeachingApplicationService({workspace});
    const job={id:'teaching:test',title:'English Teacher',company:'Example School',location:'Stuttgart',url:'https://example.org/jobs/teacher',description:'English teacher for young learners. '.repeat(25)};
    await assert.rejects(service.prepare(job,'too short'),/complete job description/);
    const first=await service.prepare(job);
    assert.equal(first.currentVersion,1);
    assert.equal(first.quality.applicationReady,true);
    assert.match(first.documents.cv.en.body,/English Teacher \| Example School/);
    assert.match(first.documents.cv.en.body,/Sample Language Centre/);
    assert.match(first.documents.coverLetter.de.body,/Example School/);
    assert.match(first.documents.remarks.en.body,/English Teacher.*Example School/);
    const item=await service.download(job,'en','docx','cv');
    assert.match(item.path,/Documents[\\/]Teaching[\\/]Applications/);
    const zip=await JSZip.loadAsync(await readFile(item.path));
    assert.match(await zip.file('word/document.xml').async('string'),/Example School/);
    assert.doesNotMatch(await zip.file('docProps/core.xml').async('string'),/OpenAI|ChatGPT|Codex/i);
    const pdf=await service.download(job,'en','pdf','cv');
    assert.equal((await readFile(pdf.path)).subarray(0,5).toString(),'%PDF-');
    const second=await service.prepare(job);
    assert.equal(second.currentVersion,2);
    assert.equal((await service.read(job)).history.length,2);
    const edited=await service.save(job,'cv','en',`${second.documents.cv.en.body}\n• Prepared classroom props and after-class follow-up.`);
    assert.equal(edited.currentVersion,3);
    assert.match(edited.documents.cv.en.body,/classroom props/);
    const letterOnly=await service.prepare(job,'','coverLetter');
    assert.equal(letterOnly.currentVersion,4);
    assert.equal(letterOnly.documents.cv.en.body,edited.documents.cv.en.body);
    const restored=await service.restore(job,1);
    assert.equal(restored.currentVersion,5);
    assert.equal(restored.documents.cv.en.body,first.documents.cv.en.body);
    assert.equal(restored.history.length,5);
    const note=await service.save(job,'remarks','de','Ich habe Englisch unterrichtet und Unterrichtspläne vorbereitet.');
    assert.equal(note.currentVersion,6);
    assert.match(note.documents.remarks.de.body,/Unterrichtspläne/);
    assert.equal((await service.read(job)).documents.remarks.de.body,note.documents.remarks.de.body);
    await assert.rejects(service.save(job,'cv','en','short'),/Review the complete/);
  } finally {await rm(workspace,{recursive:true,force:true});}
});
