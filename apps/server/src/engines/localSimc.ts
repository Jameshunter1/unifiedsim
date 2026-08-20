import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { SIMC_MISSING_HINT, locateSimc } from './locate.js';
import { extractProgress, parseReport } from './simcReport.js';
import {
  EngineUnavailableError,
  type EngineHooks,
  type EngineRunInput,
  type EngineStatus,
  type SimEngine,
  type SimResult,
} from './types.js';

export class LocalSimcEngine implements SimEngine {
  readonly id = 'local-simc';
  readonly label = 'Local SimulationCraft';

  async status(): Promise<EngineStatus> {
    const located = await locateSimc();
    if (!located) return { available: false, reason: SIMC_MISSING_HINT };
    if (located.error) {
      return { available: false, location: located.binary, reason: located.error };
    }
    return { available: true, location: located.binary, version: located.version };
  }

  async run(
    input: EngineRunInput,
    hooks: EngineHooks,
  ): Promise<{ result: SimResult; reportPath?: string }> {
    const located = await locateSimc();
    if (!located) throw new EngineUnavailableError(SIMC_MISSING_HINT);
    if (located.error) throw new EngineUnavailableError(located.error);

    mkdirSync(input.workDir, { recursive: true });
    const profilePath = path.join(input.workDir, input.runId + '.simc');
    const reportPath = path.join(input.workDir, input.runId + '.json');
    writeFileSync(profilePath, input.profileText, 'utf8');

    // The report path and thread count go on the command line rather than into
    // the profile text, so the stored profile stays exactly what you could
    // paste into simc or Raidbots yourself.
    const args = [profilePath, 'json2=' + reportPath, 'threads=' + input.threads];

    await new Promise<void>((resolve, reject) => {
      const child = spawn(located.binary, args, {
        cwd: input.workDir,
        windowsHide: true,
      });

      let stderrTail = '';
      let settled = false;

      const onAbort = () => {
        child.kill('SIGTERM');
        // simc can ignore SIGTERM mid-iteration; escalate if it does.
        setTimeout(() => child.kill('SIGKILL'), 3000).unref();
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
        reject(new Error('Failed to start simc at ' + located.binary + ': ' + err.message));
      });

      child.on('close', (code, signal) => {
        if (settled) return;
        settled = true;
        hooks.signal.removeEventListener('abort', onAbort);
        if (hooks.signal.aborted) {
          reject(new Error('Run cancelled.'));
        } else if (code === 0) {
          resolve();
        } else {
          const how = signal ? 'signal ' + signal : 'exit code ' + code;
          reject(new Error('simc exited with ' + how + '.\n' + stderrTail.trim()));
        }
      });
    });

    let json: string;
    try {
      json = readFileSync(reportPath, 'utf8');
    } catch {
      throw new Error(
        'simc finished but wrote no JSON report to ' +
          reportPath +
          '. This usually means the profile failed to load -- check the run log.',
      );
    }

    return { result: parseReport(json), reportPath };
  }
}

export const localSimcEngine = new LocalSimcEngine();
