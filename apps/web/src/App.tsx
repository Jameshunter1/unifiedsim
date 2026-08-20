import { useCallback, useEffect, useMemo, useState } from 'react';

import { api, type Health, type Profile, type ProfileDetail, type SimRun } from './api.ts';
import { CharacterPanel, EngineBanner, LaunchPanel, Welcome } from './components/Panels.tsx';
import { BatchResults, HistoryCard, RunDetail } from './components/Results.tsx';
import { Tooltip } from './components/Tooltip.tsx';
import { useEvents } from './useEvents.ts';

type Theme = 'system' | 'light' | 'dark';

function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem('usim-theme') as Theme | null) ?? 'system',
  );

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    localStorage.setItem('usim-theme', theme);
  }, [theme]);

  return [theme, setTheme];
}

export default function App() {
  const [theme, setTheme] = useTheme();

  const [health, setHealth] = useState<Health | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProfileDetail | null>(null);
  const [runs, setRuns] = useState<SimRun[]>([]);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [liveLog, setLiveLog] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refreshHealth = useCallback(() => {
    api
      .health()
      .then((h) => {
        setHealth(h);
        setLoadError(null);
      })
      .catch((err: Error) => {
        setHealth(null);
        setLoadError('Cannot reach the server: ' + err.message);
      });
  }, []);

  /** The masthead action: re-probe engines now, then re-read state. */
  const recheckEngines = useCallback(async () => {
    await api.refreshEngines().catch(() => undefined);
    refreshHealth();
  }, [refreshHealth]);

  const refreshProfiles = useCallback(async () => {
    try {
      const { profiles: list } = await api.profiles();
      setProfiles(list);
      setSelectedProfileId((current) => current ?? list[0]?.id ?? null);
      setLoadError(null);
    } catch (err) {
      // Surfaced rather than swallowed: a silently caught load failure looks
      // exactly like "you have no profiles", which is a lie the UI told once.
      setLoadError('Could not load profiles: ' + (err as Error).message);
      throw err;
    }
  }, []);

  const refreshRuns = useCallback(async (profileId: string | null) => {
    if (!profileId) {
      setRuns([]);
      return;
    }
    const { runs: list } = await api.runs(profileId);
    setRuns(list);
  }, []);

  useEffect(() => {
    refreshHealth();
    refreshProfiles().catch(() => undefined);
  }, [refreshHealth, refreshProfiles]);

  // An engine probe that misses the server's status deadline comes back as
  // `pending`. Poll until every tier has a real verdict, so starting Docker or
  // finishing a build is picked up without the user hitting Refresh.
  useEffect(() => {
    if (!health?.engines.some((e) => e.pending)) return;
    const timer = setTimeout(refreshHealth, 2000);
    return () => clearTimeout(timer);
  }, [health, refreshHealth]);

  useEffect(() => {
    if (!selectedProfileId) {
      setDetail(null);
      setRuns([]);
      return;
    }
    api.profile(selectedProfileId).then(setDetail).catch(() => setDetail(null));
    refreshRuns(selectedProfileId).catch(() => undefined);
    setBatchId(null);
    setSelectedRunId(null);
  }, [selectedProfileId, refreshRuns]);

  // Live updates. Runs are patched in place so a progress tick never reorders
  // the list or clears a selection mid-run.
  useEvents(
    useCallback(
      (event) => {
        switch (event.type) {
          case 'run:created':
            if (event.run.profileId === selectedProfileId) {
              setRuns((prev) => [event.run, ...prev.filter((r) => r.id !== event.run.id)]);
            }
            break;

          case 'run:updated':
            setRuns((prev) => {
              const exists = prev.some((r) => r.id === event.run.id);
              if (!exists) {
                return event.run.profileId === selectedProfileId ? [event.run, ...prev] : prev;
              }
              return prev.map((r) => (r.id === event.run.id ? event.run : r));
            });
            break;

          case 'run:progress':
            setRuns((prev) =>
              prev.map((r) =>
                r.id === event.runId
                  ? { ...r, progress: event.progress, progressMessage: event.message }
                  : r,
              ),
            );
            break;

          case 'run:log':
            if (event.runId === selectedRunId) {
              setLiveLog((prev) => [...prev.slice(-399), event.line]);
            }
            break;

          case 'profile:created':
            refreshProfiles().catch(() => undefined);
            break;

          case 'queue':
            setHealth((prev) =>
              prev ? { ...prev, queue: { queued: event.queued, running: event.running } } : prev,
            );
            break;

          default:
            break;
        }
      },
      [selectedProfileId, selectedRunId, refreshProfiles],
    ),
  );

  // A newly launched batch becomes the focused one, and the first finished run
  // in it opens automatically so the detail pane is never empty after a run.
  useEffect(() => {
    if (selectedRunId) return;
    const candidate = runs.find((r) => r.status === 'done' && (!batchId || r.batchId === batchId));
    if (candidate) setSelectedRunId(candidate.id);
  }, [runs, batchId, selectedRunId]);

  const selectedRun = useMemo(
    () => runs.find((r) => r.id === selectedRunId) ?? null,
    [runs, selectedRunId],
  );

  const selectRun = useCallback((id: string) => {
    setSelectedRunId(id);
    setLiveLog([]);
  }, []);

  const doneRuns = useMemo(() => runs.filter((r) => r.status === 'done' && r.result), [runs]);
  const bestDps = useMemo(
    () => (doneRuns.length ? Math.max(...doneRuns.map((r) => r.result!.dps)) : undefined),
    [doneRuns],
  );

  const importAndSelect = useCallback(
    (id: string) => {
      refreshProfiles()
        .catch(() => undefined)
        .finally(() => setSelectedProfileId(id));
    },
    [refreshProfiles],
  );

  const queue = health?.queue;
  const hasProfiles = profiles.length > 0;

  return (
    <div className="app">
      <header className="masthead">
        <h1>UnifiedSim</h1>
        <span className="sub">local SimulationCraft runner</span>
        <span className="spacer" />
        {queue && (queue.running > 0 || queue.queued > 0) && (
          <span className="pill">
            <span className="dot" style={{ background: 'var(--series-1)' }} aria-hidden="true" />
            {queue.running} running · {queue.queued} queued
          </span>
        )}
        <select
          aria-label="Theme"
          value={theme}
          onChange={(e) => setTheme(e.target.value as Theme)}
          style={{ width: 'auto' }}
        >
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
        <Tooltip
          content={
            <>
              <strong>Re-check engines</strong>
              Probes each simulation backend again right now, instead of waiting for the periodic
              sweep. Use it after starting Docker or installing SimulationCraft.
            </>
          }
        >
          <button onClick={() => void recheckEngines()}>Re-check engines</button>
        </Tooltip>
      </header>

      {loadError && (
        <div className="banner bad">
          <span className="icon" aria-hidden="true">
            ✕
          </span>
          <div>
            <strong>{loadError}</strong>
            <div className="muted" style={{ fontSize: 12 }}>
              Is the server running? <code>npm run dev:server</code>
            </div>
          </div>
        </div>
      )}

      <EngineBanner health={health} />

      {!hasProfiles ? (
        <Welcome onImported={importAndSelect} />
      ) : (
        <div className="workspace">
          <aside className="setup">
            <CharacterPanel
              profiles={profiles}
              selectedId={selectedProfileId}
              detail={detail}
              bestDps={bestDps}
              onSelect={setSelectedProfileId}
              onImported={importAndSelect}
              onDeleted={() => {
                setSelectedProfileId(null);
                refreshProfiles().catch(() => undefined);
              }}
            />

            {selectedProfileId && (
              <LaunchPanel
                profileId={selectedProfileId}
                health={health}
                onLaunched={(id) => {
                  setBatchId(id);
                  setSelectedRunId(null);
                  refreshRuns(selectedProfileId).catch(() => undefined);
                }}
              />
            )}
          </aside>

          <main className="results-col">
            {runs.length === 0 ? (
              // One purposeful hint instead of three cards of unreachable
              // empty states stacked down the column.
              <div className="card">
                <h2>Results</h2>
                <div className="empty">
                  Pick talent loadouts or gear swaps on the left and run — results land here,
                  ranked against your equipped baseline.
                </div>
              </div>
            ) : (
              <>
                <BatchResults
                  runs={runs}
                  batchId={batchId}
                  onSelectRun={selectRun}
                  selectedRunId={selectedRunId}
                />
                {selectedRun && (
                  <RunDetail
                    run={selectedRun}
                    liveLog={selectedRun.status === 'running' ? liveLog : []}
                  />
                )}
                {doneRuns.length > 0 && <HistoryCard runs={runs} onSelectRun={selectRun} />}
              </>
            )}
          </main>
        </div>
      )}
    </div>
  );
}
