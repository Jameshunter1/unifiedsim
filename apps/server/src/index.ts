import { existsSync } from 'node:fs';
import type { Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import cors from 'cors';
import express from 'express';

import { config } from './config.js';
import { engineStatuses, refreshEngineStatuses, startEngineProbing, stopEngineProbing } from './engines/index.js';
import { parseReport } from './engines/simcReport.js';
import { events } from './events.js';
import { queue } from './queue.js';
import { profilesRouter } from './routes/profiles.js';
import { runsRouter } from './routes/runs.js';
import { store } from './store.js';
import { savedVariablesWatcher } from './watcher.js';

export interface WatchState {
  watching: boolean;
  path?: string;
  reason?: string;
  awaitingFirstExport?: boolean;
}

let watchState: WatchState = { watching: false };

export function createApp(): express.Express {
  const app = express();

  /**
   * No ETags on the API.
   *
   * Express adds them by default, so a repeated GET revalidates and comes back
   * 304 with an empty body. Every response here is live state that is cheap to
   * regenerate, so conditional caching buys nothing and costs correctness: a 304
   * is not `response.ok`, so clients see a failed request with no body.
   */
  app.set('etag', false);
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  app.use(cors());
  // Addon exports run to a few tens of KB; the default 100kb limit is too tight
  // for a profile with a full bag listing.
  app.use(express.json({ limit: '4mb' }));
  app.use(express.text({ type: 'text/plain', limit: '4mb' }));

  // Request log. Slow endpoints here are usually an engine probe waiting on a
  // stalled external tool, and without timings that looks like a UI hang.
  app.use((req, res, next) => {
    const started = Date.now();
    res.on('finish', () => {
      const ms = Date.now() - started;
      const slow = ms > 1000 ? '  <-- slow' : '';
      console.log('[http] ' + res.statusCode + ' ' + req.method + ' ' + req.originalUrl + ' ' + ms + 'ms' + slow);
    });
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      cores: config.cores,
      concurrency: config.concurrency,
      queue: queue.depth,
      engines: engineStatuses(),
      watch: watchState,
      defaults: config.simc,
      counts: {
        profiles: store.listProfiles().length,
        runs: store.listRuns().length,
      },
    });
  });

  app.get('/api/engines', (_req, res) => {
    res.json({ engines: engineStatuses() });
  });

  /** Forces an immediate re-probe, for the UI's Refresh button. */
  app.post('/api/engines/refresh', async (_req, res) => {
    await refreshEngineStatuses();
    res.json({ engines: engineStatuses() });
  });

  /**
   * Re-points the SavedVariables watcher. Used by the desktop app's native
   * file picker when auto-discovery finds the wrong install, or none.
   */
  app.post('/api/watch', (req, res) => {
    const { path: target } = (req.body ?? {}) as { path?: unknown };
    if (typeof target !== 'string' || !target.trim()) {
      res.status(400).json({ error: 'Body must include a `path` string.' });
      return;
    }
    watchState = savedVariablesWatcher.repoint(target.trim());
    res.json({ watch: watchState });
  });

  app.get('/api/events', (req, res) => {
    const unsubscribe = events.subscribe(res);
    req.on('close', unsubscribe);
  });

  app.use('/api/profiles', profilesRouter);
  app.use('/api/runs', runsRouter);

  /**
   * Serve the built UI when it exists, so `npm run build && npm start` gives you
   * the whole app on one port with no dev server. In development Vite serves the
   * UI instead and proxies /api here, so this simply does not match.
   */
  if (existsSync(path.join(config.webDist, 'index.html'))) {
    app.use(express.static(config.webDist));
    // SPA fallback, but never for /api -- an unknown API route must 404 as JSON
    // rather than silently returning the HTML shell.
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile(path.join(config.webDist, 'index.html'));
    });
    console.log('[server] serving UI from ' + config.webDist);
  }

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found.' });
  });

  app.use(
    (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      console.error('[server]', err);
      if (res.headersSent) return;
      res.status(500).json({ error: err.message });
    },
  );

  return app;
}

export interface RunningServer {
  /** The port actually bound. Differs from config.port when PORT=0. */
  port: number;
  url: string;
  watch: WatchState;
  server: Server;
  close: () => Promise<void>;
}

/**
 * Boots the whole backend and resolves once it is listening.
 *
 * Split out from the CLI entry point so the desktop app can host the server
 * inside its main process -- one process, no port handshake with a child, and
 * no orphaned server if the window dies.
 */
export async function startServer(options: { port?: number } = {}): Promise<RunningServer> {
  const stranded = store.reconcileOnBoot();
  if (stranded) console.warn('[store] marked ' + stranded + ' interrupted run(s) as errored');

  const repaired = store.repairAbilityBreakdowns(parseReport);
  if (repaired) console.log('[store] rebuilt ability breakdowns for ' + repaired + ' run(s)');

  startEngineProbing();

  watchState = savedVariablesWatcher.start();
  if (!watchState.watching && watchState.reason) console.log('[watch] inactive: ' + watchState.reason);

  const app = createApp();
  const desiredPort = options.port ?? config.port;

  const server = await new Promise<Server>((resolve, reject) => {
    const listener = app.listen(desiredPort, '127.0.0.1');
    listener.once('listening', () => resolve(listener));
    listener.once('error', reject);
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : desiredPort;
  const url = 'http://127.0.0.1:' + port;

  console.log('[server] ' + url);
  console.log('[server] ' + config.cores + ' cores, ' + config.simc.threads + ' sim threads');

  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    queue.abortAll();
    stopEngineProbing();
    savedVariablesWatcher.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };

  return { port, url, watch: watchState, server, close };
}

/** True when this module was launched directly rather than imported. */
function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return path.resolve(entry) === path.resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  const running = await startServer();

  const shutdown = (signal: string) => {
    console.log('\n[server] ' + signal + ', shutting down');
    void running.close().then(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}
