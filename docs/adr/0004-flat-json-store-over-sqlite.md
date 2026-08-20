# ADR-0004: A flat JSON store, not SQLite

- **Status:** Accepted
- **Date:** 2026-08-19

## Context

The app persists profiles and run history. The obvious choice is SQLite via
`better-sqlite3`.

The dataset is a few thousand rows at absolute most, on one machine, with one
writer. There are no joins, no concurrent writers, and no query patterns beyond
"list by profile" and "get by id".

Against that, `better-sqlite3` is a native module. On Windows that means either
a matching prebuilt binary or a Visual Studio toolchain at install time, and it
must be rebuilt against Electron's ABI for the desktop app — which is exactly
the class of dependency that turns `npm install` into a support burden.

## Decision

A single `data/store.json`, loaded on boot and written atomically
(`writeFileSync` to a temp path, then `renameSync`). Writes are coalesced into
one per tick with `queueMicrotask`, so a burst of run updates does not rewrite
the file dozens of times.

An unreadable store is moved aside to `store.json.corrupt-<timestamp>` rather
than overwritten, so a parse failure is recoverable and inspectable.

Large per-run artifacts — the raw simc JSON reports — are **not** in the store.
They live as individual files under `data/runs/` and the store keeps a relative
path, so the hot file stays small.

## Consequences

- No native modules anywhere in the dependency tree. `npm install` needs no
  compiler, and [ADR-0007](0007-electron-shell-hosting-server.md)'s packaging
  needs no ABI rebuild — the packaging step explicitly sets `npmRebuild: false`.
- Atomic rename means a crash mid-write cannot truncate the store. Notably this
  is better than the guarantee WoW gives its own SavedVariables, which is the
  file this app reads.
- The whole store is in memory. Fine at this size; the wrong choice at 10⁶ rows.
- No ad-hoc querying. If run history ever needs real aggregation, revisit —
  and the migration is a script that reads one JSON file.

## Alternatives considered

- **SQLite (`better-sqlite3`).** Correct at a scale this app will not reach,
  with a real install and packaging cost paid by every user immediately.
- **`node:sqlite`.** No native module, but still experimental, and it would tie
  the project to a Node version floor for no benefit at this scale.
- **One file per entity.** Avoids rewriting the whole store, but turns "list
  profiles" into a directory walk and loses atomicity across related writes.
