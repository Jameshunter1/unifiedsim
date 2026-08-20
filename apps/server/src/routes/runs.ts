import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { Router } from 'express';

import { parseProfile, serializeProfile, type ProfileVariant } from '@usim/simc-profile';

import { config } from '../config.js';
import { getEngine, resolveDefaultEngine } from '../engines/index.js';
import { events } from '../events.js';
import { queue } from '../queue.js';
import { store, type RunOptions } from '../store.js';

export const runsRouter = Router();

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Merges caller-supplied options over the configured defaults, with bounds. */
function resolveOptions(input: unknown): RunOptions {
  const raw = (input ?? {}) as Partial<Record<keyof RunOptions, unknown>>;
  const int = (value: unknown, fallback: number) => {
    const n = Number.parseInt(String(value ?? ''), 10);
    return Number.isFinite(n) ? n : fallback;
  };
  const float = (value: unknown, fallback: number) => {
    const n = Number.parseFloat(String(value ?? ''));
    return Number.isFinite(n) ? n : fallback;
  };

  return {
    iterations: clamp(int(raw.iterations, config.simc.iterations), 100, 1_000_000),
    targetError: clamp(float(raw.targetError, config.simc.targetError), 0, 10),
    fightStyle: typeof raw.fightStyle === 'string' && raw.fightStyle.trim()
      ? raw.fightStyle.trim()
      : config.simc.fightStyle,
    maxTime: clamp(int(raw.maxTime, config.simc.maxTime), 10, 3600),
    threads: clamp(int(raw.threads, config.simc.threads), 1, Math.max(1, config.cores * 2)),
    desiredTargets: raw.desiredTargets === undefined
      ? undefined
      : clamp(int(raw.desiredTargets, 1), 1, 30),
    scaleFactors: Boolean(raw.scaleFactors),
  };
}

/** Only keeps the variant fields we understand; labels are required. */
function sanitizeVariants(input: unknown): ProfileVariant[] {
  if (!Array.isArray(input) || !input.length) return [{ label: 'baseline' }];
  const out: ProfileVariant[] = [];
  for (const entry of input) {
    if (!entry || typeof entry !== 'object') continue;
    const v = entry as Partial<ProfileVariant>;
    out.push({
      label: typeof v.label === 'string' && v.label.trim() ? v.label.trim() : 'variant',
      talents: typeof v.talents === 'string' ? v.talents : undefined,
      gear: v.gear && typeof v.gear === 'object' ? v.gear : undefined,
      extraOptions: Array.isArray(v.extraOptions)
        ? v.extraOptions.filter((o): o is string => typeof o === 'string')
        : undefined,
      baseline: v.baseline === true,
    });
  }
  return out.length ? out : [{ label: 'baseline' }];
}

runsRouter.get('/', (req, res) => {
  const profileId = typeof req.query.profileId === 'string' ? req.query.profileId : undefined;
  const batchId = typeof req.query.batchId === 'string' ? req.query.batchId : undefined;
  res.json({ runs: store.listRuns({ profileId, batchId }), queue: queue.depth });
});

runsRouter.post('/', async (req, res) => {
  const body = (req.body ?? {}) as {
    profileId?: unknown;
    engine?: unknown;
    options?: unknown;
    variants?: unknown;
  };

  if (typeof body.profileId !== 'string') {
    res.status(400).json({ error: 'Body must include `profileId`.' });
    return;
  }

  const stored = store.getProfile(body.profileId);
  if (!stored) {
    res.status(404).json({ error: 'No such profile.' });
    return;
  }

  // An explicit engine must work; with none named, fall back to whichever tier
  // is actually usable rather than failing on a hardcoded default.
  const requested = typeof body.engine === 'string' ? body.engine : undefined;
  const engine = requested ? getEngine(requested) : await resolveDefaultEngine();

  if (requested && !engine) {
    res.status(400).json({ error: 'Unknown engine: ' + requested });
    return;
  }
  if (!engine) {
    res.status(503).json({ error: 'No simulation engine is available. See the engine status in the header.' });
    return;
  }

  const status = await engine.status();
  if (!status.available) {
    res.status(503).json({ error: status.reason ?? engine.label + ' is unavailable.' });
    return;
  }

  const engineId = engine.id;

  const options = resolveOptions(body.options);
  const variants = sanitizeVariants(body.variants);
  const parsed = parseProfile(stored.raw);
  const batchId = randomUUID();

  const created = variants.map((variant) => {
    const profileText = serializeProfile(parsed, variant, {
      iterations: options.iterations,
      targetError: options.targetError,
      fightStyle: options.fightStyle,
      maxTime: options.maxTime,
      desiredTargets: options.desiredTargets,
      scaleFactors: options.scaleFactors,
    });

    const run = store.addRun({
      profileId: stored.id,
      batchId,
      variantLabel: variant.label,
      isBaseline: variant.baseline === true,
      engine: engineId,
      options,
    });

    events.emit({ type: 'run:created', run });
    queue.enqueue({
      runId: run.id,
      profileText,
      engineId,
      threads: options.threads,
    });
    return run;
  });

  res.status(202).json({ batchId, runs: created, queue: queue.depth });
});

runsRouter.get('/:id', (req, res) => {
  const run = store.getRun(req.params.id);
  if (!run) {
    res.status(404).json({ error: 'No such run.' });
    return;
  }
  res.json({ run });
});

runsRouter.get('/:id/log', (req, res) => {
  const run = store.getRun(req.params.id);
  if (!run) {
    res.status(404).json({ error: 'No such run.' });
    return;
  }
  res.json({ lines: queue.getLog(run.id) });
});

/** The engine's raw report, for anything the UI does not surface. */
runsRouter.get('/:id/report', (req, res) => {
  const run = store.getRun(req.params.id);
  if (!run?.reportPath) {
    res.status(404).json({ error: 'No report stored for this run.' });
    return;
  }

  // reportPath is stored relative to the data dir; make sure it stays there.
  const resolved = path.resolve(config.dataDir, run.reportPath);
  if (!resolved.startsWith(path.resolve(config.dataDir) + path.sep) || !existsSync(resolved)) {
    res.status(404).json({ error: 'Report file is missing.' });
    return;
  }

  res.type('application/json').send(readFileSync(resolved, 'utf8'));
});

runsRouter.post('/:id/cancel', (req, res) => {
  const run = store.getRun(req.params.id);
  if (!run) {
    res.status(404).json({ error: 'No such run.' });
    return;
  }
  if (run.status !== 'queued' && run.status !== 'running') {
    res.status(409).json({ error: 'Run is already ' + run.status + '.' });
    return;
  }
  queue.cancel(run.id);
  res.status(202).json({ ok: true });
});

runsRouter.delete('/:id', (req, res) => {
  const run = store.getRun(req.params.id);
  if (!run) {
    res.status(404).json({ error: 'No such run.' });
    return;
  }
  if (run.status === 'running' || run.status === 'queued') queue.cancel(run.id);
  store.deleteRun(run.id);
  res.status(204).end();
});
