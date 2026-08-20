# ADR-0014: Run one simulation at a time by default

- **Status:** Accepted
- **Date:** 2026-08-19

## Context

A batch is many independent simulations — one per talent loadout or gear swap.
Independent work with no shared state is the textbook case for running jobs in
parallel, and the queue supports a configurable concurrency.

The textbook does not apply here. SimulationCraft is itself an embarrassingly
parallel Monte Carlo engine that already spreads iterations across every thread
it is given. `SIMC_THREADS` defaults to cores − 1.

Two simc processes each asking for 15 threads on a 16-core machine do not finish
in half the time. They contend for the same cores and thrash cache, so both run
slower, total throughput is roughly unchanged or worse, and — more annoying in
practice — neither result appears until both are nearly done. Serial execution
returns the first variant's DPS while the rest are still running, which is what
the UI is built to show.

## Decision

`SIM_CONCURRENCY` defaults to `1`. `SIMC_THREADS` defaults to cores − 1, leaving
a core for the OS, the server and the UI.

Both are configurable. Raising concurrency is only sensible alongside a
correspondingly lower thread count, and the comment in
[`config.ts`](../../apps/server/src/config.ts) and the README both say so.

## Consequences

- Predictable wall-clock: a batch of N takes about N × single-sim time, and
  results stream in one at a time.
- The machine stays usable while a batch runs.
- No benefit for a hypothetical engine that is *not* internally parallel — a
  future WASM tier is per-worker single-threaded
  ([ADR-0010](0010-wasm-report-via-memfs.md)) and would want the pool at the
  worker level instead. The concurrency knob exists for exactly that case.

## Alternatives considered

- **Concurrency = core count.** Treats simc as if it were single-threaded. Makes
  every individual result slower and delays the first one.
- **Compute concurrency from `SIMC_THREADS`.** Tempting, but the right answer
  depends on the engine — a container run and a native run have different
  overheads. An explicit default with a documented rationale beats a clever
  formula that is wrong for one tier.
