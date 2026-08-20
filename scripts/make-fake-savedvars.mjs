#!/usr/bin/env node
/**
 * Writes a SavedVariables file shaped exactly like the WoW client's own
 * serialiser output, from a .simc fixture. Used to exercise the bridge without
 * launching the game.
 *
 *   node scripts/make-fake-savedvars.mjs <out.lua> [fixture.simc]
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [outPath, fixture = path.join(ROOT, 'fixtures', 'darvage-frost.simc')] = process.argv.slice(2);

if (!outPath) {
  console.error('usage: node scripts/make-fake-savedvars.mjs <out.lua> [fixture.simc]');
  process.exit(1);
}

/** The three escapes WoW's SavedVariables serialiser emits for strings. */
const luaEscape = (s) =>
  s.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n');

const simc = readFileSync(fixture, 'utf8');
const stamp = new Date().toISOString().slice(0, 19);

const lua = [
  'UnifiedSimDB = {',
  '\t["profiles"] = {',
  '\t\t["Darvage-Tichondrius"] = {',
  `\t\t\t["exportedAt"] = "${stamp}",`,
  '\t\t\t["reason"] = "manual",',
  `\t\t\t["simc"] = "${luaEscape(simc)}",`,
  '\t\t\t["itemStrings"] = {',
  '\t\t\t\t["head"] = "item:277792::::::::90:64::::4:12833:41:13696:13662:::",',
  '\t\t\t},',
  '\t\t},',
  '\t},',
  '\t["lastProfile"] = "Darvage-Tichondrius",',
  '\t["version"] = 1,',
  '}',
  '',
].join('\n');

writeFileSync(outPath, lua, 'utf8');
console.log('wrote ' + outPath + ' (' + lua.length + ' bytes)');
