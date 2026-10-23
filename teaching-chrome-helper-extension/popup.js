import { helperConfig } from './profile-config.js';
const button=document.querySelector('#retry');
const status=document.querySelector('#status');
document.querySelector('#profile').textContent=`Profile: ${helperConfig.displayName||helperConfig.username||'Default'}`;
const activeStatuses=new Set(['starting','opening','scanning_advert','preparing_files','navigating_to_application','filling_form','retrying']);

function show(message,error=false) {
  status.textContent=message;
  status.classList.toggle('error',error);
}

function render(state) {
  const active=Boolean(state&&activeStatuses.has(state.status));
  button.disabled=active;
  button.textContent=active?'AI application is running…':'AI Try / Retry this page';
  if(state?.message) show(active?`${state.message} You may close this popup; the action will continue.`:state.message,state.status==='failed');
  else show('Ready.');
}

async function request(type,payload) {
  const result=await chrome.runtime.sendMessage({type,payload});
  if(!result?.ok) throw new Error(result?.error||'The Chrome helper did not respond.');
  return result.state||null;
}

async function refresh() {
  try { render(await request('alex-job-retry-status')); }
  catch(error) { show(error?.message||String(error),true); button.disabled=false; }
}

button.addEventListener('click',async()=>{
  button.disabled=true;
  show('Starting a fresh scan, fill and PDF upload…');
  try {
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    if(!tab?.id||!/^https?:\/\//i.test(tab.url||'')) throw new Error('Open the exact job application page in this Chrome tab first.');
    render(await request('alex-job-retry-current',{tabId:tab.id,url:tab.url,title:tab.title||''}));
  } catch(error) {
    show(error?.message||String(error),true);
    button.disabled=false;
  }
});

void refresh();
setInterval(()=>void refresh(),1500);
