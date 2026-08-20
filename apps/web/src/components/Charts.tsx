import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { AbilityBreakdown, SimRun } from '../api.ts';

/* ------------------------------------------------------------------ utils */

export const fmt = (n: number, digits = 0) =>
  n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** Compact axis ticks: 240,000 -> 240k. */
const compact = (n: number) => (Math.abs(n) >= 1000 ? fmt(n / 1000, n % 1000 === 0 ? 0 : 1) + 'k' : fmt(n));

/** Nice round tick values covering [0, max]. */
function ticks(max: number, count = 4): number[] {
  if (max <= 0) return [0];
  const rough = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? magnitude * 10;
  const out: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) out.push(v);
  return out;
}

/** Rounded on the data end only; square where it meets the baseline. */
function hBarPath(x: number, y: number, w: number, h: number, r = 4): string {
  const radius = Math.max(0, Math.min(r, w, h / 2));
  const end = x + w;
  return [
    'M', x, y,
    'H', end - radius,
    'A', radius, radius, 0, 0, 1, end, y + radius,
    'V', y + h - radius,
    'A', radius, radius, 0, 0, 1, end - radius, y + h,
    'H', x,
    'Z',
  ].join(' ');
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(640);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(node);
    setWidth(node.clientWidth);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}

interface TooltipState {
  x: number;
  y: number;
  title: string;
  rows: Array<[string, string]>;
}

function Tooltip({ state }: { state: TooltipState | null }) {
  if (!state) return null;
  // Flip to the left of the cursor near the right edge so it never clips.
  const flip = state.x > window.innerWidth - 300;
  return (
    <div
      className="chart-tooltip"
      style={{
        left: flip ? undefined : state.x + 14,
        right: flip ? window.innerWidth - state.x + 14 : undefined,
        top: state.y + 14,
      }}
    >
      <div className="t-title">{state.title}</div>
      {state.rows.map(([k, v]) => (
        <div key={k} className="muted" style={{ display: 'flex', gap: 10, justifyContent: 'space-between' }}>
          <span>{k}</span>
          <span style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------- variant comparison bars */

export interface ComparisonRow {
  label: string;
  dps: number;
  error: number;
  isBaseline: boolean;
  runId: string;
}

/**
 * Ranked horizontal bars, one per variant.
 *
 * A single measure across named entities, so every bar wears the same hue --
 * identity lives in the row labels. The baseline is drawn in muted gray so the
 * reference is findable without spending a second categorical color on it.
 */
export function VariantComparison({
  rows,
  onSelect,
  selectedRunId,
}: {
  rows: ComparisonRow[];
  onSelect?: (runId: string) => void;
  selectedRunId?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<TooltipState | null>(null);

  if (!rows.length) return <div className="empty">No completed runs in this batch yet.</div>;

  const labelWidth = Math.min(280, Math.max(140, width * 0.3));
  const valueWidth = 96;
  const rowHeight = 30;
  const barHeight = Math.min(24, rowHeight - 8);
  const padTop = 6;
  const padBottom = 22;
  const plotLeft = labelWidth + 8;
  const plotWidth = Math.max(60, width - plotLeft - valueWidth);
  const height = rows.length * rowHeight + padTop + padBottom;

  const baseline = rows.find((r) => r.isBaseline);
  const max = Math.max(...rows.map((r) => r.dps + r.error)) * 1.02;
  const scale = (v: number) => (v / max) * plotWidth;
  const axis = ticks(max, 4);

  return (
    <div ref={ref} style={{ width: '100%' }}>
      <svg width={width} height={height} role="img" aria-label="Damage per second by variant">
        {axis.map((t) => (
          <g key={t}>
            <line
              x1={plotLeft + scale(t)}
              x2={plotLeft + scale(t)}
              y1={padTop}
              y2={height - padBottom}
              stroke="var(--gridline)"
              strokeWidth={1}
            />
            <text
              x={plotLeft + scale(t)}
              y={height - padBottom + 14}
              textAnchor="middle"
              fontSize={11}
              fill="var(--text-muted)"
            >
              {compact(t)}
            </text>
          </g>
        ))}

        <line
          x1={plotLeft}
          x2={plotLeft}
          y1={padTop}
          y2={height - padBottom}
          stroke="var(--baseline)"
          strokeWidth={1}
        />

        {rows.map((row, i) => {
          const y = padTop + i * rowHeight + (rowHeight - barHeight) / 2;
          const w = Math.max(1, scale(row.dps));
          const color = row.isBaseline ? 'var(--text-muted)' : 'var(--series-1)';
          const delta = baseline && !row.isBaseline ? (row.dps / baseline.dps - 1) * 100 : null;
          const selected = row.runId === selectedRunId;

          return (
            <g
              key={row.runId}
              style={{ cursor: onSelect ? 'pointer' : 'default' }}
              onClick={() => onSelect?.(row.runId)}
              onMouseMove={(e) =>
                setTip({
                  x: e.clientX,
                  y: e.clientY,
                  title: row.label,
                  rows: [
                    ['DPS', fmt(row.dps)],
                    ['Error', '±' + fmt(row.error, 1)],
                    ...(delta !== null
                      ? ([['vs baseline', (delta >= 0 ? '+' : '') + fmt(delta, 2) + '%']] as Array<[string, string]>)
                      : []),
                  ],
                })
              }
              onMouseLeave={() => setTip(null)}
            >
              {/* Full-row hit target: bigger than the mark, per interaction spec. */}
              <rect
                x={0}
                y={padTop + i * rowHeight}
                width={Math.max(width, 1)}
                height={rowHeight}
                fill={selected ? 'var(--page)' : 'transparent'}
              />

              <text
                x={labelWidth}
                y={y + barHeight / 2 + 4}
                textAnchor="end"
                fontSize={12}
                fill={selected ? 'var(--text-primary)' : 'var(--text-secondary)'}
              >
                {row.label.length > 42 ? row.label.slice(0, 41) + '…' : row.label}
              </text>

              <path d={hBarPath(plotLeft, y, w, barHeight)} fill={color} />

              {row.error > 0 && (
                <g stroke="var(--text-secondary)" strokeWidth={1} opacity={0.75}>
                  <line
                    x1={plotLeft + scale(Math.max(0, row.dps - row.error))}
                    x2={plotLeft + scale(row.dps + row.error)}
                    y1={y + barHeight / 2}
                    y2={y + barHeight / 2}
                  />
                  <line
                    x1={plotLeft + scale(row.dps + row.error)}
                    x2={plotLeft + scale(row.dps + row.error)}
                    y1={y + barHeight / 2 - 4}
                    y2={y + barHeight / 2 + 4}
                  />
                  <line
                    x1={plotLeft + scale(Math.max(0, row.dps - row.error))}
                    x2={plotLeft + scale(Math.max(0, row.dps - row.error))}
                    y1={y + barHeight / 2 - 4}
                    y2={y + barHeight / 2 + 4}
                  />
                </g>
              )}

              {/* Value label rides outside the bar tip, so it is never clipped. */}
              <text
                x={plotLeft + plotWidth + 6}
                y={y + barHeight / 2 + 4}
                fontSize={12}
                fill="var(--text-primary)"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {fmt(row.dps)}
              </text>
            </g>
          );
        })}
      </svg>
      <Tooltip state={tip} />
    </div>
  );
}

/* ------------------------------------------------------- dps history line */

/**
 * DPS of every completed run against when it finished.
 *
 * One series, so no legend box -- the card title names what is plotted. The
 * shaded band is the simulation's own standard error, not a smoothing artefact.
 */
export function DpsHistory({ runs }: { runs: SimRun[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<TooltipState | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  const points = runs
    .filter((r) => r.status === 'done' && r.result)
    .map((r) => ({
      time: new Date(r.finishedAt ?? r.createdAt).getTime(),
      dps: r.result!.dps,
      error: r.result!.dpsError,
      label: r.variantLabel,
      run: r,
    }))
    .sort((a, b) => a.time - b.time);

  const height = 220;
  const padLeft = 52;
  const padRight = 16;
  const padTop = 12;
  const padBottom = 28;
  const plotWidth = Math.max(40, width - padLeft - padRight);
  const plotHeight = height - padTop - padBottom;

  const onMove = useCallback(
    (event: React.MouseEvent<SVGSVGElement>) => {
      if (points.length < 1) return;
      const box = event.currentTarget.getBoundingClientRect();
      const x = event.clientX - box.left - padLeft;
      const ratio = Math.max(0, Math.min(1, x / plotWidth));
      const index = Math.round(ratio * (points.length - 1));
      const point = points[index];
      if (!point) return;
      setHover(index);
      setTip({
        x: event.clientX,
        y: event.clientY,
        title: point.label,
        rows: [
          ['DPS', fmt(point.dps)],
          ['Error', '±' + fmt(point.error, 1)],
          ['Finished', new Date(point.time).toLocaleString()],
        ],
      });
    },
    [points, plotWidth],
  );

  if (points.length < 2) {
    return (
      <div ref={ref}>
        <div className="empty">
          {points.length === 0
            ? 'No completed runs yet.'
            : 'One run so far — the trend line needs at least two.'}
        </div>
      </div>
    );
  }

  const values = points.flatMap((p) => [p.dps - p.error, p.dps + p.error]);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  // Pad the band so the line never sits on the frame; keep a floor of zero only
  // when the data is genuinely near it, otherwise the variation is invisible.
  const span = Math.max(1, rawMax - rawMin);
  const yMin = Math.max(0, rawMin - span * 0.15);
  const yMax = rawMax + span * 0.15;

  const xAt = (i: number) => padLeft + (points.length === 1 ? plotWidth / 2 : (i / (points.length - 1)) * plotWidth);
  const yAt = (v: number) => padTop + plotHeight - ((v - yMin) / (yMax - yMin)) * plotHeight;

  const line = points.map((p, i) => (i === 0 ? 'M' : 'L') + xAt(i) + ' ' + yAt(p.dps)).join(' ');
  const band =
    points.map((p, i) => (i === 0 ? 'M' : 'L') + xAt(i) + ' ' + yAt(p.dps + p.error)).join(' ') +
    ' ' +
    points
      .slice()
      .reverse()
      .map((p, i) => 'L' + xAt(points.length - 1 - i) + ' ' + yAt(p.dps - p.error))
      .join(' ') +
    ' Z';

  const yTicks = ticks(yMax, 4).filter((t) => t >= yMin);
  const last = points[points.length - 1]!;

  return (
    <div ref={ref} style={{ width: '100%' }}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label="Damage per second across completed runs"
        onMouseMove={onMove}
        onMouseLeave={() => {
          setTip(null);
          setHover(null);
        }}
      >
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={padLeft} x2={width - padRight} y1={yAt(t)} y2={yAt(t)} stroke="var(--gridline)" strokeWidth={1} />
            <text x={padLeft - 8} y={yAt(t) + 4} textAnchor="end" fontSize={11} fill="var(--text-muted)">
              {compact(t)}
            </text>
          </g>
        ))}

        <path d={band} fill="var(--series-1)" opacity={0.1} />
        <path d={line} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

        {hover !== null && (
          <line
            x1={xAt(hover)}
            x2={xAt(hover)}
            y1={padTop}
            y2={padTop + plotHeight}
            stroke="var(--text-muted)"
            strokeWidth={1}
          />
        )}

        {points.map((p, i) => (
          <circle
            key={p.run.id}
            cx={xAt(i)}
            cy={yAt(p.dps)}
            r={hover === i ? 5 : 4}
            fill="var(--series-1)"
            stroke="var(--surface-1)"
            strokeWidth={2}
          />
        ))}

        {/* Only the endpoint is labelled: a number on every point reads as noise. */}
        <text
          x={xAt(points.length - 1)}
          y={yAt(last.dps) - 12}
          textAnchor="end"
          fontSize={12}
          fill="var(--text-primary)"
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {fmt(last.dps)}
        </text>

        <text x={padLeft} y={height - 8} fontSize={11} fill="var(--text-muted)">
          {new Date(points[0]!.time).toLocaleDateString()}
        </text>
        <text x={width - padRight} y={height - 8} textAnchor="end" fontSize={11} fill="var(--text-muted)">
          {new Date(last.time).toLocaleDateString()}
        </text>
      </svg>
      <Tooltip state={tip} />
    </div>
  );
}

/* ---------------------------------------------------- ability contribution */

export function AbilityChart({ abilities }: { abilities: AbilityBreakdown[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<TooltipState | null>(null);

  const rows = abilities.filter((a) => a.dps > 0).slice(0, 12);
  if (!rows.length) return <div className="empty">No ability breakdown in this report.</div>;

  const labelWidth = Math.min(220, Math.max(120, width * 0.32));
  const valueWidth = 84;
  const rowHeight = 26;
  const barHeight = Math.min(18, rowHeight - 8);
  const plotLeft = labelWidth + 8;
  const plotWidth = Math.max(40, width - plotLeft - valueWidth);
  const height = rows.length * rowHeight + 8;
  const max = Math.max(...rows.map((r) => r.dps));

  return (
    <div ref={ref} style={{ width: '100%' }}>
      <svg width={width} height={height} role="img" aria-label="Damage per second by ability">
        {rows.map((row, i) => {
          const y = i * rowHeight + (rowHeight - barHeight) / 2 + 4;
          const w = Math.max(1, (row.dps / max) * plotWidth);
          return (
            <g
              key={row.name}
              onMouseMove={(e) =>
                setTip({
                  x: e.clientX,
                  y: e.clientY,
                  title: row.name,
                  rows: [
                    ['DPS', fmt(row.dps)],
                    ['Share', fmt(row.share * 100, 1) + '%'],
                    ['Casts', fmt(row.executes, 1)],
                    ['Per cast', fmt(row.amountPerExecute)],
                    ...(row.crit !== undefined
                      ? ([['Crit', fmt(row.crit, 1) + '%']] as Array<[string, string]>)
                      : []),
                  ],
                })
              }
              onMouseLeave={() => setTip(null)}
            >
              <rect x={0} y={i * rowHeight} width={Math.max(width, 1)} height={rowHeight} fill="transparent" />
              <text x={labelWidth} y={y + barHeight / 2 + 4} textAnchor="end" fontSize={12} fill="var(--text-secondary)">
                {row.name.length > 30 ? row.name.slice(0, 29) + '…' : row.name}
              </text>
              <path d={hBarPath(plotLeft, y, w, barHeight)} fill="var(--series-1)" />
              <text
                x={plotLeft + plotWidth + 6}
                y={y + barHeight / 2 + 4}
                fontSize={12}
                fill="var(--text-primary)"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {fmt(row.share * 100, 1)}%
              </text>
            </g>
          );
        })}
      </svg>
      <Tooltip state={tip} />
    </div>
  );
}

/** Keeps a live-updating log pane pinned to the newest line. */
export function useAutoScroll<T extends HTMLElement>(dep: unknown) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const node = ref.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [dep]);
  return ref;
}
