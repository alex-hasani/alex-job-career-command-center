import { cp, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

async function filesUnder(root) {
  if (!existsSync(root)) return [];
  const files = [];
  for (const entry of await readdir(root, { withFileTypes:true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function rebasePackagePaths(data, packageFolder) {
  let updated = false;
  for (const version of data.versions || []) {
    const versionFolder = join(packageFolder, `v${version.versionNumber}`);
    for (const type of ['cv', 'coverLetter']) {
      for (const language of ['de', 'en']) {
        const document = version.documents?.[type]?.[language]?.document;
        if (!document) continue;
        const fileName = document.fileName || basename(document.path || '');
        if (!fileName) continue;
        const nextPath = join(versionFolder, fileName);
        if (document.path !== nextPath) {
          document.path = nextPath;
          updated = true;
        }
      }
    }
  }
  return updated;
}

export async function migrateApplicationDocuments(workspace) {
  const resolvedWorkspace = resolve(workspace);
  const legacyRoot = join(resolvedWorkspace, 'Applications');
  const archiveRoot = join(resolvedWorkspace, 'Documents', 'Application_Packs');
  await mkdir(archiveRoot, { recursive:true });

  if (existsSync(legacyRoot)) {
    await cp(legacyRoot, archiveRoot, { recursive:true, force:false, errorOnExist:false });
  }

  const archiveFiles = await filesUnder(archiveRoot);
  let packagesUpdated = 0;
  for (const path of archiveFiles.filter(path => basename(path) === 'application-package.json')) {
    const data = JSON.parse(await readFile(path, 'utf8'));
    if (!rebasePackagePaths(data, dirname(path))) continue;
    const temporaryPath = `${path}.migrating`;
    await writeFile(temporaryPath, JSON.stringify(data, null, 2), 'utf8');
    await rename(temporaryPath, path);
    packagesUpdated += 1;
  }

  const finalFiles = await filesUnder(archiveRoot);
  const bytes = (await Promise.all(finalFiles.map(path => stat(path)))).reduce((sum, item) => sum + item.size, 0);
  return {
    workspace:resolvedWorkspace,
    legacyRoot,
    archiveRoot,
    files:finalFiles.length,
    bytes,
    packagesUpdated,
    legacyPreserved:existsSync(legacyRoot),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const workspace = process.argv[2];
  if (!workspace) throw new Error('Usage: node migrate-application-documents.mjs <workspace>');
  console.log(JSON.stringify(await migrateApplicationDocuments(workspace), null, 2));
}
