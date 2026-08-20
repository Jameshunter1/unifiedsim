import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { extractSimcExports } from '../src/savedVariables.ts';

/** Builds a SavedVariables blob the way WoW's own serialiser would. */
function savedVars(entries: Array<{ key: string; simc: string }>): string {
  const escape = (s: string) =>
    s.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n');

  const profiles = entries
    .map(
      (e) =>
        '\t\t["' +
        e.key +
        '"] = {\n' +
        '\t\t\t["exportedAt"] = "2026-08-19T16:36:00",\n' +
        '\t\t\t["simc"] = "' +
        escape(e.simc) +
        '",\n' +
        '\t\t},',
    )
    .join('\n');

  return 'UnifiedSimDB = {\n\t["profiles"] = {\n' + profiles + '\n\t},\n\t["version"] = 1,\n}\n';
}

describe('extractSimcExports', () => {
  it('recovers a profile with escaped newlines and quotes', () => {
    const simc = 'mage="Darvage"\nlevel=90\nspec=frost\n';
    const [found] = extractSimcExports(savedVars([{ key: 'Darvage-Tichondrius', simc }]));
    assert.equal(found, simc);
  });

  it('recovers every profile in the file', () => {
    const a = 'mage="Darvage"\nspec=frost\n';
    const b = 'priest="Otherguy"\nspec=shadow\n';
    const found = extractSimcExports(
      savedVars([
        { key: 'Darvage-Tichondrius', simc: a },
        { key: 'Otherguy-Illidan', simc: b },
      ]),
    );
    assert.deepEqual(found, [a, b]);
  });

  it('unescapes literal backslashes without eating the next character', () => {
    const simc = 'mage="X"\n# path C:\\Games\\WoW\n';
    const [found] = extractSimcExports(savedVars([{ key: 'X-Y', simc }]));
    assert.equal(found, simc);
    assert.ok(found!.includes('C:\\Games\\WoW'));
  });

  it('keeps an escaped quote inside the profile', () => {
    const simc = 'mage="Darv\\"age"\n';
    const [found] = extractSimcExports(savedVars([{ key: 'X-Y', simc }]));
    assert.equal(found, simc);
  });

  it('returns nothing for a file with no simc field', () => {
    assert.deepEqual(extractSimcExports('UnifiedSimDB = { ["version"] = 1 }'), []);
  });

  it('returns nothing for an empty file', () => {
    assert.deepEqual(extractSimcExports(''), []);
  });

  // A client crash or Alt+F4 leaves SavedVariables half-written. Importing a
  // truncated profile is worse than importing nothing.
  it('drops an unterminated string from a truncated file', () => {
    const full = savedVars([{ key: 'Darvage-Tichondrius', simc: 'mage="Darvage"\nlevel=90\n' }]);
    const cut = full.slice(0, full.indexOf('level') + 3);
    assert.deepEqual(extractSimcExports(cut), []);
  });

  it('keeps earlier complete profiles when the file is truncated later', () => {
    const a = 'mage="Darvage"\nspec=frost\n';
    const full = savedVars([
      { key: 'Darvage-Tichondrius', simc: a },
      { key: 'Otherguy-Illidan', simc: 'priest="Otherguy"\nspec=shadow\n' },
    ]);
    const cut = full.slice(0, full.lastIndexOf('spec=shadow'));
    assert.deepEqual(extractSimcExports(cut), [a]);
  });

  it('ignores a file that ends on a trailing backslash', () => {
    assert.deepEqual(extractSimcExports('["simc"] = "mage=\\'), []);
  });

  it('skips a profile whose simc field is blank', () => {
    assert.deepEqual(extractSimcExports(savedVars([{ key: 'X-Y', simc: '   ' }])), []);
  });
});
