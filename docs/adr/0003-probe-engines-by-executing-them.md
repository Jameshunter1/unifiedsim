# ADR-0003: Probe engine availability by executing it, and cache the result

- **Status:** Accepted
- **Date:** 2026-08-19

## Context

The first version of `locateSimc()` decided an engine was available if the
binary existed on disk. On the development machine that produced a confident
"Local SimulationCraft: ready" for a binary Windows refused to execute at all —
Smart App Control blocks unsigned executables, and SimulationCraft nightlies are
unsigned (see [ADR-0011](0011-container-engine-for-blocked-binaries.md)).

The UI advertised a working engine. Every run then failed with an opaque
`EPERM`. The check was answering "is there a file here" while claiming to answer
"can I sim".

A second problem appeared once probing meant spawning: libuv spawns processes
**synchronously on the event loop**. When Windows takes several seconds to
refuse a policy-blocked binary, `uv_spawn` stalls the entire server for that
long — long enough that even a timeout racing the probe cannot fire, because the
timer cannot run either. A probe inside a request handler froze the whole app.

## Decision

Availability is determined by **running** the engine and observing that it
starts and produces output. For `simc` that is a bare invocation, which prints
its version banner and usage, then exits non-zero — so a non-zero exit is a
success signal here; what matters is that the process started and said
something.

Results are cached and refreshed by a background sweep every 20 seconds.
**No request handler may trigger a probe.** Statuses are `pending` until their
first probe lands, and the UI polls while any row is pending.

Spawn failures are translated into a diagnosis, not a code: an `EPERM` or
`UNKNOWN` on Windows names Smart App Control and WDAC, gives the registry key to
check, and says what the options are.

## Consequences

- Startup is slightly slower and the first status may be `pending`. Worth it.
- The failure mode that cost the most time to diagnose is now the message the
  user reads first.
- The sweep is sequential, not parallel: a parallel sweep would queue several
  blocking spawns back to back and stall the loop for their combined duration.

## Alternatives considered

- **Check the file exists.** What we had. Advertises engines that cannot run.
- **Probe lazily, on first run.** The user discovers the problem after
  configuring a batch, and the error arrives detached from the cause.
- **Probe in a worker thread.** Would avoid the event-loop stall without the
  cache, but adds a thread and an IPC protocol to answer a question whose answer
  changes maybe twice a day.
