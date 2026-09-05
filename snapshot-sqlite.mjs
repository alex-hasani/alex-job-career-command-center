import { DatabaseSync, backup } from 'node:sqlite';

const [, , source, destination] = process.argv;
if (!source || !destination) throw new Error('Usage: node snapshot-sqlite.mjs <source> <destination>');

const sourceDatabase = new DatabaseSync(source, { readOnly:true });
try {
  await backup(sourceDatabase, destination);
} finally {
  sourceDatabase.close();
}

const snapshot = new DatabaseSync(destination, { readOnly:true });
try {
  if (snapshot.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') {
    throw new Error('SQLite backup integrity check failed');
  }
} finally {
  snapshot.close();
}
