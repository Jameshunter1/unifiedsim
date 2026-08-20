import { useEffect, useMemo, useState } from 'react';

import {
  api,
  type GearSwapVariant,
  type Health,
  type Profile,
  type ProfileDetail,
  type SlotGroup,
  type Variant,
} from '../api.ts';
import { IconExternal, IconPlay, IconSearch, IconTrash, SlotIcon } from './Icons.tsx';
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
          {active!.version?.replace(/^.*?(SimulationCraft)/i, '$1').split(' for ')[0] ?? active!.label}
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

/* --------------------------------------------------------------- profiles */

export function ProfilePanel({
  profiles,
  selectedId,
  onSelect,
  onImported,
  onDeleted,
}: {
  profiles: Profile[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onImported: () => void;
  onDeleted: () => void;
}) {
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
      onImported();
      onSelect(profile.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h2>
        Profiles
        <span className="note">{profiles.length}</span>
      </h2>

      {profiles.length === 0 && !open && (
        <div className="empty">
          Nothing imported yet. Paste a <code>/simc</code> export to start.
        </div>
      )}

      {profiles.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          {profiles.map((profile) => (
            <div
              key={profile.id}
              className="row"
              style={{
                padding: '6px 8px',
                borderRadius: 8,
                background: profile.id === selectedId ? 'var(--page)' : 'transparent',
                flexWrap: 'nowrap',
              }}
            >
              <button
                onClick={() => onSelect(profile.id)}
                style={{
                  border: 'none',
                  background: 'none',
                  padding: 0,
                  textAlign: 'left',
                  flex: 1,
                  minWidth: 0,
                }}
              >
                <div style={{ fontWeight: profile.id === selectedId ? 600 : 400 }}>{profile.label}</div>
                <div className="muted" style={{ fontSize: 11 }}>
                  {profile.averageItemLevel ? profile.averageItemLevel + ' ilvl · ' : ''}
                  {profile.source} · {new Date(profile.createdAt).toLocaleString()}
                </div>
              </button>
              <Tooltip
                content={
                  <>
                    <strong>Delete this profile</strong>
                    Also removes every simulation run recorded against it. The character in game is
                    untouched.
                  </>
                }
              >
                <button
                  className="danger-text"
                  aria-label={'Delete ' + profile.label}
                  onClick={async () => {
                    await api.deleteProfile(profile.id);
                    onDeleted();
                  }}
                >
                  <IconTrash size={13} className="icon" />
                </button>
              </Tooltip>
            </div>
          ))}
        </div>
      )}

      {open ? (
        <div className="field">
          <textarea
            rows={8}
            value={text}
            placeholder={'mage="Darvage"\nlevel=90\nspec=frost\n…'}
            onChange={(e) => setText(e.target.value)}
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
      ) : (
        <button onClick={() => setOpen(true)}>Paste a profile</button>
      )}
    </div>
  );
}

/* ------------------------------------------------------- character summary */

export function CharacterCard({ detail }: { detail: ProfileDetail }) {
  const { summary } = detail;
  const equipped = Object.values(detail.equipped).sort((a, b) => (b.itemLevel ?? 0) - (a.itemLevel ?? 0));

  return (
    <div className="card">
      <h2>Character</h2>
      <div className="stat-row" style={{ marginBottom: 14 }}>
        <div className="stat">
          <div className="label">Item level</div>
          <div className="value">{summary.averageItemLevel ?? '—'}</div>
        </div>
        <div className="stat">
          <div className="label">Spec</div>
          <div className="value" style={{ textTransform: 'capitalize' }}>
            {summary.spec ?? '—'}
          </div>
        </div>
        <div className="stat">
          <div className="label">Level</div>
          <div className="value">{summary.level ?? '—'}</div>
        </div>
        <div className="stat">
          <div className="label">Loadouts</div>
          <div className="value">{summary.loadoutNames.length}</div>
        </div>
        <div className="stat">
          <div className="label">Bag alternates</div>
          <div className="value">{summary.bagCount}</div>
        </div>
      </div>

      {summary.warnings.length > 0 && (
        <div className="banner warn" style={{ marginBottom: 12 }}>
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
    const candidates = group.candidates.map((v) => ({ ...v, label: withIlvl(v.candidate) }));
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
      <h2>
        Run
        <span className="note">
          {selected.length || 1} sim{(selected.length || 1) === 1 ? '' : 's'}
          {exhaustive > 1000 && (
            <> · exhaustive search would be {exhaustive.toLocaleString()} permutations</>
          )}
        </span>
      </h2>

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
                  <span className="muted">
                    {group.equipped ? group.equipped.name : 'empty'}
                    {group.equipped?.itemLevel ? ' · ' + group.equipped.itemLevel : ''}
                  </span>
                </div>
                <Tooltip
                  content={
                    <>
                      <strong>Compare this slot</strong>
                      Sims {group.candidates.length} alternate
                      {group.candidates.length === 1 ? '' : 's'} against what you have equipped, and
                      ranks them by DPS.
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
                    <>
                      <strong>{c.candidate.name}</strong>
                      <div className="tt-row">
                        <span>Item level</span>
                        <span>{c.candidate.itemLevel ?? 'unknown'}</span>
                      </div>
                      <div className="tt-row">
                        <span>Replaces</span>
                        <span>{c.replaces?.name ?? 'nothing'}</span>
                      </div>
                      {c.itemLevelDelta !== undefined && (
                        <div className="tt-row">
                          <span>Item level change</span>
                          <span>
                            {c.itemLevelDelta > 0 ? '+' : ''}
                            {c.itemLevelDelta}
                          </span>
                        </div>
                      )}
                      <div className="tt-note">
                        Item level is not DPS. Sim the slot to find out which actually wins.
                      </div>
                      <a
                        className="item-link"
                        href={'https://www.wowhead.com/item=' + c.candidate.id}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <IconExternal size={12} className="icon" />
                        Open on Wowhead
                      </a>
                    </>
                  }
                >
                <label className="gear-row">
                  <input
                    type="checkbox"
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
        <button className="primary" disabled={busy || !engineReady} onClick={launch}>
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
