import { useEffect, useMemo, useState } from 'react';

import {
  api,
  type GearSwapVariant,
  type Health,
  type Profile,
  type ProfileDetail,
  statsKey,
  type GearStats,

  type SlotGroup,
  type Variant,
} from '../api.ts';
import { IconImport, IconPlay, IconSearch, IconTrash, SlotIcon } from './Icons.tsx';
import { ItemCard } from './ItemCard.tsx';
import { Hint, Tooltip } from './Tooltip.tsx';

/* ----------------------------------------------------------------- status */

/**
 * Engine and bridge status.
 *
 * Healthy state collapses to a single line of pills. Two full-width banners
 * saying "everything is fine" cost ~140px at the top of every session and were
 * read once, on the first run. A problem still gets a full banner, because a
 * problem is the one time the detail is worth the space.
 */
export function EngineBanner({ health }: { health: Health | null }) {
  const [expanded, setExpanded] = useState(false);

  if (!health) return null;

  const watch = health.watch;
  const active = health.engines.find((e) => e.available);
  const probing = health.engines.some((e) => e.pending);
  // Only the engines a user can act on; the planned tiers are noise here.
  const actionable = health.engines.filter((e) => e.id === 'local-simc' || e.id === 'docker-simc');

  const watchNeedsAttention = !watch.watching || Boolean(watch.awaitingFirstExport);
  const healthy = Boolean(active) && !watchNeedsAttention;

  if (healthy) {
    return (
      <div className="statusbar">
        <button
          className="status-pill"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          title="Engine and addon details"
        >
          <span className="dot" style={{ background: 'var(--status-good)' }} aria-hidden="true" />
          {active!.version?.split(' for ')[0] ?? active!.label}
          <span className="muted"> · addon connected</span>
          <span className="muted" aria-hidden="true">
            {expanded ? '▴' : '▾'}
          </span>
        </button>

        {expanded && (
          <div className="status-detail mono">
            <div>{active!.location}</div>
            <div>{watch.path}</div>
            <div className="muted" style={{ fontFamily: 'var(--font)' }}>
              Run <code>/usim sync</code> in game to push a profile.
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      {!active &&
        (probing ? (
          <div className="banner">
            <span className="icon muted" aria-hidden="true">
              ◐
            </span>
            <div className="secondary">Checking simulation engines…</div>
          </div>
        ) : (
          <div className="banner warn">
            <span className="icon" aria-hidden="true">
              ⚠
            </span>
            <div>
              <strong>No simulation engine available.</strong>
              {actionable.map((e) => (
                <div key={e.id} className="secondary" style={{ fontSize: 12, marginTop: 4 }}>
                  <strong>{e.label}:</strong> {e.reason}
                </div>
              ))}
            </div>
          </div>
        ))}

      {watchNeedsAttention && (
        <div className="banner">
          <span
            className="icon"
            aria-hidden="true"
            style={{ color: watch.watching ? 'var(--status-warning)' : 'var(--text-muted)' }}
          >
            {watch.watching ? '◐' : '○'}
          </span>
          <div className="secondary">
            {watch.watching ? (
              <>
                Addon installed but has never run. Restart WoW (a new addon needs a client restart,
                not just <code>/reload</code>), enable <strong>UnifiedSim</strong>, then run{' '}
                <code>/usim sync</code>.
                <div className="muted mono" style={{ fontSize: 11, marginTop: 2 }}>
                  {watch.path}
                </div>
              </>
            ) : (
              <>
                <strong>Addon bridge inactive.</strong>{' '}
                <span className="muted">{watch.reason}</span>
                <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                  Optional — you can paste profiles by hand without it.
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {active && (
        <div className="statusbar">
          <span className="status-pill" style={{ cursor: 'default' }}>
            <span className="dot" style={{ background: 'var(--status-good)' }} aria-hidden="true" />
            {active.version?.split(' for ')[0] ?? active.label}
          </span>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------ importing profiles */

/**
 * The paste-a-profile flow, shared by the character panel and the first-run
 * welcome so both import paths behave identically.
 */
function ImportBox({ onImported }: { onImported: (id: string) => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const { profile } = await api.importProfile(text);
      setText('');
      setOpen(false);
      onImported(profile.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}>
        <IconImport size={13} className="icon" /> Paste a profile
      </button>
    );
  }

  return (
    <div className="field">
      <textarea
        rows={7}
        value={text}
        placeholder={'mage="Darvage"' + String.fromCharCode(10) + 'level=90' + String.fromCharCode(10) + 'spec=frost'}
        onChange={(e) => setText(e.target.value)}
        autoFocus
      />
      {error && (
        <div className="secondary" style={{ color: 'var(--status-critical)', fontSize: 12 }}>
          {error}
        </div>
      )}
      <div className="row">
        <button className="primary" disabled={!text.trim() || busy} onClick={submit}>
          {busy ? 'Importing…' : 'Import'}
        </button>
        <button onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}

/**
 * First run, before any profile exists.
 *
 * One card naming the three ways in, ordered by effort, instead of four cards
 * of empty states describing panels that cannot be reached yet.
 */
export function Welcome({ onImported }: { onImported: (id: string) => void }) {
  return (
    <div className="card welcome">
      <h2>Get your character in</h2>
      <ol className="routes">
        <li>
          <strong>Automatic.</strong> Install the in-game addon via{' '}
          <span className="menu-path">Tools → Install WoW addon…</span>, then type{' '}
          <code>/usim sync</code> in game. Every sync imports itself — no copying.
        </li>
        <li>
          <strong>Paste.</strong> Copy the export from the SimulationCraft addon
          (<code>/simc</code>) and paste it below.
        </li>
        <li>
          <strong>File.</strong>{' '}
          <span className="menu-path">File → Import profile from file…</span> opens a
          saved <code>.simc</code>.
        </li>
      </ol>
      <ImportBox onImported={onImported} />
    </div>
  );
}

/* ---------------------------------------------------------------- character */

/**
 * The selected character: identity, the two numbers that matter, gear, and any
 * other imported snapshots.
 *
 * Replaces the old Profiles + Character pair, which spent two cards and five
 * stat slots on this. Level is gone (constant at cap) and the loadout and
 * bag-alternate counts are gone (the Run tabs already carry both); best simmed
 * DPS sits next to item level instead, because those are the two numbers a
 * decision ever rests on.
 */
export function CharacterPanel({
  profiles,
  selectedId,
  detail,
  bestDps,
  onSelect,
  onImported,
  onDeleted,
}: {
  profiles: Profile[];
  selectedId: string | null;
  detail: ProfileDetail | null;
  bestDps?: number;
  onSelect: (id: string) => void;
  onImported: (id: string) => void;
  onDeleted: () => void;
}) {
  const current = profiles.find((p) => p.id === selectedId) ?? null;
  const summary = detail?.summary;
  const others = profiles.filter((p) => p.id !== selectedId);
  const equipped = detail
    ? Object.values(detail.equipped).sort((a, b) => (b.itemLevel ?? 0) - (a.itemLevel ?? 0))
    : [];

  if (!current) return null;

  return (
    <div className="card char-card">
      <div className="char-head">
        <div style={{ minWidth: 0 }}>
          <div className="char-name">{summary?.characterName ?? current.label}</div>
          <div className="char-sub">
            {[summary?.spec, summary?.className, summary?.realm].filter(Boolean).join(' · ')}
            {' · '}
            {current.source} {new Date(current.createdAt).toLocaleDateString()}
          </div>
        </div>
        <Tooltip
          content={
            <>
              <strong>Delete this snapshot</strong>
              Also removes every simulation run recorded against it. The character in game is
              untouched.
            </>
          }
        >
          <button
            className="danger-text"
            aria-label={'Delete ' + current.label}
            onClick={async () => {
              await api.deleteProfile(current.id);
              onDeleted();
            }}
          >
            <IconTrash size={13} className="icon" />
          </button>
        </Tooltip>
      </div>

      <div className="stat-row">
        <div className="stat">
          <div className="label">Item level</div>
          <div className="value">{summary?.averageItemLevel ?? '—'}</div>
        </div>
        <div className="stat">
          <div className="label">Best simmed</div>
          <div className="value">
            {bestDps ? (
              <>
                {Math.round(bestDps).toLocaleString()}
                <span className="unit"> dps</span>
              </>
            ) : (
              '—'
            )}
          </div>
        </div>
      </div>

      {summary && summary.warnings.length > 0 && (
        <div className="banner warn" style={{ margin: 0 }}>
          <span className="icon" aria-hidden="true">
            ⚠
          </span>
          <div className="secondary" style={{ fontSize: 12 }}>
            {summary.warnings.map((w) => (
              <div key={w}>{w}</div>
            ))}
          </div>
        </div>
      )}

      {detail && (
        <details>
          <summary className="muted" style={{ cursor: 'pointer', fontSize: 12 }}>
            Equipped gear
          </summary>
          <div className="scroll-x" style={{ marginTop: 8 }}>
            <table>
              <thead>
                <tr>
                  <th>Slot</th>
                  <th>Item</th>
                  <th className="num">ilvl</th>
                </tr>
              </thead>
              <tbody>
                {equipped.map((item) => (
                  <tr key={item.slot}>
                    <td className="muted">{item.slot}</td>
                    <td>{item.name ?? 'item ' + item.id}</td>
                    <td className="num">{item.itemLevel ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {others.length > 0 && (
        <details>
          <summary className="muted" style={{ cursor: 'pointer', fontSize: 12 }}>
            Other snapshots ({others.length})
          </summary>
          <div className="snapshots">
            {others.map((profile) => (
              <button key={profile.id} className="snapshot-row" onClick={() => onSelect(profile.id)}>
                <span className="snap-label">{profile.label}</span>
                <span className="muted">
                  {profile.averageItemLevel ? profile.averageItemLevel + ' · ' : ''}
                  {profile.source} {new Date(profile.createdAt).toLocaleDateString()}
                </span>
              </button>
            ))}
          </div>
        </details>
      )}

      <ImportBox onImported={onImported} />
    </div>
  );
}

/* ----------------------------------------------------------- launch panel */

export interface LaunchOptions {
  fightStyle: string;
  iterations: number;
  targetError: number;
  maxTime: number;
  desiredTargets: number;
}

const FIGHT_STYLES = ['Patchwerk', 'DungeonSlice', 'DungeonRoute', 'HeavyMovement', 'HecticAddCleave', 'CleaveAdd'];

export function LaunchPanel({
  profileId,
  health,
  onLaunched,
}: {
  profileId: string;
  health: Health | null;
  onLaunched: (batchId: string) => void;
}) {
  const [talentVariants, setTalentVariants] = useState<Variant[]>([]);
  const [gearVariants, setGearVariants] = useState<GearSwapVariant[]>([]);
  const [gearBySlot, setGearBySlot] = useState<SlotGroup[]>([]);
  const [baseline, setBaseline] = useState<Variant>({ label: 'Currently equipped', baseline: true });
  const [exhaustive, setExhaustive] = useState(0);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<'talents' | 'gear'>('talents');
  const [filter, setFilter] = useState('');
  const [gearStats, setGearStats] = useState<GearStats | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [options, setOptions] = useState<LaunchOptions>({
    fightStyle: 'Patchwerk',
    iterations: 10000,
    targetError: 0.2,
    maxTime: 300,
    desiredTargets: 1,
  });

  useEffect(() => {
    setPicked(new Set());
    setFilter('');
    setError(null);
    api
      .variants(profileId)
      .then((v) => {
        setTalentVariants(v.talents);
        setGearVariants(v.gear);
        setGearBySlot(v.gearBySlot);
        setBaseline(v.baseline);
        setExhaustive(v.exhaustiveCount);
      })
      .catch((err) => setError((err as Error).message));

    // Item stats come from simc itself, which takes a few seconds the first
    // time per profile. Fetched separately so the picker is usable immediately
    // and fills in; a failure here degrades to item level rather than blocking.
    setGearStats(null);
    api
      .gearStats(profileId)
      .then(setGearStats)
      .catch(() => setGearStats(null));
  }, [profileId]);

  useEffect(() => {
    if (!health) return;
    setOptions((o) => ({
      ...o,
      iterations: health.defaults.iterations,
      targetError: health.defaults.targetError,
      fightStyle: health.defaults.fightStyle,
      maxTime: health.defaults.maxTime,
    }));
  }, [health]);

  const all = useMemo(() => [...talentVariants, ...gearVariants], [talentVariants, gearVariants]);
  const selected = useMemo(() => all.filter((v) => picked.has(v.label)), [all, picked]);

  const toggle = (label: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });

  const engineReady = health?.engines.find((e) => e.id === 'local-simc')?.available ?? false;

  /**
   * Queues a batch.
   *
   * Any batch containing a gear swap gets the equipped set added as its
   * reference. A swap on its own produces one number with nothing to compare it
   * to, which is not an answer to "is this item better".
   */
  const launchVariants = async (chosen: Variant[]) => {
    setBusy(true);
    setError(null);
    try {
      const needsReference =
        chosen.some((v) => v.gear) && !chosen.some((v) => v.baseline);
      const variants = chosen.length
        ? needsReference
          ? [baseline, ...chosen]
          : chosen
        : [{ ...baseline, label: 'baseline' }];

      const { batchId } = await api.launch({
        profileId,
        variants,
        options: {
          fightStyle: options.fightStyle,
          iterations: options.iterations,
          targetError: options.targetError,
          maxTime: options.maxTime,
          ...(options.desiredTargets > 1 ? { desiredTargets: options.desiredTargets } : {}),
        } as never,
      });
      onLaunched(batchId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const launch = () => launchVariants(selected);

  /**
   * Sims every alternate for one slot against what is worn there.
   *
   * Labels drop the slot and the displaced item, because every row in the
   * comparison shares them -- what varies is the candidate, so that is the label.
   */
  const simSlot = (group: SlotGroup) => {
    const withIlvl = (c: { name: string; itemLevel?: number }) =>
      c.name + (c.itemLevel ? ' (' + c.itemLevel + ')' : '');

    const reference: Variant = {
      ...baseline,
      label: group.equipped ? 'Equipped: ' + withIlvl(group.equipped) : 'Equipped: nothing',
    };
    // Skip anything simc says this character cannot wear; including it would
    // fail that run with "Invalid type" and nothing else.
    const wearable = group.candidates.filter(
      (v) => !gearStats?.unequippable.includes(statsKey(group.slot, v.candidate.id)),
    );
    const candidates = wearable.map((v) => ({ ...v, label: withIlvl(v.candidate) }));
    return launchVariants([reference, ...candidates]);
  };

  const list = tab === 'talents' ? talentVariants : gearVariants;

  const needle = filter.trim().toLowerCase();
  const visibleSlots = gearBySlot
    .map((group) => ({
      ...group,
      candidates: needle
        ? group.candidates.filter(
            (c) =>
              c.candidate.name.toLowerCase().includes(needle) ||
              group.slot.toLowerCase().includes(needle),
          )
        : group.candidates,
    }))
    .filter((group) => group.candidates.length > 0);

  return (
    <div className="card">
      <h2>Run a simulation</h2>

      <div className="tabs">
        <button aria-selected={tab === 'talents'} onClick={() => setTab('talents')}>
          Talent loadouts ({talentVariants.length})
        </button>
        <button aria-selected={tab === 'gear'} onClick={() => setTab('gear')}>
          Gear swaps ({gearVariants.length})
        </button>
      </div>

      {tab === 'talents' ? (
        <div className="checklist">
          {list.length === 0 && <div className="empty">Nothing to compare here.</div>}
          {list.map((variant) => (
            <label key={variant.label}>
              <input
                type="checkbox"
                checked={picked.has(variant.label)}
                onChange={() => toggle(variant.label)}
              />
              <span>{variant.label}</span>
            </label>
          ))}
        </div>
      ) : (
        <div className="gear">
          {gearBySlot.length === 0 && (
            <div className="empty">
              No bag alternates in this export. Run <code>/usim sync</code> with the items in your
              bags.
            </div>
          )}

          {gearBySlot.length > 0 && (
            <div className="gear-filter-wrap">
              <IconSearch size={13} className="icon" />
              <input
                className="gear-filter"
                type="search"
                value={filter}
                placeholder="Filter by item or slot…"
                onChange={(e) => setFilter(e.target.value)}
                aria-label="Filter gear alternates"
              />
            </div>
          )}

          {gearBySlot.length > 0 && visibleSlots.length === 0 && (
            <div className="empty">Nothing matches “{filter}”.</div>
          )}

          {visibleSlots.map((group) => (
            <section className="slot" key={group.slot}>
              <header className="slot-head">
                <div className="slot-id">
                  <span className="slot-name">
                    <SlotIcon slot={group.slot} size={13} className="icon" />
                    {group.slot.replace('_', ' ')}
                  </span>
                  {group.equipped ? (
                    <Tooltip
                      placement="right"
                      content={
                        <ItemCard
                          name={group.equipped.name}
                          itemId={group.equipped.id}
                          slot={group.slot}
                          itemLevel={group.equipped.itemLevel}
                          stats={gearStats}
                          equipped
                        />
                      }
                    >
                      <span className="muted equipped-name">
                        {group.equipped.name}
                        {group.equipped.itemLevel ? ' · ' + group.equipped.itemLevel : ''}
                      </span>
                    </Tooltip>
                  ) : (
                    <span className="muted">empty</span>
                  )}
                </div>
                <Tooltip
                  content={
                    <>
                      <strong>Compare this slot</strong>
                      Sims each wearable alternate against what you have equipped, and ranks
                      them by DPS.
                      <div className="tt-note">
                        Your equipped item is always included, so the percentages mean something.
                      </div>
                    </>
                  }
                >
                  <button
                    className="primary slot-run"
                    disabled={busy || !engineReady}
                    onClick={() => simSlot(group)}
                  >
                    <IconPlay size={11} className="icon" />
                    Compare {group.candidates.length + 1}
                  </button>
                </Tooltip>
              </header>

              {group.candidates.map((c) => (
                <Tooltip
                  key={c.label}
                  placement="right"
                  content={
                    <ItemCard
                      name={c.candidate.name}
                      itemId={c.candidate.id}
                      slot={group.slot}
                      itemLevel={c.candidate.itemLevel}
                      stats={gearStats}
                      compareTo={group.equipped}
                      replacesName={c.replaces?.name}
                    />
                  }
                >
                <label
                  className={
                    'gear-row' +
                    (gearStats?.unequippable.includes(statsKey(group.slot, c.candidate.id))
                      ? ' unequippable'
                      : '')
                  }
                >
                  <input
                    type="checkbox"
                    disabled={gearStats?.unequippable.includes(statsKey(group.slot, c.candidate.id))}
                    checked={picked.has(c.label)}
                    onChange={() => toggle(c.label)}
                  />
                  <span className="gear-name">{c.candidate.name}</span>
                  <span className="gear-ilvl">{c.candidate.itemLevel ?? '—'}</span>
                  <span
                    className={
                      'gear-delta ' +
                      (c.itemLevelDelta === undefined || c.itemLevelDelta === 0
                        ? 'flat'
                        : c.itemLevelDelta > 0
                          ? 'up'
                          : 'down')
                    }
                  >
                    {c.itemLevelDelta === undefined
                      ? ''
                      : c.itemLevelDelta === 0
                        ? '='
                        : (c.itemLevelDelta > 0 ? '+' : '') + c.itemLevelDelta}
                  </span>
                </label>
                </Tooltip>
              ))}
            </section>
          ))}

          {gearBySlot.length > 0 && (
            <div className="coverage">
              {gearVariants.length} single-slot swaps
              {exhaustive > 1000 && (
                <>
                  {' · '}every combination at once would be{' '}
                  {new Intl.NumberFormat(undefined, {
                    notation: 'compact',
                    maximumFractionDigits: 1,
                  }).format(exhaustive)}{' '}
                  sims
                </>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'talents' && list.length > 0 && (
        <div className="row" style={{ marginTop: 6 }}>
          <button
            onClick={() => setPicked((p) => new Set([...p, ...list.map((v) => v.label)]))}
            style={{ fontSize: 12, padding: '3px 8px' }}
          >
            Select all
          </button>
          <button onClick={() => setPicked(new Set())} style={{ fontSize: 12, padding: '3px 8px' }}>
            Clear
          </button>
          <span className="muted" style={{ fontSize: 12 }}>
            {selected.length === 0 && 'Nothing selected — runs the profile as-is.'}
          </span>
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(115px, 1fr))',
          gap: 10,
          margin: '14px 0',
        }}
      >
        <div className="field">
          <label htmlFor="fight-style">
            Fight style
            <Hint content={<><strong>Fight style</strong>The encounter shape simc models. Patchwerk is a single target that never moves — the standard benchmark. DungeonSlice approximates a Mythic+ pull, mixing single target and packs.</>} />
          </label>
          <select
            id="fight-style"
            value={options.fightStyle}
            onChange={(e) => setOptions({ ...options, fightStyle: e.target.value })}
          >
            {FIGHT_STYLES.map((style) => (
              <option key={style} value={style}>
                {style}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="targets">
            Targets
            <Hint content={<><strong>Targets</strong>How many enemies to fight at once. Raise it to see which build or item scales into cleave; leave it at 1 for a raid boss.</>} />
          </label>
          <input
            id="targets"
            type="number"
            min={1}
            max={30}
            value={options.desiredTargets}
            onChange={(e) => setOptions({ ...options, desiredTargets: Number(e.target.value) })}
          />
        </div>
        <div className="field">
          <label htmlFor="max-time">
            Fight length (s)
            <Hint content={<><strong>Fight length</strong>Encounter duration in seconds. Cooldowns line up differently over 120s than 300s, so a long-cooldown trinket can win at one length and lose at another.</>} />
          </label>
          <input
            id="max-time"
            type="number"
            min={10}
            max={3600}
            value={options.maxTime}
            onChange={(e) => setOptions({ ...options, maxTime: Number(e.target.value) })}
          />
        </div>
        <div className="field">
          <label htmlFor="target-error">
            Target error (%)
            <Hint content={<><strong>Target error</strong>How precise the answer needs to be, as a percentage of DPS. simc keeps iterating until it converges here, then stops. 0.2% is trustworthy for ranking items; 1% is fast and fine for a rough look.</>} />
          </label>
          <input
            id="target-error"
            type="number"
            min={0}
            max={10}
            step={0.05}
            value={options.targetError}
            onChange={(e) => setOptions({ ...options, targetError: Number(e.target.value) })}
          />
        </div>
        <div className="field">
          <label htmlFor="iterations">
            Max iterations
            <Hint content={<><strong>Max iterations</strong>A ceiling, not a target. Convergence on target error almost always stops the run first — this only bounds how long a stubborn profile can take.</>} />
          </label>
          <input
            id="iterations"
            type="number"
            min={100}
            max={1000000}
            step={1000}
            value={options.iterations}
            onChange={(e) => setOptions({ ...options, iterations: Number(e.target.value) })}
          />
        </div>
      </div>

      {error && (
        <div className="secondary" style={{ color: 'var(--status-critical)', fontSize: 12, marginBottom: 8 }}>
          {error}
        </div>
      )}

      <div className="row">
        <button className="primary run-btn" disabled={busy || !engineReady} onClick={launch}>
          <IconPlay size={12} className="icon" />
          {busy ? 'Queueing…' : 'Run ' + (selected.length || 1) + ' simulation' + ((selected.length || 1) === 1 ? '' : 's')}
        </button>
        {!engineReady && <span className="muted" style={{ fontSize: 12 }}>No engine available.</span>}
        {health && (
          <span className="muted" style={{ fontSize: 12 }}>
            {health.defaults.threads} threads · {health.concurrency} job at a time
          </span>
        )}
      </div>
    </div>
  );
}
