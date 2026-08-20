import { useCallback, useEffect, useMemo, useState } from 'react';

import { api, type Health, type Profile, type ProfileDetail, type SimRun } from './api.ts';
import { CharacterCard, EngineBanner, LaunchPanel, ProfilePanel } from './components/Panels.tsx';
import { BatchResults, HistoryCard, RunDetail } from './components/Results.tsx';
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
            setHealth((prev) => (prev ? { ...prev, queue: { queued: event.queued, running: event.running } } : prev));
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

  const queue = health?.queue;

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
        <button onClick={refreshHealth}>Refresh</button>
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

      <div className="grid-2">
        <div>
          <ProfilePanel
            profiles={profiles}
            selectedId={selectedProfileId}
            onSelect={setSelectedProfileId}
            onImported={() => refreshProfiles().catch(() => undefined)}
            onDeleted={() => {
              setSelectedProfileId(null);
              refreshProfiles().catch(() => undefined);
            }}
          />

          {detail && <CharacterCard detail={detail} />}

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
        </div>

        <div>
          <BatchResults
            runs={runs}
            batchId={batchId}
            onSelectRun={selectRun}
            selectedRunId={selectedRunId}
          />
          <RunDetail run={selectedRun} liveLog={selectedRun?.status === 'running' ? liveLog : []} />
          <HistoryCard runs={runs} onSelectRun={selectRun} />
        </div>
      </div>
    </div>
  );
}
