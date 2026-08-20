import { availableParallelism } from 'node:os';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Repo root. Both `apps/server/src` and `apps/server/dist` sit three levels
 * below it, so this is correct whether we are running TypeScript directly or
 * the compiled output.
 */
export const ROOT = path.resolve(here, '../../..');

/** Minimal .env reader: no dependency, no interpolation, first definition wins. */
function loadDotEnv(file: string): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (value.length >= 2 && /^(".*"|'.*')$/s.test(value)) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

/**
 * Where mutable state lives.
 *
 * Defaults to `data/` beside the repo, which is right for a checkout. The
 * packaged desktop app overrides it to the OS user-data directory, because an
 * installed app must never write inside its own program folder.
 */
const dataDir = process.env.USIM_DATA_DIR?.trim() || path.join(ROOT, 'data');

loadDotEnv(path.join(ROOT, '.env'));
// A packaged app has no repo checkout to read .env from, so also honour one
// dropped next to the data directory. Loaded second: the repo file wins.
if (process.env.USIM_DATA_DIR) loadDotEnv(path.join(dataDir, '.env'));

const int = (value: string | undefined, fallback: number): number => {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
};

const num = (value: string | undefined, fallback: number): number => {
  const n = Number.parseFloat(value ?? '');
  return Number.isFinite(n) ? n : fallback;
};

const bool = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) return fallback;
  return /^(1|true|yes|on)$/i.test(value.trim());
};

const cores = availableParallelism();

export const config = {
  /** 0 asks the OS for a free port -- what the desktop app uses. */
  port: int(process.env.PORT, 8730),
  dataDir,
  runsDir: path.join(dataDir, 'runs'),
  vendorDir: process.env.USIM_VENDOR_DIR?.trim() || path.join(ROOT, 'vendor'),
  /** Built UI to serve. The desktop app points this inside its resources. */
  webDist: process.env.USIM_WEB_DIST?.trim() || path.join(ROOT, 'apps', 'web', 'dist'),

  simc: {
    /** Explicit override; when unset the engine probes known locations. */
    path: process.env.SIMC_PATH?.trim() || undefined,
    iterations: int(process.env.SIMC_ITERATIONS, 10000),
    targetError: num(process.env.SIMC_TARGET_ERROR, 0.2),
    fightStyle: process.env.SIMC_FIGHT_STYLE?.trim() || 'Patchwerk',
    maxTime: int(process.env.SIMC_MAX_TIME, 300),
    /** Leave one core for the OS and the server itself. */
    threads: int(process.env.SIMC_THREADS, Math.max(1, cores - 1)),
  },

  docker: {
    /** Image tag built by `npm run simc:docker`. */
    image: process.env.SIMC_DOCKER_IMAGE?.trim() || 'usim/simc:latest',
    /** Optional --cpus cap. Unset lets the container use every core. */
    cpus: process.env.SIMC_DOCKER_CPUS ? num(process.env.SIMC_DOCKER_CPUS, 0) || undefined : undefined,
  },

  /**
   * Concurrent sim jobs. SimC already saturates every core it is given, so
   * running jobs in parallel usually makes each one slower without improving
   * total throughput. Raise this only alongside a lower SIMC_THREADS.
   */
  concurrency: Math.max(1, int(process.env.SIM_CONCURRENCY, 1)),

  watch: {
    enabled: bool(process.env.WOW_WATCH_ENABLED, true),
    savedVariables: process.env.WOW_SAVEDVARS?.trim() || undefined,
  },

  cores,
} as const;
