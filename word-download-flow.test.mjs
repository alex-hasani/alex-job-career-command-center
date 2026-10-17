import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Word downloads never replace the application tab on mobile', async () => {
  const index = await readFile(new URL('./index.html', import.meta.url), 'utf8');

  assert.match(index, /<button id="downloadCvDocx" type="button">Download CV · Word<\/button>/);
  assert.match(index, /<button id="downloadLetterDocx" type="button">Download cover letter · Word<\/button>/);
  assert.match(index, /\$\("downloadCvDocx"\)\.onclick = event => savePackageWord\(event\.currentTarget\)/);
  assert.match(index, /\$\("downloadLetterDocx"\)\.onclick = event => savePackageWord\(event\.currentTarget\)/);
  assert.match(index, /async function savePackageWord\(control\)[\s\S]*?await navigator\.share\(shareData\)/);
  assert.match(index, /download\.target = "_blank"/);
  assert.match(index, /download\.rel = "noopener"/);
  assert.doesNotMatch(index, /\$\("download(?:Cv|Letter)Docx"\)\.href\s*=/);
});
