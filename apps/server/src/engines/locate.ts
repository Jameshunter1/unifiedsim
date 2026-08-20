import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import { config } from '../config.js';

const execFileAsync = promisify(execFile);

const isWindows = process.platform === 'win32';
const BIN = isWindows ? 'simc.exe' : 'simc';

/** Candidate locations, most specific first. */
function candidates(): string[] {
  const out: string[] = [];
  if (config.simc.path) out.push(config.simc.path);

  // Vendored copy installed by `npm run simc:fetch`.
  out.push(path.join(config.vendorDir, 'simc', BIN));

  if (isWindows) {
    const localAppData = process.env.LOCALAPPDATA;
    const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
    out.push(path.join(programFiles, 'SimulationCraft', BIN));
    out.push(path.join(programFilesX86, 'SimulationCraft', BIN));
    out.push(path.join('C:\\', 'SimulationCraft', BIN));
    if (localAppData) out.push(path.join(localAppData, 'Programs', 'SimulationCraft', BIN));
  } else if (process.platform === 'darwin') {
    out.push('/Applications/SimulationCraft.app/Contents/MacOS/simc');
    out.push('/opt/homebrew/bin/simc');
    out.push('/usr/local/bin/simc');
  } else {
    out.push('/usr/local/bin/simc');
    out.push('/usr/bin/simc');
  }

  return out;
}

/** Resolves `simc` on PATH, if it is there. */
async function fromPath(): Promise<string | undefined> {
  const probe = isWindows ? 'where' : 'which';
  try {
    const { stdout } = await execFileAsync(probe, [isWindows ? 'simc.exe' : 'simc'], {
      timeout: 5000,
      windowsHide: true,
    });
    const first = stdout.split(/\r?\n/).map((l) => l.trim()).find(Boolean);
    return first && existsSync(first) ? first : undefined;
  } catch {
    return undefined;
  }
}

let cached: LocatedSimc | undefined;
let inFlight: Promise<LocatedSimc | undefined> | undefined;

function parseBanner(text: string): string | undefined {
  // A bare invocation prints "Nothing to sim! SimulationCraft 1210-01 for…" --
  // its complaint about having no profile, prefixed to the banner. Keep only
  // the banner: a version string that opens with an error erodes trust in
  // every other number on screen.
  const line = text.split(/\r?\n/).find((l) => /SimulationCraft/i.test(l));
  if (!line) return undefined;
  const start = line.search(/SimulationCraft/i);
  return line.slice(start).trim() || undefined;
}

/**
 * Explains a spawn failure in terms of what the user can act on.
 *
 * On Windows the common case is not a missing file but a security policy
 * refusing to execute an unsigned download -- Smart App Control and WDAC both
 * surface as an opaque EPERM/UNKNOWN from spawn, so name them here rather than
 * leaving "operation not permitted" as the whole diagnosis.
 */
function explainSpawnFailure(binary: string, err: NodeJS.ErrnoException): string {
  const code = err.code ?? '';
  const blocked =
    process.platform === 'win32' &&
    (code === 'EPERM' || code === 'UNKNOWN' || /Application Control|blocked/i.test(err.message));

  if (blocked) {
    return (
      'Windows blocked ' +
      binary +
      ' from running. Smart App Control or a WDAC policy refuses unsigned executables, ' +
      'and SimulationCraft nightlies are unsigned. Check with: ' +
      "Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\CI\\Policy' -Name VerifiedAndReputablePolicyState " +
      '(1 = enforced). Smart App Control has no per-app exception list, so the options are to run simc ' +
      'in WSL or a container, or to build it locally.'
    );
  }

  return 'Could not execute ' + binary + ' (' + (code || 'error') + '): ' + err.message;
}

export interface LocatedSimc {
  binary: string;
  version?: string;
  /** Set when the binary exists but cannot actually be run. */
  error?: string;
}

/**
 * Verifies the binary runs, and reads its version banner while we are there.
 *
 * simc has no `--version` flag: a bare invocation prints the banner and the
 * usage text, then exits non-zero. So a non-zero exit is a success signal here
 * -- what matters is whether the process started and said anything at all.
 * Checking only that the file exists is not enough; a present-but-unrunnable
 * binary would otherwise be advertised as a working engine and fail at the
 * first sim.
 */
async function probe(binary: string): Promise<LocatedSimc> {
  try {
    const { stdout, stderr } = await execFileAsync(binary, [], {
      timeout: 20000,
      windowsHide: true,
      maxBuffer: 1024 * 512,
    });
    return { binary, version: parseBanner(stdout + '\n' + stderr) };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    const output = (e.stdout ?? '') + '\n' + (e.stderr ?? '');

    // It ran and produced output; the non-zero exit is just simc's usage path.
    if (output.trim()) return { binary, version: parseBanner(output) };

    // Timeouts mean it started but did not answer -- still usable in principle.
    if (e.code === 'ETIMEDOUT') return { binary };

    return { binary, error: explainSpawnFailure(binary, e) };
  }
}

/** Finds the simc binary and confirms it runs, caching for the process lifetime. */
export async function locateSimc(force = false): Promise<LocatedSimc | undefined> {
  if (cached && !force) return cached;

  // Concurrent callers share one probe. Executing a blocked binary can take
  // seconds to be refused, and doing that once per caller multiplies the wait.
  inFlight ??= (async () => {
    let binary = candidates().find((c) => existsSync(c));
    binary ??= await fromPath();
    if (!binary) return undefined;
    return probe(binary);
  })().then(
    (result) => {
      cached = result;
      return result;
    },
    (err) => {
      inFlight = undefined;
      throw err;
    },
  ).finally(() => {
    inFlight = undefined;
  });

  return inFlight;
}

/** Human-readable guidance shown in the UI when no binary is found. */
/**
 * What to tell the user when no binary is found.
 *
 * The default assumes a checkout with npm available. The desktop app overrides
 * it via USIM_ENGINE_HINT, because an installed app has neither, and pointing
 * someone at an npm script they cannot run is worse than saying nothing.
 */
export const SIMC_MISSING_HINT =
  process.env.USIM_ENGINE_HINT?.trim() ||
  'SimulationCraft binary not found. Run `npm run simc:fetch` to download a build into vendor/simc, ' +
    'or set SIMC_PATH in .env to an existing simc executable.';
