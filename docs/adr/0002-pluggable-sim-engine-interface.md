# ADR-0002: One `SimEngine` interface for every simulation backend

- **Status:** Accepted
- **Date:** 2026-08-19

## Context

The target design has three places a simulation can run: a native
SimulationCraft binary, a WebAssembly build in the browser, and a fleet of
distributed workers for combinatorial searches. Only the first exists today, and
the third may never be needed by a single user.

The tempting shortcut is to call the local binary directly from the job queue
and generalise later. That reliably produces a queue that knows about process
spawning, a UI that knows about file paths, and a "later" that never comes
because the seam has to be cut through five modules at once.

## Decision

Every backend implements one interface
([`apps/server/src/engines/types.ts`](../../apps/server/src/engines/types.ts)):

```ts
interface SimEngine {
  readonly id: string;
  readonly label: string;
  status(): Promise<EngineStatus>;
  run(input: EngineRunInput, hooks: EngineHooks): Promise<{ result: SimResult }>;
}
```

The queue, the store, the event stream and the UI know only this shape.

Unimplemented tiers are registered as `PlannedEngine` instances that report
`available: false` with a specific reason. They are visible in the UI, greyed
out, saying what they need — rather than absent, which would make the seam
invisible and the roadmap invisible with it.

Engine selection is `resolveDefaultEngine()`, which walks a preference order and
returns the first tier that reports itself genuinely runnable.

## Consequences

- Adding the container engine touched only `engines/`. Nothing else changed.
  That is the interface paying for itself once already.
- `SimResult` is a lowest common denominator: DPS, error, ability breakdown,
  scale factors. A backend with richer output has to either fit that shape or
  extend it for everyone.
- The UI can honestly show a tier as "designed but not built", which is more
  useful than silence.

## Alternatives considered

- **Call `simc` directly from the queue.** Simpler today. Guarantees the
  refactor happens later under time pressure, across more code.
- **A plugin system with dynamic loading.** Enormously more machinery for a
  fixed, small set of backends that all live in this repository.
