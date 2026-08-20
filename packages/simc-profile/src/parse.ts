import {
  GEAR_SLOTS,
  SIMC_CLASSES,
  type CurrencyAmount,
  type GearItem,
  type GearSlot,
  type SimcClass,
  type SimcProfile,
  type SlotWatermark,
  type TalentLoadout,
} from './types.js';

const GEAR_SLOT_SET = new Set<string>(GEAR_SLOTS);
const CLASS_SET = new Set<string>(SIMC_CLASSES);

const isGearSlot = (k: string): k is GearSlot => GEAR_SLOT_SET.has(k);
const isSimcClass = (k: string): k is SimcClass => CLASS_SET.has(k);

/** `12833/41/13696` -> [12833, 41, 13696]. Silently drops non-numeric parts. */
function numberList(value: string): number[] {
  if (!value) return [];
  return value
    .split('/')
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n));
}

/** Strips one layer of surrounding double quotes, as used by `mage="Darvage"`. */
function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Splits `key=value` on the FIRST `=` only. Required because several simc
 * directives nest their own `=` in the value (`professions=tailoring=60/...`).
 */
function splitDirective(line: string): { key: string; value: string } | null {
  const eq = line.indexOf('=');
  if (eq <= 0) return null;
  return { key: line.slice(0, eq).trim(), value: line.slice(eq + 1) };
}

/**
 * Parses `c:1792:4654` / `i:256608:9` currency-or-item amounts. Also accepts
 * the bare `3269:8` form used by catalyst_currencies, which has no prefix.
 */
function parseCurrencyList(value: string): CurrencyAmount[] {
  const out: CurrencyAmount[] = [];
  for (const token of value.split('/')) {
    const parts = token.split(':').map((p) => p.trim());
    if (parts.length === 3) {
      const [prefix, id, amount] = parts as [string, string, string];
      out.push({
        kind: prefix === 'i' ? 'item' : 'currency',
        id: Number.parseInt(id, 10),
        amount: Number.parseInt(amount, 10),
      });
    } else if (parts.length === 2) {
      const [id, amount] = parts as [string, string];
      out.push({
        kind: 'currency',
        id: Number.parseInt(id, 10),
        amount: Number.parseInt(amount, 10),
      });
    }
  }
  return out.filter((c) => Number.isFinite(c.id) && Number.isFinite(c.amount));
}

/**
 * Parses `0:292:292/1:263:263/...`.
 *
 * NOTE: the slot index space here is NOT simc's `slot_e`, nor WoW's INVSLOT
 * constants -- neither ordering reproduces this character's equipped item
 * levels, and the export omits one slot entirely. Until the mapping is
 * confirmed by diffing two exports with a known single-slot change, we keep
 * the raw index and leave `slot` undefined rather than mislabel it.
 */
function parseWatermarks(value: string): SlotWatermark[] {
  const out: SlotWatermark[] = [];
  for (const token of value.split('/')) {
    const parts = token.split(':').map((p) => Number.parseInt(p.trim(), 10));
    if (parts.length !== 3) continue;
    const [slotIndex, current, max] = parts as [number, number, number];
    if (![slotIndex, current, max].every(Number.isFinite)) continue;
    out.push({ slotIndex, current, max });
  }
  return out;
}

/**
 * Parses the value half of a gear directive:
 *   `,id=277792,bonus_id=12833/41,enchant_id=7971`
 *   `Crackling Jade Kilij,id=160216,...`
 *
 * The name is everything before the first comma. Addon exports leave it empty,
 * but manual/armory profiles include it -- and item names can themselves
 * contain commas, so any comma-token without an `=` is treated as a name
 * continuation rather than a malformed option.
 */
function parseGearValue(
  slot: GearSlot,
  value: string,
  fromBags: boolean,
): { item: GearItem; warnings: string[] } {
  const warnings: string[] = [];
  const tokens = value.split(',');

  // The name runs until the first `key=value` token. Item names may contain
  // commas, so rejoin the leading tokens with their original spacing intact
  // rather than trimming each piece.
  let firstOption = tokens.findIndex((t) => t.includes('='));
  if (firstOption === -1) firstOption = tokens.length;
  const name = tokens.slice(0, firstOption).join(',').trim();

  const item: GearItem = {
    slot,
    id: 0,
    bonusIds: [],
    gemIds: [],
    craftedStats: [],
    extra: {},
    fromBags,
  };

  for (const token of tokens.slice(firstOption)) {
    const trimmed = token.trim();
    if (!trimmed) continue;

    if (!trimmed.includes('=')) {
      warnings.push(slot + ': ignored bare token "' + trimmed + '"');
      continue;
    }

    const pair = splitDirective(trimmed);
    if (!pair) continue;
    const { key, value: raw } = pair;

    switch (key) {
      case 'id':
        item.id = Number.parseInt(raw, 10);
        break;
      case 'bonus_id':
        item.bonusIds = numberList(raw);
        break;
      case 'gem_id':
      case 'gems':
        item.gemIds = numberList(raw);
        break;
      case 'enchant_id':
        item.enchantId = Number.parseInt(raw, 10);
        break;
      case 'tempenchant_id':
      case 'temporary_enchant_id':
        item.tempEnchantId = Number.parseInt(raw, 10);
        break;
      case 'crafted_stats':
        item.craftedStats = numberList(raw);
        break;
      case 'crafting_quality':
        item.craftingQuality = Number.parseInt(raw, 10);
        break;
      case 'content_tuning':
        item.contentTuning = Number.parseInt(raw, 10);
        break;
      case 'ilevel':
        item.itemLevel = Number.parseInt(raw, 10);
        break;
      default:
        item.extra[key] = raw;
        break;
    }
  }

  if (name) item.name = name;
  if (!Number.isFinite(item.id) || item.id <= 0) {
    warnings.push(slot + ': missing or invalid item id');
    item.id = 0;
  }
  return { item, warnings };
}

/** `Venom-Cursed Dragonhawk's Plumage (292)` -> name + item level. */
const ITEM_COMMENT_RE = /^(.*?)\s*\((\d{1,4})\)$/;

type Section = 'main' | 'bags' | 'info';

/**
 * Parses a SimulationCraft addon export into a structured profile.
 *
 * Never throws on malformed input: anything unrecognised lands in
 * `unknownOptions`/`extra` and a note is appended to `warnings`, so a partially
 * corrupt SavedVariables flush still yields a usable profile.
 */
export function parseProfile(raw: string): SimcProfile {
  const profile: SimcProfile = {
    meta: {},
    talents: [],
    omniumTalents: {},
    equipped: {},
    bags: [],
    catalystCurrencies: [],
    upgradeCurrencies: [],
    slotWatermarks: [],
    upgradeAchievements: [],
    bonusRollCurrencies: [],
    unknownOptions: {},
    warnings: [],
    raw,
  };

  let section: Section = 'main';
  let pendingItemName: string | undefined;
  let pendingItemLevel: number | undefined;
  let pendingLoadoutName: string | undefined;
  let sawHeader = false;

  const applyDirective = (key: string, value: string, commented: boolean) => {
    // --- gear -------------------------------------------------------------
    if (isGearSlot(key)) {
      const fromBags = commented || section === 'bags';
      const { item, warnings } = parseGearValue(key, value, fromBags);
      if (pendingItemName && !item.name) item.name = pendingItemName;
      if (pendingItemLevel !== undefined && item.itemLevel === undefined) {
        item.itemLevel = pendingItemLevel;
      }
      pendingItemName = undefined;
      pendingItemLevel = undefined;
      profile.warnings.push(...warnings);
      if (fromBags) profile.bags.push(item);
      else profile.equipped[key] = item;
      return;
    }

    // --- class / character name -------------------------------------------
    if (isSimcClass(key)) {
      profile.class = key;
      profile.name = unquote(value);
      return;
    }

    switch (key) {
      case 'talents': {
        const hash = value.trim();
        if (!hash) return;
        const loadout: TalentLoadout = {
          name: pendingLoadoutName ?? (commented ? 'Saved Loadout' : 'Active'),
          hash,
          active: !commented,
        };
        profile.talents.push(loadout);
        pendingLoadoutName = undefined;
        return;
      }
      case 'level':
        profile.level = Number.parseInt(value, 10);
        return;
      case 'race':
        profile.race = value.trim();
        return;
      case 'region':
        profile.region = value.trim();
        return;
      case 'server':
        profile.server = value.trim();
        return;
      case 'role':
        profile.role = value.trim();
        return;
      case 'spec':
        profile.spec = value.trim();
        return;
      case 'loot_spec':
        profile.lootSpec = value.trim();
        return;
      case 'professions': {
        const professions: Record<string, number> = {};
        for (const entry of value.split('/')) {
          const pair = splitDirective(entry);
          if (!pair) continue;
          professions[pair.key.trim()] = Number.parseInt(pair.value, 10);
        }
        profile.professions = professions;
        return;
      }
      case 'omnium_talents': {
        for (const entry of value.split('/')) {
          const [id, rank] = entry.split(':').map((s) => Number.parseInt(s.trim(), 10));
          if (id !== undefined && rank !== undefined && Number.isFinite(id) && Number.isFinite(rank)) {
            profile.omniumTalents[id] = rank;
          }
        }
        return;
      }
      case 'catalyst_currencies':
        profile.catalystCurrencies = parseCurrencyList(value);
        return;
      case 'upgrade_currencies':
        profile.upgradeCurrencies = parseCurrencyList(value);
        return;
      case 'bonus_roll_currencies':
        profile.bonusRollCurrencies = parseCurrencyList(value);
        return;
      case 'slot_high_watermarks':
        profile.slotWatermarks = parseWatermarks(value);
        return;
      case 'upgrade_achievements':
        profile.upgradeAchievements = numberList(value);
        return;
      default:
        // Commented unknowns are almost always prose, not options; only keep
        // uncommented ones so we can round-trip them.
        if (!commented) profile.unknownOptions[key] = value.trim();
        return;
    }
  };

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('###')) {
      const heading = line.replace(/^#+\s*/, '').toLowerCase();
      if (heading.includes('gear from bags')) section = 'bags';
      else if (heading.includes('additional character info')) section = 'info';
      else section = 'main';
      pendingItemName = undefined;
      pendingItemLevel = undefined;
      continue;
    }

    if (line.startsWith('#')) {
      const text = line.replace(/^#+\s*/, '').trim();
      if (!text) continue;

      const loadout = /^Saved Loadout:\s*(.+)$/i.exec(text);
      if (loadout) {
        pendingLoadoutName = loadout[1]?.trim();
        continue;
      }

      const addon = /^SimC Addon\s+(.+)$/i.exec(text);
      if (addon) {
        profile.meta.addonVersion = addon[1]?.trim();
        continue;
      }

      const wow = /^WoW\s+([^,]+),\s*TOC\s+(\S+)$/i.exec(text);
      if (wow) {
        profile.meta.gameVersion = wow[1]?.trim();
        profile.meta.toc = wow[2]?.trim();
        continue;
      }

      const checksum = /^Checksum:\s*(\S+)$/i.exec(text);
      if (checksum) {
        profile.meta.checksum = checksum[1];
        continue;
      }

      if (/^Requires SimulationCraft/i.test(text)) continue;

      const directive = splitDirective(text);
      if (directive) {
        applyDirective(directive.key, directive.value, true);
        continue;
      }

      const itemComment = ITEM_COMMENT_RE.exec(text);
      if (itemComment) {
        pendingItemName = itemComment[1]?.trim();
        pendingItemLevel = Number.parseInt(itemComment[2] ?? '', 10);
        continue;
      }

      // First free-form comment is the export header:
      //   `Darvage - Frost - 2026-08-19 16:36 - US/Tichondrius`
      if (!sawHeader) {
        const parts = text.split(' - ').map((p) => p.trim());
        if (parts.length >= 2) {
          sawHeader = true;
          profile.meta.characterName = parts[0];
          profile.meta.specLabel = parts[1];
          const tail = parts[parts.length - 1] ?? '';
          if (parts.length >= 4 && tail.includes('/')) {
            profile.meta.exportedAt = parts.slice(2, -1).join(' - ');
            const [reg, srv] = tail.split('/');
            if (reg) profile.region ??= reg.toLowerCase();
            if (srv) profile.server ??= srv.toLowerCase();
          } else if (parts.length >= 3) {
            profile.meta.exportedAt = parts.slice(2).join(' - ');
          }
        }
      }
      continue;
    }

    const directive = splitDirective(line);
    if (!directive) {
      profile.warnings.push('Unparsed line: ' + line);
      continue;
    }
    applyDirective(directive.key, directive.value, false);
  }

  if (!profile.class) profile.warnings.push('No class line found (expected e.g. `mage="Name"`).');
  if (!profile.talents.some((t) => t.active)) {
    profile.warnings.push('No active talent loadout found.');
  }

  return profile;
}
