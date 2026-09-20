import { DatabaseSync } from 'node:sqlite';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

const workspace = resolve(process.argv[2] || '..');
const sqlitePath = join(workspace, 'State', 'job_search.sqlite');
const statePath = join(workspace, 'State', 'cv_command_center_state.json');
const backupRoot = join(workspace, 'Backups', 'Database');
const createdAt = new Date();
const stamp = createdAt.toISOString().replace(/[:.]/g, '-');
const sqliteBackup = join(backupRoot, `job_search-${stamp}.sqlite`);
const stateBackup = join(backupRoot, `cv_command_center_state-${stamp}.json`);

await mkdir(backupRoot, { recursive:true });
const db = new DatabaseSync(sqlitePath, { readOnly:true });
try {
  const escaped = sqliteBackup.replaceAll("'", "''");
  db.exec(`VACUUM INTO '${escaped}'`);
} finally {
  db.close();
}
await copyFile(statePath, stateBackup);
const manifest = {
  createdAt:createdAt.toISOString(),
  sqlite:basename(sqliteBackup),
  careerState:basename(stateBackup),
  schedule:'every 3 hours'
};
await writeFile(join(backupRoot, `backup-${stamp}.json`), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok:true, ...manifest, backupRoot }));
