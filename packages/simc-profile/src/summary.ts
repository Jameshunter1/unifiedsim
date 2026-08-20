import {
  GEAR_SLOTS,
  type GearCandidate,
  type GearItem,
  type GearSlot,
  type GearSwapVariant,
  type ProfileVariant,
  type SimcProfile,
} from './types.js';

/** Slots that do not contribute to the equipped item level average. */
const COSMETIC_SLOTS = new Set<GearSlot>(['shirt', 'tabard']);

/** Slots that hold two interchangeable items, so a bag ring can replace either. */
const PAIRED_SLOTS: Partial<Record<GearSlot, GearSlot>> = {
  finger1: 'finger2',
  finger2: 'finger1',
  trinket1: 'trinket2',
  trinket2: 'trinket1',
};

export interface ProfileSummary {
  characterName?: string;
  className?: string;
  spec?: string;
  level?: number;
  race?: string;
  realm?: string;
  /** Mean item level across equipped non-cosmetic slots, or undefined if unknown. */
  averageItemLevel?: number;
  /** Slots the export reports as empty. */
  emptySlots: GearSlot[];
  equippedCount: number;
  bagCount: number;
  loadoutNames: string[];
  warnings: string[];
}

export function summarize(profile: SimcProfile): ProfileSummary {
  const equipped = GEAR_SLOTS.map((slot) => profile.equipped[slot]).filter(
    (item): item is GearItem => Boolean(item?.id),
  );

  const rated = equipped.filter(
    (item) => !COSMETIC_SLOTS.has(item.slot) && typeof item.itemLevel === 'number',
  );
  const averageItemLevel = rated.length
    ? Math.round((rated.reduce((sum, i) => sum + (i.itemLevel ?? 0), 0) / rated.length) * 10) / 10
    : undefined;

  const emptySlots = GEAR_SLOTS.filter(
    (slot) => !COSMETIC_SLOTS.has(slot) && !profile.equipped[slot]?.id,
  );

  return {
    characterName: profile.name ?? profile.meta.characterName,
    className: profile.class,
    spec: profile.spec ?? profile.meta.specLabel,
    level: profile.level,
    race: profile.race,
    realm: profile.server,
    averageItemLevel,
    emptySlots,
    equippedCount: equipped.length,
    bagCount: profile.bags.length,
    loadoutNames: profile.talents.map((t) => t.name),
    warnings: profile.warnings,
  };
}

/** Bag alternates grouped by the slot they would go into. */
export function bagsBySlot(profile: SimcProfile): Partial<Record<GearSlot, GearItem[]>> {
  const out: Partial<Record<GearSlot, GearItem[]>> = {};
  for (const item of profile.bags) {
    (out[item.slot] ??= []).push(item);
  }
  return out;
}

/**
 * One variant per talent loadout in the export, so a single batch answers
 * "which of my saved loadouts actually sims highest".
 */
export function talentVariants(profile: SimcProfile): ProfileVariant[] {
  return profile.talents.map((loadout) => ({
    label: loadout.name + (loadout.active ? ' (equipped)' : ''),
    talents: loadout.hash,
    baseline: loadout.active,
  }));
}

/**
 * One variant per plausible bag swap.
 *
 * A bag item is a candidate when its slot is empty, or when swapping it in
 * changes the equipped set at all -- item level alone is not a filter, since a
 * lower-ilvl trinket with the right effect routinely beats a higher-ilvl one.
 * For rings and trinkets both positions are tried, because the export always
 * reports bag alternates against the first position.
 */
export function bagSwapVariants(profile: SimcProfile): GearSwapVariant[] {
  const variants: GearSwapVariant[] = [];
  const seen = new Set<string>();

  const describe = (item: GearItem): GearCandidate => ({
    id: item.id,
    name: item.name ?? 'item ' + item.id,
    itemLevel: item.itemLevel,
  });

  for (const candidate of profile.bags) {
    if (!candidate.id) continue;
    const targets: GearSlot[] = [candidate.slot];
    const paired = PAIRED_SLOTS[candidate.slot];
    if (paired) targets.push(paired);

    for (const slot of targets) {
      const current = profile.equipped[slot];
      if (current?.id === candidate.id) continue;

      const key = slot + ':' + candidate.id + ':' + candidate.bonusIds.join('/');
      if (seen.has(key)) continue;
      seen.add(key);

      const to = describe(candidate);
      const from = current?.id ? describe(current) : undefined;
      const delta =
        to.itemLevel !== undefined && from?.itemLevel !== undefined
          ? to.itemLevel - from.itemLevel
          : undefined;

      variants.push({
        label: slot + ': ' + (from?.name ?? 'empty') + ' -> ' + to.name,
        gear: { [slot]: { ...candidate, slot, fromBags: false } },
        slot,
        candidate: to,
        replaces: from,
        itemLevelDelta: delta,
      });
    }
  }

  return variants;
}

/**
 * The profile exactly as it is equipped.
 *
 * Every gear comparison must include this run. Without it a batch of swaps has
 * nothing to measure against, and the natural fallback -- treating the lowest
 * result as the reference -- reports every option as an improvement.
 */
export function equippedBaseline(profile: SimcProfile): ProfileVariant {
  const spec = profile.meta.specLabel ?? profile.spec;
  return { label: 'Currently equipped' + (spec ? ' (' + spec + ')' : ''), baseline: true };
}

/** Gear swaps grouped by the slot they target, each slot sorted by item level. */
export function gearSwapsBySlot(profile: SimcProfile): Array<{
  slot: GearSlot;
  equipped?: GearCandidate;
  candidates: GearSwapVariant[];
}> {
  const grouped = new Map<GearSlot, GearSwapVariant[]>();
  for (const variant of bagSwapVariants(profile)) {
    const list = grouped.get(variant.slot) ?? [];
    list.push(variant);
    grouped.set(variant.slot, list);
  }

  // Emit in simc's own slot order so the list reads like a character sheet
  // rather than in whatever order the bags happened to be scanned.
  return GEAR_SLOTS.filter((slot) => grouped.has(slot)).map((slot) => {
    const equipped = profile.equipped[slot];
    return {
      slot,
      equipped: equipped?.id
        ? { id: equipped.id, name: equipped.name ?? 'item ' + equipped.id, itemLevel: equipped.itemLevel }
        : undefined,
      candidates: (grouped.get(slot) ?? []).sort(
        (a, b) => (b.candidate.itemLevel ?? 0) - (a.candidate.itemLevel ?? 0),
      ),
    };
  });
}

/**
 * Total permutation count for an exhaustive gear search, per the blueprint's
 * formula. Used to decide whether a job stays on the local engine or is worth
 * shipping to a distributed one.
 */
export function permutationCount(
  candidatesPerSlot: Partial<Record<GearSlot, number>>,
  talentCount = 1,
  gemEnchantCombos = 1,
): number {
  const choose2 = (n: number) => (n < 2 ? (n < 1 ? 1 : n) : (n * (n - 1)) / 2);

  let total = talentCount * gemEnchantCombos;
  for (const slot of GEAR_SLOTS) {
    if (slot === 'finger1' || slot === 'finger2' || slot === 'trinket1' || slot === 'trinket2') {
      continue;
    }
    total *= Math.max(1, candidatesPerSlot[slot] ?? 1);
  }

  const rings = (candidatesPerSlot.finger1 ?? 0) + (candidatesPerSlot.finger2 ?? 0);
  const trinkets = (candidatesPerSlot.trinket1 ?? 0) + (candidatesPerSlot.trinket2 ?? 0);
  total *= choose2(rings);
  total *= choose2(trinkets);

  return total;
}
