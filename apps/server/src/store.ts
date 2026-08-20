import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import { config } from './config.js';
import type { SimResult } from './engines/types.js';

export type RunStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled';

export interface StoredProfile {
  id: string;
  /** Display label, defaults to "Name - Spec". */
  label: string;
  source: 'paste' | 'addon' | 'file';
  createdAt: string;
  /** Export checksum, when the addon supplied one. */
  checksum?: string;
  characterName?: string;
  spec?: string;
  className?: string;
  averageItemLevel?: number;
  /** Verbatim simc text as imported. */
  raw: string;
}

export interface RunOptions {
  iterations: number;
  targetError: number;
  fightStyle: string;
  maxTime: number;
  threads: number;
  desiredTargets?: number;
  scaleFactors?: boolean;
}

export interface SimRun {
  id: string;
  profileId: string;
  /** Groups runs launched together, so the UI can show a batch as one unit. */
  batchId?: string;
  variantLabel: string;
  engine: string;
  status: RunStatus;
  options: RunOptions;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  /** 0-100, best effort from the engine's progress stream. */
  progress: number;
  progressMessage?: string;
  result?: SimResult;
  error?: string;
  /** Path to the raw engine report, relative to the data dir. */
  reportPath?: string;
}

interface StoreShape {
  version: 1;
  profiles: StoredProfile[];
  runs: SimRun[];
}

const EMPTY: StoreShape = { version: 1, profiles: [], runs: [] };

/**
 * Flat JSON store.
 *
 * Deliberately not SQLite: this dataset is a few thousand rows at most and
 * lives on one machine, and a native module would add a Windows build step for
 * no benefit. Writes are atomic (temp file + rename) so a crash mid-write
 * cannot truncate the store the way the game's own SavedVariables can.
 */
class Store {
  private data: StoreShape = EMPTY;
  private readonly file: string;
  private writeQueued = false;

  constructor() {
    this.file = path.join(config.dataDir, 'store.json');
    mkdirSync(config.dataDir, { recursive: true });
    mkdirSync(config.runsDir, { recursive: true });
    this.load();
  }

  private load(): void {
    if (!existsSync(this.file)) {
      this.data = structuredClone(EMPTY);
      return;
    }
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as StoreShape;
      this.data = {
        version: 1,
        profiles: parsed.profiles ?? [],
        runs: parsed.runs ?? [],
      };
    } catch (err) {
      // Keep the unreadable file for inspection rather than overwriting it.
      const backup = this.file + '.corrupt-' + Date.now();
      try {
        renameSync(this.file, backup);
        console.error('[store] unreadable store.json moved to ' + backup, err);
      } catch {
        console.error('[store] unreadable store.json and could not back it up', err);
      }
      this.data = structuredClone(EMPTY);
    }
  }

  /** Coalesces bursts of mutations into one write per tick. */
  private persist(): void {
    if (this.writeQueued) return;
    this.writeQueued = true;
    queueMicrotask(() => {
      this.writeQueued = false;
      const tmp = this.file + '.tmp';
      writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
      renameSync(tmp, this.file);
    });
  }

  // --- profiles ------------------------------------------------------------

  listProfiles(): StoredProfile[] {
    return [...this.data.profiles].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getProfile(id: string): StoredProfile | undefined {
    return this.data.profiles.find((p) => p.id === id);
  }

  /** Finds an existing profile with identical text, to avoid re-import churn. */
  findProfileByRaw(raw: string): StoredProfile | undefined {
    return this.data.profiles.find((p) => p.raw === raw);
  }

  addProfile(profile: Omit<StoredProfile, 'id' | 'createdAt'>): StoredProfile {
    const stored: StoredProfile = {
      ...profile,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    this.data.profiles.push(stored);
    this.persist();
    return stored;
  }

  deleteProfile(id: string): boolean {
    const before = this.data.profiles.length;
    this.data.profiles = this.data.profiles.filter((p) => p.id !== id);
    this.data.runs = this.data.runs.filter((r) => r.profileId !== id);
    if (this.data.profiles.length === before) return false;
    this.persist();
    return true;
  }

  // --- runs ----------------------------------------------------------------

  listRuns(filter?: { profileId?: string; batchId?: string }): SimRun[] {
    let runs = this.data.runs;
    if (filter?.profileId) runs = runs.filter((r) => r.profileId === filter.profileId);
    if (filter?.batchId) runs = runs.filter((r) => r.batchId === filter.batchId);
    return [...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getRun(id: string): SimRun | undefined {
    return this.data.runs.find((r) => r.id === id);
  }

  addRun(run: Omit<SimRun, 'id' | 'createdAt' | 'progress' | 'status'>): SimRun {
    const stored: SimRun = {
      ...run,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      status: 'queued',
      progress: 0,
    };
    this.data.runs.push(stored);
    this.persist();
    return stored;
  }

  updateRun(id: string, patch: Partial<SimRun>): SimRun | undefined {
    const run = this.data.runs.find((r) => r.id === id);
    if (!run) return undefined;
    Object.assign(run, patch);
    this.persist();
    return run;
  }

  deleteRun(id: string): boolean {
    const before = this.data.runs.length;
    this.data.runs = this.data.runs.filter((r) => r.id !== id);
    if (this.data.runs.length === before) return false;
    this.persist();
    return true;
  }

  /**
   * Marks runs left mid-flight by a server restart as errored. Without this a
   * killed process leaves rows stuck at "running" forever.
   */
  reconcileOnBoot(): number {
    let touched = 0;
    for (const run of this.data.runs) {
      if (run.status === 'running' || run.status === 'queued') {
        run.status = 'error';
        run.error = 'Server restarted while this run was ' + run.status + '.';
        run.finishedAt = new Date().toISOString();
        touched++;
      }
    }
    if (touched) this.persist();
    return touched;
  }

  /**
   * Re-derives stored ability breakdowns from their saved reports.
   *
   * Breakdowns written before the `compound_amount` fix summed to roughly a
   * third of the player's damage and ranked abilities wrongly, because damage
   * dealt through child spells was read as zero. The DPS figures were always
   * correct, so only the breakdown is rebuilt.
   *
   * Detected by the symptom rather than a version flag: shares that do not add
   * up. Re-running is harmless, since a correct breakdown sums to 1 and is
   * skipped.
   */
  repairAbilityBreakdowns(reparse: (json: string) => { abilities: SimResult['abilities'] }): number {
    let repaired = 0;

    for (const run of this.data.runs) {
      const abilities = run.result?.abilities;
      if (!run.result || !run.reportPath || !abilities?.length) continue;

      const shareTotal = abilities.reduce((sum, a) => sum + (a.share ?? 0), 0);
      if (shareTotal > 0.95) continue;

      const file = path.resolve(config.dataDir, run.reportPath);
      if (!file.startsWith(path.resolve(config.dataDir) + path.sep) || !existsSync(file)) continue;

      try {
        run.result.abilities = reparse(readFileSync(file, 'utf8')).abilities;
        repaired++;
      } catch {
        // A missing or unreadable report just leaves the old breakdown alone.
      }
    }

    if (repaired) this.persist();
    return repaired;
  }
}

export const store = new Store();
