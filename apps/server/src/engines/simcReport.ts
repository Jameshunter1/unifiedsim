import type { AbilityBreakdown, SimResult } from './types.js';

/**
 * simc reports progress on stdout as a bar that is rewritten with carriage
 * returns, e.g. `[**********------] 42 % (12 sec remain)`. Rather than depend
 * on the exact bar layout, take the last percentage in the chunk and any
 * trailing prose as the phase label.
 */
const PERCENT_RE = /(\d{1,3})\s*%/g;

export function extractProgress(chunk: string): { percent?: number; message?: string } | undefined {
  let percent: number | undefined;
  let match: RegExpExecArray | null;
  PERCENT_RE.lastIndex = 0;
  while ((match = PERCENT_RE.exec(chunk)) !== null) {
    const value = Number.parseInt(match[1] ?? '', 10);
    if (Number.isFinite(value) && value >= 0 && value <= 100) percent = value;
  }
  if (percent === undefined) return undefined;

  const tail = chunk.slice(PERCENT_RE.lastIndex).replace(/[[\]*\-=>]/g, '').trim();
  return { percent, message: tail || undefined };
}

/** Shape of the fields we read out of simc's json2 report. */
export interface SimcJsonReport {
  version?: string;
  build_date?: string;
  sim?: {
    options?: { iterations?: number };
    statistics?: { elapsed_cpu_seconds?: number; elapsed_time_seconds?: number };
    players?: Array<{
      name?: string;
      collected_data?: {
        dps?: { mean?: number; mean_std_dev?: number; stddev?: number };
        dpse?: { mean?: number };
        hps?: { mean?: number };
        prioritydps?: { mean?: number };
        fight_length?: { mean?: number };
      };
      scale_factors?: Record<string, number>;
      stats?: Array<{
        name?: string;
        num_executes?: { mean?: number };
        actual_amount?: { mean?: number };
        portion_amount?: number;
        total_intervals?: { mean?: number };
        crit_pct?: number;
        uptime?: { mean?: number };
      }>;
    }>;
  };
}

function toAbilities(report: SimcJsonReport, fightLength: number): AbilityBreakdown[] {
  const stats = report.sim?.players?.[0]?.stats ?? [];
  const rows: AbilityBreakdown[] = [];

  for (const stat of stats) {
    const amount = stat.actual_amount?.mean ?? 0;
    const executes = stat.num_executes?.mean ?? 0;
    if (!amount && !executes) continue;
    rows.push({
      name: stat.name ?? 'unknown',
      share: stat.portion_amount ?? 0,
      dps: fightLength > 0 ? amount / fightLength : 0,
      executes,
      amountPerExecute: executes > 0 ? amount / executes : 0,
      crit: stat.crit_pct,
      uptime: stat.uptime?.mean,
    });
  }

  return rows.sort((a, b) => b.dps - a.dps);
}

export function parseReport(json: string): SimResult {
  const report = JSON.parse(json) as SimcJsonReport;
  const player = report.sim?.players?.[0];
  if (!player) {
    throw new Error('simc produced a report with no players; check the profile for a missing class line.');
  }

  const collected = player.collected_data ?? {};
  const fightLength = collected.fight_length?.mean ?? 0;

  return {
    dps: collected.dps?.mean ?? 0,
    dpsError: collected.dps?.mean_std_dev ?? 0,
    dpsStdev: collected.dps?.stddev,
    dpse: collected.dpse?.mean,
    hps: collected.hps?.mean,
    priorityDps: collected.prioritydps?.mean,
    fightLength,
    iterations: report.sim?.options?.iterations,
    elapsedSeconds: report.sim?.statistics?.elapsed_time_seconds,
    engineVersion: report.version,
    abilities: toAbilities(report, fightLength),
    scaleFactors: player.scale_factors,
  };
}
