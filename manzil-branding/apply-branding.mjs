import { readFileSync, writeFileSync, readdirSync, copyFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rebrandSource } from './brand-source.mjs';

const assetRoot = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(assetRoot, '..');
let changed = 0;
function update(file, transform) {
  if (!existsSync(file)) return;
  const original = readFileSync(file, 'utf8');
  const next = transform(original);
  if (next !== original) { writeFileSync(file, next); changed++; }
}
function walk(directory) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (/\.(?:ts|tsx)$/.test(entry.name) && !/\.(?:test|spec)\./.test(entry.name)) {
      update(file, source => rebrandSource(file, source));
    } else if (/\.css$/.test(entry.name)) {
      update(file, source => source.replaceAll('trek-loading-light.gif', 'manzil-loading-light.svg')
        .replaceAll('trek-loading-dark.gif', 'manzil-loading-dark.svg'));
    }
  }
}
for (const directory of ['client/src', 'server/src', 'shared/src/i18n']) walk(path.join(root, directory));
update(path.join(root, 'client/vite.config.js'), source => rebrandSource('vite.config.ts', source)
  .replace("description: 'Travel Resource & Exploration Kit'", "description: 'Discover places and plan your trips with Manzil'"));
update(path.join(root, 'client/index.html'), source => source.replace('<title>TREK</title>', '<title>Manzil</title>')
  .replace('name="apple-mobile-web-app-title" content="TREK"', 'name="apple-mobile-web-app-title" content="Manzil"'));
const publicRoot = path.join(root, 'client/public');
mkdirSync(path.join(publicRoot, 'icons'), { recursive: true });
for (const file of ['logo-light.svg', 'logo-dark.svg', 'source.html']) copyFileSync(path.join(assetRoot, file), path.join(publicRoot, file));
for (const file of ['icon.svg', 'icon-dark.svg', 'icon-white.svg', 'manzil-loading-light.svg', 'manzil-loading-dark.svg']) {
  copyFileSync(path.join(assetRoot, file), path.join(publicRoot, 'icons', file));
}
copyFileSync(path.join(root, 'LICENSE'), path.join(publicRoot, 'LICENSE.txt'));
if (existsSync(path.join(root, 'NOTICE.md'))) copyFileSync(path.join(root, 'NOTICE.md'), path.join(publicRoot, 'NOTICE.txt'));
console.log(`Manzil product branding applied to ${changed} source/metadata files; upstream legal attribution retained.`);
