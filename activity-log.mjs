import { appendFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const MAX_BYTES = 1024 * 1024;
const MAX_EVENTS = 1000;
const clean = value => String(value || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500);

export function safeActivityEvent(input = {}) {
  return {
    at: new Date().toISOString(),
    level: ['info','warning','error'].includes(input.level) ? input.level : 'info',
    action: clean(input.action || 'app.event').slice(0, 120),
    result: clean(input.result || 'completed').slice(0, 80),
    jobId: clean(input.jobId).slice(0, 160),
    detail: clean(input.detail),
  };
}

async function compact(path) {
  try {
    if ((await stat(path)).size <= MAX_BYTES) return;
    const lines = (await readFile(path, 'utf8')).split(/\r?\n/).filter(Boolean).slice(-MAX_EVENTS);
    await writeFile(path, lines.length ? `${lines.join('\n')}\n` : '', 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

export async function appendActivityEvent(path, input) {
  const event = safeActivityEvent(input);
  await mkdir(dirname(path), { recursive:true });
  await compact(path);
  await appendFile(path, `${JSON.stringify(event)}\n`, 'utf8');
  return event;
}

export async function readActivityEvents(path, limit = 120) {
  try {
    const lines = (await readFile(path, 'utf8')).split(/\r?\n/).filter(Boolean).slice(-Math.min(200, Math.max(1, Number(limit) || 120)));
    return lines.flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } }).reverse();
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}