import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require(process.env.MANZIL_TYPESCRIPT_PATH || 'typescript');
const names = execFileSync('git', ['diff', '--name-only', 'HEAD'], { encoding: 'utf8' }).trim().split(/\r?\n/)
  .filter(file => /\.(ts|tsx)$/.test(file));
names.push('client/src/pages/login/registrationPolicy.ts');
for (const name of names) {
  const source = ts.createSourceFile(name, readFileSync(name, 'utf8'), ts.ScriptTarget.Latest, true,
    name.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  if (source.parseDiagnostics.length) throw new Error(`TypeScript syntax check failed in ${name}`);
}
console.log(`TypeScript/TSX syntax: ${names.length} changed source files passed. Full typechecking/build still required.`);
