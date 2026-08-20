#!/usr/bin/env node
/**
 * Downloads a SimulationCraft build into vendor/simc.
 *
 * Upstream caveats, surfaced rather than hidden:
 *   - downloads.simulationcraft.org serves a certificate that does not match
 *     the host, so this fetches over plain HTTP.
 *   - No checksums or signatures are published alongside the nightlies.
 * We therefore record the sha256 of whatever we downloaded in
 * vendor/simc/PROVENANCE.json, so a later run can tell you if the artifact
 * behind a given filename ever changes.
 *
 * Usage:
 *   node scripts/fetch-simc.mjs                 # newest build for this platform
 *   node scripts/fetch-simc.mjs --list          # show available builds
 *   node scripts/fetch-simc.mjs --version 1210  # pick a specific game version
 *   node scripts/fetch-simc.mjs --url <url>     # use an exact archive URL
 *   node scripts/fetch-simc.mjs --yes           # skip the confirmation prompt
 */

import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = path.join(ROOT, 'vendor');
const TARGET = path.join(VENDOR, 'simc');
const CACHE = path.join(VENDOR, '.cache');
const INDEX = 'http://downloads.simulationcraft.org/nightly/';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes('--' + name);
const value = (name) => {
  const i = argv.indexOf('--' + name);
  return i !== -1 ? argv[i + 1] : undefined;
};

/** Which archive suffix this machine needs. */
function platformSuffix() {
  if (process.platform === 'win32') {
    return process.arch === 'arm64' ? 'winarm64' : 'win64';
  }
  if (process.platform === 'darwin') return 'macos';
  return null;
}

async function listBuilds() {
  const res = await fetch(INDEX, { redirect: 'follow' });
  if (!res.ok) throw new Error('Could not list ' + INDEX + ' (HTTP ' + res.status + ')');
  const html = await res.text();

  const builds = [];
  for (const match of html.matchAll(/href="(simc-([\d.]+)[.-]([0-9a-f]{6,})-(win64|winarm64|macos)\.(7z|dmg))"/gi)) {
    const [, file, version, commit, platform, ext] = match;
    builds.push({ file, version, commit, platform, ext, url: INDEX + file });
  }

  // Newest first, comparing version segments numerically (1210.01 > 1205.01).
  const rank = (v) => v.split('.').map((p) => Number.parseInt(p, 10) || 0);
  builds.sort((a, b) => {
    const [av, ar] = rank(a.version);
    const [bv, br] = rank(b.version);
    return bv - av || (br ?? 0) - (ar ?? 0);
  });
  return builds;
}

function findSevenZip() {
  const candidates = ['7z', '7za', '7zr'];
  if (process.platform === 'win32') {
    const pf = process.env.ProgramFiles ?? 'C:\\Program Files';
    const pfx86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
    candidates.push(path.join(pf, '7-Zip', '7z.exe'), path.join(pfx86, '7-Zip', '7z.exe'));
  } else {
    candidates.push('/usr/bin/7z', '/usr/local/bin/7z', '/opt/homebrew/bin/7z');
  }

  for (const candidate of candidates) {
    try {
      if (candidate.includes(path.sep) && !existsSync(candidate)) continue;
      execFileSync(candidate, ['i'], { stdio: 'ignore', timeout: 10000, windowsHide: true });
      return candidate;
    } catch {
      // `7z i` exits non-zero on some builds but still proves the binary runs.
      if (candidate.includes(path.sep) && existsSync(candidate)) return candidate;
    }
  }
  return null;
}

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error('Download failed: HTTP ' + res.status + ' for ' + url);

  const total = Number.parseInt(res.headers.get('content-length') ?? '0', 10);
  let received = 0;
  let lastPrint = 0;

  const hash = createHash('sha256');
  const out = createWriteStream(dest);
  const source = Readable.fromWeb(res.body);

  source.on('data', (chunk) => {
    received += chunk.length;
    hash.update(chunk);
    const now = Date.now();
    if (now - lastPrint > 500) {
      lastPrint = now;
      const mb = (received / 1e6).toFixed(1);
      const pct = total ? ' (' + ((received / total) * 100).toFixed(0) + '%)' : '';
      process.stdout.write('\r  ' + mb + ' MB' + pct + '   ');
    }
  });

  await pipeline(source, out);
  process.stdout.write('\r  ' + (received / 1e6).toFixed(1) + ' MB  done\n');

  if (total && received !== total) {
    throw new Error('Truncated download: expected ' + total + ' bytes, got ' + received);
  }
  return hash.digest('hex');
}

/** simc archives contain a top-level folder; flatten it into vendor/simc. */
function flattenSingleDirectory(dir) {
  const entries = readdirSync(dir);
  if (entries.length !== 1) return;
  const only = path.join(dir, entries[0]);
  if (!statSync(only).isDirectory()) return;

  for (const child of readdirSync(only)) {
    const from = path.join(only, child);
    const to = path.join(dir, child);
    if (existsSync(to)) rmSync(to, { recursive: true, force: true });
    execFileSync(process.platform === 'win32' ? 'cmd' : 'mv',
      process.platform === 'win32' ? ['/c', 'move', '/y', from, to] : [from, to],
      { stdio: 'ignore', windowsHide: true });
  }
  rmSync(only, { recursive: true, force: true });
}

async function confirm(question) {
  if (flag('yes') || !process.stdin.isTTY) return flag('yes');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(question + ' [y/N] ')).trim().toLowerCase();
  rl.close();
  return answer === 'y' || answer === 'yes';
}

async function main() {
  const suffix = platformSuffix();

  if (flag('list')) {
    const builds = await listBuilds();
    const shown = suffix ? builds.filter((b) => b.platform === suffix) : builds;
    for (const b of shown.slice(0, 15)) {
      console.log('  ' + b.version.padEnd(10) + b.platform.padEnd(10) + b.file);
    }
    return;
  }

  let url = value('url');
  let chosen;

  if (!url) {
    if (!suffix) {
      console.error(
        'No prebuilt SimulationCraft binary is published for ' + process.platform + '.\n' +
        'Build simc from source (https://github.com/simulationcraft/simc) and set SIMC_PATH in .env.',
      );
      process.exit(1);
    }

    const builds = (await listBuilds()).filter((b) => b.platform === suffix);
    const wanted = value('version');
    chosen = wanted ? builds.find((b) => b.version.startsWith(wanted)) : builds[0];

    if (!chosen) {
      console.error('No build found for ' + suffix + (wanted ? ' version ' + wanted : '') + '. Try --list.');
      process.exit(1);
    }
    url = chosen.url;
  }

  if (chosen?.ext === 'dmg' || url.endsWith('.dmg')) {
    console.error(
      'The macOS build ships as a .dmg. Mount it, drag SimulationCraft.app to /Applications,\n' +
      'then set SIMC_PATH=/Applications/SimulationCraft.app/Contents/MacOS/simc in .env.\n' +
      '  ' + url,
    );
    process.exit(1);
  }

  const sevenZip = findSevenZip();
  if (!sevenZip) {
    console.error(
      'simc nightlies are .7z archives and no 7-Zip binary was found.\n' +
      'Install 7-Zip (https://www.7-zip.org/) or extract ' + url + ' into vendor/simc yourself.',
    );
    process.exit(1);
  }

  console.log('SimulationCraft fetch');
  console.log('  source : ' + url);
  console.log('  into   : ' + TARGET);
  console.log('  7-Zip  : ' + sevenZip);
  console.log('');
  console.log('  NOTE: upstream serves this over plain HTTP (their TLS certificate does not');
  console.log('        match the host) and publishes no checksum. You are trusting the network');
  console.log('        path as well as the publisher. The sha256 of what arrives is recorded in');
  console.log('        vendor/simc/PROVENANCE.json.');
  console.log('');

  if (!(await confirm('Download and extract this ~120 MB executable?'))) {
    console.log('Aborted. Nothing was downloaded.');
    process.exit(1);
  }

  mkdirSync(CACHE, { recursive: true });
  const archive = path.join(CACHE, path.basename(new URL(url).pathname));

  console.log('Downloading...');
  const sha256 = await download(url, archive);
  console.log('  sha256 ' + sha256);

  if (existsSync(TARGET)) rmSync(TARGET, { recursive: true, force: true });
  mkdirSync(TARGET, { recursive: true });

  console.log('Extracting...');
  execFileSync(sevenZip, ['x', '-y', '-o' + TARGET, archive], { stdio: 'inherit', windowsHide: true });
  flattenSingleDirectory(TARGET);

  const binary = path.join(TARGET, process.platform === 'win32' ? 'simc.exe' : 'simc');
  if (!existsSync(binary)) {
    console.error('Extracted, but no simc executable at ' + binary + '. Contents:');
    for (const entry of readdirSync(TARGET)) console.error('  ' + entry);
    process.exit(1);
  }

  const provenance = {
    url,
    file: path.basename(archive),
    sha256,
    bytes: statSync(archive).size,
    fetchedAt: new Date().toISOString(),
    transport: 'http (upstream TLS certificate does not match host)',
    upstreamChecksum: null,
  };

  const previousFile = path.join(TARGET, 'PROVENANCE.json');
  if (existsSync(previousFile)) {
    try {
      const previous = JSON.parse(readFileSync(previousFile, 'utf8'));
      if (previous.file === provenance.file && previous.sha256 !== sha256) {
        console.warn('  WARNING: ' + provenance.file + ' has changed contents since the last fetch.');
        console.warn('           was ' + previous.sha256);
      }
    } catch {
      // Unreadable provenance is not worth failing the install over.
    }
  }
  writeFileSync(previousFile, JSON.stringify(provenance, null, 2) + '\n');

  console.log('');
  console.log('Ready: ' + binary);
  console.log('The server finds this automatically -- no .env change needed.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
