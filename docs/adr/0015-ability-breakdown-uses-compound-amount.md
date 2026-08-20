# ADR-0015: Ability contribution reads `compound_amount`, not `actual_amount`

- **Status:** Accepted
- **Date:** 2026-08-20

## Context

The per-ability damage chart originally summed `actual_amount.mean` from each
entry in a player's `stats` array, and used `portion_amount` as the share. Both
choices look obviously right, and both are wrong.

simc's stats tree is **recursive**. An ability that deals damage through a
secondary spell — Frozen Orb through its bolts, Flurry through its impacts,
Comet Storm through its comets — records **nothing** in `actual_amount`. The
real figure is in `compound_amount`, which includes every child, and the
breakdown lives under `children`.

Measured on a real Frost Mage profile:

| | `actual_amount` | `compound_amount` |
|---|---|---|
| Coverage of player DPS | **37.0%** | **99.8%** |
| Ice Lance | 5th, 4.6% | **1st, 32.7%** |
| Flurry | absent (0) | **2nd, 18.0%** |

So the chart was not merely incomplete. It was *misleading*: it omitted the
single largest damage source and promoted a mid-tier ability to the top. Nothing
about it looked broken — the bars were sorted, the labels were plausible, the
numbers were real. It could only be caught by adding up the shares and comparing
them against the player's own DPS.

`portion_amount` is unusable for the same underlying reason: it is absent on the
parent entries, so the shares it produced summed to 0.37.

## Decision

Read `compound_amount`, falling back to `actual_amount.mean` for leaf entries
that have no children.

Iterate **top-level entries only**. A child's amount is already inside its
parent's compound total, so walking the tree and summing everything would
double-count.

Compute `share` from the amount against the displayed total, rather than reading
`portion_amount`. Shares therefore sum to 1 by construction, and a test asserts
exactly that.

Existing stored results are repaired on boot from their saved reports, keyed on
the symptom — shares that do not sum to ~1 — rather than a version flag. Re-runs
are harmless because a correct breakdown is skipped.

## Consequences

- The chart accounts for essentially all of a player's damage, and the ranking
  is the one simc's own report shows.
- Shares summing to 1 is now an invariant with a test behind it. That is the
  check that would have caught this on day one, so it is the check that stays.
- The UI states how many abilities were omitted when the list is truncated,
  since a cut list with no note reads as the whole picture.
- One boot-time migration that will be dead code for everyone who installs
  later. Acceptable: silently leaving wrong history on disk is worse.

## Alternatives considered

- **Flatten the tree and show child spells individually.** More granular, but
  "frozen_orb_bolt" is not how a player thinks about their rotation, and it
  makes the list much longer for no decision-making value. The children are
  still in the raw report for anyone who wants them.
- **Trust `portion_amount` where present and compute it elsewhere.** Mixes two
  definitions of share in one chart, which is how you get a chart that sums to
  1.06.
- **Leave stored results alone and only fix new runs.** Cheaper, and leaves
  every historical run displaying a wrong chart with no indication.
