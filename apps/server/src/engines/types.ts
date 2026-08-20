/**
 * The seam every simulation backend implements.
 *
 * Today only `local-simc` exists. The WebAssembly engine and any distributed
 * engine plug in here: the queue, the store, the SSE stream and the UI all talk
 * to this interface, so adding a backend never touches them.
 */

/** Per-ability breakdown from the report, sorted by contribution. */
export interface AbilityBreakdown {
  name: string;
  /** Share of total damage/healing, 0-1. */
  share: number;
  dps: number;
  executes: number;
  /** Mean amount per execute. */
  amountPerExecute: number;
  crit?: number;
  uptime?: number;
}

export interface SimResult {
  dps: number;
  /** Standard error of the mean -- the number simc converges against. */
  dpsError: number;
  dpsStdev?: number;
  /** DPS including time spent outside the fight (damage per second elapsed). */
  dpse?: number;
  hps?: number;
  priorityDps?: number;
  fightLength?: number;
  iterations?: number;
  /** Seconds of wall clock the engine spent. */
  elapsedSeconds?: number;
  engineVersion?: string;
  abilities: AbilityBreakdown[];
  /** Stat weights, present only when the run requested scale factors. */
  scaleFactors?: Record<string, number>;
}

export interface EngineProgress {
  /** 0-100 where known, otherwise omitted. */
  percent?: number;
  message?: string;
}

export interface EngineRunInput {
  /** Complete simc profile text, ready to feed the engine verbatim. */
  profileText: string;
  /** Directory this run may write scratch files into. */
  workDir: string;
  /** Stable id used for naming report files. */
  runId: string;
  threads: number;
}

export interface EngineHooks {
  onProgress: (progress: EngineProgress) => void;
  /** Raw engine stdout/stderr, line by line, for the log pane. */
  onLog: (line: string) => void;
  signal: AbortSignal;
}

export interface EngineStatus {
  available: boolean;
  /** Resolved binary path, endpoint URL, or module path. */
  location?: string;
  version?: string;
  /** Why the engine is unusable, and what to do about it. */
  reason?: string;
}

export interface SimEngine {
  readonly id: string;
  readonly label: string;
  status(): Promise<EngineStatus>;
  run(input: EngineRunInput, hooks: EngineHooks): Promise<{ result: SimResult; reportPath?: string }>;
}

export class EngineUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineUnavailableError';
  }
}
