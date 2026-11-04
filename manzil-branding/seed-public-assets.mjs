import { readFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const source = path.resolve(process.argv[2] || '/upstream-public');
const destination = path.join(root, 'client/public');
let copied = 0;
// Only pinned source-public paths: never copy an old compiled app or service worker.
for (const relative of JSON.parse(readFileSync(path.join(import.meta.dirname, 'public-files.json'), 'utf8'))) {
  const from = path.resolve(source, relative), to = path.resolve(destination, relative);
  if (!from.startsWith(source + path.sep) || !to.startsWith(destination + path.sep)) throw new Error('Invalid public asset path');
  if (existsSync(to) || !existsSync(from)) continue;
  mkdirSync(path.dirname(to), { recursive: true }); copyFileSync(from, to); copied++;
}
console.log(`Seeded ${copied} original public assets from the pinned upstream runtime.`);
