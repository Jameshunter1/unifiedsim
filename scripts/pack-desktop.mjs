#!/usr/bin/env node
/**
 * Packages the desktop app.
 *
 * Exists to work around one electron-builder constraint: it refuses any source
 * path that resolves outside the app directory ("must be under apps/desktop").
 * In an npm workspace, `@usim/server` and `@usim/simc-profile` are symlinks
 * pointing back up the tree, so both the automatic dependency walk and an
 * explicit `files` mapping hit that rule.
 *
 * The fix is to stage real copies of their built output into
 * apps/desktop/node_modules/@usim/ for the duration of the build, then remove
 * them again. They are deliberately temporary: leaving them in place would
 * shadow the workspace symlinks during development, so a rebuilt server would
 * appear not to take effect.
 *
 *   node scripts/pack-desktop.mjs [--dir]     # --dir skips installer creation
 */

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DESKTOP = path.join(ROOT, 'apps', 'desktop');
const STAGE = path.join(DESKTOP, 'node_modules', '@usim');

/** Local packages the shell needs at runtime, and where their sources live. */
const LOCAL_PACKAGES = [
  { name: 'server', dir: path.join(ROOT, 'apps', 'server') },
  { name: 'simc-profile', dir: path.join(ROOT, 'packages', 'simc-profile') },
];

function stage() {
  mkdirSync(STAGE, { recursive: true });
  for (const pkg of LOCAL_PACKAGES) {
    const dist = path.join(pkg.dir, 'dist');
    if (!existsSync(dist)) {
      throw new Error('Missing build output: ' + dist + '\nRun `npm run build` first.');
    }
    const target = path.join(STAGE, pkg.name);
    rmSync(target, { recursive: true, force: true });
    mkdirSync(target, { recursive: true });
    cpSync(dist, path.join(target, 'dist'), { recursive: true });
    cpSync(path.join(pkg.dir, 'package.json'), path.join(target, 'package.json'));
    console.log('  staged @usim/' + pkg.name);
  }
}

function unstage() {
  for (const pkg of LOCAL_PACKAGES) {
    rmSync(path.join(STAGE, pkg.name), { recursive: true, force: true });
  }
  // Leave no empty scaffolding behind, but never delete anything npm itself
  // put there.
  try {
    if (existsSync(STAGE) && readdirSync(STAGE).length === 0) {
      rmSync(STAGE, { recursive: true, force: true });
    }
  } catch {
    // Not worth failing a successful build over.
  }
  console.log('  unstaged local packages');
}

console.log('Staging workspace packages...');
stage();

const env = { ...process.env };
// Inherited from editor terminals; makes electron-builder's own tooling
// misbehave the same way it does the app. See apps/desktop/launch.mjs.
delete env.ELECTRON_RUN_AS_NODE;

const args = process.argv.slice(2);
console.log('Running electron-builder ' + args.join(' '));

const result = spawnSync('npx', ['electron-builder', ...args], {
  cwd: DESKTOP,
  stdio: 'inherit',
  env,
  shell: process.platform === 'win32',
});

unstage();

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 0);
