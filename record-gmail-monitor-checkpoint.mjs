import { openJobDatabase } from './job-database.mjs';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';

const command = process.argv[2] === 'read' ? 'read' : 'write';
const databasePath = resolve(command === 'read' ? (process.argv[3] || '../State/job_search.sqlite') : (process.argv[2] || '../State/job_search.sqlite'));

if (command === 'read') {
  const db = new DatabaseSync(databasePath, { readOnly:true });
  try {
    const row = db.prepare("SELECT value,updated_at AS updatedAt FROM metadata WHERE key='last_email_reconciliation'").get();
    const checkpoint = row ? { ...JSON.parse(row.value), updatedAt:row.updatedAt } : null;
    console.log(JSON.stringify({ checkpoint }, null, 2));
  } finally {
    db.close();
  }
  process.exit(0);
}

const reviewedMessages = Number(process.argv[3] || 0);
const genuineChanges = Number(process.argv[4] || 0);
const db = openJobDatabase(databasePath);

const checkpoint = {
  at: new Date().toISOString(),
  evidenceCount: genuineChanges,
  source: 'Gmail status monitor',
  reviewedMessages,
  genuineChanges
};

db.setMetadata('last_email_reconciliation', JSON.stringify(checkpoint));
const requestPath = resolve(databasePath, '..', 'gmail_reconciliation_request.json');
try {
  const request = JSON.parse(await readFile(requestPath, 'utf8'));
  await writeFile(requestPath, JSON.stringify({ ...request, status:'completed', completedAt:checkpoint.at, reviewedMessages, genuineChanges }, null, 2), 'utf8');
  db.setMetadata('pending_email_reconciliation', JSON.stringify({ ...request, status:'completed', completedAt:checkpoint.at, reviewedMessages, genuineChanges }));
} catch {}
console.log(JSON.stringify(checkpoint, null, 2));
db.db.close();
