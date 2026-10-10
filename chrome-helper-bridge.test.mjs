import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { completeChromeHelperCommand, sendChromeHelperCommand, takeChromeHelperCommand } from './chrome-helper-bridge.mjs';

test('a timed-out Chrome command is removed instead of running later', async () => {
  assert.equal(await takeChromeHelperCommand(1),null);
  await assert.rejects(sendChromeHelperCommand('tabs',{},10),/did not complete tabs in time/);
  assert.equal(await takeChromeHelperCommand(1),null);
});

test('personal Chrome helpers use isolated command channels', async () => {
  assert.equal(await takeChromeHelperCommand(1,'person-a'),null);
  assert.equal(await takeChromeHelperCommand(1,'person-b'),null);
  const pending=sendChromeHelperCommand('ping',{owner:'a'},1000,'person-a');
  assert.equal(await takeChromeHelperCommand(1,'person-b'),null);
  const command=await takeChromeHelperCommand(10,'person-a');
  assert.equal(command.payload.owner,'a');
  assert.equal(completeChromeHelperCommand({id:command.id,result:{ok:true}},'person-a'),true);
  assert.deepEqual(await pending,{ok:true});
});

test('Chrome helper searches embedded frames and clicks only the chosen application frame', async () => {
  const [source,agent,manifest]=await Promise.all([
    readFile(new URL('./chrome-helper-extension/service-worker.js',import.meta.url),'utf8'),
    readFile(new URL('./website-apply-agent.mjs',import.meta.url),'utf8'),
    readFile(new URL('./chrome-helper-extension/manifest.json',import.meta.url),'utf8')
  ]);
  assert.match(source,/target:\{tabId,allFrames:true\}/);
  assert.match(source,/frameIds:\[chosen\.frameId\]/);
  assert.match(source,/final\.test\(text\)/);
  assert.match(source,/clickApplicationTarget/);
  assert.match(source,/evaluateFrames/);
  assert.match(source,/clickAdvanceTarget/);
  assert.ok(source.indexOf("'DOM.enable'")<source.indexOf("'DOM.getDocument'"));
  assert.match(source,/findFileInputNode/);
  assert.match(source,/replacementFileInputNode/);
  assert.match(source,/revealUploadTarget/);
  assert.match(source,/payload\.kinds/);
  assert.match(source,/node\?\.contentDocument/);
  assert.match(source,/node\?\.shadowRoots/);
  assert.match(source,/backendNodeId/);
  assert.match(source,/for\(let attempt=0;attempt<2;attempt\+\+\)/);
  assert.match(source,/Cannot find context/);
  assert.match(agent,/posting[\s\S]+evaluateFrames/);
  assert.match(agent,/including embedded frames/);
  assert.match(manifest,/"version": "1\.2\.2"/);
});

test('Chrome helper exposes a safe current-page retry action', async () => {
  const [manifest,popup,popupHtml,worker,server,agent]=await Promise.all([
    readFile(new URL('./chrome-helper-extension/manifest.json',import.meta.url),'utf8'),
    readFile(new URL('./chrome-helper-extension/popup.js',import.meta.url),'utf8'),
    readFile(new URL('./chrome-helper-extension/popup.html',import.meta.url),'utf8'),
    readFile(new URL('./chrome-helper-extension/service-worker.js',import.meta.url),'utf8'),
    readFile(new URL('./server.mjs',import.meta.url),'utf8'),
    readFile(new URL('./website-apply-agent.mjs',import.meta.url),'utf8')
  ]);
  assert.match(manifest,/"default_popup": "popup\.html"/);
  assert.match(manifest,/"storage"/);
  assert.match(popup,/alex-job-retry-current/);
  assert.doesNotMatch(popup,/fetch\('http:\/\/127\.0\.0\.1:8787\/api\/browser-helper\/retry-current'/);
  assert.match(worker,/alex-job-retry-current/);
  assert.match(worker,/chrome\.storage\.session/);
  assert.match(worker,/You may close this popup/);
  assert.match(worker,/\/api\/browser-helper\/retry-current/);
  assert.match(server,/\/api\/browser-helper\/retry-current/);
  assert.match(agent,/startOnPage/);
  assert.match(agent,/retryPage/);
  assert.match(worker,/Auf diese Stelle bewerben/);
  assert.match(popupHtml,/Final submission always waits for your confirmation/);
});

test('website agent ignores hidden login and CAPTCHA controls', async () => {
  const source=await readFile(new URL('./website-apply-agent.mjs',import.meta.url),'utf8');
  assert.match(source,/input\[type="password"\]'\)\]\.some\(visible\)/);
  assert.match(source,/captcha[^\n]+\.some\(visible\)/);
  assert.match(source,/state\.formFields===0/);
});
