#!/usr/bin/env node
import { chmod, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(process.cwd());
const hookDir = join(root, '.git', 'hooks');
const body = '#!/bin/sh\nset -eu\nnpm run audit:public\n';
for (const name of ['pre-commit', 'pre-push']) {
  const path = join(hookDir, name);
  await writeFile(path, body, { encoding:'utf8', mode:0o755 });
  await chmod(path, 0o755);
}
console.log('Installed public privacy audit hooks: pre-commit and pre-push.');
