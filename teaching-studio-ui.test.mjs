import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const chrome='C:/Program Files/Google/Chrome/Application/chrome.exe';
const job={id:'teaching:sample',title:'English Teacher',company:'Example School',location:'Stuttgart',url:'https://school.example/jobs/english-teacher',description:'Teach English and prepare lessons. '.repeat(25),applicationStatus:'Preparing',interviewFitScore:78,opportunityQualityScore:82,recommendation:'APPLY',workType:'Full-time',rawLanguage:'English'};
const documents=Object.fromEntries(['cv','coverLetter'].map(type=>[type,Object.fromEntries(['de','en'].map(language=>[language,{body:`Demo Candidate\nEnglish Teacher\n${type} ${language} `.repeat(9),document:{fileName:`Teaching_${type}_${language}.docx`,downloadUrl:'/download',pdfDownloadUrl:'/download'}}]))]));
const pkg={job,posting:{text:job.description,source:'verified Teaching posting'},currentVersion:1,history:[{version:1,createdAt:new Date().toISOString(),changeType:'full'}],documents,quality:{applicationReady:true},updatedAt:new Date().toISOString()};
const overview={jobs:[job],sources:[],documents:[],savedSearches:[],sourceStatus:[],databaseStats:{total:1,active:1,archived:0},refreshedAt:new Date().toISOString()};

test('Teaching Fast Apply and AI website buttons open their own working studio flows', {skip:!existsSync(chrome)}, async()=>{
  let websiteStarts=0;
  let savedLink='';
  const files=new Map([['/teaching','teaching.html'],['/teaching.js','teaching.js'],['/teaching.css','teaching.css'],['/teaching-parity.css','teaching-parity.css'],['/teaching-filter-logic.js','teaching-filter-logic.js'],['/filter-logic.js','filter-logic.js']]);
  const server=createServer(async(req,res)=>{
    const path=new URL(req.url,'http://localhost').pathname;
    const send=(value,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
    if(files.has(path)){const content=await readFile(join(import.meta.dirname,files.get(path)));res.writeHead(200,{'content-type':path.endsWith('.css')?'text/css':path.endsWith('.js')?'text/javascript':'text/html'});res.end(content);return;}
    if(path==='/api/user-space/session')return send({authenticated:true,csrfToken:'test-token'});
    if(path==='/api/user-space/teaching-overview')return send(overview);
    if(path==='/api/user-space/teaching-refresh')return send({id:'test-refresh',status:'completed',result:{...overview,verified:1,checked:1}});
    if(path==='/api/user-space/teaching-application-package')return send({package:pkg});
    if(path==='/api/user-space/teaching-application-link'){
      let body='';for await(const chunk of req)body+=chunk;savedLink=JSON.parse(body).url;
      return send({job:{...job,applicationUrl:savedLink}});
    }
    if(path==='/api/user-space/teaching-fast-apply/preview')return send({preview:{recipient:'',recipientVerified:false,verifiedRecipients:[],subject:'Application for English Teacher',body:'Dear team, please find my application and teaching documents attached.',attachments:[{fileName:'Teaching_CV.pdf'},{fileName:'Teaching_CL.pdf'}],bcc:'',gmail:{connected:true,email:'sender@example.org'}},remaining:10,pending:null});
    if(path==='/api/user-space/teaching-website-apply/status')return send({session:null,helperReady:true});
    if(path==='/api/user-space/teaching-website-apply/start'){websiteStarts++;return send({session:{status:'ready_for_final_confirmation',message:'Review the Chrome form before final submission.'}},202);}
    send({error:'Unexpected mock route: '+path},404);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true,executablePath:chrome});
  try{
    const page=await browser.newPage({viewport:{width:1280,height:850}});
    await page.goto(`http://127.0.0.1:${server.address().port}/teaching`);
    await page.getByRole('button',{name:'Fast Apply',exact:true}).first().click();
    await page.getByText('Fast Apply · Gmail preview').waitFor();
    assert.equal(await page.locator('#sendTeachingEmail').isDisabled(),true);
    await page.locator('#teachingRecipient').fill('not-an-address');
    assert.equal(await page.locator('#sendTeachingEmail').isDisabled(),true);
    await page.locator('#teachingRecipient').fill('jobs@example.org');
    assert.equal(await page.locator('#sendTeachingEmail').isEnabled(),true);
    assert.equal(await page.locator('#teachingAttachments li').count(),2);
    await page.locator('#closeApplication').click();
    await page.getByRole('button',{name:'Start AI website application',exact:true}).first().click();
    await page.getByText('AI Website Apply · Teaching Chrome helper').waitFor();
    assert.equal(websiteStarts,1);
    assert.equal(await page.locator('#submitTeachingWebsiteApply').isEnabled(),true);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.locator('#closeApplication').click();
    await page.getByRole('button',{name:'Edit link / Retry AI Apply',exact:true}).first().click();
    await page.locator('#teachingApplicationUrl').fill('https://apply.example.org/english-teacher');
    await page.locator('#saveTeachingApplicationUrl').click();
    await page.waitForFunction(()=>document.querySelector('#openTeachingApplicationPage').href==='https://apply.example.org/english-teacher');
    assert.equal(savedLink,'https://apply.example.org/english-teacher');
    assert.equal(websiteStarts,2);
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.equal(await page.locator('#closeApplication').isVisible(),true);
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
