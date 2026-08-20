import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * In-app SimulationCraft installer.
 *
 * The CLI has `scripts/fetch-simc.mjs`, but an installed desktop app has no
 * checkout and no npm, so telling the user to run an npm script would be a dead
 * end. This is the same procedure driven from the Tools menu, with 7-Zip taken
 * from the bundled `7zip-bin` rather than assumed to be on the machine.
 */

const INDEX = 'http://downloads.simulationcraft.org/nightly/';

export interface SimcBuild {
  file: string;
  version: string;
  platform: string;
  ext: string;
  url: string;
}

/** Which archive suffix this machine needs, or null if none is published. */
export function platformSuffix(): string | null {
  if (process.platform === 'win32') return process.arch === 'arm64' ? 'winarm64' : 'win64';
  if (process.platform === 'darwin') return 'macos';
  return null;
}

export async function listBuilds(): Promise<SimcBuild[]> {
  const res = await fetch(INDEX, { redirect: 'follow', signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error('Could not list ' + INDEX + ' (HTTP ' + res.status + ')');
  const html = await res.text();

  const builds: SimcBuild[] = [];
  for (const match of html.matchAll(
    /href="(simc-([\d.]+)[.-]([0-9a-f]{6,})-(win64|winarm64|macos)\.(7z|dmg))"/gi,
  )) {
    const [, file, version, , platform, ext] = match;
    if (!file || !version || !platform || !ext) continue;
    builds.push({ file, version, platform, ext, url: INDEX + file });
  }

  const rank = (v: string) => v.split('.').map((p) => Number.parseInt(p, 10) || 0);
  builds.sort((a, b) => {
    const av = rank(a.version);
    const bv = rank(b.version);
    return (bv[0] ?? 0) - (av[0] ?? 0) || (bv[1] ?? 0) - (av[1] ?? 0);
  });
  return builds;
}

/**
 * Locates a 7-Zip binary.
 *
 * Prefers the copy bundled with `7zip-bin`, so a packaged install does not
 * depend on the user having 7-Zip. Falls back to a system install if the
 * bundled path is missing (it lives outside the asar and could be pruned).
 */
export function findSevenZip(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bin = require('7zip-bin') as { path7za: string };
    // Inside a packaged app the real file sits in app.asar.unpacked.
    const unpacked = bin.path7za.replace('app.asar', 'app.asar.unpacked');
    if (existsSync(unpacked)) return unpacked;
    if (existsSync(bin.path7za)) return bin.path7za;
  } catch {
    // Not installed; fall through to the system copies.
  }

  const candidates =
    process.platform === 'win32'
      ? [
          path.join(process.env.ProgramFiles ?? 'C:\\Program Files', '7-Zip', '7z.exe'),
          path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', '7-Zip', '7z.exe'),
        ]
      : ['/usr/bin/7z', '/usr/local/bin/7z', '/opt/homebrew/bin/7z'];

  return candidates.find((c) => existsSync(c)) ?? null;
}

export interface InstallProgress {
  phase: 'download' | 'extract';
  /** 0-1, or undefined when the total size is unknown. */
  fraction?: number;
  receivedBytes?: number;
  totalBytes?: number;
}

export interface InstallResult {
  binary: string;
  version: string;
  sha256: string;
}

/**
 * Downloads and extracts a simc build into `vendorDir/simc`.
 *
 * Upstream serves this over plain HTTP (their certificate does not match the
 * host) and publishes no checksums, so the sha256 of whatever arrived is
 * recorded in PROVENANCE.json. The caller is expected to have told the user
 * both facts before calling.
 */
export async function installSimc(
  vendorDir: string,
  onProgress: (progress: InstallProgress) => void,
  build?: SimcBuild,
): Promise<InstallResult> {
  const suffix = platformSuffix();
  if (!suffix) {
    throw new Error(
      'No prebuilt SimulationCraft is published for ' +
        process.platform +
        '. Build it from source and set SIMC_PATH.',
    );
  }

  const chosen = build ?? (await listBuilds()).find((b) => b.platform === suffix);
  if (!chosen) throw new Error('No SimulationCraft build found for ' + suffix + '.');
  if (chosen.ext === 'dmg') {
    throw new Error(
      'The macOS build ships as a .dmg. Install it manually, then set SIMC_PATH to ' +
        '/Applications/SimulationCraft.app/Contents/MacOS/simc.',
    );
  }

  const sevenZip = findSevenZip();
  if (!sevenZip) {
    throw new Error('No 7-Zip binary available to extract the archive.');
  }

  const target = path.join(vendorDir, 'simc');
  const cache = path.join(vendorDir, '.cache');
  mkdirSync(cache, { recursive: true });

  const archive = path.join(cache, chosen.file);
  const partial = archive + '.part';

  const res = await fetch(chosen.url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error('Download failed: HTTP ' + res.status);

  const totalBytes = Number.parseInt(res.headers.get('content-length') ?? '0', 10) || undefined;
  let receivedBytes = 0;
  let lastTick = 0;

  const hash = createHash('sha256');
  const source = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);

  source.on('data', (chunk: Buffer) => {
    receivedBytes += chunk.length;
    hash.update(chunk);
    const now = Date.now();
    if (now - lastTick > 250) {
      lastTick = now;
      onProgress({
        phase: 'download',
        fraction: totalBytes ? receivedBytes / totalBytes : undefined,
        receivedBytes,
        totalBytes,
      });
    }
  });

  // Download to a .part file so an interrupted transfer is never mistaken for a
  // complete archive on the next attempt.
  await pipeline(source, createWriteStream(partial));

  if (totalBytes && receivedBytes !== totalBytes) {
    rmSync(partial, { force: true });
    throw new Error('Truncated download: expected ' + totalBytes + ' bytes, got ' + receivedBytes);
  }
  renameSync(partial, archive);
  const sha256 = hash.digest('hex');

  onProgress({ phase: 'extract' });

  if (existsSync(target)) rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });

  await execFileAsync(sevenZip, ['x', '-y', '-o' + target, archive], {
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 8,
  });

  flattenSingleDirectory(target);

  const binary = path.join(target, process.platform === 'win32' ? 'simc.exe' : 'simc');
  if (!existsSync(binary)) {
    throw new Error('Extracted, but no simc executable at ' + binary);
  }

  writeFileSync(
    path.join(target, 'PROVENANCE.json'),
    JSON.stringify(
      {
        url: chosen.url,
        file: chosen.file,
        sha256,
        bytes: statSync(archive).size,
        fetchedAt: new Date().toISOString(),
        transport: 'http (upstream TLS certificate does not match host)',
        upstreamChecksum: null,
      },
      null,
      2,
    ) + '\n',
  );

  // The archive is ~120 MB and has served its purpose.
  rmSync(archive, { force: true });

  return { binary, version: chosen.version, sha256 };
}

/** simc archives contain a single top-level folder; lift its contents up. */
function flattenSingleDirectory(dir: string): void {
  const entries = readdirSync(dir);
  if (entries.length !== 1) return;
  const only = path.join(dir, entries[0]!);
  if (!statSync(only).isDirectory()) return;

  for (const child of readdirSync(only)) {
    renameSync(path.join(only, child), path.join(dir, child));
  }
  rmSync(only, { recursive: true, force: true });
}
