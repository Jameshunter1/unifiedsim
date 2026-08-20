import path from 'node:path';

import { config } from './config.js';
import { getEngine } from './engines/index.js';
import { events } from './events.js';
import { store, type SimRun } from './store.js';

interface QueueItem {
  runId: string;
  profileText: string;
  engineId: string;
  threads: number;
}

/** Keeps the tail of each run's engine output for the log pane. */
const LOG_LIMIT = 400;

class SimQueue {
  private pending: QueueItem[] = [];
  private active = new Map<string, AbortController>();
  private logs = new Map<string, string[]>();

  enqueue(item: QueueItem): void {
    this.pending.push(item);
    this.broadcastDepth();
    queueMicrotask(() => this.pump());
  }

  /** Cancels a run whether it is already executing or still waiting. */
  cancel(runId: string): boolean {
    const controller = this.active.get(runId);
    if (controller) {
      controller.abort();
      return true;
    }
    const before = this.pending.length;
    this.pending = this.pending.filter((i) => i.runId !== runId);
    if (this.pending.length === before) return false;

    const run = store.updateRun(runId, {
      status: 'cancelled',
      finishedAt: new Date().toISOString(),
    });
    if (run) events.emit({ type: 'run:updated', run });
    this.broadcastDepth();
    return true;
  }

  getLog(runId: string): string[] {
    return this.logs.get(runId) ?? [];
  }

  get depth(): { queued: number; running: number } {
    return { queued: this.pending.length, running: this.active.size };
  }

  private broadcastDepth(): void {
    events.emit({ type: 'queue', ...this.depth });
  }

  private pump(): void {
    while (this.active.size < config.concurrency && this.pending.length) {
      const item = this.pending.shift();
      if (item) void this.execute(item);
    }
    this.broadcastDepth();
  }

  private async execute(item: QueueItem): Promise<void> {
    const controller = new AbortController();
    this.active.set(item.runId, controller);
    this.broadcastDepth();

    const started = Date.now();
    let run = store.updateRun(item.runId, {
      status: 'running',
      startedAt: new Date().toISOString(),
      progress: 0,
    });
    if (run) events.emit({ type: 'run:updated', run });

    const lines: string[] = [];
    this.logs.set(item.runId, lines);

    // simc rewrites its progress bar continuously; persisting every update
    // would rewrite the store hundreds of times per run.
    let lastPersistedProgress = -1;
    let lastEmit = 0;

    try {
      const engine = getEngine(item.engineId);
      if (!engine) throw new Error('Unknown engine: ' + item.engineId);

      const { result, reportPath } = await engine.run(
        {
          profileText: item.profileText,
          workDir: config.runsDir,
          runId: item.runId,
          threads: item.threads,
        },
        {
          signal: controller.signal,
          onProgress: ({ percent, message }) => {
            if (percent === undefined) return;
            const now = Date.now();
            if (percent === lastPersistedProgress && now - lastEmit < 500) return;
            lastPersistedProgress = percent;
            lastEmit = now;
            store.updateRun(item.runId, { progress: percent, progressMessage: message });
            events.emit({
              type: 'run:progress',
              runId: item.runId,
              progress: percent,
              message,
            });
          },
          onLog: (line) => {
            lines.push(line);
            if (lines.length > LOG_LIMIT) lines.splice(0, lines.length - LOG_LIMIT);
            events.emit({ type: 'run:log', runId: item.runId, line });
          },
        },
      );

      run = store.updateRun(item.runId, {
        status: 'done',
        progress: 100,
        progressMessage: undefined,
        finishedAt: new Date().toISOString(),
        result: {
          ...result,
          elapsedSeconds: result.elapsedSeconds ?? (Date.now() - started) / 1000,
        },
        reportPath: reportPath ? path.relative(config.dataDir, reportPath) : undefined,
      });
    } catch (err) {
      const cancelled = controller.signal.aborted;
      run = store.updateRun(item.runId, {
        status: cancelled ? 'cancelled' : 'error',
        finishedAt: new Date().toISOString(),
        error: cancelled ? 'Cancelled.' : (err as Error).message,
      });
    } finally {
      this.active.delete(item.runId);
      if (run) events.emit({ type: 'run:updated', run });
      this.pump();
    }
  }

  /** Cancels everything, used on shutdown. */
  abortAll(): void {
    this.pending = [];
    for (const controller of this.active.values()) controller.abort();
  }
}

export const queue = new SimQueue();

export type { SimRun };
