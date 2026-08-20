import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import { serializeProfile, type GearItem, type GearSlot, type SimcProfile } from '@usim/simc-profile';

import { config } from '../config.js';
import { locateSimc } from './locate.js';

const execFileAsync = promisify(execFile);

/**
 * Per-item stats, straight from simc.
 *
 * This is the authoritative source: simc applies the bonus IDs itself, using
 * the same client data it sims with, so the numbers match what the item
 * actually is. No API key, no network, and no second item database to keep in
 * step with the game.
 *
 * Note what is *not* here: armor and weapon damage. simc does not report them
 * per item because they do not feed a DPS calculation. Anything needing those
 * has to come from an external source.
 */
export interface ItemStats {
  itemLevel?: number;
  /** Primary stat, whichever one this item carries. */
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

/** Keyed `slot:itemId`, which is how the UI looks an item up. */
export type GearStatsMap = Record<string, ItemStats>;

export interface GearStatsResult {
  stats: GearStatsMap;
  /**
   * Items this character cannot equip, keyed the same way.
   *
   * The in-game addon exports everything in your bags, including armour of the
   * wrong class -- a mage's bags routinely hold mail and plate. simc rejects
   * those outright ("Slot 'legs': Invalid type"), so it is the authority on
   * what is actually wearable, and offering them as gear comparisons would
   * just fail the run with a confusing error.
   */
  unequippable: string[];
  /**
   * Items simc accepted but produced no gear entry for.
   *
   * A third outcome, distinct from the other two and easy to lose: simc raises
   * no error, it simply resolves the item to nothing. A Bright Linen Fishing
   * Hat does this -- it is equippable and carries no stats worth modelling. The
   * distinction matters because "we could not read this" and "this cannot be
   * worn" are different things to tell someone.
   */
  unresolved: string[];
}

export const statsKey = (slot: string, itemId: number) => slot + ':' + itemId;

/** simc's report names two slots differently from its own profile tokens. */
const REPORT_SLOT_TO_TOKEN: Record<string, GearSlot> = {
  shoulders: 'shoulder',
  wrists: 'wrist',
};

interface ReportGearEntry {
  name?: string;
  encoded_item?: string;
  ilevel?: number;
  intellect?: number;
  agility?: number;
  strength?: number;
  agiint?: number;
  stragiint?: number;
  stamina?: number;
  crit_rating?: number;
  haste_rating?: number;
  mastery_rating?: number;
  versatility_rating?: number;
  leech_rating?: number;
  speed_rating?: number;
  avoidance_rating?: number;
}

function toItemStats(entry: ReportGearEntry): ItemStats {
  // `agiint` and `stragiint` are simc's flexible primary stats, used by items
  // that grant whichever your spec scales with. Fold them into the one the
  // player actually gets rather than inventing a third row in the tooltip.
  const flexible = entry.agiint ?? entry.stragiint;
  return {
    itemLevel: entry.ilevel,
    intellect: entry.intellect ?? flexible,
    agility: entry.agility,
    strength: entry.strength,
    stamina: entry.stamina,
    crit: entry.crit_rating,
    haste: entry.haste_rating,
    mastery: entry.mastery_rating,
    versatility: entry.versatility_rating,
    leech: entry.leech_rating,
    speed: entry.speed_rating,
    avoidance: entry.avoidance_rating,
  };
}

/** Extracts the item id simc echoed back, so stats bind to the right item. */
function itemIdOf(entry: ReportGearEntry): number | undefined {
  const match = /(?:^|,)id=(\d+)/.exec(entry.encoded_item ?? '');
  return match ? Number.parseInt(match[1]!, 10) : undefined;
}

/**
 * Runs simc purely to read gear back out.
 *
 * One iteration of a one-second fight: simc still loads its client data and
 * resolves every item, which is the part we want, and skips essentially all of
 * the simulation. Measured at ~0.3s per pass.
 */
async function readGear(
  profileText: string,
  workDir: string,
  tag: string,
): Promise<Record<string, ReportGearEntry>> {
  const located = await locateSimc();
  if (!located || located.error) throw new Error(located?.error ?? 'No simc binary available.');

  const profilePath = path.join(workDir, 'stats-' + tag + '.simc');
  const reportPath = path.join(workDir, 'stats-' + tag + '.json');
  writeFileSync(profilePath, profileText, 'utf8');

  try {
    await execFileAsync(
      located.binary,
      [profilePath, 'json2=' + reportPath, 'threads=1', 'iterations=1', 'max_time=1'],
      { timeout: 120_000, windowsHide: true, maxBuffer: 1024 * 1024 * 8 },
    );
    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as {
      sim?: { players?: Array<{ gear?: Record<string, ReportGearEntry> }> };
    };
    return report.sim?.players?.[0]?.gear ?? {};
  } finally {
    rmSync(profilePath, { force: true });
    rmSync(reportPath, { force: true });
  }
}

/**
 * Stats for everything equipped plus every bag alternate.
 *
 * Candidates are packed across slots rather than simmed one at a time: pass N
 * equips the Nth alternate in every slot that has one, so the number of simc
 * invocations is the *deepest* slot, not the total number of items. For the
 * reference profile that is 5 passes for 34 items instead of 34.
 */
export async function computeGearStats(profile: SimcProfile): Promise<GearStatsResult> {
  const workDir = path.join(config.dataDir, 'gear-stats');
  mkdirSync(workDir, { recursive: true });

  const out: GearStatsMap = {};
  const unequippable = new Set<string>();
  const unresolved = new Set<string>();

  /** Anything asked for that no pass produced stats for. */
  const noteMissing = (expected: Map<GearSlot, number>) => {
    for (const [slot, id] of expected) {
      const key = statsKey(slot, id);
      if (!out[key] && !unequippable.has(key)) unresolved.add(key);
    }
  };

  const absorb = (gear: Record<string, ReportGearEntry>, expected: Map<GearSlot, number>) => {
    for (const [reportSlot, entry] of Object.entries(gear)) {
      const slot = REPORT_SLOT_TO_TOKEN[reportSlot] ?? (reportSlot as GearSlot);
      const id = itemIdOf(entry);
      if (!id) continue;
      // Only record what this pass was actually asked to resolve, so a slot that
      // fell back to the equipped item cannot overwrite a candidate's entry.
      if (expected.size && expected.get(slot) !== id) continue;
      out[statsKey(slot, id)] = toItemStats(entry);
    }
  };

  // Pass 0: the equipped set.
  const equippedIds = new Map<GearSlot, number>();
  for (const [slot, item] of Object.entries(profile.equipped)) {
    if (item?.id) equippedIds.set(slot as GearSlot, item.id);
  }
  absorb(await readGear(serializeProfile(profile), workDir, 'equipped'), equippedIds);

  // Group bag alternates by slot, preserving order.
  const bySlot = new Map<GearSlot, GearItem[]>();
  for (const item of profile.bags) {
    if (!item.id) continue;
    const list = bySlot.get(item.slot) ?? [];
    list.push(item);
    bySlot.set(item.slot, list);
  }

  const depth = Math.max(0, ...[...bySlot.values()].map((l) => l.length));
  for (let pass = 0; pass < depth; pass++) {
    const gear: Partial<Record<GearSlot, GearItem>> = {};
    const expected = new Map<GearSlot, number>();

    for (const [slot, items] of bySlot) {
      const item = items[pass];
      if (!item) continue;
      gear[slot] = { ...item, slot, fromBags: false };
      expected.set(slot, item.id);
    }
    if (!expected.size) continue;

    try {
      const text = serializeProfile(profile, { label: 'stats', gear });
      absorb(await readGear(text, workDir, 'pass' + pass), expected);
      noteMissing(expected);
    } catch {
      // One unwearable item fails the whole pass, so isolate them: retry the
      // pass an item at a time. Only costs extra runs when the bags actually
      // contain armour this character cannot use.
      for (const [slot, id] of expected) {
        const item = bySlot.get(slot)?.[pass];
        if (!item) continue;
        const single = new Map<GearSlot, number>([[slot, id]]);
        try {
          const text = serializeProfile(profile, {
            label: 'stats',
            gear: { [slot]: { ...item, slot, fromBags: false } },
          });
          absorb(await readGear(text, workDir, 'p' + pass + '-' + slot), single);
        } catch {
          unequippable.add(statsKey(slot, id));
        }
      }
      noteMissing(expected);
    }
  }

  return { stats: out, unequippable: [...unequippable], unresolved: [...unresolved] };
}
