import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  bagSwapVariants,
  bagsBySlot,
  equippedBaseline,
  gearSwapsBySlot,
  parseProfile,
  permutationCount,
  serializeProfile,
  summarize,
  talentVariants,
} from '../dist/index.js';

const FIXTURE = fileURLToPath(new URL('../../../fixtures/darvage-frost.simc', import.meta.url));
const raw = readFileSync(FIXTURE, 'utf8');
const profile = parseProfile(raw);

describe('parseProfile - header and character', () => {
  it('reads the export header comment', () => {
    assert.equal(profile.meta.characterName, 'Darvage');
    assert.equal(profile.meta.specLabel, 'Frost');
    assert.equal(profile.meta.exportedAt, '2026-08-19 16:36');
    assert.equal(profile.meta.addonVersion, '12.1.0-02');
    assert.equal(profile.meta.gameVersion, '12.1.0.69382');
    assert.equal(profile.meta.toc, '120100');
    assert.equal(profile.meta.checksum, 'f53c0df2');
  });

  it('reads class, name and character options', () => {
    assert.equal(profile.class, 'mage');
    assert.equal(profile.name, 'Darvage');
    assert.equal(profile.level, 90);
    assert.equal(profile.race, 'undead');
    assert.equal(profile.region, 'us');
    assert.equal(profile.server, 'tichondrius');
    assert.equal(profile.role, 'spell');
    assert.equal(profile.spec, 'frost');
  });

  it('reads loot_spec even though it is commented out', () => {
    assert.equal(profile.lootSpec, 'frost');
  });

  it('splits professions on the nested equals sign', () => {
    assert.deepEqual(profile.professions, { tailoring: 60, enchanting: 65 });
  });

  it('reads omnium talents', () => {
    assert.deepEqual(profile.omniumTalents, {
      136814: 1,
      136820: 1,
      136817: 1,
      136816: 1,
      136822: 1,
    });
  });
});

describe('parseProfile - talents', () => {
  it('finds the active loadout plus every saved loadout', () => {
    assert.equal(profile.talents.length, 5);
    const active = profile.talents.filter((t) => t.active);
    assert.equal(active.length, 1);
    assert.match(active[0]!.hash, /^CAEAche08tHz49KSVf7iKFnyuZGGLzMzsMmZmYmxYmZmZWMzMzMzMzsM/);
  });

  it('names saved loadouts from their preceding comment', () => {
    assert.deepEqual(
      profile.talents.map((t) => t.name),
      ['Active', 'Delves', 'Frost Raid', 'Frost PVP', 'Frost M+'],
    );
  });

  it('keeps saved loadout hashes distinct', () => {
    const hashes = new Set(profile.talents.map((t) => t.hash));
    assert.equal(hashes.size, 5);
  });
});

describe('parseProfile - equipped gear', () => {
  it('parses all 16 equipped slots', () => {
    assert.equal(Object.keys(profile.equipped).length, 16);
  });

  it('recovers item names and item levels from the comment above each item', () => {
    const head = profile.equipped.head!;
    assert.equal(head.id, 277792);
    assert.equal(head.name, "Venom-Cursed Dragonhawk's Plumage");
    assert.equal(head.itemLevel, 292);
    assert.deepEqual(head.bonusIds, [12833, 41, 13696, 13662]);
  });

  it('parses enchants and content tuning', () => {
    const shoulder = profile.equipped.shoulder!;
    assert.equal(shoulder.enchantId, 7971);
    assert.equal(shoulder.contentTuning, 1226);
    assert.deepEqual(shoulder.bonusIds, [12833, 13439, 6652, 13662, 12699]);
  });

  it('handles an item with no content_tuning', () => {
    const trinket2 = profile.equipped.trinket2!;
    assert.equal(trinket2.id, 250214);
    assert.equal(trinket2.itemLevel, 302);
    assert.equal(trinket2.contentTuning, undefined);
  });

  it('does not leak bag items into the equipped set', () => {
    assert.equal(profile.equipped.head!.id, 277792);
    assert.equal(profile.equipped.main_hand!.id, 160216);
  });
});

describe('parseProfile - bag alternates', () => {
  it('collects every commented bag item', () => {
    assert.equal(profile.bags.length, 19);
    assert.ok(profile.bags.every((i) => i.fromBags));
  });

  it('groups alternates by slot', () => {
    const bySlot = bagsBySlot(profile);
    assert.equal(bySlot.shoulder?.length, 3);
    assert.equal(bySlot.finger1?.length, 3);
    assert.equal(bySlot.trinket1?.length, 3);
    assert.equal(bySlot.main_hand?.length, 1);
  });

  it('parses crafted item fields', () => {
    const crafted = profile.bags.find((i) => i.id === 239675)!;
    assert.deepEqual(crafted.craftedStats, [40, 36]);
    assert.equal(crafted.craftingQuality, 1);
    assert.equal(crafted.name, 'Courtly Shoulders');
  });
});

describe('parseProfile - additional character info', () => {
  it('parses prefixed upgrade currencies and items', () => {
    const crests = profile.upgradeCurrencies.find((c) => c.id === 1792)!;
    assert.equal(crests.kind, 'currency');
    assert.equal(crests.amount, 4654);
    const item = profile.upgradeCurrencies.find((c) => c.id === 256608)!;
    assert.equal(item.kind, 'item');
    assert.equal(item.amount, 9);
    assert.equal(profile.upgradeCurrencies.length, 10);
  });

  it('parses unprefixed catalyst currencies', () => {
    assert.equal(profile.catalystCurrencies.length, 4);
    assert.deepEqual(profile.catalystCurrencies[0], { kind: 'currency', id: 3269, amount: 8 });
  });

  it('parses slot watermarks as raw triples', () => {
    assert.equal(profile.slotWatermarks.length, 17);
    assert.deepEqual(profile.slotWatermarks[0], { slotIndex: 0, current: 292, max: 292 });
    assert.deepEqual(profile.slotWatermarks[14], { slotIndex: 14, current: 0, max: 83 });
  });

  it('parses upgrade achievements', () => {
    assert.deepEqual(profile.upgradeAchievements, [19577, 19578, 19579, 40107]);
  });
});

describe('parseProfile - robustness', () => {
  it('does not throw on empty input', () => {
    const empty = parseProfile('');
    assert.equal(empty.class, undefined);
    assert.ok(empty.warnings.length > 0);
  });

  it('does not throw on truncated input', () => {
    const truncated = parseProfile(raw.slice(0, 900));
    assert.equal(truncated.class, 'mage');
    assert.ok(truncated.talents.length >= 1);
  });

  it('keeps an item name that contains a comma', () => {
    const odd = parseProfile('mage="X"\nmain_hand=Blade of Woe, Reforged,id=123,bonus_id=1/2');
    assert.equal(odd.equipped.main_hand?.name, 'Blade of Woe, Reforged');
    assert.equal(odd.equipped.main_hand?.id, 123);
  });

  it('preserves unmodelled top-level options', () => {
    const odd = parseProfile('mage="X"\nsome_future_option=42');
    assert.equal(odd.unknownOptions.some_future_option, '42');
  });
});

describe('summarize', () => {
  const summary = summarize(profile);

  it('reports the character identity', () => {
    assert.equal(summary.characterName, 'Darvage');
    assert.equal(summary.className, 'mage');
    assert.equal(summary.spec, 'frost');
    assert.equal(summary.equippedCount, 16);
  });

  it('averages item level over equipped non-cosmetic slots', () => {
    // (292+263+292+279+285+285+279+279+263+272+282+292+289+302+292+285) / 16
    assert.equal(summary.averageItemLevel, 283.2);
  });

  it('reports shirt and tabard as excluded rather than empty', () => {
    assert.deepEqual(summary.emptySlots, []);
  });
});

describe('variant generation', () => {
  it('makes one variant per saved loadout', () => {
    const variants = talentVariants(profile);
    assert.equal(variants.length, 5);
    assert.equal(variants[0]!.label, 'Active (equipped)');
    assert.ok(variants.every((v) => typeof v.talents === 'string'));
  });

  it('tries both ring and both trinket positions for bag alternates', () => {
    const variants = bagSwapVariants(profile);
    const ringVariants = variants.filter((v) => v.label.startsWith('finger'));
    // 3 bag rings x 2 positions
    assert.equal(ringVariants.length, 6);
    const trinketVariants = variants.filter((v) => v.label.startsWith('trinket'));
    assert.equal(trinketVariants.length, 6);
  });

  it('labels a swap with the item it replaces', () => {
    const variants = bagSwapVariants(profile);
    const swap = variants.find((v) => v.label.includes('Courtly Shoulders'))!;
    assert.match(swap.label, /^shoulder: Brood Cleanser's Amice -> Courtly Shoulders$/);
  });

  it('applies the swapped item to the right slot only', () => {
    const variants = bagSwapVariants(profile);
    const swap = variants.find((v) => v.label.includes('Amani Summoning Shawl'))!;
    assert.equal(swap.gear?.back?.id, 268248);
    assert.equal(swap.gear?.back?.fromBags, false);
    assert.equal(Object.keys(swap.gear!).length, 1);
  });
});

describe('gear comparison', () => {
  it('groups swaps by slot, in character-sheet order', () => {
    const groups = gearSwapsBySlot(profile);
    assert.deepEqual(
      groups.map((g) => g.slot),
      ['head', 'shoulder', 'back', 'chest', 'wrist', 'hands', 'waist', 'feet',
       'finger1', 'finger2', 'trinket1', 'trinket2', 'main_hand'],
    );
  });

  it('names what is currently worn in each slot', () => {
    const shoulder = gearSwapsBySlot(profile).find((g) => g.slot === 'shoulder')!;
    assert.equal(shoulder.equipped?.name, "Brood Cleanser's Amice");
    assert.equal(shoulder.equipped?.itemLevel, 292);
    assert.equal(shoulder.candidates.length, 3);
  });

  it('sorts each slot by candidate item level, highest first', () => {
    const shoulder = gearSwapsBySlot(profile).find((g) => g.slot === 'shoulder')!;
    assert.deepEqual(
      shoulder.candidates.map((c) => c.candidate.itemLevel),
      [292, 263, 201],
    );
  });

  it('carries the item level delta against the equipped item', () => {
    const shoulder = gearSwapsBySlot(profile).find((g) => g.slot === 'shoulder')!;
    const courtly = shoulder.candidates.find((c) => c.candidate.name === 'Courtly Shoulders')!;
    // 201 against the equipped 292.
    assert.equal(courtly.itemLevelDelta, -91);
  });

  it('offers ring and trinket alternates against both positions', () => {
    const groups = gearSwapsBySlot(profile);
    assert.equal(groups.find((g) => g.slot === 'finger1')!.candidates.length, 3);
    assert.equal(groups.find((g) => g.slot === 'finger2')!.candidates.length, 3);
  });

  it('marks the equipped baseline as the reference', () => {
    const base = equippedBaseline(profile);
    assert.equal(base.baseline, true);
    assert.equal(base.gear, undefined);
    assert.equal(base.talents, undefined);
    assert.match(base.label, /Currently equipped/);
  });

  it('marks only the active talent loadout as the reference', () => {
    const flagged = talentVariants(profile).filter((v) => v.baseline);
    assert.equal(flagged.length, 1);
    assert.equal(flagged[0]!.label, 'Active (equipped)');
  });
});

describe('permutationCount', () => {
  it('multiplies single slots and chooses pairs for rings and trinkets', () => {
    // 2 heads x C(4,2) rings x C(4,2) trinkets x 3 talents = 2*6*6*3
    const total = permutationCount({ head: 2, finger1: 2, finger2: 2, trinket1: 2, trinket2: 2 }, 3);
    assert.equal(total, 216);
  });

  it('treats an unlisted slot as fixed', () => {
    assert.equal(permutationCount({}), 1);
  });
});

describe('serializeProfile', () => {
  it('emits a simc profile that keeps class, spec and talents', () => {
    const text = serializeProfile(profile);
    assert.match(text, /^mage="Darvage"$/m);
    assert.match(text, /^level=90$/m);
    assert.match(text, /^spec=frost$/m);
    assert.match(text, /^professions=tailoring=60\/enchanting=65$/m);
    assert.match(text, /^talents=CAEAche08tHz49KSVf7iKFnyuZGGLzMzsMmZmYmx/m);
  });

  it('emits equipped gear only, never bag alternates', () => {
    const text = serializeProfile(profile);
    const headLines = text.split('\n').filter((l) => l.startsWith('head='));
    assert.equal(headLines.length, 1);
    assert.ok(!text.includes('id=239644'), 'fishing hat from bags must not be emitted');
  });

  it('round-trips an item line byte-for-byte with the source export', () => {
    const text = serializeProfile(profile);
    assert.ok(
      text.includes('shoulder=,id=239031,enchant_id=7971,bonus_id=12833/13439/6652/13662/12699,content_tuning=1226'),
    );
    assert.ok(text.includes('head=,id=277792,bonus_id=12833/41/13696/13662'));
  });

  it('re-parses to an equivalent profile', () => {
    const reparsed = parseProfile(serializeProfile(profile));
    assert.equal(reparsed.class, profile.class);
    assert.equal(reparsed.spec, profile.spec);
    assert.equal(Object.keys(reparsed.equipped).length, 16);
    for (const slot of Object.keys(profile.equipped) as (keyof typeof profile.equipped)[]) {
      assert.equal(reparsed.equipped[slot]?.id, profile.equipped[slot]?.id, slot + ' id');
      assert.deepEqual(
        reparsed.equipped[slot]?.bonusIds,
        profile.equipped[slot]?.bonusIds,
        slot + ' bonus ids',
      );
    }
  });

  it('applies a variant talent hash instead of the active one', () => {
    const raidLoadout = profile.talents.find((t) => t.name === 'Frost Raid')!;
    const text = serializeProfile(profile, { label: 'raid', talents: raidLoadout.hash });
    assert.ok(text.includes('talents=' + raidLoadout.hash));
    const activeHash = profile.talents.find((t) => t.active)!.hash;
    assert.ok(!text.includes('talents=' + activeHash));
  });

  it('applies a variant gear swap', () => {
    const shawl = profile.bags.find((i) => i.id === 268248)!;
    const text = serializeProfile(profile, { label: 'shawl', gear: { back: { ...shawl, fromBags: false } } });
    assert.ok(text.includes('back=,id=268248,bonus_id=6652/13662/13332/12825/11215'));
    assert.ok(!text.includes('id=275525'), 'original cloak must be replaced');
  });

  it('appends sim options', () => {
    const text = serializeProfile(profile, undefined, {
      iterations: 10000,
      targetError: 0.2,
      fightStyle: 'Patchwerk',
      maxTime: 300,
      threads: 8,
      jsonOutput: '/tmp/out.json',
    });
    assert.match(text, /^iterations=10000$/m);
    assert.match(text, /^target_error=0\.2$/m);
    assert.match(text, /^fight_style=Patchwerk$/m);
    assert.match(text, /^threads=8$/m);
    assert.match(text, /^json2=\/tmp\/out\.json$/m);
  });
});
