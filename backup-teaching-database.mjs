import { DatabaseSync } from 'node:sqlite';
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { teachingPaths } from './teaching-space.mjs';

const intervalMs=3*60*60*1000;

export async function backupTeachingDatabase(workspace, now=new Date()) {
  const paths=teachingPaths(workspace);
  const backupRoot=join(resolve(workspace),'Backups','Teaching_Database');
  await mkdir(backupRoot,{recursive:true});
  const existing=(await readdir(backupRoot)).filter(name=>/^teaching-\d{4}-\d{2}-\d{2}T.*\.sqlite$/.test(name));
  const latest=existing.length ? Math.max(...await Promise.all(existing.map(async name=>(await stat(join(backupRoot,name))).mtimeMs))) : 0;
  if(now.getTime()-latest<intervalMs) return {ok:true,skipped:true,reason:'backup-not-due',backupRoot};
  const stamp=now.toISOString().replace(/[:.]/g,'-');
  const fileName=`teaching-${stamp}.sqlite`;
  const finalPath=join(backupRoot,fileName);
  const temporaryPath=join(backupRoot,`.${fileName}.${process.pid}.tmp`);
  const db=new DatabaseSync(paths.database,{readOnly:true});
  try {
    db.exec(`VACUUM INTO '${temporaryPath.replaceAll("'","''")}'`);
  } finally {db.close();}
  try {await rename(temporaryPath,finalPath);} finally {await rm(temporaryPath,{force:true});}
  const manifest={createdAt:now.toISOString(),sqlite:basename(finalPath),track:'teaching',schedule:'every 3 hours'};
  await writeFile(join(backupRoot,`backup-${stamp}.json`),`${JSON.stringify(manifest,null,2)}\n`,{encoding:'utf8',flag:'wx'});
  return {ok:true,...manifest,backupRoot};
}

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try {console.log(JSON.stringify(await backupTeachingDatabase(process.argv[2] || '..')));}
  catch(error) {console.error(error.message);process.exitCode=1;}
}
