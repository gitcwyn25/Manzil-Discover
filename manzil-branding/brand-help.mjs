import fs from 'node:fs';
import path from 'node:path';
const root = process.argv[2] || '/app/wiki';
function walk(directory) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (/\.md$/.test(file)) {
      const original = fs.readFileSync(file, 'utf8');
      let fenced = false;
      const updated = original.split('\n').map(line => {
        if (/^\s*```/.test(line)) { fenced = !fenced; return line; }
        if (fenced || /copyright|AGPL|licen[cs]e|GNU|attribution|based on|contributors/i.test(line)) return line;
        return line.split(/(`[^`]*`|https?:\/\/[^\s)<>]+)/g).map((part, index) => index % 2
          ? part : part.replace(/\bTREK\b(?! (?:Places|Services|services))/g, 'Manzil')).join('');
      }).join('\n');
      if (updated !== original) fs.writeFileSync(file, updated);
    }
  }
}
walk(root);
