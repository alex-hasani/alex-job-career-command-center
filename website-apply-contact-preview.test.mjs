import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { chromium } from 'playwright';
import { createWebsiteApplyAgent } from './website-apply-agent.mjs';

const systemChrome='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const executablePath=process.env.ALEX_JOB_TEST_CHROMIUM||
  (existsSync(chromium.executablePath())?chromium.executablePath():systemChrome);

test('contact fields fill before document review on an inline German application form',
  {skip:!existsSync(executablePath),timeout:30000},async t=>{
    const browser=await chromium.launch({executablePath,headless:true});
    t.after(()=>browser.close());
    const page=await browser.newPage();
    const url='https://careers.example.test/jobs/fixture';
    await page.route(url,route=>route.fulfill({contentType:'text/html',body:`
      <form id="newsletter"><label>Email <input type="email"></label></form>
      <form id="application">
        <label>Vorname <input name="first" value="Already entered"></label>
        <label>Nachname <input name="last"></label>
        <label>Email <input name="email" type="email"></label>
        <label>Telefonnummer <input name="phone" type="tel"></label>
        <label>Verfügbarkeit <input name="availability"></label>
        <label>Gehaltsvorstellungen <input name="salary"></label>
        <input type="file"><input type="file">
        <label><input type="checkbox"> Ich willige ein</label>
        <button type="submit">Jetzt bewerben</button>
      </form>`}));
    await page.goto(url);
    const chrome={
      start:async()=>{},
      pages:async()=>[{id:123,url}],
      evaluate:(_,code)=>page.evaluate(`(${code.toString()})()`),
      tool:async action=>assert.fail(`Unexpected browser action: ${action}`)
    };
    const agent=createWebsiteApplyAgent({chromeClient:chrome,profile:{
      identity:{email:'fixture@example.com',phone:'TEST-PHONE'},
      applicationForm:{firstName:'Fixture',lastName:'Candidate'}
    }});
    const job={id:'fixture',url};
    await agent.startOnPage(job,123);
    await agent.prepareVisibleForm(job.id);
    assert.equal(agent.status(job.id).status,'preparing_files');
    assert.deepEqual(await page.locator('#application input').evaluateAll(inputs=>inputs.map(input=>input.value)),[
      'Already entered','Candidate','fixture@example.com','TEST-PHONE','','','','','on'
    ]);
    assert.equal(await page.locator('#newsletter input').inputValue(),'');
    assert.equal(await page.locator('#application [type=checkbox]').isChecked(),false);
    agent.fail(job.id,new Error('Document review requested changes.'));
    assert.match(agent.status(job.id).message,/Contact fields were filled. No files were attached; nothing was submitted/);
  });
