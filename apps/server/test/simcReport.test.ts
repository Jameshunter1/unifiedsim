import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { extractProgress, parseReport } from '../src/engines/simcReport.ts';

/** A json2 report trimmed to the fields the parser reads. */
const report = {
  version: '1210-01',
  sim: {
    options: { iterations: 9500 },
    statistics: { elapsed_time_seconds: 8.4 },
    players: [
      {
        name: 'Darvage',
        collected_data: {
          dps: { mean: 1234567.8, mean_std_dev: 812.3, stddev: 79000 },
          dpse: { mean: 1200000 },
          fight_length: { mean: 300 },
        },
        scale_factors: { intellect: 1, crit_rating: 0.61 },
        stats: [
          {
            name: 'frostbolt',
            num_executes: { mean: 120 },
            actual_amount: { mean: 90_000_000 },
            portion_amount: 0.24,
            crit_pct: 41.2,
          },
          {
            name: 'ice_lance',
            num_executes: { mean: 200 },
            actual_amount: { mean: 150_000_000 },
            portion_amount: 0.4,
          },
          // No damage and no casts: a talent simc reports but never used.
          { name: 'unused_spell', num_executes: { mean: 0 }, actual_amount: { mean: 0 } },
        ],
      },
    ],
  },
};

describe('parseReport', () => {
  const result = parseReport(JSON.stringify(report));

  it('reads the headline numbers', () => {
    assert.equal(result.dps, 1234567.8);
    assert.equal(result.dpsError, 812.3);
    assert.equal(result.dpsStdev, 79000);
    assert.equal(result.iterations, 9500);
    assert.equal(result.fightLength, 300);
    assert.equal(result.elapsedSeconds, 8.4);
    assert.equal(result.engineVersion, '1210-01');
  });

  it('carries scale factors through when present', () => {
    assert.deepEqual(result.scaleFactors, { intellect: 1, crit_rating: 0.61 });
  });

  it('derives per-ability dps from total amount over fight length', () => {
    const iceLance = result.abilities.find((a) => a.name === 'ice_lance')!;
    assert.equal(iceLance.dps, 150_000_000 / 300);
    assert.equal(iceLance.amountPerExecute, 150_000_000 / 200);
  });

  it('sorts abilities by contribution', () => {
    assert.deepEqual(
      result.abilities.map((a) => a.name),
      ['ice_lance', 'frostbolt'],
    );
  });

  it('drops abilities with no casts and no damage', () => {
    assert.ok(!result.abilities.some((a) => a.name === 'unused_spell'));
  });

  it('does not divide by zero when the fight length is missing', () => {
    const noLength = structuredClone(report);
    delete (noLength.sim.players[0]!.collected_data as { fight_length?: unknown }).fight_length;
    const parsed = parseReport(JSON.stringify(noLength));
    assert.ok(parsed.abilities.every((a) => Number.isFinite(a.dps)));
    assert.equal(parsed.abilities[0]!.dps, 0);
  });

  it('fails with a useful message when the report has no players', () => {
    assert.throws(
      () => parseReport(JSON.stringify({ sim: { players: [] } })),
      /no players/i,
    );
  });
});

describe('extractProgress', () => {
  it('takes the last percentage in a chunk of rewritten progress bars', () => {
    const chunk = '[***-------] 30 %\r[*****-----] 50 %\r[********--] 80 %';
    assert.equal(extractProgress(chunk)?.percent, 80);
  });

  it('returns undefined when there is no percentage', () => {
    assert.equal(extractProgress('Generating baseline...'), undefined);
  });

  it('ignores values outside 0-100', () => {
    assert.equal(extractProgress('error 999 % bogus'), undefined);
  });

  it('is not confused by lastIndex state across calls', () => {
    const chunk = '[**--] 40 %';
    assert.equal(extractProgress(chunk)?.percent, 40);
    assert.equal(extractProgress(chunk)?.percent, 40);
  });
});
