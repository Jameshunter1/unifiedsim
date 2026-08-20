import { dockerSimcEngine } from './dockerSimc.js';
import { localSimcEngine } from './localSimc.js';
import type { EngineHooks, EngineRunInput, EngineStatus, SimEngine, SimResult } from './types.js';

/**
 * Placeholder for a backend that is designed but not implemented.
 *
 * It reports itself unavailable with the reason, so the UI can show the tier
 * greyed out with an honest explanation instead of the seam being invisible.
 */
class PlannedEngine implements SimEngine {
  constructor(
    readonly id: string,
    readonly label: string,
    private readonly reason: string,
  ) {}

  async status(): Promise<EngineStatus> {
    return { available: false, reason: this.reason };
  }

  async run(_input: EngineRunInput, _hooks: EngineHooks): Promise<{ result: SimResult }> {
    throw new Error(this.label + ' is not implemented yet: ' + this.reason);
  }
}

export const wasmEngine = new PlannedEngine(
  'wasm',
  'Browser (WebAssembly)',
  'Requires a simc.wasm build. See engine-wasm/README.md for the Emscripten toolchain and build steps.',
);

export const cloudEngine = new PlannedEngine(
  'cloud',
  'Distributed workers',
  'No worker endpoint configured. This tier is for combinatorial searches that exceed one machine.',
);

/**
 * Preference order when the caller does not name an engine.
 *
 * A native binary beats a container when both work -- no mount, no daemon, no
 * per-run container start. Docker is the fallback that keeps working when the
 * OS refuses to execute an unsigned native build.
 */
const PREFERENCE = [localSimcEngine.id, dockerSimcEngine.id, wasmEngine.id, cloudEngine.id];

export const engines: Record<string, SimEngine> = {
  [localSimcEngine.id]: localSimcEngine,
  [dockerSimcEngine.id]: dockerSimcEngine,
  [wasmEngine.id]: wasmEngine,
  [cloudEngine.id]: cloudEngine,
};

export function getEngine(id: string): SimEngine | undefined {
  return engines[id];
}

/**
 * The first engine that can actually run, or undefined if none can.
 *
 * Reads the cache. If nothing has been probed yet it waits for one sweep --
 * launching a run is a deliberate action, so a one-off wait there is fine in a
 * way that a wait on every health poll is not.
 */
export async function resolveDefaultEngine(): Promise<SimEngine | undefined> {
  if (!statusCache.size) await refreshEngineStatuses();
  for (const id of PREFERENCE) {
    if (statusCache.get(id)?.available) return engines[id];
  }
  return undefined;
}

export interface EngineStatusRow extends EngineStatus {
  id: string;
  label: string;
  /** No probe has completed yet; this row is not a verdict. */
  pending?: boolean;
}

/**
 * Engine status is cached and refreshed in the background, never probed inside
 * a request.
 *
 * Probing means executing an external tool, and libuv spawns processes
 * synchronously on the event loop: when Windows takes several seconds to refuse
 * a policy-blocked binary, `uv_spawn` stalls the entire server for that long --
 * long enough that even a timeout racing the probe cannot fire. So no request
 * handler is allowed to trigger one.
 */
const statusCache = new Map<string, EngineStatusRow>();
let refreshing: Promise<void> | undefined;
let refreshTimer: NodeJS.Timeout | undefined;

/** How often the background refresher re-checks. */
const REFRESH_INTERVAL_MS = 20_000;

/** Cached statuses. Rows are `pending` until their first probe lands. */
export function engineStatuses(): EngineStatusRow[] {
  return PREFERENCE.map((id) => {
    const engine = engines[id]!;
    return (
      statusCache.get(id) ?? {
        id: engine.id,
        label: engine.label,
        available: false,
        pending: true,
        reason: 'Checking…',
      }
    );
  });
}

/**
 * Re-probes every engine, one at a time.
 *
 * Sequential on purpose: a parallel sweep would queue several blocking spawns
 * back to back and stall the loop for their combined duration.
 */
export async function refreshEngineStatuses(): Promise<void> {
  refreshing ??= (async () => {
    for (const id of PREFERENCE) {
      const engine = engines[id]!;
      try {
        statusCache.set(id, { id: engine.id, label: engine.label, ...(await engine.status()) });
      } catch (err) {
        statusCache.set(id, {
          id: engine.id,
          label: engine.label,
          available: false,
          reason: (err as Error).message,
        });
      }
    }
  })().finally(() => {
    refreshing = undefined;
  });

  return refreshing;
}

/** Starts background probing. Safe to call once at boot. */
export function startEngineProbing(): void {
  void refreshEngineStatuses();
  refreshTimer ??= setInterval(() => void refreshEngineStatuses(), REFRESH_INTERVAL_MS);
  refreshTimer.unref();
}

export function stopEngineProbing(): void {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = undefined;
}

export * from './types.js';
