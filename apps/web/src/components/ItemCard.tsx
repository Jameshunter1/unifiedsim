import { statsKey, type GearCandidate, type GearStats, type ItemStats } from '../api.ts';
import { IconExternal } from './Icons.tsx';

/**
 * The item tooltip.
 *
 * Stats come from simc, which resolves the item's bonus IDs with the same
 * client data it sims with -- so these are the numbers the item actually has,
 * not an approximation from a second database.
 *
 * Two things are deliberately absent, because simc does not model them: armour
 * and weapon damage. Rather than guess at them, the card links out to Wowhead
 * for the full in-game tooltip.
 */

/** Display order matches the in-game tooltip: primary, stamina, then secondaries. */
const STAT_ROWS: Array<{ key: keyof ItemStats; label: string; secondary?: boolean }> = [
  { key: 'strength', label: 'Strength' },
  { key: 'agility', label: 'Agility' },
  { key: 'intellect', label: 'Intellect' },
  { key: 'stamina', label: 'Stamina' },
  { key: 'crit', label: 'Critical strike', secondary: true },
  { key: 'haste', label: 'Haste', secondary: true },
  { key: 'mastery', label: 'Mastery', secondary: true },
  { key: 'versatility', label: 'Versatility', secondary: true },
  { key: 'leech', label: 'Leech', secondary: true },
  { key: 'speed', label: 'Speed', secondary: true },
  { key: 'avoidance', label: 'Avoidance', secondary: true },
];

function signed(n: number): string {
  return (n > 0 ? '+' : '') + n.toLocaleString();
}

export function ItemCard({
  name,
  itemId,
  slot,
  itemLevel,
  stats,
  compareTo,
  replacesName,
  equipped,
}: {
  name: string;
  itemId: number;
  slot: string;
  itemLevel?: number;
  stats: GearStats | null;
  /** The item worn in this slot, so each stat can show its change. */
  compareTo?: GearCandidate;
  replacesName?: string;
  equipped?: boolean;
}) {
  const key = statsKey(slot, itemId);
  const mine = stats?.stats[key];
  const theirs = compareTo ? stats?.stats[statsKey(slot, compareTo.id)] : undefined;

  const cannotEquip = stats?.unequippable.includes(key) ?? false;
  const noStats = stats?.unresolved.includes(key) ?? false;
  const pending = !stats;

  const rows = STAT_ROWS.map((row) => {
    const value = mine?.[row.key] ?? 0;
    const other = theirs?.[row.key] ?? 0;
    return { ...row, value, delta: value - other };
  }).filter((row) => row.value > 0 || row.delta !== 0);

  return (
    <>
      <strong className="item-name">{name}</strong>

      <div className="item-sub">
        {slot.replace('_', ' ')}
        {(mine?.itemLevel ?? itemLevel) !== undefined && (
          <> &middot; item level {mine?.itemLevel ?? itemLevel}</>
        )}
        {equipped && <> &middot; equipped</>}
      </div>

      {cannotEquip ? (
        <div className="item-warn">
          Your character cannot equip this &mdash; wrong armour type. It is in your bags, but simc
          rejects it, so it is excluded from comparisons.
        </div>
      ) : noStats ? (
        <div className="item-warn">simc resolves no stats for this item.</div>
      ) : pending ? (
        <div className="tt-note">Reading stats from simc&hellip;</div>
      ) : rows.length === 0 ? (
        <div className="tt-note">No stats recorded.</div>
      ) : (
        <div className="item-stats">
          {rows.map((row) => (
            <div className="item-stat" key={row.key}>
              <span className={row.secondary ? 'sec' : 'prim'}>
                {row.value > 0 ? '+' + row.value.toLocaleString() : '—'} {row.label}
              </span>
              {theirs && row.delta !== 0 && (
                <span className={row.delta > 0 ? 'up' : 'down'}>{signed(row.delta)}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {replacesName && !equipped && (
        <div className="tt-note">Replaces {replacesName}</div>
      )}

      {!cannotEquip && (
        <div className="tt-note">
          Stat totals are not DPS. Sim the slot to find out which actually wins.
        </div>
      )}

      <a
        className="item-link"
        href={'https://www.wowhead.com/item=' + itemId}
        target="_blank"
        rel="noreferrer"
      >
        <IconExternal size={12} className="icon" />
        Full tooltip on Wowhead
      </a>
    </>
  );
}
