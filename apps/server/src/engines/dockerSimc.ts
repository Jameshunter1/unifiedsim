import { execFile, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import { config } from '../config.js';
import { extractProgress, parseReport } from './simcReport.js';
import {
  EngineUnavailableError,
  type EngineHooks,
  type EngineRunInput,
  type EngineStatus,
  type SimEngine,
  type SimResult,
} from './types.js';

const execFileAsync = promisify(execFile);

/** Mount point for the run directory inside the container. */
const WORK = '/work';

export const DOCKER_IMAGE_MISSING =
  'Docker is running but the simc image is not built. Run `npm run simc:docker` (one-time, ~10-20 min).';

export const DOCKER_DAEMON_DOWN =
  'Docker is installed but its daemon is not running. Start Docker Desktop, then refresh.';

export const DOCKER_MISSING =
  'Docker is not installed. See the README for the container route around unsigned-binary blocking.';

export const DOCKER_WEDGED =
  'The Docker daemon accepted the connection but never responded. Docker Desktop is usually ' +
  'mid-startup or stuck -- check its window for a prompt, and confirm the com.docker.service ' +
  'Windows service is running. Restarting Docker Desktop clears it.';

interface DockerState {
  available: boolean;
  reason?: string;
  version?: string;
  /** Provenance line baked into the image at build time. */
  source?: string;
}

/**
 * Probe timeout. Short on purpose: a wedged Docker daemon does not refuse
 * connections, it simply never answers, and this probe sits in the path of
 * /api/health. A long timeout turns "Docker is stuck" into "the whole UI hangs".
 */
const PROBE_TIMEOUT_MS = 6000;

/**
 * How long a probe result is trusted.
 *
 * Negative results expire quickly so starting Docker Desktop or building the
 * image is picked up without restarting the server. Positive results are held
 * longer -- re-running a container per health check would be wasteful.
 */
const CACHE_MS = { available: 300_000, unavailable: 15_000 } as const;

/**
 * Probes docker in three steps, because the three failure modes need three
 * different messages: no CLI, no daemon, no image. Collapsing them into one
 * "docker unavailable" would leave the user guessing which.
 */
async function probeDocker(image: string): Promise<DockerState> {
  try {
    await execFileAsync('docker', ['version', '--format', '{{.Server.Version}}'], {
      timeout: PROBE_TIMEOUT_MS,
      windowsHide: true,
    });
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { killed?: boolean };
    if (e.code === 'ENOENT') return { available: false, reason: DOCKER_MISSING };
    // A killed process means the probe timed out: the daemon accepted the
    // request and never replied, which is a different problem from it being
    // stopped, and needs a different fix from the user.
    if (e.killed) return { available: false, reason: DOCKER_WEDGED };
    return { available: false, reason: DOCKER_DAEMON_DOWN };
  }

  try {
    await execFileAsync('docker', ['image', 'inspect', image], {
      timeout: PROBE_TIMEOUT_MS,
      windowsHide: true,
    });
  } catch {
    return { available: false, reason: DOCKER_IMAGE_MISSING };
  }

  let version: string | undefined;
  let source: string | undefined;
  try {
    const { stdout } = await execFileAsync(
      'docker',
      ['run', '--rm', '--entrypoint', '/bin/sh', image, '-c', 'cat /BUILD_SOURCE'],
      { timeout: 30000, windowsHide: true },
    );
    source = stdout.trim() || undefined;
  } catch {
    // Provenance is a nicety; its absence does not make the engine unusable.
  }

  try {
    // simc prints its banner then usage and exits non-zero, so the banner
    // arrives on the error path.
    const { stdout, stderr } = await execFileAsync('docker', ['run', '--rm', image], {
      timeout: 40000,
      windowsHide: true,
      maxBuffer: 512 * 1024,
    });
    version = bannerOf(stdout + '\n' + stderr);
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    version = bannerOf((e.stdout ?? '') + '\n' + (e.stderr ?? ''));
  }

  return { available: true, version, source };
}

function bannerOf(text: string): string | undefined {
  return text.split(/\r?\n/).find((l) => /SimulationCraft/i.test(l))?.trim() || undefined;
}

export class DockerSimcEngine implements SimEngine {
  readonly id = 'docker-simc';
  readonly label = 'SimulationCraft (Docker)';

  private cached: DockerState | undefined;
  private cachedAt = 0;
  private inFlight: Promise<DockerState> | undefined;

  private async state(force = false): Promise<DockerState> {
    const ttl = this.cached?.available ? CACHE_MS.available : CACHE_MS.unavailable;
    if (!force && this.cached && Date.now() - this.cachedAt < ttl) return this.cached;

    // Concurrent callers share one probe; otherwise a page load that hits
    // /api/health and POST /api/runs together spawns two docker invocations.
    this.inFlight ??= probeDocker(config.docker.image).finally(() => {
      this.inFlight = undefined;
    });

    this.cached = await this.inFlight;
    this.cachedAt = Date.now();
    return this.cached;
  }

  async status(): Promise<EngineStatus> {
    const state = await this.state();
    if (!state.available) return { available: false, reason: state.reason };
    return {
      available: true,
      location: config.docker.image + (state.source ? ' @ ' + state.source.slice(0, 12) : ''),
      version: state.version,
    };
  }

  async run(
    input: EngineRunInput,
    hooks: EngineHooks,
  ): Promise<{ result: SimResult; reportPath?: string }> {
    const state = await this.state();
    if (!state.available) throw new EngineUnavailableError(state.reason ?? 'Docker engine unavailable.');

    mkdirSync(input.workDir, { recursive: true });
    const profileName = input.runId + '.simc';
    const reportName = input.runId + '.json';
    const reportPath = path.join(input.workDir, reportName);
    writeFileSync(path.join(input.workDir, profileName), input.profileText, 'utf8');

    // Named so an abort can reach the container. Killing the `docker run` CLI
    // process alone can orphan the container and leave it burning cores.
    const containerName = 'usim-' + input.runId;

    const args = [
      'run',
      '--rm',
      '--name',
      containerName,
      // The container only ever touches this run's directory.
      '-v',
      input.workDir + ':' + WORK,
      config.docker.image,
      WORK + '/' + profileName,
      'json2=' + WORK + '/' + reportName,
      'threads=' + input.threads,
    ];

    if (config.docker.cpus) args.splice(3, 0, '--cpus', String(config.docker.cpus));

    await new Promise<void>((resolve, reject) => {
      const child = spawn('docker', args, { windowsHide: true });

      let stderrTail = '';
      let settled = false;

      const onAbort = () => {
        // Stop the container itself; the CLI exits once it does.
        execFile('docker', ['kill', containerName], { windowsHide: true }, () => undefined);
      };
      hooks.signal.addEventListener('abort', onAbort, { once: true });

      const handleChunk = (buf: Buffer, isError: boolean) => {
        const text = buf.toString('utf8');
        const progress = extractProgress(text);
        if (progress) hooks.onProgress(progress);
        for (const line of text.split(/[\r\n]+/)) {
          const trimmed = line.trim();
          if (trimmed) hooks.onLog(trimmed);
        }
        if (isError) stderrTail = (stderrTail + text).slice(-4000);
      };

      child.stdout.on('data', (buf: Buffer) => handleChunk(buf, false));
      child.stderr.on('data', (buf: Buffer) => handleChunk(buf, true));

      child.on('error', (err) => {
        if (settled) return;
        settled = true;
        hooks.signal.removeEventListener('abort', onAbort);
        reject(new Error('Failed to start docker: ' + err.message));
      });

      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        hooks.signal.removeEventListener('abort', onAbort);
        if (hooks.signal.aborted) {
          reject(new Error('Run cancelled.'));
        } else if (code === 0) {
          resolve();
        } else {
          reject(new Error('simc container exited with code ' + code + '.\n' + stderrTail.trim()));
        }
      });
    });

    let json: string;
    try {
      json = readFileSync(reportPath, 'utf8');
    } catch {
      throw new Error(
        'The container finished but wrote no JSON report to ' +
          reportPath +
          '. If the run directory is on a drive Docker Desktop does not share, the mount silently ' +
          'produces an empty directory -- check File Sharing in Docker Desktop settings.',
      );
    }

    return { result: parseReport(json), reportPath };
  }
}

export const dockerSimcEngine = new DockerSimcEngine();
