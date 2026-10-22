import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';

const documentName = /^[A-Za-z0-9][A-Za-z0-9_.-]*\.(?:pdf|docx)$/i;
const availabilityOrder = { available:0, not_checked:1, unavailable:2 };

export function teachingPaths(workspace) {
  const project = resolve(workspace);
  return {
    config:join(project, 'Teaching_Job_Search', 'teaching-search-config.json'),
    documents:join(project, 'Documents', 'Teaching'),
    state:join(project, 'Teaching_Job_Search', 'state')
  };
}
export function sortTeachingSources(sources) {
  return [...sources].sort((left,right) =>
    (availabilityOrder[left.availability] ?? 1) - (availabilityOrder[right.availability] ?? 1)
    || String(left.name).localeCompare(String(right.name), 'en', { sensitivity:'base' })
  );
}

export async function teachingOverview(workspace) {
  const paths=teachingPaths(workspace);
  const configText=await readFile(paths.config, 'utf8').catch(error => error.code==='ENOENT' ? '{}' : Promise.reject(error));
  const config=JSON.parse(configText);
  const officialSources=(Array.isArray(config.officialSources)?config.officialSources:[])
    .filter(source => source && typeof source.name==='string' && /^https:\/\//i.test(source.url||''))
    .map(source => ({ name:source.name, url:source.url, type:source.type||'employer-careers', availability:source.availability||'not_checked' }));
  const names=await readdir(paths.documents).catch(error => error.code==='ENOENT' ? [] : Promise.reject(error));
  const documents=await Promise.all(names.filter(name => documentName.test(name) && /(?:^|_)Teaching_(?:CV|Cover_Letter)_/i.test(name)).map(async name => {
    const item=await stat(join(paths.documents,name));
    return item.isFile() ? {name,format:name.toLowerCase().endsWith('.pdf')?'PDF':'Word',bytes:item.size,url:`/api/user-space/teaching-documents/${encodeURIComponent(name)}`} : null;
  }));
  return {
    track:'teaching',
    targetRegion:config.targetRegion||'',
    roleFamilies:Array.isArray(config.roleFamilies)?config.roleFamilies:[],
    keywords:Array.isArray(config.keywords)?config.keywords:[],
    sources:sortTeachingSources(officialSources),
    documents:documents.filter(Boolean).sort((a,b)=>a.name.localeCompare(b.name,'en')),
    liveSearchReady:false
  };
}

export async function teachingDocument(workspace, requestedName) {
  const name=String(requestedName||'');
  if (!documentName.test(name) || basename(name)!==name || !/(?:^|_)Teaching_(?:CV|Cover_Letter)_/i.test(name)) return null;
  const root=teachingPaths(workspace).documents;
  const path=resolve(root,name);
  if (!path.startsWith(resolve(root)+sep)) return null;
  try {
    const file=await readFile(path);
    return {name,contentType:name.toLowerCase().endsWith('.pdf')?'application/pdf':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',file};
  } catch (error) {
    if(error.code==='ENOENT') return null;
    throw error;
  }
}
