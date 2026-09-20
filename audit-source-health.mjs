import { writeFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const api = process.argv[2] || 'http://127.0.0.1:8787/api/jobs';
const outputPath = resolve(root, 'source-health.json');
const timeoutMs = 8000;
const concurrency = 12;

async function check(source) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(source.url, {
      method:'GET', redirect:'follow', signal:controller.signal,
      headers:{ 'user-agent':'Mozilla/5.0 Career Source Health Check/1.0', accept:'text/html,application/xhtml+xml' }
    });
    const status = response.status;
    const classification = response.ok ? 'available' : [401, 403, 406, 407, 429].includes(status) ? 'access_restricted' : 'unavailable';
    await response.body?.cancel();
    return { name:source.name, url:source.url, finalUrl:response.url, httpStatus:status, classification, latencyMs:Date.now()-started, checkedAt:new Date().toISOString() };
  } catch (error) {
    return { name:source.name, url:source.url, httpStatus:0, classification:'unavailable', message:error.name === 'AbortError' ? 'timeout' : error.message, latencyMs:Date.now()-started, checkedAt:new Date().toISOString() };
  } finally { clearTimeout(timer); }
}

const directory = await fetch(api).then(response => {
  if (!response.ok) throw new Error(`Dashboard API returned ${response.status}`);
  return response.json();
});
const queue = [...(directory.directSources || [])];
const results = [];
async function worker() {
  while (queue.length) results.push(await check(queue.shift()));
}
await Promise.all(Array.from({ length:Math.min(concurrency, queue.length) }, worker));
results.sort((a, b) => a.classification.localeCompare(b.classification) || a.name.localeCompare(b.name));
const summary = results.reduce((counts, source) => ({ ...counts, [source.classification]:(counts[source.classification] || 0) + 1 }), {});
const report = { checkedAt:new Date().toISOString(), total:results.length, summary, sources:results };
const temporary = `${outputPath}.tmp`;
await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
await rename(temporary, outputPath);
console.log(JSON.stringify({ outputPath, total:results.length, summary }, null, 2));
