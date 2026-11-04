import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
const repo = path.resolve(import.meta.dirname, '..');
const git = args => execFileSync('git', ['-c', `safe.directory=${repo.split(path.sep).join('/')}`, ...args], { cwd: repo, encoding: 'utf8', env: { ...process.env, GIT_NO_LAZY_FETCH: '1' } });
if (git(['status', '--porcelain']).trim()) throw new Error('Commit the reviewed source before packaging');
const commit = git(['rev-parse', 'HEAD']).trim();
const auth = fs.readFileSync(path.join(repo, 'server/dist/nest/auth/auth.service.js'), 'utf8');
if (!auth.includes('decoded.pv !==')) throw new Error('Rebuild the server with the MFA revocation check before packaging');
const release = path.resolve(repo, `../.seo-tools/manzil-runtime-${commit.slice(0, 12)}`);
if (!release.startsWith(path.resolve(repo, '..') + path.sep)) throw new Error('Release directory must stay in the workspace');
if (fs.existsSync(release)) throw new Error('Use the existing immutable release or create a new source commit');
fs.mkdirSync(release, { recursive: true });
for (const [from, to] of [['client/dist', 'client-build'], ['server/dist', 'server-build'], ['shared/dist', 'shared-build']]) {
  fs.cpSync(path.join(repo, from), path.join(release, to), { recursive: true });
}
for (const [from, to] of [['manzil-branding/Dockerfile.runtime', 'Dockerfile'], ['manzil-branding/start.sh', 'start.sh'],
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
for (const directory of ['client-build', 'server-build', 'shared-build']) inventory(path.join(release, directory));
fs.writeFileSync(path.join(release, 'release.json'), JSON.stringify({ sourceCommit: commit, upstream: 'dc36c21c08f681fd2806764fad8e17b270f6f175', files }, null, 2));
console.log(JSON.stringify({ release, sourceCommit: commit, files: files.length }));
