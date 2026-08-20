/** Types mirrored from the server. Kept narrow: only what the UI renders. */

export interface EngineStatus {
  id: string;
  label: string;
  available: boolean;
  location?: string;
  version?: string;
  reason?: string;
  /** Probe still running server-side; not a verdict yet. */
  pending?: boolean;
}

export interface Health {
  ok: boolean;
  cores: number;
  concurrency: number;
  queue: { queued: number; running: number };
  engines: EngineStatus[];
  watch: { watching: boolean; path?: string; reason?: string; awaitingFirstExport?: boolean };
  defaults: {
    iterations: number;
    targetError: number;
    fightStyle: string;
    maxTime: number;
    threads: number;
  };
  counts: { profiles: number; runs: number };
}

export interface Profile {
  id: string;
  label: string;
  source: 'paste' | 'addon' | 'file';
  createdAt: string;
  checksum?: string;
  characterName?: string;
  spec?: string;
  className?: string;
  averageItemLevel?: number;
  raw: string;
}

export interface GearItem {
  slot: string;
  id: number;
  name?: string;
  itemLevel?: number;
  bonusIds: number[];
  gemIds: number[];
  enchantId?: number;
}

export interface TalentLoadout {
  name: string;
  hash: string;
  active: boolean;
}

export interface ProfileDetail {
  profile: Profile;
  summary: {
    characterName?: string;
    className?: string;
    spec?: string;
    level?: number;
    race?: string;
    realm?: string;
    averageItemLevel?: number;
    emptySlots: string[];
    equippedCount: number;
    bagCount: number;
    loadoutNames: string[];
    warnings: string[];
  };
  equipped: Record<string, GearItem>;
  bags: Record<string, GearItem[]>;
  talents: TalentLoadout[];
  currencies: {
    upgrade: Array<{ kind: string; id: number; amount: number }>;
    catalyst: Array<{ kind: string; id: number; amount: number }>;
  };
  warnings: string[];
}

export interface Variant {
  label: string;
  talents?: string;
  gear?: Record<string, GearItem>;
  /** This run is the reference the rest of the batch is measured against. */
  baseline?: boolean;
}

export interface GearCandidate {
  id: number;
  name: string;
  itemLevel?: number;
}

export interface GearSwapVariant extends Variant {
  slot: string;
  candidate: GearCandidate;
  replaces?: GearCandidate;
  itemLevelDelta?: number;
}

/** Per-item stats, as simc resolves them with bonus IDs applied. */
export interface ItemStats {
  itemLevel?: number;
  intellect?: number;
  agility?: number;
  strength?: number;
  stamina?: number;
  crit?: number;
  haste?: number;
  mastery?: number;
  versatility?: number;
  leech?: number;
  speed?: number;
  avoidance?: number;
}

export interface GearStats {
  stats: Record<string, ItemStats>;
  /** Keys this character cannot wear -- wrong armour class. */
  unequippable: string[];
  /** Keys simc accepted but produced no stats for. */
  unresolved: string[];
}

export const statsKey = (slot: string, itemId: number) => slot + ':' + itemId;

/** Bag alternates for one slot, with whatever is currently worn there. */
export interface SlotGroup {
  slot: string;
  equipped?: GearCandidate;
  candidates: GearSwapVariant[];
}

export interface AbilityBreakdown {
  name: string;
  share: number;
  dps: number;
  executes: number;
  amountPerExecute: number;
  crit?: number;
  uptime?: number;
}

export interface SimResult {
  dps: number;
  dpsError: number;
  dpsStdev?: number;
  dpse?: number;
  fightLength?: number;
  iterations?: number;
  elapsedSeconds?: number;
  engineVersion?: string;
  abilities: AbilityBreakdown[];
  scaleFactors?: Record<string, number>;
}

export type RunStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled';

export interface SimRun {
  id: string;
  profileId: string;
  batchId?: string;
  variantLabel: string;
  isBaseline?: boolean;
  engine: string;
  status: RunStatus;
  options: {
    iterations: number;
    targetError: number;
    fightStyle: string;
    maxTime: number;
    threads: number;
  };
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  progress: number;
  progressMessage?: string;
  result?: SimResult;
  error?: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch('/api' + path, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { error: text };
  }

  if (!res.ok) {
    const message = (body as { error?: string }).error ?? 'Request failed (' + res.status + ')';
    throw new Error(message);
  }
  return body as T;
}

export const api = {
  health: () => request<Health>('/health'),

  profiles: () => request<{ profiles: Profile[] }>('/profiles'),

  profile: (id: string) => request<ProfileDetail>('/profiles/' + id),

  importProfile: (raw: string) =>
    request<{ profile: Profile; created: boolean; warnings: string[] }>('/profiles', {
      method: 'POST',
      body: JSON.stringify({ raw }),
    }),

  deleteProfile: (id: string) => request<void>('/profiles/' + id, { method: 'DELETE' }),

  variants: (id: string) =>
    request<{
      talents: Variant[];
      gear: GearSwapVariant[];
      gearBySlot: SlotGroup[];
      baseline: Variant;
      suggestedCount: number;
      exhaustiveCount: number;
    }>('/profiles/' + id + '/variants'),

  gearStats: (id: string) => request<GearStats>('/profiles/' + id + '/gear-stats'),

  runs: (profileId?: string) =>
    request<{ runs: SimRun[]; queue: { queued: number; running: number } }>(
      '/runs' + (profileId ? '?profileId=' + encodeURIComponent(profileId) : ''),
    ),

  launch: (body: {
    profileId: string;
    engine?: string;
    variants: Variant[];
    options: Partial<SimRun['options']>;
  }) =>
    request<{ batchId: string; runs: SimRun[] }>('/runs', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  cancel: (id: string) => request<{ ok: boolean }>('/runs/' + id + '/cancel', { method: 'POST' }),

  deleteRun: (id: string) => request<void>('/runs/' + id, { method: 'DELETE' }),

  log: (id: string) => request<{ lines: string[] }>('/runs/' + id + '/log'),
};

export type ServerEvent =
  | { type: 'run:created'; run: SimRun }
  | { type: 'run:progress'; runId: string; progress: number; message?: string }
  | { type: 'run:log'; runId: string; line: string }
  | { type: 'run:updated'; run: SimRun }
  | { type: 'profile:created'; profile: Profile; source: string }
  | { type: 'queue'; queued: number; running: number }
  | { type: 'hello'; now: string };
