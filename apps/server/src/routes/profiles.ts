import { Router } from 'express';

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
  type GearSlot,
  type ProfileVariant,
} from '@usim/simc-profile';

import { events } from '../events.js';
import { store, type StoredProfile } from '../store.js';

export const profilesRouter = Router();

/** Builds the label shown in the profile list. */
function labelFor(raw: string): string {
  const parsed = parseProfile(raw);
  const name = parsed.name ?? parsed.meta.characterName ?? 'Unnamed';
  const spec = parsed.meta.specLabel ?? parsed.spec;
  return spec ? name + ' - ' + spec : name;
}

/** Imports simc text, reusing an existing row when the text is unchanged. */
export function importProfile(
  raw: string,
  source: StoredProfile['source'],
  label?: string,
): { profile: StoredProfile; created: boolean } {
  const existing = store.findProfileByRaw(raw);
  if (existing) return { profile: existing, created: false };

  const parsed = parseProfile(raw);
  const summary = summarize(parsed);

  const profile = store.addProfile({
    label: label ?? labelFor(raw),
    source,
    raw,
    checksum: parsed.meta.checksum,
    characterName: summary.characterName,
    spec: summary.spec,
    className: summary.className,
    averageItemLevel: summary.averageItemLevel,
  });

  events.emit({ type: 'profile:created', profile, source });
  return { profile, created: true };
}

profilesRouter.get('/', (_req, res) => {
  res.json({ profiles: store.listProfiles() });
});

profilesRouter.post('/', (req, res) => {
  const { raw, label, source } = (req.body ?? {}) as {
    raw?: unknown;
    label?: unknown;
    source?: unknown;
  };

  if (typeof raw !== 'string' || !raw.trim()) {
    res.status(400).json({ error: 'Body must include a non-empty `raw` simc profile string.' });
    return;
  }

  const parsed = parseProfile(raw);
  if (!parsed.class) {
    res.status(422).json({
      error:
        'That text has no class line (expected something like `mage="Darvage"`). ' +
        'Paste the full output of /simc from the SimulationCraft addon.',
      warnings: parsed.warnings,
    });
    return;
  }

  const { profile, created } = importProfile(
    raw,
    source === 'addon' || source === 'file' ? source : 'paste',
    typeof label === 'string' && label.trim() ? label.trim() : undefined,
  );

  res.status(created ? 201 : 200).json({
    profile,
    created,
    summary: summarize(parsed),
    warnings: parsed.warnings,
  });
});

profilesRouter.get('/:id', (req, res) => {
  const stored = store.getProfile(req.params.id);
  if (!stored) {
    res.status(404).json({ error: 'No such profile.' });
    return;
  }

  const parsed = parseProfile(stored.raw);
  res.json({
    profile: stored,
    summary: summarize(parsed),
    equipped: parsed.equipped,
    bags: bagsBySlot(parsed),
    talents: parsed.talents,
    professions: parsed.professions ?? {},
    omniumTalents: parsed.omniumTalents,
    currencies: {
      upgrade: parsed.upgradeCurrencies,
      catalyst: parsed.catalystCurrencies,
      bonusRoll: parsed.bonusRollCurrencies,
    },
    slotWatermarks: parsed.slotWatermarks,
    warnings: parsed.warnings,
  });
});

profilesRouter.delete('/:id', (req, res) => {
  if (!store.deleteProfile(req.params.id)) {
    res.status(404).json({ error: 'No such profile.' });
    return;
  }
  res.status(204).end();
});

/**
 * Suggested variants for this profile, plus the size of the exhaustive search
 * they are a sample of -- so the UI can say how much of the space a batch
 * actually covers rather than implying it is complete.
 */
profilesRouter.get('/:id/variants', (req, res) => {
  const stored = store.getProfile(req.params.id);
  if (!stored) {
    res.status(404).json({ error: 'No such profile.' });
    return;
  }

  const parsed = parseProfile(stored.raw);
  const bySlot = bagsBySlot(parsed);
  const candidatesPerSlot: Partial<Record<GearSlot, number>> = {};
  for (const [slot, items] of Object.entries(bySlot)) {
    // +1 for the item already equipped in that slot.
    candidatesPerSlot[slot as GearSlot] = (items?.length ?? 0) + 1;
  }

  const talents = talentVariants(parsed);
  const gear = bagSwapVariants(parsed);

  res.json({
    talents,
    gear,
    /** The same swaps grouped by slot, which is how gear is actually chosen. */
    gearBySlot: gearSwapsBySlot(parsed),
    /** Every gear comparison needs this run to measure against. */
    baseline: equippedBaseline(parsed),
    /** Single-change variants we can enumerate cheaply. */
    suggestedCount: talents.length + gear.length,
    /** Full cross-product, for deciding when a search needs more than one box. */
    exhaustiveCount: permutationCount(candidatesPerSlot, talents.length),
  });
});

/** Renders the exact simc text a run would use. Useful for debugging a variant. */
profilesRouter.post('/:id/preview', (req, res) => {
  const stored = store.getProfile(req.params.id);
  if (!stored) {
    res.status(404).json({ error: 'No such profile.' });
    return;
  }

  const { variant } = (req.body ?? {}) as { variant?: ProfileVariant };
  const parsed = parseProfile(stored.raw);
  res.type('text/plain').send(serializeProfile(parsed, variant));
});
