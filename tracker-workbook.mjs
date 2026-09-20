import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, parse } from 'node:path';
import { tmpdir } from 'node:os';

const [command, trackerPath, sheetName, rowText, value = ''] = process.argv.slice(2);
if (!command || !trackerPath) throw new Error('Usage: tracker-workbook.mjs <inspect|ensure-comment-column|update-status|update-comment|sync-database> <tracker.xlsx> [sheet|snapshot.json] [row] [value]');

const statuses = ['Not recorded','Stashed','Preparing','Applied','Interviewing','Offer','Rejected','Withdrawn','Case Closed'];
const commentColumn = 'AB';
const commentHeader = 'Application notes';
// The artifact engine creates inspection sidecars beside the file it opens.
// Work from an OS-temp copy so OneDrive never sees or locks *.inspect.ndjson.
const workspaceTemp = await mkdtemp(join(tmpdir(), 'alex-job-workbook-'));
const workingCopy = join(workspaceTemp, 'tracker.xlsx');
await copyFile(trackerPath, workingCopy);
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(workingCopy));

function normaliseCellText(input) {
  return String(input ?? '').replace(/\r\n?/g, '\n').normalize('NFC');
}

function headerRow(sheet) {
  const rows = sheet.getUsedRange(true)?.values || [];
  const index = rows.slice(0, 20).findIndex(row => {
    const labels = row.map(cell => String(cell || '').trim().toLowerCase());
    return labels.includes('application status') && (labels.includes('role') || labels.includes('position'));
  });
  if (index < 0) throw new Error(`Could not find the tracker header in ${sheet.name}`);
  return index + 1;
}

function ensureCommentColumn(sheet) {
  const header = headerRow(sheet);
  const usedRows = Math.max(sheet.getUsedRange(true)?.values?.length || header, header + 1);
  const headerTarget = sheet.getRange(`${commentColumn}${header}`);
  if (String(headerTarget.values?.[0]?.[0] || '').trim() !== commentHeader) {
    headerTarget.copyFrom(sheet.getRange(`AA${header}`), 'all');
    headerTarget.values = [[commentHeader]];
  }
  headerTarget.format = {
    fill:'#0F6B8F',
    font:{ bold:true, color:'#FFFFFF', fontSize:9, typeface:'Carlito' },
    wrapText:true,
    verticalAlignment:'center'
  };
  const firstDataRow = header + 1;
  const dataRange = sheet.getRange(`${commentColumn}${firstDataRow}:${commentColumn}${usedRows}`);
  dataRange.format.wrapText = true;
  dataRange.format.columnWidth = 42;
  dataRange.format.verticalAlignment = 'top';
  return { header, usedRows };
}

async function saveWorkbook(backupLabel) {
  const parsed = parse(trackerPath);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = join(parsed.dir, 'Backups');
  const backupPath = join(backupDir, `${parsed.name}-${backupLabel}-${stamp}${parsed.ext}`);
  const temporaryPath = join(workspaceTemp, `${parsed.name}.writing${parsed.ext}`);
  await mkdir(backupDir, { recursive:true });
  await copyFile(trackerPath, backupPath);
  try {
    const output = await SpreadsheetFile.exportXlsx(workbook);
    await output.save(temporaryPath);
    await copyFile(temporaryPath, trackerPath);
  } finally {
    await rm(temporaryPath, { force:true });
  }
  return backupPath;
}

if (command === 'inspect') {
  const overview = await workbook.inspect({
    kind:'workbook,sheet,table',
    maxChars:12000,
    tableMaxRows:8,
    tableMaxCols:30,
    tableMaxCellChars:100
  });
  const outputDir = join(dirname(trackerPath), 'Logs', 'tracker-previews');
  await mkdir(outputDir, { recursive:true });
  const previews = [];
  for (const sheet of workbook.worksheets.items) {
    const previewRange = sheet.name === 'Source Coverage' ? 'A1:E20' : sheet.name === 'Job Database' ? 'A1:J18' : 'A1:H18';
    const preview = await workbook.render({ sheetName:sheet.name, range:previewRange, scale:1.1, format:'png' });
    const previewPath = join(outputDir, `${sheet.name.replace(/[^a-z0-9_-]+/gi, '-')}.png`);
    await writeFile(previewPath, new Uint8Array(await preview.arrayBuffer()));
    previews.push(previewPath);
    if (sheet.name === 'Job Database') {
      const lifecyclePreview = await workbook.render({ sheetName:sheet.name, range:'V1:X18', scale:1.35, format:'png' });
      const lifecyclePreviewPath = join(outputDir, 'Job-Database-application-lifecycle.png');
      await writeFile(lifecyclePreviewPath, new Uint8Array(await lifecyclePreview.arrayBuffer()));
      previews.push(lifecyclePreviewPath);
      const assessmentPreview = await workbook.render({ sheetName:sheet.name, range:'Y1:AC12', scale:1.15, format:'png' });
      const assessmentPreviewPath = join(outputDir, 'Job-Database-resume-assessment.png');
      await writeFile(assessmentPreviewPath, new Uint8Array(await assessmentPreview.arrayBuffer()));
      previews.push(assessmentPreviewPath);
    }
    if (/shortlist|english/i.test(sheet.name)) {
      const notesPreview = await workbook.render({ sheetName:sheet.name, range:'Y1:AB18', scale:1.4, format:'png' });
      const notesPreviewPath = join(outputDir, `${sheet.name.replace(/[^a-z0-9_-]+/gi, '-')}-application-notes.png`);
      await writeFile(notesPreviewPath, new Uint8Array(await notesPreview.arrayBuffer()));
      previews.push(notesPreviewPath);
    }
  }
  const notesRanges = {};
  const notesStyles = {};
  for (const sheet of workbook.worksheets.items) {
    if (!/shortlist|english/i.test(sheet.name)) continue;
    const check = await workbook.inspect({ kind:'region', sheetId:sheet.name, range:'Y1:AB10', maxChars:4000 });
    notesRanges[sheet.name] = check.ndjson;
    const styles = await workbook.inspect({ kind:'computedStyle', sheetId:sheet.name, range:'AA4:AB5', maxChars:4000 });
    notesStyles[sheet.name] = styles.ndjson;
  }
  const formulaErrors = await workbook.inspect({
    kind:'match',
    searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A',
    options:{ useRegex:true, maxResults:300 },
    summary:'final formula error scan'
  });
  console.log(JSON.stringify({ overview:overview.ndjson, notesRanges, notesStyles, formulaErrors:formulaErrors.ndjson, previews }, null, 2));
} else if (command === 'ensure-comment-column') {
  const updatedSheets = [];
  for (const sheet of workbook.worksheets.items) {
    if (!/shortlist|english/i.test(sheet.name)) continue;
    const result = ensureCommentColumn(sheet);
    updatedSheets.push({ sheet:sheet.name, ...result });
  }
  if (!updatedSheets.length) throw new Error('No shortlist sheets were found');
  const backupPath = await saveWorkbook('before-application-notes');
  const verified = await SpreadsheetFile.importXlsx(await FileBlob.load(trackerPath));
  for (const item of updatedSheets) {
    const saved = verified.worksheets.getItem(item.sheet).getRange(`${commentColumn}${item.header}`).values?.[0]?.[0];
    if (saved !== commentHeader) throw new Error(`Workbook verification failed for ${item.sheet}`);
  }
  console.log(JSON.stringify({ ok:true, updatedSheets, backupPath }));
} else if (command === 'sync-database') {
  const snapshot = JSON.parse(await readFile(sheetName, 'utf8'));
  const jobs = Array.isArray(snapshot.jobs) ? snapshot.jobs : [];
  for (const job of jobs.filter(item => item.origin === 'agent' && item.trackerSheet && item.trackerRow)) {
    const targetSheet = workbook.worksheets.getItem(job.trackerSheet);
    ensureCommentColumn(targetSheet);
    targetSheet.getRange(`C${job.trackerRow}`).values = [[job.applicationStatus || 'Not recorded']];
    targetSheet.getRange(`${commentColumn}${job.trackerRow}`).values = [[normaliseCellText(job.applicationComment)]];
  }

  const databaseSheet = workbook.worksheets.getOrAdd('Job Database');
  for (const table of databaseSheet.tables.items) table.delete();
  databaseSheet.deleteAllDrawings();
  const oldRange = databaseSheet.getUsedRange();
  if (oldRange) oldRange.clear({ applyTo:'all' });
  const headers = ['Job ID','Active','Availability','Application status','Application notes','Match %','Decision','Role','Company','Location','Work type','Language','Salary','Primary source','All sources','Apply URL','Posted','Last seen','Last verified','Tracker reference','Database updated','Applied at','Status changed at','Status history','Resume verdict','Resume strengths','Resume gaps','Learning plan','CV / application angle'];
  const rows = jobs.map(job => [
    job.id || '', job.active !== false, job.availabilityStatus || 'active', job.applicationStatus || 'Not recorded', normaliseCellText(job.applicationComment),
    Number(job.match) || 0, job.decision || '', job.title || '', job.company || '', job.location || '', job.workType || '', job.rawLanguage || '', job.salaryText || '',
    job.source || '', (job.sources || [job.source]).filter(Boolean).join(' | '), job.url || '', job.posted || '', job.lastSeenAt || '', job.lastVerifiedAt || '',
    job.trackerSheet ? `${job.trackerSheet}!${job.trackerRow}` : '', snapshot.updatedAt || new Date().toISOString(), job.appliedAt || '', job.applicationStatusChangedAt || '',
    (job.applicationHistory || []).map(event => `${event.changedAt}: ${event.previousStatus || '—'} → ${event.newStatus} [${event.source || 'user'}]`).join('\n'),
    job.resumeVerdict || '', (job.resumeStrengths || job.evidence || []).join('\n'), (job.fitGaps || []).join('\n'), (job.learningPlan || []).join('\n'), job.cvAngle || ''
  ]);
  databaseSheet.getRangeByIndexes(0, 0, 1, headers.length).values = [headers];
  if (rows.length) databaseSheet.getRangeByIndexes(1, 0, rows.length, headers.length).values = rows;
  const lastRow = Math.max(2, rows.length + 1);
  const fullRange = databaseSheet.getRange(`A1:AC${lastRow}`);
  fullRange.format.font = { typeface:'Carlito', fontSize:9, color:'#273A55' };
  fullRange.format.verticalAlignment = 'top';
  databaseSheet.getRange('A1:AC1').format = { fill:'#0F6B8F', font:{ typeface:'Carlito', fontSize:9, bold:true, color:'#FFFFFF' }, wrapText:true, verticalAlignment:'center', rowHeight:30 };
  databaseSheet.getRange(`A2:AC${lastRow}`).format.borders = { insideHorizontal:{ style:'thin', color:'#DCE6F0' } };
  databaseSheet.getRange(`E2:E${lastRow}`).format.wrapText = true;
  databaseSheet.getRange(`H2:J${lastRow}`).format.wrapText = true;
  databaseSheet.getRange(`P2:P${lastRow}`).format.font = { color:'#2457B9', underline:true, fontSize:9, typeface:'Carlito' };
  databaseSheet.getRange(`D2:D${Math.max(lastRow, 500)}`).dataValidation = { rule:{ type:'list', values:statuses } };
  databaseSheet.getRange(`F2:F${lastRow}`).format.numberFormat = '0"%"';
  databaseSheet.getRange(`V2:W${lastRow}`).format.numberFormat = 'yyyy-mm-dd hh:mm';
  databaseSheet.getRange(`X2:X${lastRow}`).format.wrapText = true;
  databaseSheet.getRange(`Y2:AC${lastRow}`).format.wrapText = true;
  databaseSheet.getRange(`A1:AC${lastRow}`).format.columnWidth = 14;
  databaseSheet.getRange('A:A').format.columnWidth = 20;
  databaseSheet.getRange('D:D').format.columnWidth = 18;
  databaseSheet.getRange('E:E').format.columnWidth = 32;
  databaseSheet.getRange('H:H').format.columnWidth = 36;
  databaseSheet.getRange('I:I').format.columnWidth = 24;
  databaseSheet.getRange('J:J').format.columnWidth = 24;
  databaseSheet.getRange('N:O').format.columnWidth = 24;
  databaseSheet.getRange('P:P').format.columnWidth = 42;
  databaseSheet.getRange('Q:U').format.columnWidth = 20;
  databaseSheet.getRange('V:W').format.columnWidth = 21;
  databaseSheet.getRange('X:X').format.columnWidth = 42;
  databaseSheet.getRange('Y:Y').format.columnWidth = 30;
  databaseSheet.getRange('Z:AB').format.columnWidth = 42;
  databaseSheet.getRange('AC:AC').format.columnWidth = 42;
  databaseSheet.freezePanes.freezeRows(1);
  databaseSheet.showGridLines = false;
  if (rows.length) {
    const table = databaseSheet.tables.add(`A1:AC${rows.length + 1}`, true, 'JobDatabaseTable');
    table.style = 'TableStyleMedium2';
    table.showFilterButton = true;
  }
  const backupPath = await saveWorkbook('before-sqlite-sync');
  const verified = await SpreadsheetFile.importXlsx(await FileBlob.load(trackerPath));
  const savedHeader = verified.worksheets.getItem('Job Database').getRange('A1').values?.[0]?.[0];
  const savedCount = Math.max(0, (verified.worksheets.getItem('Job Database').getUsedRange(true)?.values?.length || 1) - 1);
  if (savedHeader !== 'Job ID' || savedCount !== rows.length) throw new Error(`Excel database mirror verification failed (${savedCount}/${rows.length} rows)`);
  console.log(JSON.stringify({ ok:true, jobs:rows.length, backupPath }));
} else if (command === 'update-status') {
  const row = Number(rowText);
  if (!statuses.includes(value)) throw new Error('Unsupported application status');
  if (!Number.isInteger(row) || row < 1) throw new Error('Invalid tracker row');
  const sheet = workbook.worksheets.getItem(sheetName);
  const target = sheet.getRange(`C${row}`);
  target.values = [[value]];
  const backupPath = await saveWorkbook('before-web-status');

  const verified = await SpreadsheetFile.importXlsx(await FileBlob.load(trackerPath));
  const saved = verified.worksheets.getItem(sheetName).getRange(`C${row}`).values?.[0]?.[0];
  if (saved !== value) throw new Error('Workbook verification failed after status update');
  console.log(JSON.stringify({ ok:true, sheet:sheetName, row, status:value, backupPath }));
} else if (command === 'update-comment') {
  const row = Number(rowText);
  if (!Number.isInteger(row) || row < 1) throw new Error('Invalid tracker row');
  const note = normaliseCellText(value);
  if (note.length > 2000) throw new Error('Application note is limited to 2,000 characters');
  const sheet = workbook.worksheets.getItem(sheetName);
  ensureCommentColumn(sheet);
  sheet.getRange(`${commentColumn}${row}`).values = [[note]];
  const backupPath = await saveWorkbook('before-web-comment');
  const verified = await SpreadsheetFile.importXlsx(await FileBlob.load(trackerPath));
  const saved = normaliseCellText(verified.worksheets.getItem(sheetName).getRange(`${commentColumn}${row}`).values?.[0]?.[0]);
  if (saved !== note) throw new Error(`Excel saved a different note value (expected ${note.length} characters, found ${saved.length})`);
  console.log(JSON.stringify({ ok:true, sheet:sheetName, row, comment:saved, backupPath }));
} else {
  throw new Error(`Unsupported command: ${command}`);
}

await rm(workspaceTemp, { recursive:true, force:true });
