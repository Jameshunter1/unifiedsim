# ADR-0011: A container engine, for when the OS refuses the native binary

- **Status:** Accepted
- **Date:** 2026-08-19

## Context

SimulationCraft nightlies are unsigned. **Smart App Control**, enforced by
default on many Windows 11 installs, refuses to execute unsigned binaries that
lack established reputation. On the development machine
(`VerifiedAndReputablePolicyState = 1`) the downloaded `simc.exe` extracted
correctly and then would not run at all.

Smart App Control has **no per-app exception list**. Turning it off is
permanent — Windows cannot re-enable it without a reinstall — so "just disable
it" is not something to recommend, and certainly not something to do on a user's
behalf.

The remaining options are: obtain a signed build (none is published), run simc
somewhere the policy does not apply, or give up on simulating.

## Decision

Add `docker-simc`, a second engine behind the same interface
([ADR-0002](0002-pluggable-sim-engine-interface.md)), which builds simc from
source on Linux and runs it in a container. The policy governs Windows process
creation; it does not reach inside the Linux VM.

`resolveDefaultEngine()` walks a preference order — native first, container
second — and returns the first tier that reports itself genuinely runnable. A
machine where the native binary works never pays the container's cost; a machine
where it is blocked keeps working with no configuration.

Report parsing and progress scraping were extracted to
`engines/simcReport.ts`, shared by both simc-backed engines.

## Consequences

- The app works on a locked-down machine without asking the user to make a
  permanent, irreversible security change.
- Adding it touched only `engines/`. This is the first real test of
  [ADR-0002](0002-pluggable-sim-engine-interface.md), and it passed.
- Costs a Docker dependency, a one-time ~10–20 minute source build, and
  per-run container startup.
- Upstream publishes no Linux binaries, so the image builds from source. That is
  slower to prepare but pins an auditable source revision, which is a better
  provenance story than the HTTP-only, checksum-free nightly download.

## Alternatives considered

- **Disable Smart App Control.** Irreversible, and the user's call alone.
- **Self-sign the binary.** Smart App Control requires signatures it trusts;
  a self-signed certificate does not qualify.
- **WSL instead of Docker.** Equivalent isolation and no daemon, but requires
  installing a distro (admin, usually a reboot) and gives a less reproducible
  environment. Still a reasonable route for anyone who prefers it, and
  `SIMC_PATH` supports it.
- **Only support Raidbots or another hosted service.** Introduces a queue, a
  network dependency, and someone else's rate limits, for a tool whose point is
  local execution.
