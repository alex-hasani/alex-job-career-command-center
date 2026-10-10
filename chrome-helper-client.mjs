import { sendChromeHelperCommand } from './chrome-helper-bridge.mjs';

function textResult(text,structuredContent) {
  return {content:[{type:'text',text}],structuredContent};
}

export function createChromeHelperClient(channel='default') {
  const send=(type,payload={},timeout=60000)=>sendChromeHelperCommand(type,payload,timeout,channel);
  async function start() {
    const result=await send('ping',{},5000);
    if(!result?.ok) throw new Error('The Alex Job Chrome helper did not answer');
    return true;
  }
  async function pages() {
    const result=await send('tabs',{},10000);
    return (result?.tabs||[]).map(tab=>({id:tab.id,title:tab.title||'',url:tab.url||'',selected:Boolean(tab.active)}));
  }
  async function newPage(url) {
    const tab=await send('newPage',{url},45000);
    return tab ? {id:tab.id,title:tab.title||'',url:tab.url||url,selected:true} : null;
  }
  async function evaluate(pageId,fn,{timeout=60000}={}) {
    return send('evaluate',{tabId:Number(pageId),code:String(fn)},timeout);
  }
  async function evaluateFrames(pageId,fn,{timeout=60000}={}) {
    const result=await send('evaluateFrames',{tabId:Number(pageId),code:String(fn)},timeout);
    return result?.frames||[];
  }
  async function tool(name,args={},timeout=60000) {
    if(name==='list_pages') {
      const list=await pages();
      return textResult(list.map(page=>page.id+': '+page.title+' ('+page.url+')'+(page.selected?' [selected]':'')).join('\n'),{pages:list});
    }
    if(name==='navigate_page') {
      const tab=await send('navigate',{tabId:Number(args.pageId),url:args.url},timeout);
      return textResult('Navigated '+(tab?.id||args.pageId));
    }
    if(name==='select_page') {
      await send('selectPage',{tabId:Number(args.pageId)},timeout);
      return textResult('Selected '+args.pageId);
    }
    if(name==='take_snapshot') {
      const result=await send('snapshot',{tabId:Number(args.pageId)},timeout);
      return textResult((result?.labels||[]).map(label=>'uid='+label+' '+label).join('\n'));
    }
    if(name==='click') {
      await send('click',{tabId:Number(args.pageId),label:String(args.uid||'')},timeout);
      return textResult('Clicked '+args.uid);
    }
    if(name==='click_application') {
      const result=await send('clickApplication',{tabId:Number(args.pageId)},timeout);
      return textResult(result?.ok?`Clicked application control: ${result.text||'Apply'}`:'No application control found',result);
    }
    if(name==='click_advance') {
      const result=await send('clickAdvance',{tabId:Number(args.pageId)},timeout);
      return textResult(result?.ok?`Clicked Next control: ${result.text||''}`:'No Next control found',result);
    }
    if(name==='upload_file') {
      const result=await send('upload',{tabId:Number(args.pageId),label:String(args.uid||''),filePaths:args.filePaths||[],kinds:args.kinds||[],identity:args.identity||{}},timeout);
      return textResult('Uploaded '+(result?.files?.length||0)+' file(s)',result);
    }
    throw new Error('Unsupported Chrome helper action: '+name);
  }
  async function close() {}
  return {start,pages,newPage,evaluate,evaluateFrames,tool,close,get connected(){return true;}};
}
