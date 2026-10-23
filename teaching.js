const $=selector=>document.querySelector(selector);

function item(label,detail,action) {
  const row=document.createElement('div');row.className='item';
  const text=document.createElement('div');
  const title=document.createElement('strong');title.textContent=label;
  const small=document.createElement('small');small.textContent=detail;
  text.append(title,small);row.append(text,action);
  return row;
}

async function downloadDocument(documentInfo,button) {
  button.disabled=true;
  try {
    const response=await fetch(documentInfo.url,{credentials:'same-origin'});
    if(!response.ok) throw new Error('Download could not be started.');
    const blob=await response.blob();
    const url=URL.createObjectURL(blob);
    const anchor=document.createElement('a');anchor.href=url;anchor.download=documentInfo.name;
    document.body.append(anchor);anchor.click();anchor.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
  } catch(error) {
    $('#loadStatus').textContent=error.message;$('#loadStatus').classList.add('error');
  } finally {button.disabled=false;}
}

async function load() {
  const response=await fetch('/api/user-space/teaching-overview',{credentials:'same-origin'});
  if(response.status===401){location.assign('/');return;}
  if(!response.ok) throw new Error('Teaching workspace could not be loaded.');
  const data=await response.json();
  $('#region').textContent=data.targetRegion?`Starting region: ${data.targetRegion}`:'';
  const documents=$('#documents');documents.replaceChildren();
  for(const documentInfo of data.documents||[]) {
    const button=document.createElement('button');button.type='button';button.textContent='Download';
    button.addEventListener('click',()=>downloadDocument(documentInfo,button));
    documents.append(item(documentInfo.name,`${documentInfo.format} · ${Math.ceil(documentInfo.bytes/1024)} KB`,button));
  }
  if(!documents.childElementCount) documents.textContent='No Teaching documents are available yet.';
  const sources=$('#sources');sources.replaceChildren();
  for(const source of data.sources||[]) {
    const link=document.createElement('a');link.href=source.url;link.target='_blank';link.rel='noopener noreferrer';link.textContent='Open source';
    const kind=source.type==='shared-source'?'General source · ':'Teaching source · ';
    sources.append(item(source.name,kind+(source.availability==='available'?'Available':'Availability not checked'),link));
  }
  if(!sources.childElementCount) sources.textContent='No Teaching sources are configured yet.';
  $('#loadStatus').textContent=`${data.documents?.length||0} documents · ${data.sources?.length||0} Teaching sources`;
}

load().catch(error=>{$('#loadStatus').textContent=error.message;$('#loadStatus').classList.add('error');});
