import test from 'node:test';
import assert from 'node:assert/strict';
import { brandText, rebrandSource } from './brand-source.mjs';

test('product copy changes while source URLs and legal credits remain', () => {
  assert.equal(brandText('Welcome to TREK'), 'Welcome to Manzil');
  assert.equal(brandText('TREK Studio'), 'Manzil Studio');
  assert.equal(brandText('https://github.com/liketrek/TREK'), 'https://github.com/liketrek/TREK');
  assert.equal(brandText('Based on TREK, AGPL-3.0'), 'Based on TREK, AGPL-3.0');
  assert.equal(brandText('TREK_PLUGINS_ENABLED'), 'TREK_PLUGINS_ENABLED');
  assert.equal(brandText('X-TREK-Installation'), 'X-TREK-Installation');
  assert.equal(brandText('TREK Places API'), 'TREK Places API');
});
test('source transform preserves identifiers, machine fields and comments', () => {
  const source = `// TREK copyright stays\nconst TREK_VERSION = 1; const config = { issuer: 'TREK', title: 'TREK' }; const view = <img alt="TREK"/>;`;
  const branded = rebrandSource('brand.tsx', source);
  assert.ok(branded.includes('// TREK copyright stays'));
  assert.ok(branded.includes('const TREK_VERSION = 1'));
  assert.ok(branded.includes("issuer: 'TREK'"));
  assert.ok(branded.includes("title: 'Manzil'"));
  assert.ok(branded.includes('alt="Manzil"'));
});
test('template and loading asset copy are branded without changing URLs', () => {
  const source = 'const title = `Welcome to TREK ${name}`; const image = "/icons/trek-loading-light.gif";';
  const branded = rebrandSource('brand.ts', source);
  assert.ok(branded.includes('Welcome to Manzil ${name}'));
  assert.ok(branded.includes('/icons/manzil-loading-light.svg'));
});
