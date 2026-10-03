import { helperConfig } from './profile-config.js';
const base='http://127.0.0.1:8787';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const authHeaders=()=>helperConfig.publicId?{'x-alex-job-extension-id':helperConfig.publicId,'x-alex-job-extension-token':helperConfig.token}:{};

async function post(path,body) {
  return fetch(base+path,{method:'POST',headers:{'content-type':'application/json',...authHeaders()},body:JSON.stringify(body)});
}

async function loop() {
  for(;;) {
    try {
      const response=await fetch(base+'/api/browser-helper/next',{cache:'no-store',headers:authHeaders()});
      if(response.status===204) continue;
      if(!response.ok) throw new Error('Helper command HTTP '+response.status);
      const command=await response.json();
      let result=null,error='';
      try { result=await chrome.runtime.sendMessage({type:'alex-job-command',command}); }
      catch(cause) { error=cause?.message||String(cause); }
      await post('/api/browser-helper/result',{id:command.id,result,error});
    } catch {
      await wait(1000);
    }
  }
}
loop();
