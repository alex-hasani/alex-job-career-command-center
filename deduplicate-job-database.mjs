import { openJobDatabase } from './job-database.mjs';

const databasePath = process.argv[2];
if (!databasePath) throw new Error('Database path is required');

const jobDb = openJobDatabase(databasePath);
try {
  const before = jobDb.stats();
  const result = jobDb.deduplicateJobs();
  const after = jobDb.stats();
  console.log(JSON.stringify({ ok:true, ...result, before:before.total, after:after.total }));
} finally {
  jobDb.db.close();
}
