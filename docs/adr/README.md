# Architecture Decision Records

Numbered, immutable records of decisions that are expensive to reverse,
contradict the original blueprint, or would otherwise look like an oversight.
See [ADR-0001](0001-record-architecture-decisions.md) for the format and the
rule about superseding rather than editing.

[`ARCHITECTURE.md`](../../ARCHITECTURE.md) describes the system as it is today
and links here for *why*.

| # | Decision | Status |
|---|---|---|
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions | Accepted |
| [0002](0002-pluggable-sim-engine-interface.md) | One `SimEngine` interface for every backend | Accepted |
| [0003](0003-probe-engines-by-executing-them.md) | Probe engines by executing them, and cache it | Accepted |
| [0004](0004-flat-json-store-over-sqlite.md) | A flat JSON store, not SQLite | Accepted |
| [0005](0005-sse-over-websockets.md) | Server-sent events, not WebSockets | Accepted |
| [0006](0006-node-fs-watch-bridge.md) | The bridge is Node `fs.watch`, not a Rust/Tauri agent | Accepted |
| [0007](0007-electron-shell-hosting-server.md) | Electron shell, hosting the server in-process | Accepted |
| [0008](0008-no-renderer-preload-bridge.md) | The renderer gets no preload bridge | Accepted |
| [0009](0009-item-names-in-comments-only.md) | Item names live in comments, never in the item line | Accepted |
| [0010](0010-wasm-report-via-memfs.md) | The WASM wrapper reads its report from MEMFS | Accepted |
| [0011](0011-container-engine-for-blocked-binaries.md) | A container engine for OS-blocked binaries | Accepted |
| [0012](0012-addon-snapshot-quality-scoring.md) | Snapshots are scored; a worse one never wins | Accepted |
| [0013](0013-unsigned-packaging-and-distribution.md) | Ship from source; packaged builds are unsigned | Accepted |
| [0014](0014-serial-sim-execution-by-default.md) | Run one simulation at a time by default | Accepted |
| [0015](0015-ability-breakdown-uses-compound-amount.md) | Ability contribution reads `compound_amount` | Accepted |

## Departures from the original blueprint

Four of these exist because the supplied blueprint was wrong or suboptimal, and
the reasoning is worth keeping so it is not "corrected" back:

- [0006](0006-node-fs-watch-bridge.md) — a Rust/Tauri agent would call the same
  kernel APIs Node's `fs.watch` already does.
- [0007](0007-electron-shell-hosting-server.md) — Tauri cannot host a Node
  backend without a sidecar binary and an IPC protocol.
- [0010](0010-wasm-report-via-memfs.md) — the proposed `sim_t` API does not
  exist.
- [0012](0012-addon-snapshot-quality-scoring.md) — the proposed Lua serialiser
  emitted numeric spec IDs, localised race names, a non-simc item format, and a
  talent field that does not exist.
