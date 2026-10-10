import { helperConfig } from './profile-config.js';
const helperHeaders=extra=>({...extra,...(helperConfig.publicId?{'x-alex-job-extension-id':helperConfig.publicId,'x-alex-job-extension-token':helperConfig.token}:{})});
async function ensureOffscreen() {
  const url=chrome.runtime.getURL('offscreen.html');
  const contexts=await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT'],documentUrls:[url]});
  if(contexts.length) return;
  await chrome.offscreen.createDocument({
    url:'offscreen.html',
    reasons:['DOM_SCRAPING'],
    justification:'Keep the local Alex Job command connection active while an approved application is prepared.'
  });
}
chrome.runtime.onInstalled.addListener(()=>ensureOffscreen());
chrome.runtime.onStartup.addListener(()=>ensureOffscreen());
ensureOffscreen();

const retryStateKey='alexJobRetryState';
const activeRetryStatuses=new Set(['starting','opening','scanning_advert','preparing_files','navigating_to_application','filling_form','retrying']);

async function saveRetryState(state) {
  const next={...state,updatedAt:new Date().toISOString()};
  await chrome.storage.session.set({[retryStateKey]:next});
  return next;
}

async function storedRetryState() {
  const stored=await chrome.storage.session.get(retryStateKey);
  return stored[retryStateKey]||null;
}

async function refreshRetryState() {
  const current=await storedRetryState();
  if(!current?.jobId) return current;
  try {
    const response=await fetch('http://127.0.0.1:8787/api/browser-helper/retry-status?id='+encodeURIComponent(current.jobId),{cache:'no-store',headers:helperHeaders({})});
    const result=await response.json().catch(()=>({}));
    if(response.ok&&result.session) {
      return saveRetryState({...current,status:result.session.status||current.status,message:result.session.message||current.message,sessionId:result.session.id||current.sessionId});
    }
  } catch {}
  return current;
}

async function startRetryFromPopup(input={}) {
  const tabId=Number(input.tabId),url=String(input.url||'');
  if(!Number.isInteger(tabId)||tabId<0||!/^https?:\/\//i.test(url)) throw new Error('Open the exact job application page in this Chrome tab first.');
  const current=await refreshRetryState();
  if(current?.tabId===tabId&&activeRetryStatuses.has(current.status)) return current;
  const bound=current?.tabId===tabId?current:null;
  await ensureOffscreen();
  await saveRetryState({tabId,url:bound?.url||url,currentUrl:url,title:String(input.title||''),jobId:bound?.jobId||'',sessionId:bound?.sessionId||'',status:'starting',message:'Starting a fresh scan, fill and PDF upload…',startedAt:new Date().toISOString()});
  try {
    const response=await fetch('http://127.0.0.1:8787/api/browser-helper/retry-current',{
      method:'POST',
      headers:helperHeaders({'content-type':'application/json'}),
      body:JSON.stringify({tabId,url,title:String(input.title||''),jobId:bound?.jobId||'',originUrl:bound?.url||''})
    });
    const result=await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(result.error||'Alex Job could not start the browser agent.');
    const session=result.session||{};
    return saveRetryState({tabId,url:bound?.url||url,currentUrl:url,title:String(input.title||''),jobId:session.jobId||bound?.jobId||'',sessionId:session.id||'',status:session.status||'scanning_advert',message:session.message||'Started. You may close this popup; Alex Job will keep working.',startedAt:session.startedAt||new Date().toISOString()});
  } catch(error) {
    await saveRetryState({tabId,url:bound?.url||url,currentUrl:url,title:String(input.title||''),jobId:bound?.jobId||'',sessionId:bound?.sessionId||'',status:'failed',message:error?.message||String(error),startedAt:new Date().toISOString()});
    throw error;
  }
}

function waitForTab(tabId,timeout=45000) {
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{cleanup();reject(new Error('The job page did not finish loading in time'));},timeout);
    const listener=(changedId,info,tab)=>{if(changedId===tabId&&info.status==='complete'){cleanup();resolve(tab);}};
    function cleanup(){clearTimeout(timer);chrome.tabs.onUpdated.removeListener(listener);}
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then(tab=>{if(tab.status==='complete'){cleanup();resolve(tab);}}).catch(error=>{cleanup();reject(error);});
  });
}

async function runInTab(tabId,code,{allFrames=false}={}) {
  const results=await chrome.scripting.executeScript({
    target:{tabId,allFrames},
    world:'MAIN',
    func:async source=>{const fn=(0,eval)('('+source+')');return await fn();},
    args:[code]
  });
  return allFrames ? results.map(item=>item.result) : results[0]?.result;
}

async function runInFrames(tabId,code) {
  const results=await chrome.scripting.executeScript({
    target:{tabId,allFrames:true},
    world:'MAIN',
    func:async source=>{const fn=(0,eval)('('+source+')');return await fn();},
    args:[code]
  });
  return results.map(item=>({frameId:item.frameId,result:item.result}));
}

async function clickApplicationTarget(tabId) {
  const exactPhrase=`()=>{const text=value=>String(value||'').replace(/\\s+/g,' ').trim().toLowerCase();const roots=[document];for(let i=0;i<roots.length;i++)for(const node of roots[i].querySelectorAll('*'))if(node.shadowRoot)roots.push(node.shadowRoot);for(const root of roots)for(const node of root.querySelectorAll('a,button,input[type="button"],input[type="submit"],[role="button"],[role="link"]'))if(text(node.innerText||node.textContent||node.value||node.getAttribute('aria-label')||node.getAttribute('title')).includes('auf diese stelle bewerben')&&!node.disabled&&node.getAttribute('aria-disabled')!=='true'&&(node.offsetWidth||node.offsetHeight||node.getClientRects().length)){node.click();return true}return false}`;
  const exactFrames=await runInFrames(tabId,exactPhrase);
  if(exactFrames.some(item=>item.result)){await new Promise(resolve=>setTimeout(resolve,900));return {ok:true,text:'Auf diese Stelle bewerben',href:'',frameId:exactFrames.find(item=>item.result)?.frameId};}
  const scan=`()=>{const normal=value=>String(value||'').toLowerCase().normalize('NFKD').replace(/[\\u0300-\\u036f]/g,'').replace(/\\s+/g,' ').trim();const start=/\\b(?:apply|apply now|apply for this job|start application|jetzt bewerben|online bewerben|zur bewerbung|bewerben|bewirb dich|bewerbung starten|postuler|candidater|solliciteer|solicitar|candidati|candidatura|aplikuj|ansok)\\b/i;const final=/\\b(?:submit|send application|submit application|application abschicken|bewerbung absenden|bewerbung einreichen|jetzt verbindlich bewerben|envoyer (?:la )?candidature|invia(?:re)? (?:la )?candidatura|enviar (?:la )?(?:solicitud|candidatura))\\b/i;const visible=node=>Boolean(node&&(node.offsetWidth||node.offsetHeight||node.getClientRects().length));const roots=[document];for(let i=0;i<roots.length;i++)for(const node of roots[i].querySelectorAll('*'))if(node.shadowRoot)roots.push(node.shadowRoot);const controls=[];for(const root of roots){controls.push(...root.querySelectorAll('a,button,input[type="button"],input[type="submit"],[role="button"],[role="link"],[onclick],[data-href]'));controls.push(...[...root.querySelectorAll('*')].filter(node=>{const text=normal(node.innerText||node.textContent);return text.length>0&&text.length<=160&&node.children.length<=3&&start.test(text)}))}const candidates=[...new Set(controls)].map((node,index)=>{const text=normal(node.innerText||node.textContent||node.value||node.getAttribute('aria-label')||node.getAttribute('title')||node.getAttribute('data-testid')||node.getAttribute('name'));const href=normal(node.href||node.getAttribute('href')||node.getAttribute('data-href'));if(!visible(node)||node.disabled||node.getAttribute('aria-disabled')==='true'||!start.test(text)||final.test(text)||/mailto:|tel:/.test(href)||/privacy|datenschutz|terms|agb|impressum|unsubscribe|share|facebook|linkedin|twitter/.test(text+' '+href))return null;let score=80;if(/jetzt bewerben|bewirb dich|apply now|start application|bewerbung starten/.test(text))score+=35;if(/\\/(?:apply|application|bewerbung|career|jobs?)(?:[/?#]|$)/.test(href))score+=30;if(/^(?:jetzt bewerben|bewerben|apply|apply now)$/.test(text))score+=20;return{index,text,href,score}}).filter(Boolean).sort((a,b)=>b.score-a.score||a.text.length-b.text.length);return candidates[0]||null}`;
  const frames=await runInFrames(tabId,scan);
  const chosen=frames.filter(item=>item.result).sort((a,b)=>b.result.score-a.result.score||a.result.text.length-b.result.text.length)[0];
  if(!chosen) return {ok:false};
  const targetIndex=chosen.result.index;
  const click=`()=>{const normal=value=>String(value||'').toLowerCase().normalize('NFKD').replace(/[\\u0300-\\u036f]/g,'').replace(/\\s+/g,' ').trim();const start=/\\b(?:apply|apply now|apply for this job|start application|jetzt bewerben|online bewerben|zur bewerbung|bewerben|bewirb dich|bewerbung starten|postuler|candidater|solliciteer|solicitar|candidati|candidatura|aplikuj|ansok)\\b/i;const roots=[document];for(let i=0;i<roots.length;i++)for(const node of roots[i].querySelectorAll('*'))if(node.shadowRoot)roots.push(node.shadowRoot);const controls=[];for(const root of roots){controls.push(...root.querySelectorAll('a,button,input[type="button"],input[type="submit"],[role="button"],[role="link"],[onclick],[data-href]'));controls.push(...[...root.querySelectorAll('*')].filter(node=>{const text=normal(node.innerText||node.textContent);return text.length>0&&text.length<=160&&node.children.length<=3&&start.test(text)}))}const node=[...new Set(controls)][${targetIndex}];if(!node)return false;node.scrollIntoView({block:'center',inline:'center'});node.click();return true}`;
  const clicked=await chrome.scripting.executeScript({target:{tabId,frameIds:[chosen.frameId]},world:'MAIN',func:async source=>{const fn=(0,eval)('('+source+')');return await fn();},args:[click]});
  if(!clicked[0]?.result) throw new Error('The verified application control is no longer available');
  await new Promise(resolve=>setTimeout(resolve,900));
  return {ok:true,text:chosen.result.text,href:chosen.result.href,frameId:chosen.frameId};
}

async function clickAdvanceTarget(tabId) {
  const scan=`()=>{const advance=/\\b(?:next|continue|weiter|fortfahren|proceed|save and continue|speichern und weiter|lebenslauf hochladen|cv hochladen|resume upload|upload resume|upload cv|suivant|continuer|volgende|doorgaan|siguiente|continuar|avanti|prosegui|dalej)\\b/i;const final=/\\b(?:submit|send application|submit application|application abschicken|bewerbung absenden|bewerbung einreichen|jetzt verbindlich bewerben)\\b/i;const roots=[document];for(let i=0;i<roots.length;i++)for(const node of roots[i].querySelectorAll('*'))if(node.shadowRoot)roots.push(node.shadowRoot);const controls=[];for(const root of roots)controls.push(...root.querySelectorAll('button,input[type="button"],input[type="submit"],a[role="button"],[role="button"]'));const candidates=[...new Set(controls)].map((node,index)=>{const text=(node.innerText||node.textContent||node.value||node.getAttribute('aria-label')||node.getAttribute('title')||'').replace(/\\s+/g,' ').trim();return{index,text,matches:advance.test(text)&&!final.test(text),visible:Boolean(node.offsetWidth||node.offsetHeight||node.getClientRects().length),disabled:Boolean(node.disabled||node.getAttribute('aria-disabled')==='true')}}).filter(item=>item.matches&&item.visible&&!item.disabled).sort((a,b)=>a.text.length-b.text.length);return candidates[0]||null}`;
  const frames=await runInFrames(tabId,scan);
  const chosen=frames.filter(item=>item.result).sort((a,b)=>a.result.text.length-b.result.text.length)[0];
  if(!chosen) return {ok:false};
  const click=`()=>{const roots=[document];for(let i=0;i<roots.length;i++)for(const node of roots[i].querySelectorAll('*'))if(node.shadowRoot)roots.push(node.shadowRoot);const controls=[];for(const root of roots)controls.push(...root.querySelectorAll('button,input[type="button"],input[type="submit"],a[role="button"],[role="button"]'));const node=[...new Set(controls)][${chosen.result.index}];if(!node)return false;node.scrollIntoView({block:'center',inline:'center'});node.click();return true}`;
  const clicked=await chrome.scripting.executeScript({target:{tabId,frameIds:[chosen.frameId]},world:'MAIN',func:async source=>{const fn=(0,eval)('('+source+')');return await fn();},args:[click]});
  if(!clicked[0]?.result) throw new Error('The selected Next control is no longer available');
  await new Promise(resolve=>setTimeout(resolve,900));
  return {ok:true,text:chosen.result.text,frameId:chosen.frameId};
}

async function withDebugger(tabId,operation) {
  const target={tabId};
  await chrome.debugger.attach(target,'1.3');
  try { return await operation(target); }
  finally { await chrome.debugger.detach(target).catch(()=>{}); }
}

function nodeAttribute(node,name) {
  const attributes=node?.attributes||[];
  for(let index=0;index<attributes.length;index+=2) if(attributes[index]===name) return attributes[index+1];
  return '';
}

function findFileInputNode(root,label) {
  const pending=[root];
  while(pending.length) {
    const node=pending.shift();
    if(String(node?.nodeName||'').toUpperCase()==='INPUT'&&String(nodeAttribute(node,'type')).toLowerCase()==='file'&&nodeAttribute(node,'aria-label')===label) return node;
    for(const child of node?.children||[]) pending.push(child);
    for(const shadow of node?.shadowRoots||[]) pending.push(shadow);
    for(const pseudo of node?.pseudoElements||[]) pending.push(pseudo);
    if(node?.contentDocument) pending.push(node.contentDocument);
    if(node?.templateContent) pending.push(node.templateContent);
    if(node?.importedDocument) pending.push(node.importedDocument);
  }
  return null;
}

function replacementFileInputNode(root,payload={}) {
  const pending=[root],candidates=[];
  while(pending.length) {
    const node=pending.shift();
    if(String(node?.nodeName||'').toUpperCase()==='INPUT'&&String(nodeAttribute(node,'type')).toLowerCase()==='file') candidates.push(node);
    for(const child of node?.children||[]) pending.push(child);
    for(const shadow of node?.shadowRoots||[]) pending.push(shadow);
    if(node?.contentDocument) pending.push(node.contentDocument);
  }
  if(!candidates.length) return null;
  const kind=String((payload.kinds||[]).join(' ')).toLowerCase();
  const words=kind==='cv'?/cv|resume|lebenslauf/:kind==='letter'?/cover|letter|anschreiben|motivation/:/zeugnis|certificate|reference/;
  const semantic=candidates.filter(node=>words.test(['id','name','aria-label','title','data-testid'].map(name=>nodeAttribute(node,name)).join(' ').toLowerCase()));
  if(semantic.length===1) return semantic[0];
  const pdf=candidates.filter(node=>/pdf/i.test(nodeAttribute(node,'accept')));
  if(pdf.length===1) return pdf[0];
  return candidates.length===1?candidates[0]:null;
}

async function revealUploadTarget(tabId,kinds=[]) {
  const wanted=JSON.stringify(kinds);
  const scan=`()=>{const kinds=${wanted};const normal=value=>String(value||'').toLowerCase().normalize('NFKD').replace(/[\\u0300-\\u036f]/g,'').replace(/\\s+/g,' ').trim();const kind=kinds.join(' ').toLowerCase();const subject=kind==='cv'?/\\b(?:cv|resume|lebenslauf)\\b/i:kind==='letter'?/cover|letter|anschreiben|motivation/i:/zeugnis|certificate|reference/i;const action=/upload|hochladen|datei|document/i;const blocked=/submit|absenden|einreichen|apply now|jetzt bewerben|weiter|next|continue/i;const roots=[document];for(let i=0;i<roots.length;i++)for(const node of roots[i].querySelectorAll('*'))if(node.shadowRoot)roots.push(node.shadowRoot);const controls=[];for(const root of roots)controls.push(...root.querySelectorAll('button,input[type="button"],a,[role="button"],label[for]'));const candidates=[...new Set(controls)].map((node,index)=>{const text=normal(node.innerText||node.textContent||node.value||node.getAttribute('aria-label')||node.getAttribute('title'));if(!text||blocked.test(text)||!subject.test(text)||!action.test(text)||node.disabled||node.getAttribute('aria-disabled')==='true'||!(node.offsetWidth||node.offsetHeight||node.getClientRects().length))return null;return{index,text,score:150-text.length}}).filter(Boolean).sort((a,b)=>b.score-a.score);return candidates[0]||null}`;
  const frames=await runInFrames(tabId,scan),chosen=frames.filter(item=>item.result).sort((a,b)=>b.result.score-a.result.score)[0];
  if(!chosen) return false;
  const click=`()=>{const roots=[document];for(let i=0;i<roots.length;i++)for(const node of roots[i].querySelectorAll('*'))if(node.shadowRoot)roots.push(node.shadowRoot);const controls=[];for(const root of roots)controls.push(...root.querySelectorAll('button,input[type="button"],a,[role="button"],label[for]'));const node=[...new Set(controls)][${chosen.result.index}];if(!node)return false;node.scrollIntoView({block:'center',inline:'center'});node.click();return true}`;
  const clicked=await chrome.scripting.executeScript({target:{tabId,frameIds:[chosen.frameId]},world:'MAIN',func:async source=>{const fn=(0,eval)('('+source+')');return await fn();},args:[click]});
  if(!clicked[0]?.result) return false;
  await new Promise(resolve=>setTimeout(resolve,600));
  return true;
}

async function execute(command) {
  const {type,payload={}}=command;
  if(type==='ping') return {ok:true,version:chrome.runtime.getManifest().version};
  if(type==='tabs') {
    const tabs=await chrome.tabs.query({});
    return {tabs:tabs.filter(tab=>/^https?:|^about:blank/.test(tab.url||'')).map(tab=>({id:tab.id,title:tab.title,url:tab.url,active:tab.active,windowId:tab.windowId}))};
  }
  if(type==='newPage') {
    const tab=await chrome.tabs.create({url:payload.url,active:true});
    const loaded=await waitForTab(tab.id);
    await chrome.windows.update(loaded.windowId,{focused:true});
    return {id:loaded.id,title:loaded.title,url:loaded.url,active:true,windowId:loaded.windowId};
  }
  if(type==='selectPage') {
    const tab=await chrome.tabs.update(payload.tabId,{active:true});
    await chrome.windows.update(tab.windowId,{focused:true});
    return {ok:true};
  }
  if(type==='navigate') {
    await chrome.tabs.update(payload.tabId,{url:payload.url,active:true});
    const tab=await waitForTab(payload.tabId);
    return {id:tab.id,title:tab.title,url:tab.url,active:true,windowId:tab.windowId};
  }
  if(type==='evaluate') return runInTab(payload.tabId,payload.code);
  if(type==='evaluateFrames') return {frames:await runInFrames(payload.tabId,payload.code)};
  if(type==='clickApplication') return clickApplicationTarget(payload.tabId);
  if(type==='clickAdvance') return clickAdvanceTarget(payload.tabId);
  if(type==='snapshot') {
    const frameLabels=await runInTab(payload.tabId,`()=>{const collect=root=>{const found=[...root.querySelectorAll('[aria-label^="alex-"]')];for(const node of root.querySelectorAll('*'))if(node.shadowRoot)found.push(...collect(node.shadowRoot));return found};return collect(document).map(node=>node.getAttribute('aria-label')).filter(Boolean)}`,{allFrames:true});
    return {labels:[...new Set((frameLabels||[]).flat())]};
  }
  if(type==='click') {
    const label=JSON.stringify(payload.label);
    const code='()=>{const label='+label+';const find=root=>{for(const item of root.querySelectorAll("[aria-label]")){if(item.getAttribute("aria-label")===label)return item;if(item.shadowRoot){const nested=find(item.shadowRoot);if(nested)return nested}}return null};const node=find(document);if(!node)return false;node.click();return true}';
    const clicked=await runInTab(payload.tabId,code,{allFrames:true});
    if(!(clicked||[]).some(Boolean)) throw new Error('The selected page control is no longer available');
    await new Promise(resolve=>setTimeout(resolve,900));
    const current=await chrome.tabs.get(payload.tabId).catch(()=>null);
    if(current&&current.status==='loading') await waitForTab(payload.tabId,15000).catch(()=>{});
    return {ok:true};
  }
  if(type==='upload') {
    return withDebugger(payload.tabId,async target=>{
      const safe=String(payload.label).replace(/["\\]/g,'\\$&');
      await chrome.debugger.sendCommand(target,'DOM.enable');
      const searches=[];
      try {
        let nodeReference=null;
        for(let attempt=0;attempt<2;attempt++) {
          const document=await chrome.debugger.sendCommand(target,'DOM.getDocument',{depth:-1,pierce:true});
          const direct=findFileInputNode(document.root,String(payload.label))||replacementFileInputNode(document.root,payload);
          let nodeId=direct?.nodeId,backendNodeId=direct?.backendNodeId;
          if(!nodeId&&!backendNodeId) {
            const search=await chrome.debugger.sendCommand(target,'DOM.performSearch',{query:'[aria-label="'+safe+'"]',includeUserAgentShadowDOM:true});
            searches.push(search);
            if(search.resultCount) {
              const found=await chrome.debugger.sendCommand(target,'DOM.getSearchResults',{searchId:search.searchId,fromIndex:0,toIndex:1});
              nodeId=found.nodeIds?.[0];
            }
          }
          if(!nodeId&&!backendNodeId&&attempt===0&&await revealUploadTarget(payload.tabId,payload.kinds)) continue;
          if(!nodeId&&!backendNodeId) throw new Error('The PDF upload control did not expose an available file field');
          nodeReference=nodeId?{nodeId}:{backendNodeId};
          try { await chrome.debugger.sendCommand(target,'DOM.setFileInputFiles',{...nodeReference,files:payload.filePaths}); break; }
          catch(error) {
            if(attempt===1||!/No node|Cannot find context|Could not find node/i.test(error?.message||'')) throw error;
            nodeReference=null;
          }
        }
        let files=[];
        try {
          const resolved=await chrome.debugger.sendCommand(target,'DOM.resolveNode',nodeReference);
          const checked=await chrome.debugger.sendCommand(target,'Runtime.callFunctionOn',{objectId:resolved.object.objectId,functionDeclaration:'function(){return Array.from(this.files||[]).map(file=>file.name)}',returnByValue:true});
          files=checked.result?.value||[];
        } catch(error) {
          if(!/No node|Cannot find context|Could not find node/i.test(error?.message||'')) throw error;
          files=payload.filePaths.map(path=>String(path).split(/[\\/]/).pop());
        }
        if(files.length!==payload.filePaths.length) throw new Error('Chrome could not confirm the selected PDF upload');
        return {ok:true,files};
      } finally {
        for(const search of searches) if(search?.searchId) await chrome.debugger.sendCommand(target,'DOM.discardSearchResults',{searchId:search.searchId}).catch(()=>{});
        await chrome.debugger.sendCommand(target,'DOM.disable').catch(()=>{});
      }
    });
  }
  throw new Error('Unknown Alex Job command: '+type);
}

chrome.runtime.onMessage.addListener((message,_sender,sendResponse)=>{
  if(message?.type==='alex-job-retry-current') {
    startRetryFromPopup(message.payload).then(state=>sendResponse({ok:true,state})).catch(error=>sendResponse({ok:false,error:error?.message||String(error)}));
    return true;
  }
  if(message?.type==='alex-job-retry-status') {
    refreshRetryState().then(state=>sendResponse({ok:true,state})).catch(error=>sendResponse({ok:false,error:error?.message||String(error)}));
    return true;
  }
  if(message?.type!=='alex-job-command') return;
  const timeout=new Promise((_,reject)=>setTimeout(()=>reject(new Error('Chrome helper command timed out')),55000));
  Promise.race([execute(message.command),timeout]).then(sendResponse).catch(error=>sendResponse({__error:error?.message||String(error)}));
  return true;
});
