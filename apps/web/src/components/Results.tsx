import { useEffect, useMemo, useState } from 'react';

import { api, type SimRun } from '../api.ts';
import { IconSort, IconStop } from './Icons.tsx';
import { Tooltip } from './Tooltip.tsx';
import { AbilityChart, DpsHistory, VariantComparison, fmt, useAutoScroll, type ComparisonRow } from './Charts.tsx';

const STATUS_COLOR: Record<SimRun['status'], string> = {
  queued: 'var(--text-muted)',
  running: 'var(--series-1)',
  done: 'var(--status-good)',
  error: 'var(--status-critical)',
  cancelled: 'var(--text-muted)',
};

function StatusPill({ run }: { run: SimRun }) {
  return (
    <span className="pill">
      <span className="dot" style={{ background: STATUS_COLOR[run.status] }} aria-hidden="true" />
      {run.status}
    </span>
  );
}

/** Signed delta with an arrow, so direction never rides on color alone. */
function Delta({ value }: { value: number }) {
  if (!Number.isFinite(value)) return <span className="muted">—</span>;
  const positive = value >= 0;
  return (
    <span style={{ color: positive ? 'var(--delta-good)' : 'var(--status-critical)' }}>
      {positive ? '▲' : '▼'} {positive ? '+' : ''}
      {fmt(value, 2)}%
    </span>
  );
}

/* ------------------------------------------------------------ batch result */

export function BatchResults({
  runs,
  batchId,
  onSelectRun,
  selectedRunId,
}: {
  runs: SimRun[];
  batchId: string | null;
  onSelectRun: (id: string) => void;
  selectedRunId: string | null;
}) {
  const batch = useMemo(() => {
    if (!runs.length) return [];
    const id = batchId ?? runs[0]?.batchId ?? null;
    return runs.filter((r) => r.batchId === id);
  }, [runs, batchId]);

  const [sort, setSort] = useState<{ key: 'label' | 'dps' | 'error'; dir: 'asc' | 'desc' }>({
    key: 'dps',
    dir: 'desc',
  });

  const done = batch.filter((r) => r.status === 'done' && r.result);
  const pending = batch.filter((r) => r.status === 'queued' || r.status === 'running');
  const failed = batch.filter((r) => r.status === 'error');

  const rows: ComparisonRow[] = useMemo(() => {
    // Runs created before the baseline flag existed only carry a label, so fall
    // back to reading it for those.
    const looksBaseline = (run: SimRun) =>
      run.isBaseline ?? (run.variantLabel === 'baseline' || run.variantLabel.includes('(equipped)'));
    return done
      .map((run) => ({
        label: run.variantLabel,
        dps: run.result!.dps,
        error: run.result!.dpsError,
        isBaseline: looksBaseline(run),
        runId: run.id,
      }))
      .sort((a, b) => b.dps - a.dps);
  }, [done]);

  /**
   * The reference, or nothing.
   *
   * Deliberately not falling back to another row: rows are sorted descending, so
   * the old `rows[rows.length - 1]` fallback quietly used the *worst* result as
   * the reference and reported every option as an improvement.
   */
  const baseline = rows.find((r) => r.isBaseline);
  const best = rows[0];

  // The chart is always ranked by DPS; only the table follows the chosen sort.
  const tableRows = useMemo(() => {
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) =>
      sort.key === 'label' ? a.label.localeCompare(b.label) * dir : (a[sort.key] - b[sort.key]) * dir,
    );
  }, [rows, sort]);

  const sortBy = (key: 'label' | 'dps' | 'error') =>
    setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }));

  const sortDir = (key: string) => (sort.key === key ? sort.dir : null);

  if (!batch.length) {
    return (
      <div className="card">
        <h2>Latest batch</h2>
        <div className="empty">No runs yet. Pick some variants and hit Run.</div>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>
        Latest batch
        <span className="note">
          {done.length} done
          {pending.length > 0 && ' · ' + pending.length + ' in flight'}
          {failed.length > 0 && ' · ' + failed.length + ' failed'}
        </span>
      </h2>

      {best && (
        <div style={{ marginBottom: 16 }}>
          <div className="muted" style={{ fontSize: 12 }}>
            Best: {best.label}
          </div>
          <div className="hero">
            {fmt(best.dps)}
            <span className="hero-unit">DPS ±{fmt(best.error, 1)}</span>
          </div>
          {baseline && best.runId !== baseline.runId && (
            <div style={{ fontSize: 13 }}>
              <Delta value={(best.dps / baseline.dps - 1) * 100} />{' '}
              <span className="muted">vs {baseline.label}</span>
            </div>
          )}
        </div>
      )}

      <VariantComparison rows={rows} onSelect={onSelectRun} selectedRunId={selectedRunId ?? undefined} />

      {rows.length > 1 && !baseline && (
        <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          No reference run in this batch, so there is nothing to measure against. Comparing gear
          from the Gear tab includes your equipped set automatically.
        </div>
      )}

      {/* Table view: the relief path for the sub-3:1 contrast warning, and the
          only place every number is readable without hovering. */}
      <details style={{ marginTop: 12 }} open={rows.length <= 6}>
        <summary className="muted" style={{ cursor: 'pointer', fontSize: 12 }}>
          Table view
        </summary>
        <div className="scroll-x" style={{ marginTop: 8 }}>
          <table>
            <thead>
              <tr>
                <th
                  className="sortable"
                  onClick={() => sortBy('label')}
                  aria-sort={sortDir('label') === 'asc' ? 'ascending' : sortDir('label') ? 'descending' : 'none'}
                >
                  Variant
                  <IconSort size={12} className="icon" dir={sortDir('label')} />
                </th>
                <th
                  className="num sortable"
                  onClick={() => sortBy('dps')}
                  aria-sort={sortDir('dps') === 'asc' ? 'ascending' : sortDir('dps') ? 'descending' : 'none'}
                >
                  DPS
                  <IconSort size={12} className="icon" dir={sortDir('dps')} />
                </th>
                <th className="num sortable" onClick={() => sortBy('error')}>
                  <Tooltip
                    content={
                      <>
                        <strong>Error</strong>
                        The simulation&rsquo;s own margin. Two results closer together than their
                        error bars are a tie, not a ranking.
                      </>
                    }
                  >
                    <span>Error</span>
                  </Tooltip>
                  <IconSort size={12} className="icon" dir={sortDir('error')} />
                </th>
                <th className="num">
                  <Tooltip
                    content={
                      <>
                        <strong>vs baseline</strong>
                        Percentage difference against the reference run &mdash; your equipped gear
                        or active loadout.
                      </>
                    }
                  >
                    <span>vs baseline</span>
                  </Tooltip>
                </th>
                <th className="num">
                  <Tooltip
                    content={
                      <>
                        <strong>Iterations</strong>
                        How many fights simc needed before it converged on the target error. Fewer
                        is not worse.
                      </>
                    }
                  >
                    <span>Iterations</span>
                  </Tooltip>
                </th>
                <th className="num">Time</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row) => {
                const run = batch.find((r) => r.id === row.runId)!;
                return (
                  <tr
                    key={row.runId}
                    onClick={() => onSelectRun(row.runId)}
                    style={{
                      cursor: 'pointer',
                      background: row.runId === selectedRunId ? 'var(--page)' : undefined,
                    }}
                  >
                    <td>
                      {row.label}
                      {row.isBaseline && <span className="muted"> · baseline</span>}
                    </td>
                    <td className="num">{fmt(row.dps)}</td>
                    <td className="num muted">±{fmt(row.error, 1)}</td>
                    <td className="num">
                      {baseline && row.runId !== baseline.runId ? (
                        <Delta value={(row.dps / baseline.dps - 1) * 100} />
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="num muted">{run.result?.iterations?.toLocaleString() ?? '—'}</td>
                    <td className="num muted">
                      {run.result?.elapsedSeconds ? fmt(run.result.elapsedSeconds, 1) + 's' : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>

      {(pending.length > 0 || failed.length > 0) && (
        <div style={{ marginTop: 14 }}>
          {pending.map((run) => (
            <div key={run.id} className="row" style={{ fontSize: 12, padding: '4px 0', flexWrap: 'nowrap' }}>
              <StatusPill run={run} />
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {run.variantLabel}
              </span>
              <div className="progress-track" style={{ width: 110 }}>
                <div className="progress-fill" style={{ width: run.progress + '%' }} />
              </div>
              <span className="muted" style={{ width: 34, textAlign: 'right' }}>
                {run.progress}%
              </span>
              <Tooltip content={<><strong>Stop this run</strong>The rest of the batch continues.</>}>
                <button
                  className="danger-text"
                  aria-label={'Stop ' + run.variantLabel}
                  onClick={() => api.cancel(run.id)}
                >
                  <IconStop size={11} className="icon" />
                </button>
              </Tooltip>
            </div>
          ))}
          {failed.map((run) => (
            <div key={run.id} style={{ fontSize: 12, padding: '4px 0' }}>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <StatusPill run={run} />
                <span>{run.variantLabel}</span>
              </div>
              <div className="mono" style={{ color: 'var(--status-critical)', marginTop: 2 }}>
                {run.error}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------- run detail */

export function RunDetail({ run, liveLog }: { run: SimRun | null; liveLog: string[] }) {
  const [log, setLog] = useState<string[]>([]);
  const logRef = useAutoScroll<HTMLDivElement>(liveLog.length + log.length);

  useEffect(() => {
    setLog([]);
    if (!run) return;
    api
      .log(run.id)
      .then((r) => setLog(r.lines))
      .catch(() => setLog([]));
  }, [run?.id]);

  if (!run) {
    return (
      <div className="card">
        <h2>Run detail</h2>
        <div className="empty">Select a run to see its ability breakdown.</div>
      </div>
    );
  }

  const lines = liveLog.length ? liveLog : log;

  return (
    <div className="card">
      <h2>
        {run.variantLabel}
        <span className="note">
          {run.options.fightStyle} · {run.options.maxTime}s
        </span>
      </h2>

      {run.result ? (
        <>
          <div className="stat-row" style={{ marginBottom: 14 }}>
            <div className="stat">
              <div className="label">DPS</div>
              <div className="value">{fmt(run.result.dps)}</div>
            </div>
            <div className="stat">
              <div className="label">Error</div>
              <div className="value">±{fmt(run.result.dpsError, 1)}</div>
            </div>
            <div className="stat">
              <div className="label">Iterations</div>
              <div className="value">{run.result.iterations?.toLocaleString() ?? '—'}</div>
            </div>
            <div className="stat">
              <div className="label">Fight length</div>
              <div className="value">{run.result.fightLength ? fmt(run.result.fightLength, 1) + 's' : '—'}</div>
            </div>
          </div>

          <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
            Damage share by ability
          </div>
          <AbilityChart abilities={run.result.abilities} />
        </>
      ) : (
        <div className="empty">
          {run.status === 'error' ? (
            <span style={{ color: 'var(--status-critical)' }}>{run.error}</span>
          ) : (
            'This run has no result yet.'
          )}
        </div>
      )}

      {lines.length > 0 && (
        <details style={{ marginTop: 12 }} open={run.status === 'running'}>
          <summary className="muted" style={{ cursor: 'pointer', fontSize: 12 }}>
            Engine log ({lines.length} lines)
          </summary>
          <div className="log" ref={logRef} style={{ marginTop: 8 }}>
            {lines.join('\n')}
          </div>
        </details>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- history */

export function HistoryCard({ runs, onSelectRun }: { runs: SimRun[]; onSelectRun: (id: string) => void }) {
  const done = runs.filter((r) => r.status === 'done' && r.result);

  return (
    <div className="card">
      <h2>
        DPS over time
        <span className="note">{done.length} completed runs for this profile</span>
      </h2>
      <DpsHistory runs={runs} />

      {done.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary className="muted" style={{ cursor: 'pointer', fontSize: 12 }}>
            All runs
          </summary>
          <div className="scroll-x" style={{ marginTop: 8, maxHeight: 300, overflowY: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Variant</th>
                  <th>Style</th>
                  <th className="num">DPS</th>
                </tr>
              </thead>
              <tbody>
                {done
                  .slice()
                  .sort((a, b) => (b.finishedAt ?? '').localeCompare(a.finishedAt ?? ''))
                  .map((run) => (
                    <tr key={run.id} onClick={() => onSelectRun(run.id)} style={{ cursor: 'pointer' }}>
                      <td className="muted">{new Date(run.finishedAt ?? run.createdAt).toLocaleString()}</td>
                      <td>{run.variantLabel}</td>
                      <td className="muted">{run.options.fightStyle}</td>
                      <td className="num">{fmt(run.result!.dps)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}
