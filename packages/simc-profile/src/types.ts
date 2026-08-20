/**
 * Structured representation of a SimulationCraft addon export.
 *
 * The addon export is a lossy, human-oriented format: item names and item
 * levels only ever appear as the comment line directly above each item, and
 * alternate talent loadouts are commented out entirely. The parser preserves
 * all of it so the UI can show real names without an item database, and so
 * `serializeProfile` can round-trip a profile back to simc input text.
 */

/** SimC equipment slot tokens, in the order simc itself emits them. */
export const GEAR_SLOTS = [
  'head',
  'neck',
  'shoulder',
  'back',
  'chest',
  'shirt',
  'tabard',
  'wrist',
  'hands',
  'waist',
  'legs',
  'feet',
  'finger1',
  'finger2',
  'trinket1',
  'trinket2',
  'main_hand',
  'off_hand',
] as const;

export type GearSlot = (typeof GEAR_SLOTS)[number];

/** Playable classes as simc spells them (the key of the `class="Name"` line). */
export const SIMC_CLASSES = [
  'deathknight',
  'demonhunter',
  'druid',
  'evoker',
  'hunter',
  'mage',
  'monk',
  'paladin',
  'priest',
  'rogue',
  'shaman',
  'warlock',
  'warrior',
] as const;

export type SimcClass = (typeof SIMC_CLASSES)[number];

export interface GearItem {
  slot: GearSlot;
  /** Numeric item id. */
  id: number;
  /**
   * Item name. simc leaves this empty in addon exports (`head=,id=...`), so
   * this is usually recovered from the preceding comment line instead.
   */
  name?: string;
  /** Item level, recovered from the preceding comment line. Not authoritative. */
  itemLevel?: number;
  bonusIds: number[];
  gemIds: number[];
  enchantId?: number;
  /** Temporary enchant / weapon imbue id. */
  tempEnchantId?: number;
  craftedStats: number[];
  craftingQuality?: number;
  contentTuning?: number;
  /** Any `key=value` pair the parser did not model, preserved for round-trip. */
  extra: Record<string, string>;
  /** True when the item came from the commented `### Gear from Bags` block. */
  fromBags: boolean;
}

export interface TalentLoadout {
  /** Loadout name from `# Saved Loadout: <name>`, or "Active" for the live one. */
  name: string;
  /** Base64-ish talent import string. */
  hash: string;
  /** The loadout currently equipped in game (the uncommented `talents=` line). */
  active: boolean;
}

export interface CurrencyAmount {
  /** `c` for currency, `i` for item, from `upgrade_currencies`. */
  kind: 'currency' | 'item';
  id: number;
  amount: number;
}

/** One entry of `slot_high_watermarks=<slotIndex>:<current>:<max>`. */
export interface SlotWatermark {
  slotIndex: number;
  slot?: GearSlot;
  current: number;
  max: number;
}

export interface ProfileMeta {
  /** Header comment: `# Darvage - Frost - 2026-08-19 16:36 - US/Tichondrius`. */
  characterName?: string;
  specLabel?: string;
  exportedAt?: string;
  addonVersion?: string;
  gameVersion?: string;
  toc?: string;
  checksum?: string;
}

export interface SimcProfile {
  meta: ProfileMeta;
  class?: SimcClass;
  name?: string;
  level?: number;
  race?: string;
  region?: string;
  server?: string;
  role?: string;
  spec?: string;
  lootSpec?: string;
  professions?: Record<string, number>;
  talents: TalentLoadout[];
  omniumTalents: Record<number, number>;
  /** Equipped gear, keyed by slot. */
  equipped: Partial<Record<GearSlot, GearItem>>;
  /** Alternates from the `### Gear from Bags` block, in export order. */
  bags: GearItem[];
  catalystCurrencies: CurrencyAmount[];
  upgradeCurrencies: CurrencyAmount[];
  slotWatermarks: SlotWatermark[];
  upgradeAchievements: number[];
  bonusRollCurrencies: CurrencyAmount[];
  /** Top-level `key=value` lines the parser did not model. */
  unknownOptions: Record<string, string>;
  /** Non-fatal problems found while parsing. */
  warnings: string[];
  /** The exact text this profile was parsed from. */
  raw: string;
}

/**
 * A single point in the DPS-over-time history: a profile plus the deltas that
 * distinguish this run from the baseline profile.
 */
export interface ProfileVariant {
  /** Human label, e.g. "Frost Raid loadout" or "trinket2 -> Tangle of Vibrant Vines". */
  label: string;
  /** Replace the active talent hash. */
  talents?: string;
  /** Swap items in by slot. Overrides whatever is equipped. */
  gear?: Partial<Record<GearSlot, GearItem>>;
  /** Raw simc option lines appended verbatim, e.g. `fight_style=DungeonSlice`. */
  extraOptions?: string[];
  /**
   * This run is the reference the others are measured against.
   *
   * Explicit rather than inferred from the label: deltas are meaningless
   * without a reference, and guessing one from text meant a batch of gear
   * swaps silently compared everything against its own worst result.
   */
  baseline?: boolean;
}

/** An item as shown in a gear comparison: enough to label and rank a row. */
export interface GearCandidate {
  id: number;
  name: string;
  itemLevel?: number;
}

/**
 * A gear variant, carrying the structure the UI needs to group and rank it.
 *
 * The label alone was not enough: grouping by slot meant parsing it back apart,
 * and showing an item level delta meant it was not there at all.
 */
export interface GearSwapVariant extends ProfileVariant {
  slot: GearSlot;
  /** The item being tried. */
  candidate: GearCandidate;
  /** What it displaces, absent when the slot is empty. */
  replaces?: GearCandidate;
  /** Candidate item level minus current, when both are known. */
  itemLevelDelta?: number;
}
