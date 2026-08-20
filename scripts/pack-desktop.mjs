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
import { createWriteStream, cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
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

/**
 * Pre-seeds electron-builder's winCodeSign cache, minus the macOS symlinks.
 *
 * On Windows, electron-builder downloads a signing-tools bundle whose archive
 * contains darwin `.dylib` symlinks. Creating symlinks needs Developer Mode or
 * elevation, so on a stock machine the extraction fails and aborts the whole
 * build -- for files that are never used on Windows. Extracting the bundle
 * ourselves and excluding the darwin tree sidesteps it; electron-builder sees
 * the cache directory and skips its own download.
 *
 * CI runners are elevated and never hit this, so a present cache is simply
 * left alone.
 */
async function seedWinCodeSign() {
  if (process.platform !== 'win32') return;

  const version = 'winCodeSign-2.6.0';
  const cacheRoot = process.env.ELECTRON_BUILDER_CACHE
    ? path.join(process.env.ELECTRON_BUILDER_CACHE, 'winCodeSign')
    : path.join(process.env.LOCALAPPDATA ?? '', 'electron-builder', 'Cache', 'winCodeSign');
  const target = path.join(cacheRoot, version);
  if (existsSync(target)) return;

  console.log('Seeding ' + version + ' cache (excluding darwin symlinks)...');
  mkdirSync(cacheRoot, { recursive: true });

  const url =
    'https://github.com/electron-userland/electron-builder-binaries/releases/download/' +
    version + '/' + version + '.7z';
  const archive = path.join(cacheRoot, version + '.7z.part');

  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error('winCodeSign download failed: HTTP ' + res.status);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(archive));

  // The same 7-Zip the desktop app already bundles for its simc installer.
  const require = createRequire(path.join(ROOT, 'package.json'));
  const { path7za } = require('7zip-bin');

  const extracted = target + '.tmp';
  rmSync(extracted, { recursive: true, force: true });
  const result = spawnSync(path7za, ['x', '-y', '-o' + extracted, archive, '-x!darwin'], {
    stdio: 'inherit',
    windowsHide: true,
  });
  rmSync(archive, { force: true });
  if (result.status !== 0) {
    rmSync(extracted, { recursive: true, force: true });
    throw new Error('winCodeSign extraction failed (7za exit ' + result.status + ')');
  }
  // Rename into place last, so a half-extracted cache never looks complete.
  cpSync(extracted, target, { recursive: true });
  rmSync(extracted, { recursive: true, force: true });
  console.log('  seeded ' + target);
}

await seedWinCodeSign();

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
