import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('PDF buttons prepare the file before invoking the native device share flow', async () => {
  const index = await readFile(new URL('./index.html', import.meta.url), 'utf8');
  const server = await readFile(new URL('./server.mjs', import.meta.url), 'utf8');

  assert.match(index, /<button id="downloadCvPdf" type="button">Save CV · PDF<\/button>/);
  assert.match(index, /<button id="downloadLetterPdf" type="button">Save cover letter · PDF<\/button>/);
  assert.match(index, /navigator\.canShare\(shareData\)/);
  assert.match(index, /await navigator\.share\(shareData\)/);
  assert.match(index, /new File\(\[blob\], fileName, \{ type:"application\/pdf"/);
  assert.match(index, /download\.download = file\.name/);
  assert.match(index, /"Save cover letter · PDF",cvPdfReady/);
  assert.match(index, /function showApplicationPackage[\s\S]*?preparedPdfFiles\.clear\(\)/);
  assert.doesNotMatch(index, /pdf-viewer\.html|downloadPackagePdf|target="_blank"[^>]*>Save (?:CV|cover letter) · PDF/);
  assert.match(server, /'content-disposition':`attachment; filename=/);
});
