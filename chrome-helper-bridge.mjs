import { randomUUID } from 'node:crypto';

const channels=new Map();
function stateFor(channel='default') {
  const key=String(channel||'default');
  if(!channels.has(key)) channels.set(key,{queued:[],commandWaiters:[],resultWaiters:new Map(),lastSeenAt:0});
  return channels.get(key);
}
function touch(state) { state.lastSeenAt=Date.now(); }
// The extension holds each command poll open for up to 20 seconds. Keep the
// connection healthy across that intentional quiet interval.
function available(state) { return Date.now()-state.lastSeenAt<45000; }

export function chromeHelperStatus(channel='default') {
  const state=stateFor(channel);
  return { connected:available(state), lastSeenAt:state.lastSeenAt ? new Date(state.lastSeenAt).toISOString() : '' };
}

export function takeChromeHelperCommand(timeout=20000,channel='default') {
  const state=stateFor(channel);
  touch(state);
  if(state.queued.length) return Promise.resolve(state.queued.shift());
  return new Promise(resolve=>{
    const timer=setTimeout(()=>{
      const index=state.commandWaiters.findIndex(item=>item.resolve===resolve);
      if(index>=0) state.commandWaiters.splice(index,1);
      resolve(null);
    },timeout);
    timer.unref?.();
    state.commandWaiters.push({resolve,timer});
  });
}

export function completeChromeHelperCommand({id,result,error},channel='default') {
  const state=stateFor(channel);
  touch(state);
  const pending=state.resultWaiters.get(id);
  if(!pending) return false;
  clearTimeout(pending.timer);
  state.resultWaiters.delete(id);
  if(error) pending.reject(new Error(error));
  else if(result?.__error) pending.reject(new Error(result.__error));
  else pending.resolve(result);
  return true;
}

export function sendChromeHelperCommand(type,payload={},timeout=60000,channel='default') {
  const state=stateFor(channel);
  if(!available(state)) throw new Error('The Alex Job Chrome helper is not connected in the normal Chrome profile. Open chrome://extensions, enable Developer mode, choose Load unpacked, and select the exported helper folder once.');
  const command={id:randomUUID(),type,payload};
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{
      state.resultWaiters.delete(command.id);
      const queuedIndex=state.queued.findIndex(item=>item.id===command.id);
      if(queuedIndex>=0) state.queued.splice(queuedIndex,1);
      reject(new Error('Chrome helper did not complete '+type+' in time'));
    },timeout);
    timer.unref?.();
    state.resultWaiters.set(command.id,{resolve,reject,timer});
    const waiter=state.commandWaiters.shift();
    if(waiter) {
      clearTimeout(waiter.timer);
      waiter.resolve(command);
    } else state.queued.push(command);
  });
}
