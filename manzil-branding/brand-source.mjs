import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require(process.env.MANZIL_TYPESCRIPT_PATH || 'typescript');

/** Product copy changes only; protocol names, URLs and legal attribution stay. */
export function brandText(text) {
  if (/\b(copyright|AGPL|licen[cs]e[ds]?|GNU|contributors|based on|derived from|fork of|open.source)\b/i.test(text)) return text;
  const protectedNames = [];
  const protect = value => `@@MANZIL_PROTECTED_${protectedNames.push(value) - 1}@@`;
  return text.replace(/https?:\/\/[^\s"'<>`]+/g, protect)
    .replace(/\b(?:TREK|Manzil) (Places API|Places|Services|services)\b/g, (_, provider) => protect(`TREK ${provider}`))
    .replace(/\b(?:[A-Za-z0-9_.]+[-_:])?TREK(?:[-_:][A-Za-z0-9_.]+)+\b/g, protect)
    .replace(/\bTREK\b/g, 'Manzil')
    .replace(/\btrek-loading-light\.gif\b/g, 'manzil-loading-light.svg')
    .replace(/\btrek-loading-dark\.gif\b/g, 'manzil-loading-dark.svg')
    .replace(/@@MANZIL_PROTECTED_(\d+)@@/g, (_, index) => protectedNames[Number(index)]);
}

export function rebrandSource(fileName, source) {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const edits = [];
  function visit(node) {
    const parent = node.parent;
    const propertyName = parent && ts.isPropertyAssignment(parent) ? parent.name?.getText(file) : '';
    const isKey = parent && ts.isPropertyAssignment(parent) && parent.name === node;
    const machineField = /^(?:['"]?)(?:iss|aud|issuer|audience|protocol|namespace|cacheKey|storageKey|cookie|scheme|algorithm|scope|id)(?:['"]?)$/i.test(propertyName);
    if (!isKey && !machineField && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
      || node.kind === ts.SyntaxKind.TemplateHead || node.kind === ts.SyntaxKind.TemplateMiddle
      || node.kind === ts.SyntaxKind.TemplateTail || ts.isJsxText(node))) {
      const start = node.getStart(file);
      const original = source.slice(start, node.end);
      const replacement = brandText(original);
      if (replacement !== original) edits.push({ start, end: node.end, replacement });
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    source = source.slice(0, edit.start) + edit.replacement + source.slice(edit.end);
  }
  return source;
}
