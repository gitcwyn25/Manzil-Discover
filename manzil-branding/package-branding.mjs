import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
const repo = path.resolve(import.meta.dirname, '..');
const release = path.resolve(repo, '../.seo-tools/manzil-discover-branding-release');
if (!release.startsWith(path.resolve(repo, '..') + path.sep)) throw new Error('Release directory must stay in the workspace');
fs.mkdirSync(release, { recursive: true });
fs.cpSync(path.join(repo, 'client/dist'), path.join(release, 'client-build'), { recursive: true });
for (const [from, to] of [['manzil-branding/Dockerfile.branding', 'Dockerfile'], ['manzil-branding/start.sh', 'start.sh'],
  ['manzil-branding/brand-help.mjs', 'brand-help.mjs'], ['LICENSE', 'LICENSE'], ['NOTICE.md', 'NOTICE.md']]) {
  fs.copyFileSync(path.join(repo, from), path.join(release, to));
}
const files = [];
function inventory(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) inventory(file);
    else files.push({ path: path.relative(release, file).split(path.sep).join('/'), sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') });
  }
}
inventory(path.join(release, 'client-build'));
const commit = execFileSync('git', ['-c', `safe.directory=${repo.split(path.sep).join('/')}`, 'rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
fs.writeFileSync(path.join(release, 'release.json'), JSON.stringify({ sourceCommit: commit, backend: 'upstream v5.1.0 unchanged', files }, null, 2));
console.log(`Packaged ${files.length} verified client files for branding publication at ${release}.`);
