import { spawn } from 'node:child_process';

const MCP_PACKAGE='chrome-devtools-mcp@1.10.1';
const CONNECT_TIMEOUT_MS=120000;

function resultText(result) {
  return (result?.content||[]).filter(item=>item?.type==='text').map(item=>item.text||'').join('\n');
}

function evaluationValue(result) {
  const text=resultText(result);
  const match=text.match(/```json\s*([\s\S]*?)\s*```/i);
  if(!match) throw new Error(text||'Chrome returned no script result');
  return JSON.parse(match[1]);
}

function uploadUid(snapshotResult,label) {
  const escaped=label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const line=resultText(snapshotResult).split(/\r?\n/).find(value=>new RegExp(`uid=([^ ]+).*${escaped}`,'i').test(value));
  return line?.match(/uid=([^ ]+)/)?.[1]||'';
}

function resultPages(result) {
  if(Array.isArray(result?.structuredContent?.pages)) return result.structuredContent.pages;
  const pages=[];
  for(const line of resultText(result).split(/\r?\n/)) {
    const match=line.match(/^(\d+):\s+(.+?)(\s+\[selected\])?$/); if(!match) continue;
    const label=match[2],urlMatch=label.match(/\((https?:\/\/[^)]+|about:[^)]+)\)\s*$/i);
    pages.push({id:Number(match[1]),title:urlMatch?label.slice(0,urlMatch.index).trim():label,url:urlMatch?.[1]||label.trim(),selected:Boolean(match[3])});
  }
  return pages;
}

export function chromeDevtoolsInternals() { return { resultText,evaluationValue,uploadUid,resultPages }; }

export function createChromeDevtoolsClient({ cwd=process.cwd(), connectTimeout=CONNECT_TIMEOUT_MS }={}) {
  let child=null,buffer='',nextId=1,initializing=null,closed=false;
  const pending=new Map();

  function rejectPending(error) {
    for(const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
    pending.clear();
  }

  function write(message) {
    if(!child?.stdin?.writable) throw new Error('Chrome agent bridge is not running');
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  function request(method,params={},timeout=connectTimeout) {
    const id=nextId++;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{ pending.delete(id); reject(new Error(method==='tools/call'?'Chrome did not approve or complete the browser action in time':'Chrome agent bridge timed out')); },timeout);
      timer.unref?.(); pending.set(id,{resolve,reject,timer});
      try { write({jsonrpc:'2.0',id,method,params}); } catch(error) { clearTimeout(timer); pending.delete(id); reject(error); }
    });
  }

  async function start() {
    if(initializing) return initializing;
    closed=false;
    initializing=(async()=>{
      const command=`npx --yes ${MCP_PACKAGE} --autoConnect --no-usage-statistics --no-performance-crux`;
      child=spawn(process.env.ComSpec||'cmd.exe',['/d','/s','/c',command],{cwd,stdio:['pipe','pipe','pipe'],windowsHide:true});
      child.stdout.setEncoding('utf8');
      child.stdout.on('data',chunk=>{
        buffer+=chunk;
        for(;;) {
          const newline=buffer.indexOf('\n'); if(newline<0) break;
          const line=buffer.slice(0,newline).trim(); buffer=buffer.slice(newline+1); if(!line) continue;
          let message; try { message=JSON.parse(line); } catch { continue; }
          const entry=pending.get(message.id); if(!entry) continue;
          clearTimeout(entry.timer); pending.delete(message.id);
          if(message.error) entry.reject(new Error(message.error.message||'Chrome agent bridge request failed')); else entry.resolve(message.result);
        }
      });
      let stderr='';
      child.stderr.setEncoding('utf8');
      child.stderr.on('data',chunk=>{ stderr=`${stderr}${chunk}`.slice(-4000); });
      child.once('error',error=>{ rejectPending(error); initializing=null; child=null; });
      child.once('exit',code=>{ const error=new Error(stderr.trim()||`Chrome agent bridge stopped (${code??'unknown'})`); rejectPending(error); initializing=null; child=null; });
      await request('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'Alex Job website application agent',version:'1.0.0'}});
      write({jsonrpc:'2.0',method:'notifications/initialized',params:{}});
      await request('tools/list',{},30000);
      return true;
    })().catch(error=>{ initializing=null; if(child&&!child.killed) child.kill(); child=null; throw error; });
    return initializing;
  }

  async function tool(name,args={},timeout=connectTimeout) {
    await start();
    const result=await request('tools/call',{name,arguments:args},timeout);
    if(result?.isError) throw new Error(resultText(result)||`${name} failed`);
    return result;
  }

  async function pages() { return resultPages(await tool('list_pages')); }
  async function newPage(url) {
    let list=[];
    try { list=resultPages(await tool('new_page',{url,background:false,timeout:45000})); }
    catch(error) {
      if(!/navigation timeout/i.test(error.message)) throw error;
      list=await pages();
    }
    return list.find(page=>page.selected)||list.at(-1)||null;
  }
  async function evaluate(pageId,fn,{waitForStableDom=false,timeout=60000}={}) { return evaluationValue(await tool('evaluate_script',{pageId,function:fn,waitForStableDom},timeout)); }
  async function close() {
    closed=true; initializing=null; buffer='';
    if(child&&!child.killed) child.kill(); child=null;
    rejectPending(new Error('Chrome agent bridge closed'));
  }
  return { start,tool,pages,newPage,evaluate,close,get connected(){return Boolean(child&&!child.killed&&initializing&&!closed);} };
}


