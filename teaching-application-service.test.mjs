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
        new Paragraph('Demo Candidate'),new Paragraph('English Language Teacher'),new Paragraph('Sample City | candidate@example.com'),
        new Paragraph('TEACHING EXPERIENCE'),new Paragraph('English Teacher | Example Language Institute | 2022-present'),
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
    assert.match(first.documents.cv.en.body,/Example Language Institute/);
    assert.match(first.documents.coverLetter.de.body,/Example School/);
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
  } finally {await rm(workspace,{recursive:true,force:true});}
});
