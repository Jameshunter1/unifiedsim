#!/usr/bin/env node
/**
 * Installs addon/UnifiedSim into the WoW retail AddOns folder.
 *
 * Prefers a link so edits to the repo are live in game after a /reload:
 *   - Windows: a directory junction, which does not need administrator rights
 *     (a plain symlink does).
 *   - Elsewhere: a symlink.
 * Falls back to copying when linking is refused.
 *
 * Usage:
 *   node scripts/link-addon.mjs                 # auto-discover the install
 *   node scripts/link-addon.mjs --wow <path>    # path to the World of Warcraft folder
 *   node scripts/link-addon.mjs --copy          # copy instead of linking
 */

import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, 'addon', 'UnifiedSim');

const argv = process.argv.slice(2);
const flag = (name) => argv.includes('--' + name);
const value = (name) => {
  const i = argv.indexOf('--' + name);
  return i !== -1 ? argv[i + 1] : undefined;
};

function installRoots() {
  if (process.platform === 'win32') {
    const pf = process.env.ProgramFiles ?? 'C:\\Program Files';
    const pfx86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
    return [
      path.join(pfx86, 'World of Warcraft'),
      path.join(pf, 'World of Warcraft'),
      'C:\\World of Warcraft',
      'C:\\Games\\World of Warcraft',
      'D:\\World of Warcraft',
      'D:\\Games\\World of Warcraft',
      'E:\\World of Warcraft',
    ];
  }
  if (process.platform === 'darwin') return ['/Applications/World of Warcraft'];
  return [];
}

function findAddOnsDir() {
  const explicit = value('wow');
  const roots = explicit ? [explicit] : installRoots();
  for (const root of roots) {
    const addons = path.join(root, '_retail_', 'Interface', 'AddOns');
    if (existsSync(addons)) return addons;
    // A fresh install may not have Interface/AddOns yet.
    if (existsSync(path.join(root, '_retail_'))) {
      mkdirSync(addons, { recursive: true });
      return addons;
    }
  }
  return null;
}

const addonsDir = findAddOnsDir();
if (!addonsDir) {
  console.error(
    'Could not find a World of Warcraft retail install.\n' +
    'Pass it explicitly:  node scripts/link-addon.mjs --wow "D:\\Games\\World of Warcraft"',
  );
  process.exit(1);
}

const target = path.join(addonsDir, 'UnifiedSim');

if (existsSync(target)) {
  const stat = lstatSync(target);
  const kind = stat.isSymbolicLink() ? 'link' : 'directory';
  console.log('Replacing existing ' + kind + ' at ' + target);
  rmSync(target, { recursive: true, force: true });
}

let linked = false;
if (!flag('copy')) {
  try {
    symlinkSync(SOURCE, target, process.platform === 'win32' ? 'junction' : 'dir');
    linked = true;
  } catch (err) {
    console.warn('Could not link (' + err.code + '), copying instead.');
  }
}

if (!linked) cpSync(SOURCE, target, { recursive: true });

console.log((linked ? 'Linked' : 'Copied') + ' ' + SOURCE);
console.log('     -> ' + target);
console.log('');
console.log('Files: ' + readdirSync(target).join(', '));
console.log('');
console.log('In game: enable UnifiedSim in the AddOns list, then run  /usim sync');
console.log('Then start the server (npm run dev:server) -- it will find the SavedVariables file.');
