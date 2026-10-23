import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { backupTeachingDatabase } from './backup-teaching-database.mjs';
import { openJobDatabase } from './job-database.mjs';
import { teachingPaths } from './teaching-space.mjs';

test('Teaching database gets an independent recoverable snapshot without touching IT state',async()=>{
  const workspace=await mkdtemp(join(tmpdir(),'teaching-backup-'));
  try {
    const db=openJobDatabase(teachingPaths(workspace).database);
    db.setMetadata('backup_test','teaching');
    db.db.close();
    const now=new Date();
    const first=await backupTeachingDatabase(workspace,now);
    assert.equal(first.ok,true);
    const snapshot=new DatabaseSync(join(first.backupRoot,first.sqlite),{readOnly:true});
    assert.equal(snapshot.prepare("SELECT value FROM metadata WHERE key='backup_test'").get().value,'teaching');
    snapshot.close();
    assert.equal((await backupTeachingDatabase(workspace,now)).skipped,true);
    assert.equal((await readdir(join(workspace,'State')).catch(error=>error.code==='ENOENT'?[]:Promise.reject(error))).length,0);
  } finally {await rm(workspace,{recursive:true,force:true});}
});
